import * as THREE from 'three';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import { castHitscan } from '../../combat/hitscan.ts';
import { sampleFlatZone, sampleForestZone } from '../../world/ZoneMap.ts';
import {
  ENEMY_AVOID_ANGLE_DEG,
  ENEMY_AVOID_PROBE_LENGTH,
  ENEMY_PATROL_CANDIDATE_COUNT,
  ENEMY_PATROL_POI_BIAS,
  ENEMY_ROAM_RADIUS,
  WORLD_SOFT_PUSH_START_RADIUS,
} from '../../core/config.ts';

/**
 * Picks a patrol destination within ENEMY_ROAM_RADIUS of spawn, biased toward real zone content
 * (town/forest membership via ZoneMap) over pure noise - "goal-directed," in the modest sense of
 * actually heading somewhere that reads as content rather than a uniformly random point every
 * time. Samples a handful of candidates and picks the highest-membership one with probability
 * ENEMY_PATROL_POI_BIAS, falling back to a plain random point the rest of the time (and whenever
 * no candidate landed inside any zone at all) - this is deliberately cheap (a few ZoneMap samples,
 * no grid scan) rather than precomputing/caching a POI list, since ZoneMap queries are already O(1)
 * hash-grid lookups.
 *
 * Destinations are clamped inside WORLD_SOFT_PUSH_START_RADIUS so patrol never sends an enemy
 * toward the edge-mountain ramp, where the terrain gets steep enough to read as a wall.
 */
export function pickPatrolDestination(spawnPos: THREE.Vector3, rng: () => number): THREE.Vector3 {
  let best: { x: number; z: number; membership: number } | null = null;
  let fallback: { x: number; z: number } | null = null;

  for (let i = 0; i < ENEMY_PATROL_CANDIDATE_COUNT; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = rng() * ENEMY_ROAM_RADIUS;
    const x = spawnPos.x + Math.cos(angle) * radius;
    const z = spawnPos.z + Math.sin(angle) * radius;
    const distanceFromOrigin = Math.sqrt(x * x + z * z);
    if (distanceFromOrigin >= WORLD_SOFT_PUSH_START_RADIUS) continue;

    if (!fallback) fallback = { x, z };

    const membership = Math.max(sampleFlatZone(x, z).membership, sampleForestZone(x, z).membership);
    if (membership > 0 && (!best || membership > best.membership)) {
      best = { x, z, membership };
    }
  }

  const chosen = best && rng() < ENEMY_PATROL_POI_BIAS ? best : (fallback ?? best ?? { x: spawnPos.x, z: spawnPos.z });
  return new THREE.Vector3(chosen.x, 0, chosen.z);
}

/**
 * Whisker obstacle avoidance: casts three short probes (straight ahead, and +/- ENEMY_AVOID_ANGLE_DEG)
 * from chest height and steers toward whichever is clearest, preferring straight ahead when it's
 * open. No real pathfinding - handles convex obstacles (buildings, rocks, tree trunks) reasonably;
 * concave traps are the stuck-detection reroute's job (see Enemy.ts), not this function's.
 */
export function steerWithAvoidance(
  physics: PhysicsWorld,
  chestPos: THREE.Vector3,
  desiredDir: THREE.Vector3,
  excludeCollider: RAPIER.Collider,
): THREE.Vector3 {
  const angleRad = (ENEMY_AVOID_ANGLE_DEG * Math.PI) / 180;
  const candidates = [0, angleRad, -angleRad];

  let bestDir = desiredDir;
  let bestClearance = -1;

  for (const offset of candidates) {
    const dir = desiredDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), offset);
    const hit = castHitscan(physics, chestPos, dir, ENEMY_AVOID_PROBE_LENGTH, excludeCollider);
    const clearance = hit ? hit.distance : ENEMY_AVOID_PROBE_LENGTH;
    // Slight preference for the center probe when clearances tie, so an unobstructed enemy still
    // walks straight rather than drifting toward whichever side probe happened to tie first.
    const score = offset === 0 ? clearance + 0.01 : clearance;
    if (score > bestClearance) {
      bestClearance = score;
      bestDir = dir;
    }
  }

  return bestDir;
}

/** Straight-line raycast from `from` to `to`, true only if nothing but the target itself is in the
 * way - identified by collider handle rather than a distance-margin heuristic, since the target's
 * own collider radius would otherwise make a clean hit land slightly short of the full distance.
 * Used for enemy aggro (Phase B): detection now requires an actual clear sightline, not just
 * distance, so a player on the far side of a wall no longer gets "sensed" through it.
 *
 * `excludeRigidBody` must be the caster's own body - an enemy has two colliders on itself (body
 * capsule + head ball), and `from` (its head) sits exactly at the head ball's center, so excluding
 * only one of the two still lets the ray self-hit the other every time (confirmed via direct
 * testing: LOS was never true until this was a rigid-body exclusion instead of a single collider). */
export function hasLineOfSight(
  physics: PhysicsWorld,
  from: THREE.Vector3,
  to: THREE.Vector3,
  excludeRigidBody: RAPIER.RigidBody,
  targetColliderHandle: number,
): boolean {
  const offset = new THREE.Vector3().subVectors(to, from);
  const distance = offset.length();
  if (distance < 1e-4) return true;

  const dir = offset.multiplyScalar(1 / distance);
  const hit = castHitscan(physics, from, dir, distance, undefined, excludeRigidBody);
  return !hit || hit.colliderHandle === targetColliderHandle;
}
