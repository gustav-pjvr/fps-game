import RAPIER from '@dimforge/rapier3d-compat';
import { gradeObject } from '../render/materialGrade.ts';
import * as THREE from 'three';
import { loadGLTF } from '../core/AssetLoader.ts';
import { getWorldSeed } from '../core/worldSeed.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { ObstacleRegistry } from '../entities/enemies/tactics/obstacleRegistry.ts';
import { mulberry32 } from '../utils/rng.ts';
import { computeBuildingColliderShapes, isPointNearFootprint, type BuildingColliderShapes } from './buildingColliders.ts';
import { chunkKey, hashChunkSeed } from './chunkSeed.ts';
import { sampleHeight } from './TerrainGenerator.ts';
import { getFlatZoneSite, radiusOfFlatZoneAtAngle, type FlatZoneSite } from './ZoneMap.ts';
import {
  BUILDING_COLLIDER_FOOTPRINT_SHRINK,
  FLAT_ZONE_CELL_SIZE,
  FLAT_ZONE_RADIUS_MAX,
  TOWN_BUILD_FRACTION,
  TOWN_BUILDING_SPACING_MARGIN,
  TOWN_LAYOUT_SEED_OFFSET,
  TOWN_MAX_BUILDINGS,
  TOWN_MAX_PLACEMENT_ATTEMPTS,
  TOWN_MIN_BUILDINGS,
} from '../core/config.ts';

interface BuildingPresetDef {
  modelPath: string;
  targetHeight: number;
}

/** Premade sample structures from Kenney's Modular Buildings kit (CC0) - already assembled from
 * the kit's own wall/window/door/roof pieces, so they read as real buildings (not a plain box)
 * without this project needing to hand-place and rotate individual tiles. Houses only - the
 * taller "tower" presets that used to live here were removed per user request in favor of
 * standalone watch towers (see WatchTowerManager.ts), which aren't part of town layouts at all. */
const BUILDING_PRESET_DEFS: BuildingPresetDef[] = [
  { modelPath: '/assets/models/buildings/building-sample-house-a.glb', targetHeight: 4 },
  { modelPath: '/assets/models/buildings/building-sample-house-b.glb', targetHeight: 6.5 },
  { modelPath: '/assets/models/buildings/building-sample-house-c.glb', targetHeight: 6.5 },
];

interface BuildingPreset {
  scene: THREE.Object3D;
  scaleFactor: number;
  footprintWidth: number;
  footprintDepth: number;
  /** Some prefabs aren't modeled symmetrically about their local origin - the footprint's true
   * center sits a small offset away from (0,0). Scaled world-space offset, before rotation is
   * applied. */
  footprintOffsetX: number;
  footprintOffsetZ: number;
  /** Wall box plus roof prisms in the model's scaled local frame (see measurePreset). */
  colliders: BuildingColliderShapes;
}

/** One building's position within its town, in coordinates local to the town's site center. */
interface TownBuildingPlacement {
  localX: number;
  localZ: number;
  rotationY: number;
  presetIndex: number;
  halfDiagonal: number;
}

interface TownLayout {
  buildings: TownBuildingPlacement[];
}

interface PlacedBuilding {
  group: THREE.Object3D;
  rigidBodyHandle: number;
  /** The wall box plus one convex prism per roof piece, all attached to rigidBodyHandle's body. */
  colliderHandles: number[];
}

/** Every mesh face in the prefab as flat xyz, in the frame createBuilding's clone gets scaled in:
 * each mesh's matrixWorld (relative to the GLTF scene root, which GLTFLoader always leaves at
 * identity and whose own transform createBuilding overwrites with the placement's), times
 * scaleFactor. The same matrices Box3.setFromObject reads, so faces and footprint agree. */
function collectScaledTriangles(scene: THREE.Object3D, scaleFactor: number): number[] {
  const triangles: number[] = [];
  const vertex = new THREE.Vector3();
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry: THREE.BufferGeometry = child.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i++) {
      vertex.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(child.matrixWorld).multiplyScalar(scaleFactor);
      triangles.push(vertex.x, vertex.y, vertex.z);
    }
  });
  return triangles;
}

/** Measures a freshly loaded prefab's real bounding box rather than trusting hand-inspected
 * numbers, then computes the uniform scale needed to reach targetHeight - same "verify, don't
 * guess the asset's own dimensions" discipline used for vegetation. Also captures the footprint's
 * center offset from the model's local origin - not every prefab is modeled symmetrically about
 * (0,0), so assuming the origin IS the footprint center would silently misalign the collider from
 * the visual. The collider shapes come from the model's own faces too (see
 * computeBuildingColliderShapes): the one box up to the ridge this used to produce filled the empty
 * air above every gabled roof's slopes. */
function measurePreset(scene: THREE.Object3D, targetHeight: number): BuildingPreset {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const rawHeight = box.max.y - box.min.y;
  const scaleFactor = targetHeight / rawHeight;
  const bounds = {
    minX: box.min.x * scaleFactor,
    minY: box.min.y * scaleFactor,
    minZ: box.min.z * scaleFactor,
    maxX: box.max.x * scaleFactor,
    maxY: box.max.y * scaleFactor,
    maxZ: box.max.z * scaleFactor,
  };
  return {
    scene,
    scaleFactor,
    footprintWidth: (box.max.x - box.min.x) * scaleFactor,
    footprintDepth: (box.max.z - box.min.z) * scaleFactor,
    footprintOffsetX: ((box.max.x + box.min.x) / 2) * scaleFactor,
    footprintOffsetZ: ((box.max.z + box.min.z) / 2) * scaleFactor,
    colliders: computeBuildingColliderShapes(collectScaledTriangles(scene, scaleFactor), bounds, BUILDING_COLLIDER_FOOTPRINT_SHRINK),
  };
}

/**
 * Town-clustered building placement (WORLD_PLAN.md follow-up: buildings should form clusters like
 * a small town, not scatter one-per-chunk independently). A town's entire layout is a pure function
 * of its flat-zone cell coordinates (see getTownLayout) - generated once, memoized, and identical
 * regardless of which chunk or when it's asked for. Each chunk spawns only the buildings from any
 * overlapping town whose position actually falls inside that chunk's bounds, so a town spanning
 * several chunks streams in/out correctly no matter the load order.
 */
export class BuildingManager {
  private readonly townLayoutCache = new Map<string, TownLayout>();
  private readonly activeBuildings = new Map<string, PlacedBuilding>();
  private readonly chunkOwnedBuildingIds = new Map<string, string[]>();

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly presets: BuildingPreset[],
    /** Where enemies look for cover (enemy AI v2 step 3): each placed house's footprint is
     * registered per chunk and dropped when the chunk unloads. */
    private readonly obstacles?: ObstacleRegistry,
  ) {}

  static async create(scene: THREE.Scene, physics: PhysicsWorld, obstacles?: ObstacleRegistry): Promise<BuildingManager> {
    const presets: BuildingPreset[] = [];
    for (const def of BUILDING_PRESET_DEFS) {
      const gltf = await loadGLTF(def.modelPath);
      // Clones share these materials, so grading the loaded prefab once covers every placement.
      gradeObject(gltf.scene, 'building');
      presets.push(measurePreset(gltf.scene, def.targetHeight));
    }
    return new BuildingManager(scene, physics, presets, obstacles);
  }

  /** Called by ChunkManager's onChunkLoaded hook. */
  placeForChunk(cx: number, cz: number, originX: number, originZ: number, size: number): void {
    const gxMin = Math.floor((originX - FLAT_ZONE_RADIUS_MAX) / FLAT_ZONE_CELL_SIZE);
    const gxMax = Math.floor((originX + size + FLAT_ZONE_RADIUS_MAX) / FLAT_ZONE_CELL_SIZE);
    const gzMin = Math.floor((originZ - FLAT_ZONE_RADIUS_MAX) / FLAT_ZONE_CELL_SIZE);
    const gzMax = Math.floor((originZ + size + FLAT_ZONE_RADIUS_MAX) / FLAT_ZONE_CELL_SIZE);

    const ownedIds: string[] = [];

    for (let gz = gzMin; gz <= gzMax; gz++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const site = getFlatZoneSite(gx, gz);
        if (!site) continue;

        const layout = this.getTownLayout(gx, gz, site);
        layout.buildings.forEach((placement, index) => {
          const worldX = site.siteX + placement.localX;
          const worldZ = site.siteZ + placement.localZ;
          const inThisChunk = worldX >= originX && worldX < originX + size && worldZ >= originZ && worldZ < originZ + size;
          if (!inThisChunk) return;

          const preset = this.presets[placement.presetIndex];
          if (!preset) return;

          const id = `${chunkKey(gx, gz)}:${index}`;
          const placed = this.createBuilding(worldX, worldZ, placement.rotationY, preset);
          this.activeBuildings.set(id, placed);
          ownedIds.push(id);
          this.obstacles?.add(chunkKey(cx, cz), {
            kind: 'house',
            footprint: {
              originX: worldX,
              originZ: worldZ,
              offsetX: preset.footprintOffsetX,
              offsetZ: preset.footprintOffsetZ,
              halfWidth: preset.footprintWidth / 2,
              halfDepth: preset.footprintDepth / 2,
              rotationY: placement.rotationY,
            },
          });
        });
      }
    }

    this.chunkOwnedBuildingIds.set(chunkKey(cx, cz), ownedIds);
  }

  /** Called by ChunkManager's onChunkUnloaded hook. */
  removeChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const ownedIds = this.chunkOwnedBuildingIds.get(key);
    if (!ownedIds) return;

    for (const id of ownedIds) {
      const building = this.activeBuildings.get(id);
      if (!building) continue;

      this.scene.remove(building.group);

      // Every collider goes explicitly before its body, the same order the single-box version
      // used, so no stored handle outlives the collider it names.
      for (const colliderHandle of building.colliderHandles) {
        const collider = this.physics.world.getCollider(colliderHandle);
        if (collider) this.physics.world.removeCollider(collider, true);
      }
      const rigidBody = this.physics.world.getRigidBody(building.rigidBodyHandle);
      if (rigidBody) this.physics.world.removeRigidBody(rigidBody);

      this.activeBuildings.delete(id);
    }

    this.chunkOwnedBuildingIds.delete(key);
    this.obstacles?.removeChunk(key);
  }

  /** World-space building positions for a town cell, reusing the exact same memoized layout that
   * placeForChunk renders - so a consumer like RoadManager always connects to the buildings that
   * are actually on screen, never a separately-derived (and potentially divergent) approximation.
   * Returns null if there's no town at this cell. */
  getTownBuildingPositions(gx: number, gz: number): { x: number; z: number }[] | null {
    const site = getFlatZoneSite(gx, gz);
    if (!site) return null;

    const layout = this.getTownLayout(gx, gz, site);
    return layout.buildings.map((building) => ({
      x: site.siteX + building.localX,
      z: site.siteZ + building.localZ,
    }));
  }

  /** Spawn-safety query (Game.ts rejects respawn points inside houses with it): true if world
   * (x, z) lies within `margin` metres of any house footprint anywhere in the world, streamed in or
   * not. Walks the same memoized getTownLayout placement uses, so it answers identically before and
   * after the surrounding chunks load, and identically on every client for one seed. The footprint
   * is each model's full measured XZ rectangle (eaves and porch steps included, not the shrunk
   * collider), turned with the building's own rotation; `margin` is Euclidean distance from that
   * rectangle, and a negative margin counts as 0. Only the one to four flat-zone cells within reach
   * are looked at, each a dozen or so rectangle tests, so ~50 calls per respawn cost next to nothing. */
  isPointInsideBuilding(x: number, z: number, margin: number): boolean {
    // Same cell bound placeForChunk uses (a site sits inside its own cell and every building center
    // within FLAT_ZONE_RADIUS_MAX of it), widened by the farthest any footprint edge reaches from its
    // building's placement point, plus the margin itself.
    let footprintReach = 0;
    for (const preset of this.presets) {
      const centerOffset = Math.hypot(preset.footprintOffsetX, preset.footprintOffsetZ);
      footprintReach = Math.max(footprintReach, centerOffset + Math.hypot(preset.footprintWidth, preset.footprintDepth) / 2);
    }
    const reach = FLAT_ZONE_RADIUS_MAX + footprintReach + Math.max(margin, 0);
    const gxMin = Math.floor((x - reach) / FLAT_ZONE_CELL_SIZE);
    const gxMax = Math.floor((x + reach) / FLAT_ZONE_CELL_SIZE);
    const gzMin = Math.floor((z - reach) / FLAT_ZONE_CELL_SIZE);
    const gzMax = Math.floor((z + reach) / FLAT_ZONE_CELL_SIZE);

    for (let gz = gzMin; gz <= gzMax; gz++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const site = getFlatZoneSite(gx, gz);
        if (!site) continue;

        for (const placement of this.getTownLayout(gx, gz, site).buildings) {
          const preset = this.presets[placement.presetIndex];
          if (!preset) continue;

          const footprint = {
            originX: site.siteX + placement.localX,
            originZ: site.siteZ + placement.localZ,
            offsetX: preset.footprintOffsetX,
            offsetZ: preset.footprintOffsetZ,
            halfWidth: preset.footprintWidth / 2,
            halfDepth: preset.footprintDepth / 2,
            rotationY: placement.rotationY,
          };
          if (isPointNearFootprint(x, z, footprint, margin)) return true;
        }
      }
    }
    return false;
  }

  /** Pure function of (gx,gz) - memoized, but the memo is a derived cache, not the source of
   * truth, so any chunk asking for the same town cell gets an identical layout whether this is
   * the first call or the hundredth. Rejection-sampled: places varied-size buildings within
   * TOWN_BUILD_FRACTION of the flat zone's radius (its flat core, not the blended rim) with a
   * minimum gap between footprints, capped at TOWN_MAX_PLACEMENT_ATTEMPTS so a crowded roll never
   * stalls a chunk load. */
  private getTownLayout(gx: number, gz: number, site: FlatZoneSite): TownLayout {
    const key = chunkKey(gx, gz);
    const cached = this.townLayoutCache.get(key);
    if (cached) return cached;

    const rng = mulberry32(hashChunkSeed(gx, gz, getWorldSeed() + TOWN_LAYOUT_SEED_OFFSET));
    const targetCount = TOWN_MIN_BUILDINGS + Math.floor(rng() * (TOWN_MAX_BUILDINGS - TOWN_MIN_BUILDINGS + 1));
    const buildings: TownBuildingPlacement[] = [];

    for (let attempt = 0; attempt < TOWN_MAX_PLACEMENT_ATTEMPTS && buildings.length < targetCount; attempt++) {
      const presetIndex = Math.floor(rng() * this.presets.length);
      const preset = this.presets[presetIndex];
      if (!preset) continue;

      const halfDiagonal = Math.sqrt(preset.footprintWidth ** 2 + preset.footprintDepth ** 2) / 2;
      const angle = rng() * Math.PI * 2;
      // Organic zones aren't a circle - a building's max distance from the site center depends on
      // which direction it's placed in, not one shared radius (see ZoneMap.ts's per-angle shape).
      const distance = rng() * radiusOfFlatZoneAtAngle(site, angle) * TOWN_BUILD_FRACTION;
      const localX = Math.cos(angle) * distance;
      const localZ = Math.sin(angle) * distance;
      const rotationY = Math.floor(rng() * 4) * (Math.PI / 2);

      const overlaps = buildings.some((other) => {
        const dx = localX - other.localX;
        const dz = localZ - other.localZ;
        const centerDistance = Math.sqrt(dx * dx + dz * dz);
        return centerDistance < halfDiagonal + other.halfDiagonal + TOWN_BUILDING_SPACING_MARGIN;
      });
      if (overlaps) continue;

      buildings.push({ localX, localZ, rotationY, presetIndex, halfDiagonal });
    }

    const layout: TownLayout = { buildings };
    this.townLayoutCache.set(key, layout);
    return layout;
  }

  private createBuilding(worldX: number, worldZ: number, rotationY: number, preset: BuildingPreset): PlacedBuilding {
    const groundY = sampleHeight(worldX, worldZ);

    const group = preset.scene.clone(true);
    group.scale.setScalar(preset.scaleFactor);
    group.rotation.y = rotationY;
    group.position.set(worldX, groundY, worldZ);
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    this.scene.add(group);

    // The collider shapes live in the model's scaled local frame (see measurePreset), on a body
    // given exactly the visual group's position and Y rotation - so any rotation, and the
    // off-center footprint correction measurePreset documents, come from the same transform as the
    // visual instead of being re-derived by hand per collider. three's rotation.y and this
    // quaternion are the same right-handed turn about +Y.
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(worldX, groundY, worldZ)
      .setRotation({ x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) });
    const rigidBody = this.physics.world.createRigidBody(bodyDesc);

    const { wallBox, roofHulls } = preset.colliders;
    const wallDesc = RAPIER.ColliderDesc.cuboid(wallBox.halfX, wallBox.halfY, wallBox.halfZ).setTranslation(
      wallBox.centerX,
      wallBox.centerY,
      wallBox.centerZ,
    );
    const colliderHandles = [this.physics.world.createCollider(wallDesc, rigidBody).handle];
    for (const points of roofHulls) {
      // Typed as nullable, but computeBuildingColliderShapes only emits pieces with real area and
      // real height above their support, so there is no flat or collinear point set to refuse.
      const hullDesc = RAPIER.ColliderDesc.convexHull(points);
      if (hullDesc) colliderHandles.push(this.physics.world.createCollider(hullDesc, rigidBody).handle);
    }

    return {
      group,
      rigidBodyHandle: rigidBody.handle,
      colliderHandles,
    };
  }

  /** Debug/test-only: how many houses are currently streamed in - used as a "did we actually find a
   * town" signal in place of the old crate-stack-count proxy (crate stacks were removed per user
   * request). */
  getActiveBuildingCount(): number {
    return this.activeBuildings.size;
  }
}
