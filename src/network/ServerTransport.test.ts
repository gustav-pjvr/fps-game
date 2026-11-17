import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_VERSION } from '../core/version.ts';
import { CLIENT_FEATURES, type NetworkMessage, type PlayerSlot, type WelcomeMessage } from './protocol.ts';
import { HOST_FRAME_MAX_BYTES, RESUME_BUFFER_MAX_FRAMES, RESUME_WINDOW_MS, SERVER_CLOSE, SERVER_FRAME_MAX_BYTES, SERVER_PROTOCOL_VERSION } from './serverEnvelope.ts';
import {
  ACCESS_DENIED_MESSAGE,
  ACK_EVERY_FRAMES,
  CONNECT_ATTEMPT_TIMEOUT_MS,
  connectRetryDelay,
  parseServerFrame,
  RESUME_ABANDON_CLOSE,
  resumeRetryDelay,
  ROOM_NOT_FOUND_MESSAGE,
  RttEstimator,
  SERVER_BUSY_MESSAGE,
  SERVER_LOST_MESSAGE,
  SERVER_ROOM_CLOSED_MESSAGE,
  SERVER_UNREACHABLE_MESSAGE,
  ServerTransport,
  VERSION_MISMATCH_MESSAGE,
  type ServerConnectOptions,
  type SocketLike,
} from './ServerTransport.ts';
import type { HostHelloRequest, HostHelloResult, TransportCallbacks } from './transport.ts';

/**
 * ServerTransport against a fake WebSocket on a fake clock: the handshake, every server op and close
 * code turned into TransportCallbacks (design sections 4.2, 5.2 and 5.6), the inbound checks, the
 * connect retries and the silence rule, ping and quality (section 6.1), resume (section 5.6), the
 * callback handoff and dispose. The real relay end to end is in ServerTransport.relay.test.ts.
 */

type Frame = Record<string, unknown>;

class FakeSocket implements SocketLike {
  readonly url: string;
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: Frame[] = [];
  readonly raw: string[] = [];
  closedWith: number | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('not open');
    this.raw.push(data);
    this.sent.push(JSON.parse(data) as Frame);
  }

  /** The client closes: the close event follows with that code (synchronously here). */
  close(code?: number): void {
    if (this.readyState === 3) return;
    this.closedWith = code ?? 1005;
    this.readyState = 3;
    this.onclose?.({ code: this.closedWith, reason: '' });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  /** The server (or the network) closes the socket. */
  drop(code = 1006): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (code === 1006) this.onerror?.({});
    this.onclose?.({ code, reason: '' });
  }

  ops(name: string): Frame[] {
    return this.sent.filter((frame) => frame.op === name);
  }

  games(): Frame[] {
    return this.sent.filter((frame) => 'm' in frame);
  }
}

/** Callbacks that log every call as text, in order. */
function recorder(log: string[], hello?: (request: HostHelloRequest) => HostHelloResult | Promise<HostHelloResult>): TransportCallbacks & { hellos: HostHelloRequest[] } {
  const hellos: HostHelloRequest[] = [];
  return {
    hellos,
    onConnected: (slot) => log.push(`connected:${slot}`),
    onPeerDisconnected: (slot) => log.push(`disconnected:${slot}`),
    onError: (message, kind) => log.push(`error:${kind}:${message}`),
    onMessage: (message, slot) => log.push(`message:${slot}:${message.type}${message.type === 'roomFull' && message.reason ? `:${message.reason}` : ''}`),
    onReservationExpired: (slot) => log.push(`expired:${slot}`),
    onPeerAway: (slot) => log.push(`away:${slot}`),
    onPeerBack: (slot) => log.push(`back:${slot}`),
    onHostHello: (request) => {
      hellos.push(request);
      return hello ? hello(request) : welcomeFor(request.assigned && 'slot' in request.assigned ? request.assigned.slot : 1);
    },
  };
}

const welcomeFor = (slot: PlayerSlot, extra: Partial<WelcomeMessage> = {}): WelcomeMessage => ({
  type: 'welcome',
  yourSlot: slot,
  isRejoin: false,
  hostUsername: 'Host',
  roster: [{ slot: 0, username: 'Host' }, { slot, username: 'Bob' }],
  ...extra,
});

const snapshot = (senderSlot: PlayerSlot): NetworkMessage => ({ type: 'playerSnapshot', senderSlot, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100, t: 5 }) as NetworkMessage;
const ready = { op: 'ready', proto: SERVER_PROTOCOL_VERSION, serverTime: 1 };
const joinRequest = (slot: PlayerSlot, extra: Frame = {}): Frame => ({ op: 'joinRequest', slot, outcome: 'joined', username: 'Bob', rejoinToken: 'tok-bob', features: ['facility'], peerId: `srv-${slot}-1`, ...extra });

let sockets: FakeSocket[];
let log: string[];
let visible: boolean;
let random: number;

function options(extra: Partial<ServerConnectOptions> = {}): ServerConnectOptions {
  return {
    url: 'ws://relay.test/ws',
    accessCode: '  the-code  ',
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    now: () => Date.now(),
    random: () => random,
    isPageVisible: () => visible,
    ...extra,
  };
}

const last = (): FakeSocket => sockets[sockets.length - 1]!;
/** Let promise callbacks (onHostHello's answer) run. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

async function host(hello?: (request: HostHelloRequest) => HostHelloResult | Promise<HostHelloResult>) {
  const callbacks = recorder(log, hello);
  const pending = ServerTransport.hostRoom('Host', 4, options(), callbacks);
  const socket = last();
  socket.open();
  socket.receive(ready);
  socket.receive({ op: 'created', code: 'ABC234', slot: 0 });
  const transport = await pending;
  return { transport, socket, callbacks };
}

function guest(code = 'abc234') {
  const callbacks = recorder(log);
  const transport = ServerTransport.joinRoom(code, 'Bob', 'tok-bob', options(), callbacks);
  const socket = last();
  socket.open();
  socket.receive(ready);
  return { transport, socket, callbacks };
}

function welcomedGuest(slot: PlayerSlot = 1) {
  const result = guest();
  result.socket.receive({ f: 0, m: welcomeFor(slot) });
  log.length = 0;
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  log = [];
  visible = true;
  random = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ServerTransport: handshake', () => {
  it('host: hello first (trimmed code, build, features), create after ready, roomCode from created', async () => {
    const callbacks = recorder(log);
    const pending = ServerTransport.hostRoom('Host', 4, options(), callbacks);
    const socket = last();
    expect(socket.url).toBe('ws://relay.test/ws');
    expect(socket.sent).toEqual([]);
    socket.open();
    expect(socket.sent).toEqual([{ op: 'hello', proto: SERVER_PROTOCOL_VERSION, build: GAME_VERSION, access: 'the-code', features: [...CLIENT_FEATURES] }]);
    socket.receive(ready);
    expect(socket.sent[1]).toEqual({ op: 'create', username: 'Host', maxPlayers: 4 });
    socket.receive({ op: 'created', code: 'ABC234', slot: 0 });
    const transport = await pending;
    expect(transport.roomCode).toBe('ABC234');
    expect(transport.kind).toBe('server');
    expect([transport.ownRole(), transport.ownSlot(), transport.fastChannelReadyCount(), transport.directLinksReady()]).toEqual(['host', 0, 0, 0]);
    expect(log).toEqual([]);
  });

  it('guest: join after ready with the code uppercased; the welcome gives onConnected, then onMessage', () => {
    const { transport, socket } = guest(' abc234 ');
    expect(socket.sent.map((frame) => frame.op)).toEqual(['hello', 'join']);
    expect(socket.ops('join')[0]).toEqual({ op: 'join', code: 'ABC234', username: 'Bob', rejoinToken: 'tok-bob', features: [...CLIENT_FEATURES] });
    expect(transport.roomCode).toBe('ABC234');
    expect(transport.isConnectedTo(0)).toBe(false);
    socket.receive({ f: 0, m: welcomeFor(2) });
    expect(log).toEqual(['connected:2', 'message:0:welcome']);
    expect([transport.ownRole(), transport.ownSlot(), transport.isConnectedTo(0), transport.isConnectedTo(1)]).toEqual(['guest', 2, true, false]);
    // A second welcome is not a second admission.
    socket.receive({ f: 0, m: welcomeFor(3) });
    expect(transport.ownSlot()).toBe(2);
    expect(log).toHaveLength(2);
  });

  it('an empty access code fails at once without opening a socket', () => {
    ServerTransport.joinRoom('ABC234', 'Bob', null, options({ accessCode: '   ' }), recorder(log));
    expect(sockets).toHaveLength(0);
    expect(log).toEqual([`error:accessDenied:${ACCESS_DENIED_MESSAGE}`]);
  });

  it('a ready with another protocol version ends as versionMismatch', () => {
    ServerTransport.joinRoom('ABC234', 'Bob', null, options(), recorder(log));
    last().open();
    last().receive({ ...ready, proto: SERVER_PROTOCOL_VERSION + 1 });
    expect(log).toEqual([`error:versionMismatch:${VERSION_MISMATCH_MESSAGE}`]);
    expect(last().ops('join')).toEqual([]);
    expect(last().readyState).toBe(3);
  });
});

describe('ServerTransport: the host side of a join (section 4.2)', () => {
  it('joinRequest calls onHostHello with the server assignment, and a sync welcome becomes joinAnswer', async () => {
    const { socket, callbacks } = await host();
    socket.receive(joinRequest(2, { outcome: 'rejoined' }));
    expect(callbacks.hellos).toEqual([{ username: 'Bob', rejoinToken: 'tok-bob', features: ['facility'], peerId: 'srv-2-1', assigned: { outcome: 'rejoined', slot: 2 } }]);
    await flush();
    expect(socket.ops('joinAnswer')).toEqual([{ op: 'joinAnswer', slot: 2, welcome: welcomeFor(2) }]);
  });

  it('a Promise answer is sent once it resolves', async () => {
    let resolve!: (result: HostHelloResult) => void;
    const { socket } = await host(() => new Promise((done) => (resolve = done)));
    socket.receive(joinRequest(1));
    await flush();
    expect(socket.ops('joinAnswer')).toEqual([]);
    resolve(welcomeFor(1, { isRejoin: true }));
    await flush();
    expect(socket.ops('joinAnswer')).toEqual([{ op: 'joinAnswer', slot: 1, welcome: welcomeFor(1, { isRejoin: true }) }]);
  });

  it.each([
    ['full', () => 'full' as const, 'full'],
    ['outdated', () => 'outdated' as const, 'outdated'],
    ['a welcome for another slot', () => welcomeFor(3), 'full'],
    ['a throw', () => { throw new Error('boom'); }, 'full'],
    ['a rejected Promise', () => Promise.reject(new Error('boom')), 'full'],
  ])('%s is answered reject %s', async (_name, hello, reject) => {
    const { socket } = await host(hello as () => HostHelloResult);
    socket.receive(joinRequest(1));
    await flush();
    expect(socket.ops('joinAnswer')).toEqual([{ op: 'joinAnswer', slot: 1, reject }]);
  });

  it('no onHostHello at all is answered full', async () => {
    const { socket, transport } = await host();
    const { onHostHello: _unused, ...rest } = recorder(log);
    transport.setCallbacks(rest);
    socket.receive(joinRequest(1));
    await flush();
    expect(socket.ops('joinAnswer')).toEqual([{ op: 'joinAnswer', slot: 1, reject: 'full' }]);
  });

  it('admitted, memberLeft and expired map to onConnected, onPeerDisconnected and onReservationExpired', async () => {
    const { socket, transport } = await host();
    socket.receive({ op: 'admitted', slot: 1 });
    expect(transport.isConnectedTo(1)).toBe(true);
    socket.receive({ op: 'memberLeft', slot: 1 });
    expect(transport.isConnectedTo(1)).toBe(false);
    socket.receive({ op: 'expired', slot: 1 });
    expect(log).toEqual(['connected:1', 'disconnected:1', 'expired:1']);
  });

  it('a joiner gone while onHostHello resolves is reported after it resolves, and gets no answer', async () => {
    const resolvers: ((result: HostHelloResult) => void)[] = [];
    const { socket } = await host(() => new Promise((done) => resolvers.push(done)));
    socket.receive(joinRequest(1, { outcome: 'rejoined' }));
    socket.receive({ op: 'memberLeft', slot: 1 });
    socket.receive(joinRequest(2));
    socket.receive({ op: 'expired', slot: 2 });
    expect(log).toEqual([]);
    resolvers[0]!(welcomeFor(1));
    resolvers[1]!(welcomeFor(2));
    await flush();
    expect(log).toEqual(['disconnected:1', 'expired:2']);
    expect(socket.ops('joinAnswer')).toEqual([]);
  });

  it('the live holder of a slot leaving during a takeover is reported at once, and the takeover still answered', async () => {
    let resolve!: (result: HostHelloResult) => void;
    const { socket } = await host(() => new Promise((done) => (resolve = done)));
    socket.receive({ op: 'admitted', slot: 1 });
    socket.receive(joinRequest(1, { outcome: 'rejoined' }));
    socket.receive({ op: 'memberLeft', slot: 1 });
    expect(log).toEqual(['connected:1', 'disconnected:1']);
    resolve(welcomeFor(1, { isRejoin: true }));
    await flush();
    expect(socket.ops('joinAnswer')).toHaveLength(1);
  });

  it('a newer join for the same slot supersedes the older: only the newer is answered', async () => {
    const resolvers: ((result: HostHelloResult) => void)[] = [];
    const { socket } = await host(() => new Promise((done) => resolvers.push(done)));
    socket.receive(joinRequest(1, { outcome: 'rejoined', peerId: 'srv-1-1' }));
    socket.receive(joinRequest(1, { outcome: 'rejoined', peerId: 'srv-1-2' }));
    resolvers[0]!(welcomeFor(1, { hostUsername: 'old' }));
    await flush();
    expect(socket.ops('joinAnswer')).toEqual([]);
    resolvers[1]!(welcomeFor(1, { hostUsername: 'new' }));
    await flush();
    expect(socket.ops('joinAnswer')).toEqual([{ op: 'joinAnswer', slot: 1, welcome: welcomeFor(1, { hostUsername: 'new' }) }]);
  });

  it('host-only ops reaching a guest are ignored', () => {
    const { socket } = welcomedGuest();
    socket.receive(joinRequest(2));
    socket.receive({ op: 'admitted', slot: 2 });
    socket.receive({ op: 'memberLeft', slot: 2 });
    socket.receive({ op: 'expired', slot: 2 });
    expect(log).toEqual([]);
    expect(socket.ops('joinAnswer')).toEqual([]);
  });
});

describe('ServerTransport: rejected, roomClosed and close codes', () => {
  it('notFound is onError roomNotFound with the P2P wording, and the close adds nothing', () => {
    const { socket } = guest();
    socket.receive({ op: 'rejected', reason: 'notFound' });
    expect(log).toEqual([`error:roomNotFound:${ROOM_NOT_FOUND_MESSAGE}`]);
    expect(socket.closedWith).toBe(1000);
    socket.drop(1000);
    expect(log).toHaveLength(1);
  });

  it.each([
    ['full', 'message:0:roomFull'],
    ['outdated', 'message:0:roomFull:outdated'],
  ])('%s reads as the roomFull message, then the host closing the connection', (reason, message) => {
    const { socket } = guest();
    socket.receive({ op: 'rejected', reason });
    expect(log).toEqual([message, 'disconnected:0']);
  });

  it('busy is an other error, for a guest and for a refused create (whose promise still settles)', async () => {
    const { socket } = guest();
    socket.receive({ op: 'rejected', reason: 'busy' });
    expect(log).toEqual([`error:other:${SERVER_BUSY_MESSAGE}`]);

    log.length = 0;
    const pending = ServerTransport.hostRoom('Host', 4, options(), recorder(log));
    last().open();
    last().receive(ready);
    last().receive({ op: 'rejected', reason: 'busy' });
    const transport = await pending;
    expect(transport.roomCode).toBe('');
    expect(log).toEqual([`error:other:${SERVER_BUSY_MESSAGE}`]);
  });

  it('roomClosed on a guest is the host leaving, reported once despite the 4004 close', () => {
    const { socket } = welcomedGuest();
    socket.receive({ op: 'roomClosed', reason: 'hostLeft' });
    socket.drop(SERVER_CLOSE.roomClosed);
    expect(log).toEqual(['disconnected:0']);
  });

  it('roomClosed on the host is serverLost', async () => {
    const { socket } = await host();
    socket.receive({ op: 'roomClosed', reason: 'shutdown' });
    socket.drop(SERVER_CLOSE.roomClosed);
    expect(log).toEqual([`error:serverLost:${SERVER_ROOM_CLOSED_MESSAGE}`]);
  });

  it.each([
    [SERVER_CLOSE.accessDenied, `error:accessDenied:${ACCESS_DENIED_MESSAGE}`],
    [SERVER_CLOSE.versionMismatch, `error:versionMismatch:${VERSION_MISMATCH_MESSAGE}`],
    [1006, `error:serverLost:${SERVER_LOST_MESSAGE}`],
    [SERVER_CLOSE.rateLimited, `error:serverLost:${SERVER_LOST_MESSAGE}`],
    [SERVER_CLOSE.kicked, 'disconnected:0'],
    [SERVER_CLOSE.replaced, 'disconnected:0'],
  ])('a guest socket closed with %i reports %s', (code, expected) => {
    const { socket } = welcomedGuest();
    socket.drop(code);
    expect(log).toEqual([expected]);
  });

  it('an open socket refused at the hello (4001) is not retried', () => {
    ServerTransport.joinRoom('ABC234', 'Bob', null, options(), recorder(log));
    last().open();
    last().drop(SERVER_CLOSE.accessDenied);
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
    expect(log).toEqual([`error:accessDenied:${ACCESS_DENIED_MESSAGE}`]);
  });

  it('a host socket lost mid-room is serverLost', async () => {
    const { socket } = await host();
    socket.drop(1006);
    expect(log).toEqual([`error:serverLost:${SERVER_LOST_MESSAGE}`]);
  });
});

describe('ServerTransport: connect retries (section 5.6)', () => {
  it('retry delays are 0.5, 1 and 2 s plus up to 30 percent', () => {
    expect([0, 1, 2].map((retry) => connectRetryDelay(retry, () => 0))).toEqual([500, 1000, 2000]);
    expect([0, 1, 2].map((retry) => connectRetryDelay(retry, () => 0.999999))).toEqual([500, 1000, 2000].map((base) => expect.closeTo(base * 1.3, 2)));
    expect(connectRetryDelay(0, () => 5)).toBe(650);
    expect(connectRetryDelay(0, () => -1)).toBe(500);
  });

  it('four attempts at 0, 0.5, 1.5 and 3.5 s with no jitter, then "Couldn\'t reach the game server"', () => {
    ServerTransport.joinRoom('ABC234', 'Bob', null, options(), recorder(log));
    const startedAt = Date.now();
    const attemptsAt: number[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      while (sockets.length <= attempt) vi.advanceTimersByTime(1);
      attemptsAt.push(Date.now() - startedAt);
      expect(log).toEqual([]);
      last().drop(1006);
    }
    expect(attemptsAt).toEqual([0, 500, 1500, 3500]);
    expect(log).toEqual([`error:serverLost:${SERVER_UNREACHABLE_MESSAGE}`]);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(4);
  });

  it('full jitter stretches each wait to 1.3 times, never beyond', () => {
    random = 0.999999;
    ServerTransport.joinRoom('ABC234', 'Bob', null, options(), recorder(log));
    // The fake clock runs a fractional delay at its whole millisecond (649.9998 at 649).
    last().drop(1006);
    vi.advanceTimersByTime(648);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(sockets).toHaveLength(2);
    last().drop(1006);
    vi.advanceTimersByTime(1298);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(2);
    expect(sockets).toHaveLength(3);
  });

  it('an attempt that never opens times out and counts as a failure', () => {
    ServerTransport.joinRoom('ABC234', 'Bob', null, options(), recorder(log));
    vi.advanceTimersByTime(CONNECT_ATTEMPT_TIMEOUT_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets[0]!.onclose).toBeNull();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    // A late event from the abandoned socket is ignored.
    sockets[0]!.onopen?.({});
    expect(sockets[1]!.sent).toEqual([]);
  });

  it('a later attempt that opens carries on as normal', () => {
    ServerTransport.joinRoom('ABC234', 'Bob', null, options(), recorder(log));
    last().drop(1006);
    vi.advanceTimersByTime(500);
    last().drop(1006);
    vi.advanceTimersByTime(1000);
    last().open();
    last().receive(ready);
    expect(last().sent.map((frame) => frame.op)).toEqual(['hello', 'join']);
    expect(log).toEqual([]);
  });
});

describe('ServerTransport: the silence rule (section 5.5)', () => {
  it('no frame for 6 s while visible is serverLost', () => {
    const { socket } = welcomedGuest();
    vi.advanceTimersByTime(5999);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(log).toEqual([`error:serverLost:${SERVER_LOST_MESSAGE}`]);
    expect(socket.closedWith).toBe(1000);
  });

  it('any frame, a pong included, restarts the count', () => {
    const { socket } = welcomedGuest();
    for (let second = 0; second < 20; second++) {
      vi.advanceTimersByTime(1000);
      const ping = socket.ops('ping').at(-1)!;
      socket.receive({ op: 'pong', n: ping.n, t: ping.t });
    }
    expect(log).toEqual([]);
  });

  it('time hidden does not count; the count starts again once visible', () => {
    welcomedGuest();
    visible = false;
    vi.advanceTimersByTime(30_000);
    expect(log).toEqual([]);
    visible = true;
    vi.advanceTimersByTime(6000);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual([`error:serverLost:${SERVER_LOST_MESSAGE}`]);
  });

  it('runs in Node with no document at all (visible by default)', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
    const transport = ServerTransport.joinRoom('ABC234', 'Bob', null, options({ isPageVisible: undefined }), recorder(log));
    last().open();
    vi.advanceTimersByTime(6000);
    expect(log).toEqual([`error:serverLost:${SERVER_LOST_MESSAGE}`]);
    transport.dispose();
  });
});

describe('ServerTransport: inbound game frames', () => {
  it('drops what fails isNetworkMessage, malformed JSON, and unknown ops', async () => {
    const { socket } = await host();
    socket.receive({ f: 1, m: { type: 'playerSnapshot', senderSlot: 1 } });
    socket.receive({ f: 1, m: { type: 'noSuchType' } });
    socket.receive('{not json');
    socket.receive({ op: 'mystery' });
    socket.receive({ f: 9, m: snapshot(1) });
    expect(log).toEqual([]);
  });

  it('host: passes a guest message on with its true sender, and drops one acceptsFromSender refuses', async () => {
    const { socket } = await host();
    socket.receive({ f: 1, m: snapshot(1) });
    socket.receive({ f: 1, m: snapshot(2) });
    socket.receive({ f: 2, m: { type: 'matchStart', seed: 1 } });
    socket.receive({ f: 0, m: snapshot(0) });
    expect(log).toEqual(['message:1:playerSnapshot']);
  });

  it('guest: a host-authored type is taken only from slot 0', () => {
    const { socket } = welcomedGuest(1);
    const rosterUpdate = { type: 'rosterUpdate', roster: [{ slot: 0, username: 'Host' }] };
    socket.receive({ f: 2, m: rosterUpdate });
    socket.receive({ f: 0, m: rosterUpdate });
    expect(log).toEqual(['message:0:rosterUpdate']);
  });

  it('guest: another guest\'s message keeps its real sender; a spoofed or self-addressed one is dropped', () => {
    const { socket } = welcomedGuest(1);
    socket.receive({ f: 2, m: snapshot(2) });
    socket.receive({ f: 2, m: snapshot(3) });
    socket.receive({ f: 1, m: snapshot(1) });
    expect(log).toEqual(['message:2:playerSnapshot']);
  });

  it('drops P2P mesh types and handshake types even from the host', () => {
    const { socket } = welcomedGuest(1);
    socket.receive({ f: 0, m: { type: 'linkQuality', links: [] } });
    socket.receive({ f: 0, m: { type: 'roomFull' } });
    socket.receive({ f: 0, m: { type: 'hello', username: 'x', rejoinToken: null } });
    expect(log).toEqual([]);
  });

  it('ignores game frames before the handshake', () => {
    ServerTransport.joinRoom('ABC234', 'Bob', null, options(), recorder(log));
    last().open();
    last().receive({ f: 0, m: welcomeFor(1) });
    expect(log).toEqual([]);
  });
});

describe('ServerTransport: outbound', () => {
  it('host: send is a game frame, sendTo adds `to` for an admitted guest only, relay sends nothing', async () => {
    const { socket, transport } = await host();
    socket.receive({ op: 'admitted', slot: 1 });
    transport.send(snapshot(0));
    transport.sendTo(1, { type: 'scoreboardSync', scores: [] } as unknown as NetworkMessage);
    transport.sendTo(2, snapshot(0));
    transport.relay(snapshot(1), 1);
    expect(socket.games()).toEqual([{ m: snapshot(0) }, { m: { type: 'scoreboardSync', scores: [] }, to: 1 }]);
  });

  it('guest: sendTo the host is a plain game frame; to anyone else nothing', () => {
    const { socket, transport } = welcomedGuest(1);
    transport.sendTo(0, snapshot(1));
    transport.sendTo(2, snapshot(1));
    expect(socket.games()).toEqual([{ m: snapshot(1) }]);
  });

  it('disconnectGuest sends kick, and the memberLeft that follows is not reported again', async () => {
    const { socket, transport } = await host();
    socket.receive({ op: 'admitted', slot: 2 });
    log.length = 0;
    transport.disconnectGuest(2);
    expect(socket.ops('kick')).toEqual([{ op: 'kick', slot: 2 }]);
    expect(transport.isConnectedTo(2)).toBe(false);
    socket.receive({ op: 'memberLeft', slot: 2 });
    expect(log).toEqual([]);
    // Kicking someone not admitted does nothing; a later join to the slot is reported as usual.
    transport.disconnectGuest(3);
    expect(socket.ops('kick')).toHaveLength(1);
    socket.receive({ op: 'admitted', slot: 2 });
    socket.receive({ op: 'memberLeft', slot: 2 });
    expect(log).toEqual(['connected:2', 'disconnected:2']);
  });

  it('drops a frame over its sender\'s cap instead of being closed for it', async () => {
    const guestSide = welcomedGuest(1);
    const big = { ...snapshot(1), pad: 'x'.repeat(SERVER_FRAME_MAX_BYTES) } as unknown as NetworkMessage;
    guestSide.transport.send(big);
    expect(guestSide.socket.games()).toEqual([]);
    // Multi-byte text is counted in UTF-8 bytes, as the server counts it.
    guestSide.transport.send({ ...snapshot(1), pad: String.fromCharCode(0xe9).repeat(SERVER_FRAME_MAX_BYTES / 2) } as unknown as NetworkMessage);
    expect(guestSide.socket.games()).toEqual([]);

    const hostSide = await host();
    hostSide.transport.send(big);
    expect(hostSide.socket.games()).toHaveLength(1);
    hostSide.transport.send({ ...snapshot(0), pad: 'x'.repeat(HOST_FRAME_MAX_BYTES) } as unknown as NetworkMessage);
    expect(hostSide.socket.games()).toHaveLength(1);
  });
});

describe('ServerTransport: ping and quality (section 6.1)', () => {
  it('RttEstimator: weighted average (alpha 0.2) with mean absolute deviation as jitter', () => {
    const rtt = new RttEstimator();
    expect([rtt.rttMs, rtt.jitterMs]).toEqual([null, null]);
    rtt.add(40);
    expect([rtt.rttMs, rtt.jitterMs]).toEqual([40, 0]);
    rtt.add(60); // deviation 0.2 * 20 = 4, average 40 + 4 = 44
    expect([rtt.rttMs, rtt.jitterMs]).toEqual([44, 4]);
    rtt.add(44); // deviation 4 + 0.2 * (0 - 4) = 3.2, average stays 44
    expect([rtt.rttMs, rtt.jitterMs]).toEqual([44, 3]);
    rtt.add(-5);
    rtt.add(Number.NaN);
    expect([rtt.rttMs, rtt.jitterMs]).toEqual([44, 3]);
  });

  it('pings every second with the last smoothed round trip, measured on its own clock', () => {
    const { socket, transport } = welcomedGuest(1);
    vi.advanceTimersByTime(1000);
    const first = socket.ops('ping')[0]!;
    expect(first).toEqual({ op: 'ping', n: 1, t: Date.now(), rtt: null });
    vi.advanceTimersByTime(30);
    // The echoed t is not trusted: the round trip is from this client's own send time.
    socket.receive({ op: 'pong', n: 1, t: 0 });
    expect(transport.serverRtt()).toEqual({ rttMs: 30, jitterMs: 0 });
    // A pong for a ping never sent, or a repeat, changes nothing.
    socket.receive({ op: 'pong', n: 1, t: 0 });
    socket.receive({ op: 'pong', n: 99, t: 0 });
    expect(transport.serverRtt()).toEqual({ rttMs: 30, jitterMs: 0 });
    vi.advanceTimersByTime(970);
    expect(socket.ops('ping')[1]).toMatchObject({ n: 2, rtt: 30 });
  });

  it('connectionQuality sums its own round trip and each other member\'s, route server, itself excluded', async () => {
    const { socket, transport } = welcomedGuest(1);
    expect(await transport.connectionQuality()).toEqual(new Map());
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(30);
    socket.receive({ op: 'pong', n: 1, t: 0 });
    socket.receive({ op: 'quality', members: [{ slot: 0, rttMs: 20 }, { slot: 1, rttMs: 30 }, { slot: 2, rttMs: null }] });
    expect(await transport.connectionQuality()).toEqual(new Map([
      [0, { rttMs: 50, route: 'server' }],
      [2, { rttMs: null, route: 'server' }],
    ]));
  });

  it('before its own first pong every opponent is unknown, but still on the server route', async () => {
    const { socket, transport } = await host();
    socket.receive({ op: 'quality', members: [{ slot: 0, rttMs: null }, { slot: 1, rttMs: 12 }] });
    expect(await transport.connectionQuality()).toEqual(new Map([[1, { rttMs: null, route: 'server' }]]));
  });

  it('a malformed quality op is ignored, and reported values are clamped', async () => {
    const { socket, transport } = await host();
    vi.advanceTimersByTime(1000);
    socket.receive({ op: 'pong', n: 1, t: 0 });
    socket.receive({ op: 'quality', members: [{ slot: 1, rttMs: 10 }] });
    socket.receive({ op: 'quality', members: [{ slot: 7, rttMs: 10 }] });
    socket.receive({ op: 'quality', members: 'none' });
    expect(await transport.connectionQuality()).toEqual(new Map([[1, { rttMs: 10, route: 'server' }]]));
    socket.receive({ op: 'quality', members: [{ slot: 1, rttMs: 1e9 }, { slot: 2, rttMs: -4 }] });
    expect(await transport.connectionQuality()).toEqual(new Map([[1, { rttMs: 5000, route: 'server' }], [2, { rttMs: 0, route: 'server' }]]));
  });
});

describe('ServerTransport: resume (section 5.6)', () => {
  const TOKEN = 'A'.repeat(21) + '1';
  const NEXT_TOKEN = 'B'.repeat(21) + '2';
  const rosterUpdate = { type: 'rosterUpdate', roster: [{ slot: 0, username: 'Host' }] };
  const readyUpdate = { type: 'lobbyReadyUpdate', readySlots: [0] };
  const shot = { type: 'fireEvent', senderSlot: 0, originX: 0, originY: 1, originZ: 0, endX: 5, endY: 1, endZ: 5, weaponId: 'rifle', t: 9 } as NetworkMessage;

  /** A guest in a room, with a session token: its welcome is numbered frame 1. */
  function resumableGuest(slot: PlayerSlot = 1) {
    const transport = ServerTransport.joinRoom('ABC234', 'Bob', 'tok-bob', options(), recorder(log));
    const socket = last();
    socket.open();
    socket.receive({ ...ready, sessionToken: TOKEN });
    socket.receive({ s: 1, f: 0, m: welcomeFor(slot) });
    log.length = 0;
    return { transport, socket };
  }

  async function resumableHost() {
    const pending = ServerTransport.hostRoom('Host', 4, options(), recorder(log));
    const socket = last();
    socket.open();
    socket.receive({ ...ready, sessionToken: TOKEN });
    socket.receive({ op: 'created', code: 'ABC234', slot: 0 });
    return { transport: await pending, socket };
  }

  /** The newest attempt opens and the server answers its hello. */
  function openAttempt(): FakeSocket {
    const socket = last();
    socket.open();
    socket.receive({ ...ready, sessionToken: 'C'.repeat(22) });
    return socket;
  }

  it('resumeRetryDelay: 250 ms doubling to 4 s; jitter only shortens a wait, by at most 30 percent', () => {
    expect([0, 1, 2, 3, 4, 5, 12].map((attempt) => resumeRetryDelay(attempt, () => 0))).toEqual([250, 500, 1000, 2000, 4000, 4000, 4000]);
    for (let attempt = 0; attempt < 8; attempt++) {
      const base = Math.min(4000, 250 * 2 ** attempt);
      const jittered = resumeRetryDelay(attempt, () => 0.999999);
      expect(jittered).toBeGreaterThanOrEqual(base * 0.7);
      expect(jittered).toBeLessThan(base);
    }
    expect(resumeRetryDelay(0, () => 5)).toBe(175);
    expect(resumeRetryDelay(0, () => -1)).toBe(250);
  });

  it('a guest whose socket drops mid-room resumes: 250 ms later hello, then resume with its token and last frame; the game hears nothing', () => {
    const { transport, socket } = resumableGuest();
    socket.receive({ s: 2, f: 0, m: rosterUpdate });
    log.length = 0;
    socket.drop(1006);
    expect(log).toEqual([]);
    expect(transport.isReconnecting()).toBe(true);
    // The game keeps counting the host as connected (Game.start checks it).
    expect(transport.isConnectedTo(0)).toBe(true);
    vi.advanceTimersByTime(249);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    const attempt = openAttempt();
    expect(attempt.sent).toEqual([
      { op: 'hello', proto: SERVER_PROTOCOL_VERSION, build: GAME_VERSION, access: 'the-code', features: [...CLIENT_FEATURES] },
      { op: 'resume', sessionToken: TOKEN, lastSeq: 2 },
    ]);
    attempt.receive({ op: 'resumed', sessionToken: NEXT_TOKEN });
    expect(transport.isReconnecting()).toBe(false);
    attempt.receive({ s: 3, f: 0, m: readyUpdate });
    expect(log).toEqual(['message:0:lobbyReadyUpdate']);

    // The next drop comes back with the rotated token.
    attempt.drop(1006);
    vi.advanceTimersByTime(250);
    expect(openAttempt().ops('resume')).toEqual([{ op: 'resume', sessionToken: NEXT_TOKEN, lastSeq: 3 }]);
    expect(log).toEqual(['message:0:lobbyReadyUpdate']);
  });

  it('failed attempts back off 250 ms doubling to 4 s, and jitter keeps each wait inside its bounds', () => {
    const { socket } = resumableGuest();
    const startedAt = Date.now();
    socket.drop(1006);
    const attemptsAt: number[] = [];
    for (let attempt = 1; attempt <= 7; attempt++) {
      while (sockets.length <= attempt) vi.advanceTimersByTime(1);
      attemptsAt.push(Date.now() - startedAt);
      last().drop(1006);
    }
    expect(attemptsAt).toEqual([250, 750, 1750, 3750, 7750, 11750, 15750]);
    expect(log).toEqual([]);

    random = 0.999999;
    const second = resumableGuest();
    second.socket.drop(1006);
    const count = sockets.length;
    // The fake clock runs a fractional delay at its whole millisecond (175.00008 at 175).
    vi.advanceTimersByTime(174);
    expect(sockets).toHaveLength(count);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(count + 1);
    last().drop(1006);
    vi.advanceTimersByTime(349);
    expect(sockets).toHaveLength(count + 1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(count + 2);
  });

  it('silence mid-room starts a resume, the silence rule is off while reconnecting, and only after 30 s is the server lost', () => {
    const { socket, transport } = resumableGuest();
    vi.advanceTimersByTime(6000);
    expect(log).toEqual([]);
    expect(socket.closedWith).toBe(RESUME_ABANDON_CLOSE);
    expect(transport.isReconnecting()).toBe(true);
    // Attempts that never open time out and are retried; nothing is reported meanwhile.
    vi.advanceTimersByTime(RESUME_WINDOW_MS - 1);
    expect(log).toEqual([]);
    expect(sockets.length).toBeGreaterThan(4);
    vi.advanceTimersByTime(1);
    expect(log).toEqual([`error:serverLost:${SERVER_LOST_MESSAGE}`]);
    const count = sockets.length;
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a host gives up at 30 s with serverLost too, even when its attempts open but are never answered', async () => {
    const { socket } = await resumableHost();
    socket.drop(1006);
    const startedAt = Date.now();
    while (Date.now() - startedAt < RESUME_WINDOW_MS - 1) {
      const count = sockets.length;
      vi.advanceTimersByTime(1);
      if (sockets.length > count) last().open();
    }
    expect(log).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(log).toEqual([`error:serverLost:${SERVER_LOST_MESSAGE}`]);
    // Every attempt sent its hello and was let go after its own 4 s.
    expect(sockets.slice(1).every((attempt) => attempt.ops('hello').length === 1)).toBe(true);
  });

  it('drops numbered frames it already processed, live and in a replay; unnumbered frames are never duplicates', () => {
    const { socket } = resumableGuest();
    socket.receive({ s: 2, f: 0, m: rosterUpdate });
    socket.receive({ s: 2, f: 0, m: rosterUpdate });
    socket.receive({ s: 1, f: 0, m: rosterUpdate });
    expect(log).toEqual(['message:0:rosterUpdate']);
    socket.drop(1006);
    vi.advanceTimersByTime(250);
    const attempt = openAttempt();
    expect(attempt.ops('resume')[0]).toMatchObject({ lastSeq: 2 });
    attempt.receive({ op: 'resumed', sessionToken: NEXT_TOKEN });
    for (const s of [2, 3, 3, 4]) attempt.receive({ s, f: 0, m: readyUpdate });
    expect(log).toEqual(['message:0:rosterUpdate', 'message:0:lobbyReadyUpdate', 'message:0:lobbyReadyUpdate']);
    attempt.receive({ f: 2, m: snapshot(2) });
    attempt.receive({ f: 2, m: snapshot(2) });
    expect(log.filter((entry) => entry === 'message:2:playerSnapshot')).toHaveLength(2);
  });

  it('acknowledges every 64 numbered frames, and once a second when anything new arrived', () => {
    const { socket } = resumableGuest();
    for (let s = 2; s < ACK_EVERY_FRAMES; s++) socket.receive({ s, f: 0, m: readyUpdate });
    expect(socket.ops('ack')).toEqual([]);
    socket.receive({ s: ACK_EVERY_FRAMES, f: 0, m: readyUpdate });
    expect(socket.ops('ack')).toEqual([{ op: 'ack', seq: ACK_EVERY_FRAMES }]);
    socket.receive({ s: ACK_EVERY_FRAMES + 1, f: 0, m: readyUpdate });
    vi.advanceTimersByTime(1000);
    expect(socket.ops('ack')).toEqual([{ op: 'ack', seq: ACK_EVERY_FRAMES }, { op: 'ack', seq: ACK_EVERY_FRAMES + 1 }]);
    vi.advanceTimersByTime(1000);
    expect(socket.ops('ack')).toHaveLength(2);
  });

  it.each([
    [SERVER_CLOSE.normal, `error:serverLost:${SERVER_LOST_MESSAGE}`],
    [SERVER_CLOSE.accessDenied, `error:accessDenied:${ACCESS_DENIED_MESSAGE}`],
    [SERVER_CLOSE.versionMismatch, `error:versionMismatch:${VERSION_MISMATCH_MESSAGE}`],
    [SERVER_CLOSE.roomClosed, 'disconnected:0'],
    [SERVER_CLOSE.rateLimited, `error:serverLost:${SERVER_LOST_MESSAGE}`],
    [SERVER_CLOSE.kicked, 'disconnected:0'],
    [SERVER_CLOSE.replaced, 'disconnected:0'],
    [SERVER_CLOSE.resumeRefused, `error:serverLost:${SERVER_LOST_MESSAGE}`],
  ])('a final close (%i) never starts a resume and reports %s', (code, expected) => {
    const { socket } = resumableGuest();
    socket.drop(code);
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
    expect(log).toEqual([expected]);
  });

  it('a host before created, or a guest before its welcome, has no room to resume', async () => {
    ServerTransport.joinRoom('ABC234', 'Bob', 'tok-bob', options(), recorder(log));
    last().open();
    last().receive({ ...ready, sessionToken: TOKEN });
    last().drop(1006);
    expect(log).toEqual([`error:serverLost:${SERVER_LOST_MESSAGE}`]);
    log.length = 0;
    const pending = ServerTransport.hostRoom('Host', 4, options(), recorder(log));
    last().open();
    last().receive({ ...ready, sessionToken: TOKEN });
    last().drop(1006);
    await pending;
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(2);
    expect(log).toEqual([`error:serverLost:${SERVER_LOST_MESSAGE}`]);
  });

  it('a refused resume (4012) gives up at once; resumeLater (4013) tries again', () => {
    const { socket } = resumableGuest();
    socket.drop(1006);
    vi.advanceTimersByTime(250);
    openAttempt().drop(SERVER_CLOSE.resumeLater);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(3);
    openAttempt().drop(SERVER_CLOSE.resumeRefused);
    expect(log).toEqual([`error:serverLost:${SERVER_LOST_MESSAGE}`]);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('frames sent while reconnecting are queued (superseded state is not) and go out in order after resumed', async () => {
    const { transport, socket } = await resumableHost();
    socket.receive({ s: 1, op: 'admitted', slot: 1 });
    log.length = 0;
    socket.drop(1006);
    expect(transport.isReconnecting()).toBe(true);
    transport.send(shot);
    transport.send(snapshot(0));
    transport.send({ type: 'gooseSnapshot', id: 'g1', x: 0, y: 0, z: 0 } as NetworkMessage);
    transport.sendTo(1, rosterUpdate as NetworkMessage);
    transport.disconnectGuest(1);
    vi.advanceTimersByTime(250);
    const attempt = openAttempt();
    expect(attempt.sent.map((frame) => frame.op)).toEqual(['hello', 'resume']);
    attempt.receive({ op: 'resumed', sessionToken: NEXT_TOKEN });
    expect(attempt.sent.slice(2)).toEqual([{ m: shot }, { m: rosterUpdate, to: 1 }, { op: 'kick', slot: 1 }]);
    // Pings, and with them the silence rule, run again.
    vi.advanceTimersByTime(1000);
    expect(attempt.ops('ping')).toHaveLength(1);
    expect(log).toEqual([]);
  });

  it('a queue past the resume buffer\'s bound gives up, as the server would', async () => {
    const { transport, socket } = await resumableHost();
    socket.drop(1006);
    for (let i = 0; i <= RESUME_BUFFER_MAX_FRAMES; i++) transport.send(shot);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(log).toEqual([`error:serverLost:${SERVER_LOST_MESSAGE}`]);
  });

  it('away and back reach onPeerAway and onPeerBack, the host\'s own slot never', async () => {
    const { socket } = await resumableHost();
    socket.receive({ s: 1, op: 'away', slot: 2 });
    socket.receive({ s: 2, op: 'back', slot: 2 });
    socket.receive({ s: 3, op: 'away', slot: 0 });
    expect(log).toEqual(['away:2', 'back:2']);
    log.length = 0;
    const guestSide = resumableGuest();
    guestSide.socket.receive({ s: 2, op: 'away', slot: 0 });
    guestSide.socket.receive({ s: 3, op: 'back', slot: 0 });
    expect(log).toEqual(['away:0', 'back:0']);
  });

  it('dispose while reconnecting: no further attempt, no report, no timers', () => {
    const { socket, transport } = resumableGuest();
    socket.drop(1006);
    transport.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(log).toEqual([]);
    expect(transport.isConnectedTo(0)).toBe(false);
  });
});

describe('ServerTransport: setCallbacks and dispose', () => {
  it('setCallbacks is a full handoff: the old callbacks hear nothing more', async () => {
    const { socket, transport } = await host();
    const handedOff: string[] = [];
    transport.setCallbacks(recorder(handedOff));
    socket.receive({ op: 'admitted', slot: 1 });
    socket.receive({ f: 1, m: snapshot(1) });
    expect(log).toEqual([]);
    expect(handedOff).toEqual(['connected:1', 'message:1:playerSnapshot']);
  });

  it('dispose sends leave, closes 1000, stops its timers and reports nothing after', async () => {
    const { socket, transport } = welcomedGuest(1);
    transport.dispose();
    expect(socket.sent.at(-1)).toEqual({ op: 'leave' });
    expect(socket.closedWith).toBe(1000);
    expect(vi.getTimerCount()).toBe(0);
    socket.receive({ f: 0, m: snapshot(0) });
    socket.drop(1006);
    vi.advanceTimersByTime(20_000);
    expect(log).toEqual([]);
    expect(transport.isConnectedTo(0)).toBe(false);
    transport.send(snapshot(1));
    expect(socket.games()).toEqual([]);
  });

  it('dispose while waiting to retry: no further attempt, no error, no timers', () => {
    const transport = ServerTransport.joinRoom('ABC234', 'Bob', null, options(), recorder(log));
    last().drop(1006);
    transport.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(log).toEqual([]);
  });

  it('dispose before the socket opened detaches it, so its late events do nothing', () => {
    const transport = ServerTransport.joinRoom('ABC234', 'Bob', null, options(), recorder(log));
    const socket = last();
    transport.dispose();
    expect(socket.onopen).toBeNull();
    expect(socket.closedWith).toBe(1000);
    expect(log).toEqual([]);
  });

  it('the host promise also settles when the connect attempts run out', async () => {
    const pending = ServerTransport.hostRoom('Host', 4, options(), recorder(log));
    for (const wait of [500, 1000, 2000, 0]) {
      last().drop(1006);
      vi.advanceTimersByTime(wait);
    }
    const transport = await pending;
    expect(transport.roomCode).toBe('');
    expect(log).toEqual([`error:serverLost:${SERVER_UNREACHABLE_MESSAGE}`]);
  });
});

describe('parseServerFrame', () => {
  it('reads each op it knows and nothing else', () => {
    expect(parseServerFrame(JSON.stringify(ready))).toEqual(ready);
    expect(parseServerFrame(JSON.stringify({ op: 'created', code: 'ABC234', slot: 0, extra: 1 }))).toEqual({ op: 'created', code: 'ABC234', slot: 0 });
    expect(parseServerFrame(JSON.stringify(joinRequest(1)))).toEqual(joinRequest(1));
    for (const bad of [
      { op: 'joinRequest', slot: 0, outcome: 'joined', username: 'x', rejoinToken: null, peerId: 'p' },
      { ...joinRequest(1), outcome: 'full' },
      { ...joinRequest(1), username: 'x'.repeat(100) },
      { ...joinRequest(1), features: [1] },
      { op: 'admitted', slot: 0 },
      { op: 'memberLeft', slot: 4 },
      { op: 'rejected', reason: 'nope' },
      { op: 'pong', n: 1.5, t: 1 },
      { op: 'roomClosed', reason: 'x' },
      { op: 'created', code: '' },
      { f: 0, m: { type: 'nope' } },
      { f: '0', m: snapshot(0) },
      [1, 2],
    ]) {
      expect(parseServerFrame(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
    expect(parseServerFrame(42)).toBeNull();
  });

  it('reads the resume additions: a token in ready, resumed, away and back, and a sequence number', () => {
    const token = 'abcDEF012_-'.repeat(2);
    expect(parseServerFrame(JSON.stringify({ ...ready, sessionToken: token }))).toEqual({ ...ready, sessionToken: token });
    expect(parseServerFrame(JSON.stringify({ op: 'resumed', sessionToken: token }))).toEqual({ op: 'resumed', sessionToken: token });
    expect(parseServerFrame(JSON.stringify({ s: 7, op: 'away', slot: 0 }))).toEqual({ s: 7, op: 'away', slot: 0 });
    expect(parseServerFrame(JSON.stringify({ s: 8, op: 'back', slot: 3 }))).toEqual({ s: 8, op: 'back', slot: 3 });
    expect(parseServerFrame(JSON.stringify({ s: 9, f: 0, m: snapshot(0) }))).toEqual({ s: 9, f: 0, m: snapshot(0) });
    for (const bad of [
      { ...ready, sessionToken: 'short' },
      { ...ready, sessionToken: token.slice(0, 21) + '=' },
      { op: 'resumed', sessionToken: null },
      { op: 'away', slot: 4 },
      { op: 'back' },
      { s: 0, f: 0, m: snapshot(0) },
      { s: 1.5, op: 'away', slot: 1 },
      { s: '2', op: 'away', slot: 1 },
    ]) {
      expect(parseServerFrame(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });
});
