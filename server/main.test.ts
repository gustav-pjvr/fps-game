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
async function joinAndAdmit(room: Room, name: string, welcome?: (slot: PlayerSlot) => WelcomeMessage): Promise<{ guest: Client; slot: PlayerSlot }> {
  const guest = await ready();
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
    expect(await room.host.op('memberLeft')).toEqual({ op: 'memberLeft', slot: bob.slot });
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
