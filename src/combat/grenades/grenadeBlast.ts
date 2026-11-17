import type { Vec3 } from './grenadeFlight.ts';
import { FRAG_SHAKE_SECONDS } from './grenadeTuning.ts';

/**
 * Pure pieces of a grenade going off (docs/grenades.md), kept apart from GrenadeSystem so they are
 * unit-tested without a physics world: how much of a body a frag can see past cover and how far
 * from it the body is, the facing angle a flash is judged by, and the camera shake.
 */

/** Whether nothing solid lies between `from` and `to` (GrenadeSystem casts the ray). */
export type RayClear = (from: Vec3, to: Vec3) => boolean;

/** A standing body as a blast sees it: its centre (Player.position, an enemy's, a goose's) and its
 * full height. */
export interface BlastBody {
  readonly center: Vec3;
  readonly height: number;
}

/** Where on a body the blast looks, as a share of its height above the feet, and how much of the
 * body each stands for: legs, chest and head. */
const BODY_SAMPLES: readonly { at: number; weight: number }[] = [
  { at: 0.22, weight: 0.25 },
  { at: 0.62, weight: 0.5 },
  { at: 0.92, weight: 0.25 },
];

/** How much of `body` the blast can see, 0 to 1: a ray to its legs, its chest and its head, each
 * counting for its share of the body. Behind a low wall only the head and perhaps the chest are
 * exposed, so the wall takes most of the fragments; fully behind cover nothing reaches. */
export function blastExposure(blast: Vec3, body: BlastBody, rayClear: RayClear): number {
  const feet = body.center.y - body.height / 2;
  let exposure = 0;
  for (const sample of BODY_SAMPLES) {
    if (rayClear(blast, { x: body.center.x, y: feet + body.height * sample.at, z: body.center.z })) exposure += sample.weight;
  }
  return exposure;
}

/** How far the blast is from `body`: to the nearest point of its upright middle line, so a grenade
 * at someone's feet is as close as one at their chest. */
export function blastDistance(blast: Vec3, body: BlastBody): number {
  const half = Math.max(0, body.height / 2 - 0.15);
  const y = Math.min(body.center.y + half, Math.max(body.center.y - half, blast.y));
  return Math.hypot(blast.x - body.center.x, blast.y - y, blast.z - body.center.z);
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
