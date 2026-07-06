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
  CRATE_MANTLE_ROOF_CLEARANCE,
  CRATE_MANTLE_SENSOR_DEPTH,
  CRATE_MANTLE_SENSOR_WIDTH,
  CRATE_MANTLE_TOP_MARGIN,
  CRATE_SIZE,
  CRATE_TIER_COUNT,
  FLAT_ZONE_CELL_SIZE,
  FLAT_ZONE_RADIUS_MAX,
  PLAYER_HEIGHT,
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
  /** Only "house" presets get a crate stack (playtest feedback specifically asked for crates near
   * houses, not the taller towers) - towers keep no roof-access mechanic at all now that ladders
   * are gone. */
  hasCrateStack: boolean;
}

/** Premade sample structures from Kenney's Modular Buildings kit (CC0) - already assembled from
 * the kit's own wall/window/door/roof pieces, so they read as real buildings (not a plain box)
 * without this project needing to hand-place and rotate individual tiles. */
const BUILDING_PRESET_DEFS: BuildingPresetDef[] = [
  { modelPath: '/assets/models/buildings/building-sample-house-a.glb', targetHeight: 4, hasCrateStack: true },
  { modelPath: '/assets/models/buildings/building-sample-house-b.glb', targetHeight: 6.5, hasCrateStack: true },
  { modelPath: '/assets/models/buildings/building-sample-house-c.glb', targetHeight: 6.5, hasCrateStack: true },
  { modelPath: '/assets/models/buildings/building-sample-tower-a.glb', targetHeight: 8, hasCrateStack: false },
  { modelPath: '/assets/models/buildings/building-sample-tower-b.glb', targetHeight: 6, hasCrateStack: false },
  { modelPath: '/assets/models/buildings/building-sample-tower-c.glb', targetHeight: 10, hasCrateStack: false },
  { modelPath: '/assets/models/buildings/building-sample-tower-d.glb', targetHeight: 12, hasCrateStack: false },
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
  hasCrateStack: boolean;
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
  /** Only set for houses (see BuildingPresetDef.hasCrateStack) - towers have no crate stack, no
   * mantle sensor, nothing to clean up beyond the base collider/rigid body above. */
  crateStack: {
    mantleColliderHandle: number;
    crateColliderHandles: number[];
    crateGroup: THREE.Object3D;
    /** Exact crate-stack face position (world X of its center, world Z of the wall it's flush
     * against) - kept for debug/test tooling to navigate precisely rather than guessing. */
    x: number;
    wallFaceZ: number;
  } | null;
}

/** Measures a freshly loaded prefab's real bounding box rather than trusting hand-inspected
 * numbers, then computes the uniform scale needed to reach targetHeight - same "verify, don't
 * guess the asset's own dimensions" discipline used for vegetation. Also captures the footprint's
 * center offset from the model's local origin - tower-a/b/c are not modeled symmetrically about
 * (0,0), so assuming the origin IS the footprint center silently misaligns the collider from the
 * visual (caught by code review, verified against the actual accessor bounds in those .glb files). */
function measurePreset(scene: THREE.Object3D, targetHeight: number, hasCrateStack: boolean): BuildingPreset {
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
    hasCrateStack,
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
  private readonly crateMaterial: THREE.Material;
  private readonly crateBandMaterial: THREE.Material;

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly presets: BuildingPreset[],
  ) {
    this.crateMaterial = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.9 });
    this.crateBandMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3620, roughness: 0.9 });
  }

  static async create(scene: THREE.Scene, physics: PhysicsWorld): Promise<BuildingManager> {
    const presets: BuildingPreset[] = [];
    for (const def of BUILDING_PRESET_DEFS) {
      const gltf = await loadGLTF(def.modelPath);
      presets.push(measurePreset(gltf.scene, def.targetHeight, def.hasCrateStack));
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

      if (building.crateStack) {
        const { crateStack } = building;
        this.scene.remove(crateStack.crateGroup);
        crateStack.crateGroup.traverse((child) => {
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        });

        // Mantle collider is a JS-side tag (climbableMantleTargets is not physics-managed), so it
        // must be cleared explicitly - otherwise a future collider that reuses this same handle
        // number (Rapier recycles freed handles) would silently inherit "this mantles" from a
        // building that no longer exists.
        const mantleCollider = this.physics.world.getCollider(crateStack.mantleColliderHandle);
        if (mantleCollider) this.physics.unregisterClimbable(mantleCollider);

        for (const handle of crateStack.crateColliderHandles) {
          const crateCollider = this.physics.world.getCollider(handle);
          if (crateCollider) this.physics.world.removeCollider(crateCollider, true);
        }
      }

      const collider = this.physics.world.getCollider(building.colliderHandle);
      if (collider) this.physics.world.removeCollider(collider, true);
      const rigidBody = this.physics.world.getRigidBody(building.rigidBodyHandle);
      if (rigidBody) this.physics.world.removeRigidBody(rigidBody);

      this.activeBuildings.delete(id);
    }

    this.chunkOwnedBuildingIds.delete(key);
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

    const crateStack = preset.hasCrateStack
      ? this.createCrateStack(rigidBody, preset, groundY, colliderCenterX, colliderCenterZ, colliderHalfDepth)
      : null;

    return {
      group,
      rigidBodyHandle: rigidBody.handle,
      colliderHandle: collider.handle,
      crateStack,
    };
  }

  /** Crate stack always goes on the world -Z face of the collider box, regardless of the
   * building's own rotation - simpler than picking a "local" pre-rotation face (WORLD_PLAN.md §3
   * only calls for "one face," not a specific one), and every preset's box is axis-aligned after
   * rotation (only 0/90/180/270 are used) so any face is a valid flat side to stack crates
   * against. A fixed CRATE_TIER_COUNT-step staircase of real, solid, jumpable crates gets the
   * player most of the way up regardless of the exact house height (they range 4-6.5); a mantle
   * sensor above the stack (reusing the same registerClimbable/Player.ts machinery the old ladder
   * used) closes whatever gap remains, sized per-building since it depends on preset.height. */
  private createCrateStack(
    rigidBody: RAPIER.RigidBody,
    preset: BuildingPreset,
    groundY: number,
    colliderCenterX: number,
    colliderCenterZ: number,
    colliderHalfDepth: number,
  ): NonNullable<PlacedBuilding['crateStack']> {
    const wallFaceZ = colliderCenterZ - colliderHalfDepth;
    const stackTopY = CRATE_TIER_COUNT * CRATE_SIZE;

    const crateColliderHandles: number[] = [];
    for (let tier = 0; tier < CRATE_TIER_COUNT; tier++) {
      // Each tier sits one crate-width closer to the wall than the last, so the ascending stack
      // reads as an actual staircase to walk/jump up, not a sheer pillar.
      const distanceFromWall = (CRATE_TIER_COUNT - tier) * CRATE_SIZE;
      const crateColliderDesc = RAPIER.ColliderDesc.cuboid(CRATE_SIZE / 2, CRATE_SIZE / 2, CRATE_SIZE / 2).setTranslation(
        0,
        tier * CRATE_SIZE + CRATE_SIZE / 2 - preset.height / 2,
        -(colliderHalfDepth + distanceFromWall - CRATE_SIZE / 2),
      );
      const crateCollider = this.physics.world.createCollider(crateColliderDesc, rigidBody);
      crateColliderHandles.push(crateCollider.handle);
    }

    // Bottom bound is clamped to stay comfortably below the roof (never negative/zero) - if a
    // future preset were shorter than the crate stack itself, the crates alone already reach the
    // roof and this sensor only needs to cover a token sliver near the top, not invert.
    const mantleSensorBottomY = Math.min(stackTopY, preset.height - 0.5);
    const mantleSensorTopY = preset.height + CRATE_MANTLE_TOP_MARGIN;
    const mantleHalfHeight = (mantleSensorTopY - mantleSensorBottomY) / 2;
    const mantleCenterY = (mantleSensorBottomY + mantleSensorTopY) / 2 - preset.height / 2;

    const mantleColliderDesc = RAPIER.ColliderDesc.cuboid(
      CRATE_MANTLE_SENSOR_WIDTH / 2,
      mantleHalfHeight,
      CRATE_MANTLE_SENSOR_DEPTH / 2,
    )
      .setTranslation(0, mantleCenterY, -(colliderHalfDepth + CRATE_MANTLE_SENSOR_DEPTH / 2))
      .setSensor(true)
      // Rapier's default active collision types (DEFAULT = DYNAMIC_DYNAMIC | DYNAMIC_FIXED |
      // DYNAMIC_KINEMATIC) does NOT include KINEMATIC_FIXED - since the player is a kinematic
      // body and this sensor is on a fixed body, the narrow-phase would never track an
      // intersection pair between them without explicitly opting in, and world.intersectionPairsWith
      // (unlike the character controller's own shape-cast queries) depends on that tracked pair
      // existing. Confirmed via direct testing on the old ladder sensor this pattern is inherited
      // from: contact stayed unregistered even while visibly wedged against it until this was added.
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED);
    const mantleCollider = this.physics.world.createCollider(mantleColliderDesc, rigidBody);
    // The mantle snaps the player directly to this exact position rather than moving them there
    // via the physics shape-cast solver (see Player.ts) - direct teleport-on-contact was confirmed
    // via direct testing (on the old ladder mechanic this is inherited from) to be far more
    // reliable than a shape-cast nudge, which sometimes clipped the wall's own top corner and
    // dropped the player back down instead of landing them on the roof. Landing at the roof's exact
    // center (both X and Z) keeps clearance from every edge regardless of how large or small this
    // particular preset's footprint is.
    this.physics.registerClimbable(mantleCollider, {
      colliderHandle: mantleCollider.handle,
      x: colliderCenterX,
      y: groundY + preset.height + PLAYER_HEIGHT / 2 + CRATE_MANTLE_ROOF_CLEARANCE,
      z: colliderCenterZ,
    });

    const crateGroup = this.createCrateStackVisual(colliderCenterX, groundY, wallFaceZ);
    this.scene.add(crateGroup);

    return {
      mantleColliderHandle: mantleCollider.handle,
      crateColliderHandles,
      crateGroup,
      x: colliderCenterX,
      wallFaceZ,
    };
  }

  /** Debug/test-only: exact crate-stack positions for every currently-streamed-in house, so e2e
   * tests can navigate precisely to a known one instead of guessing blindly at one. */
  getActiveCrateStackPositions(): { x: number; wallFaceZ: number }[] {
    return Array.from(this.activeBuildings.values())
      .map((b) => b.crateStack)
      .filter((crateStack): crateStack is NonNullable<PlacedBuilding['crateStack']> => crateStack !== null)
      .map((crateStack) => ({ x: crateStack.x, wallFaceZ: crateStack.wallFaceZ }));
  }

  /** Simple procedural crate boxes (a main body plus a darker banding box, per tier) rather than a
   * sourced/textured asset - matches the project's existing placeholder-primitive style for
   * non-hero geometry (rocks, targets, etc. - see NOTES.md), and keeps this feature self-contained
   * without a new asset dependency. Each crate's *base* position matches createCrateStack's
   * physical colliders exactly (same tier/distanceFromWall formulas) - the small per-crate
   * position/rotation/tint jitter below is cosmetic only, offset from that base position by less
   * than the collider's own margin from its neighbors, so the visible crates still read as sitting
   * on what the player is actually standing/jumping on, never floating clear of it or appearing to
   * block a step that isn't really there. Per playtest feedback the un-jittered version read as an
   * obvious geometric staircase rather than a casual pile of stacked crates - the jitter is
   * deterministic (seeded from this exact building's position, mirroring how TownLayout/RNG usage
   * elsewhere in this file seeds off cell coordinates) so a reloaded world still looks identical,
   * not different crates on every visit. */
  private createCrateStackVisual(worldX: number, groundY: number, wallFaceZ: number): THREE.Group {
    const group = new THREE.Group();
    const crateGeometry = new THREE.BoxGeometry(CRATE_SIZE * 0.96, CRATE_SIZE * 0.96, CRATE_SIZE * 0.96);
    const bandGeometry = new THREE.BoxGeometry(CRATE_SIZE * 0.98, CRATE_SIZE * 0.16, CRATE_SIZE * 0.98);
    const rng = mulberry32(hashChunkSeed(Math.round(worldX * 10), Math.round(wallFaceZ * 10), getWorldSeed() + 40));

    const jitterRange = CRATE_SIZE * 0.12;
    const rotationRange = Math.PI / 5;

    for (let tier = 0; tier < CRATE_TIER_COUNT; tier++) {
      const distanceFromWall = (CRATE_TIER_COUNT - tier) * CRATE_SIZE;
      const y = tier * CRATE_SIZE + CRATE_SIZE / 2;
      const z = -(distanceFromWall - CRATE_SIZE / 2);
      const jitterX = (rng() - 0.5) * jitterRange;
      const jitterZ = (rng() - 0.5) * jitterRange;
      const rotationY = (rng() - 0.5) * rotationRange;

      const crate = new THREE.Mesh(crateGeometry, this.crateMaterial.clone());
      crate.position.set(jitterX, y, z + jitterZ);
      crate.rotation.y = rotationY;
      // Slight per-crate tint variance so a stack of identical boxes doesn't read as obviously
      // instanced/copy-pasted - each crate's own clone keeps this from bleeding into siblings.
      (crate.material as THREE.MeshStandardMaterial).color.offsetHSL(0, 0, (rng() - 0.5) * 0.08);
      group.add(crate);

      const band = new THREE.Mesh(bandGeometry, this.crateBandMaterial);
      band.position.copy(crate.position);
      band.rotation.y = rotationY;
      group.add(band);
    }

    group.position.set(worldX, groundY, wallFaceZ);
    return group;
  }
}
