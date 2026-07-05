import * as THREE from 'three';

const WORLD_Y_AXIS = new THREE.Vector3(0, 1, 0);
const WORLD_X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Applies the spread-by-two-axis-angle technique shared by the player's pellet spread
 * (WeaponManager), enemy ranged shots, and the enemy melee swing fan - previously triplicated
 * verbatim at each site. Mutates and returns `direction`, matching the call sites' existing
 * in-place style.
 *
 * Known (accepted) bias, now documented in exactly one place: two independent rotations about the
 * world Y then world X axes produce a square-ish, diagonally-biased distribution rather than a true
 * circular cone, and the axes are world-fixed rather than perpendicular to `direction` (so the
 * effective spread compresses slightly for steeply pitched directions). At the small angles used
 * everywhere in this game the difference is imperceptible - if a true uniform cone is ever wanted,
 * this is the single place to fix it.
 *
 * `rng` defaults to Math.random - combat spread is deliberately non-deterministic (matching the
 * player's own weapons), unlike patrol which draws from a seeded stream.
 */
export function applySpreadCone(
  direction: THREE.Vector3,
  halfAngleRad: number,
  rng: () => number = Math.random,
): THREE.Vector3 {
  direction.applyAxisAngle(WORLD_Y_AXIS, (rng() - 0.5) * 2 * halfAngleRad);
  direction.applyAxisAngle(WORLD_X_AXIS, (rng() - 0.5) * 2 * halfAngleRad);
  return direction;
}
