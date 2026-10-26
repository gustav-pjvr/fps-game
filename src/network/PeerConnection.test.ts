import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_BLOCKED_MESSAGE, PeerConnection, classifyPeerError, type PeerConnectionCallbacks } from './PeerConnection.ts';
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

function callbacks(overrides: Partial<PeerConnectionCallbacks> = {}) {
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
async function hostWithGuest(cb: PeerConnectionCallbacks) {
  await PeerConnection.hostRoom('ABCDEF', cb);
  const guest = fakes.makeConnection!('guest-peer');
  lastPeer().emit('connection', guest);
  return { guest };
}

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
