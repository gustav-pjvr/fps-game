import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { GAME_VERSION } from '../src/core/version.ts';
import { HOST_SLOT, type NetworkMessage, type PlayerSlot, type WelcomeMessage } from '../src/network/protocol.ts';
import { SERVER_CLOSE, SERVER_FRAME_MAX_BYTES, SERVER_PROTOCOL_VERSION, type ServerFrame } from '../src/network/serverEnvelope.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import { startRelay, type Relay, type RelayOptions } from './main.ts';

/**
 * The relay shell end to end, in-process on a random port with a real ws client: health, the
 * upgrade checks, the handshake, the per-IP limits, frame size caps, a relayed game frame with the
 * server's sender stamp, the host leaving, heartbeat and shutdown. Section 11 of the design.
 */

const ORIGIN = 'http://localhost:5173';
const CODE = 'test-access-code-41';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Frame = ServerFrame & Record<string, unknown>;

class Client {
  readonly ws: WebSocket;
  readonly frames: Frame[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private waiters: { match: (frame: Frame) => boolean; done: (frame: Frame) => void }[] = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.closed = new Promise((done) => ws.on('close', (code, reason) => done({ code, reason: reason.toString() })));
    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      this.frames.push(frame);
      for (const waiter of [...this.waiters]) {
        if (waiter.match(frame)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.done(frame);
        }
      }
    });
  }

  send(value: unknown): void {
    this.ws.send(typeof value === 'string' ? value : JSON.stringify(value));
  }

  /** The first frame (already here or still to come) that matches. */
  next(match: (frame: Frame) => boolean, ms = 2000): Promise<Frame> {
    const found = this.frames.find(match);
    if (found) return Promise.resolve(found);
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`no matching frame in ${ms} ms; got ${JSON.stringify(this.frames)}`)), ms);
      this.waiters.push({ match, done: (frame) => (clearTimeout(timer), done(frame)) });
    });
  }

  op(name: string, ms?: number): Promise<Frame> {
    return this.next((frame) => frame.op === name, ms);
  }
}

let relay: Relay;
let logs: string[];
const clients: WebSocket[] = [];

async function start(options: RelayOptions = {}, env: Record<string, string> = {}): Promise<void> {
  logs = [];
  const config: ServerConfig = { ...loadConfig({ HNG_ACCESS_CODES: CODE, HNG_ALLOWED_ORIGINS: ORIGIN, HNG_LOG_LEVEL: 'debug', ...env }), port: 0 };
  relay = await startRelay(config, { logSink: (line) => logs.push(line), ...options });
}

/** Open a socket; resolves once open, or rejects with the http status the upgrade got. */
function connect(options: { origin?: string | null; path?: string; headers?: Record<string, string>; autoPong?: boolean } = {}): Promise<Client> {
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const ws = new WebSocket(`ws://127.0.0.1:${relay.port}${options.path ?? '/ws'}`, {
    ...(origin === null ? {} : { origin }),
    headers: options.headers ?? {},
    autoPong: options.autoPong ?? true,
  });
  clients.push(ws);
  return new Promise((done, fail) => {
    ws.once('open', () => done(new Client(ws)));
    ws.once('unexpected-response', (_request, response) => fail(new Error(`status ${response.statusCode}`)));
    ws.once('error', (error) => fail(error));
  });
}

const hello = (access: unknown = CODE, proto = SERVER_PROTOCOL_VERSION) => ({ op: 'hello', proto, build: GAME_VERSION, access, features: ['facility'] });

async function ready(options?: Parameters<typeof connect>[0]): Promise<Client> {
  const client = await connect(options);
  client.send(hello());
  await client.op('ready');
  return client;
}

const welcomeFor = (slot: PlayerSlot, extra: Partial<WelcomeMessage> = {}): WelcomeMessage => ({
  type: 'welcome',
  yourSlot: slot,
  isRejoin: false,
  hostUsername: 'Host',
  roster: [{ slot: HOST_SLOT, username: 'Host' }, { slot, username: `Guest${slot}` }],
  ...extra,
});

const snapshot = (senderSlot: PlayerSlot, marker = 'PAYLOAD-MARKER-7c1'): NetworkMessage =>
  ({ type: 'playerSnapshot', senderSlot, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100, t: 5, marker }) as unknown as NetworkMessage;

interface Room {
  host: Client;
  code: string;
}

async function createRoom(): Promise<Room> {
  const host = await ready();
  host.send({ op: 'create', username: 'Host', maxPlayers: 4 });
  const created = await host.op('created');
  return { host, code: created.code as string };
}

/** Join and have the host admit with `welcome`; resolves with the guest once it holds the welcome. */
async function joinAndAdmit(room: Room, name: string, welcome?: (slot: PlayerSlot) => WelcomeMessage, options?: Parameters<typeof connect>[0]): Promise<{ guest: Client; slot: PlayerSlot }> {
  const guest = await ready(options);
  const before = room.host.frames.filter((frame) => frame.op === 'joinRequest').length;
  guest.send({ op: 'join', code: room.code, username: name, rejoinToken: `tok-${name}`, features: ['facility'] });
  const request = await room.host.next((frame) => frame.op === 'joinRequest' && frame.username === name);
  expect(room.host.frames.filter((frame) => frame.op === 'joinRequest').length).toBe(before + 1);
  const slot = request.slot as PlayerSlot;
  room.host.send({ op: 'joinAnswer', slot, welcome: (welcome ?? welcomeFor)(slot) });
  await guest.next((frame) => 'm' in frame && (frame.m as NetworkMessage).type === 'welcome');
  await room.host.next((frame) => frame.op === 'admitted' && frame.slot === slot);
  return { guest, slot };
}

const health = async (path = '/healthz') => {
  const response = await fetch(`http://127.0.0.1:${relay.port}${path}`);
  return { status: response.status, body: response.status === 200 ? ((await response.json()) as Record<string, unknown>) : null };
};

const waitFor = async (condition: () => boolean, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((done) => setTimeout(done, 10));
  }
};

beforeEach(() => {
  clients.length = 0;
});

afterEach(async () => {
  for (const ws of clients) ws.terminate();
  await relay?.shutdown();
});

describe('relay shell: http', () => {
  it('GET /healthz answers ok, version, uptime, rooms and members; anything else is 404', async () => {
    await start();
    expect(await health()).toEqual({ status: 200, body: { ok: true, version: GAME_VERSION, uptimeS: 0, rooms: 0, members: 0 } });
    await createRoom();
    expect((await health()).body).toMatchObject({ rooms: 1, members: 1 });
    expect((await health('/')).status).toBe(404);
    expect((await health('/ws')).status).toBe(404);
  });

  it('GET /healthz through the proxy (X-Forwarded-For set) answers only ok, so outsiders cannot watch activity', async () => {
    await start();
    await createRoom();
    for (const headers of [{ 'x-forwarded-for': '203.0.113.9' }, { 'x-forwarded-proto': 'https' }]) {
      const response = await fetch(`http://127.0.0.1:${relay.port}/healthz`, { headers });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('{"ok":true}');
    }
    // Straight from this machine (deploy.sh, status.sh) the details are still there.
    expect((await health()).body).toMatchObject({ ok: true, version: GAME_VERSION, rooms: 1, members: 1 });
  });
});

describe('relay shell: the upgrade', () => {
  it('upgrades only /ws, and only from an allowed Origin', async () => {
    await start();
    await expect(connect({ path: '/other' })).rejects.toThrow('status 404');
    await expect(connect({ origin: 'https://evil.example' })).rejects.toThrow('status 403');
    await expect(connect({ origin: null })).rejects.toThrow('status 403');
    await expect(connect({ origin: 'http://localhost:5173.evil.example' })).rejects.toThrow('status 403');
    const client = await connect();
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('caps open sockets per IP, and frees the place when one closes', async () => {
    await start({ maxConnectionsPerIp: 2 });
    const first = await connect();
    await connect();
    await expect(connect()).rejects.toThrow('status 429');
    first.ws.close();
    await first.closed;
    await waitFor(() => relay.connectionCount() === 1);
    await expect(connect()).resolves.toBeInstanceOf(Client);
  });

  it('from 127.0.0.1 counts by the X-Forwarded-For address the local proxy set, and refuses a junk one', async () => {
    await start({ maxConnectionsPerIp: 1 });
    await connect({ headers: { 'x-forwarded-for': '198.51.100.1' } });
    await connect({ headers: { 'x-forwarded-for': '198.51.100.2' } });
    await expect(connect({ headers: { 'x-forwarded-for': '198.51.100.1' } })).rejects.toThrow('status 429');
    // One /64 is one household.
    await connect({ headers: { 'x-forwarded-for': '2001:db8:1:2::1' } });
    await expect(connect({ headers: { 'x-forwarded-for': '2001:db8:1:2::99' } })).rejects.toThrow('status 429');
    await expect(connect({ headers: { 'x-forwarded-for': 'not-an-ip' } })).rejects.toThrow('status 400');
  });
});

describe('relay shell: the handshake', () => {
  it('a right code gets ready with the protocol version', async () => {
    await start();
    const client = await connect();
    client.send(hello());
    expect(await client.op('ready')).toMatchObject({ op: 'ready', proto: SERVER_PROTOCOL_VERSION });
  });

  it('a missing, empty, wrong or non-string code closes 4001', async () => {
    await start({ failurePolicy: { maxFailures: 100, windowMs: 60_000, blockMs: 600_000, maxTrackedIps: 100 } });
    for (const access of [undefined, '', 'wrong-code', 42, null]) {
      const client = await connect();
      client.send(access === undefined ? { op: 'hello', proto: SERVER_PROTOCOL_VERSION, build: GAME_VERSION } : hello(access));
      expect((await client.closed).code, String(access)).toBe(SERVER_CLOSE.accessDenied);
      expect(client.frames).toEqual([]);
    }
  });

  it('after the allowed failures the IP is blocked, and even the right code is refused without being compared', async () => {
    await start({ failurePolicy: { maxFailures: 2, windowMs: 60_000, blockMs: 600_000, maxTrackedIps: 100 } });
    for (const access of ['guess-one', 'guess-two']) {
      const client = await connect();
      client.send(hello(access));
      expect((await client.closed).code).toBe(SERVER_CLOSE.accessDenied);
    }
    const client = await connect();
    client.send(hello(CODE));
    expect((await client.closed).code).toBe(SERVER_CLOSE.accessDenied);
    expect(client.frames).toEqual([]);
    expect(logs.some((line) => line.includes('"result":"blocked"'))).toBe(true);
    // Neither the code nor the guesses reach the log.
    for (const secret of [CODE, 'guess-one', 'guess-two']) expect(logs.join('\n')).not.toContain(secret);
  });

  it('IPv6 failures count per /48 as well as per /64, the /48 at a looser limit: neighbours keep playing, stepping through /64s gains nothing', async () => {
    await start({ failurePolicy: { maxFailures: 3, windowMs: 60_000, blockMs: 600_000, maxTrackedIps: 100 } });
    const guess = async (address: string): Promise<void> => {
      const client = await connect({ headers: { 'x-forwarded-for': address } });
      client.send(hello('guess-v6'));
      expect((await client.closed).code).toBe(SERVER_CLOSE.accessDenied);
    };
    // Three strangers in one /48 each mistype once: their neighbour in a fourth /64 still gets in.
    for (const address of ['2001:db8:1:1::1', '2001:db8:1:2::1', '2001:db8:1:3::1']) await guess(address);
    const neighbour = await connect({ headers: { 'x-forwarded-for': '2001:db8:1:4::1' } });
    neighbour.send(hello());
    await neighbour.op('ready');
    // One person stepping through /64s: the /48 blocks at WIDE_KEY_FAILURE_SCALE (5) times the limit,
    // 15 failures here, three already counted above.
    for (let i = 0; i < 12; i++) await guess(`2001:db8:1:${(10 + i).toString(16)}::1`);
    // A further /64 of the same /48 is blocked, even with the right code.
    const sameSite = await connect({ headers: { 'x-forwarded-for': '2001:db8:1:ff::1' } });
    sameSite.send(hello());
    expect((await sameSite.closed).code).toBe(SERVER_CLOSE.accessDenied);
    expect(sameSite.frames).toEqual([]);
    // Another /48 is not.
    const otherSite = await connect({ headers: { 'x-forwarded-for': '2001:db8:2:1::1' } });
    otherSite.send(hello());
    await otherSite.op('ready');
  });

  it('a different protocol version closes 4002 before the code is looked at', async () => {
    await start();
    const client = await connect();
    client.send(hello('wrong-code', SERVER_PROTOCOL_VERSION + 1));
    expect((await client.closed).code).toBe(SERVER_CLOSE.versionMismatch);
    expect(logs.some((line) => line.includes('"result":"accessDenied"'))).toBe(false);
  });

  it('no hello within the deadline closes 4003', async () => {
    await start({ helloDeadlineMs: 150 });
    const client = await connect();
    const started = Date.now();
    expect((await client.closed).code).toBe(SERVER_CLOSE.handshakeTimeout);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('a first frame that is not a hello, or is binary, closes the socket', async () => {
    await start();
    const notHello = await connect();
    notHello.send({ op: 'create', username: 'x', maxPlayers: 4 });
    expect((await notHello.closed).code).toBe(1008);
    const binary = await connect();
    binary.ws.send(Buffer.from([1, 2, 3]));
    expect((await binary.closed).code).toBe(1003);
    expect(relay.registry.roomCount()).toBe(0);
  });
});

describe('relay shell: rooms through real sockets', () => {
  it('create, join, admit, then a relayed playerSnapshot reaches the others stamped with the true sender', async () => {
    await start();
    const room = await createRoom();
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
    const bob = await joinAndAdmit(room, 'Bob');
    const cara = await joinAndAdmit(room, 'Cara');
    expect([bob.slot, cara.slot]).toEqual([1, 2]);
    const welcome = bob.guest.frames.find((frame) => 'm' in frame);
    expect(welcome).toMatchObject({ f: HOST_SLOT, m: { type: 'welcome', yourSlot: 1 } });

    bob.guest.send({ m: snapshot(1) });
    expect(await room.host.next((frame) => 'm' in frame && (frame.m as NetworkMessage).type === 'playerSnapshot')).toEqual({ f: 1, m: snapshot(1) });
    expect(await cara.guest.next((frame) => 'm' in frame && (frame.m as NetworkMessage).type === 'playerSnapshot')).toEqual({ f: 1, m: snapshot(1) });
    expect(bob.guest.frames.some((frame) => 'm' in frame && (frame.m as NetworkMessage).type === 'playerSnapshot')).toBe(false);

    // A snapshot naming someone else's slot is refused by the server's sender check.
    cara.guest.send({ m: snapshot(1, 'SPOOF') });
    cara.guest.send({ m: snapshot(2, 'REAL') });
    expect(await bob.guest.next((frame) => 'm' in frame && (frame.m as Record<string, unknown>).marker === 'REAL')).toMatchObject({ f: 2 });
    expect(bob.guest.frames.some((frame) => 'm' in frame && (frame.m as Record<string, unknown>).marker === 'SPOOF')).toBe(false);

    // Logs carry events, never payloads or the code.
    const all = logs.join('\n');
    for (const secret of ['PAYLOAD-MARKER-7c1', 'REAL', 'SPOOF', CODE, 'tok-Bob']) expect(all).not.toContain(secret);
    expect(all).toContain('"event":"admit"');
  });

  it('a socket gets one room: a second create or join is ignored', async () => {
    await start();
    const room = await createRoom();
    room.host.send({ op: 'create', username: 'Host', maxPlayers: 4 });
    room.host.send({ op: 'join', code: room.code, username: 'Again', rejoinToken: null });
    room.host.send({ op: 'ping', n: 1, t: 1, rtt: null });
    await room.host.op('pong');
    expect(room.host.frames.filter((frame) => frame.op === 'created')).toHaveLength(1);
    expect(room.host.frames.filter((frame) => frame.op === 'joinRequest')).toHaveLength(0);
    expect(relay.registry.roomCount()).toBe(1);
    expect(relay.registry.roomByCode(room.code)?.dropCount('unexpectedOp')).toBe(2);
  });

  it('an unknown code is answered rejected notFound, then closed', async () => {
    await start();
    const guest = await ready();
    guest.send({ op: 'join', code: 'ZZZZZZ', username: 'Bob', rejoinToken: null });
    expect(await guest.op('rejected')).toEqual({ op: 'rejected', reason: 'notFound' });
    expect((await guest.closed).code).toBe(1000);
  });

  it('joins with unknown room codes are counted per IP: past the limit every join is answered notFound, the access code still works', async () => {
    await start({ joinFailurePolicy: { maxFailures: 3, windowMs: 60_000, blockMs: 600_000, maxTrackedIps: 100 } });
    const room = await createRoom();
    for (const code of ['ZZZZZZ', 'YYYYYY', 'XXXXXX']) {
      const guest = await ready();
      guest.send({ op: 'join', code, username: 'Eve', rejoinToken: null });
      expect(await guest.op('rejected')).toEqual({ op: 'rejected', reason: 'notFound' });
      await guest.closed;
    }
    // Blocked: even the right code is answered notFound without being looked up; the host hears nothing.
    const late = await ready();
    late.send({ op: 'join', code: room.code, username: 'Eve', rejoinToken: null });
    expect(await late.op('rejected')).toEqual({ op: 'rejected', reason: 'notFound' });
    expect((await late.closed).code).toBe(SERVER_CLOSE.normal);
    expect(room.host.frames.filter((frame) => frame.op === 'joinRequest')).toHaveLength(0);
    expect(logs.some((line) => line.includes('"event":"join"') && line.includes('"result":"blocked"'))).toBe(true);
    // The access code is a separate count: a hello from the same IP still gets ready.
    await ready();
    // Another IP joins as usual.
    const other = await ready({ headers: { 'x-forwarded-for': '198.51.100.9' } });
    other.send({ op: 'join', code: room.code, username: 'Fay', rejoinToken: null });
    expect(await room.host.op('joinRequest')).toMatchObject({ username: 'Fay' });
  });

  it('one IP holds at most 3 open rooms: its next create is refused busy, another IP still creates', async () => {
    await start();
    for (let i = 0; i < 3; i++) await createRoom();
    const fourth = await ready();
    fourth.send({ op: 'create', username: 'Host', maxPlayers: 4 });
    expect(await fourth.op('rejected')).toEqual({ op: 'rejected', reason: 'busy' });
    expect(relay.registry.roomCount()).toBe(3);
    const elsewhere = await ready({ headers: { 'x-forwarded-for': '198.51.100.20' } });
    elsewhere.send({ op: 'create', username: 'Host', maxPlayers: 4 });
    await elsewhere.op('created');
  });

  it('a guest frame above 64 KiB is refused (1009) although ws would carry 128 KiB', async () => {
    await start();
    const room = await createRoom();
    const bob = await joinAndAdmit(room, 'Bob');
    const big = JSON.stringify({ m: { ...snapshot(1), pad: 'x'.repeat(SERVER_FRAME_MAX_BYTES) } });
    expect(big.length).toBeGreaterThan(SERVER_FRAME_MAX_BYTES);
    expect(big.length).toBeLessThan(128 * 1024);
    bob.guest.send(big);
    expect((await bob.guest.closed).code).toBe(1009);
    expect(room.host.frames.some((frame) => 'm' in frame && (frame.m as NetworkMessage).type === 'playerSnapshot')).toBe(false);
    // The room goes on: the host heard the guest leave.
    expect(await room.host.op('memberLeft')).toMatchObject({ op: 'memberLeft', slot: bob.slot });
  });

  it('a socket not yet in a room is held to 64 KiB too', async () => {
    await start();
    const client = await ready();
    client.send(JSON.stringify({ op: 'ping', n: 1, t: 1, rtt: null, pad: 'x'.repeat(SERVER_FRAME_MAX_BYTES) }));
    expect((await client.closed).code).toBe(1009);
  });

  it('the host may send a legal welcome above 64 KiB (up to 128 KiB), and the guest receives it whole', async () => {
    await start();
    const room = await createRoom();
    const ids = Array<number>(4096).fill(1_234_567_890);
    const big = (slot: PlayerSlot): WelcomeMessage =>
      welcomeFor(slot, {
        activeMatch: {
          seed: 1, killLimit: 10, gooseDifficulty: 'normal', gameMode: 'default', weather: 'day', map: 'valley',
          scoreboard: [{ slot: 0, score: 0 }], spawnPoint: { x: 0, z: 0 }, deadLamps: ids,
          worldObjects: { doors: '', breakers: '', valleyDoors: ids },
        },
      } as Partial<WelcomeMessage>);
    expect(JSON.stringify({ op: 'joinAnswer', slot: 1, welcome: big(1) }).length).toBeGreaterThan(SERVER_FRAME_MAX_BYTES);
    const bob = await joinAndAdmit(room, 'Bob', big);
    const welcome = bob.guest.frames.find((frame) => 'm' in frame)?.m as WelcomeMessage;
    expect(welcome.activeMatch?.deadLamps).toHaveLength(4096);
    // Above 128 KiB ws itself refuses the host's frame.
    room.host.send(JSON.stringify({ m: { ...snapshot(0), pad: 'x'.repeat(128 * 1024) } }));
    expect((await room.host.closed).code).toBe(1009);
  });

  it('the host leaving closes the room: every guest gets roomClosed hostLeft, then 4004', async () => {
    await start();
    const room = await createRoom();
    const bob = await joinAndAdmit(room, 'Bob');
    room.host.ws.close();
    expect(await bob.guest.op('roomClosed')).toEqual({ op: 'roomClosed', reason: 'hostLeft' });
    expect((await bob.guest.closed).code).toBe(SERVER_CLOSE.roomClosed);
    await waitFor(() => relay.registry.roomCount() === 0);
    expect((await health()).body).toMatchObject({ rooms: 0, members: 0 });
    // The code is tombstoned: a late join reads notFound.
    const late = await ready();
    late.send({ op: 'join', code: room.code, username: 'Late', rejoinToken: null });
    expect(await late.op('rejected')).toEqual({ op: 'rejected', reason: 'notFound' });
  });
});

describe('relay shell: resume (section 5.6)', () => {
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
  const tokenOf = (client: Client): string => client.frames.find((frame) => frame.op === 'ready')?.sessionToken as string;
  const shot = (senderSlot: PlayerSlot, t: number): NetworkMessage =>
    ({ type: 'fireEvent', senderSlot, originX: 0, originY: 1, originZ: 0, endX: 5, endY: 1, endZ: 5, weaponId: 'rifle', t }) as NetworkMessage;
  const isOp = (name: string, slot: PlayerSlot) => (frame: Frame) => frame.op === name && frame.slot === slot;

  async function resumeWith(token: string, lastSeq: number, options?: Parameters<typeof connect>[0]): Promise<Client> {
    const client = await ready(options);
    client.send({ op: 'resume', sessionToken: token, lastSeq });
    return client;
  }

  it('ready carries a fresh 22-character base64url session token per socket', async () => {
    await start();
    const first = tokenOf(await ready());
    const second = tokenOf(await ready());
    expect(first).toMatch(TOKEN_PATTERN);
    expect(second).toMatch(TOKEN_PATTERN);
    expect(first).not.toBe(second);
  });

  it('a guest whose connection drops resumes on a new socket: away and back for the host, resumed then the replay for the guest', async () => {
    await start();
    const room = await createRoom();
    const bob = await joinAndAdmit(room, 'Bob');
    const token = tokenOf(bob.guest);
    // No close frame at all, as when the network goes: the server sees 1006.
    bob.guest.ws.terminate();
    await room.host.next(isOp('away', bob.slot));
    room.host.send({ m: shot(0, 41) });
    room.host.send({ m: snapshot(0) });
    room.host.send({ m: shot(0, 42) });

    // The new socket's hello is checked like any other, and a resume is no first frame.
    const denied = await connect();
    denied.send(hello('wrong-code'));
    expect((await denied.closed).code).toBe(SERVER_CLOSE.accessDenied);
    const early = await connect();
    early.send({ op: 'resume', sessionToken: token, lastSeq: 1 });
    expect((await early.closed).code).toBe(1008);

    const again = await resumeWith(token, 1);
    await again.next((frame) => frame.s === 3);
    const next = (await again.op('resumed')).sessionToken as string;
    expect(next).toMatch(TOKEN_PATTERN);
    expect(next).not.toBe(token);
    expect(again.frames.map((frame) => frame.op ?? 'game')).toEqual(['ready', 'resumed', 'game', 'game']);
    expect(again.frames.slice(2)).toEqual([{ s: 2, f: 0, m: shot(0, 41) }, { s: 3, f: 0, m: shot(0, 42) }]);
    await room.host.next(isOp('back', bob.slot));

    // Same slot, same room: its frames reach the host with its true sender.
    again.send({ m: snapshot(1, 'AFTER-RESUME') });
    expect(await room.host.next((frame) => 'm' in frame && (frame.m as Record<string, unknown>).marker === 'AFTER-RESUME')).toEqual({ f: 1, m: snapshot(1, 'AFTER-RESUME') });
    expect(logs.some((line) => line.includes('"event":"resume"') && line.includes('"result":"ok"'))).toBe(true);
    // Never logged.
    expect(logs.join('\n')).not.toContain(token);
    expect(logs.join('\n')).not.toContain(next);
  });

  it('a wrong token is refused 4012 and counted per IP: past the limit even the right token is refused, though hellos still work', async () => {
    await start({ failurePolicy: { maxFailures: 2, windowMs: 60_000, blockMs: 600_000, maxTrackedIps: 100 } });
    const room = await createRoom();
    const bob = await joinAndAdmit(room, 'Bob');
    const token = tokenOf(bob.guest);
    bob.guest.ws.terminate();
    await room.host.next(isOp('away', bob.slot));
    for (const wrong of ['W'.repeat(22), token.slice(0, 21) + (token.endsWith('A') ? 'B' : 'A')]) {
      const attempt = await resumeWith(wrong, 1);
      expect((await attempt.closed).code).toBe(SERVER_CLOSE.resumeRefused);
      expect(attempt.frames.map((frame) => frame.op)).toEqual(['ready']);
    }
    // Blocked: the right token gets the same answer, and the member is still away.
    const blocked = await resumeWith(token, 1);
    expect((await blocked.closed).code).toBe(SERVER_CLOSE.resumeRefused);
    expect(blocked.frames.map((frame) => frame.op)).toEqual(['ready']);
    // The access code's own count is apart: a right code still gets ready, and does not lift the block.
    await ready();
    const stillBlocked = await resumeWith(token, 1);
    expect((await stillBlocked.closed).code).toBe(SERVER_CLOSE.resumeRefused);
    expect(room.host.frames.some((frame) => frame.op === 'back' || frame.op === 'memberLeft')).toBe(false);
    expect(logs.some((line) => line.includes('"event":"resume"') && line.includes('"result":"blocked"'))).toBe(true);
    expect(logs.join('\n')).not.toContain(token);
  });

  it('a resume while the old socket still counts as connected is told 4013; the dead socket fails its probe, so the next try resumes', async () => {
    await start({ probeTimeoutMs: 150 });
    const room = await createRoom();
    // A half-open connection: the old socket is there but answers no ping.
    const bob = await joinAndAdmit(room, 'Bob', undefined, { autoPong: false });
    const token = tokenOf(bob.guest);
    const early = await resumeWith(token, 1);
    expect((await early.closed).code).toBe(SERVER_CLOSE.resumeLater);
    await room.host.next(isOp('away', bob.slot));
    expect((await bob.guest.closed).code).toBe(1006);
    const again = await resumeWith(token, 1);
    await again.op('resumed');
    await room.host.next(isOp('back', bob.slot));
  });

  it('a socket that answers the probe stays, and the early resume changes nothing', async () => {
    await start({ probeTimeoutMs: 100 });
    const room = await createRoom();
    const bob = await joinAndAdmit(room, 'Bob');
    const early = await resumeWith(tokenOf(bob.guest), 1);
    expect((await early.closed).code).toBe(SERVER_CLOSE.resumeLater);
    await new Promise((done) => setTimeout(done, 300));
    expect(bob.guest.ws.readyState).toBe(WebSocket.OPEN);
    expect(room.host.frames.some((frame) => frame.op === 'away')).toBe(false);
    room.host.send({ m: shot(0, 7) });
    await bob.guest.next((frame) => 'm' in frame && (frame.m as NetworkMessage).type === 'fireEvent');
  });

  it('a resumed guest is still held to the 64 KiB guest frame cap', async () => {
    await start();
    const room = await createRoom();
    const bob = await joinAndAdmit(room, 'Bob');
    const token = tokenOf(bob.guest);
    bob.guest.ws.terminate();
    await room.host.next(isOp('away', bob.slot));
    const again = await resumeWith(token, 1);
    await again.op('resumed');
    again.send(JSON.stringify({ m: { ...snapshot(1), pad: 'x'.repeat(SERVER_FRAME_MAX_BYTES) } }));
    expect((await again.closed).code).toBe(1009);
    expect(await room.host.next(isOp('memberLeft', bob.slot))).toMatchObject({ op: 'memberLeft' });
  });

  it('leave, a kick and a chosen close (1000) never leave a member away: its token is refused', async () => {
    await start();
    const room = await createRoom();
    const bob = await joinAndAdmit(room, 'Bob');
    const cara = await joinAndAdmit(room, 'Cara');
    const dan = await joinAndAdmit(room, 'Dan');
    bob.guest.send({ op: 'leave' });
    room.host.send({ op: 'kick', slot: cara.slot });
    expect((await cara.guest.closed).code).toBe(SERVER_CLOSE.kicked);
    dan.guest.ws.close(1000);
    for (const guest of [bob, cara, dan]) await room.host.next(isOp('memberLeft', guest.slot));
    for (const guest of [bob, cara, dan]) {
      const attempt = await resumeWith(tokenOf(guest.guest), 1);
      expect((await attempt.closed).code).toBe(SERVER_CLOSE.resumeRefused);
    }
    expect(room.host.frames.some((frame) => frame.op === 'away')).toBe(false);
  });
});

describe('relay shell: liveness and shutdown', () => {
  it('a socket that answers no protocol ping is ended after the timeout', async () => {
    await start({ heartbeatIntervalMs: 40, heartbeatTimeoutMs: 150 });
    const silent = await connect({ autoPong: false });
    silent.send(hello());
    await silent.op('ready');
    const answering = await ready();
    const { code } = await silent.closed;
    expect(code).toBe(1006);
    expect(answering.ws.readyState).toBe(WebSocket.OPEN);
    expect(logs.some((line) => line.includes('"event":"heartbeatTimeout"'))).toBe(true);
  });

  it('shutdown tells every room shutdown (4004), closes the rest with 1001 and stops listening', async () => {
    await start();
    const room = await createRoom();
    const bob = await joinAndAdmit(room, 'Bob');
    const idle = await ready();
    await relay.shutdown();
    expect(await room.host.op('roomClosed')).toEqual({ op: 'roomClosed', reason: 'shutdown' });
    expect(await bob.guest.op('roomClosed')).toEqual({ op: 'roomClosed', reason: 'shutdown' });
    expect((await room.host.closed).code).toBe(SERVER_CLOSE.roomClosed);
    expect((await idle.closed).code).toBe(1001);
    await expect(fetch(`http://127.0.0.1:${relay.port}/healthz`)).rejects.toThrow();
  });
});

describe('relay process: node server/main.ts', () => {
  const freePort = (): Promise<number> =>
    new Promise((done) => {
      const probe = createServer();
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => done(port));
      });
    });

  const run = (env: Record<string, string>) =>
    spawn(process.execPath, ['server/main.ts'], { cwd: repoRoot, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

  it('refuses to start without HNG_ACCESS_CODES, saying why', async () => {
    const child = run({});
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const code = await new Promise((done) => child.on('exit', done));
    expect(code).toBe(1);
    expect(stderr).toContain('HNG_ACCESS_CODES is required');
  });

  it('starts as the entry point and answers /healthz', async () => {
    const port = await freePort();
    const child = run({ HNG_ACCESS_CODES: CODE, HNG_PORT: String(port) });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    try {
      await waitFor(() => stdout.includes('"event":"listening"'), 8000);
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(await response.json()).toMatchObject({ ok: true, version: GAME_VERSION, rooms: 0, members: 0 });
      expect(stdout).not.toContain(CODE);
    } finally {
      child.kill();
    }
  }, 15_000);
});
