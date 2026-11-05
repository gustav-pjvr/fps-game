import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { getWorldSeed } from '../core/worldSeed.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { mulberry32 } from '../utils/rng.ts';
import { chunkKey } from './chunkSeed.ts';
import { addRailing, box, createBoxCollider, PieceCollector } from './structureKit.ts';
import { createTowerVisual, towerParts, WATCH_TOWER_FOOTPRINT_RADIUS } from './towerDesign.ts';
import { computeTowerLabs, towerDoorPlane, type TowerLab } from './towerUnderground.ts';
import { registerUndergroundVolume, setCutZones } from './underground.ts';
import type { UndergroundTower } from './undergroundLights.ts';
import { towerDoorId } from './houses/valleyHouseIds.ts';
import { ValleyDoors } from './houses/ValleyDoors.ts';
import { sampleFlatZone, sampleForestZone } from './ZoneMap.ts';
import {
  ENEMY_RING_BASE_RADIUS,
  SPAWN_X,
  SPAWN_Z,
  WATCH_TOWER_COUNT,
  WATCH_TOWER_MIN_SEPARATION,
  WATCH_TOWER_SEED_OFFSET,
  WORLD_EDGE_RAMP_START,
  ZONE_EDGE_MARGIN,
} from '../core/config.ts';

export { WATCH_TOWER_FOOTPRINT_RADIUS } from './towerDesign.ts';

/**
 * Standalone watch towers (per user request, replacing the generic 'tower' building presets that
 * used to be mixed into town layouts - see BuildingManager.ts): exactly WATCH_TOWER_COUNT per
 * map, placed independently of towns/forests entirely. This file places and streams them; what a
 * tower is (its parts, colliders and look) lives in towerDesign.ts.
 */

interface PlacedTower {
  underground: UndergroundTower;
  doorId: number;
  group: THREE.Object3D;
  rigidBodyHandle: number;
  colliderHandles: number[];
}

/** Metres of open ground kept between a tower's footprint and the edge of any town pad. */
const TOWN_CLEARANCE = 2;
const TOWN_CLEARANCE_SAMPLES = 16;
const WHOLE_MAP_ATTEMPTS = 200;
/** A tower may stand on a forest's thinning rim, never in its core. */
const FOREST_CORE_MEMBERSHIP = 0.5;

/**
 * How many of a tower's footprint samples (its centre and a ring just past its stairs) land on a
 * town pad; 0 means the tower is clear of every town. Checking only the centre (as placement first
 * did) let 472 of 1200 towers across a 300-seed sweep hang their stairs into a pad, cutting into
 * its houses (found in the v4.0 screenshots). Town pads are 10 to 16 m across with no soft skirt,
 * so the ring catches every overlap wider than the gap between samples.
 */
function townOverlap(x: number, z: number): number {
  let overlap = sampleFlatZone(x, z).membership > 0 ? 1 : 0;
  const radius = WATCH_TOWER_FOOTPRINT_RADIUS + TOWN_CLEARANCE;
  for (let i = 0; i < TOWN_CLEARANCE_SAMPLES; i++) {
    const angle = (i / TOWN_CLEARANCE_SAMPLES) * Math.PI * 2;
    if (sampleFlatZone(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius).membership > 0) overlap++;
  }
  return overlap;
}


/**
 * Places WATCH_TOWER_COUNT towers evenly spaced around spawn, each jittered within its own
 * sector and re-jittered away from any existing town/forest zone membership - mirrors
 * ZoneMap.ts's computeGuaranteedSites (evenly-spread angles at a shared distance band, bounded
 * retry on collision) but simpler: towers have a fixed footprint, not a rolled radius, so there's
 * no ray-growth step, just a single clearance check against the world edge, the spawn ring, and
 * (the one new requirement here) existing zone membership.
 *
 * Exported and kept pure (no THREE/RAPIER construction) so it's independently testable, the same
 * way VegetationManager.test.ts tests canopyGeometryFor separately from actual mesh creation.
 */
export function computeWatchTowerPositions(): { x: number; z: number }[] {
  const spawnOffsetMagnitude = Math.sqrt(SPAWN_X * SPAWN_X + SPAWN_Z * SPAWN_Z);
  const minDistance = ENEMY_RING_BASE_RADIUS + ZONE_EDGE_MARGIN + WATCH_TOWER_FOOTPRINT_RADIUS;
  const maxDistance = WORLD_EDGE_RAMP_START - ZONE_EDGE_MARGIN - WATCH_TOWER_FOOTPRINT_RADIUS - spawnOffsetMagnitude;
  if (maxDistance <= minDistance) return []; // world too small to fit even one tower safely

  // Two spacings: towers look for a spot WATCH_TOWER_MIN_SEPARATION from every other tower first,
  // and only when the whole ring has none settle for twice the footprint (the old bound, which kept
  // footprints apart but let two towers stand 16 m apart and read as one twin structure,
  // 2026-10-24). Demanding the wider spacing outright pushed towers into forest cores instead: the
  // ring they can stand on is only about 12 m deep.
  const closestTowerSeparation = WATCH_TOWER_FOOTPRINT_RADIUS * 2;

  const rng = mulberry32(getWorldSeed() + WATCH_TOWER_SEED_OFFSET);
  const baseAngle = rng() * Math.PI * 2;
  const sectorAngle = (Math.PI * 2) / WATCH_TOWER_COUNT;
  const positions: { x: number; z: number }[] = [];

  for (let i = 0; i < WATCH_TOWER_COUNT; i++) {
    let placed: { x: number; z: number } | null = null;
    // The least bad candidate so far, for the fallback below: a tower touching a town is worse than
    // one crowding another tower, which is worse than one standing in a forest (vegetation is
    // cleared around every tower anyway).
    let best: { x: number; z: number } | null = null;
    let bestCost = Infinity;

    const tryCandidate = (angle: number, separation: number): boolean => {
      const distance = minDistance + rng() * (maxDistance - minDistance);
      const candidate = { x: SPAWN_X + Math.cos(angle) * distance, z: SPAWN_Z + Math.sin(angle) * distance };

      const overlap = townOverlap(candidate.x, candidate.z);
      const inForest = sampleForestZone(candidate.x, candidate.z).membership > FOREST_CORE_MEMBERSHIP;
      const nearest = Math.min(Infinity, ...positions.map((other) => Math.hypot(candidate.x - other.x, candidate.z - other.z)));
      if (overlap === 0 && !inForest && nearest >= separation) {
        placed = candidate;
        return true;
      }
      const cost = overlap * 100 + (nearest >= closestTowerSeparation ? 0 : 10) + (inForest ? 1 : 0) + (nearest >= WATCH_TOWER_MIN_SEPARATION ? 0 : 0.5);
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
      return false;
    };

    // Bounded retry, same shape as computeGuaranteedSites' collision nudge - re-jitters across
    // this tower's *entire* own sector (full ±sectorAngle/2, no gap or overlap with a neighboring
    // tower's own sector) until clear of every existing town/forest zone AND far enough from every
    // already-placed tower.
    for (let attempt = 0; attempt < 50 && !placed; attempt++) {
      tryCandidate(baseAngle + i * sectorAngle + (rng() - 0.5) * sectorAngle, WATCH_TOWER_MIN_SEPARATION);
    }

    // A real, measured failure mode (not just a theoretical one - caught by
    // WatchTowerManager.test.ts's seed sweep, ~6% of seeds before this fallback existed): a wide
    // enough town/forest zone can cover so much of one tower's fixed sector that no amount of
    // retrying *within that sector* ever finds a clear spot, no matter the budget. Rather than
    // accept that rate, this second pass drops the "stay in your own evenly-spaced sector" ideal
    // and searches the *entire* angular range at the same distance band instead - a tower ending
    // up not perfectly evenly spaced is a far smaller cost than one sitting inside a zone.
    for (let attempt = 0; attempt < WHOLE_MAP_ATTEMPTS && !placed; attempt++) {
      tryCandidate(rng() * Math.PI * 2, WATCH_TOWER_MIN_SEPARATION);
    }
    for (let attempt = 0; attempt < WHOLE_MAP_ATTEMPTS && !placed; attempt++) {
      tryCandidate(rng() * Math.PI * 2, closestTowerSeparation);
    }

    // Falls back to the least bad candidate (still boundary-clear by construction, since every
    // candidate is drawn from [minDistance, maxDistance]) rather than dropping the tower entirely -
    // standing in a forest or a little close to another tower is a much smaller issue than a map
    // missing one of its four towers outright.
    positions.push(placed ?? best!);
  }

  return positions;
}

interface WatchTowerPositionsCache {
  seed: number;
  positions: { x: number; z: number }[];
}

let watchTowerPositionsCache: WatchTowerPositionsCache | null = null;

/** Cached wrapper around computeWatchTowerPositions - TerrainGenerator.ts calls this on every
 * terrain-vertex sample (to flatten a clearing around each tower, see its own
 * watchTowerClearingMembership), so recomputing the full placement search (up to 90 candidate
 * checks per tower, each itself sampling the zone system) on every single call would be a real
 * performance regression. Wholesale-cleared on seed change, mirroring ZoneMap.ts's
 * guaranteedSitesCache, rather than keyed by seed - a session with many world regenerations
 * shouldn't accumulate one cache entry per seed forever. */
export function getWatchTowerPositions(): { x: number; z: number }[] {
  const seed = getWorldSeed();
  if (!watchTowerPositionsCache || watchTowerPositionsCache.seed !== seed) {
    watchTowerPositionsCache = { seed, positions: computeWatchTowerPositions() };
  }
  return watchTowerPositionsCache.positions;
}

/** True if world point (x, z) is within `margin` metres of any watch tower's solid footprint,
 * anywhere in the world (a pure function of the seed, so it answers the same before chunks load).
 * Used to keep player spawn points out of the stair switchbacks: every spawn path used terrain
 * height alone, so a spawn inside a tower's footprint put the player inside its geometry. */
export function isPointInsideWatchTower(x: number, z: number, margin: number): boolean {
  const reach = WATCH_TOWER_FOOTPRINT_RADIUS + margin;
  return getWatchTowerPositions().some((tower) => Math.hypot(x - tower.x, z - tower.z) < reach);
}

export class WatchTowerManager {
  private readonly positions: { x: number; z: number }[];
  private readonly labs: TowerLab[];
  private readonly activeTowers = new Map<string, PlacedTower>();
  private readonly chunkOwnedTowerIds = new Map<string, string[]>();
  private undergroundTowers: readonly UndergroundTower[] = [];
  private undergroundLamps: readonly THREE.Vector3[] = [];

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {
    this.positions = getWatchTowerPositions();
    this.labs = computeTowerLabs();
    setCutZones(this.positions.map(({ x, z }) => ({ cx: x, cz: z, halfX: 2.7, halfZ: 2.7 })));
    // Seeded volumes outlive chunk streaming, just like the cut zones. Register only once.
    for (const lab of this.labs) for (const volume of lab.volumes) registerUndergroundVolume(volume);
  }

  static create(scene: THREE.Scene, physics: PhysicsWorld): WatchTowerManager {
    return new WatchTowerManager(scene, physics);
  }

  /** Called by ChunkManager's onChunkLoaded hook - same containment check BuildingManager uses
   * per town, just against this fixed 4-position list instead of a per-cell density grid. */
  placeForChunk(cx: number, cz: number, originX: number, originZ: number, size: number): void {
    const ownedIds: string[] = [];

    this.positions.forEach((position, index) => {
      const inThisChunk = position.x >= originX && position.x < originX + size && position.z >= originZ && position.z < originZ + size;
      if (!inThisChunk) return;

      const id = `tower:${index}`;
      ownedIds.push(id);
      if (this.activeTowers.has(id)) return;
      const placed = this.createTower(this.labs[index]!);
      this.activeTowers.set(id, placed);
      this.rebuildUndergroundCache();
    });

    this.chunkOwnedTowerIds.set(chunkKey(cx, cz), ownedIds);
  }

  /** Called by ChunkManager's onChunkUnloaded hook. */
  removeChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const ownedIds = this.chunkOwnedTowerIds.get(key);
    if (!ownedIds) return;

    for (const id of ownedIds) {
      const tower = this.activeTowers.get(id);
      if (!tower) continue;
      ValleyDoors.removeTowerDoor(this.physics.world, tower.doorId);

      this.scene.remove(tower.group);
      tower.group.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });

      for (const handle of tower.colliderHandles) {
        const collider = this.physics.world.getCollider(handle);
        if (collider) this.physics.world.removeCollider(collider, true);
      }
      const rigidBody = this.physics.world.getRigidBody(tower.rigidBodyHandle);
      if (rigidBody) this.physics.world.removeRigidBody(rigidBody);

      this.activeTowers.delete(id);
    }
    this.rebuildUndergroundCache();

    this.chunkOwnedTowerIds.delete(key);
  }

  /** Debug/test-only: exact tower base positions, so e2e tests can navigate precisely to a known
   * one instead of guessing blindly at one. */
  getActiveTowerPositions(): { x: number; z: number }[] {
    return Array.from(this.activeTowers.values(), (tower) => {
      const t = tower.group.position;
      return { x: t.x, z: t.z };
    });
  }

  /** The streamed-in towers' underground parts. The same array until a tower streams in or out, so
   * Game can call it every frame without allocating. */
  getUndergroundTowers(): readonly UndergroundTower[] {
    return this.undergroundTowers;
  }

  /** Every streamed-in tower's lab lamps, in one array that changes only with the tower list. */
  getUndergroundLamps(): readonly THREE.Vector3[] {
    return this.undergroundLamps;
  }

  private rebuildUndergroundCache(): void {
    this.undergroundTowers = Array.from(this.activeTowers.values(), tower => tower.underground);
    this.undergroundLamps = this.undergroundTowers.flatMap(tower => tower.lamps);
  }

  private createTower(lab: TowerLab): PlacedTower {
    const { x: worldX, z: worldZ, groundY, orientation } = lab;
    const rigidBody = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(worldX, groundY, worldZ));
    // One collider per solid part, the same boxes the visual draws (towerDesign.ts).
    const colliderHandles = [...towerParts(orientation), ...lab.parts].map((part) => createBoxCollider(this.physics.world, rigidBody, part.box).handle);

    const group = createTowerVisual(orientation);
    const pieces = new PieceCollector();
    for (const part of lab.parts) {
      if (part.rail) addRailing(pieces, part.box);
      else pieces.addBox(part.material, part.box);
    }
    const undergroundGroup = pieces.build();
    undergroundGroup.name = 'tower-underground';
    undergroundGroup.visible = false;
    group.add(undergroundGroup);
    group.position.set(worldX, groundY, worldZ);
    this.scene.add(group);

    const doorId = towerDoorId(lab.index);
    ValleyDoors.addTowerDoor(this.physics.world, doorId, towerDoorPlane(doorId)!);
    const underground: UndergroundTower = { group: undergroundGroup, position: group.position,
      door: new THREE.Vector3(worldX + 3, groundY + 1.1, worldZ), lamps: lab.lamps };
    return { group, underground, rigidBodyHandle: rigidBody.handle, colliderHandles, doorId };
  }
}

/** The tower's look without its colliders, for scenery outside a match (the title screen's valley,
 * see lobby/LobbyScene.ts). */
export function createDecorativeTowerVisual(): THREE.Group {
  const group = createTowerVisual();
  const pieces = new PieceCollector();
  pieces.addBox('steel', box(3.04, 1.1, 0, 0.08, 2.2, 1.2));
  const door = pieces.build();
  door.name = 'decorative-tower-door';
  group.add(door);
  return group;
}
