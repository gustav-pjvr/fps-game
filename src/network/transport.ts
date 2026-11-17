import { MULTIPLAYER_MAX_PLAYERS } from '../core/config.ts';
import { PeerConnection } from './PeerConnection.ts';
import { ServerTransport, type ServerConnectOptions } from './ServerTransport.ts';
import type { ConnectionQuality } from './connectionStats.ts';
import type { HelloOutcome } from './HostRoster.ts';
import type { NetworkMessage, PlayerSlot, WelcomeMessage } from './protocol.ts';

export { generateRoomCode } from './PeerConnection.ts';

export type MultiplayerRole = 'host' | 'guest';
export type TransportKind = 'p2p' | 'server';
export type TransportErrorKind = 'brokerLost' | 'roomNotFound' | 'roomCodeTaken' | 'networkBlocked' | 'other'
  | 'serverLost' | 'accessDenied' | 'versionMismatch';

export interface HostHelloRequest {
  username: string;
  rejoinToken: string | null;
  features: unknown;
  peerId: string;
  /** Null on P2P, where HostRoster assigns the slot; set when the server assigned it. */
  assigned: HelloOutcome | null;
}

/** A host's answer to a hello: the welcome to send, or why it is turned away. */
export type HostHelloResult = WelcomeMessage | 'full' | 'outdated';

export interface TransportCallbacks {
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
  onError: (message: string, kind: TransportErrorKind) => void;
  /** Host-only, optional. Fires when the room code has been re-registered with the broker after a
   * dropped websocket (see PeerConnection.scheduleBrokerReconnect), i.e. new players can find the
   * room again. */
  onBrokerReconnected?: () => void;
  onMessage: (message: NetworkMessage, senderSlot: PlayerSlot) => void;
  /** Host-only. Called when a new connection's `hello` arrives, before it's added to the
   * connection map - the caller owns roster/rejoin policy (see HostRoster.ts) and whatever
   * currently-running match state exists, both of which this class has no visibility into. Return
   * the exact WelcomeMessage to send back (with the slot to assign baked into `yourSlot`), or
   * 'full' to reject the connection ('outdated' when the guest's `features` cannot play the room's
   * map, see helloSupportsMap). May return a Promise - resolving this mid-match involves
   * constructing a real RemotePlayer (an async GLTF-backed load), not just a synchronous roster
   * lookup. Never invoked for a guest (a guest sends hello, it never receives one). */
  onHostHello?: (request: HostHelloRequest) => HostHelloResult | Promise<HostHelloResult>;
  /** Server only: the reserved slot is available again. */
  onReservationExpired?: (slot: PlayerSlot) => void;
  /** Server only (resume, docs/server-relay-design.md section 5.6): that player's connection dropped
   * and the server holds its slot while it reconnects (up to 30 s). Nothing of it arrives meanwhile;
   * it is not a disconnect. `onPeerBack` when it returned; if it never does, the usual
   * onPeerDisconnected (or, for the host, the room closing) follows instead. */
  onPeerAway?: (slot: PlayerSlot) => void;
  onPeerBack?: (slot: PlayerSlot) => void;
}

export const NETWORK_BLOCKED_MESSAGE =
  "Couldn't connect through this network. Work, school and some mobile networks block direct " +
  'peer-to-peer play, so try again on a different network (a phone hotspot usually works).';

export interface Transport {
  readonly kind: TransportKind;
  readonly roomCode: string;
  send(message: NetworkMessage): void;
  sendTo(slot: PlayerSlot, message: NetworkMessage): void;
  relay(message: NetworkMessage, fromSlot: PlayerSlot): void;
  disconnectGuest(slot: PlayerSlot): void;
  connectionQuality(): Promise<Map<PlayerSlot, ConnectionQuality>>;
  isConnectedTo(slot: PlayerSlot): boolean;
  ownRole(): MultiplayerRole;
  ownSlot(): PlayerSlot;
  setCallbacks(callbacks: TransportCallbacks): void;
  dispose(): void;
  fastChannelReadyCount(): number;
  directLinksReady(): number;
  /** Server only: this client's own connection dropped and it is reconnecting to resume (section 5.6).
   * Nothing from the others arrives meanwhile, which is not their silence. */
  isReconnecting?(): boolean;
}

export interface HostRoomOptions {
  /** P2P: the code this host generated. The server picks its own (Transport.roomCode). */
  code?: string;
  /** Server: the host's name and the room size asked for in `create` (the server clamps it);
   * MULTIPLAYER_MAX_PLAYERS when left out. */
  username?: string;
  maxPlayers?: number;
  /** Server: where the relay is and the access code. */
  server?: ServerConnectOptions;
}

export interface JoinRoomOptions {
  kind?: TransportKind;
  username: string;
  rejoinToken: string | null;
  /** Server: where the relay is and the access code. */
  server?: ServerConnectOptions;
}

/** Server mode resolves once the server answered `created`, or the attempt ended (reported through
 * onError, as on P2P). */
export async function hostRoom(kind: TransportKind, opts: HostRoomOptions, cb: TransportCallbacks): Promise<Transport> {
  if (kind === 'server') {
    if (!opts.server || opts.username === undefined) throw new Error('A game server room needs the server settings and a name.');
    return ServerTransport.hostRoom(opts.username, opts.maxPlayers ?? MULTIPLAYER_MAX_PLAYERS, opts.server, cb);
  }
  if (opts.code === undefined) throw new Error('A peer-to-peer room needs its code.');
  return PeerConnection.hostRoom(opts.code, cb);
}

export async function joinRoom(code: string, opts: JoinRoomOptions, cb: TransportCallbacks): Promise<Transport> {
  if (opts.kind === 'server') {
    if (!opts.server) throw new Error('Joining through the game server needs the server settings.');
    return ServerTransport.joinRoom(code, opts.username, opts.rejoinToken, opts.server, cb);
  }
  return PeerConnection.joinRoom(code, opts.username, opts.rejoinToken, cb);
}
