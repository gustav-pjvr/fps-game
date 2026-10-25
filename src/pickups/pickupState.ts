import { PICKUP_RESPAWN_SECONDS, type PickupKind } from './pickupConfig.ts';

/** The outcome of an accepted claim: the pickup is now taken and returns in `respawnIn` seconds. */
export interface PickupClaimGrant {
  readonly id: number;
  readonly respawnIn: number;
}

/** Which pickups are on the map and which are away, for one match. The authority (single-player,
 * or the multiplayer host) calls `claim` and `tick`; a follower (a guest) only mirrors what the host
 * broadcast through `applyTaken`, `applyRespawned` and `applyAvailability`. Pure bookkeeping: it
 * knows nothing of positions, players or the network. */
export class PickupBoard {
  private readonly available: boolean[];
  /** Seconds left until each taken pickup returns; 0 while it is on the map or, on a follower,
   * because the host owns the timer. */
  private readonly remaining: number[];
  private respawnOverride: number | null = null;

  constructor(
    private readonly kinds: readonly PickupKind[],
    private readonly respawnSeconds: Readonly<Record<PickupKind, number>> = PICKUP_RESPAWN_SECONDS,
  ) {
    this.available = kinds.map(() => true);
    this.remaining = kinds.map(() => 0);
  }

  get count(): number {
    return this.kinds.length;
  }

  isValidId(id: unknown): id is number {
    return Number.isInteger(id) && (id as number) >= 0 && (id as number) < this.kinds.length;
  }

  isAvailable(id: number): boolean {
    return this.available[id] === true;
  }

  /** Seconds until pickup `id` returns on the authority, 0 when it is on the map. */
  secondsUntilReturn(id: number): number {
    return this.remaining[id] ?? 0;
  }

  /** Test hook: every pickup taken from now on returns after `seconds` instead of its own time
   * (null puts the real times back). Pickups already away keep their timers. */
  setRespawnOverride(seconds: number | null): void {
    this.respawnOverride = seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  /** Authority: the first claim on a pickup that is on the map takes it; any later claim, an
   * unknown id or a pickup already away gets null. */
  claim(id: number): PickupClaimGrant | null {
    if (!this.isValidId(id) || !this.available[id]) return null;
    const respawnIn = this.respawnOverride ?? this.respawnSeconds[this.kinds[id]!];
    this.available[id] = false;
    this.remaining[id] = respawnIn;
    return { id, respawnIn };
  }

  /** Authority: counts the timers down and returns the ids that came back this call. */
  tick(dt: number): number[] {
    if (!(dt > 0) || !Number.isFinite(dt)) return [];
    const returned: number[] = [];
    for (let id = 0; id < this.remaining.length; id++) {
      if (this.available[id] || this.remaining[id]! <= 0) continue;
      this.remaining[id] = this.remaining[id]! - dt;
      if (this.remaining[id]! <= 0) {
        this.remaining[id] = 0;
        this.available[id] = true;
        returned.push(id);
      }
    }
    return returned;
  }

  /** Follower: the host says pickup `id` was taken. False when the id is unknown. */
  applyTaken(id: number): boolean {
    if (!this.isValidId(id)) return false;
    this.available[id] = false;
    this.remaining[id] = 0;
    return true;
  }

  /** Follower: the host says pickup `id` is back. False when the id is unknown or it already was. */
  applyRespawned(id: number): boolean {
    if (!this.isValidId(id) || this.available[id]) return false;
    this.available[id] = true;
    this.remaining[id] = 0;
    return true;
  }

  /** Everything back on the map (a practice reset). Returns the ids that were away. */
  resetAll(): number[] {
    const changed: number[] = [];
    for (let id = 0; id < this.available.length; id++) {
      if (!this.available[id]) changed.push(id);
      this.available[id] = true;
      this.remaining[id] = 0;
    }
    return changed;
  }

  /** The wire form of the whole board: one character per pickup, '1' on the map, '0' away. */
  encodeAvailability(): string {
    return this.available.map((on) => (on ? '1' : '0')).join('');
  }

  /** Follower: adopts a host's full state (resync). A string of the wrong length or with any other
   * character is ignored whole. Returns the ids whose state changed, or null when ignored. */
  applyAvailability(encoded: unknown): number[] | null {
    if (typeof encoded !== 'string' || encoded.length !== this.available.length || !/^[01]*$/.test(encoded)) return null;
    const changed: number[] = [];
    for (let id = 0; id < encoded.length; id++) {
      const on = encoded[id] === '1';
      if (on !== this.available[id]) changed.push(id);
      this.available[id] = on;
      this.remaining[id] = 0;
    }
    return changed;
  }
}
