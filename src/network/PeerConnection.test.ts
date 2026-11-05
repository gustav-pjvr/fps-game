import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerConnection, classifyPeerError } from './PeerConnection.ts';
import { NETWORK_BLOCKED_MESSAGE, hostRoom, joinRoom, type TransportCallbacks } from './transport.ts';
import type { MultiplayerSession } from './MultiplayerSession.ts';
import type { NetworkMessage, WelcomeMessage } from './protocol.ts';

/** Stand-ins for PeerJS's Peer and DataConnection: only the events and calls PeerConnection uses. */
interface FakeConnection {
  readonly peer: string;
  open: boolean;
  readonly sent: unknown[];
  emit(event: string, ...args: unknown[]): boolean;
  close(): void;
}
interface FakePeer {
  readonly dialed: FakeConnection[];
  emit(event: string, ...args: unknown[]): boolean;
}

const fakes = vi.hoisted(() => ({
  peers: [] as FakePeer[],
  makeConnection: null as ((peerId: string) => FakeConnection) | null,
}));

vi.mock('peerjs', () => {
  /** The slice of eventemitter3 (PeerJS's emitter) that PeerConnection calls. */
  class EventEmitter {
    private readonly handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    on(event: string, handler: (...args: unknown[]) => void): this {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    once(event: string, handler: (...args: unknown[]) => void): this {
      const wrapped = (...args: unknown[]) => {
        this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== wrapped));
        handler(...args);
      };
      return this.on(event, wrapped);
    }
    removeAllListeners(event: string): this {
      this.handlers.delete(event);
      return this;
    }
    emit(event: string, ...args: unknown[]): boolean {
      const list = [...(this.handlers.get(event) ?? [])];
      for (const handler of list) handler(...args);
      return list.length > 0;
    }
  }
  class Connection extends EventEmitter {
    open = true;
    readonly sent: unknown[] = [];
    readonly peerConnection = undefined;
    constructor(readonly peer: string) {
      super();
    }
    send(message: unknown): void {
      this.sent.push(message);
    }
    close(): void {
      if (!this.open) return;
      this.open = false;
      this.emit('close');
    }
  }
  class Peer extends EventEmitter {
    destroyed = false;
    disconnected = false;
    readonly dialed: Connection[] = [];
    constructor() {
      super();
      fakes.peers.push(this);
    }
    connect(peerId: string): Connection {
      const connection = new Connection(peerId);
      this.dialed.push(connection);
      return connection;
    }
    reconnect(): void {}
    destroy(): void {
      this.destroyed = true;
    }
  }
  fakes.makeConnection = (peerId) => new Connection(peerId);
  return { default: Peer };
});

const lastPeer = (): FakePeer => fakes.peers[fakes.peers.length - 1]!;

beforeEach(() => {
  // No TURN endpoint in a unit test: the STUN defaults are used at once.
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function callbacks(overrides: Partial<TransportCallbacks> = {}) {
  return {
    onConnected: vi.fn(),
    onPeerDisconnected: vi.fn(),
    onError: vi.fn(),
    onMessage: vi.fn(),
    ...overrides,
  };
}

const welcome = (yourSlot: 1 | 2 | 3): WelcomeMessage => ({ type: 'welcome', yourSlot, isRejoin: false, hostUsername: 'Host', roster: [] });
const hello = { type: 'hello', username: 'Bo', rejoinToken: null, features: ['facility'] };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const webrtcError = (message: string) => Object.assign(new Error(message), { type: 'webrtc' });

/** A host with one inbound guest connection that has not said hello yet. */
async function hostWithGuest(cb: TransportCallbacks) {
  await PeerConnection.hostRoom('ABCDEF', cb);
  const guest = fakes.makeConnection!('guest-peer');
  lastPeer().emit('connection', guest);
  return { guest };
}

describe('transport factories', () => {
  it('hosts through the session transport and fully replaces callbacks at handoff', async () => {
    const lobby = callbacks({ onHostHello: vi.fn(() => welcome(1)) });
    const connection: MultiplayerSession['connection'] = await hostRoom('p2p', { code: 'ABCDEF' }, lobby);
    expect(connection.kind).toBe('p2p');
    expect(connection.roomCode).toBe('ABCDEF');
    expect(connection.ownRole()).toBe('host');
    expect(connection.ownSlot()).toBe(0);
    expect(connection.fastChannelReadyCount()).toBe(0);
    expect(connection.directLinksReady()).toBe(0);

    const match = callbacks({ onHostHello: vi.fn(() => welcome(2)) });
    connection.setCallbacks(match);
    const guest = fakes.makeConnection!('guest-peer');
    lastPeer().emit('connection', guest);
    guest.emit('data', hello);
    await flush();
    expect(lobby.onHostHello).not.toHaveBeenCalled();
    expect(lobby.onConnected).not.toHaveBeenCalled();
    expect(match.onConnected).toHaveBeenCalledWith(2);
    expect(guest.sent).toEqual([welcome(2)]);
    expect(connection.isConnectedTo(2)).toBe(true);
    connection.sendTo(2, { type: 'hostLeftRoom' });
    expect(guest.sent.at(-1)).toEqual({ type: 'hostLeftRoom' });
    connection.dispose();
  });

  it('joins with the same hello and waits for a welcome before connecting', async () => {
    const cb = callbacks();
    const connection = await joinRoom('ABCDEF', { username: 'Bo', rejoinToken: 'returning-token' }, cb);
    expect(connection.kind).toBe('p2p');
    expect(connection.roomCode).toBe('ABCDEF');
    expect(connection.ownRole()).toBe('guest');
    const peer = lastPeer();
    peer.emit('open');
    const host = peer.dialed[0]!;
    expect(host.peer).toBe('fpsgame-ABCDEF');
    host.emit('open');
    expect(host.sent).toEqual([{ ...hello, rejoinToken: 'returning-token' }]);
    expect(cb.onConnected).not.toHaveBeenCalled();
    host.emit('data', welcome(2));
    expect(cb.onConnected).toHaveBeenCalledWith(2);
    expect(connection.ownSlot()).toBe(2);
    connection.send({ type: 'playerReady', slot: 2, ready: true });
    expect(host.sent.at(-1)).toEqual({ type: 'playerReady', slot: 2, ready: true });
    connection.dispose();
  });

  it('rejects the server kind before constructing a peer or fetching ICE servers', async () => {
    const peerCount = fakes.peers.length;
    await expect(hostRoom('server', { code: 'ABCDEF' }, callbacks())).rejects.toThrow('not built yet');
    await expect(joinRoom('ABCDEF', { kind: 'server', username: 'Bo', rejoinToken: null }, callbacks())).rejects.toThrow('not built yet');
    expect(fakes.peers).toHaveLength(peerCount);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps live mesh counts and relay decisions available through the transport', async () => {
    const cb = callbacks({ onHostHello: ({ username }) => welcome(username === 'Bo' ? 1 : 2) });
    const connection = await hostRoom('p2p', { code: 'ABCDEF' }, cb);
    const guests = [fakes.makeConnection!('bo-peer'), fakes.makeConnection!('cy-peer')];
    for (const [index, guest] of guests.entries()) {
      lastPeer().emit('connection', guest);
      guest.emit('data', { ...hello, username: index === 0 ? 'Bo' : 'Cy' });
    }
    await flush();
    const [bo, cy] = guests;
    bo!.emit('data', { type: 'meshStatus', senderSlot: 1, linked: [2] });
    expect(connection.directLinksReady()).toBe(0);
    cy!.emit('data', { type: 'meshStatus', senderSlot: 2, linked: [1] });
    expect(connection.directLinksReady()).toBe(1);
    const shot: NetworkMessage = { type: 'footstepEvent', senderSlot: 1, x: 0, y: 0, z: 0 };
    connection.relay(shot, 1);
    expect(cy!.sent).toEqual([welcome(2)]);
    connection.disconnectGuest(1);
    expect(connection.directLinksReady()).toBe(0);
    expect(connection.isConnectedTo(1)).toBe(false);
    connection.dispose();
  });
});

describe('PeerConnection host: hellos', () => {
  it('accepts only the first hello on a connection, however many arrive before it resolves', async () => {
    let resolve: (result: WelcomeMessage) => void = () => {};
    const onHostHello = vi.fn(() => new Promise<WelcomeMessage>((r) => (resolve = r)));
    const cb = callbacks({ onHostHello });
    const { guest } = await hostWithGuest(cb);
    guest.emit('data', hello);
    guest.emit('data', hello);
    guest.emit('data', { ...hello, username: 'Bo2' });
    resolve(welcome(1));
    await flush();
    expect(onHostHello).toHaveBeenCalledTimes(1);
    expect(onHostHello).toHaveBeenCalledWith({
      username: 'Bo', rejoinToken: null, features: ['facility'], peerId: 'guest-peer', assigned: null,
    });
    expect(cb.onConnected).toHaveBeenCalledTimes(1);
    expect(cb.onConnected).toHaveBeenCalledWith(1);
  });

  it('cancels a join whose connection closed while its hello was being resolved', async () => {
    let resolve: (result: WelcomeMessage) => void = () => {};
    const cb = callbacks({ onHostHello: vi.fn(() => new Promise<WelcomeMessage>((r) => (resolve = r))) });
    const { guest } = await hostWithGuest(cb);
    guest.emit('data', hello);
    guest.close(); // dropped while the host loaded its model
    resolve(welcome(2));
    await flush();
    expect(guest.sent).toEqual([]); // no welcome to a closed connection
    expect(cb.onConnected).not.toHaveBeenCalled();
    // The roster already gave it slot 2: reported gone, so the host takes it out and tells the others.
    expect(cb.onPeerDisconnected).toHaveBeenCalledWith(2);
  });

  it('ignores a hello whose fields are malformed', async () => {
    const onHostHello = vi.fn(() => welcome(1));
    const { guest } = await hostWithGuest(callbacks({ onHostHello }));
    guest.emit('data', { ...hello, username: { length: 2 } });
    guest.emit('data', { ...hello, features: 'facility' });
    await flush();
    expect(onHostHello).not.toHaveBeenCalled();
  });
});

describe('PeerConnection host: who may send what', () => {
  async function acceptedGuest() {
    const cb = callbacks({ onHostHello: vi.fn(() => welcome(2)) });
    const { guest } = await hostWithGuest(cb);
    guest.emit('data', hello);
    await flush();
    expect(cb.onConnected).toHaveBeenCalledWith(2);
    return { cb, guest };
  }

  it('drops host-only messages from a guest: a forged rematch, host leaving, player leaving or joining', async () => {
    const { cb, guest } = await acceptedGuest();
    const forged: NetworkMessage[] = [
      { type: 'matchStart', seed: 1, killLimit: 1, gooseDifficulty: 'normal', gameMode: 'default', weather: 'day', spawns: [], roster: [] },
      { type: 'hostLeftRoom' },
      { type: 'playerLeft', slot: 1 },
      { type: 'playerJoinedMatch', slot: 3, username: 'Ghost', isRejoin: false },
      { type: 'matchEnded', winnerSlot: 2, scoreboard: [{ slot: 2, score: 99 }] },
    ];
    for (const message of forged) guest.emit('data', message);
    expect(cb.onMessage).not.toHaveBeenCalled();
  });

  it("drops a message about another slot or with a junk number, and passes the guest's own", async () => {
    const { cb, guest } = await acceptedGuest();
    guest.emit('data', { type: 'playerDied', senderSlot: 2, victimSlot: 3, killerSlot: 2 });
    guest.emit('data', { type: 'kothScoreTick', senderSlot: 1, score: 5 });
    guest.emit('data', { type: 'damageEvent', senderSlot: 2, targetSlot: 1, amount: Number.NaN });
    expect(cb.onMessage).not.toHaveBeenCalled();
    guest.emit('data', { type: 'kothScoreTick', senderSlot: 2, score: 5 });
    expect(cb.onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'kothScoreTick', senderSlot: 2 }), 2);
  });
});

describe('PeerConnection guest: errors after the welcome', () => {
  async function welcomedGuest() {
    const cb = callbacks();
    await PeerConnection.joinRoom('ABCDEF', 'Bo', null, cb);
    const peer = lastPeer();
    peer.emit('open');
    const hostConnection = peer.dialed[0]!;
    hostConnection.emit('open');
    hostConnection.emit('data', welcome(1));
    expect(cb.onConnected).toHaveBeenCalledWith(1);
    return { cb, peer, hostConnection };
  }

  it('ignores a Peer-level webrtc error (a direct link) while the host connection is open', async () => {
    const { cb, peer } = await welcomedGuest();
    peer.emit('error', webrtcError('ICE failed'));
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('still reports it when the host connection itself is gone', async () => {
    const { cb, peer, hostConnection } = await welcomedGuest();
    hostConnection.open = false;
    peer.emit('error', webrtcError('ICE failed'));
    expect(cb.onError).toHaveBeenCalledWith('ICE failed', 'other');
  });

  it('reports a webrtc error from the host connection itself, and any before the welcome', async () => {
    const { cb, hostConnection } = await welcomedGuest();
    hostConnection.emit('error', webrtcError('Negotiation failed'));
    expect(cb.onError).toHaveBeenCalledTimes(1);
    const early = callbacks();
    await PeerConnection.joinRoom('ABCDEF', 'Cy', null, early);
    lastPeer().emit('error', webrtcError('ICE failed'));
    expect(early.onError).toHaveBeenCalledTimes(1);
  });

  it('takes host-only messages from the host connection', async () => {
    const { cb, hostConnection } = await welcomedGuest();
    hostConnection.emit('data', { type: 'playerLeft', slot: 3 });
    expect(cb.onMessage).toHaveBeenLastCalledWith({ type: 'playerLeft', slot: 3 }, 0);
  });
});

describe('classifyPeerError', () => {
  it('maps an unknown room code to roomNotFound', () => {
    expect(classifyPeerError('peer-unavailable', 'Could not connect to peer fpsgame-ABCDEF')).toEqual({
      kind: 'roomNotFound',
      message: 'No room found with that code.',
    });
  });

  it('maps an ICE negotiation failure to networkBlocked with a player-facing explanation', () => {
    const result = classifyPeerError('negotiation-failed', 'Negotiation of connection to fpsgame-ABCDEF failed.');
    expect(result.kind).toBe('networkBlocked');
    expect(result.message).toBe(NETWORK_BLOCKED_MESSAGE);
  });

  it.each(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'])(
    'treats broker-level error %s as brokerLost, never as a dead data channel',
    (type) => {
      expect(classifyPeerError(type, 'Lost connection to server.').kind).toBe('brokerLost');
    },
  );

  it('keeps a code collision distinct so the host can retry', () => {
    expect(classifyPeerError('unavailable-id', 'ID "fpsgame-ABCDEF" is taken').kind).toBe('roomCodeTaken');
  });

  it('passes other errors through with their own text, or a fallback when empty', () => {
    expect(classifyPeerError('webrtc', 'ICE failed')).toEqual({ kind: 'other', message: 'ICE failed' });
    expect(classifyPeerError('webrtc', '')).toEqual({ kind: 'other', message: 'Connection error.' });
  });
});
