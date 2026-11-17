import type { RawData, WebSocket } from 'ws';
import { HOST_SLOT } from '../src/network/protocol.ts';
import {
  encodeServerFrame,
  HOST_FRAME_MAX_BYTES,
  isClientGameFrame,
  parseClientFrame,
  SERVER_CLOSE,
  SERVER_FRAME_MAX_BYTES,
  SERVER_PROTOCOL_VERSION,
  type ResumeOp,
} from '../src/network/serverEnvelope.ts';
import type { AccessCodes } from './access.ts';
import { GUEST_RATE_LIMIT, MemberRateLimiter, type AccessFailureLimiter } from './limits.ts';
import type { Logger } from './log.ts';
import type { MemberSocket, RoomMembership } from './Room.ts';
import type { RoomRegistry } from './RoomRegistry.ts';

/**
 * One WebSocket on the relay (docs/server-relay-design.md, sections 5 and 7.2): the handshake, then
 * at most one room. Phases: `hello` (the first frame must be a hello within the deadline), `lobby`
 * (handshake done; create, join, resume, ping or leave), `room` (every frame goes to the room, which
 * also refuses a second create or join), `closed`. It is the MemberSocket the room core talks to.
 *
 * Resume (section 5.6): `ready` carries a session token for whatever this socket creates or joins;
 * the shell hands it to the room and keeps no copy. A `resume` in the lobby is checked against the
 * per-IP failure policy under its own key (a right access code must not wipe failed resumes), and
 * every refusal closes with the one code `resumeRefused`, except a right token whose member still
 * counts as connected (`resumeLater`). A socket that closes without a close the client or this shell
 * chose is reported to the room as abnormal, so its member may resume. Tokens are never logged.
 *
 * Per-IP failures (section 7.4): wrong access codes, unknown resume tokens and joins with a room code
 * that names no open room are each counted under their own key, and for IPv6 under the /48 as well
 * as the /64; a key over its limit is refused before anything is compared or looked up.
 */

/** RFC 6455 close codes the shell uses beside SERVER_CLOSE. */
export const WS_CLOSE = { goingAway: 1001, unsupportedData: 1003, policyViolation: 1008, tooBig: 1009 } as const;

/** A close the client chose: a `dispose` (1000), the page going away (1001) or a close frame with no
 * code (1005). No close frame at all (1006) is abnormal, and so is any other code: the client closes
 * a socket it gave up on to resume with 4000. */
const CLIENT_CHOSEN_CLOSES: ReadonlySet<number> = new Set([1000, 1001, 1005]);

/** Failed resumes are counted per IP under this key, beside the access code's own count. */
export const resumeFailureKey = (ipKey: string): string => `${ipKey}#resume`;

/** Joins with a code that names no open room are counted per IP under this key, in their own limiter
 * (JOIN_FAILURE_POLICY), so walking room codes never blocks the access code. */
export const joinFailureKey = (ipKey: string): string => `${ipKey}#join`;

/** How long a slow consumer's socket (closed 4009) gets to flush its close frame before it is cut:
 * its backlog of up to slowCloseBytes must not wait for the heartbeat or ws's 30 s close timeout. */
export const SLOW_CONSUMER_CUT_MS = 1000;

export interface MemberContext {
  readonly registry: RoomRegistry;
  readonly access: AccessCodes;
  readonly failures: AccessFailureLimiter;
  /** Joins with an unknown room code (JOIN_FAILURE_POLICY). */
  readonly joinFailures: AccessFailureLimiter;
  readonly log: Logger;
  readonly clock: () => number;
  readonly helloDeadlineMs: number;
  readonly heartbeatTimeoutMs: number;
  /** A probed socket (a resume came for its member) with no pong for this long is ended. */
  readonly probeTimeoutMs: number;
  /** A socket closed 4009 is cut this long after its close frame was queued (SLOW_CONSUMER_CUT_MS). */
  readonly slowConsumerCutMs: number;
  /** Called once, when the socket has closed. */
  onEnded(member: Member): void;
}

type Phase = 'hello' | 'lobby' | 'room' | 'closed';

const byteLength = (data: RawData): number =>
  Array.isArray(data) ? data.reduce((sum, part) => sum + part.length, 0) : data instanceof ArrayBuffer ? data.byteLength : data.length;

const textOf = (data: RawData): string =>
  Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : data.toString('utf8');

export class Member implements MemberSocket {
  /** The client's address group (clientIp.ts), the key of the per-IP limits. */
  readonly ipKey: string;
  /** For IPv6, the /48 around ipKey: failed attempts are counted under both (clientIp.ts, ipWideGroup). */
  readonly ipWideKey: string | null;
  private readonly socket: WebSocket;
  private readonly ctx: MemberContext;
  private phase: Phase = 'hello';
  private membership: RoomMembership | null = null;
  private lobbyLimiter: MemberRateLimiter | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private cutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPongAt: number;
  private pongs = 0;
  /** The token `ready` gave this socket, until a create or join hands it to the room. */
  private sessionToken: string | null = null;
  /** Set when this shell itself closed the socket (any reason): that close is never abnormal. */
  private closedOnPurpose = false;
  private ended = false;

  constructor(socket: WebSocket, ipKey: string, ctx: MemberContext, ipWideKey: string | null = null) {
    this.socket = socket;
    this.ipKey = ipKey;
    this.ipWideKey = ipWideKey;
    this.ctx = ctx;
    this.lastPongAt = ctx.clock();
    socket.on('message', (data, isBinary) => this.handleFrame(data, isBinary));
    socket.on('pong', () => {
      this.lastPongAt = this.ctx.clock();
      this.pongs++;
    });
    socket.on('error', (error) => this.ctx.log.debug('socketError', { ip: this.ipKey, error: error.message }));
    socket.on('close', (code) => this.handleClose(code));
    this.helloTimer = setTimeout(() => this.helloExpired(), ctx.helloDeadlineMs);
  }

  get bufferedAmount(): number {
    return this.socket.bufferedAmount;
  }

  /** The room slot, once this socket is in a room. */
  get slot(): number | null {
    return this.membership?.slot ?? null;
  }

  get inRoom(): boolean {
    return this.membership !== null;
  }

  send(text: string): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(text);
  }

  close(code: number, reason: string): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.closedOnPurpose = true;
    this.clearHelloTimer();
    try {
      this.socket.close(code, reason);
    } catch {
      this.socket.terminate();
      return;
    }
    // A slow consumer's close frame sits behind its backlog, which stays in memory until the close
    // handshake ends. Give the frame a moment to get through (the client treats 4009 as final), then
    // cut the connection, which frees the backlog at once.
    if (code === SERVER_CLOSE.slowConsumer) {
      this.cutTimer = setTimeout(() => {
        this.cutTimer = null;
        if (!this.ended) this.socket.terminate();
      }, this.ctx.slowConsumerCutMs);
    }
  }

  /** A resume came for this socket's member while it still counts as connected: ping now, and end
   * the socket if no pong comes within probeTimeoutMs (a half-open connection after a network
   * change). Its close is abnormal, so the member goes away and the next resume attempt succeeds. */
  probe(): void {
    if (this.ended || this.phase === 'closed' || this.probeTimer !== null) return;
    const pongsBefore = this.pongs;
    try {
      this.socket.ping();
    } catch {
      // A socket that cannot even ping fails the probe below.
    }
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      if (this.ended || this.pongs > pongsBefore) return;
      this.ctx.log.info('probeTimeout', { ip: this.ipKey, slot: this.slot });
      this.phase = 'closed';
      this.socket.terminate();
    }, this.ctx.probeTimeoutMs);
  }

  /** From the relay every heartbeat interval: a protocol ping, or the end of a socket that has not
   * answered one for heartbeatTimeoutMs (section 5.5). Browsers answer pings below JavaScript. */
  heartbeat(now: number): void {
    if (this.ended) return;
    if (now - this.lastPongAt >= this.ctx.heartbeatTimeoutMs) {
      this.ctx.log.info('heartbeatTimeout', { ip: this.ipKey, slot: this.slot });
      this.phase = 'closed';
      this.socket.terminate();
      return;
    }
    if (this.socket.readyState === this.socket.OPEN) this.socket.ping();
  }

  /** Server shutdown: what is not in a room goes away with 1001; rooms already said shutdown. */
  shutdown(): void {
    this.close(WS_CLOSE.goingAway, 'server shutting down');
  }

  terminate(): void {
    this.phase = 'closed';
    this.socket.terminate();
  }

  private handleFrame(data: RawData, isBinary: boolean): void {
    if (this.phase === 'closed') return;
    try {
      if (isBinary) {
        this.close(WS_CLOSE.unsupportedData, 'text frames only');
        return;
      }
      // ws already refused anything above HOST_FRAME_MAX_BYTES (its maxPayload); only the host of a
      // room may use that much, everyone else stops at the guest cap (section 7.4).
      const limit = this.membership?.slot === HOST_SLOT ? HOST_FRAME_MAX_BYTES : SERVER_FRAME_MAX_BYTES;
      const bytes = byteLength(data);
      if (bytes > limit) {
        this.ctx.log.warn('frameTooBig', { ip: this.ipKey, slot: this.slot, bytes, limit });
        this.close(WS_CLOSE.tooBig, 'frame too big');
        return;
      }
      const text = textOf(data);
      if (this.phase === 'hello') this.handleHello(text);
      else if (this.phase === 'lobby') this.handleLobby(text);
      else this.membership?.receive(text);
    } catch (error) {
      this.ctx.log.error('frameError', { ip: this.ipKey, error: error instanceof Error ? error.message : 'unknown' });
    }
  }

  /** Section 5.2 and 5.3: the version first (it reveals nothing), then the per-IP block, which is
   * checked before the code is ever compared, then the code itself. */
  private handleHello(text: string): void {
    this.clearHelloTimer();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = null;
    }
    const fields = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    if (fields === null || fields.op !== 'hello') {
      this.ctx.log.info('handshake', { ip: this.ipKey, result: 'notHello' });
      this.close(WS_CLOSE.policyViolation, 'expected hello');
      return;
    }
    if (fields.proto !== SERVER_PROTOCOL_VERSION) {
      this.ctx.log.info('handshake', { ip: this.ipKey, result: 'versionMismatch', proto: typeof fields.proto === 'number' ? fields.proto : null });
      this.close(SERVER_CLOSE.versionMismatch, 'version mismatch');
      return;
    }
    const now = this.ctx.clock();
    if (this.isBlocked(this.ctx.failures, (key) => key, now)) {
      this.ctx.log.warn('handshake', { ip: this.ipKey, result: 'blocked' });
      this.close(SERVER_CLOSE.accessDenied, 'access denied');
      return;
    }
    if (!this.ctx.access.check(fields.access)) {
      this.recordFailure(this.ctx.failures, (key) => key, now);
      this.ctx.log.warn('handshake', { ip: this.ipKey, result: 'accessDenied' });
      this.close(SERVER_CLOSE.accessDenied, 'access denied');
      return;
    }
    this.ctx.failures.recordSuccess(this.ipKey, now);
    const hello = parseClientFrame(text);
    if (hello === null || isClientGameFrame(hello) || hello.op !== 'hello') {
      this.ctx.log.info('handshake', { ip: this.ipKey, result: 'malformed' });
      this.close(WS_CLOSE.policyViolation, 'malformed hello');
      return;
    }
    this.phase = 'lobby';
    this.lobbyLimiter = new MemberRateLimiter(GUEST_RATE_LIMIT, now);
    this.sessionToken = this.ctx.registry.newSessionToken();
    this.send(encodeServerFrame({ op: 'ready', proto: SERVER_PROTOCOL_VERSION, serverTime: now, sessionToken: this.sessionToken }));
    this.ctx.log.info('handshake', { ip: this.ipKey, result: 'ok', build: hello.build });
  }

  /** Section 5.6: take back a member on this socket. A blocked IP is refused before any token is
   * compared; an unknown token counts as a failure; every refusal but `notAway` closes the same way. */
  private handleResume(op: ResumeOp, now: number): void {
    if (this.isBlocked(this.ctx.failures, resumeFailureKey, now)) {
      this.ctx.log.warn('resume', { ip: this.ipKey, result: 'blocked' });
      this.close(SERVER_CLOSE.resumeRefused, 'resume refused');
      return;
    }
    // The phase moves first, as for a join: the room sends `resumed` and the replay on this socket.
    this.phase = 'room';
    const result = this.ctx.registry.resume(this, op);
    if (typeof result !== 'string') {
      this.membership = result;
      this.ctx.log.info('resume', { ip: this.ipKey, result: 'ok', slot: result.slot });
      return;
    }
    if (result === 'unknown') this.recordFailure(this.ctx.failures, resumeFailureKey, now);
    this.ctx.log.info('resume', { ip: this.ipKey, result });
    if (result === 'notAway') this.close(SERVER_CLOSE.resumeLater, 'resume later');
    else this.close(SERVER_CLOSE.resumeRefused, 'resume refused');
  }

  /** Handshake done, no room yet: one create, join or resume, pings, or a leave. */
  private handleLobby(text: string): void {
    const now = this.ctx.clock();
    const verdict = this.lobbyLimiter?.check(text.length, now) ?? 'ok';
    if (verdict === 'close') {
      this.ctx.log.warn('rateLimited', { ip: this.ipKey, phase: 'lobby' });
      this.close(SERVER_CLOSE.rateLimited, 'rate limited');
      return;
    }
    if (verdict === 'drop') return;
    const frame = parseClientFrame(text);
    if (frame === null || isClientGameFrame(frame)) return;
    switch (frame.op) {
      case 'create':
      case 'join': {
        if (frame.op === 'join' && !this.admitJoin(frame.code, now)) return;
        // The phase moves first: the registry may answer and close this socket before it returns.
        this.phase = 'room';
        const token = this.sessionToken;
        this.sessionToken = null;
        const membership = frame.op === 'create' ? this.ctx.registry.create(this, frame, token) : this.ctx.registry.join(this, frame, token);
        if (membership === null) {
          this.close(SERVER_CLOSE.normal, 'refused');
          return;
        }
        this.membership = membership;
        return;
      }
      case 'resume':
        this.sessionToken = null;
        this.handleResume(frame, now);
        return;
      case 'ping':
        this.send(encodeServerFrame({ op: 'pong', n: frame.n, t: frame.t }));
        return;
      case 'leave':
        this.close(SERVER_CLOSE.normal, 'left');
        return;
      default:
        // A second hello, or a host-only op with no room: nothing to do.
        return;
    }
  }

  /** Section 4.2: a join whose code names no open room is counted per IP (joinFailureKey); past the
   * policy, every join from that IP is answered notFound without the code being looked up, so the
   * answer says nothing about which codes exist. False when it was refused here. */
  private admitJoin(code: string, now: number): boolean {
    if (this.isBlocked(this.ctx.joinFailures, joinFailureKey, now)) {
      this.ctx.log.warn('join', { ip: this.ipKey, result: 'blocked' });
      this.send(encodeServerFrame({ op: 'rejected', reason: 'notFound' }));
      this.close(SERVER_CLOSE.normal, 'notFound');
      return false;
    }
    if (!this.ctx.registry.isOpen(code)) this.recordFailure(this.ctx.joinFailures, joinFailureKey, now);
    return true;
  }

  /** The keys failed attempts of one kind are counted under: the IP group's, and for IPv6 its /48's. */
  private failureKeys(keyOf: (ipKey: string) => string): string[] {
    return this.ipWideKey === null ? [keyOf(this.ipKey)] : [keyOf(this.ipKey), keyOf(this.ipWideKey)];
  }

  /** Blocked when either key is over the limit. */
  private isBlocked(limiter: AccessFailureLimiter, keyOf: (ipKey: string) => string, now: number): boolean {
    return this.failureKeys(keyOf).some((key) => limiter.isBlocked(key, now));
  }

  private recordFailure(limiter: AccessFailureLimiter, keyOf: (ipKey: string) => string, now: number): void {
    for (const key of this.failureKeys(keyOf)) limiter.recordFailure(key, now);
  }

  private helloExpired(): void {
    this.helloTimer = null;
    if (this.phase !== 'hello') return;
    this.ctx.log.info('handshake', { ip: this.ipKey, result: 'timeout' });
    this.close(SERVER_CLOSE.handshakeTimeout, 'handshake timeout');
  }

  private handleClose(code: number): void {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'closed';
    this.clearHelloTimer();
    if (this.probeTimer !== null) clearTimeout(this.probeTimer);
    this.probeTimer = null;
    if (this.cutTimer !== null) clearTimeout(this.cutTimer);
    this.cutTimer = null;
    this.sessionToken = null;
    const abnormal = !this.closedOnPurpose && !CLIENT_CHOSEN_CLOSES.has(code);
    try {
      this.membership?.disconnected(abnormal);
    } catch (error) {
      this.ctx.log.error('disconnectError', { ip: this.ipKey, error: error instanceof Error ? error.message : 'unknown' });
    }
    this.ctx.onEnded(this);
  }

  private clearHelloTimer(): void {
    if (this.helloTimer === null) return;
    clearTimeout(this.helloTimer);
    this.helloTimer = null;
  }
}
