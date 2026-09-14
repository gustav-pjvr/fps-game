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

/** Public STUN servers, always offered. Passing a `config` to `new Peer(...)` replaces PeerJS's own
 * built-in ICE list entirely (it is forwarded as-is to `RTCPeerConnection`), so everything this app
 * wants has to be listed explicitly.
 *
 * STUN only: this list used to also mirror PeerJS's shared public TURN relay
 * (eu-0/us-0.turn.peerjs.com), but those hostnames no longer resolve (verified 2026-09-14 against
 * Google and Cloudflare DNS; Chrome reported "TURN host lookup received error"), so they silently
 * contributed nothing. Relay (TURN) servers now come only from this app's own
 * /api/turn-credentials function. Without one, two players whose networks block a direct
 * peer-to-peer path (work/school firewalls, carrier-grade NAT) cannot connect at all: the guest sits
 * on "Connecting..." until ICE gives up. That was the root cause of the 2026-09-14 "players can't
 * join my lobby" report. */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** Fetches TURN relay credentials from this app's own Cloudflare Pages Function
 * (functions/api/turn-credentials.ts), which proxies Metered.ca server-side so the API key never
 * reaches the client, and appends them to DEFAULT_ICE_SERVERS. Metered's list includes a TURN-over-TLS
 * entry on port 443, the only relay path most locked-down networks allow. Falls back to STUN only on
 * any failure (no function under `vite dev`, credentials not configured, a timeout, Metered down), so
 * room creation is never blocked on it. Called once per `Peer`, i.e. once per browser tab. */
async function buildIceServers(): Promise<RTCIceServer[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURN_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch('/api/turn-credentials', { signal: controller.signal });
    if (!response.ok) return DEFAULT_ICE_SERVERS;
    const data = (await response.json()) as { iceServers?: RTCIceServer[] };
    return [...DEFAULT_ICE_SERVERS, ...(data.iceServers ?? [])];
  } catch {
    return DEFAULT_ICE_SERVERS;
  } finally {
    clearTimeout(timeout);
  }
}

/** Host only: backoff for re-registering the room code with the PeerJS broker after its websocket
 * drops (see PeerConnection.scheduleBrokerReconnect). */
const BROKER_RECONNECT_BASE_DELAY_MS = 1000;
const BROKER_RECONNECT_MAX_DELAY_MS = 15_000;

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
  /** `kind` lets callers tell a lost broker websocket (harmless to an already-open data channel)
   * apart from a failure that really ends a join attempt or a match (see classifyPeerError). */
  onError: (message: string, kind: PeerErrorKind) => void;
  /** Host-only, optional. Fires when the room code has been re-registered with the broker after a
   * dropped websocket (see PeerConnection.scheduleBrokerReconnect), i.e. new players can find the
   * room again. */
  onBrokerReconnected?: () => void;
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

/** What a PeerJS/WebRTC error means for the game, rather than PeerJS's own type strings:
 * - `brokerLost`: the signalling websocket dropped. Already-open data channels keep working; the host
 *   re-registers automatically, and a guest that already has its welcome can ignore it.
 * - `roomNotFound`: no peer is registered under that room code.
 * - `roomCodeTaken`: the host's randomly generated code collided with a live one.
 * - `networkBlocked`: ICE negotiation failed, so no direct or relayed path exists between the two
 *   browsers (strict firewall or NAT with no working TURN relay).
 * - `other`: anything else. */
export type PeerErrorKind = 'brokerLost' | 'roomNotFound' | 'roomCodeTaken' | 'networkBlocked' | 'other';

export const NETWORK_BLOCKED_MESSAGE =
  "Couldn't connect through this network. Work, school and some mobile networks block direct " +
  'peer-to-peer play, so try again on a different network (a phone hotspot usually works).';

const BROKER_ERROR_TYPES: ReadonlySet<string> = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected']);

/** Pure mapping from a PeerJS error `type` to a game-level kind plus player-facing text (exported
 * for the unit tests). Covers both Peer-level types and DataConnection ones ('negotiation-failed'). */
export function classifyPeerError(type: string, rawMessage: string): { kind: PeerErrorKind; message: string } {
  if (type === 'peer-unavailable') return { kind: 'roomNotFound', message: 'No room found with that code.' };
  if (type === 'unavailable-id') return { kind: 'roomCodeTaken', message: 'That room code is already taken - try again.' };
  if (type === 'negotiation-failed') return { kind: 'networkBlocked', message: NETWORK_BLOCKED_MESSAGE };
  if (BROKER_ERROR_TYPES.has(type)) return { kind: 'brokerLost', message: 'Lost contact with the matchmaking server.' };
  return { kind: 'other', message: rawMessage || 'Connection error.' };
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
  private disposed = false;
  private brokerReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private brokerReconnectAttempts = 0;

  private constructor(
    private readonly peer: Peer,
    private readonly role: MultiplayerRole,
    private callbacks: PeerConnectionCallbacks,
  ) {
    peer.on('error', (error) => this.reportError(error));
    // A host whose broker websocket drops (network blip, sleeping laptop, a long-backgrounded tab)
    // stays reachable for players already connected, but PeerJS leaves it "disconnected": the room
    // code is no longer registered, so every new join or rejoin gets "No room found" until the host
    // reloads. Re-register automatically instead. Guests don't need the broker once connected.
    peer.on('disconnected', () => this.scheduleBrokerReconnect());
    peer.on('open', () => {
      if (this.brokerReconnectAttempts === 0) return; // the first registration, not a reconnect
      this.brokerReconnectAttempts = 0;
      this.callbacks.onBrokerReconnected?.();
    });
  }

  private reportError(error: PeerError<string>): void {
    const { kind, message } = classifyPeerError(error.type, error.message);
    this.callbacks.onError(message, kind);
  }

  /** Host only. Retries `peer.reconnect()` with exponential backoff until the broker accepts the
   * room code again. A failed attempt ends in another 'disconnected' event (PeerJS's `_abort`
   * disconnects rather than destroys once the peer has been open), which lands back here. */
  private scheduleBrokerReconnect(): void {
    if (this.role !== 'host' || this.disposed || this.peer.destroyed || this.brokerReconnectTimer !== null) return;
    const delay = Math.min(BROKER_RECONNECT_MAX_DELAY_MS, BROKER_RECONNECT_BASE_DELAY_MS * 2 ** this.brokerReconnectAttempts);
    this.brokerReconnectAttempts++;
    this.brokerReconnectTimer = setTimeout(() => {
      this.brokerReconnectTimer = null;
      if (this.disposed || this.peer.destroyed || !this.peer.disconnected) return;
      this.peer.reconnect();
    }, delay);
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
    // connecting before `open` fires would queue on a socket that isn't ready yet. `once`, not `on`:
    // a later broker re-registration must never open a second connection to the host.
    // `reliable: true` is what makes PeerJS create an *ordered* data channel (it maps straight to
    // RTCDataChannel's `ordered`); without it messages could overtake each other, e.g. a
    // gooseExploded arriving before its gooseSpawned, or playerJoinedMatch before playerLeft.
    peer.once('open', () => instance.attachHostConnection(peer.connect(ROOM_ID_PREFIX + code, { reliable: true }), username, rejoinToken));
    return instance;
  }

  /** Host side: a new inbound connection, not yet assigned a slot - held in limbo until its
   * `hello` arrives, since accepting/rejecting and assigning a slot both depend on knowing who
   * this is (see onHostHello). PeerJS's own DataConnection 'data' event only ever fires once the
   * channel is actually open, so there's no need to separately gate this on an 'open' event. */
  private attachIncomingGuestConnection(connection: DataConnection): void {
    connection.on('error', (error) => this.reportError(error));
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
        const previous = this.connections.get(slot);
        this.connections.set(slot, connection);
        connection.send(result);
        connection.on('close', () => {
          // Only the connection currently holding this slot may report it gone. A rejoin replaces the
          // map entry with the new connection, and the old one's close event can land seconds later;
          // acting on it used to delete the NEW connection and remove the rejoined player again.
          if (this.connections.get(slot) !== connection) return;
          this.connections.delete(slot);
          this.callbacks.onPeerDisconnected(slot);
        });
        // Same slot handed to a new connection (see HostRoster.handleHello's token takeover): the
        // old one is stale, close it so it stops relaying/sending as that player.
        if (previous && previous !== connection) previous.close();
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
    connection.on('error', (error) => this.reportError(error));
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
    const connection = this.connections.get(slot);
    // Remove the map entry BEFORE closing: PeerJS emits 'close' synchronously from close(), and the
    // close handler's "is this still the slot's connection" guard then treats it as already handled.
    // Closing first ran onPeerDisconnected too, so the caller's own removal (the staleness sweep)
    // happened twice and a duplicate playerLeft went out.
    this.connections.delete(slot);
    connection?.close();
  }

  /** Whether a data channel to `slot` exists and is open right now. Lets a guest notice at match
   * start that the host went away while it was still loading (that close event landed on the room
   * screen's callbacks, not Game's). */
  isConnectedTo(slot: PlayerSlot): boolean {
    return this.connections.get(slot)?.open === true;
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
    // Set before destroy(): destroy() itself emits 'disconnected', which must not schedule a reconnect.
    this.disposed = true;
    if (this.brokerReconnectTimer !== null) {
      clearTimeout(this.brokerReconnectTimer);
      this.brokerReconnectTimer = null;
    }
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.peer.destroy();
  }
}
