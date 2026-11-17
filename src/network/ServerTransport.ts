import { GAME_VERSION } from '../core/version.ts';
import { combineRelayedQuality, type ConnectionQuality } from './connectionStats.ts';
import {
  CLIENT_FEATURES,
  HELLO_FEATURE_MAX_LENGTH,
  HELLO_MAX_FEATURES,
  HELLO_TOKEN_MAX_LENGTH,
  HELLO_USERNAME_MAX_LENGTH,
  HOST_SLOT,
  isNetworkMessage,
  PLAYER_SLOT_COUNT,
  type NetworkMessage,
  type PlayerSlot,
} from './protocol.ts';
import { DROPPED_TYPES } from './routing.ts';
import { acceptsFromSender } from './senderAuthority.ts';
import {
  encodeClientFrame,
  HOST_FRAME_MAX_BYTES,
  isGuestSlot,
  isServerSlot,
  isSessionToken,
  QUALITY_RTT_MAX_MS,
  RESUME_BUFFER_MAX_BYTES,
  RESUME_BUFFER_MAX_FRAMES,
  RESUME_WINDOW_MS,
  ROOM_CODE_INPUT_MAX_LENGTH,
  SERVER_CLOSE,
  SERVER_FRAME_MAX_BYTES,
  SERVER_PROTOCOL_VERSION,
  SUPERSEDED_STATE_TYPES,
  type ClientFrame,
  type JoinOutcomeKind,
  type NumberedServerFrame,
  type RejectReason,
  type RoomClosedReason,
  type ServerFrame,
} from './serverEnvelope.ts';
import type { HostHelloResult, MultiplayerRole, Transport, TransportCallbacks, TransportErrorKind } from './transport.ts';

/**
 * The browser's side of the relay server (docs/server-relay-design.md, sections 4, 5 and 6.1): one
 * WebSocket carrying the control ops of serverEnvelope.ts and the game's own messages, behind the
 * same Transport interface PeerConnection implements, so Game.ts and the room screens see the same
 * callbacks in the same order as on P2P. The server owns codes, slots and fan-out; this class turns
 * its ops into TransportCallbacks and measures the round trip to it.
 *
 * Every inbound game frame still passes isNetworkMessage and acceptsFromSender with the server's
 * sender stamp `f` as the transport slot, exactly as PeerConnection checks its links (defence in
 * depth: the server ran serverAccepts already). No DOM beyond the WebSocket global and a guarded
 * document.visibilityState, so the class also runs in Node (the tests).
 *
 * Resume (section 5.6): once in a room (the host after `created`, a guest after its welcome), a
 * socket that closes with a code that is not final, or goes silent, is replaced without telling the
 * game: new sockets with backoff for up to RESUME_WINDOW_MS, each sending `hello` then `resume` with
 * the session token and the highest frame number processed; the server answers `resumed` (the next
 * token) and replays what was missed. Numbered frames already processed are dropped. Game frames sent
 * meanwhile are queued and go out after `resumed`. Only when the window runs out, or the server
 * refuses, does the game hear what a lost socket always meant.
 */

/** Used when the caller names no URL. The menus pass relayUrl() from relaySettings.ts. */
export const DEV_RELAY_URL = 'ws://127.0.0.1:8080/ws';

/** Waits before the 2nd, 3rd and 4th connect attempt (section 5.6), each plus up to RETRY_JITTER. */
export const CONNECT_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];
export const CONNECT_RETRY_JITTER = 0.3;
/** One attempt that has not opened by then counts as failed, so a dead route cannot hold the first
 * attempt for the browser's whole TCP timeout; four attempts plus the waits stay inside the join
 * screen's 25 s. */
export const CONNECT_ATTEMPT_TIMEOUT_MS = 4000;
/** No frame at all for this long while the page is visible: the server is gone (section 5.5). */
export const SERVER_SILENCE_LIMIT_MS = 6000;
/** Application ping period (section 5.5); the same tick checks the silence limit. */
export const PING_INTERVAL_MS = 1000;
/** Weight of a new round-trip sample in the running average and its deviation (section 6.1). */
export const RTT_SMOOTHING = 0.2;
/** Pings still waiting for their pong; older ones are forgotten. */
const OUTSTANDING_PINGS = 8;
/** Waits between resume attempts (section 5.6): 250 ms doubling to 4 s, each shortened by up to
 * RESUME_RETRY_JITTER so clients that dropped together do not come back in step. */
export const RESUME_RETRY_BASE_MS = 250;
export const RESUME_RETRY_MAX_MS = 4000;
export const RESUME_RETRY_JITTER = 0.3;
/** Acknowledge after this many numbered frames, besides once a second. */
export const ACK_EVERY_FRAMES = 64;
/** The code this client closes a socket with when it gives up on it to resume: not one the server
 * reads as a chosen close, so the member stays held for the resume. */
export const RESUME_ABANDON_CLOSE = 4000;
/** Closes after which there is nothing to resume: the server ended the member, or refused this client. */
export const RESUME_FINAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  SERVER_CLOSE.normal,
  1003,
  1008,
  1009,
  SERVER_CLOSE.accessDenied,
  SERVER_CLOSE.versionMismatch,
  SERVER_CLOSE.roomClosed,
  SERVER_CLOSE.rateLimited,
  SERVER_CLOSE.slowConsumer,
  SERVER_CLOSE.kicked,
  SERVER_CLOSE.replaced,
  SERVER_CLOSE.resumeRefused,
]);
/** What a close without a frame reports (the network went, or the resume window ran out). */
const CLOSE_ABNORMAL = 1006;

export const SERVER_UNREACHABLE_MESSAGE = "Couldn't reach the game server.";
export const SERVER_LOST_MESSAGE = 'Lost the game server. Create or join the room again.';
export const SERVER_ROOM_CLOSED_MESSAGE = 'The game server closed the room. Create it again.';
export const ACCESS_DENIED_MESSAGE = "The game server didn't accept the access code.";
export const VERSION_MISMATCH_MESSAGE = 'The game was updated. Refresh the page.';
export const SERVER_BUSY_MESSAGE = 'The game server is busy. Try again in a minute.';
/** The P2P wording, which e2e/multiplayer.spec.ts asserts. */
export const ROOM_NOT_FOUND_MESSAGE = 'No room found with that code.';

/** What this class needs from a WebSocket: the browser's, Node's global one, or a test fake. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const SOCKET_OPEN = 1;

/** How to reach the relay. */
export interface ServerConnectOptions {
  /** The relay's WebSocket URL (wss in production); DEV_RELAY_URL when left out. */
  url?: string;
  /** The shared access code (section 5.3), trimmed and sent in the hello. */
  accessCode: string;
  /** Seam for Node and the tests: Node's WebSocket sends no Origin header unless asked, and the
   * relay refuses an upgrade without one. The browser's own WebSocket by default. */
  createSocket?: (url: string) => SocketLike;
  /** Test seams: the clock (performance.now by default), the jitter source and page visibility. */
  now?: () => number;
  random?: () => number;
  isPageVisible?: () => boolean;
}

type Start = { role: 'host'; username: string; maxPlayers: number } | { role: 'guest'; code: string; username: string; rejoinToken: string | null };

/** What a socket close still has to report once the session already ended some other way. */
type CloseOutcome = 'report' | 'roomFull' | 'silent';

/** One joinRequest the host's onHostHello is still resolving. Settle events (memberLeft, expired)
 * for its slot that arrive meanwhile wait here, as PeerConnection reports a joiner that dropped
 * during its hello only once that hello resolved. */
interface HelloInFlight {
  readonly slot: PlayerSlot;
  readonly deferred: (() => void)[];
  settled: boolean;
}

const defaultVisibility = (): boolean => {
  const page = (globalThis as { document?: { visibilityState?: string } }).document;
  return page?.visibilityState !== 'hidden';
};

const defaultSocket = (url: string): SocketLike => new WebSocket(url) as unknown as SocketLike;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isShortString = (value: unknown, maxLength: number): value is string => typeof value === 'string' && value.length <= maxLength;
const JOIN_OUTCOMES: ReadonlySet<unknown> = new Set<JoinOutcomeKind>(['joined', 'rejoined']);
const REJECT_REASONS: ReadonlySet<unknown> = new Set<RejectReason>(['notFound', 'full', 'outdated', 'busy']);
const ROOM_CLOSED_REASONS: ReadonlySet<unknown> = new Set<RoomClosedReason>(['hostLeft', 'idle', 'expired', 'shutdown']);

/** Parse one text frame from the relay into the exact shape this class reads, or null. The server
 * is ours, but its frames still cross the network, so every field read is checked; extra fields
 * are ignored (a newer server may add some) and an unknown op is null. A reliable frame keeps its
 * sequence number `s` (a whole number from 1). */
export function parseServerFrame(text: unknown): NumberedServerFrame | null {
  if (typeof text !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  const frame = parseFields(fields);
  if (frame === null || fields.s === undefined) return frame;
  return Number.isSafeInteger(fields.s) && (fields.s as number) >= 1 ? { ...frame, s: fields.s as number } : null;
}

function parseFields(fields: Record<string, unknown>): ServerFrame | null {
  if (!('op' in fields)) {
    if (!isServerSlot(fields.f) || !isNetworkMessage(fields.m)) return null;
    return { f: fields.f, m: fields.m };
  }
  switch (fields.op) {
    case 'ready':
      if (!Number.isSafeInteger(fields.proto) || !isFiniteNumber(fields.serverTime)) return null;
      if (fields.sessionToken !== undefined && !isSessionToken(fields.sessionToken)) return null;
      return { op: 'ready', proto: fields.proto as number, serverTime: fields.serverTime, ...(fields.sessionToken === undefined ? {} : { sessionToken: fields.sessionToken }) };
    case 'resumed':
      return isSessionToken(fields.sessionToken) ? { op: 'resumed', sessionToken: fields.sessionToken } : null;
    case 'away':
    case 'back':
      return isServerSlot(fields.slot) ? { op: fields.op, slot: fields.slot } : null;
    case 'created':
      return typeof fields.code === 'string' && fields.code.length > 0 && fields.code.length <= ROOM_CODE_INPUT_MAX_LENGTH ? { op: 'created', code: fields.code, slot: 0 } : null;
    case 'joinRequest': {
      if (!isGuestSlot(fields.slot) || !JOIN_OUTCOMES.has(fields.outcome) || !isShortString(fields.username, HELLO_USERNAME_MAX_LENGTH)) return null;
      if (fields.rejoinToken !== null && !isShortString(fields.rejoinToken, HELLO_TOKEN_MAX_LENGTH)) return null;
      if (fields.features !== undefined && !(Array.isArray(fields.features) && fields.features.length <= HELLO_MAX_FEATURES && fields.features.every((feature) => isShortString(feature, HELLO_FEATURE_MAX_LENGTH)))) return null;
      if (typeof fields.peerId !== 'string' || fields.peerId.length > 64) return null;
      return {
        op: 'joinRequest',
        slot: fields.slot,
        outcome: fields.outcome as JoinOutcomeKind,
        username: fields.username,
        rejoinToken: fields.rejoinToken as string | null,
        ...(fields.features === undefined ? {} : { features: [...(fields.features as string[])] }),
        peerId: fields.peerId,
      };
    }
    case 'admitted':
    case 'memberLeft':
    case 'expired':
      return isGuestSlot(fields.slot) ? { op: fields.op, slot: fields.slot } : null;
    case 'rejected':
      return REJECT_REASONS.has(fields.reason) ? { op: 'rejected', reason: fields.reason as RejectReason } : null;
    case 'pong':
      return Number.isSafeInteger(fields.n) && isFiniteNumber(fields.t) ? { op: 'pong', n: fields.n as number, t: fields.t } : null;
    case 'quality': {
      if (!Array.isArray(fields.members) || fields.members.length > PLAYER_SLOT_COUNT) return null;
      const members: { slot: PlayerSlot; rttMs: number | null }[] = [];
      for (const entry of fields.members as unknown[]) {
        if (typeof entry !== 'object' || entry === null) return null;
        const { slot, rttMs } = entry as { slot?: unknown; rttMs?: unknown };
        if (!isServerSlot(slot) || (rttMs !== null && !isFiniteNumber(rttMs))) return null;
        members.push({ slot, rttMs: rttMs === null ? null : Math.min(QUALITY_RTT_MAX_MS, Math.max(0, rttMs)) });
      }
      return { op: 'quality', members };
    }
    case 'roomClosed':
      return ROOM_CLOSED_REASONS.has(fields.reason) ? { op: 'roomClosed', reason: fields.reason as RoomClosedReason } : null;
    default:
      return null;
  }
}

/** Round trip to the server from ping and pong: an exponentially weighted average and, as jitter,
 * the same average of each sample's distance from it (section 6.1). Pure, for the tests. */
export class RttEstimator {
  private average: number | null = null;
  private deviation = 0;

  add(sampleMs: number): void {
    if (!Number.isFinite(sampleMs) || sampleMs < 0) return;
    if (this.average === null) {
      this.average = sampleMs;
      return;
    }
    this.deviation += RTT_SMOOTHING * (Math.abs(sampleMs - this.average) - this.deviation);
    this.average += RTT_SMOOTHING * (sampleMs - this.average);
  }

  /** Whole milliseconds, or null before the first sample. */
  get rttMs(): number | null {
    return this.average === null ? null : Math.round(this.average);
  }

  get jitterMs(): number | null {
    return this.average === null ? null : Math.round(this.deviation);
  }
}

/** Wait before connect attempt `retry` (0 for the second attempt): the base plus up to 30 percent. */
export function connectRetryDelay(retry: number, random: () => number): number {
  const base = CONNECT_RETRY_DELAYS_MS[retry] ?? CONNECT_RETRY_DELAYS_MS[CONNECT_RETRY_DELAYS_MS.length - 1]!;
  return base * (1 + CONNECT_RETRY_JITTER * Math.min(1, Math.max(0, random())));
}

/** Wait before resume attempt `attempt` (0 for the first): 250 ms doubling to 4 s, less up to 30
 * percent, so never above 4 s. */
export function resumeRetryDelay(attempt: number, random: () => number): number {
  const base = Math.min(RESUME_RETRY_MAX_MS, RESUME_RETRY_BASE_MS * 2 ** Math.max(0, attempt));
  return base * (1 - RESUME_RETRY_JITTER * Math.min(1, Math.max(0, random())));
}

/** A frame worth queueing while this client reconnects: game frames but superseded state, and the
 * host's answers (joinAnswer, kick). Handshake, ping, ack and leave belong to one socket. */
const isQueueable = (frame: ClientFrame): boolean =>
  'm' in frame ? !SUPERSEDED_STATE_TYPES.has(frame.m.type) : frame.op === 'joinAnswer' || frame.op === 'kick';

export class ServerTransport implements Transport {
  readonly kind = 'server';
  private readonly url: string;
  private readonly accessCode: string;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly pageVisible: () => boolean;
  private readonly role: MultiplayerRole;
  private readonly start: Start;
  private callbacks: TransportCallbacks;
  private socket: SocketLike | null = null;
  private code: string;
  private ownSlotValue: PlayerSlot = HOST_SLOT;
  private attempt = 0;
  private opened = false;
  private handshakeDone = false;
  /** Guest: whether its welcome arrived. */
  private welcomed = false;
  /** Set once the session is over (failed, rejected, closed or disposed): inbound frames are ignored
   * and only `closeOutcome` is left to report when the socket finishes closing. */
  private ended = false;
  private closeOutcome: CloseOutcome = 'report';
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeardAt = 0;
  private hiddenSeen = false;
  private pingSeq = 0;
  private readonly pingsSent = new Map<number, number>();
  private readonly rtt = new RttEstimator();
  /** The server's last quality broadcast: every live member's own round trip to it. */
  private readonly memberRtts = new Map<PlayerSlot, number | null>();
  /** Host: admitted guests, by the server's admitted and memberLeft. */
  private readonly liveSlots = new Set<PlayerSlot>();
  /** Host: guests it kicked, whose memberLeft the caller already acted on (disconnectGuest). */
  private readonly kickedSlots = new Set<PlayerSlot>();
  private readonly hellosInFlight = new Map<PlayerSlot, HelloInFlight>();
  /** Host: settles the hostRoom promise (on `created`, or when the attempt ended without one). */
  private settleHost: (() => void) | null = null;
  /** Resume (section 5.6): the token from `ready`, then from each `resumed`; never logged. */
  private sessionToken: string | null = null;
  /** The highest frame number processed, and the highest acknowledged to the server. */
  private lastSeq = 0;
  private ackedSeq = 0;
  /** Reconnecting to resume; the current socket (if any) is an attempt not yet `resumed`. */
  private resuming = false;
  private resumeAttempt = 0;
  /** This attempt's socket has sent its `resume`. */
  private resumeSent = false;
  private resumeDeadline: ReturnType<typeof setTimeout> | null = null;
  /** Frames sent while reconnecting, encoded, for after `resumed`. */
  private readonly queued: string[] = [];
  private queuedChars = 0;

  private constructor(start: Start, options: ServerConnectOptions, callbacks: TransportCallbacks) {
    this.start = start;
    this.role = start.role;
    this.code = start.role === 'guest' ? start.code : '';
    this.url = options.url ?? DEV_RELAY_URL;
    this.accessCode = options.accessCode.trim();
    this.createSocket = options.createSocket ?? defaultSocket;
    this.now = options.now ?? (() => performance.now());
    this.random = options.random ?? Math.random;
    this.pageVisible = options.isPageVisible ?? defaultVisibility;
    this.callbacks = callbacks;
  }

  /** Opens a room on the server. Resolves once the server answered `created` (roomCode is then
   * set) or the attempt ended; failures are reported through onError, as on P2P, never by
   * rejecting. */
  static hostRoom(username: string, maxPlayers: number, options: ServerConnectOptions, callbacks: TransportCallbacks): Promise<ServerTransport> {
    const instance = new ServerTransport({ role: 'host', username, maxPlayers }, options, callbacks);
    const settled = new Promise<ServerTransport>((done) => {
      instance.settleHost = () => {
        instance.settleHost = null;
        done(instance);
      };
    });
    instance.connect();
    return settled;
  }

  /** Joins a room by code (uppercased here; the server matches exactly). Returns at once, like
   * PeerConnection.joinRoom: the welcome arrives through onConnected and onMessage. */
  static joinRoom(code: string, username: string, rejoinToken: string | null, options: ServerConnectOptions, callbacks: TransportCallbacks): ServerTransport {
    const instance = new ServerTransport({ role: 'guest', code: code.trim().toUpperCase(), username, rejoinToken }, options, callbacks);
    instance.connect();
    return instance;
  }

  get roomCode(): string {
    return this.code;
  }

  // ---- Connecting ----------------------------------------------------------------------------

  private connect(): void {
    if (this.ended) return;
    if (this.accessCode.length === 0) {
      this.fail(ACCESS_DENIED_MESSAGE, 'accessDenied');
      return;
    }
    let socket: SocketLike;
    try {
      socket = this.createSocket(this.url);
    } catch {
      if (this.resuming) this.resumeAttemptFailed(null);
      else this.attemptFailed(null);
      return;
    }
    this.socket = socket;
    this.opened = false;
    socket.onopen = () => {
      if (socket === this.socket) this.handleOpen();
    };
    socket.onmessage = (event) => {
      if (socket === this.socket) this.handleFrame(event.data);
    };
    socket.onclose = (event) => {
      if (socket === this.socket) this.handleClose(event.code);
    };
    socket.onerror = () => {
      // A close event always follows; it carries what there is to know.
    };
    // A resume attempt has this long to reach `resumed`, not just to open.
    this.attemptTimer = setTimeout(() => {
      this.attemptTimer = null;
      if (socket !== this.socket) return;
      if (this.resuming) this.resumeAttemptFailed(null);
      else if (!this.opened) this.attemptFailed(socket);
    }, CONNECT_ATTEMPT_TIMEOUT_MS);
  }

  /** An attempt that never opened: try again after the next delay, or give up. */
  private attemptFailed(socket: SocketLike | null): void {
    this.clearAttemptTimer();
    if (socket) {
      this.socket = null;
      this.detach(socket);
      try {
        socket.close();
      } catch {
        // Already gone.
      }
    }
    if (this.ended) return;
    if (this.attempt >= CONNECT_RETRY_DELAYS_MS.length) {
      this.fail(SERVER_UNREACHABLE_MESSAGE, 'serverLost');
      return;
    }
    const delay = connectRetryDelay(this.attempt, this.random);
    this.attempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private handleOpen(): void {
    this.opened = true;
    this.lastHeardAt = this.now();
    this.hiddenSeen = false;
    this.sendFrame({ op: 'hello', proto: SERVER_PROTOCOL_VERSION, build: GAME_VERSION, access: this.accessCode, features: [...CLIENT_FEATURES] });
    // A resume attempt pings and counts silence only once `resumed` arrived; its attempt timer runs on.
    if (this.resuming) return;
    this.clearAttemptTimer();
    this.tickTimer = setInterval(() => this.tick(), PING_INTERVAL_MS);
  }

  /** Once a second: the silence rule, counted only while the page is visible (a hidden tab's timers
   * are throttled and it may hear nothing for a while), then a ping and any acknowledgement due.
   * Silence in a room starts a resume rather than ending the session. */
  private tick(): void {
    if (this.ended) return;
    const now = this.now();
    if (!this.pageVisible()) {
      this.hiddenSeen = true;
    } else if (this.hiddenSeen) {
      this.hiddenSeen = false;
      this.lastHeardAt = now;
    } else if (now - this.lastHeardAt >= SERVER_SILENCE_LIMIT_MS) {
      if (this.canResume()) this.beginResume();
      else this.lose(SERVER_LOST_MESSAGE);
      return;
    }
    if (!this.handshakeDone) return;
    this.sendPing(now);
    if (this.lastSeq > this.ackedSeq) this.sendAck();
  }

  private sendPing(now: number): void {
    this.pingSeq++;
    this.pingsSent.set(this.pingSeq, now);
    this.pingsSent.delete(this.pingSeq - OUTSTANDING_PINGS);
    this.sendFrame({ op: 'ping', n: this.pingSeq, t: now, rtt: this.rtt.rttMs });
  }

  // ---- Inbound -------------------------------------------------------------------------------

  private handleFrame(data: unknown): void {
    if (this.ended) return;
    this.lastHeardAt = this.now();
    const frame = parseServerFrame(data);
    if (frame === null) return;
    if (frame.s !== undefined) {
      // Already processed before the socket dropped: the replay after a resume sends it again.
      if (frame.s <= this.lastSeq) return;
      this.lastSeq = frame.s;
    }
    this.dispatch(frame);
    if (!this.ended && !this.resuming && this.lastSeq - this.ackedSeq >= ACK_EVERY_FRAMES) this.sendAck();
  }

  private dispatch(frame: ServerFrame): void {
    if ('m' in frame) {
      this.handleGameFrame(frame.f, frame.m);
      return;
    }
    switch (frame.op) {
      case 'ready':
        if (this.resuming) {
          this.handleResumeReady(frame.proto);
          return;
        }
        if (this.handshakeDone) return;
        if (frame.proto !== SERVER_PROTOCOL_VERSION) {
          this.lose(VERSION_MISMATCH_MESSAGE, 'versionMismatch');
          return;
        }
        this.handshakeDone = true;
        this.sessionToken = frame.sessionToken ?? null;
        if (this.start.role === 'host') this.sendFrame({ op: 'create', username: this.start.username, maxPlayers: this.start.maxPlayers });
        else this.sendFrame({ op: 'join', code: this.start.code, username: this.start.username, rejoinToken: this.start.rejoinToken, features: [...CLIENT_FEATURES] });
        return;
      case 'resumed':
        if (this.resuming && this.resumeSent) this.finishResume(frame.sessionToken);
        return;
      case 'away':
      case 'back':
        if (frame.slot === this.ownSlotValue && (this.role === 'host' || this.welcomed)) return;
        if (frame.op === 'away') this.callbacks.onPeerAway?.(frame.slot);
        else this.callbacks.onPeerBack?.(frame.slot);
        return;
      case 'created':
        if (this.role !== 'host' || this.code !== '') return;
        this.code = frame.code;
        this.settleHost?.();
        return;
      case 'joinRequest':
        if (this.role === 'host' && this.code !== '') this.handleJoinRequest(frame);
        return;
      case 'admitted':
        if (this.role !== 'host') return;
        this.liveSlots.add(frame.slot);
        this.kickedSlots.delete(frame.slot);
        this.callbacks.onConnected(frame.slot);
        return;
      case 'memberLeft':
        if (this.role === 'host') this.handleMemberLeft(frame.slot);
        return;
      case 'expired':
        if (this.role === 'host') this.whenHelloSettles(frame.slot, () => this.callbacks.onReservationExpired?.(frame.slot));
        return;
      case 'rejected':
        this.handleRejected(frame.reason);
        return;
      case 'pong': {
        const sentAt = this.pingsSent.get(frame.n);
        if (sentAt === undefined) return;
        this.pingsSent.delete(frame.n);
        this.rtt.add(this.now() - sentAt);
        return;
      }
      case 'quality':
        this.memberRtts.clear();
        for (const member of frame.members) this.memberRtts.set(member.slot, member.rttMs);
        return;
      case 'roomClosed':
        this.handleRoomClosed();
        return;
      default:
        return;
    }
  }

  /** A game message with the server's sender stamp. The same checks PeerConnection runs, with `f`
   * as the link it came in on, plus: nothing claiming to come from this client itself, no P2P mesh
   * types, no handshake types (the server answers those with ops), and one welcome, before any
   * other game traffic matters. */
  private handleGameFrame(from: PlayerSlot, message: NetworkMessage): void {
    if (!this.handshakeDone || (from === this.ownSlotValue && (this.role === 'host' || this.welcomed))) return;
    if (DROPPED_TYPES.has(message.type) || message.type === 'hello' || message.type === 'roomFull') return;
    if (!acceptsFromSender(message, from, this.role)) return;
    if (message.type === 'welcome') {
      if (this.role !== 'guest' || this.welcomed || message.yourSlot === HOST_SLOT) return;
      this.ownSlotValue = message.yourSlot;
      this.welcomed = true;
      this.callbacks.onConnected(message.yourSlot);
    }
    this.callbacks.onMessage(message, from);
  }

  /** Section 4.2, steps 3 to 5: the server already assigned the slot; the host's own logic decides
   * the welcome (or full, or outdated), which goes back as joinAnswer. */
  private handleJoinRequest(op: Extract<ServerFrame, { op: 'joinRequest' }>): void {
    const request: HelloInFlight = { slot: op.slot, deferred: [], settled: false };
    // A newer join for the same slot (a reload, a second tab) supersedes the older: the server has
    // already closed that one (4011) and applies the next answer for the slot to the newer.
    const older = this.hellosInFlight.get(op.slot);
    this.hellosInFlight.set(op.slot, request);
    if (older) older.settled = true;
    let result: HostHelloResult | Promise<HostHelloResult> | undefined;
    try {
      result = this.callbacks.onHostHello?.({
        username: op.username,
        rejoinToken: op.rejoinToken,
        features: op.features,
        peerId: op.peerId,
        assigned: { outcome: op.outcome, slot: op.slot },
      });
    } catch {
      result = 'full';
    }
    void Promise.resolve(result).then(
      (answer) => this.answerJoin(request, answer),
      () => this.answerJoin(request, 'full'),
    );
  }

  private answerJoin(request: HelloInFlight, answer: HostHelloResult | undefined): void {
    const current = this.hellosInFlight.get(request.slot) === request;
    if (current) this.hellosInFlight.delete(request.slot);
    if (!this.ended && !request.settled && current) {
      // The welcome must name the slot the server assigned, or the server drops it and the guest
      // waits out its answer timeout; turn it away at once instead.
      if (answer && answer !== 'full' && answer !== 'outdated' && answer.yourSlot === request.slot) {
        this.sendFrame({ op: 'joinAnswer', slot: request.slot, welcome: answer });
      } else {
        this.sendFrame({ op: 'joinAnswer', slot: request.slot, reject: answer === 'outdated' ? 'outdated' : 'full' });
      }
    }
    if (this.ended) return;
    for (const event of request.deferred) event();
  }

  /** Host: a guest left. Its own admitted socket: at once. One the host kicked: already handled by
   * the caller (disconnectGuest), so silent. A join still waiting on onHostHello: once that hello
   * resolves, and its answer is not sent. */
  private handleMemberLeft(slot: PlayerSlot): void {
    if (this.liveSlots.delete(slot)) {
      this.callbacks.onPeerDisconnected(slot);
      return;
    }
    if (this.kickedSlots.delete(slot)) return;
    this.whenHelloSettles(slot, () => this.callbacks.onPeerDisconnected(slot));
  }

  /** Run `event` now, or after the in-flight hello for `slot` resolves (which then sends no answer). */
  private whenHelloSettles(slot: PlayerSlot, event: () => void): void {
    const request = this.hellosInFlight.get(slot);
    if (!request) {
      event();
      return;
    }
    request.settled = true;
    request.deferred.push(event);
  }

  /** Section 5.2: `full` and `outdated` read as today's roomFull message followed by the host
   * closing the connection; `notFound` and `busy` end the attempt with an error. */
  private handleRejected(reason: RejectReason): void {
    this.end(reason === 'full' || reason === 'outdated' ? 'roomFull' : 'silent');
    if (reason === 'full' || reason === 'outdated') {
      this.callbacks.onMessage(reason === 'outdated' ? { type: 'roomFull', reason: 'outdated' } : { type: 'roomFull' }, HOST_SLOT);
    } else if (reason === 'notFound') {
      this.callbacks.onError(ROOM_NOT_FOUND_MESSAGE, 'roomNotFound');
    } else {
      this.callbacks.onError(SERVER_BUSY_MESSAGE, 'other');
    }
    this.closeSocket();
  }

  /** The room is gone. A guest reads it as the host leaving (section 4.4); the host, whose room the
   * server ended (idle, age, shutdown), as losing the server. */
  private handleRoomClosed(): void {
    this.end('silent');
    if (this.role === 'guest') this.callbacks.onPeerDisconnected(HOST_SLOT);
    else this.callbacks.onError(SERVER_ROOM_CLOSED_MESSAGE, 'serverLost');
    this.closeSocket();
  }

  private handleClose(code: number): void {
    if (this.resuming) {
      this.resumeAttemptFailed(code);
      return;
    }
    this.clearTimers();
    if (!this.opened && !this.ended) {
      this.attemptFailed(this.socket);
      return;
    }
    if (this.canResume() && !RESUME_FINAL_CLOSE_CODES.has(code)) {
      this.beginResume();
      return;
    }
    this.socket = null;
    const outcome = this.ended ? this.closeOutcome : 'report';
    this.end('silent');
    if (outcome === 'silent') return;
    if (outcome === 'roomFull') {
      this.callbacks.onPeerDisconnected(HOST_SLOT);
      return;
    }
    this.reportClose(code);
  }

  /** What a lost socket means to the game, by its close code. */
  private reportClose(code: number): void {
    if (code === SERVER_CLOSE.accessDenied) {
      this.callbacks.onError(ACCESS_DENIED_MESSAGE, 'accessDenied');
    } else if (code === SERVER_CLOSE.versionMismatch) {
      this.callbacks.onError(VERSION_MISMATCH_MESSAGE, 'versionMismatch');
    } else if (this.role === 'guest' && (code === SERVER_CLOSE.kicked || code === SERVER_CLOSE.replaced || code === SERVER_CLOSE.roomClosed)) {
      // What P2P shows when the host closes a guest's connection.
      this.callbacks.onPeerDisconnected(HOST_SLOT);
    } else if (code === SERVER_CLOSE.roomClosed) {
      this.callbacks.onError(SERVER_ROOM_CLOSED_MESSAGE, 'serverLost');
    } else {
      this.callbacks.onError(SERVER_LOST_MESSAGE, 'serverLost');
    }
  }

  // ---- Resume (section 5.6) ------------------------------------------------------------------

  /** In a room the server holds for this client, with a token to come back with. */
  private canResume(): boolean {
    return !this.ended && this.sessionToken !== null && (this.role === 'host' ? this.code !== '' : this.welcomed);
  }

  /** The socket dropped or went silent mid-room: let it go (with a code the server does not read as a
   * chosen close) and start reconnecting, for at most RESUME_WINDOW_MS. */
  private beginResume(): void {
    this.clearTimers();
    const old = this.socket;
    this.socket = null;
    if (old) {
      this.detach(old);
      try {
        old.close(RESUME_ABANDON_CLOSE);
      } catch {
        // Already gone.
      }
    }
    this.resuming = true;
    this.resumeAttempt = 0;
    this.pingsSent.clear();
    this.resumeDeadline = setTimeout(() => {
      this.resumeDeadline = null;
      this.giveUpResume(null);
    }, RESUME_WINDOW_MS);
    this.scheduleResumeAttempt();
  }

  private scheduleResumeAttempt(): void {
    const delay = resumeRetryDelay(this.resumeAttempt, this.random);
    this.resumeAttempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.resumeSent = false;
      this.connect();
    }, delay);
  }

  /** The attempt's `ready`: ask for the member back. */
  private handleResumeReady(proto: number): void {
    if (this.resumeSent || this.sessionToken === null) return;
    if (proto !== SERVER_PROTOCOL_VERSION) {
      this.giveUpResume(SERVER_CLOSE.versionMismatch);
      return;
    }
    this.resumeSent = true;
    this.sendFrame({ op: 'resume', sessionToken: this.sessionToken, lastSeq: this.lastSeq });
  }

  /** Back: the new token, the usual ticks, then whatever the game sent meanwhile. The replay follows
   * from the server. */
  private finishResume(sessionToken: string): void {
    this.sessionToken = sessionToken;
    this.resuming = false;
    this.resumeSent = false;
    this.resumeAttempt = 0;
    this.clearResumeDeadline();
    this.clearAttemptTimer();
    // The server forgot everything up to the lastSeq this resume carried.
    this.ackedSeq = this.lastSeq;
    this.lastHeardAt = this.now();
    this.hiddenSeen = false;
    this.tickTimer = setInterval(() => this.tick(), PING_INTERVAL_MS);
    const socket = this.socket;
    const queued = this.queued.splice(0);
    this.queuedChars = 0;
    for (const text of queued) {
      try {
        socket?.send(text);
      } catch {
        // The close event reports a dead socket.
      }
    }
  }

  /** This attempt failed: try again after the next wait, unless the server said there is nothing to
   * resume. The window's deadline ends the retries. */
  private resumeAttemptFailed(code: number | null): void {
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.detach(socket);
      try {
        socket.close(RESUME_ABANDON_CLOSE);
      } catch {
        // Already gone.
      }
    }
    if (this.ended) return;
    if (code !== null && RESUME_FINAL_CLOSE_CODES.has(code)) {
      this.giveUpResume(code);
      return;
    }
    this.scheduleResumeAttempt();
  }

  /** No resume: the window ran out (`code` null), the server refused, or the queue overflowed. The
   * game hears what the lost socket would have meant without resume. */
  private giveUpResume(code: number | null): void {
    if (this.ended) return;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.detach(socket);
      try {
        socket.close(SERVER_CLOSE.normal);
      } catch {
        // Already gone.
      }
    }
    this.end('silent');
    this.reportClose(code ?? CLOSE_ABNORMAL);
  }

  private clearResumeDeadline(): void {
    if (this.resumeDeadline !== null) clearTimeout(this.resumeDeadline);
    this.resumeDeadline = null;
  }

  private sendAck(): void {
    this.ackedSeq = this.lastSeq;
    this.sendFrame({ op: 'ack', seq: this.lastSeq });
  }

  // ---- Ending --------------------------------------------------------------------------------

  /** The session is over; `outcome` is what the socket's close may still report. */
  private end(outcome: CloseOutcome): void {
    if (!this.ended) this.closeOutcome = outcome;
    this.ended = true;
    this.resuming = false;
    this.clearTimers();
    this.clearResumeDeadline();
    this.queued.length = 0;
    this.queuedChars = 0;
    this.hellosInFlight.clear();
    this.settleHost?.();
  }

  /** Ends with an error and closes the socket without reporting its close again. */
  private fail(message: string, kind: TransportErrorKind): void {
    if (this.ended) return;
    this.end('silent');
    this.callbacks.onError(message, kind);
    this.closeSocket();
  }

  /** The socket is open but the session is not usable (silence, a newer protocol). */
  private lose(message: string, kind: TransportErrorKind = 'serverLost'): void {
    this.fail(message, kind);
  }

  private closeSocket(code = SERVER_CLOSE.normal): void {
    const socket = this.socket;
    if (!socket) return;
    try {
      socket.close(code);
    } catch {
      this.socket = null;
    }
  }

  private detach(socket: SocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
  }

  private clearAttemptTimer(): void {
    if (this.attemptTimer !== null) clearTimeout(this.attemptTimer);
    this.attemptTimer = null;
  }

  private clearTimers(): void {
    this.clearAttemptTimer();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  // ---- Outbound ------------------------------------------------------------------------------

  /** One frame, if the socket is open. A frame over this client's cap (the host's is larger, for
   * the mid-match welcome) is dropped here rather than have the server close the socket (1009).
   * While reconnecting, a frame worth keeping is queued for after `resumed` instead; a queue past the
   * resume buffer's bounds ends the resume, as it does on the server. */
  private sendFrame(frame: ClientFrame): void {
    const socket = this.socket;
    const queue = this.resuming && isQueueable(frame);
    if (!queue && (!socket || socket.readyState !== SOCKET_OPEN)) return;
    let text: string;
    try {
      text = encodeClientFrame(frame);
    } catch {
      return;
    }
    const cap = this.role === 'host' ? HOST_FRAME_MAX_BYTES : SERVER_FRAME_MAX_BYTES;
    // UTF-8 is at most three bytes per UTF-16 unit, so only a long frame needs counting.
    if (text.length * 3 > cap && new TextEncoder().encode(text).length > cap) return;
    if (queue) {
      this.enqueue(text);
      return;
    }
    try {
      socket?.send(text);
    } catch {
      // The close event reports a dead socket.
    }
  }

  private enqueue(text: string): void {
    if (this.queued.length >= RESUME_BUFFER_MAX_FRAMES || this.queuedChars + text.length > RESUME_BUFFER_MAX_BYTES) {
      // Given up from a timer, not inside the game's own send call.
      this.clearResumeDeadline();
      this.resumeDeadline = setTimeout(() => {
        this.resumeDeadline = null;
        this.giveUpResume(null);
      }, 0);
      return;
    }
    this.queued.push(text);
    this.queuedChars += text.length;
  }

  /** Host: to every guest (the server fans out by type). Guest: into the room, where the server
   * routes it to the host or to everyone, as the host relayed it on P2P. */
  send(message: NetworkMessage): void {
    if (this.ended) return;
    this.sendFrame({ m: message });
  }

  /** Host: to one admitted guest. A guest has one link, so sending to the host is send(). */
  sendTo(slot: PlayerSlot, message: NetworkMessage): void {
    if (this.ended) return;
    if (this.role === 'host') {
      if (this.liveSlots.has(slot)) this.sendFrame({ m: message, to: slot });
    } else if (slot === HOST_SLOT) {
      this.sendFrame({ m: message });
    }
  }

  /** The server already passed every relayable message to everyone it concerns. */
  relay(_message: NetworkMessage, _fromSlot: PlayerSlot): void {}

  /** Host: has the server close that guest (4010). Like PeerConnection, the caller has already done
   * its own removal, so the memberLeft that follows is not reported. */
  disconnectGuest(slot: PlayerSlot): void {
    if (this.role !== 'host' || !this.liveSlots.delete(slot)) return;
    this.kickedSlots.add(slot);
    this.sendFrame({ op: 'kick', slot });
  }

  /** Round trip to each other member: this client's own to the server plus theirs, from the
   * server's last quality broadcast (section 6.1). Route 'server', which the HUD prints without a
   * suffix. */
  async connectionQuality(): Promise<Map<PlayerSlot, ConnectionQuality>> {
    const own: ConnectionQuality = { rttMs: this.rtt.rttMs, route: 'server' };
    const result = new Map<PlayerSlot, ConnectionQuality>();
    for (const [slot, rttMs] of this.memberRtts) {
      if (slot === this.ownSlotValue && (this.role === 'host' || this.welcomed)) continue;
      result.set(slot, combineRelayedQuality(own, { rttMs, relay: false }));
    }
    return result;
  }

  /** This client's own measured round trip to the server and its jitter (for telemetry, WP 12). */
  serverRtt(): { rttMs: number | null; jitterMs: number | null } {
    return { rttMs: this.rtt.rttMs, jitterMs: this.rtt.jitterMs };
  }

  /** Reconnecting counts as connected: the server holds the slot and the game must not see a drop. */
  isConnectedTo(slot: PlayerSlot): boolean {
    if (this.ended || (!this.resuming && this.socket?.readyState !== SOCKET_OPEN)) return false;
    return this.role === 'host' ? this.liveSlots.has(slot) : this.welcomed && slot === HOST_SLOT;
  }

  isReconnecting(): boolean {
    return this.resuming;
  }

  ownRole(): MultiplayerRole {
    return this.role;
  }

  ownSlot(): PlayerSlot {
    return this.ownSlotValue;
  }

  /** Full handoff, not a merge, as PeerConnection.setCallbacks. */
  setCallbacks(callbacks: TransportCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Leaves the room (the server tells the others) and closes the socket; nothing is reported after. */
  dispose(): void {
    const wasEnded = this.ended;
    this.end('silent');
    if (!wasEnded) this.sendFrame({ op: 'leave' });
    const socket = this.socket;
    if (socket && !this.opened) {
      this.socket = null;
      this.detach(socket);
    }
    try {
      socket?.close(SERVER_CLOSE.normal);
    } catch {
      // Already gone.
    }
  }

  /** No WebRTC leg in release 1 (section 7.1). */
  fastChannelReadyCount(): number {
    return 0;
  }

  /** No direct links in server mode (section 6.2). */
  directLinksReady(): number {
    return 0;
  }
}
