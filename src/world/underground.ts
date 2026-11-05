import RAPIER from '@dimforge/rapier3d-compat';
import { sampleHeight } from './TerrainGenerator.ts';

interface CutZone { cx: number; cz: number; halfX: number; halfZ: number }
interface UndergroundVolume { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number; ceilY: number }

let cutZones: CutZone[] = [];
const terrainColliders = new Set<number>();
const volumes: (UndergroundVolume & { groundY: number })[] = [];

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
  for (const zone of cutZones) {
    if (Math.abs(x - zone.cx) <= zone.halfX - margin && Math.abs(z - zone.cz) <= zone.halfZ - margin) return true;
  }
  return false;
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

export function registerUndergroundVolume(volume: UndergroundVolume, groundY = sampleHeight((volume.minX + volume.maxX) / 2, (volume.minZ + volume.maxZ) / 2)): void {
  volumes.push({ ...volume, groundY });
}

function volumeAt(x: number, y: number, z: number): UndergroundVolume | undefined {
  for (const volume of volumes) {
    if (x >= volume.minX && x <= volume.maxX && z >= volume.minZ && z <= volume.maxZ &&
        y >= volume.floorY - 0.5 && y <= volume.ceilY) return volume;
  }
  return undefined;
}

export function isUnderground(x: number, y: number, z: number): boolean {
  return volumeAt(x, y, z) !== undefined || (inCutZone(x, z) && y < sampleHeight(x, z) + 3.2);
}

/** Game rules and sound require a volume at least one metre below its tower's ground level.
 * The ground room and an empty cut zone never count. */
export function isBelowGround(x: number, y: number, z: number): boolean {
  for (const volume of volumes) {
    if (y <= volume.groundY - 1 &&
        x >= volume.minX && x <= volume.maxX && z >= volume.minZ && z <= volume.maxZ &&
        y >= volume.floorY - 0.5 && y <= volume.ceilY) return true;
  }
  return false;
}

/** Whether (x, y, z) is inside a registered underground volume (not just a terrain cut zone): the
 * cheap test that decides whether a floor lookup needs the underground ray at all. */
export function inUndergroundVolume(x: number, y: number, z: number): boolean {
  return volumeAt(x, y, z) !== undefined;
}

/** A point on the floor plan inside the volume that holds (x, y, z), kept `margin` metres from its
 * walls, placed by two random numbers `u` and `v` in [0, 1). Null when (x, y, z) is in no volume. */
export function pointInUndergroundVolume(
  x: number, y: number, z: number, u: number, v: number, margin = 1,
): { x: number; z: number } | null {
  const volume = volumeAt(x, y, z);
  if (!volume) return null;
  const span = (min: number, max: number, t: number): number => {
    const lo = min + margin, hi = max - margin;
    return lo >= hi ? (min + max) / 2 : lo + (hi - lo) * t;
  };
  return { x: span(volume.minX, volume.maxX, u), z: span(volume.minZ, volume.maxZ, v) };
}

// Reused by every floorBelow call: it runs per frame for thrown objects and grenades, so the ray
// is not allocated each time. Rapier reads the origin and direction synchronously during the cast.
// Created on first use, after Rapier is initialised.
let downRay: RAPIER.Ray | null = null;

export function floorBelow(world: RAPIER.World, x: number, y: number, z: number): number {
  if (!isUnderground(x, y, z)) return sampleHeight(x, z);
  const originY = y + 0.1;
  downRay ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  downRay.origin.x = x;
  downRay.origin.y = originY;
  downRay.origin.z = z;
  const hit = world.castRayAndGetNormal(downRay, Infinity, true,
    RAPIER.QueryFilterFlags.ONLY_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined, undefined, undefined, isNotTerrain);
  // An opening without a registered floor must not snap objects back onto the terrain.
  return hit ? originY - hit.timeOfImpact : volumeAt(x, y, z)?.floorY ?? -Infinity;
}

const isNotTerrain = (collider: RAPIER.Collider): boolean => !isTerrainCollider(collider.handle);

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
