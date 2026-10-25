import type { Vec3 } from './grenadeFlight.ts';
import { FRAG_CHEST_OFFSET, FRAG_HEAD_OFFSET, FRAG_SHAKE_SECONDS } from './grenadeTuning.ts';

/**
 * Pure pieces of a grenade going off (docs/grenades.md), kept apart from GrenadeSystem so they are
 * unit-tested without a physics world: the frag's wall check, the facing angle a flash is judged
 * by, and the camera shake.
 */

/** Whether nothing solid lies between `from` and `to` (GrenadeSystem casts the ray). */
export type RayClear = (from: Vec3, to: Vec3) => boolean;

/** The frag's wall check: a ray from the blast to the target's chest and one to its head
 * (`center` is the body centre, Player.position or an enemy's); blocked only when both are. */
export function blastReaches(blast: Vec3, center: Vec3, rayClear: RayClear): boolean {
  const chest = { x: center.x, y: center.y + FRAG_CHEST_OFFSET, z: center.z };
  if (rayClear(blast, chest)) return true;
  const head = { x: center.x, y: center.y + FRAG_HEAD_OFFSET, z: center.z };
  return rayClear(blast, head);
}

/** The cosine of the angle between `viewDirection` (unit length) and the direction from `eye` to
 * `flash`, for flashFacingFactor. A flash right at the eye counts as looked at. */
export function flashCosAngle(eye: Vec3, viewDirection: Vec3, flash: Vec3): number {
  const dx = flash.x - eye.x, dy = flash.y - eye.y, dz = flash.z - eye.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 1e-6) return 1;
  return (dx * viewDirection.x + dy * viewDirection.y + dz * viewDirection.z) / distance;
}

/** The unit view direction of eyes facing `yaw` on the level (an enemy's facingYaw convention:
 * forward is (sin yaw, 0, cos yaw)). */
export function yawViewDirection(yaw: number): Vec3 {
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}

/** Camera shake from frags: each blast adds its amplitude (fragShakeAmplitude) and every shake
 * fades linearly over FRAG_SHAKE_SECONDS. Overlapping blasts keep the stronger. */
export class CameraShake {
  private peak = 0;
  private remaining = 0;

  add(amplitude: number): void {
    if (!(amplitude > 0)) return;
    if (amplitude >= this.amplitude) {
      this.peak = amplitude;
      this.remaining = FRAG_SHAKE_SECONDS;
    }
  }

  update(dt: number): void {
    if (dt > 0) this.remaining = Math.max(0, this.remaining - dt);
  }

  /** Metres of camera offset right now. */
  get amplitude(): number {
    return this.remaining > 0 ? this.peak * (this.remaining / FRAG_SHAKE_SECONDS) : 0;
  }

  /** A camera offset of the current amplitude at time `seconds`: three unrelated sines per axis, so
   * it jitters without a visible rhythm. */
  offset(seconds: number): Vec3 {
    const a = this.amplitude;
    if (a <= 0) return { x: 0, y: 0, z: 0 };
    const t = seconds * 40;
    return {
      x: a * Math.sin(t * 1.13) * Math.cos(t * 0.71),
      y: a * Math.sin(t * 0.97 + 1.7) * Math.cos(t * 1.31),
      z: a * 0.5 * Math.sin(t * 1.21 + 0.4),
    };
  }

  reset(): void {
    this.peak = 0;
    this.remaining = 0;
  }
}
