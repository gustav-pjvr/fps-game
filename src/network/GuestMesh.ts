import { FAST_MESSAGE_TYPES } from './fastChannel.ts';
import { DIRECT_MESSAGE_TYPES } from './directLinks.ts';
import { HOST_SLOT, isNetworkMessage, type NetworkMessage, type PlayerSlot, type RosterEntry } from './protocol.ts';

/**
 * A guest's direct links to the other guests (docs/squad-arsenal-night.md section 1.1). Without
 * them guest A's position reaches guest B through the host: two hops, and through the host's upload.
 * With them A also sends its snapshots, shots and footsteps straight to B.
 *
 * - For each pair of guests the lower slot dials the higher one, so a pair never opens two links.
 * - The dialer sends `meshHello { slot, roomCode }` when the link opens; the answerer checks it
 *   against its own room and roster (a stray or stale connection is closed) and replies with its
 *   own. Both repeat it every MESH_HEARTBEAT_MS: a link is live while hellos keep arriving.
 * - A link that never opens is retried a few times with a growing delay, then left alone until
 *   the roster changes (a rejoin brings a new PeerJS id). A link that opened and later drops is
 *   retried the same way.
 * - Only DIRECT_MESSAGE_TYPES travel on a link, and only with the link's own slot as sender.
 *
 * Nothing depends on a link: the host keeps relaying everything until both guests of a pair
 * report the link live (meshStatus, see directLinks.ts), receivers drop a snapshot older than
 * the last applied, and a second copy of an event is dropped by its stamp.
 */

/** How often each side says hello on a live link. */
export const MESH_HEARTBEAT_MS = 1000;
/** A link not heard from for this long is reported down (the host relays again). */
export const MESH_LINK_TIMEOUT_MS = 3000;
/** How long a new link may take to exchange hellos, and how long a silent one is kept before it is
 * closed and dialled again. ICE through the TURN relay can take several seconds. */
export const MESH_OPEN_TIMEOUT_MS = 15_000;
export const MESH_RETRY_BASE_MS = 2000;
export const MESH_RETRY_MAX_MS = 16_000;
/** Dials per peer id before giving up on it (strict NAT with no working relay). */
export const MESH_MAX_DIAL_ATTEMPTS = 5;

/** The part of a PeerJS DataConnection the mesh uses, so the tests can drive it with a fake. */
export interface MeshConnection {
  /** The remote PeerJS id. */
  readonly peer: string;
  readonly open: boolean;
  /** For the fast channel and the round trip; missing in tests. */
  readonly peerConnection?: RTCPeerConnection;
  send(message: NetworkMessage): void;
  close(): void;
  onOpen(handler: () => void): void;
  onData(handler: (data: unknown) => void): void;
  /** Close and error both end a link. */
  onClose(handler: () => void): void;
}

/** The part of FastChannel the mesh uses. */
export interface MeshFastChannel {
  trySend(message: NetworkMessage): boolean;
  close(): void;
}

export interface MeshClock {
  now(): number;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

const browserClock: MeshClock = {
  now: () => performance.now(),
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

export interface GuestMeshOptions {
  ownSlot: PlayerSlot;
  roomCode: string;
  /** Opens a connection to `peerId` (PeerJS `peer.connect`). May throw, or return a connection
   * that never opens; both count as a failed dial. */
  dial(peerId: string): MeshConnection;
  openFastChannel(connection: MeshConnection, onMessage: (message: NetworkMessage) => void): MeshFastChannel | null;
  /** A message from another guest's link, with that guest's slot. */
  onMessage(message: NetworkMessage, slot: PlayerSlot): void;
  /** The set of live links changed (sorted slots): the cue to send meshStatus to the host. */
  onLinkedChange(linked: PlayerSlot[]): void;
  clock?: MeshClock;
}

interface MeshLink {
  readonly slot: PlayerSlot;
  readonly peerId: string;
  readonly connection: MeshConnection;
  readonly dialer: boolean;
  /** A valid hello has arrived from the other side. */
  greeted: boolean;
  lastHeardAt: number;
  fast: MeshFastChannel | null;
  openTimer: unknown;
}

interface DialState {
  readonly peerId: string;
  attempts: number;
  retryTimer: unknown;
}

interface PendingIncoming {
  readonly connection: MeshConnection;
  timer: unknown;
}

export class GuestMesh {
  private readonly clock: MeshClock;
  /** Every other guest of the room, with its PeerJS id when known. */
  private readonly roster = new Map<PlayerSlot, string | undefined>();
  private readonly links = new Map<PlayerSlot, MeshLink>();
  private readonly dials = new Map<PlayerSlot, DialState>();
  private readonly pending = new Set<PendingIncoming>();
  private linked: PlayerSlot[] = [];
  private readonly heartbeat: unknown;
  private lastTickAt: number;
  private disposed = false;

  constructor(private readonly options: GuestMeshOptions) {
    this.clock = options.clock ?? browserClock;
    this.lastTickAt = this.clock.now();
    this.heartbeat = this.clock.setInterval(() => this.tick(), MESH_HEARTBEAT_MS);
  }

  /** The whole roster (welcome, rosterUpdate, matchStart, rosterSync). */
  setRoster(entries: readonly RosterEntry[]): void {
    this.roster.clear();
    for (const entry of entries) {
      if (entry.slot !== HOST_SLOT && entry.slot !== this.options.ownSlot) this.roster.set(entry.slot, entry.peerId);
    }
    this.reconcile();
  }

  /** One player joined or rejoined mid-match (playerJoinedMatch). */
  addPlayer(slot: PlayerSlot, peerId: string | undefined): void {
    if (slot === HOST_SLOT || slot === this.options.ownSlot) return;
    this.roster.set(slot, peerId);
    this.reconcile();
  }

  /** One player left (playerLeft). */
  removePlayer(slot: PlayerSlot): void {
    this.roster.delete(slot);
    this.reconcile();
  }

  /** Sends a DIRECT_MESSAGE_TYPES message on every live link; anything else is ignored. A clocked
   * snapshot takes the link's fast channel when it will. */
  send(message: NetworkMessage): void {
    if (!DIRECT_MESSAGE_TYPES.has(message.type)) return;
    const clocked = (message as { t?: unknown }).t !== undefined;
    for (const slot of this.linked) {
      const link = this.links.get(slot);
      if (!link) continue;
      if (clocked && FAST_MESSAGE_TYPES.has(message.type) && link.fast?.trySend(message)) continue;
      try {
        link.connection.send(message);
      } catch {
        // A link closing under the send; its close handler reports it.
      }
    }
  }

  /** An incoming connection from another guest (PeerJS `peer.on('connection')`). */
  accept(connection: MeshConnection): void {
    if (this.disposed) {
      connection.close();
      return;
    }
    const entry: PendingIncoming = { connection, timer: null };
    let link: MeshLink | null = null;
    entry.timer = this.clock.setTimeout(() => {
      if (!this.pending.delete(entry)) return;
      connection.close();
    }, MESH_OPEN_TIMEOUT_MS);
    this.pending.add(entry);

    connection.onData((data) => {
      if (link) {
        this.receive(link, data);
        return;
      }
      if (!this.pending.delete(entry)) return;
      this.clock.clearTimeout(entry.timer);
      const slot = this.acceptableHelloSlot(data, connection.peer);
      if (slot === null) {
        connection.close();
        return;
      }
      const existing = this.links.get(slot);
      if (existing) this.dropLink(existing);
      const accepted: MeshLink = { slot, peerId: connection.peer, connection, dialer: false, greeted: true, lastHeardAt: this.clock.now(), fast: null, openTimer: null };
      link = accepted;
      this.links.set(slot, accepted);
      this.sendHello(accepted);
      accepted.fast = this.options.openFastChannel(connection, (message) => this.receive(accepted, message));
      this.updateLinked();
    });
    connection.onClose(() => {
      if (link) this.failLink(link);
      else if (this.pending.delete(entry)) this.clock.clearTimeout(entry.timer);
    });
  }

  /** PeerJS reported that `peerId` is not registered with the broker (it left, or reloaded). */
  dialFailed(peerId: string): void {
    for (const link of [...this.links.values()]) {
      if (link.dialer && !link.greeted && link.peerId === peerId) this.failLink(link);
    }
  }

  /** The slots with a live link right now, sorted. */
  linkedSlots(): PlayerSlot[] {
    return [...this.linked];
  }

  /** The connection behind each live link, for its round trip. */
  liveConnections(): [PlayerSlot, MeshConnection][] {
    const result: [PlayerSlot, MeshConnection][] = [];
    for (const slot of this.linked) {
      const link = this.links.get(slot);
      if (link) result.push([slot, link.connection]);
    }
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clock.clearInterval(this.heartbeat);
    for (const state of this.dials.values()) if (state.retryTimer !== null) this.clock.clearTimeout(state.retryTimer);
    this.dials.clear();
    for (const link of [...this.links.values()]) this.dropLink(link);
    for (const entry of this.pending) {
      this.clock.clearTimeout(entry.timer);
      entry.connection.close();
    }
    this.pending.clear();
    this.linked = [];
  }

  /** Brings links and dials in line with the roster: closes links to players who left or came
   * back under a new PeerJS id, and dials every higher slot that has no link yet. */
  private reconcile(): void {
    if (this.disposed) return;
    for (const link of [...this.links.values()]) {
      const peerId = this.roster.get(link.slot);
      if (!this.roster.has(link.slot) || (peerId !== undefined && peerId !== link.peerId)) this.dropLink(link);
    }
    for (const [slot, state] of [...this.dials]) {
      if (this.roster.get(slot) === state.peerId) continue;
      if (state.retryTimer !== null) this.clock.clearTimeout(state.retryTimer);
      this.dials.delete(slot);
    }
    for (const [slot, peerId] of this.roster) {
      // The lower slot dials: a higher one waits for this side's call.
      if (peerId === undefined || slot < this.options.ownSlot || this.links.has(slot)) continue;
      const state = this.dials.get(slot);
      if (state && (state.retryTimer !== null || state.attempts >= MESH_MAX_DIAL_ATTEMPTS)) continue;
      this.dial(slot, peerId);
    }
    this.updateLinked();
  }

  private dial(slot: PlayerSlot, peerId: string): void {
    let state = this.dials.get(slot);
    if (!state || state.peerId !== peerId) {
      state = { peerId, attempts: 0, retryTimer: null };
      this.dials.set(slot, state);
    }
    state.attempts++;
    let connection: MeshConnection;
    try {
      connection = this.options.dial(peerId);
    } catch {
      this.scheduleRetry(slot, state);
      return;
    }
    const link: MeshLink = { slot, peerId, connection, dialer: true, greeted: false, lastHeardAt: this.clock.now(), fast: null, openTimer: null };
    this.links.set(slot, link);
    link.openTimer = this.clock.setTimeout(() => {
      link.openTimer = null;
      if (!link.greeted) this.failLink(link);
    }, MESH_OPEN_TIMEOUT_MS);
    connection.onOpen(() => {
      if (this.links.get(slot) !== link) return;
      this.sendHello(link);
      link.fast = this.options.openFastChannel(connection, (message) => this.receive(link, message));
    });
    connection.onData((data) => this.receive(link, data));
    connection.onClose(() => this.failLink(link));
  }

  private scheduleRetry(slot: PlayerSlot, state: DialState): void {
    if (this.disposed || state.attempts >= MESH_MAX_DIAL_ATTEMPTS) return;
    const delay = Math.min(MESH_RETRY_MAX_MS, MESH_RETRY_BASE_MS * 2 ** (state.attempts - 1));
    state.retryTimer = this.clock.setTimeout(() => {
      state.retryTimer = null;
      if (this.disposed || this.dials.get(slot) !== state || this.links.has(slot)) return;
      if (this.roster.get(slot) === state.peerId) this.dial(slot, state.peerId);
    }, delay);
  }

  /** The hello's slot when an incoming connection may become a link: same room, a guest slot lower
   * than this one (the lower slot dials), and the roster's player on that slot is this peer. */
  private acceptableHelloSlot(data: unknown, peerId: string): PlayerSlot | null {
    if (!isNetworkMessage(data) || data.type !== 'meshHello' || data.roomCode !== this.options.roomCode) return null;
    const slot = data.slot;
    if (slot === HOST_SLOT || slot >= this.options.ownSlot || !this.roster.has(slot)) return null;
    const expected = this.roster.get(slot);
    return expected === undefined || expected === peerId ? slot : null;
  }

  private receive(link: MeshLink, data: unknown): void {
    if (this.links.get(link.slot) !== link || !isNetworkMessage(data)) return;
    if (data.type === 'meshHello') {
      if (data.slot !== link.slot || data.roomCode !== this.options.roomCode) {
        this.failLink(link);
        return;
      }
      link.lastHeardAt = this.clock.now();
      if (!link.greeted) {
        link.greeted = true;
        if (link.openTimer !== null) this.clock.clearTimeout(link.openTimer);
        link.openTimer = null;
        // A link that worked gets the full set of retries if it drops later.
        const state = this.dials.get(link.slot);
        if (state) state.attempts = 0;
        this.updateLinked();
      }
      return;
    }
    if (!link.greeted || !DIRECT_MESSAGE_TYPES.has(data.type)) return;
    if ((data as { senderSlot?: unknown }).senderSlot !== link.slot) return;
    link.lastHeardAt = this.clock.now();
    this.options.onMessage(data, link.slot);
  }

  private sendHello(link: MeshLink): void {
    try {
      link.connection.send({ type: 'meshHello', slot: this.options.ownSlot, roomCode: this.options.roomCode });
    } catch {
      // Closing; the close handler takes it from here.
    }
  }

  /** A link ended (closed, errored, never greeted, or silent too long): forget it and, on the
   * dialling side, try again later while the roster still has that player on that PeerJS id. */
  private failLink(link: MeshLink): void {
    if (this.links.get(link.slot) !== link) return;
    this.dropLink(link);
    if (link.dialer) {
      const state = this.dials.get(link.slot);
      if (state && state.peerId === link.peerId && this.roster.get(link.slot) === link.peerId) this.scheduleRetry(link.slot, state);
    }
    this.updateLinked();
  }

  private dropLink(link: MeshLink): void {
    if (this.links.get(link.slot) === link) this.links.delete(link.slot);
    if (link.openTimer !== null) this.clock.clearTimeout(link.openTimer);
    link.openTimer = null;
    link.fast?.close();
    link.fast = null;
    try {
      link.connection.close();
    } catch {
      // Already closed.
    }
  }

  private tick(): void {
    if (this.disposed) return;
    const now = this.clock.now();
    // A tick this late means the whole page stalled (a long load, a backgrounded tab): messages that
    // arrived meanwhile may still be queued behind this timer, so the silence check waits a round.
    const stalled = now - this.lastTickAt > MESH_HEARTBEAT_MS * 2.5;
    this.lastTickAt = now;
    for (const link of [...this.links.values()]) {
      if (!link.greeted || !link.connection.open) continue;
      if (!stalled && now - link.lastHeardAt > MESH_OPEN_TIMEOUT_MS) {
        this.failLink(link);
        continue;
      }
      this.sendHello(link);
    }
    if (!stalled) this.updateLinked();
  }

  private updateLinked(): void {
    const now = this.clock.now();
    const live = [...this.links.values()]
      .filter((link) => link.greeted && link.connection.open && now - link.lastHeardAt <= MESH_LINK_TIMEOUT_MS)
      .map((link) => link.slot)
      .sort((a, b) => a - b);
    if (live.length === this.linked.length && live.every((slot, i) => slot === this.linked[i])) return;
    this.linked = live;
    this.options.onLinkedChange([...live]);
  }
}
