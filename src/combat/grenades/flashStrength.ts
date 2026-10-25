import {
  FLASH_FACING_BEHIND,
  FLASH_FACING_SIDE,
  FLASH_FADE_SECONDS,
  FLASH_FULL_RANGE,
  FLASH_MAX_RANGE,
  FLASH_MIN_STRENGTH,
} from './grenadeTuning.ts';

/**
 * How hard a flash grenade hits one pair of eyes (docs/grenades.md). Each client judges its own
 * player, and in single-player each enemy is judged the same way. Pure: the caller casts the line of
 * sight ray and hands in the angle between where the eyes look and the flash.
 */

/** 1 within FLASH_FULL_RANGE, falling linearly to 0 at FLASH_MAX_RANGE. */
export function flashDistanceFactor(distance: number): number {
  if (!(distance > FLASH_FULL_RANGE)) return 1;
  if (distance >= FLASH_MAX_RANGE) return 0;
  return 1 - (distance - FLASH_FULL_RANGE) / (FLASH_MAX_RANGE - FLASH_FULL_RANGE);
}

/** 1 looking straight at the flash, FLASH_FACING_SIDE at 90 degrees off, FLASH_FACING_BEHIND with
 * it straight behind; linear in the angle between those. `cosAngle` is the cosine of the angle
 * between the view direction and the direction to the flash. */
export function flashFacingFactor(cosAngle: number): number {
  const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
  const half = Math.PI / 2;
  if (angle <= half) return 1 + (FLASH_FACING_SIDE - 1) * (angle / half);
  return FLASH_FACING_SIDE + (FLASH_FACING_BEHIND - FLASH_FACING_SIDE) * ((angle - half) / half);
}

/** 0 to 1: the distance factor times the facing factor, or 0 without a line of sight. */
export function flashStrength(distance: number, cosAngle: number, lineOfSight: boolean): number {
  if (!lineOfSight) return 0;
  return flashDistanceFactor(distance) * flashFacingFactor(cosAngle);
}

/** How long a flash of `strength` lasts for eyes whose full-strength time is `maxSeconds`: nothing
 * at or below FLASH_MIN_STRENGTH, else scaled by strength. */
export function flashSeconds(strength: number, maxSeconds: number): number {
  return strength > FLASH_MIN_STRENGTH ? strength * maxSeconds : 0;
}

/** The local player's white-out: held at the flash's strength for flashSeconds, then clearing over
 * FLASH_FADE_SECONDS (scaled by strength). A second flash while still blind keeps the stronger and
 * the longer of the two. `level` (0 to 1) drives both the white overlay and the muffled hearing. */
export class FlashBlindness {
  private peak = 0;
  private hold = 0;
  private fade = 0;
  private fadeTotal = 0;

  /** Applies a flash; returns the hold time it started (0 when too weak to matter). */
  apply(strength: number, maxSeconds: number): number {
    const seconds = flashSeconds(strength, maxSeconds);
    if (seconds <= 0) return 0;
    this.peak = Math.max(this.level, strength);
    this.hold = Math.max(this.hold, seconds);
    this.fadeTotal = FLASH_FADE_SECONDS * this.peak;
    this.fade = this.fadeTotal;
    return seconds;
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    if (this.hold > 0) {
      const used = Math.min(this.hold, dt);
      this.hold -= used;
      dt -= used;
    }
    if (this.hold <= 0 && dt > 0) this.fade = Math.max(0, this.fade - dt);
  }

  get level(): number {
    if (this.hold > 0) return this.peak;
    if (this.fade <= 0 || this.fadeTotal <= 0) return 0;
    return this.peak * (this.fade / this.fadeTotal);
  }

  /** Seconds until the white-out starts to clear. */
  get holdRemaining(): number {
    return this.hold;
  }

  reset(): void {
    this.peak = 0;
    this.hold = 0;
    this.fade = 0;
    this.fadeTotal = 0;
  }
}
