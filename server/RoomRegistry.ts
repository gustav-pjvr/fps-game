import { randomBytes, randomInt } from 'node:crypto';
import { PLAYER_SLOT_COUNT } from '../src/network/protocol.ts';
import {
  encodeServerFrame,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SERVER_CLOSE,
  type CreateOp,
  type JoinOp,
  type RejectReason,
  type ResumeOp,
  type RoomClosedReason,
} from '../src/network/serverEnvelope.ts';
import { DEFAULT_ROOM_LIMITS, DEFAULT_ROOM_TIMING, Room, type MemberSocket, type ResumeRefusal, type RoomLimits, type RoomLog, type RoomMembership, type RoomTiming } from './Room.ts';

/**
 * Every room on the relay (docs/server-relay-design.md, section 4): codes, create, lookup,
 * tombstones and the once-a-second tick that drives each room's timers. Socket-free like Room.
 */

/** From the server config (section 8.2, step 6): HNG_MAX_ROOMS and HNG_MAX_PLAYERS_PER_ROOM. */
export interface RegistryConfig {
  maxRooms: number;
  maxPlayersPerRoom: number;
}

export interface TimerApi {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface RegistryOptions {
  clock: () => number;
  /** A uniform integer in [0, max). Defaults to crypto.randomInt: a room code is a join secret. */
  randomInt?: (max: number) => number;
  /** A new session token (section 5.6). Defaults to 16 bytes of crypto.randomBytes in base64url:
   * 22 characters, the format parseClientFrame accepts in a resume. */
  sessionToken?: () => string;
  timing?: Partial<RoomTiming>;
  limits?: Partial<RoomLimits>;
  log?: RoomLog;
}

/** A closed room's code stays reserved this long (section 4.5). */
export const TOMBSTONE_MS = 10 * 60 * 1000;
/** Tombstones kept at most; the oldest goes first past this, so churn cannot grow memory forever. */
export const TOMBSTONE_MAX = 10_000;
/** Code draws before a create gives up with `busy` (section 4.1). */
export const CODE_ATTEMPTS = 20;
export const TICK_INTERVAL_MS = 1000;

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly tombstones = new Map<string, number>();
  private readonly config: RegistryConfig;
  private readonly clock: () => number;
  private readonly draw: (max: number) => number;
  private readonly drawToken: () => string;
  private readonly timing: RoomTiming;
  private readonly limits: RoomLimits;
  private readonly log: RoomLog | undefined;
  private timer: { api: TimerApi; handle: unknown } | null = null;

  constructor(config: RegistryConfig, options: RegistryOptions) {
    this.config = config;
    this.clock = options.clock;
    this.draw = options.randomInt ?? ((max) => randomInt(max));
    this.drawToken = options.sessionToken ?? (() => randomBytes(16).toString('base64url'));
    this.timing = { ...DEFAULT_ROOM_TIMING, ...options.timing };
    this.limits = { ...DEFAULT_ROOM_LIMITS, ...options.limits };
    this.log = options.log;
  }

  /** The capacity a create gets: what it asked for, within the config and the protocol's slots. */
  capacityFor(requested: number): number {
    const ceiling = Math.max(1, Math.min(Math.floor(this.config.maxPlayersPerRoom), PLAYER_SLOT_COUNT));
    return Math.max(1, Math.min(Math.floor(requested), ceiling));
  }

  /** A session token for a socket's `ready` (section 5.6). */
  newSessionToken(): string {
    return this.drawToken();
  }

  /** `create` (section 4.1): a new room with the sender in slot 0, answered `created`.
   * `sessionToken` is the one the socket's `ready` carried (null: the host cannot resume). */
  create(socket: MemberSocket, op: CreateOp, sessionToken: string | null = null): RoomMembership | null {
    this.sweepTombstones();
    if (this.rooms.size >= this.config.maxRooms) return this.refuse(socket, 'busy');
    const code = this.freshCode();
    if (code === null) return this.refuse(socket, 'busy');
    const room = new Room(socket, {
      code,
      capacity: this.capacityFor(op.maxPlayers),
      hostUsername: op.username,
      clock: this.clock,
      timing: this.timing,
      limits: this.limits,
      onClosed: (closed, reason) => this.handleClosed(closed, reason),
      log: this.log,
      hostSessionToken: sessionToken,
      newSessionToken: this.drawToken,
    });
    this.rooms.set(code, room);
    socket.send(encodeServerFrame({ op: 'created', code, slot: 0 }));
    this.log?.('roomOpen', { code, capacity: room.capacity });
    return room.hostMembership;
  }

  /** `join` (section 4.2): an unknown or tombstoned code is notFound, a full room full. */
  join(socket: MemberSocket, op: JoinOp, sessionToken: string | null = null): RoomMembership | null {
    const room = this.rooms.get(op.code);
    if (!room || room.closed) return this.refuse(socket, 'notFound');
    const result = room.join(socket, op, sessionToken);
    return typeof result === 'string' ? this.refuse(socket, result) : result;
  }

  /** `resume` (section 5.6): the member holding this token, in whichever room, back on `socket`.
   * Nothing is sent or closed here on a refusal: the shell answers every one with the same close
   * code, so the answer says nothing about which rooms or slots exist. */
  resume(socket: MemberSocket, op: ResumeOp): RoomMembership | ResumeRefusal {
    const presented = Buffer.from(op.sessionToken, 'utf8');
    for (const room of Array.from(this.rooms.values())) {
      const result = room.resume(socket, presented, op.lastSeq);
      if (result !== null) return result;
    }
    return 'unknown';
  }

  /** Drive every room's timers and forget old tombstones; start() calls it once a second. */
  tick(): void {
    for (const room of Array.from(this.rooms.values())) room.tick();
    this.sweepTombstones();
  }

  start(timers: TimerApi): void {
    if (this.timer) return;
    this.timer = { api: timers, handle: timers.setInterval(() => this.tick(), TICK_INTERVAL_MS) };
  }

  stop(): void {
    if (!this.timer) return;
    this.timer.api.clearInterval(this.timer.handle);
    this.timer = null;
  }

  /** Close every room (a deploy or a shutdown): roomClosed shutdown, then 4004. */
  closeAll(reason: RoomClosedReason = 'shutdown'): void {
    for (const room of Array.from(this.rooms.values())) room.close(reason);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  memberCount(): number {
    let count = 0;
    for (const room of this.rooms.values()) count += room.memberCount();
    return count;
  }

  /** The open room with this code (tests and the health endpoint), never a tombstoned one. */
  roomByCode(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  isTombstoned(code: string): boolean {
    const until = this.tombstones.get(code);
    return until !== undefined && this.clock() < until;
  }

  private refuse(socket: MemberSocket, reason: RejectReason): null {
    try {
      socket.send(encodeServerFrame({ op: 'rejected', reason }));
      socket.close(SERVER_CLOSE.normal, reason);
    } catch {
      // The socket is already gone; nothing to tell it.
    }
    return null;
  }

  private freshCode(): string | null {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[this.draw(ROOM_CODE_ALPHABET.length)] ?? '';
      if (code.length !== ROOM_CODE_LENGTH) continue;
      if (!this.rooms.has(code) && !this.isTombstoned(code)) return code;
    }
    return null;
  }

  private handleClosed(room: Room, reason: RoomClosedReason): void {
    if (this.rooms.get(room.code) !== room) return;
    this.rooms.delete(room.code);
    this.tombstones.delete(room.code);
    this.tombstones.set(room.code, this.clock() + TOMBSTONE_MS);
    while (this.tombstones.size > TOMBSTONE_MAX) {
      const oldest = this.tombstones.keys().next().value;
      if (oldest === undefined) break;
      this.tombstones.delete(oldest);
    }
    this.log?.('roomTombstoned', { code: room.code, reason });
  }

  private sweepTombstones(): void {
    const now = this.clock();
    for (const [code, until] of this.tombstones) {
      if (now >= until) this.tombstones.delete(code);
    }
  }
}
