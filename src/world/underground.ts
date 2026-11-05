import RAPIER from '@dimforge/rapier3d-compat';
import { sampleHeight } from './TerrainGenerator.ts';

interface CutZone { cx: number; cz: number; halfX: number; halfZ: number }
interface UndergroundVolume { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number; ceilY: number }

let cutZones: CutZone[] = [];
const terrainColliders = new Set<number>();
const volumes: UndergroundVolume[] = [];

// Stable uniform objects shared by every compiled variant of the terrain material.
export const cutZoneUniforms = {
  uCutZones: { value: new Float32Array(16) },
  uCutZoneCount: { value: 0 },
};

export function setCutZones(zones: CutZone[]): void {
  if (zones.length > 4) throw new Error('At most four terrain cut zones are supported');
  cutZones = zones.map((zone) => ({ ...zone }));
  cutZoneUniforms.uCutZones.value.fill(0);
  cutZones.forEach((zone, index) => {
    cutZoneUniforms.uCutZones.value.set([zone.cx, zone.cz, zone.halfX, zone.halfZ], index * 4);
  });
  cutZoneUniforms.uCutZoneCount.value = cutZones.length;
}

export function clearUnderground(): void {
  setCutZones([]);
  terrainColliders.clear();
  volumes.length = 0;
}

/** A positive margin keeps the whole capsule inside the opening before terrain is ignored. */
export function inCutZone(x: number, z: number, margin = 0): boolean {
  return cutZones.some((zone) => Math.abs(x - zone.cx) <= zone.halfX - margin && Math.abs(z - zone.cz) <= zone.halfZ - margin);
}

export function registerTerrainCollider(handle: number): void {
  terrainColliders.add(handle);
}

export function unregisterTerrainCollider(handle: number): void {
  terrainColliders.delete(handle);
}

export function isTerrainCollider(handle: number): boolean {
  return terrainColliders.has(handle);
}

export function registerUndergroundVolume(volume: UndergroundVolume): void {
  volumes.push({ ...volume });
}

function volumeAt(x: number, y: number, z: number): UndergroundVolume | undefined {
  return volumes.find((volume) => x >= volume.minX && x <= volume.maxX && z >= volume.minZ && z <= volume.maxZ &&
    y >= volume.floorY - 0.5 && y <= volume.ceilY);
}

export function isUnderground(x: number, y: number, z: number): boolean {
  return volumeAt(x, y, z) !== undefined || (inCutZone(x, z) && y < sampleHeight(x, z) + 3.2);
}

export function floorBelow(world: RAPIER.World, x: number, y: number, z: number): number {
  if (!isUnderground(x, y, z)) return sampleHeight(x, z);
  const ray = new RAPIER.Ray({ x, y: y + 0.1, z }, { x: 0, y: -1, z: 0 });
  const hit = world.castRayAndGetNormal(ray, Infinity, true,
    RAPIER.QueryFilterFlags.ONLY_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined, undefined, undefined, (collider) => !isTerrainCollider(collider.handle));
  // An opening without a registered floor must not snap objects back onto the terrain.
  return hit ? ray.origin.y - hit.timeOfImpact : volumeAt(x, y, z)?.floorY ?? -Infinity;
}

/** Keeps Rapier's filters and returns timeOfImpact relative to the original ray origin. */
export function castRaySkippingCuts(
  world: RAPIER.World,
  ray: RAPIER.Ray,
  maxToi: number,
  solid: boolean,
  filterFlags?: RAPIER.QueryFilterFlags,
  filterGroups?: RAPIER.InteractionGroups,
  filterExcludeCollider?: RAPIER.Collider,
  filterExcludeRigidBody?: RAPIER.RigidBody,
  filterPredicate?: (collider: RAPIER.Collider) => boolean,
): RAPIER.RayColliderIntersection | null {
  let offset = 0;
  const epsilon = 0.001 / (Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z) || 1);
  for (let skip = 0; skip <= 3; skip++) {
    const next = offset === 0 ? ray : new RAPIER.Ray(ray.pointAt(offset), ray.dir);
    const hit = world.castRayAndGetNormal(next, maxToi - offset, solid,
      filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate);
    if (!hit) return null;
    const timeOfImpact = offset + hit.timeOfImpact;
    const point = ray.pointAt(timeOfImpact);
    if (!isTerrainCollider(hit.collider.handle) || !inCutZone(point.x, point.z)) {
      hit.timeOfImpact = timeOfImpact;
      return hit;
    }
    offset = timeOfImpact + epsilon;
    if (offset > maxToi) return null;
  }
  return null;
}
