/** How a gun's shots scatter and how it kicks (docs/gun-handling.md). Pure: WeaponManager feeds it
 * the weapon's numbers and the state of the hand holding it.
 *
 * Two different things move a shot off the point of aim, and they are kept apart here because they
 * come from different places:
 * - **Spread** is where the round goes relative to the sights. A gun's own (mechanical) error is
 *   tiny: a service rifle holds 3 to 4 minutes of angle, a sniper rifle half of one. What makes a
 *   shot from the hip miss is the shooter pointing without sights, and what makes a long burst
 *   scatter is the shooter losing the sight picture (bloom). A shotgun is the exception: its
 *   pattern is the gun's own.
 * - **Recoil** moves the sights themselves. A burst climbs for its first few rounds, then the
 *   shooter catches it and it settles into a smaller climb with a side to side weave. How hard a
 *   gun kicks follows its cartridge and its weight. */

/** A gun's scatter, as half-angles of the cone in radians. */
export interface GunSpread {
  /** Aimed down the sights and standing still: the gun's own error (a shotgun's pattern). */
  readonly aimed: number;
  /** From the hip, standing still. */
  readonly hip: number;
  /** Added from the hip at full movement speed; a quarter of it when aimed. */
  readonly moving: number;
  /** Added per shot of sustained fire when aimed (twice that from the hip), up to `bloomMax`. */
  readonly bloomPerShot: number;
  readonly bloomMax: number;
}

/** How a gun kicks, in radians of view per shot. */
export interface GunRecoil {
  /** Upward kick of one shot. */
  readonly kick: number;
  /** Largest sideways kick of one shot. */
  readonly side: number;
  /** Shots of a burst that climb at full strength before the shooter catches it. */
  readonly climbShots: number;
  /** Share of the kick each later shot still climbs by. */
  readonly sustain: number;
  /** Which way and how strongly the burst pulls sideways while it climbs, -1 (right) to 1 (left). */
  readonly drift: number;
  /** Share of the kick left when aimed and shouldered. */
  readonly aimed: number;
}

/** Seconds without a shot after which a burst is over: the next shot is a first shot again. */
export const SPRAY_RESET_SECONDS = 0.38;
/** Seconds bloom takes to settle from its most to nothing once the firing stops. */
export const BLOOM_SETTLE_SECONDS = 0.45;
/** How far through its weave one shot of sustained fire moves the burst (radians of phase). */
const WEAVE_STEP = 0.85;
/** Share of the sideways kick that is random from shot to shot; the rest is the gun's pattern. */
const SIDE_JITTER = 0.35;
/** Share of the hip's movement penalty that still applies when aimed. */
const AIMED_MOVING_SHARE = 0.25;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** The cone a shot is drawn from: `aim` is 0 at the hip to 1 fully aimed, `bloom` what sustained
 * fire has built up (see SprayState), `moving` 0 standing to 1 at full speed. */
export function spreadForShot(spread: GunSpread, aim: number, bloom: number, moving: number): number {
  const a = clamp01(aim);
  const base = spread.hip + (spread.aimed - spread.hip) * a;
  const fromMoving = spread.moving * clamp01(moving) * (1 - (1 - AIMED_MOVING_SHARE) * a);
  return base + fromMoving + bloom * (2 - a);
}

/** The kick of shot number `shotIndex` of a burst (0 is its first). `jitter` is a random number
 * from -1 to 1. Returns the upward kick and the sideways one (positive is to the left). */
export function recoilForShot(recoil: GunRecoil, shotIndex: number, aim: number, jitter: number): { kick: number; side: number } {
  const scale = 1 + (recoil.aimed - 1) * clamp01(aim);
  const climbing = shotIndex < recoil.climbShots;
  const kick = recoil.kick * (climbing ? 1 : recoil.sustain) * scale;
  // While it climbs the burst pulls one way; once caught it weaves from side to side around that.
  const pattern = climbing
    ? recoil.drift
    : recoil.drift * 0.3 + Math.sin((shotIndex - recoil.climbShots + 1) * WEAVE_STEP);
  const side = recoil.side * (pattern * (1 - SIDE_JITTER) + jitter * SIDE_JITTER) * scale;
  return { kick, side };
}

/** The state of one burst: how many shots it has had, and the bloom they have built up. */
export class SprayState {
  private shots = 0;
  private sinceShot = Infinity;
  private bloomValue = 0;

  /** The index the next shot will have in its burst. */
  get shotIndex(): number {
    return this.shots;
  }

  get bloom(): number {
    return this.bloomValue;
  }

  /** Whether a burst is still going (the last shot was a moment ago). */
  get firing(): boolean {
    return this.sinceShot < SPRAY_RESET_SECONDS;
  }

  update(dt: number, spread: GunSpread): void {
    this.sinceShot += dt;
    if (this.sinceShot >= SPRAY_RESET_SECONDS) this.shots = 0;
    if (this.bloomValue > 0) this.bloomValue = Math.max(0, this.bloomValue - (spread.bloomMax / BLOOM_SETTLE_SECONDS) * dt);
  }

  /** A shot was fired: read `shotIndex` and `bloom` for it before calling this. */
  shot(spread: GunSpread): void {
    this.shots++;
    this.sinceShot = 0;
    this.bloomValue = Math.min(spread.bloomMax, this.bloomValue + spread.bloomPerShot);
  }

  /** Another weapon is in hand: its burst starts fresh. */
  reset(): void {
    this.shots = 0;
    this.sinceShot = Infinity;
    this.bloomValue = 0;
  }
}

/** One minute of angle in radians. Spreads are half-angles: a gun that groups N minutes across has
 * an `aimed` spread of N / 2 minutes. */
export const MOA = Math.PI / (180 * 60);
