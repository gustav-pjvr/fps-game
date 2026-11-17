/** Down and revive, the co-op modes' rule for a fallen player (docs/coop.md), as numbers and a
 * pure tracker: who is down, how long each can still be revived, and how far this player's own
 * revive of a teammate has got. Each client runs one over what it hears (a teammate's fall, its
 * standing up); only the fallen player itself decides that it stands up. */

/** Seconds a downed player can still be revived, how long a teammate must hold the revive, how
 * close they must stand (m), and the health a revive restores. */
export const REVIVE_RULES = { bleedOut: 25, hold: 3, reach: 2.6, health: 40 } as const;

export interface FlatPoint {
  readonly x: number;
  readonly z: number;
}

export interface ReviveTick {
  /** The fallen teammate this player is in reach of and may revive, or null. */
  readonly target: number | null;
  /** How far this player's hold on `target` has got, 0 to 1. */
  readonly progress: number;
  /** The teammate whose revive completed this tick, or null. */
  readonly completed: number | null;
}

const IDLE: ReviveTick = { target: null, progress: 0, completed: null };

export class ReviveTracker {
  /** Fallen slot to the seconds it can still be revived for (0: out until its mode brings it back). */
  private readonly fallen = new Map<number, number>();
  private holdTarget: number | null = null;
  private holdSeconds = 0;

  /** `slot` went down now. */
  fall(slot: number): void {
    this.fallen.set(slot, REVIVE_RULES.bleedOut);
  }

  /** `slot` is on its feet again (revived, respawned, or gone from the match). */
  standUp(slot: number): void {
    this.fallen.delete(slot);
    if (this.holdTarget === slot) this.dropHold();
  }

  /** A late joiner's catch-up: `slot` was already down when this client arrived. How long ago is
   * unknown, so it gets the whole time; its own client is the judge of when it is out. */
  adopt(slot: number): void {
    if (!this.fallen.has(slot)) this.fall(slot);
  }

  isFallen(slot: number): boolean {
    return this.fallen.has(slot);
  }

  /** Seconds `slot` can still be revived for: 0 when it is out, or not down at all. */
  bleedLeft(slot: number): number {
    return this.fallen.get(slot) ?? 0;
  }

  get fallenSlots(): number[] {
    return [...this.fallen.keys()];
  }

  /** One tick. `own` is this player (null while it is itself down: the fallen revive nobody),
   * `positionOf` where a fallen teammate lies, `holding` whether the revive key is held. */
  update(dt: number, own: FlatPoint | null, positionOf: (slot: number) => FlatPoint | null, holding: boolean): ReviveTick {
    for (const [slot, left] of this.fallen) {
      if (left > 0) this.fallen.set(slot, Math.max(0, left - dt));
    }
    if (!own) {
      this.dropHold();
      return IDLE;
    }

    let target: number | null = null;
    let nearest: number = REVIVE_RULES.reach;
    for (const [slot, left] of this.fallen) {
      if (left <= 0) continue;
      const at = positionOf(slot);
      if (!at) continue;
      const distance = Math.hypot(at.x - own.x, at.z - own.z);
      if (distance <= nearest) {
        nearest = distance;
        target = slot;
      }
    }

    if (target === null || !holding) {
      this.dropHold();
      return { target, progress: 0, completed: null };
    }
    if (this.holdTarget !== target) {
      this.holdTarget = target;
      this.holdSeconds = 0;
    }
    this.holdSeconds += dt;
    if (this.holdSeconds >= REVIVE_RULES.hold) {
      this.dropHold();
      // The teammate stays on the list until its own respawn says it stood up: a second revive in
      // the meantime is harmless, and a lost message leaves it revivable.
      return { target, progress: 1, completed: target };
    }
    return { target, progress: this.holdSeconds / REVIVE_RULES.hold, completed: null };
  }

  private dropHold(): void {
    this.holdTarget = null;
    this.holdSeconds = 0;
  }
}
