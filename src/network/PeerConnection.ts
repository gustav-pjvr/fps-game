import Peer, { type DataConnection, type PeerError } from 'peerjs';
import { isNetworkMessage, type NetworkMessage } from './protocol.ts';

/** Namespaces this game's rooms on PeerJS's shared public signaling broker (see
 * MULTIPLAYER_PLAN.md §2) - the broker is a free service shared by every app using PeerJS's
 * default config, so a short, human-typeable room code needs a prefix to avoid colliding with some
 * unrelated app's peer IDs. Never shown to the player - only the code after it is. */
const ROOM_ID_PREFIX = 'fpsgame-';

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

export interface PeerConnectionCallbacks {
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (message: string) => void;
  onMessage: (message: NetworkMessage) => void;
}

function describePeerError(error: PeerError<string>): string {
  if (error.type === 'peer-unavailable') return 'No room found with that code.';
  if (error.type === 'unavailable-id') return 'That room code is already taken - try again.';
  return error.message || 'Connection error.';
}

/** Thin wrapper around PeerJS for this game's exact multiplayer shape: exactly one host and one
 * guest, joined via a short room code instead of PeerJS's own generated ID. The broker (PeerJS's
 * public server) is only ever involved in the initial handshake - once `onConnected` fires, all
 * traffic flows directly between the two browsers over the resulting WebRTC DataChannel. */
export class PeerConnection {
  private dataConnection: DataConnection | null = null;

  private constructor(
    private readonly peer: Peer,
    private callbacks: PeerConnectionCallbacks,
  ) {
    peer.on('error', (error) => this.callbacks.onError(describePeerError(error)));
  }

  /** Registers this browser under the room code and waits for the guest to connect. */
  static hostRoom(code: string, callbacks: PeerConnectionCallbacks): PeerConnection {
    const peer = new Peer(ROOM_ID_PREFIX + code);
    const instance = new PeerConnection(peer, callbacks);
    peer.on('connection', (connection) => instance.attachConnection(connection));
    return instance;
  }

  /** Connects to an existing room by code. */
  static joinRoom(code: string, callbacks: PeerConnectionCallbacks): PeerConnection {
    const peer = new Peer();
    const instance = new PeerConnection(peer, callbacks);
    // Must wait for our own peer to finish registering with the broker before connecting outward -
    // connecting before `open` fires would queue on a socket that isn't ready yet.
    peer.on('open', () => instance.attachConnection(peer.connect(ROOM_ID_PREFIX + code)));
    return instance;
  }

  private attachConnection(connection: DataConnection): void {
    this.dataConnection = connection;
    connection.on('open', () => this.callbacks.onConnected());
    connection.on('close', () => this.callbacks.onDisconnected());
    connection.on('error', (error) => this.callbacks.onError(describePeerError(error)));
    connection.on('data', (data) => {
      if (isNetworkMessage(data)) this.callbacks.onMessage(data);
    });
  }

  send(message: NetworkMessage): void {
    void this.dataConnection?.send(message);
  }

  /** Full handoff, not a merge - whoever calls this takes complete ownership of reacting to this
   * connection from here on (used when a room screen hands its now-established connection off to
   * Game.create(): the room screen's own UI is about to be hidden/torn down, so its old callbacks
   * updating that UI must stop firing entirely, not run alongside the new ones). */
  setCallbacks(callbacks: PeerConnectionCallbacks): void {
    this.callbacks = callbacks;
  }

  dispose(): void {
    this.dataConnection?.close();
    this.peer.destroy();
  }
}
