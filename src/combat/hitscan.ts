import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { perfCounters } from '../core/perfStats.ts';
import { castRaySkippingCuts } from '../world/underground.ts';

export interface HitscanResult {
  point: THREE.Vector3;
  distance: number;
  colliderHandle: number;
}

/** `direction` must be a unit vector — the returned distance is the raw Rapier time-of-impact along it.
 * `excludeRigidBody` skips every collider on that body in one shot - needed for a caster with more
 * than one collider on itself (e.g. an enemy's body capsule + head ball), where excluding just one
 * of the two still lets the ray self-hit the other. */
export function castHitscan(
  physics: PhysicsWorld,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
  excludeCollider?: RAPIER.Collider,
  excludeRigidBody?: RAPIER.RigidBody,
): HitscanResult | null {
  perfCounters.raycasts += 1;
  const ray = new RAPIER.Ray(
    { x: origin.x, y: origin.y, z: origin.z },
    { x: direction.x, y: direction.y, z: direction.z },
  );
  const hit = castRaySkippingCuts(
    physics.world,
    ray,
    maxDistance,
    true,
    undefined,
    undefined,
    excludeCollider,
    excludeRigidBody,
  );
  if (!hit) return null;

  const point = new THREE.Vector3(
    origin.x + direction.x * hit.timeOfImpact,
    origin.y + direction.y * hit.timeOfImpact,
    origin.z + direction.z * hit.timeOfImpact,
  );

  return { point, distance: hit.timeOfImpact, colliderHandle: hit.collider.handle };
}
