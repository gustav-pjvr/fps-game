import Peer, { type DataConnection, type PeerError } from 'peerjs';
import { HOST_SLOT, isNetworkMessage, type NetworkMessage, type PlayerSlot, type WelcomeMessage } from './protocol.ts';

/** Namespaces this game's rooms on PeerJS's shared public signaling broker - the broker is a free
 * service shared by every app using PeerJS's default config, so a short, human-typeable room code
 * needs a prefix to avoid colliding with some unrelated app's peer IDs. Never shown to the player -
 * only the code after it is. */
const ROOM_ID_PREFIX = 'fpsgame-';

/** How long to wait for TURN credentials (see buildIceServers) before giving up and connecting
 * with just the defaults below - a slow or unreachable endpoint must never meaningfully delay room
 * creation, since PeerJS's own defaults already work for most network pairings (extra TURN options
 * are a fallback for the ones they don't). */
const TURN_FETCH_TIMEOUT_MS = 2000;

/** PeerJS's own built-in default (mirrored here, not imported - it's internal to the library, not
 * part of its public API) - one Google STUN server plus a shared public TURN relay
 * (turn.peerjs.com) it already ships with. Passing a `config` to `new Peer(...)` at all
 * *replaces* PeerJS's own default entirely rather than merging with it (confirmed by reading
 * PeerJS's source - `config` is forwarded as-is to `RTCPeerConnection`), so any additional ICE
 * servers this app wants to offer (see fetchIceServers) have to be explicitly combined with these,
 * never just appended on top of "whatever PeerJS would have used by default" - that default stops
 * existing the moment `config` is set at all. */
const PEERJS_DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

/** Fetches *additional* TURN relay credentials from this app's own Cloudflare Pages Function
 * (functions/api/turn-credentials.ts), which proxies Metered.ca's free tier server-side so the API
 * key never reaches the client - combined with PEERJS_DEFAULT_ICE_SERVERS (never in place of them)
 * into the full list passed to `new Peer(...)`. Falls back to just the defaults on any failure: no
 * function deployed (e.g. local `vite dev`, which doesn't run Pages functions at all), no
 * credentials configured yet, a timeout, or Metered's API being down - this is a fallback path for
 * network pairings PeerJS's own defaults can't traverse, never a hard dependency for connecting at
 * all. Called once per `Peer` constructed - still exactly one `Peer` per browser tab regardless of
 * player count (the host relays to guests, guests never connect to each other), so this doesn't
 * multiply with lobby size. */
async function buildIceServers(): Promise<RTCIceServer[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURN_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch('/api/turn-credentials', { signal: controller.signal });
    if (!response.ok) return PEERJS_DEFAULT_ICE_SERVERS;
    const data = (await response.json()) as { iceServers?: RTCIceServer[] };
    return [...PEERJS_DEFAULT_ICE_SERVERS, ...(data.iceServers ?? [])];
  } catch {
    return PEERJS_DEFAULT_ICE_SERVERS;
  } finally {
    clearTimeout(timeout);
  }
}

const CODE_LENGTH = 6;
/** Alphanumeric only (PeerJS peer IDs must start/end alphanumeric), excluding visually ambiguous
 * characters (0/O, 1/I/L) since a room code gets read aloud or typed by hand between two people. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export type MultiplayerRole = 'host' | 'guest';

export interface PeerConnectionCallbacks {
  /** Guest: fires once, but only after a WelcomeMessage actually arrives (not the raw WebRTC
   * 'open') - a guest isn't meaningfully "connected" for the app's purposes until it knows its own
   * slot. Host: fires once per new guest, with that guest's freshly assigned slot. */
  onConnected: (slot: PlayerSlot) => void;
  /** Host: fires per-guest when that guest's connection closes - does NOT imply the room/match
   * should end. Guest: only ever fires for HOST_SLOT (its one connection) and always does mean
   * the match ends - star topology gives a guest no path to any other guest without the host
   * relaying, so losing the host is unrecoverable for it. */
  onPeerDisconnected: (slot: PlayerSlot) => void;
  onError: (message: string) => void;
  onMessage: (message: NetworkMessage, senderSlot: PlayerSlot) => void;
  /** Host-only. Called when a new connection's `hello` arrives, before it's added to the
   * connection map - the caller owns roster/rejoin policy (see HostRoster.ts) and whatever
   * currently-running match state exists, both of which this class has no visibility into. Return
   * the exact WelcomeMessage to send back (with the slot to assign baked into `yourSlot`), or
   * 'full' to reject the connection. May return a Promise - resolving this mid-match involves
   * constructing a real RemotePlayer (an async GLTF-backed load), not just a synchronous roster
   * lookup. Never invoked for a guest (a guest sends hello, it never receives one). */
  onHostHello?: (username: string, rejoinToken: string | null) => WelcomeMessage | 'full' | Promise<WelcomeMessage | 'full'>;
}

function describePeerError(error: PeerError<string>): string {
  if (error.type === 'peer-unavailable') return 'No room found with that code.';
  if (error.type === 'unavailable-id') return 'That room code is already taken - try again.';
  return error.message || 'Connection error.';
}

/** Thin wrapper around PeerJS for this game's multiplayer shape: host-relay star topology, up to
 * MULTIPLAYER_MAX_PLAYERS total. The host holds one DataConnection per connected guest (up to 3);
 * a guest holds exactly one, to the host (keyed HOST_SLOT). Guests never connect to each other -
 * every cross-guest message flows through the host, which relays it (see Game.ts's onMessage
 * handler, exercised only when role==='host'). The broker (PeerJS's public server) is only ever
 * involved in each connection's initial handshake - once open, traffic flows directly over the
 * resulting WebRTC DataChannel. */
export class PeerConnection {
  private readonly connections = new Map<PlayerSlot, DataConnection>();
  private ownSlotValue: PlayerSlot = HOST_SLOT;

  private constructor(
    private readonly peer: Peer,
    private readonly role: MultiplayerRole,
    private callbacks: PeerConnectionCallbacks,
  ) {
    peer.on('error', (error) => this.callbacks.onError(describePeerError(error)));
  }

  /** Registers this browser under the room code and waits for guests to connect. Async only
   * because of the TURN credential fetch (see buildIceServers) - bounded by
   * TURN_FETCH_TIMEOUT_MS, so this never hangs room creation waiting on it. */
  static async hostRoom(code: string, callbacks: PeerConnectionCallbacks): Promise<PeerConnection> {
    const iceServers = await buildIceServers();
    const peer = new Peer(ROOM_ID_PREFIX + code, { config: { iceServers } });
    const instance = new PeerConnection(peer, 'host', callbacks);
    peer.on('connection', (connection) => instance.attachIncomingGuestConnection(connection));
    return instance;
  }

  /** Connects to an existing room by code. `rejoinToken`, if this guest has one from an earlier
   * connection to this same room code (see core/multiplayerRejoin.ts), lets the host recognize a
   * reconnect and hand back the same slot/score instead of treating this as a brand new player. */
  static async joinRoom(code: string, username: string, rejoinToken: string | null, callbacks: PeerConnectionCallbacks): Promise<PeerConnection> {
    const iceServers = await buildIceServers();
    const peer = new Peer({ config: { iceServers } });
    const instance = new PeerConnection(peer, 'guest', callbacks);
    // Must wait for our own peer to finish registering with the broker before connecting outward -
    // connecting before `open` fires would queue on a socket that isn't ready yet.
    peer.on('open', () => instance.attachHostConnection(peer.connect(ROOM_ID_PREFIX + code), username, rejoinToken));
    return instance;
  }

  /** Host side: a new inbound connection, not yet assigned a slot - held in limbo until its
   * `hello` arrives, since accepting/rejecting and assigning a slot both depend on knowing who
   * this is (see onHostHello). PeerJS's own DataConnection 'data' event only ever fires once the
   * channel is actually open, so there's no need to separately gate this on an 'open' event. */
  private attachIncomingGuestConnection(connection: DataConnection): void {
    connection.on('error', (error) => this.callbacks.onError(describePeerError(error)));
    connection.on('data', (data) => {
      if (!isNetworkMessage(data) || data.type !== 'hello') return; // ignore anything before hello resolves
      void Promise.resolve(this.callbacks.onHostHello?.(data.username, data.rejoinToken)).then((result) => {
        if (!result || result === 'full') {
          connection.send({ type: 'roomFull' });
          // Closing immediately after send() can race the DataChannel's own flush - confirmed via
          // an actual 4-player playtest: the rejected guest only ever saw the connection's 'close'
          // event fire (read by attachHostConnection as "the host disconnected"), never the
          // roomFull payload, because the channel closed before that just-sent message was
          // actually transmitted. A short delay gives it time to flush first.
          setTimeout(() => connection.close(), 500);
          return;
        }

        const slot = result.yourSlot;
        this.connections.set(slot, connection);
        connection.send(result);
        connection.on('close', () => {
          this.connections.delete(slot);
          this.callbacks.onPeerDisconnected(slot);
        });
        // The listener above only exists to catch the initial hello - once accepted, every
        // further message from this connection is slot-known gameplay/lobby traffic routed
        // through the normal onMessage callback instead.
        connection.removeAllListeners('data');
        connection.on('data', (message) => {
          if (isNetworkMessage(message)) this.callbacks.onMessage(message, slot);
        });
        this.callbacks.onConnected(slot);
      });
    });
  }

  /** Guest side: the one connection to the host. Sends this guest's own `hello` the moment the
   * channel opens, then waits for the host's `welcome`/`roomFull` reply - onConnected only fires
   * once `welcome` actually arrives (see the class's own doc comment on why). */
  private attachHostConnection(connection: DataConnection, username: string, rejoinToken: string | null): void {
    this.connections.set(HOST_SLOT, connection);
    connection.on('open', () => connection.send({ type: 'hello', username, rejoinToken }));
    connection.on('close', () => this.callbacks.onPeerDisconnected(HOST_SLOT));
    connection.on('error', (error) => this.callbacks.onError(describePeerError(error)));
    connection.on('data', (data) => {
      if (!isNetworkMessage(data)) return;
      if (data.type === 'welcome') {
        this.ownSlotValue = data.yourSlot;
        this.callbacks.onConnected(data.yourSlot);
      }
      // welcome/roomFull are also handed to onMessage (not just consumed internally) - the caller
      // (JoinRoomScreen) needs the roster/activeMatch/isRejoin fields a welcome carries, and needs
      // to know roomFull happened at all to show the right status text.
      this.callbacks.onMessage(data, HOST_SLOT);
    });
  }

  /** Broadcasts to every currently connected party. Guest: its one connection (the host).
   * Host: every connected guest. */
  send(message: NetworkMessage): void {
    for (const connection of this.connections.values()) connection.send(message);
  }

  /** Sends to exactly one slot - host-only in practice (a guest only ever has one connection to
   * begin with, so send() already does the same thing), used for anything that must reach one
   * specific guest and no one else (e.g. a targeted reply, though the initial WelcomeMessage today
   * is sent directly on the raw connection before this class's own map is even populated). */
  sendTo(slot: PlayerSlot, message: NetworkMessage): void {
    this.connections.get(slot)?.send(message);
  }

  /** Host-only: relays `message` to every guest except the one it originated from - see Game.ts's
   * transparent relay logic. On a guest (which only ever has one connection anyway) this is
   * equivalent to a no-op, since there is no "everyone except the host" to send to. */
  sendExcept(message: NetworkMessage, excludeSlot: PlayerSlot): void {
    for (const [slot, connection] of this.connections) {
      if (slot !== excludeSlot) connection.send(message);
    }
  }

  /** Host-only explicit disconnect of a single guest, without touching the peer or any other
   * guest's connection - distinct from the ordinary disconnect path, which already comes through
   * the DataConnection's own 'close' event via attachIncomingGuestConnection. */
  disconnectGuest(slot: PlayerSlot): void {
    this.connections.get(slot)?.close();
    this.connections.delete(slot);
  }

  ownRole(): MultiplayerRole {
    return this.role;
  }

  ownSlot(): PlayerSlot {
    return this.ownSlotValue;
  }

  /** Full handoff, not a merge - whoever calls this takes complete ownership of reacting to this
   * connection from here on (used when a room screen hands its now-established connection off to
   * Game.create(): the room screen's own UI is about to be hidden/torn down, so its old callbacks
   * updating that UI must stop firing entirely, not run alongside the new ones). */
  setCallbacks(callbacks: PeerConnectionCallbacks): void {
    this.callbacks = callbacks;
  }

  dispose(): void {
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.peer.destroy();
  }
}
