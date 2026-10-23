import RAPIER from '@dimforge/rapier3d-compat';
import { gradeMaterial } from '../render/materialGrade.ts';
import * as THREE from 'three';
import { getWorldSeed } from '../core/worldSeed.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { mulberry32 } from '../utils/rng.ts';
import { chunkKey } from './chunkSeed.ts';
import { sampleHeight } from './TerrainGenerator.ts';
import { sampleFlatZone, sampleForestZone } from './ZoneMap.ts';
import {
  ENEMY_RING_BASE_RADIUS,
  SPAWN_X,
  SPAWN_Z,
  WATCH_TOWER_COUNT,
  WATCH_TOWER_HALF_WIDTH,
  WATCH_TOWER_HEIGHT,
  WATCH_TOWER_PLATFORM_OVERHANG,
  WATCH_TOWER_RAILING_HEIGHT,
  WATCH_TOWER_SEED_OFFSET,
  WATCH_TOWER_STAIR_WIDTH,
  WORLD_EDGE_RAMP_START,
  ZONE_EDGE_MARGIN,
} from '../core/config.ts';

/**
 * Standalone watch towers (per user request, replacing the generic "tower" building presets that
 * used to be mixed into town layouts - see BuildingManager.ts): exactly WATCH_TOWER_COUNT per
 * map, placed independently of towns/forests entirely, each a tall square shaft with a real
 * walkable switchback staircase wrapping its exterior.
 *
 * The staircase is a **continuous ramp collider per flight, not discrete steps**. This project's
 * own crate-stack work (BuildingManager.ts, same session) hit real, verified-via-diagnostic
 * unreliability trying to make a *jump-based* climb mechanic feel consistent under the character
 * controller's autostep/jump timing. A tower a player will fight around and climb mid-combat
 * needs to be more reliable than that, not less - so each flight is one tilted box collider at a
 * shallow enough slope (see FLIGHT_RISE/FLIGHT_RUN below) to sit comfortably under
 * Player.ts's own `setMaxSlopeClimbAngle(45°)`, meaning the character controller just walks up it
 * like a shallow hill. Individual step meshes are laid along each ramp purely as decoration
 * (matching the "visual matches what's actually walkable" split already used for the crate
 * visual/collider separation), not additional colliders.
 */

const FLIGHT_COUNT = 4;
const FLIGHT_RISE = WATCH_TOWER_HEIGHT / FLIGHT_COUNT;
/** Center-to-center offset of the stair's own centerline from the shaft's center - flush against
 * the shaft's outer face (HALF_WIDTH) plus half the stair's own width, so there's no gap and no
 * overlap between the shaft collider and the ramp colliders. */
const STAIR_OFFSET = WATCH_TOWER_HALF_WIDTH + WATCH_TOWER_STAIR_WIDTH / 2;
/** True worst-case horizontal distance from the tower's own center to any solid part of the
 * structure - a switchback corner's outer edge (STAIR_OFFSET out to the corner, plus another half
 * stair-width to the ramp/railing's own outer face), taken on the diagonal since the corners sit
 * at the footprint's actual corners, not its face midpoints. Shared by the placement search below
 * (as the safe margin for boundary/zone/inter-tower clearance) and by TerrainGenerator.ts's
 * clearing blend (see WATCH_TOWER_CLEARING_BLEND_MARGIN's own comment for the real bug this fixed
 * - the terrain needs to be dead flat under this *entire* radius, not just partially blended
 * toward flat, or the outer flights visibly float above or sink into the ground). */
export const WATCH_TOWER_FOOTPRINT_RADIUS = Math.sqrt(2) * (STAIR_OFFSET + WATCH_TOWER_STAIR_WIDTH / 2);
const RAMP_HALF_THICKNESS = 0.2;
const LANDING_HALF_THICKNESS = 0.15;
const RAILING_HALF_THICKNESS = 0.1;
/** How far below the platform's own centerline the last flight's climb actually stops - a real
 * bug caught by manually testing this in the dev server, not something the geometry math alone
 * revealed: a *tilted* ramp box's true walkable surface sits above its own centerline by a
 * thickness-dependent amount (RAMP_HALF_THICKNESS projected through the incline angle), so making
 * the last flight's nominal endpoint exactly match the platform's height (as the first draft did)
 * let the ramp's actual solid geometry punch up into the platform's own solid volume near the top
 * - the two merge into one solid mass there with no exposed edge left to step onto, exactly
 * matching the reported symptom ("the last stair piece merges into the tower, impossible to get
 * onto"). Stopping comfortably short leaves a clean, small, autostep-sized (well under the
 * character controller's 0.5 threshold - see Player.ts's enableAutostep) rise onto the platform's
 * flat top instead of trying to make a tilted surface flush with a flat one. */
const TOP_FLIGHT_CLEARANCE_BELOW_PLATFORM = 0.3;

/** How far the last flight's own endpoint swings, in degrees, around corner 3 (its own start
 * point) rather than following the plain symmetric 4-face wrap straight along the shaft's fourth
 * face - a deliberate deviation requested after playtesting: pivoting around the flight's own
 * start (not the tower's center) is a real horizontal swing of the endpoint itself, not a
 * rotation of the whole structure. Positive is counter-clockwise (viewed from above) from the
 * unrotated direction - flip the sign here to try the other side if this one doesn't read right. */
const TOP_FLIGHT_SWING_DEGREES = -15;

/** The four landing corners a flight starts/ends at, in local coordinates (tower base = origin,
 * y measured from ground) - one per switchback turn, forming a square loop around the shaft at
 * increasing height. The first flight starts at ground level (no landing needed - the terrain
 * itself is the "landing" there); the last flight stops short of the top platform's own height
 * (see TOP_FLIGHT_CLEARANCE_BELOW_PLATFORM) rather than ending flush with it, and its own endpoint
 * is swung sideways around corner 3 rather than sitting flush on the shaft's fourth face like a
 * plain symmetric wrap would (see TOP_FLIGHT_SWING_DEGREES) - WATCH_TOWER_STAIR_WIDTH was widened
 * specifically to keep this swung endpoint clear of the shaft's own footprint. */
const topFlightStart = new THREE.Vector2(-STAIR_OFFSET, STAIR_OFFSET);
const unrotatedTopFlightRun = new THREE.Vector2(-STAIR_OFFSET, -STAIR_OFFSET).sub(topFlightStart);
const topFlightRun = unrotatedTopFlightRun.rotateAround(new THREE.Vector2(0, 0), (TOP_FLIGHT_SWING_DEGREES * Math.PI) / 180);
const topFlightLanding = topFlightStart.clone().add(topFlightRun);

const CORNERS: readonly THREE.Vector3[] = [
  new THREE.Vector3(-STAIR_OFFSET, 0, -STAIR_OFFSET),
  new THREE.Vector3(STAIR_OFFSET, FLIGHT_RISE, -STAIR_OFFSET),
  new THREE.Vector3(STAIR_OFFSET, FLIGHT_RISE * 2, STAIR_OFFSET),
  new THREE.Vector3(-STAIR_OFFSET, FLIGHT_RISE * 3, STAIR_OFFSET),
  new THREE.Vector3(topFlightLanding.x, WATCH_TOWER_HEIGHT - TOP_FLIGHT_CLEARANCE_BELOW_PLATFORM, topFlightLanding.y),
];

interface PlacedTower {
  group: THREE.Object3D;
  rigidBodyHandle: number;
  colliderHandles: number[];
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

  // Two towers whose footprints (each up to WATCH_TOWER_FOOTPRINT_RADIUS from its own center in
  // the worst-case corner direction) are closer than this could visually read as crowded even if
  // they don't literally overlap (real footprints are square, not circular, so this is a generous,
  // safe overestimate of the actual danger zone, not a tight bound).
  const minTowerSeparation = WATCH_TOWER_FOOTPRINT_RADIUS * 2;

  const rng = mulberry32(getWorldSeed() + WATCH_TOWER_SEED_OFFSET);
  const baseAngle = rng() * Math.PI * 2;
  const sectorAngle = (Math.PI * 2) / WATCH_TOWER_COUNT;
  const positions: { x: number; z: number }[] = [];
  let lastAttempted: { x: number; z: number } | null = null;

  for (let i = 0; i < WATCH_TOWER_COUNT; i++) {
    let placed: { x: number; z: number } | null = null;

    const tryCandidate = (angle: number): boolean => {
      const distance = minDistance + rng() * (maxDistance - minDistance);
      const candidate = { x: SPAWN_X + Math.cos(angle) * distance, z: SPAWN_Z + Math.sin(angle) * distance };
      lastAttempted = candidate;

      const clearOfZones = sampleFlatZone(candidate.x, candidate.z).membership <= 0 && sampleForestZone(candidate.x, candidate.z).membership <= 0;
      const separatedFromOtherTowers = positions.every((other) => Math.hypot(candidate.x - other.x, candidate.z - other.z) >= minTowerSeparation);
      if (clearOfZones && separatedFromOtherTowers) {
        placed = candidate;
        return true;
      }
      return false;
    };

    // Bounded retry, same shape as computeGuaranteedSites' collision nudge - re-jitters across
    // this tower's *entire* own sector (full ±sectorAngle/2, no gap or overlap with a neighboring
    // tower's own sector) until clear of every existing town/forest zone AND far enough from every
    // already-placed tower.
    for (let attempt = 0; attempt < 50 && !placed; attempt++) {
      tryCandidate(baseAngle + i * sectorAngle + (rng() - 0.5) * sectorAngle);
    }

    // A real, measured failure mode (not just a theoretical one - caught by
    // WatchTowerManager.test.ts's seed sweep, ~6% of seeds before this fallback existed): a wide
    // enough town/forest zone can cover so much of one tower's fixed sector that no amount of
    // retrying *within that sector* ever finds a clear spot, no matter the budget. Rather than
    // accept that rate, this second pass drops the "stay in your own evenly-spaced sector" ideal
    // and searches the *entire* angular range at the same distance band instead - a tower ending
    // up not perfectly evenly spaced is a far smaller cost than one sitting inside a zone.
    for (let attempt = 0; attempt < 40 && !placed; attempt++) {
      tryCandidate(rng() * Math.PI * 2);
    }

    // Falls back to the last attempted position (still boundary-clear by construction, since
    // every candidate is drawn from [minDistance, maxDistance]) rather than dropping the tower
    // entirely - landing inside a zone's rim or a little close to another tower is a much smaller
    // issue than a map missing one of its four towers outright.
    positions.push(placed ?? lastAttempted!);
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
  private readonly towerMaterial: THREE.Material;
  private readonly stepMaterial: THREE.Material;
  private readonly railingMaterial: THREE.Material;
  private readonly positions: { x: number; z: number }[];
  private readonly activeTowers = new Map<string, PlacedTower>();
  private readonly chunkOwnedTowerIds = new Map<string, string[]>();

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {
    this.towerMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.85 });
    this.stepMaterial = new THREE.MeshStandardMaterial({ color: 0x6e6e68, roughness: 0.9 });
    this.railingMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4a46, roughness: 0.7 });
    for (const material of [this.towerMaterial, this.stepMaterial, this.railingMaterial]) gradeMaterial(material, 'concrete');
    this.positions = getWatchTowerPositions();
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
      const placed = this.createTower(position.x, position.z);
      this.activeTowers.set(id, placed);
      ownedIds.push(id);
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

  private createTower(worldX: number, worldZ: number): PlacedTower {
    const groundY = sampleHeight(worldX, worldZ);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(worldX, groundY, worldZ);
    const rigidBody = this.physics.world.createRigidBody(bodyDesc);
    const colliderHandles: number[] = [];

    // Shaft: occupies the full [-HALF_WIDTH, HALF_WIDTH] footprint, flush against the stair's own
    // inner edge (see STAIR_OFFSET's own comment) with neither gap nor overlap.
    const shaftDesc = RAPIER.ColliderDesc.cuboid(WATCH_TOWER_HALF_WIDTH, WATCH_TOWER_HEIGHT / 2, WATCH_TOWER_HALF_WIDTH).setTranslation(
      0,
      WATCH_TOWER_HEIGHT / 2,
      0,
    );
    colliderHandles.push(this.physics.world.createCollider(shaftDesc, rigidBody).handle);

    for (let flight = 0; flight < FLIGHT_COUNT; flight++) {
      const start = CORNERS[flight]!;
      const end = CORNERS[flight + 1]!;
      const rampCollider = createRampCollider(this.physics.world, rigidBody, start, end, WATCH_TOWER_STAIR_WIDTH);
      colliderHandles.push(rampCollider.handle);
      colliderHandles.push(createBoxCollider(this.physics.world, rigidBody, outerFlightRailingBox(start, end)).handle);

      // A landing at every corner except the first (ground level already serves as the landing
      // there) and the last (the top platform, created below, serves as the landing there).
      if (flight > 0) {
        const landingDesc = RAPIER.ColliderDesc.cuboid(WATCH_TOWER_STAIR_WIDTH / 2, LANDING_HALF_THICKNESS, WATCH_TOWER_STAIR_WIDTH / 2).setTranslation(
          start.x,
          start.y,
          start.z,
        );
        colliderHandles.push(this.physics.world.createCollider(landingDesc, rigidBody).handle);
        colliderHandles.push(createBoxCollider(this.physics.world, rigidBody, outerLandingRailingBox(start)).handle);
      }
    }

    const platformHalfExtent = WATCH_TOWER_HALF_WIDTH + WATCH_TOWER_PLATFORM_OVERHANG;
    const platformDesc = RAPIER.ColliderDesc.cuboid(platformHalfExtent, LANDING_HALF_THICKNESS, platformHalfExtent).setTranslation(
      0,
      WATCH_TOWER_HEIGHT,
      0,
    );
    colliderHandles.push(this.physics.world.createCollider(platformDesc, rigidBody).handle);

    for (const handle of createPlatformRailingColliders(this.physics.world, rigidBody, platformHalfExtent)) {
      colliderHandles.push(handle);
    }

    const group = createTowerVisual(this.towerMaterial, this.stepMaterial, this.railingMaterial, platformHalfExtent);
    group.position.set(worldX, groundY, worldZ);
    this.scene.add(group);

    return { group, rigidBodyHandle: rigidBody.handle, colliderHandles };
  }
}

/** Builds a single tilted box collider spanning `start` to `end` (both in the rigid body's own
 * local frame) - the actual walkable ramp for one staircase flight. Uses THREE's quaternion math
 * (rotate local +X onto the incline direction) rather than hand-deriving a per-flight rotation
 * axis, since flights run along different world axes (see CORNERS) and getting that rotation
 * wrong by hand is exactly the kind of subtle geometry bug that's easy to ship unnoticed - this
 * way it's correct for any start/end pair, not just the four this file happens to use. */
function createRampCollider(world: RAPIER.World, rigidBody: RAPIER.RigidBody, start: THREE.Vector3, end: THREE.Vector3, width: number): RAPIER.Collider {
  const delta = new THREE.Vector3().subVectors(end, start);
  const length = delta.length();
  const direction = delta.clone().normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

  const desc = RAPIER.ColliderDesc.cuboid(length / 2, RAMP_HALF_THICKNESS, width / 2)
    .setTranslation(midpoint.x, midpoint.y, midpoint.z)
    .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
  return world.createCollider(desc, rigidBody);
}

/** One box's full placement in the tower's local frame (centered, like both a Rapier cuboid and a
 * THREE.BoxGeometry). Each stair/landing railing is computed once as one of these and then built
 * as both its collider (createBoxCollider) and its visible mesh (createBoxMesh), so the two can't
 * drift apart - the same "can't drift out of sync" reasoning as createTowerVisual's ramp comment.
 * Those railings used to have colliders but no mesh at all, so players bumped into and shot
 * invisible 1m walls all the way up the stairs. */
interface BoxTransform {
  readonly center: THREE.Vector3;
  readonly rotation: THREE.Quaternion;
  readonly halfExtents: THREE.Vector3;
}

function createBoxCollider(world: RAPIER.World, rigidBody: RAPIER.RigidBody, box: BoxTransform): RAPIER.Collider {
  const desc = RAPIER.ColliderDesc.cuboid(box.halfExtents.x, box.halfExtents.y, box.halfExtents.z)
    .setTranslation(box.center.x, box.center.y, box.center.z)
    .setRotation({ x: box.rotation.x, y: box.rotation.y, z: box.rotation.z, w: box.rotation.w });
  return world.createCollider(desc, rigidBody);
}

function createBoxMesh(box: BoxTransform, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.halfExtents.x * 2, box.halfExtents.y * 2, box.halfExtents.z * 2), material);
  mesh.position.copy(box.center);
  mesh.quaternion.copy(box.rotation);
  return mesh;
}

/** A thin, tall rail along one flight's *outer* edge (the side facing away from the shaft) -
 * without this, a player sprinting straight through a switchback turn (not slowing down to pivot
 * onto the next flight, exactly the failure mode caught by manually testing this in the dev
 * server: holding forward the whole way up sailed straight off a landing's edge into open air
 * instead of climbing) has nothing physically stopping them from running off the side mid-climb.
 * Reuses the same tilted-box-via-quaternion approach as createRampCollider, offset outward by
 * half the stair width and raised half the railing height above the ramp surface. */
function outerFlightRailingBox(start: THREE.Vector3, end: THREE.Vector3): BoxTransform {
  const delta = new THREE.Vector3().subVectors(end, start);
  const horizontalDirection = new THREE.Vector3(delta.x, 0, delta.z).normalize();
  // Perpendicular to the flight's horizontal direction, in the XZ plane - rotate 90 degrees
  // around Y. Sign doesn't need to be resolved analytically: whichever perpendicular points
  // further from the shaft's local origin (0,0) is the outward one, checked directly below rather
  // than assumed.
  const perpendicularA = new THREE.Vector3(-horizontalDirection.z, 0, horizontalDirection.x);
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const outward = midpoint.clone().add(perpendicularA).lengthSq() > midpoint.lengthSq() ? perpendicularA : perpendicularA.clone().negate();

  // Offset by half the stair width *plus* the railing's own half-thickness, not just half the
  // stair width - offsetting by only the stair-width half would place the railing's centerline
  // flush with the ramp's own edge, meaning the railing's near half (its own half-thickness)
  // physically overlaps the ramp's outer edge. Two solid, permanently-overlapping colliders that
  // a player's capsule walks directly along the seam of is exactly the kind of geometry that can
  // make a character controller's shape-cast resolve erratically (confirmed by testing this in
  // the dev server: walking up a flight ended in the player being flung far off, not a clean
  // climb) - offsetting the extra half-thickness makes the railing's inner face flush with the
  // ramp's outer face instead, touching but not overlapping.
  const railingOffset = WATCH_TOWER_STAIR_WIDTH / 2 + RAILING_HALF_THICKNESS;
  const railStart = start.clone().addScaledVector(outward, railingOffset).setY(start.y + WATCH_TOWER_RAILING_HEIGHT / 2);
  const railEnd = end.clone().addScaledVector(outward, railingOffset).setY(end.y + WATCH_TOWER_RAILING_HEIGHT / 2);

  const railDelta = new THREE.Vector3().subVectors(railEnd, railStart);
  const railLength = railDelta.length();
  const railDirection = railDelta.clone().normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), railDirection);
  const railMidpoint = new THREE.Vector3().addVectors(railStart, railEnd).multiplyScalar(0.5);

  return {
    center: railMidpoint,
    rotation,
    halfExtents: new THREE.Vector3(railLength / 2, WATCH_TOWER_RAILING_HEIGHT / 2, RAILING_HALF_THICKNESS),
  };
}

/** A single rail segment on a landing's outer edge (the side facing away from the shaft, the
 * direction a player continuing straight through the corner would overshoot toward) - same
 * motivation as outerFlightRailingBox, for the flat landings between flights. */
function outerLandingRailingBox(corner: THREE.Vector3): BoxTransform {
  const outward = new THREE.Vector3(corner.x, 0, corner.z).normalize();
  const perpendicular = new THREE.Vector3(-outward.z, 0, outward.x);
  // Same "offset by half-width plus the railing's own half-thickness" fix as
  // outerFlightRailingBox - see its comment for why the naive half-width-only offset overlaps
  // the landing's own edge instead of sitting flush against it. `outward` is horizontal, so the
  // offset keeps corner.y, then the rail is raised half its own height above the landing.
  const center = corner
    .clone()
    .addScaledVector(outward, WATCH_TOWER_STAIR_WIDTH / 2 + RAILING_HALF_THICKNESS)
    .setY(corner.y + WATCH_TOWER_RAILING_HEIGHT / 2);

  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), perpendicular);
  return {
    center,
    rotation,
    halfExtents: new THREE.Vector3(WATCH_TOWER_STAIR_WIDTH / 2, WATCH_TOWER_RAILING_HEIGHT / 2, RAILING_HALF_THICKNESS),
  };
}

/** Four thin, tall colliders around the lookout platform's perimeter - without these, climbing
 * WATCH_TOWER_HEIGHT (16m) up would make one misstep at the top an unfair instant fall. */
function createPlatformRailingColliders(world: RAPIER.World, rigidBody: RAPIER.RigidBody, platformHalfExtent: number): number[] {
  const y = WATCH_TOWER_HEIGHT + WATCH_TOWER_RAILING_HEIGHT / 2;
  const sides: { halfX: number; halfZ: number; x: number; z: number }[] = [
    { halfX: platformHalfExtent, halfZ: RAILING_HALF_THICKNESS, x: 0, z: -platformHalfExtent },
    { halfX: platformHalfExtent, halfZ: RAILING_HALF_THICKNESS, x: 0, z: platformHalfExtent },
    { halfX: RAILING_HALF_THICKNESS, halfZ: platformHalfExtent, x: -platformHalfExtent, z: 0 },
    { halfX: RAILING_HALF_THICKNESS, halfZ: platformHalfExtent, x: platformHalfExtent, z: 0 },
  ];

  return sides.map((side) => {
    const desc = RAPIER.ColliderDesc.cuboid(side.halfX, WATCH_TOWER_RAILING_HEIGHT / 2, side.halfZ).setTranslation(side.x, y, side.z);
    return world.createCollider(desc, rigidBody).handle;
  });
}

/** Purely cosmetic geometry - matches the collider layout exactly in position/size (shaft, ramps,
 * landings, platform, and every railing: the stair/landing ones via the exact BoxTransform their
 * colliders use) but adds visible step-edge strips along each ramp (a thin protruding band
 * every ~1.2m along the slope, same "cosmetic detail on top of a plain collider shape" approach
 * already used for the crate stack's tier bands) so a smooth ramp collider still *reads* as a
 * staircase, not a wheelchair ramp. */
/** The tower's look without its colliders, for scenery outside a match (the title screen's valley,
 * see lobby/LobbyScene.ts). Same graded materials and proportions as a placed tower. */
export function createDecorativeTowerVisual(): THREE.Group {
  const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.85 });
  const stepMaterial = new THREE.MeshStandardMaterial({ color: 0x6e6e68, roughness: 0.9 });
  const railingMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4a46, roughness: 0.7 });
  for (const material of [towerMaterial, stepMaterial, railingMaterial]) gradeMaterial(material, 'concrete');
  return createTowerVisual(towerMaterial, stepMaterial, railingMaterial, WATCH_TOWER_HALF_WIDTH + WATCH_TOWER_PLATFORM_OVERHANG);
}

function createTowerVisual(towerMaterial: THREE.Material, stepMaterial: THREE.Material, railingMaterial: THREE.Material, platformHalfExtent: number): THREE.Group {
  const group = new THREE.Group();

  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(WATCH_TOWER_HALF_WIDTH * 2, WATCH_TOWER_HEIGHT, WATCH_TOWER_HALF_WIDTH * 2),
    towerMaterial,
  );
  shaft.position.set(0, WATCH_TOWER_HEIGHT / 2, 0);
  group.add(shaft);

  const stepSpacing = 1.2;
  for (let flight = 0; flight < FLIGHT_COUNT; flight++) {
    const start = CORNERS[flight]!;
    const end = CORNERS[flight + 1]!;
    const delta = new THREE.Vector3().subVectors(end, start);
    const length = delta.length();
    const direction = delta.clone().normalize();
    // Same quaternion approach as createRampCollider - rotating local +X onto the incline
    // direction. Deliberately not hand-derived Euler angles: an earlier draft of this function
    // tried exactly that (yaw then pitch) and got it wrong (rotating around a fixed X axis before
    // yawing leaves the box's own length axis horizontal, tilting only its thickness/width axes
    // instead) - the collider would have been climbable but the visible ramp would have looked
    // flat. Reusing the same quaternion math the collider already uses can't drift out of sync
    // with it the way two independently-derived rotations could.
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);

    const rampMesh = new THREE.Mesh(new THREE.BoxGeometry(length, RAMP_HALF_THICKNESS * 2, WATCH_TOWER_STAIR_WIDTH), towerMaterial);
    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    rampMesh.position.copy(midpoint);
    rampMesh.quaternion.copy(rotation);
    group.add(rampMesh);

    const stepCount = Math.floor(length / stepSpacing);
    for (let i = 1; i < stepCount; i++) {
      const t = i / stepCount;
      const stepEdge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, WATCH_TOWER_STAIR_WIDTH), stepMaterial);
      stepEdge.position.copy(new THREE.Vector3().lerpVectors(start, end, t));
      stepEdge.quaternion.copy(rotation);
      group.add(stepEdge);
    }

    // Same box, same loop shape (one per flight, a landing rail at every corner but the first) as
    // createTower's own railing colliders - see BoxTransform.
    group.add(createBoxMesh(outerFlightRailingBox(start, end), railingMaterial));

    if (flight > 0) {
      const landing = new THREE.Mesh(new THREE.BoxGeometry(WATCH_TOWER_STAIR_WIDTH, LANDING_HALF_THICKNESS * 2, WATCH_TOWER_STAIR_WIDTH), towerMaterial);
      landing.position.copy(start);
      group.add(landing);
      group.add(createBoxMesh(outerLandingRailingBox(start), railingMaterial));
    }
  }

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(platformHalfExtent * 2, LANDING_HALF_THICKNESS * 2, platformHalfExtent * 2),
    towerMaterial,
  );
  platform.position.set(0, WATCH_TOWER_HEIGHT, 0);
  group.add(platform);

  const railingY = WATCH_TOWER_HEIGHT + WATCH_TOWER_RAILING_HEIGHT / 2;
  const railingSpans: { width: number; depth: number; x: number; z: number }[] = [
    { width: platformHalfExtent * 2, depth: RAILING_HALF_THICKNESS * 2, x: 0, z: -platformHalfExtent },
    { width: platformHalfExtent * 2, depth: RAILING_HALF_THICKNESS * 2, x: 0, z: platformHalfExtent },
    { width: RAILING_HALF_THICKNESS * 2, depth: platformHalfExtent * 2, x: -platformHalfExtent, z: 0 },
    { width: RAILING_HALF_THICKNESS * 2, depth: platformHalfExtent * 2, x: platformHalfExtent, z: 0 },
  ];
  for (const span of railingSpans) {
    const railing = new THREE.Mesh(new THREE.BoxGeometry(span.width, WATCH_TOWER_RAILING_HEIGHT, span.depth), railingMaterial);
    railing.position.set(span.x, railingY, span.z);
    group.add(railing);
  }

  // A 16m tower that neither casts nor receives shadows reads as pasted onto the scene - every
  // other placed prop (crates, geese, ammo crates) already opts in the same way.
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}
