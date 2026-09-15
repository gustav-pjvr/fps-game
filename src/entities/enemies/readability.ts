/**
 * Two small rules that make enemies readable (enemy AI v2, step 5 - docs/enemy-ai-v2.md), kept
 * apart from the combat code so they are unit-tested on their own. Pure: settings arrive as
 * arguments, the clock as `dt`.
 */

/**
 * The long-shot telegraph. Before the first shot of each burst, an enemy lining up a long shot
 * shows a glint and holds that shot until the glint has had `leadTime` to register, so a player at
 * range always gets a fair moment to duck. A shot in the middle of a burst does not glint again: the
 * player already knows where it is coming from. The firing step reports each burst's end
 * (onBurstEnded): inferring it from the shot counter missed one-shot bursts, the Ridge Walker's,
 * whose counter goes 0, 1, 0 inside a single step, so it glinted before its first shot only.
 */
export class GlintTelegraph {
  private shownForThisBurst = false;

  /**
   * Call just before each firing step. `eligible` is whether this shot counts as a telegraphed long
   * shot (the right archetype, a shooter, a sightline, far enough away). Returns whether to show a
   * glint now, and the least burst cooldown to hold the shot for (0 when there is nothing to hold).
   */
  beforeFiring(
    eligible: boolean,
    burstShotsFired: number,
    burstCooldown: number,
    leadTime: number,
  ): { showGlint: boolean; holdCooldown: number } {
    if (burstShotsFired > 0 || !eligible || this.shownForThisBurst || burstCooldown > leadTime) {
      return { showGlint: false, holdCooldown: 0 };
    }
    this.shownForThisBurst = true;
    return { showGlint: true, holdCooldown: leadTime };
  }

  /** A shot just finished its burst: the next burst gets its own glint. */
  onBurstEnded(): void {
    this.shownForThisBurst = false;
  }

  /** The enemy stopped shooting (lost the token, moved, lost sight): its next burst starts fresh. */
  reset(): void {
    this.shownForThisBurst = false;
  }
}

/**
 * Heavy-hit stagger. A hit of at least `threshold` damage knocks the enemy off balance for
 * `duration` - it neither moves nor fires - so a big hit visibly lands instead of being shrugged
 * off. A lighter hit during a stagger does not extend it; another heavy hit starts it over.
 */
export class StaggerState {
  private remaining = 0;

  constructor(
    private readonly threshold: number,
    private readonly duration: number,
  ) {}

  get active(): boolean {
    return this.remaining > 0;
  }

  /** How far off balance, 0 to 1, for the visual lurch: full at the hit, easing back as it ends. */
  get lurch(): number {
    if (this.remaining <= 0 || this.duration <= 0) return 0;
    const t = this.remaining / this.duration;
    return Math.sin((t * Math.PI) / 2);
  }

  /** Returns true when this hit starts a stagger. */
  onHit(amount: number): boolean {
    if (amount < this.threshold) return false;
    this.remaining = this.duration;
    return true;
  }

  update(dt: number): void {
    if (this.remaining > 0) this.remaining = Math.max(0, this.remaining - dt);
  }

  reset(): void {
    this.remaining = 0;
  }
}
