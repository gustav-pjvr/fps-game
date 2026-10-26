import {
  ENEMY_AWARENESS_DRAIN_TIME,
  ENEMY_AWARENESS_FAR_FACTOR,
  ENEMY_AWARENESS_FILL_TIME,
  ENEMY_AWARENESS_MOVEMENT_BONUS,
  ENEMY_AWARENESS_SUSPICIOUS,
  ENEMY_HEARING_RANGE,
  ENEMY_PERIPHERAL_RANGE,
  ENEMY_VIEW_HALF_ANGLE_FAR_DEG,
  ENEMY_VIEW_HALF_ANGLE_NEAR_DEG,
  ENEMY_WEAPON_LOUDNESS_RANGE,
} from '../../core/config.ts';

/**
 * Enemy perception (enemy AI v2, step 1 - docs/enemy-ai-v2.md). Replaces "in range plus one clear
 * ray means spotted, then a fixed 0.4 s beat" with an awareness meter in the style of The Last of
 * Us: sight fills it, losing sight drains it, and how fast it fills depends on distance, whether
 * the player is inside the enemy's view cone, and how fast the player is moving.
 *
 * Pure functions only (no Rapier, no three.js), so every rule here is unit-tested directly.
 */

export interface PlanarPoint {
  readonly x: number;
  readonly z: number;
}

export type AwarenessLevel = 'oblivious' | 'suspicious' | 'detected';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Half-angle of the view cone in degrees at this distance: wide up close, narrowing to
 * ENEMY_VIEW_HALF_ANGLE_FAR_DEG at detection range. Inside ENEMY_PERIPHERAL_RANGE the cone is a
 * full circle, so nobody walks past an enemy's shoulder unseen. */
export function viewHalfAngleDeg(distance: number, detectionRange: number): number {
  if (distance <= ENEMY_PERIPHERAL_RANGE) return 180;
  const t = clamp01(distance / detectionRange);
  return ENEMY_VIEW_HALF_ANGLE_NEAR_DEG + (ENEMY_VIEW_HALF_ANGLE_FAR_DEG - ENEMY_VIEW_HALF_ANGLE_NEAR_DEG) * t;
}

/** Whether `target` sits inside the view cone of an enemy at `enemy` facing `enemyYaw`. The yaw
 * follows the enemy mesh's convention (rotation.y = atan2(dx, dz)), so forward is (sin, cos). */
export function isInViewCone(enemy: PlanarPoint, enemyYaw: number, target: PlanarPoint, detectionRange: number): boolean {
  const dx = target.x - enemy.x;
  const dz = target.z - enemy.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const halfAngle = viewHalfAngleDeg(distance, detectionRange);
  if (halfAngle >= 180 || distance < 1e-6) return true;
  const cosToTarget = (Math.sin(enemyYaw) * dx + Math.cos(enemyYaw) * dz) / distance;
  return cosToTarget >= Math.cos((halfAngle * Math.PI) / 180);
}

/** How strongly a sighting at this distance fills the meter (0 beyond detection range). Full
 * strength out to half of detection range, then falling linearly to ENEMY_AWARENESS_FAR_FACTOR at
 * detection range, with a bonus for a moving player (Player.movementBobStrength, 0 to 1). The zero
 * beyond detection range is what keeps the match-start invariant: the enemy spawn ring (25 m) sits
 * outside every archetype's detection range (at most 20 m). */
export function visibilityFactor(distance: number, detectionRange: number, playerMovement: number): number {
  if (distance > detectionRange) return 0;
  const half = detectionRange / 2;
  const distanceTerm = distance <= half ? 1 : 1 - ((1 - ENEMY_AWARENESS_FAR_FACTOR) * (distance - half)) / half;
  return distanceTerm * (1 + ENEMY_AWARENESS_MOVEMENT_BONUS * clamp01(playerMovement));
}

/** How far an enemy spends a line-of-sight ray on the player. Darkness shortens acquisition only
 * (an idle or searching enemy noticing the player: detectionRange scaled by the player's
 * visibility, design section 6); an engaged enemy (alert or chase) keeps tracking a player it has
 * already found out to its leash range, so a chase in the dark does not drop at a few metres. */
export function sightRayRange(engaged: boolean, detectionRange: number, leashRange: number, visibility: number): number {
  return engaged ? leashRange : detectionRange * visibility;
}

/** One tick of the meter: fills by `seenFactor` (0 when unseen) over ENEMY_AWARENESS_FILL_TIME,
 * or drains over ENEMY_AWARENESS_DRAIN_TIME. */
export function stepAwareness(awareness: number, seenFactor: number, dt: number): number {
  if (seenFactor > 0) return Math.min(1, awareness + (seenFactor * dt) / ENEMY_AWARENESS_FILL_TIME);
  return Math.max(0, awareness - dt / ENEMY_AWARENESS_DRAIN_TIME);
}

export function awarenessLevel(awareness: number): AwarenessLevel {
  if (awareness >= 1) return 'detected';
  if (awareness >= ENEMY_AWARENESS_SUSPICIOUS) return 'suspicious';
  return 'oblivious';
}

/** How far away an enemy hears a shot from this weapon. Unknown weapon ids fall back to the old
 * single ENEMY_HEARING_RANGE, so a new weapon is never silent by accident. */
export function hearingRangeFor(weaponId: string | undefined): number {
  if (weaponId === undefined) return ENEMY_HEARING_RANGE;
  return ENEMY_WEAPON_LOUDNESS_RANGE[weaponId] ?? ENEMY_HEARING_RANGE;
}
