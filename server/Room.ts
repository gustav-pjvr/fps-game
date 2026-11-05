import { HostRoster } from '../src/network/HostRoster.ts';
import { HOST_SLOT, type PlayerSlot } from '../src/network/protocol.ts';
import { routeClassOf, type RouteClass } from '../src/network/routing.ts';
import { serverAccepts } from '../src/network/senderAuthority.ts';
import {
  clampReportedRtt,
  encodeGameFrame,
  encodeServerFrame,
  HOST_FRAME_MAX_BYTES,
  isClientGameFrame,
  parseClientFrame,
  SERVER_CLOSE,
  SERVER_FRAME_MAX_BYTES,
  type ClientGameFrame,
  type ClientOp,
  type JoinAnswerOp,
  type JoinOp,
  type JoinOutcomeKind,
  type RejectReason,
  type RoomClosedReason,
  type ServerOp,
} from '../src/network/serverEnvelope.ts';
import { GUEST_RATE_LIMIT, HOST_RATE_LIMIT, MemberRateLimiter, type RateLimit } from './limits.ts';

/**
 * One relay room (docs/server-relay-design.md, sections 3 and 4): members, the HostRoster that
 * assigns slots and holds 90 s reservations, admission through the host's answer, routing of every
 * game frame by class (routing.ts) behind serverAccepts, rate limits, slow consumers and the
 * quality broadcast. Socket-free: it talks to members only through MemberSocket and reads time
 * only from the injected clock, so it runs the same under the ws shell and under unit tests. The
 * registry drives tick() once a second.
 */

/** What the room needs from a socket. */
export interface MemberSocket {
  send(text: string): void;
  close(code: number, reason: string): void;
  readonly bufferedAmount: number;
}

/** What the shell holds for one socket once it is in a room. */
export interface RoomMembership {
  readonly roomCode: string;
  readonly slot: PlayerSlot;
  /** One text frame from this socket. */
  receive(text: string): void;
  /** The socket closed. Ignored once the room has already let this member go. */
  disconnected(): void;
}

export interface RoomTiming {
  /** How long the host has to answer a joinRequest (section 4.2). */
  answerTimeoutMs: number;
  /** The rejoin reservation (section 4.3). */
  graceMs: number;
  /** Host alone with no match for this long: closed (section 4.5). */
  lobbyIdleMs: number;
  /** Any room older than this: closed. */
  maxAgeMs: number;
  qualityIntervalMs: number;
}

export interface RoomLimits {
  guestRate: RateLimit;
  hostRate: RateLimit;
  /** Above this many bytes buffered to a member, playerSnapshot frames to it are skipped. */
  snapshotSkipBytes: number;
  /** Above this many bytes buffered, the member is closed (4009). */
  slowCloseBytes: number;
}

export const DEFAULT_ROOM_TIMING: RoomTiming = {
  answerTimeoutMs: 30_000,
  graceMs: 90_000,
  lobbyIdleMs: 2 * 60 * 60 * 1000,
  maxAgeMs: 12 * 60 * 60 * 1000,
  qualityIntervalMs: 2000,
};

export const DEFAULT_ROOM_LIMITS: RoomLimits = {
  guestRate: GUEST_RATE_LIMIT,
  hostRate: HOST_RATE_LIMIT,
  snapshotSkipBytes: 64 * 1024,
  slowCloseBytes: 4 * 1024 * 1024,
};

/** Why a frame was dropped; counted per room for the logs (section 7.3). */
export type DropReason =
  | 'rate' // over the member's rate
  | 'malformed' // failed parseClientFrame
  | 'pending' // a game frame from a member not yet admitted
  | 'notAllowed' // serverAccepts refused it, or a guest sent a host broadcast
  | 'unroutable' // class S or D, or a request with nobody to take it
  | 'badTarget' // `to` from a guest, on a non-broadcast type, or at no live guest
  | 'hostOnlyOp' // joinAnswer or kick from a guest
  | 'unexpectedOp' // hello, create or join inside a room
  | 'unknownSlot' // joinAnswer or kick for a slot with nobody to act on
  | 'snapshotSkipped' // slow consumer
  | 'encode' // a message JSON.stringify could not encode
  | 'error'; // anything thrown while handling a frame

export type RoomLog = (event: string, fields: Record<string, string | number | null>) => void;

export interface RoomOptions {
  code: string;
  capacity: number;
  hostUsername: string;
  clock: () => number;
  timing: RoomTiming;
  limits: RoomLimits;
  onClosed: (room: Room, reason: RoomClosedReason) => void;
  log?: RoomLog;
}

interface Member {
  readonly socket: MemberSocket;
  readonly slot: PlayerSlot;
  readonly limiter: MemberRateLimiter;
  readonly username: string;
  readonly rejoinToken: string | null;
  readonly outcome: JoinOutcomeKind;
  state: 'pending' | 'live';
  pendingSince: number;
  rttMs: number | null;
  /** Set once the room has let this member go (left, kicked, replaced, rejected, room closed): every
   * later frame and the socket's own close are ignored. */
  ended: boolean;
}

export class Room {
  readonly code: string;
  readonly capacity: number;
  private readonly roster: HostRoster;
  private readonly clock: () => number;
  private readonly timing: RoomTiming;
  private readonly limits: RoomLimits;
  private readonly onClosed: (room: Room, reason: RoomClosedReason) => void;
  private readonly log: RoomLog | undefined;
  private readonly live = new Map<PlayerSlot, Member>();
  private readonly pending = new Map<PlayerSlot, Member>();
  private readonly drops = new Map<DropReason, number>();
  private readonly createdAt: number;
  private aloneSince: number | null;
  private lastMatchStartAt = Number.NEGATIVE_INFINITY;
  private lastQualityAt: number;
  private peerSeq = 0;
  private closedReason: RoomClosedReason | null = null;
  readonly hostMembership: RoomMembership;

  constructor(hostSocket: MemberSocket, options: RoomOptions) {
    this.code = options.code;
    this.capacity = options.capacity;
    this.clock = options.clock;
    this.timing = options.timing;
    this.limits = options.limits;
    this.onClosed = options.onClosed;
    this.log = options.log;
    this.roster = new HostRoster(options.hostUsername, { capacity: options.capacity, graceMs: options.timing.graceMs });
    const now = this.clock();
    this.createdAt = now;
    this.aloneSince = now;
    this.lastQualityAt = now;
    const host = this.newMember(hostSocket, HOST_SLOT, 'live', 'joined', options.hostUsername, null, this.limits.hostRate, now);
    this.live.set(HOST_SLOT, host);
    this.hostMembership = this.membershipOf(host);
  }

  get closed(): boolean {
    return this.closedReason !== null;
  }

  get closeReason(): RoomClosedReason | null {
    return this.closedReason;
  }

  /** Live (admitted) slots, host first. */
  liveSlots(): PlayerSlot[] {
    return Array.from(this.live.keys()).sort((a, b) => a - b);
  }

  pendingSlots(): PlayerSlot[] {
    return Array.from(this.pending.keys()).sort((a, b) => a - b);
  }

  memberCount(): number {
    return this.live.size + this.pending.size;
  }

  dropCount(reason: DropReason): number {
    return this.drops.get(reason) ?? 0;
  }

  /** A guest's join (section 4.2, steps 2 and 3): hold a slot, make the member pending and ask the
   * host. Returns the reason instead when the room cannot take it. */
  join(socket: MemberSocket, op: JoinOp): RoomMembership | RejectReason {
    if (this.closed) return 'notFound';
    const now = this.clock();
    const outcome = this.roster.handleHello(op.username, op.rejoinToken, now);
    if (outcome.outcome === 'full') return 'full';
    const slot = outcome.slot;
    // Only one join may wait per slot: a second one with the same token (a reload, a second tab)
    // replaces the first, and the host's answer applies to the newer one.
    const previous = this.pending.get(slot);
    if (previous) this.replace(previous);
    const member = this.newMember(socket, slot, 'pending', outcome.outcome, op.username, op.rejoinToken, this.limits.guestRate, now);
    this.pending.set(slot, member);
    this.refreshAlone(now);
    this.peerSeq += 1;
    this.sendToHost({
      op: 'joinRequest',
      slot,
      outcome: outcome.outcome,
      username: op.username,
      rejoinToken: op.rejoinToken,
      ...(op.features === undefined ? {} : { features: op.features }),
      peerId: `srv-${slot}-${this.peerSeq}`,
    });
    this.log?.('join', { code: this.code, slot, outcome: outcome.outcome });
    return this.membershipOf(member);
  }

  /** Once a second from the registry: answer timeouts, reservation expiry, quality, idle and age. */
  tick(): void {
    if (this.closed) return;
    const now = this.clock();
    for (const member of Array.from(this.pending.values())) {
      if (now - member.pendingSince >= this.timing.answerTimeoutMs) this.rejectPending(member, 'busy', now);
    }
    for (const slot of this.roster.sweepExpiredReservations(now)) this.sendToHost({ op: 'expired', slot });
    if (now - this.lastQualityAt >= this.timing.qualityIntervalMs) {
      this.lastQualityAt = now;
      this.broadcastQuality();
    }
    if (now - this.createdAt >= this.timing.maxAgeMs) {
      this.close('expired');
      return;
    }
    if (this.aloneSince !== null && now - Math.max(this.aloneSince, this.lastMatchStartAt) >= this.timing.lobbyIdleMs) this.close('idle');
  }

  /** Close the room: roomClosed to every member still here, then close 4004. */
  close(reason: RoomClosedReason): void {
    if (this.closed) return;
    this.closedReason = reason;
    const text = encodeServerFrame({ op: 'roomClosed', reason });
    const everyone = [...this.live.values(), ...this.pending.values()];
    this.live.clear();
    this.pending.clear();
    for (const member of everyone) {
      if (member.ended) continue;
      member.ended = true;
      this.trySend(member, text);
      this.tryClose(member, SERVER_CLOSE.roomClosed, reason);
    }
    this.log?.('roomClosed', { code: this.code, reason, ageMs: this.clock() - this.createdAt });
    this.onClosed(this, reason);
  }

  // ---- Inbound -------------------------------------------------------------------------------

  private receive(member: Member, text: string): void {
    if (member.ended || this.closed) return;
    try {
      const now = this.clock();
      const verdict = member.limiter.check(typeof text === 'string' ? text.length : 0, now);
      if (verdict !== 'ok') {
        this.count('rate');
        if (verdict === 'close') {
          this.log?.('rateLimited', { code: this.code, slot: member.slot, dropped: member.limiter.dropped });
          this.endMember(member, SERVER_CLOSE.rateLimited, 'rate limited', now);
        }
        return;
      }
      const frame = parseClientFrame(text, member.slot === HOST_SLOT ? HOST_FRAME_MAX_BYTES : SERVER_FRAME_MAX_BYTES);
      if (frame === null) {
        this.count('malformed');
        return;
      }
      if (isClientGameFrame(frame)) this.routeGame(member, frame, now);
      else this.handleOp(member, frame, now);
    } catch {
      this.count('error');
    }
  }

  private handleOp(member: Member, op: ClientOp, now: number): void {
    switch (op.op) {
      case 'ping':
        // Pending members get pongs too, or their transport would read a long host answer as a lost server.
        member.rttMs = clampReportedRtt(op.rtt);
        this.deliver(member, encodeServerFrame({ op: 'pong', n: op.n, t: op.t }), false, now);
        return;
      case 'leave':
        this.endMember(member, SERVER_CLOSE.normal, 'left', now);
        return;
      case 'joinAnswer':
        if (!this.isLiveHost(member)) return this.count('hostOnlyOp');
        this.handleJoinAnswer(op, now);
        return;
      case 'kick': {
        if (!this.isLiveHost(member)) return this.count('hostOnlyOp');
        const target = this.live.get(op.slot);
        if (!target || target.slot === HOST_SLOT) return this.count('unknownSlot');
        this.log?.('kick', { code: this.code, slot: op.slot });
        this.endMember(target, SERVER_CLOSE.kicked, 'kicked', now);
        return;
      }
      default:
        this.count('unexpectedOp');
    }
  }

  private isLiveHost(member: Member): boolean {
    return member.slot === HOST_SLOT && member.state === 'live' && this.live.get(HOST_SLOT) === member;
  }

  /** Section 4.2, step 5: deliver the welcome as a game frame from slot 0, mark the member live,
   * close a member it took the slot over from (4011), then tell the host it was admitted. */
  private handleJoinAnswer(op: JoinAnswerOp, now: number): void {
    const member = this.pending.get(op.slot);
    if (!member) return this.count('unknownSlot');
    if ('reject' in op) {
      this.rejectPending(member, op.reject, now);
      return;
    }
    let welcomeText: string;
    try {
      welcomeText = encodeGameFrame(HOST_SLOT, op.welcome);
    } catch {
      this.count('encode');
      this.rejectPending(member, 'busy', now);
      return;
    }
    this.pending.delete(op.slot);
    member.state = 'live';
    const previous = this.live.get(op.slot);
    if (previous) this.replace(previous);
    this.live.set(op.slot, member);
    // The holder may have dropped while this join waited, or its reservation lapsed: mark the slot
    // connected again under this member's name and token.
    this.roster.adopt({ outcome: member.outcome, slot: op.slot }, member.username, member.rejoinToken);
    this.deliver(member, welcomeText, false, now);
    if (member.ended) return;
    this.sendToHost({ op: 'admitted', slot: op.slot });
    this.log?.('admit', { code: this.code, slot: op.slot });
  }

  /** Section 3.2: route one game frame by its class, the server stamping `f` with the true sender. */
  private routeGame(member: Member, frame: ClientGameFrame, now: number): void {
    if (member.state !== 'live') return this.count('pending');
    const message = frame.m;
    const from = member.slot;
    let routeClass: RouteClass;
    try {
      routeClass = routeClassOf(message.type);
    } catch {
      return this.count('unroutable');
    }
    if (!serverAccepts(message, from)) return this.count('notAllowed');
    if (routeClass === 'S' || routeClass === 'D') return this.count('unroutable');

    let recipients: Member[];
    if (frame.to !== undefined) {
      // Only the host may target, only with a host broadcast, and only at a live admitted guest.
      if (from !== HOST_SLOT || routeClass !== 'B') return this.count('badTarget');
      const target = this.live.get(frame.to);
      if (!target || target.slot === HOST_SLOT) return this.count('badTarget');
      recipients = [target];
    } else if (routeClass === 'R') {
      recipients = Array.from(this.live.values()).filter((other) => other !== member);
    } else if (routeClass === 'H') {
      const host = this.live.get(HOST_SLOT);
      if (from === HOST_SLOT || !host) return this.count('unroutable');
      recipients = [host];
    } else {
      if (from !== HOST_SLOT) return this.count('notAllowed');
      recipients = Array.from(this.live.values()).filter((other) => other.slot !== HOST_SLOT);
    }

    if (message.type === 'matchStart') this.lastMatchStartAt = now;
    let text: string;
    try {
      text = encodeGameFrame(from, message);
    } catch {
      return this.count('encode');
    }
    const skippable = message.type === 'playerSnapshot';
    for (const recipient of recipients) this.deliver(recipient, text, skippable, now);
  }

  // ---- Membership changes --------------------------------------------------------------------

  /** A member goes away: it left, its socket closed, it was kicked or rate limited, or it fell too
   * far behind. The host going closes the room (section 4.4). */
  private endMember(member: Member, closeCode: number | null, reason: string, now: number): void {
    if (member.ended || this.closed) return;
    member.ended = true;
    if (closeCode !== null) this.tryClose(member, closeCode, reason);
    if (member.slot === HOST_SLOT && member.state === 'live') {
      this.close('hostLeft');
      return;
    }
    if (member.state === 'pending') {
      if (this.pending.get(member.slot) === member) this.pending.delete(member.slot);
      this.settleUnadmitted(member, now);
    } else {
      if (this.live.get(member.slot) === member) this.live.delete(member.slot);
      this.roster.handleDisconnect(member.slot, now);
      this.sendToHost({ op: 'memberLeft', slot: member.slot });
    }
    this.log?.('leave', { code: this.code, slot: member.slot, reason });
    this.refreshAlone(now);
  }

  /** A pending member refused by the host, timed out, or gone before an answer. */
  private rejectPending(member: Member, reason: RejectReason, now: number): void {
    if (member.ended) return;
    if (this.pending.get(member.slot) === member) this.pending.delete(member.slot);
    member.ended = true;
    this.trySend(member, encodeServerFrame({ op: 'rejected', reason }));
    this.tryClose(member, SERVER_CLOSE.normal, reason);
    this.settleUnadmitted(member, now);
    this.log?.('reject', { code: this.code, slot: member.slot, reason });
    this.refreshAlone(now);
  }

  /** Put the slot of a join that never got in back the way it was, and tell the host what became of
   * it: `expired` when the slot is free again, `memberLeft` when it is back to a reservation. When a
   * live member still holds it (a takeover that never finished), nothing changed. */
  private settleUnadmitted(member: Member, now: number): void {
    if (this.live.has(member.slot) || this.pending.has(member.slot)) return;
    if (member.outcome === 'joined') {
      this.roster.release(member.slot);
      this.sendToHost({ op: 'expired', slot: member.slot });
    } else {
      this.roster.handleDisconnect(member.slot, now);
      this.sendToHost({ op: 'memberLeft', slot: member.slot });
    }
  }

  /** A newer socket took this member's slot with the same rejoin token: close it (4011) and forget
   * it without touching the slot, so its later close is ignored. */
  private replace(member: Member): void {
    if (member.ended) return;
    member.ended = true;
    if (this.live.get(member.slot) === member) this.live.delete(member.slot);
    if (this.pending.get(member.slot) === member) this.pending.delete(member.slot);
    this.tryClose(member, SERVER_CLOSE.replaced, 'replaced by a rejoin');
  }

  private refreshAlone(now: number): void {
    const hasGuests = this.pending.size > 0 || this.live.size > 1;
    if (hasGuests) this.aloneSince = null;
    else if (this.aloneSince === null) this.aloneSince = now;
  }

  // ---- Outbound ------------------------------------------------------------------------------

  private sendToHost(op: ServerOp): void {
    const host = this.live.get(HOST_SLOT);
    if (host) this.deliver(host, encodeServerFrame(op), false, this.clock());
  }

  private broadcastQuality(): void {
    const members = this.liveSlots().map((slot) => ({ slot, rttMs: this.live.get(slot)?.rttMs ?? null }));
    const text = encodeServerFrame({ op: 'quality', members });
    const now = this.clock();
    for (const member of Array.from(this.live.values())) this.deliver(member, text, false, now);
  }

  /** Send to one member, minding a slow consumer (section 7.4): above slowCloseBytes buffered it is
   * closed (4009); above snapshotSkipBytes a skippable frame (playerSnapshot) is not sent. */
  private deliver(member: Member, text: string, skippable: boolean, now: number): void {
    if (member.ended) return;
    const buffered = member.socket.bufferedAmount;
    if (buffered > this.limits.slowCloseBytes) {
      this.log?.('slowConsumer', { code: this.code, slot: member.slot, buffered });
      this.endMember(member, SERVER_CLOSE.slowConsumer, 'slow consumer', now);
      return;
    }
    if (skippable && buffered > this.limits.snapshotSkipBytes) return this.count('snapshotSkipped');
    this.trySend(member, text);
  }

  private trySend(member: Member, text: string): void {
    try {
      member.socket.send(text);
    } catch {
      this.count('error');
    }
  }

  private tryClose(member: Member, code: number, reason: string): void {
    try {
      member.socket.close(code, reason);
    } catch {
      this.count('error');
    }
  }

  private count(reason: DropReason): void {
    this.drops.set(reason, (this.drops.get(reason) ?? 0) + 1);
  }

  private newMember(socket: MemberSocket, slot: PlayerSlot, state: 'pending' | 'live', outcome: JoinOutcomeKind, username: string, rejoinToken: string | null, rate: RateLimit, now: number): Member {
    return { socket, slot, limiter: new MemberRateLimiter(rate, now), username, rejoinToken, outcome, state, pendingSince: now, rttMs: null, ended: false };
  }

  private membershipOf(member: Member): RoomMembership {
    return {
      roomCode: this.code,
      slot: member.slot,
      receive: (text: string) => this.receive(member, text),
      disconnected: () => this.endMember(member, null, 'socket closed', this.clock()),
    };
  }
}
