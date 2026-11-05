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
} from '../src/network/serverEnvelope.ts';
import type { AccessCodes } from './access.ts';
import { GUEST_RATE_LIMIT, MemberRateLimiter, type AccessFailureLimiter } from './limits.ts';
import type { Logger } from './log.ts';
import type { MemberSocket, RoomMembership } from './Room.ts';
import type { RoomRegistry } from './RoomRegistry.ts';

/**
 * One WebSocket on the relay (docs/server-relay-design.md, sections 5 and 7.2): the handshake, then
 * at most one room. Phases: `hello` (the first frame must be a hello within the deadline), `lobby`
 * (handshake done; create, join, ping or leave), `room` (every frame goes to the room, which also
 * refuses a second create or join), `closed`. It is the MemberSocket the room core talks to.
 */

/** RFC 6455 close codes the shell uses beside SERVER_CLOSE. */
export const WS_CLOSE = { goingAway: 1001, unsupportedData: 1003, policyViolation: 1008, tooBig: 1009 } as const;

export interface MemberContext {
  readonly registry: RoomRegistry;
  readonly access: AccessCodes;
  readonly failures: AccessFailureLimiter;
  readonly log: Logger;
  readonly clock: () => number;
  readonly helloDeadlineMs: number;
  readonly heartbeatTimeoutMs: number;
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
  private readonly socket: WebSocket;
  private readonly ctx: MemberContext;
  private phase: Phase = 'hello';
  private membership: RoomMembership | null = null;
  private lobbyLimiter: MemberRateLimiter | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null;
  private lastPongAt: number;
  private ended = false;

  constructor(socket: WebSocket, ipKey: string, ctx: MemberContext) {
    this.socket = socket;
    this.ipKey = ipKey;
    this.ctx = ctx;
    this.lastPongAt = ctx.clock();
    socket.on('message', (data, isBinary) => this.handleFrame(data, isBinary));
    socket.on('pong', () => {
      this.lastPongAt = this.ctx.clock();
    });
    socket.on('error', (error) => this.ctx.log.debug('socketError', { ip: this.ipKey, error: error.message }));
    socket.on('close', () => this.handleClose());
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
    this.clearHelloTimer();
    try {
      this.socket.close(code, reason);
    } catch {
      this.socket.terminate();
    }
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
    if (this.ctx.failures.isBlocked(this.ipKey, now)) {
      this.ctx.log.warn('handshake', { ip: this.ipKey, result: 'blocked' });
      this.close(SERVER_CLOSE.accessDenied, 'access denied');
      return;
    }
    if (!this.ctx.access.check(fields.access)) {
      this.ctx.failures.recordFailure(this.ipKey, now);
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
    this.send(encodeServerFrame({ op: 'ready', proto: SERVER_PROTOCOL_VERSION, serverTime: now }));
    this.ctx.log.info('handshake', { ip: this.ipKey, result: 'ok', build: hello.build });
  }

  /** Handshake done, no room yet: one create or one join, pings, or a leave. */
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
        // The phase moves first: the registry may answer and close this socket before it returns.
        this.phase = 'room';
        const membership = frame.op === 'create' ? this.ctx.registry.create(this, frame) : this.ctx.registry.join(this, frame);
        if (membership === null) {
          this.close(SERVER_CLOSE.normal, 'refused');
          return;
        }
        this.membership = membership;
        return;
      }
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

  private helloExpired(): void {
    this.helloTimer = null;
    if (this.phase !== 'hello') return;
    this.ctx.log.info('handshake', { ip: this.ipKey, result: 'timeout' });
    this.close(SERVER_CLOSE.handshakeTimeout, 'handshake timeout');
  }

  private handleClose(): void {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'closed';
    this.clearHelloTimer();
    try {
      this.membership?.disconnected();
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
