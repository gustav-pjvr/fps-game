import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { startRelay } from '../server/main.ts';
import { DEFAULT_ALLOWED_ORIGINS, loadConfig } from '../server/config.ts';
import { GAME_VERSION } from '../src/core/version.ts';
import { CLIENT_FEATURES, HOST_SLOT, PLAYER_SLOT_COUNT } from '../src/network/protocol.ts';
import { parseClientFrame, SERVER_CLOSE, SERVER_PROTOCOL_VERSION } from '../src/network/serverEnvelope.ts';
import { serverAccepts } from '../src/network/senderAuthority.ts';

const TIMEOUT_MS = 10_000;
const HZ = 30;
const clients = [];
const pairs = new Map();
const sent = new Map();
const sequences = new Map();
const steps = [];
let relay;
let adapter;
let fatal;
let cpu;
let settings;

function check() {
  if (fatal) throw fatal;
}

async function until(condition, label, timeout = TIMEOUT_MS) {
  const deadline = performance.now() + timeout;
  while (!condition()) {
    check();
    if (performance.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await sleep(5);
  }
  check();
}

// Missing Origin is always refused by the relay. Supply it at the HTTP upgrade only,
// keeping Node's global WebSocket as the client and piping subsequent bytes unchanged.
async function originAdapter(target, origin) {
  const sockets = new Set();
  const requests = new Set();
  const server = createServer((_request, response) => response.writeHead(404).end());
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, downstream, head) => {
    const url = new URL(target);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    const upstreamRequest = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      headers: { ...request.headers, host: url.host, origin },
      agent: false,
    });
    requests.add(upstreamRequest);
    upstreamRequest.setTimeout(TIMEOUT_MS, () => upstreamRequest.destroy());
    upstreamRequest.on('error', () => {
      requests.delete(upstreamRequest);
      fatal ??= new Error('Relay upgrade failed (check URL, TLS and Origin allowlist)');
      downstream.destroy();
    });
    upstreamRequest.on('response', (response) => {
      requests.delete(upstreamRequest);
      fatal ??= new Error(`Relay refused upgrade: HTTP ${response.statusCode}`);
      response.resume();
      downstream.destroy();
    });
    upstreamRequest.on('upgrade', (response, upstream, upstreamHead) => {
      requests.delete(upstreamRequest);
      upstream.setTimeout(0);
      sockets.add(upstream);
      upstream.on('close', () => {
        sockets.delete(upstream);
        downstream.destroy();
      });
      downstream.on('close', () => upstream.destroy());
      upstream.on('error', () => downstream.destroy());
      downstream.on('error', () => upstream.destroy());
      const headers = [];
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        headers.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
      }
      downstream.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join('\r\n')}\r\n\r\n`);
      if (upstreamHead.length) downstream.write(upstreamHead);
      if (head.length) upstream.write(head);
      downstream.pipe(upstream).pipe(downstream);
    });
    downstream.on('error', () => upstreamRequest.destroy());
    downstream.on('close', () => upstreamRequest.destroy());
    upstreamRequest.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `ws://127.0.0.1:${server.address().port}/ws`,
    close: async () => {
      for (const request of requests) request.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

class Client {
  frames = [];
  closed = null;
  slot;

  constructor(url) {
    this.ws = new WebSocket(url);
    clients.push(this);
    this.ws.addEventListener('error', () => {
      fatal ??= new Error('WebSocket error (check relay URL and Origin allowlist)');
    });
    this.ws.addEventListener('close', (event) => {
      this.closed = event.code;
    });
    this.ws.addEventListener('message', (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (frame.op === 'rejected') throw new Error(`Relay rejected operation: ${frame.reason}`);
        if (frame.m?.harnessSequence !== undefined) this.measure(frame);
        else this.frames.push(frame);
      } catch (error) {
        fatal ??= error;
      }
    });
  }

  send(frame) {
    check();
    assert.equal(this.ws.readyState, WebSocket.OPEN, 'Socket must be open when sending');
    this.ws.send(JSON.stringify(frame));
  }

  async next(match, label) {
    let index;
    await until(() => {
      index = this.frames.findIndex(match);
      if (index >= 0) return true;
      assert.equal(this.closed, null, `Socket closed (${this.closed}) while waiting for ${label}`);
      return false;
    }, label);
    return this.frames.splice(index, 1)[0];
  }

  op(name, extra = () => true) {
    return this.next((frame) => frame.op === name && extra(frame), name);
  }

  measure(frame) {
    const sequence = frame.m.harnessSequence;
    const record = sent.get(`${frame.f}:${sequence}`);
    assert.ok(record, 'Unexpected sender or sequence');
    assert.deepEqual(frame.m, record.message, 'Relay changed message payload');
    const pair = pairs.get(`${this.slot}:${frame.f}`);
    assert.ok(pair, 'Unexpected recipient or sender stamp');
    pair.received++;
    if (sequence <= pair.last) pair.orderViolations++;
    pair.last = sequence;
    if (pair.seen.has(sequence)) pair.duplicates++;
    pair.seen.add(sequence);
    pair.latencies.push(performance.now() - record.message.t);
  }
}

async function connect(url, access) {
  const client = new Client(url);
  await until(() => client.ws.readyState === WebSocket.OPEN, 'WebSocket open');
  client.send({ op: 'hello', proto: SERVER_PROTOCOL_VERSION, build: GAME_VERSION, access, features: CLIENT_FEATURES });
  const ready = await client.op('ready');
  assert.equal(ready.proto, SERVER_PROTOCOL_VERSION);
  return client;
}

function transmit(client, message) {
  const sequence = (sequences.get(client.slot) ?? 0) + 1;
  sequences.set(client.slot, sequence);
  // Network messages permit extra fields; the envelope itself permits only m and to.
  const m = { ...message, harnessSequence: sequence, t: performance.now() };
  const frame = { m };
  assert.ok(parseClientFrame(JSON.stringify(frame)), 'Synthetic frame must pass the wire validator');
  assert.ok(serverAccepts(m, client.slot), 'Synthetic frame must pass sender authority');
  sent.set(`${client.slot}:${sequence}`, { message: m });
  for (const pair of pairs.values()) {
    if (pair.sender === client.slot) pair.expected++;
  }
  client.send(frame);
}

function latency(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction) => sorted.length ? Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(3)) : null;
  return { p50: at(0.5), p95: at(0.95), max: at(1) };
}

function report(error) {
  const rows = [...pairs.values()].map((pair) => ({
    receiver: pair.receiver, sender: pair.sender, expected: pair.expected,
    received: pair.received, loss: pair.expected - pair.seen.size,
    orderViolations: pair.orderViolations, duplicates: pair.duplicates,
    latencyMs: latency(pair.latencies),
  }));
  const loss = rows.reduce((sum, row) => sum + row.loss, 0);
  const orderViolations = rows.reduce((sum, row) => sum + row.orderViolations, 0);
  const duplicates = rows.reduce((sum, row) => sum + row.duplicates, 0);
  const ok = !error && loss === 0 && orderViolations === 0 && duplicates === 0 && steps.includes('hostLeave');
  const result = {
    ok, mode: settings?.url ? 'remote' : 'in-process', players: settings?.players,
    seconds: settings?.seconds, hz: HZ, steps, loss, orderViolations, duplicates,
    latencyMs: latency([...pairs.values()].flatMap((pair) => pair.latencies)),
    processCpuMs: cpu ? { user: cpu.user / 1000, system: cpu.system / 1000, total: (cpu.user + cpu.system) / 1000 } : null,
    pairs: rows, ...(error ? { error: error.message } : {}),
  };
  console.log(`Relay harness: ${ok ? 'PASS' : 'FAIL'}, ${result.players ?? '?'} players at ${HZ} Hz`);
  console.log(`Flow: ${steps.join(', ') || 'not started'}`);
  for (const row of rows) {
    console.log(`  ${row.sender} -> ${row.receiver}: ${row.received}/${row.expected} frames, loss ${row.loss}, order violations ${row.orderViolations}, latency p50/p95/max ${row.latencyMs.p50}/${row.latencyMs.p95}/${row.latencyMs.max} ms`);
  }
  console.log(`Loss: ${loss}; order violations: ${orderViolations}; duplicates: ${duplicates}`);
  console.log(cpu ? `Process CPU (relay, clients and adapter): ${result.processCpuMs.total.toFixed(1)} ms` : 'Server CPU: unavailable for remote relay');
  if (error) console.log(`Error: ${error.message}`);
  console.log(JSON.stringify(result));
  process.exitCode = ok ? 0 : 1;
}

async function run() {
  const { values } = parseArgs({ options: {
    players: { type: 'string', default: '4' }, seconds: { type: 'string', default: '10' },
    url: { type: 'string' }, origin: { type: 'string', default: DEFAULT_ALLOWED_ORIGINS[0] },
  } });
  settings = { ...values, players: Number(values.players), seconds: Number(values.seconds) };
  assert.ok(Number.isInteger(settings.players) && settings.players >= 2 && settings.players <= PLAYER_SLOT_COUNT,
    `--players must be an integer from 2 to ${PLAYER_SLOT_COUNT}`);
  assert.ok(Number.isFinite(settings.seconds) && settings.seconds > 0, '--seconds must be positive');
  const origin = new URL(settings.origin);
  assert.ok(['http:', 'https:'].includes(origin.protocol) && origin.origin === settings.origin, '--origin must be an HTTP or HTTPS origin');
  let access;
  let target = settings.url;
  if (target) {
    const url = new URL(target);
    assert.ok(['ws:', 'wss:'].includes(url.protocol), '--url must use ws or wss');
    assert.ok(!url.username && !url.password, '--url must not contain credentials');
    access = process.env.HNG_RELAY_ACCESS?.trim();
    assert.ok(access, 'HNG_RELAY_ACCESS is required with --url');
  } else {
    access = randomBytes(24).toString('hex');
    const config = { ...loadConfig({ HNG_ACCESS_CODES: access, HNG_ALLOWED_ORIGINS: settings.origin }), port: 0 };
    relay = await startRelay(config, { logSink: () => {} });
    target = `ws://127.0.0.1:${relay.port}/ws`;
  }
  adapter = await originAdapter(target, settings.origin);
  const host = await connect(adapter.url, access);
  host.slot = HOST_SLOT;
  host.send({ op: 'create', username: 'Host', maxPlayers: settings.players });
  const created = await host.op('created');
  assert.equal(created.slot, HOST_SLOT);
  steps.push('hello', 'create');
  const roster = [{ slot: HOST_SLOT, username: 'Host' }];
  const tokens = new Map();
  const active = [host];

  async function join(username, token, expectedSlot, outcome) {
    const guest = await connect(adapter.url, access);
    guest.send({ op: 'join', code: created.code, username, rejoinToken: token, features: CLIENT_FEATURES });
    const request = await host.op('joinRequest', (frame) => frame.rejoinToken === token);
    assert.equal(request.outcome, outcome);
    if (expectedSlot !== undefined) assert.equal(request.slot, expectedSlot);
    guest.slot = request.slot;
    if (!roster.some((entry) => entry.slot === guest.slot)) roster.push({ slot: guest.slot, username });
    host.send({ op: 'joinAnswer', slot: guest.slot, welcome: {
      type: 'welcome', yourSlot: guest.slot, isRejoin: outcome === 'rejoined', hostUsername: 'Host', roster,
    } });
    const welcome = await guest.next((frame) => frame.f === HOST_SLOT && frame.m?.type === 'welcome', 'welcome');
    assert.equal(welcome.m.yourSlot, guest.slot);
    assert.equal(welcome.m.isRejoin, outcome === 'rejoined');
    await host.op('admitted', (frame) => frame.slot === guest.slot);
    return guest;
  }

  for (let i = 1; i < settings.players; i++) {
    const token = randomUUID();
    const guest = await join(`Guest${i}`, token, undefined, 'joined');
    assert.ok(!active.some((client) => client.slot === guest.slot), 'Unique assigned slot');
    tokens.set(guest.slot, token);
    active.push(guest);
    guest.send({ m: { type: 'playerReady', slot: guest.slot, ready: true } });
    await host.next((frame) => frame.f === guest.slot && frame.m?.type === 'playerReady' && frame.m.ready, 'player ready');
  }
  steps.push('join', 'accept');
  host.send({ m: { type: 'lobbyReadyUpdate', readySlots: active.map((client) => client.slot) } });
  for (const guest of active.slice(1)) await guest.next((frame) => frame.f === HOST_SLOT && frame.m?.type === 'lobbyReadyUpdate', 'lobby ready');
  steps.push('ready');
  host.send({ m: { type: 'matchStart', seed: 1, killLimit: 10, gooseDifficulty: 'normal', gameMode: 'deathmatch', weather: 'clear',
    spawns: roster.map(({ slot }) => ({ slot, x: slot, z: 0 })), roster } });
  for (const guest of active.slice(1)) await guest.next((frame) => frame.f === HOST_SLOT && frame.m?.type === 'matchStart', 'match start');
  for (const receiver of active) {
    for (const sender of active) {
      if (receiver === sender) continue;
      pairs.set(`${receiver.slot}:${sender.slot}`, { receiver: receiver.slot, sender: sender.slot,
        expected: 0, received: 0, orderViolations: 0, duplicates: 0, last: 0, seen: new Set(), latencies: [] });
    }
  }
  const cpuStart = relay ? process.cpuUsage() : null;
  const start = performance.now();
  const ticks = Math.ceil(settings.seconds * HZ);
  for (let tick = 0; tick < ticks; tick++) {
    await sleep(Math.max(0, start + tick * 1000 / HZ - performance.now()));
    for (const client of active) {
      transmit(client, { type: 'playerSnapshot', senderSlot: client.slot, x: tick % 100, y: 1, z: client.slot, yaw: 0, pitch: 0, health: 100 });
      if (tick % HZ === 0) transmit(client, { type: 'fireEvent', senderSlot: client.slot,
        originX: 0, originY: 1, originZ: 0, endX: 10, endY: 1, endZ: 0, weaponId: 'pistol' });
    }
    transmit(host, { type: 'gooseSnapshot', id: 'harness-goose', x: tick % 100, y: 0, z: 0 });
  }
  await sleep(Math.max(0, start + settings.seconds * 1000 - performance.now()));
  // Drain against independently counted sends, including each shot and host goose frame.
  // Keep the counts on timeout so the failure report still shows actual loss.
  await until(() => [...pairs.values()].every((pair) => pair.seen.size === pair.expected), 'match delivery drain');
  if (cpuStart) cpu = process.cpuUsage(cpuStart);
  steps.push('match', 'shots', 'hostSnapshots');

  let guest = active[1];
  const slot = guest.slot;
  guest.ws.close(1000);
  await until(() => guest.closed !== null, 'guest disconnect');
  await host.op('memberLeft', (frame) => frame.slot === slot);
  guest = await join(`Guest${slot}`, tokens.get(slot), slot, 'rejoined');
  active[1] = guest;
  steps.push('disconnect', 'rejoin');
  host.send({ op: 'kick', slot });
  await until(() => guest.closed !== null, 'kick close');
  assert.equal(guest.closed, SERVER_CLOSE.kicked);
  await host.op('memberLeft', (frame) => frame.slot === slot);
  steps.push('kick');
  // Re-admit the kicked guest so even the two-player run has a host-leave observer.
  active[1] = await join(`Guest${slot}`, tokens.get(slot), slot, 'rejoined');
  steps.push('rejoinAfterKick');
  host.send({ op: 'leave' });
  for (const observer of active.slice(1)) {
    await observer.op('roomClosed', (frame) => frame.reason === 'hostLeft');
    await until(() => observer.closed !== null, 'room close');
    assert.equal(observer.closed, SERVER_CLOSE.roomClosed);
  }
  await until(() => host.closed !== null, 'host leave close');
  assert.equal(host.closed, SERVER_CLOSE.normal);
  steps.push('hostLeave');
}

let failure;
try {
  await run();
} catch (error) {
  failure = error;
} finally {
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.close();
  }
  try {
    await adapter?.close();
    await relay?.shutdown();
  } catch (error) {
    failure ??= error;
  }
}
report(failure ?? fatal);
