import {
  HELLO_FEATURE_MAX_LENGTH,
  HELLO_MAX_FEATURES,
  HELLO_TOKEN_MAX_LENGTH,
  HELLO_USERNAME_MAX_LENGTH,
  HOST_SLOT,
  isNetworkMessage,
  PLAYER_SLOT_COUNT,
  type NetworkMessage,
  type PlayerSlot,
  type WelcomeMessage,
} from './protocol.ts';

/**
 * The relay server's wire envelope (docs/server-relay-design.md, section 5), shared by the server
 * and the browser client. Pure: no DOM, no Three.js, no Node APIs. Every frame a client sends is
 * untrusted, so each one passes parseClientFrame, which accepts exactly the shapes below and nothing
 * else (unknown op, wrong field type, extra field, over-long string: null). Game messages inside a
 * frame are checked with isNetworkMessage, the same gate every client runs.
 */

/** Bumped only when the envelope or a server rule breaks compatibility (section 5.4). */
export const SERVER_PROTOCOL_VERSION = 1;

/** Largest frame a guest (or a socket not yet in a room) may send (section 7.4); the socket layer
 * enforces it in bytes, and parseClientFrame checks the text length again so the core never relies
 * on the shell alone. */
export const SERVER_FRAME_MAX_BYTES = 64 * 1024;
/** Largest frame a host may send: its joinAnswer carries the mid-match welcome, whose largest legal
 * form (4096-entry door, breaker, valleyDoors and deadLamps lists) is above 64 KiB. */
export const HOST_FRAME_MAX_BYTES = 128 * 1024;

/** Room codes keep today's format (section 4.1): PeerConnection's generateRoomCode alphabet. */
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** A join's code is any short string, so a mistyped one is answered notFound rather than refused. */
export const ROOM_CODE_INPUT_MAX_LENGTH = 16;

export const SERVER_BUILD_MAX_LENGTH = 32;
export const ACCESS_CODE_MAX_LENGTH = 128;
/** Highest round trip a client may report; the server clamps to this (section 6.1). */
export const QUALITY_RTT_MAX_MS = 5000;
/** A create may ask for any count up to this; the server clamps it to its own capacity. */
export const CREATE_MAX_PLAYERS_INPUT = 255;

/** Close codes (section 5.2). `normal` (1000) closes a socket after a `rejected` or a `leave`. */
export const SERVER_CLOSE = {
  normal: 1000,
  accessDenied: 4001,
  versionMismatch: 4002,
  handshakeTimeout: 4003,
  roomClosed: 4004,
  rateLimited: 4008,
  slowConsumer: 4009,
  kicked: 4010,
  replaced: 4011,
} as const;

export type RejectReason = 'notFound' | 'full' | 'outdated' | 'busy';
export type RoomClosedReason = 'hostLeft' | 'idle' | 'expired' | 'shutdown';
export type JoinOutcomeKind = 'joined' | 'rejoined';

// ---- Client to server ------------------------------------------------------------------------

export interface HelloOp { op: 'hello'; proto: number; build: string; access: string; features?: string[] }
export interface CreateOp { op: 'create'; username: string; maxPlayers: number }
export interface JoinOp { op: 'join'; code: string; username: string; rejoinToken: string | null; features?: string[] }
export type JoinAnswerOp =
  | { op: 'joinAnswer'; slot: PlayerSlot; welcome: WelcomeMessage }
  | { op: 'joinAnswer'; slot: PlayerSlot; reject: 'full' | 'outdated' };
export interface KickOp { op: 'kick'; slot: PlayerSlot }
export interface PingOp { op: 'ping'; n: number; t: number; rtt: number | null }
export interface LeaveOp { op: 'leave' }
export type ClientOp = HelloOp | CreateOp | JoinOp | JoinAnswerOp | KickOp | PingOp | LeaveOp;

export interface ClientGameFrame { m: NetworkMessage; to?: PlayerSlot }
export type ClientFrame = ClientOp | ClientGameFrame;

// ---- Server to client ------------------------------------------------------------------------

export interface ReadyOp { op: 'ready'; proto: number; serverTime: number }
export interface CreatedOp { op: 'created'; code: string; slot: 0 }
export interface JoinRequestOp {
  op: 'joinRequest';
  slot: PlayerSlot;
  outcome: JoinOutcomeKind;
  username: string;
  rejoinToken: string | null;
  features?: string[];
  peerId: string;
}
export interface AdmittedOp { op: 'admitted'; slot: PlayerSlot }
export interface RejectedOp { op: 'rejected'; reason: RejectReason }
export interface MemberLeftOp { op: 'memberLeft'; slot: PlayerSlot }
export interface ExpiredOp { op: 'expired'; slot: PlayerSlot }
export interface PongOp { op: 'pong'; n: number; t: number }
export interface QualityOp { op: 'quality'; members: { slot: PlayerSlot; rttMs: number | null }[] }
export interface RoomClosedOp { op: 'roomClosed'; reason: RoomClosedReason }
export type ServerOp = ReadyOp | CreatedOp | JoinRequestOp | AdmittedOp | RejectedOp | MemberLeftOp | ExpiredOp | PongOp | QualityOp | RoomClosedOp;

export interface ServerGameFrame { f: PlayerSlot; m: NetworkMessage }
export type ServerFrame = ServerOp | ServerGameFrame;

// ---- Validation helpers ----------------------------------------------------------------------

type Fields = Record<string, unknown>;

const hasOnlyKeys = (value: Fields, allowed: readonly string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));
const isShortString = (value: unknown, maxLength: number): value is string => typeof value === 'string' && value.length <= maxLength;
const isNonEmptyShortString = (value: unknown, maxLength: number): value is string => isShortString(value, maxLength) && value.length > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function isServerSlot(value: unknown): value is PlayerSlot {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < PLAYER_SLOT_COUNT;
}

/** A guest's slot: any slot but the host's. */
export function isGuestSlot(value: unknown): value is PlayerSlot {
  return isServerSlot(value) && value !== HOST_SLOT;
}

/** hello's feature list limits (protocol.ts), optional as in HelloMessage. */
function isOptionalFeatures(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.length <= HELLO_MAX_FEATURES && value.every((feature) => isShortString(feature, HELLO_FEATURE_MAX_LENGTH)));
}

/** A host's welcome for the guest it is admitting: a well-formed welcome naming that guest's slot. */
export function isWelcomeFor(value: unknown, slot: PlayerSlot): value is WelcomeMessage {
  if (!isNetworkMessage(value) || value.type !== 'welcome') return false;
  return value.yourSlot === slot && typeof value.isRejoin === 'boolean' && typeof value.hostUsername === 'string' && Array.isArray(value.roster);
}

function parseOp(value: Fields): ClientOp | null {
  switch (value.op) {
    case 'hello':
      if (!hasOnlyKeys(value, ['op', 'proto', 'build', 'access', 'features'])) return null;
      if (!Number.isSafeInteger(value.proto) || (value.proto as number) < 0) return null;
      if (!isShortString(value.build, SERVER_BUILD_MAX_LENGTH) || !isNonEmptyShortString(value.access, ACCESS_CODE_MAX_LENGTH)) return null;
      if (!isOptionalFeatures(value.features)) return null;
      return value as unknown as HelloOp;
    case 'create':
      if (!hasOnlyKeys(value, ['op', 'username', 'maxPlayers'])) return null;
      if (!isShortString(value.username, HELLO_USERNAME_MAX_LENGTH)) return null;
      if (!Number.isInteger(value.maxPlayers) || (value.maxPlayers as number) < 1 || (value.maxPlayers as number) > CREATE_MAX_PLAYERS_INPUT) return null;
      return value as unknown as CreateOp;
    case 'join':
      if (!hasOnlyKeys(value, ['op', 'code', 'username', 'rejoinToken', 'features'])) return null;
      if (!isNonEmptyShortString(value.code, ROOM_CODE_INPUT_MAX_LENGTH) || !isShortString(value.username, HELLO_USERNAME_MAX_LENGTH)) return null;
      if (value.rejoinToken !== null && !isNonEmptyShortString(value.rejoinToken, HELLO_TOKEN_MAX_LENGTH)) return null;
      if (!isOptionalFeatures(value.features)) return null;
      return value as unknown as JoinOp;
    case 'joinAnswer': {
      if (!isGuestSlot(value.slot)) return null;
      if ('welcome' in value) {
        if (!hasOnlyKeys(value, ['op', 'slot', 'welcome']) || !isWelcomeFor(value.welcome, value.slot)) return null;
        return { op: 'joinAnswer', slot: value.slot, welcome: value.welcome };
      }
      if (!hasOnlyKeys(value, ['op', 'slot', 'reject']) || (value.reject !== 'full' && value.reject !== 'outdated')) return null;
      return { op: 'joinAnswer', slot: value.slot, reject: value.reject };
    }
    case 'kick':
      if (!hasOnlyKeys(value, ['op', 'slot']) || !isGuestSlot(value.slot)) return null;
      return { op: 'kick', slot: value.slot };
    case 'ping':
      if (!hasOnlyKeys(value, ['op', 'n', 't', 'rtt'])) return null;
      if (!Number.isSafeInteger(value.n) || (value.n as number) < 0 || !isFiniteNumber(value.t)) return null;
      if (value.rtt !== null && !isFiniteNumber(value.rtt)) return null;
      return { op: 'ping', n: value.n as number, t: value.t, rtt: value.rtt as number | null };
    case 'leave':
      if (!hasOnlyKeys(value, ['op'])) return null;
      return { op: 'leave' };
    default:
      return null;
  }
}

/** Parse one text frame from a client. Returns null for anything that is not exactly a known op
 * or a game frame `{ m, to? }` whose `m` passes isNetworkMessage and whose `to` is a slot, or that
 * is longer than `maxLength` (HOST_FRAME_MAX_BYTES for the host, else the guest limit). */
export function parseClientFrame(text: unknown, maxLength: number = SERVER_FRAME_MAX_BYTES): ClientFrame | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > maxLength) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const fields = value as Fields;
  if ('op' in fields) return 'm' in fields ? null : parseOp(fields);
  if (!('m' in fields) || !hasOnlyKeys(fields, ['m', 'to'])) return null;
  if (!isNetworkMessage(fields.m)) return null;
  if (fields.to !== undefined && !isServerSlot(fields.to)) return null;
  return fields.to === undefined ? { m: fields.m } : { m: fields.m, to: fields.to };
}

export const isClientGameFrame = (frame: ClientFrame): frame is ClientGameFrame => 'm' in frame;

/** Clamp a client-reported round trip into 0 to QUALITY_RTT_MAX_MS, whole milliseconds. */
export function clampReportedRtt(rtt: number | null): number | null {
  if (rtt === null || !Number.isFinite(rtt)) return null;
  return Math.round(Math.min(QUALITY_RTT_MAX_MS, Math.max(0, rtt)));
}

// ---- Encoders --------------------------------------------------------------------------------

/** Encode a server-to-client frame. JSON.stringify can throw (a message nested deep enough to blow
 * the stack); the caller treats a throw as a frame to drop. */
export function encodeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}

/** A game message as every recipient sees it, `f` stamped by the server with the true sender. */
export function encodeGameFrame(from: PlayerSlot, message: NetworkMessage): string {
  return JSON.stringify({ f: from, m: message } satisfies ServerGameFrame);
}

/** Encode a client-to-server frame (the client transport, and tests). */
export function encodeClientFrame(frame: ClientFrame): string {
  return JSON.stringify(frame);
}
