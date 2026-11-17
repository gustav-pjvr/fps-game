import { timingSafeEqual } from 'node:crypto';
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
  RESUME_BUFFER_MAX_BYTES,
  RESUME_BUFFER_MAX_FRAMES,
  RESUME_WINDOW_MS,
  SERVER_CLOSE,
  SERVER_FRAME_MAX_BYTES,
  SUPERSEDED_STATE_TYPES,
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
 *
 * Resume (section 5.6): every reliable frame to a live member is numbered (`s`) and kept until the
 * member acknowledges it, within RoomLimits' resume bounds. A member whose socket drops abnormally is
 * "away" for resumeWindowMs: its slot and session token stay, its frames are kept, and the others are
 * told `away`. A resume with the token takes the member back on a new socket, replays what it missed
 * and tells the others `back`; a window that runs out, or a buffer that overflows, ends the member
 * the way a closed socket always did.
 */

/** What the room needs from a socket. */
export interface MemberSocket {
  send(text: string): void;
  close(code: number, reason: string): void;
  readonly bufferedAmount: number;
  /** The per-IP key (clientIp.ts) the registry counts this socket's rooms by; absent, no per-IP room cap. */
  readonly ipKey?: string;
  /** Check that the socket is still alive and end it soon if not (a resume came for its member while
   * the server still counted it as connected: a half-open TCP connection after a network change). */
  probe?(): void;
}

/** What the shell holds for one socket once it is in a room. */
export interface RoomMembership {
  readonly roomCode: string;
  readonly slot: PlayerSlot;
  /** One text frame from this socket. */
  receive(text: string): void;
  /** The socket closed. `abnormal`: not a close the client or the server chose (a dropped network, a
   * missed heartbeat), so a live member may come back with a resume. Ignored once the room has
   * already let this member go, or once a resume moved the member to another socket. */
  disconnected(abnormal?: boolean): void;
}

/** Why a resume did not take a member back: `unknown`, no member holds that token (counted as an
 * access failure); `refused`, the token was right but the member cannot carry on (it was not away
 * with every frame the client is missing still kept, and it is now gone); `notAway`, the token was
 * right but the member's socket still counts as connected (it is probed; try again shortly). */
export type ResumeRefusal = 'unknown' | 'refused' | 'notAway';

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
  /** How long a member whose socket dropped is held for a resume (section 5.6). */
  resumeWindowMs: number;
}

export interface RoomLimits {
  guestRate: RateLimit;
  hostRate: RateLimit;
  /** Above this many bytes buffered to a member, superseded state frames (playerSnapshot and the
   * goose snapshots) to it are skipped. */
  snapshotSkipBytes: number;
  /** Above this many bytes buffered, the member is closed (4009) and its socket cut soon after. */
  slowCloseBytes: number;
  /** Unacknowledged reliable frames kept per member, by count and by bytes (keptFrameBytes): past
   * either the oldest is dropped, and for an away member that ends its resume window. */
  resumeBufferFrames: number;
  resumeBufferBytes: number;
}

export const DEFAULT_ROOM_TIMING: RoomTiming = {
  answerTimeoutMs: 30_000,
  graceMs: 90_000,
  lobbyIdleMs: 2 * 60 * 60 * 1000,
  maxAgeMs: 12 * 60 * 60 * 1000,
  qualityIntervalMs: 2000,
  resumeWindowMs: RESUME_WINDOW_MS,
};

export const DEFAULT_ROOM_LIMITS: RoomLimits = {
  guestRate: GUEST_RATE_LIMIT,
  hostRate: HOST_RATE_LIMIT,
  snapshotSkipBytes: 64 * 1024,
  slowCloseBytes: 1024 * 1024,
  resumeBufferFrames: RESUME_BUFFER_MAX_FRAMES,
  resumeBufferBytes: RESUME_BUFFER_MAX_BYTES,
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
  | 'badAck' // an ack beyond the last frame sent to that member
  | 'snapshotSkipped' // slow consumer
  | 'encode' // a message JSON.stringify could not encode
  | 'error'; // anything thrown while handling a frame

/** How a frame to one member is sent: `reliable` is numbered and kept for a resume (game frames and
 * ops); `state` is a superseded state frame, neither numbered nor kept, skipped for a slow consumer;
 * `direct` (pong, quality) is neither numbered nor kept and only goes to a connected socket. */
type FrameKind = 'reliable' | 'state' | 'direct';

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
  /** The host's session token (from its `ready`), or null: the host cannot resume. */
  hostSessionToken?: string | null;
  /** A fresh session token for a member that resumed (the registry's crypto source). */
  newSessionToken: () => string;
}

/** One kept reliable frame, already numbered. */
interface Numbered {
  readonly seq: number;
  readonly text: string;
  /** keptFrameBytes(text), counted against resumeBufferBytes. */
  readonly bytes: number;
}

/** What keeping one frame costs, in bytes: its UTF-8 size (what it takes on the wire and in a send
 * buffer), or, when it holds any character outside ASCII, two bytes a character if that is more (V8
 * then keeps the whole string at two bytes a character). Unknown fields pass the relay unchanged, so
 * a frame of two-byte characters must not count at half its size. */
export function keptFrameBytes(text: string): number {
  const utf8 = Buffer.byteLength(text, 'utf8');
  return utf8 === text.length ? utf8 : Math.max(utf8, 2 * text.length);
}

interface Member {
  /** Null while the member is away (its socket dropped and it may resume). */
  socket: MemberSocket | null;
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
  /** The session token's characters, compared with timingSafeEqual; null when it cannot resume.
   * Never logged; replaced on every resume. */
  sessionToken: Buffer | null;
  /** The number of the last reliable frame sent to this member. */
  outSeq: number;
  /** Every frame up to this number was acknowledged, or dropped from a full buffer; `outbox` holds the
   * frames after it, in order. */
  ackedSeq: number;
  outbox: Numbered[];
  outboxBytes: number;
  /** When its socket dropped, while it is away. */
  awaySince: number | null;
}

const tokenBytes = (token: string | null | undefined): Buffer | null => (typeof token === 'string' && token.length > 0 ? Buffer.from(token, 'utf8') : null);

export class Room {
  readonly code: string;
  readonly capacity: number;
  private readonly roster: HostRoster;
  private readonly clock: () => number;
  private readonly timing: RoomTiming;
  private readonly limits: RoomLimits;
  private readonly onClosed: (room: Room, reason: RoomClosedReason) => void;
  private readonly log: RoomLog | undefined;
  private readonly newSessionToken: () => string;
  /** Admitted members, away ones included (they keep their slot until their window ends). */
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
    this.newSessionToken = options.newSessionToken;
    this.roster = new HostRoster(options.hostUsername, { capacity: options.capacity, graceMs: options.timing.graceMs });
    const now = this.clock();
    this.createdAt = now;
    this.aloneSince = now;
    this.lastQualityAt = now;
    const host = this.newMember(hostSocket, HOST_SLOT, 'live', 'joined', options.hostUsername, null, this.limits.hostRate, now, options.hostSessionToken ?? null);
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

  /** Slots whose member is away, waiting for a resume. */
  awaySlots(): PlayerSlot[] {
    return this.liveSlots().filter((slot) => this.live.get(slot)?.awaySince !== null);
  }

  /** Reliable frames kept for that slot's member until it acknowledges them (tests and logs). */
  keptFrames(slot: PlayerSlot): number {
    return this.live.get(slot)?.outbox.length ?? 0;
  }

  /** A guest's join (section 4.2, steps 2 and 3): hold a slot, make the member pending and ask the
   * host. Returns the reason instead when the room cannot take it. `sessionToken` is the one the
   * socket's `ready` carried, for a later resume. */
  join(socket: MemberSocket, op: JoinOp, sessionToken: string | null = null): RoomMembership | RejectReason {
    if (this.closed) return 'notFound';
    const now = this.clock();
    const outcome = this.roster.handleHello(op.username, op.rejoinToken, now);
    if (outcome.outcome === 'full') return 'full';
    const slot = outcome.slot;
    // Only one join may wait per slot: a second one with the same token (a reload, a second tab)
    // replaces the first, and the host's answer applies to the newer one.
    const previous = this.pending.get(slot);
    if (previous) this.replace(previous);
    const member = this.newMember(socket, slot, 'pending', outcome.outcome, op.username, op.rejoinToken, this.limits.guestRate, now, sessionToken);
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

  /** Section 5.6: take back the member holding `presented` (a session token's characters) on a new
   * socket. Null when no member here holds it. A member still connected is probed and refused
   * `notAway`; one that cannot carry on from `lastSeq` (frames it is missing were dropped, or it
   * claims frames never sent) is ended and refused. Otherwise: a new token in `resumed`, the kept
   * frames after `lastSeq` in order, and `back` to everyone else. */
  resume(socket: MemberSocket, presented: Buffer, lastSeq: number): RoomMembership | ResumeRefusal | null {
    if (this.closed) return null;
    const member = this.memberWithToken(presented);
    if (member === null) return null;
    const now = this.clock();
    if (member.socket !== null) {
      try {
        member.socket.probe?.();
      } catch {
        this.count('error');
      }
      this.log?.('resume', { code: this.code, slot: member.slot, result: 'notAway' });
      return 'notAway';
    }
    if (lastSeq < member.ackedSeq || lastSeq > member.outSeq) {
      this.log?.('resume', { code: this.code, slot: member.slot, result: 'gap' });
      this.endMember(member, null, 'resume gap', now);
      return 'refused';
    }
    const token = this.newSessionToken();
    member.sessionToken = tokenBytes(token);
    member.socket = socket;
    member.awaySince = null;
    this.acknowledge(member, lastSeq);
    this.trySend(member, encodeServerFrame({ op: 'resumed', sessionToken: token }));
    for (const frame of member.outbox) this.trySend(member, frame.text);
    this.log?.('resume', { code: this.code, slot: member.slot, result: 'ok', replayed: member.outbox.length });
    this.broadcastOp({ op: 'back', slot: member.slot }, member, now);
    return this.membershipOf(member);
  }

  /** Once a second from the registry: resume windows, answer timeouts, reservation expiry, quality,
   * idle and age. */
  tick(): void {
    if (this.closed) return;
    const now = this.clock();
    for (const member of Array.from(this.live.values())) {
      if (member.awaySince !== null && now - member.awaySince >= this.timing.resumeWindowMs) {
        this.log?.('resumeWindowOver', { code: this.code, slot: member.slot });
        this.endMember(member, null, 'resume window over', now);
      }
    }
    if (this.closed) return;
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
        this.deliver(member, encodeServerFrame({ op: 'pong', n: op.n, t: op.t }), 'direct', now);
        return;
      case 'leave':
        this.endMember(member, SERVER_CLOSE.normal, 'left', now);
        return;
      case 'ack':
        if (!this.acknowledge(member, op.seq)) this.count('badAck');
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
    this.deliver(member, welcomeText, 'reliable', now);
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
    const kind: FrameKind = SUPERSEDED_STATE_TYPES.has(message.type) ? 'state' : 'reliable';
    for (const recipient of recipients) this.deliver(recipient, text, kind, now);
  }

  // ---- Membership changes --------------------------------------------------------------------

  /** A socket closed. A live member that may resume and lost it abnormally goes away (section 5.6);
   * anyone else leaves as before. */
  private socketClosed(member: Member, abnormal: boolean, now: number): void {
    if (member.ended || this.closed) return;
    if (!abnormal || member.state !== 'live' || member.sessionToken === null || this.timing.resumeWindowMs <= 0) {
      this.endMember(member, null, 'socket closed', now);
      return;
    }
    member.socket = null;
    member.awaySince = now;
    this.log?.('away', { code: this.code, slot: member.slot, kept: member.outbox.length });
    this.broadcastOp({ op: 'away', slot: member.slot }, member, now);
  }

  /** A member goes away for good: it left, its socket closed, it was kicked or rate limited, it fell
   * too far behind, or its resume window ran out. The host going closes the room (section 4.4). */
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
   * it without touching the slot, so its later close is ignored. An away member replaced this way is
   * back as far as the others are concerned. */
  private replace(member: Member): void {
    if (member.ended) return;
    member.ended = true;
    if (this.live.get(member.slot) === member) this.live.delete(member.slot);
    if (this.pending.get(member.slot) === member) this.pending.delete(member.slot);
    this.tryClose(member, SERVER_CLOSE.replaced, 'replaced by a rejoin');
    if (member.awaySince !== null) this.broadcastOp({ op: 'back', slot: member.slot }, member, this.clock());
  }

  private refreshAlone(now: number): void {
    const hasGuests = this.pending.size > 0 || this.live.size > 1;
    if (hasGuests) this.aloneSince = null;
    else if (this.aloneSince === null) this.aloneSince = now;
  }

  // ---- Outbound ------------------------------------------------------------------------------

  private sendToHost(op: ServerOp): void {
    const host = this.live.get(HOST_SLOT);
    if (host) this.deliver(host, encodeServerFrame(op), 'reliable', this.clock());
  }

  /** A reliable op to every admitted member but `except`, away ones included (kept for their resume). */
  private broadcastOp(op: ServerOp, except: Member, now: number): void {
    const text = encodeServerFrame(op);
    for (const member of Array.from(this.live.values())) {
      if (member !== except) this.deliver(member, text, 'reliable', now);
    }
  }

  private broadcastQuality(): void {
    const members = this.liveSlots().map((slot) => ({ slot, rttMs: this.live.get(slot)?.rttMs ?? null }));
    const text = encodeServerFrame({ op: 'quality', members });
    const now = this.clock();
    for (const member of Array.from(this.live.values())) this.deliver(member, text, 'direct', now);
  }

  /** Send to one member. A reliable frame is numbered and kept for a resume first (an away member
   * gets nothing else); then, minding a slow consumer (section 7.4): above slowCloseBytes buffered it
   * is closed (4009, and the shell cuts the socket soon after rather than wait for its backlog); above snapshotSkipBytes a superseded state frame is not sent. */
  private deliver(member: Member, text: string, kind: FrameKind, now: number): void {
    if (member.ended) return;
    if (kind === 'reliable') {
      text = this.keep(member, text, now);
      if (member.ended) return;
    }
    const socket = member.socket;
    if (socket === null) return;
    const buffered = socket.bufferedAmount;
    if (buffered > this.limits.slowCloseBytes) {
      this.log?.('slowConsumer', { code: this.code, slot: member.slot, buffered });
      this.endMember(member, SERVER_CLOSE.slowConsumer, 'slow consumer', now);
      return;
    }
    if (kind === 'state' && buffered > this.limits.snapshotSkipBytes) return this.count('snapshotSkipped');
    this.trySend(member, text);
  }

  /** Number a reliable frame for `member` (its `s`, written as the frame's first key) and keep it
   * until acknowledged. Past the buffer's bounds the oldest kept frames go; for a member that is
   * away that ends its resume window, since it could no longer be brought up to date. */
  private keep(member: Member, text: string, now: number): string {
    member.outSeq += 1;
    // Every encoded frame is a JSON object with at least one key, so `{` opens it.
    const numbered = `{"s":${member.outSeq},${text.slice(1)}`;
    const bytes = keptFrameBytes(numbered);
    member.outbox.push({ seq: member.outSeq, text: numbered, bytes });
    member.outboxBytes += bytes;
    let dropped = false;
    while (member.outbox.length > 0 && (member.outbox.length > this.limits.resumeBufferFrames || member.outboxBytes > this.limits.resumeBufferBytes)) {
      const oldest = member.outbox.shift() as Numbered;
      member.outboxBytes -= oldest.bytes;
      member.ackedSeq = oldest.seq;
      dropped = true;
    }
    if (dropped && member.awaySince !== null) {
      this.log?.('resumeBufferFull', { code: this.code, slot: member.slot });
      this.endMember(member, null, 'resume buffer full', now);
    }
    return numbered;
  }

  /** The member processed every frame up to `seq`: forget them. False for a number never sent. */
  private acknowledge(member: Member, seq: number): boolean {
    if (seq > member.outSeq) return false;
    if (seq <= member.ackedSeq) return true;
    let count = 0;
    while (count < member.outbox.length && (member.outbox[count] as Numbered).seq <= seq) {
      member.outboxBytes -= (member.outbox[count] as Numbered).bytes;
      count++;
    }
    member.outbox.splice(0, count);
    member.ackedSeq = seq;
    return true;
  }

  /** The admitted member whose session token is `presented`. Every candidate is compared, in constant
   * time per comparison, on buffers of equal length only. */
  private memberWithToken(presented: Buffer): Member | null {
    let found: Member | null = null;
    for (const member of this.live.values()) {
      const token = member.sessionToken;
      if (!member.ended && token !== null && token.length === presented.length && timingSafeEqual(token, presented)) found = member;
    }
    return found;
  }

  private trySend(member: Member, text: string): void {
    try {
      member.socket?.send(text);
    } catch {
      this.count('error');
    }
  }

  private tryClose(member: Member, code: number, reason: string): void {
    try {
      member.socket?.close(code, reason);
    } catch {
      this.count('error');
    }
  }

  private count(reason: DropReason): void {
    this.drops.set(reason, (this.drops.get(reason) ?? 0) + 1);
  }

  private newMember(socket: MemberSocket, slot: PlayerSlot, state: 'pending' | 'live', outcome: JoinOutcomeKind, username: string, rejoinToken: string | null, rate: RateLimit, now: number, sessionToken: string | null): Member {
    return {
      socket,
      slot,
      limiter: new MemberRateLimiter(rate, now),
      username,
      rejoinToken,
      outcome,
      state,
      pendingSince: now,
      rttMs: null,
      ended: false,
      sessionToken: tokenBytes(sessionToken),
      outSeq: 0,
      ackedSeq: 0,
      outbox: [],
      outboxBytes: 0,
      awaySince: null,
    };
  }

  /** The shell's handle for one socket of `member`. Bound to that socket: once a resume moved the
   * member to another one (or it went away), the old socket's frames and close are ignored. */
  private membershipOf(member: Member): RoomMembership {
    const socket = member.socket;
    return {
      roomCode: this.code,
      slot: member.slot,
      receive: (text: string) => {
        if (member.socket === socket) this.receive(member, text);
      },
      disconnected: (abnormal?: boolean) => {
        if (member.socket === socket) this.socketClosed(member, abnormal === true, this.clock());
      },
    };
  }
}
