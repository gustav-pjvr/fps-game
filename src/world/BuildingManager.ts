import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { loadGLTF } from '../core/AssetLoader.ts';
import { getWorldSeed } from '../core/worldSeed.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { mulberry32 } from '../utils/rng.ts';
import { chunkKey, hashChunkSeed } from './chunkSeed.ts';
import { sampleHeight } from './TerrainGenerator.ts';
import { getFlatZoneSite, type FlatZoneSite } from './ZoneMap.ts';
import {
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
 * without this project needing to hand-place and rotate individual tiles. */
const BUILDING_PRESET_DEFS: BuildingPresetDef[] = [
  { modelPath: '/assets/models/buildings/building-sample-house-a.glb', targetHeight: 4 },
  { modelPath: '/assets/models/buildings/building-sample-house-b.glb', targetHeight: 6.5 },
  { modelPath: '/assets/models/buildings/building-sample-house-c.glb', targetHeight: 6.5 },
  { modelPath: '/assets/models/buildings/building-sample-tower-a.glb', targetHeight: 8 },
  { modelPath: '/assets/models/buildings/building-sample-tower-b.glb', targetHeight: 6 },
  { modelPath: '/assets/models/buildings/building-sample-tower-c.glb', targetHeight: 10 },
  { modelPath: '/assets/models/buildings/building-sample-tower-d.glb', targetHeight: 12 },
];

interface BuildingPreset {
  scene: THREE.Object3D;
  scaleFactor: number;
  height: number;
  footprintWidth: number;
  footprintDepth: number;
  /** Some prefabs (e.g. tower-a/b/c) aren't modeled symmetrically about their local origin - the
   * footprint's true center sits a small offset away from (0,0). Scaled world-space offset, before
   * rotation is applied. */
  footprintOffsetX: number;
  footprintOffsetZ: number;
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
  colliderHandle: number;
}

/** Measures a freshly loaded prefab's real bounding box rather than trusting hand-inspected
 * numbers, then computes the uniform scale needed to reach targetHeight - same "verify, don't
 * guess the asset's own dimensions" discipline used for vegetation. Also captures the footprint's
 * center offset from the model's local origin - tower-a/b/c are not modeled symmetrically about
 * (0,0), so assuming the origin IS the footprint center silently misaligns the collider from the
 * visual (caught by code review, verified against the actual accessor bounds in those .glb files). */
function measurePreset(scene: THREE.Object3D, targetHeight: number): BuildingPreset {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const rawHeight = box.max.y - box.min.y;
  const scaleFactor = targetHeight / rawHeight;
  return {
    scene,
    scaleFactor,
    height: targetHeight,
    footprintWidth: (box.max.x - box.min.x) * scaleFactor,
    footprintDepth: (box.max.z - box.min.z) * scaleFactor,
    footprintOffsetX: ((box.max.x + box.min.x) / 2) * scaleFactor,
    footprintOffsetZ: ((box.max.z + box.min.z) / 2) * scaleFactor,
  };
}

function townCellKey(gx: number, gz: number): string {
  return `${gx},${gz}`;
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
  ) {}

  static async create(scene: THREE.Scene, physics: PhysicsWorld): Promise<BuildingManager> {
    const presets: BuildingPreset[] = [];
    for (const def of BUILDING_PRESET_DEFS) {
      const gltf = await loadGLTF(def.modelPath);
      presets.push(measurePreset(gltf.scene, def.targetHeight));
    }
    return new BuildingManager(scene, physics, presets);
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

          const id = `${townCellKey(gx, gz)}:${index}`;
          const placed = this.createBuilding(worldX, worldZ, placement.rotationY, preset);
          this.activeBuildings.set(id, placed);
          ownedIds.push(id);
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
      const collider = this.physics.world.getCollider(building.colliderHandle);
      if (collider) this.physics.world.removeCollider(collider, true);
      const rigidBody = this.physics.world.getRigidBody(building.rigidBodyHandle);
      if (rigidBody) this.physics.world.removeRigidBody(rigidBody);

      this.activeBuildings.delete(id);
    }

    this.chunkOwnedBuildingIds.delete(key);
  }

  /** Pure function of (gx,gz) - memoized, but the memo is a derived cache, not the source of
   * truth, so any chunk asking for the same town cell gets an identical layout whether this is
   * the first call or the hundredth. Rejection-sampled: places varied-size buildings within
   * TOWN_BUILD_FRACTION of the flat zone's radius (its flat core, not the blended rim) with a
   * minimum gap between footprints, capped at TOWN_MAX_PLACEMENT_ATTEMPTS so a crowded roll never
   * stalls a chunk load. */
  private getTownLayout(gx: number, gz: number, site: FlatZoneSite): TownLayout {
    const key = townCellKey(gx, gz);
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
      const distance = rng() * site.radius * TOWN_BUILD_FRACTION;
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

    // Footprint stays axis-aligned regardless of the visual's Y rotation, since only 0/90/180/270
    // are used - a 90/270 rotation just swaps which measured dimension maps to world X vs. Z.
    const isRotated90 = Math.abs(Math.sin(rotationY)) > 0.5;
    const colliderHalfWidth = (isRotated90 ? preset.footprintDepth : preset.footprintWidth) / 2;
    const colliderHalfDepth = (isRotated90 ? preset.footprintWidth : preset.footprintDepth) / 2;
    const centerY = groundY + preset.height / 2;

    // Some prefabs' footprint center isn't at their local origin (see measurePreset) - rotate that
    // offset the same way the visual was rotated so the collider tracks the true footprint center,
    // not the (possibly off-center) point the mesh happens to be positioned at.
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const colliderCenterX = worldX + (preset.footprintOffsetX * cos + preset.footprintOffsetZ * sin);
    const colliderCenterZ = worldZ + (-preset.footprintOffsetX * sin + preset.footprintOffsetZ * cos);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(colliderCenterX, centerY, colliderCenterZ);
    const rigidBody = this.physics.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(colliderHalfWidth, preset.height / 2, colliderHalfDepth);
    const collider = this.physics.world.createCollider(colliderDesc, rigidBody);

    return { group, rigidBodyHandle: rigidBody.handle, colliderHandle: collider.handle };
  }
}
