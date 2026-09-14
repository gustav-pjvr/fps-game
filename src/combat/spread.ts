import * as THREE from 'three';

const WORLD_Y_AXIS = new THREE.Vector3(0, 1, 0);
/** Fallback reference for building the shot's frame when it points (almost) straight up or down,
 * where `direction x WORLD_Y_AXIS` degenerates to zero. Any axis not parallel to the shot works. */
const WORLD_Z_AXIS = new THREE.Vector3(0, 0, 1);
/** Squared length below which `direction x WORLD_Y_AXIS` counts as degenerate (a unit direction
 * within ~0.006 degrees of vertical). */
const NEAR_VERTICAL_EPSILON_SQ = 1e-8;

// Scratch axes reused across calls: this runs once per pellet and per enemy swing ray, so
// allocating two vectors per call would be pure GC churn.
const shotRight = new THREE.Vector3();
const shotUp = new THREE.Vector3();

/**
 * Applies the spread-by-two-axis-angle technique shared by the player's pellet spread
 * (WeaponManager), enemy ranged shots, and the enemy melee swing fan - previously triplicated
 * verbatim at each site. Mutates and returns `direction`, matching the call sites' existing
 * in-place style.
 *
 * The two rotations are about axes perpendicular to `direction` itself: yaw about the shot's own
 * "up", then pitch about the shot's "right" (both built from `direction` before either rotation).
 * These used to be the world Y and world X axes, which only works facing -Z: facing +X or -X,
 * world X is (nearly) the shot direction itself, so the second rotation did almost nothing and
 * shotgun patterns flattened into a horizontal line depending on compass heading. Facing -Z the
 * two frames coincide, so the tuned feel there is unchanged (spread.test.ts pins that).
 *
 * Known (accepted) bias: two independent uniform angles produce a square-ish, diagonally-biased
 * distribution rather than a true circular cone. At the small angles used everywhere in this game
 * the difference is imperceptible - if a true uniform cone is ever wanted, this is the single
 * place to fix it.
 *
 * `rng` defaults to Math.random - combat spread is deliberately non-deterministic (matching the
 * player's own weapons), unlike patrol which draws from a seeded stream. Exactly two draws per
 * call, yaw first, then pitch.
 */
export function applySpreadCone(
  direction: THREE.Vector3,
  halfAngleRad: number,
  rng: () => number = Math.random,
): THREE.Vector3 {
  shotRight.crossVectors(direction, WORLD_Y_AXIS);
  if (shotRight.lengthSq() < NEAR_VERTICAL_EPSILON_SQ) shotRight.crossVectors(direction, WORLD_Z_AXIS);
  shotRight.normalize();
  shotUp.crossVectors(shotRight, direction).normalize();

  direction.applyAxisAngle(shotUp, (rng() - 0.5) * 2 * halfAngleRad);
  direction.applyAxisAngle(shotRight, (rng() - 0.5) * 2 * halfAngleRad);
  return direction;
}
