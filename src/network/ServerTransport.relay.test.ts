import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_SLOT, type NetworkMessage, type PlayerSlot, type WelcomeMessage } from './protocol.ts';
import { ROOM_NOT_FOUND_MESSAGE, type ServerConnectOptions, type SocketLike } from './ServerTransport.ts';
import { hostRoom, joinRoom, type HostHelloRequest, type Transport, type TransportCallbacks } from './transport.ts';

/**
 * Two (and three) ServerTransports against the real relay, started in-process on a random port as
 * server/main.test.ts does: create, join with the host answering through onHostHello, a
 * playerSnapshot crossing with its true sender, ping and quality from real pongs, a kick, an
 * unknown code, and the host leaving reaching the guest as onPeerDisconnected(HOST_SLOT).
 *
 * The relay runs on Node APIs this browser-side tsconfig has no types for, so it is loaded by path
 * at run time and typed below by the little this test uses. The client sockets are Node's own
 * WebSocket, which sends an Origin header only when given one; the relay keeps refusing a missing
 * Origin (server/config.ts, isOriginAllowed), so each socket names the allowed dev origin.
 */

interface RelayHandle {
  readonly port: number;
  shutdown(): Promise<void>;
}
type StartRelay = (config: unknown, options?: { logSink?: (line: string) => void }) => Promise<RelayHandle>;
type LoadConfig = (env: Record<string, string>) => object;

const RELAY_MAIN = '../../server/main.ts';
const RELAY_CONFIG = '../../server/config.ts';
const ORIGIN = 'http://localhost:5173';
const ACCESS = 'relay-transport-test-code';

/** Node's WebSocket takes a non-standard init with headers (undici); the DOM type does not know it. */
type NodeWebSocket = new (url: string, init: { headers: Record<string, string> }) => SocketLike;
const createSocket = (url: string): SocketLike => new (WebSocket as unknown as NodeWebSocket)(url, { headers: { origin: ORIGIN } });

let relay: RelayHandle;
let server: ServerConnectOptions;
const transports: Transport[] = [];

/** Callbacks that log every call; the host answers each hello with a welcome for the slot the
 * server assigned. */
function recorder(log: string[], received: { message: NetworkMessage; from: PlayerSlot }[] = []): TransportCallbacks & { hellos: HostHelloRequest[] } {
  const hellos: HostHelloRequest[] = [];
  return {
    hellos,
    onConnected: (slot) => log.push(`connected:${slot}`),
    onPeerDisconnected: (slot) => log.push(`disconnected:${slot}`),
    onError: (message, kind) => log.push(`error:${kind}:${message}`),
    onMessage: (message, from) => {
      log.push(`message:${from}:${message.type}`);
      received.push({ message, from });
    },
    onReservationExpired: (slot) => log.push(`expired:${slot}`),
    onHostHello: (request) => {
      hellos.push(request);
      const slot = request.assigned && 'slot' in request.assigned ? request.assigned.slot : 1;
      const welcome: WelcomeMessage = {
        type: 'welcome',
        yourSlot: slot,
        isRejoin: request.assigned?.outcome === 'rejoined',
        hostUsername: 'Host',
        roster: [{ slot: HOST_SLOT, username: 'Host' }, { slot, username: request.username }],
      };
      // Answered a moment later, as a mid-match join that loads a model first would be.
      return new Promise((done) => setTimeout(() => done(welcome), 20));
    },
  };
}

const waitFor = async (condition: () => boolean | Promise<boolean>, ms = 3000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((done) => setTimeout(done, 10));
  }
};

const snapshot = (senderSlot: PlayerSlot, marker: number): NetworkMessage =>
  ({ type: 'playerSnapshot', senderSlot, x: marker, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, t: marker }) as NetworkMessage;

beforeEach(async () => {
  const { startRelay } = (await import(/* @vite-ignore */ RELAY_MAIN)) as { startRelay: StartRelay };
  const { loadConfig } = (await import(/* @vite-ignore */ RELAY_CONFIG)) as { loadConfig: LoadConfig };
  const config = { ...loadConfig({ HNG_ACCESS_CODES: ACCESS, HNG_ALLOWED_ORIGINS: ORIGIN, HNG_LOG_LEVEL: 'error' }), port: 0 };
  relay = await startRelay(config, { logSink: () => {} });
  server = { url: `ws://127.0.0.1:${relay.port}/ws`, accessCode: ACCESS, createSocket };
  transports.length = 0;
});

afterEach(async () => {
  for (const transport of transports) transport.dispose();
  await relay.shutdown();
});

async function openRoom(hostLog: string[], hostReceived?: { message: NetworkMessage; from: PlayerSlot }[]) {
  const callbacks = recorder(hostLog, hostReceived);
  const host = await hostRoom('server', { username: 'Host', maxPlayers: 4, server }, callbacks);
  transports.push(host);
  return { host, callbacks };
}

async function join(code: string, name: string, log: string[], received?: { message: NetworkMessage; from: PlayerSlot }[]) {
  const guest = await joinRoom(code, { kind: 'server', username: name, rejoinToken: `tok-${name}`, server }, recorder(log, received));
  transports.push(guest);
  return guest;
}

describe('ServerTransport against the real relay', () => {
  it('create, join through onHostHello, a snapshot both ways with the true sender, quality, kick, host leaving', async () => {
    const hostLog: string[] = [];
    const hostReceived: { message: NetworkMessage; from: PlayerSlot }[] = [];
    const { host, callbacks } = await openRoom(hostLog, hostReceived);
    expect(host.kind).toBe('server');
    expect(host.roomCode).toMatch(/^[A-Z2-9]{6}$/);

    // The guest types the code in lower case; the transport uppercases it.
    const bobLog: string[] = [];
    const bobReceived: { message: NetworkMessage; from: PlayerSlot }[] = [];
    const bob = await join(host.roomCode.toLowerCase(), 'Bob', bobLog, bobReceived);
    await waitFor(() => bobLog.includes('connected:1') && hostLog.includes('connected:1'));
    expect(callbacks.hellos).toEqual([{ username: 'Bob', rejoinToken: 'tok-Bob', features: ['facility'], peerId: expect.stringMatching(/^srv-1-/), assigned: { outcome: 'joined', slot: 1 } }]);
    expect(bobLog.slice(0, 2)).toEqual(['connected:1', 'message:0:welcome']);
    expect(bob.ownSlot()).toBe(1);
    expect(bob.isConnectedTo(HOST_SLOT)).toBe(true);
    expect(host.isConnectedTo(1)).toBe(true);

    bob.send(snapshot(1, 11));
    host.send(snapshot(0, 22));
    await waitFor(() => hostReceived.some(({ message }) => message.type === 'playerSnapshot') && bobReceived.some(({ message }) => message.type === 'playerSnapshot'));
    expect(hostReceived.find(({ message }) => message.type === 'playerSnapshot')).toEqual({ message: snapshot(1, 11), from: 1 });
    expect(bobReceived.find(({ message }) => message.type === 'playerSnapshot')).toEqual({ message: snapshot(0, 22), from: 0 });

    // Real pings and the server's quality broadcast (every 2 s) give both sides a route 'server' ping.
    await waitFor(async () => (await host.connectionQuality()).get(1)?.rttMs != null && (await bob.connectionQuality()).get(0)?.rttMs != null, 6000);
    expect((await host.connectionQuality()).get(1)).toEqual({ rttMs: expect.any(Number), route: 'server' });
    expect((await bob.connectionQuality()).has(1)).toBe(false);

    // A third player, kicked by the host: Cara sees the host close her connection; the host hears no
    // second disconnect (it already acted, as with PeerConnection.disconnectGuest).
    const caraLog: string[] = [];
    const cara = await join(host.roomCode, 'Cara', caraLog);
    await waitFor(() => hostLog.includes('connected:2') && caraLog.includes('connected:2'));
    host.disconnectGuest(2);
    await waitFor(() => caraLog.includes('disconnected:0'));
    expect(cara.isConnectedTo(HOST_SLOT)).toBe(false);
    await new Promise((done) => setTimeout(done, 100));
    expect(hostLog).not.toContain('disconnected:2');
    expect(host.isConnectedTo(2)).toBe(false);

    // The host leaves: the room closes and Bob reads it as the host disconnecting, once.
    host.dispose();
    await waitFor(() => bobLog.includes('disconnected:0'));
    await new Promise((done) => setTimeout(done, 100));
    expect(bobLog.filter((entry) => entry.startsWith('disconnected') || entry.startsWith('error'))).toEqual(['disconnected:0']);
    expect(hostLog.filter((entry) => entry.startsWith('error'))).toEqual([]);
  }, 15_000);

  it('an unknown code is onError roomNotFound', async () => {
    const log: string[] = [];
    await join('ZZZZZZ', 'Bob', log);
    await waitFor(() => log.length > 0);
    await new Promise((done) => setTimeout(done, 100));
    expect(log).toEqual([`error:roomNotFound:${ROOM_NOT_FOUND_MESSAGE}`]);
  });

  it('a wrong access code is onError accessDenied, not retried', async () => {
    const log: string[] = [];
    const guest = await joinRoom('ABC234', { kind: 'server', username: 'Bob', rejoinToken: null, server: { ...server, accessCode: 'wrong' } }, recorder(log));
    transports.push(guest);
    await waitFor(() => log.length > 0);
    expect(log).toEqual([expect.stringMatching(/^error:accessDenied:/)]);
  });
});
