import RAPIER from '@dimforge/rapier3d-compat';
import { CONTACT_SHADOW_LIFT, createContactShadowGeometry, createContactShadowMaterial } from '../render/contactShadows.ts';
import * as THREE from 'three';
import { getWorldSeed } from '../core/worldSeed.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { ObstacleRegistry } from '../entities/enemies/tactics/obstacleRegistry.ts';
import { mulberry32 } from '../utils/rng.ts';
import { isPointNearFootprint } from './houseFootprint.ts';
import { chunkKey, hashChunkSeed } from './chunkSeed.ts';
import { HOUSE_DESIGNS, type HouseDesign } from './houseDesigns.ts';
import { createBoxCollider, createHullCollider } from './structureKit.ts';
import { ValleyHouses, type HousePlacement } from './houses/ValleyHouses.ts';
import type { HouseRef } from './houses/valleyHouseIds.ts';
import { sampleHeight } from './TerrainGenerator.ts';
import { getFlatZoneSite, radiusOfFlatZoneAtAngle, type FlatZoneSite } from './ZoneMap.ts';
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

/** One house design ready to place: the merged meshes every placement clones (sharing geometry and
 * materials) and its footprint, centred on the placement point. */
interface BuildingPreset {
  design: HouseDesign;
  template: THREE.Group;
  /** The rooms' contents, hidden at a distance (ValleyHouses). */
  interiorTemplate: THREE.Group;
  footprintWidth: number;
  footprintDepth: number;
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
  /** Child of `group`: the interior, hidden at a distance. */
  interior: THREE.Object3D;
  rigidBodyHandle: number;
  /** One collider per solid part of the design, all attached to rigidBodyHandle's body. */
  colliderHandles: number[];
}

/**
 * Town-clustered building placement (WORLD_PLAN.md follow-up: buildings should form clusters like
 * a small town, not scatter one-per-chunk independently). A town's entire layout is a pure function
 * of its flat-zone cell coordinates (see getTownLayout) - generated once, memoized, and identical
 * regardless of which chunk or when it's asked for. Each chunk spawns only the buildings from any
 * overlapping town whose position actually falls inside that chunk's bounds, so a town spanning
 * several chunks streams in/out correctly no matter the load order.
 */
/** Metres the house contact shadow reaches past the walls on each side, and how dark its core is. */
const HOUSE_CONTACT_SHADOW_MARGIN = 1.6;
const HOUSE_CONTACT_SHADOW_STRENGTH = 0.6;

export class BuildingManager {
  private readonly townLayoutCache = new Map<string, TownLayout>();
  private readonly activeBuildings = new Map<string, PlacedBuilding>();
  private readonly chunkOwnedBuildingIds = new Map<string, string[]>();
  /** The houses' doors, ceiling lamps and interior culling (docs/enterable-buildings.md). */
  readonly houses: ValleyHouses;

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly presets: BuildingPreset[],
    /** Where enemies look for cover (enemy AI v2 step 3): each placed house's footprint is
     * registered per chunk and dropped when the chunk unloads. */
    private readonly obstacles?: ObstacleRegistry,
    lampsOn = false,
  ) {
    this.houses = new ValleyHouses(scene, physics.world, (ref) => this.houseAt(ref), lampsOn);
  }

  /** `lampsOn`: the houses' ceiling lamps are lit (a Night or Fog match). */
  static async create(scene: THREE.Scene, physics: PhysicsWorld, obstacles?: ObstacleRegistry, options: { lampsOn?: boolean } = {}): Promise<BuildingManager> {
    // Built in code, so nothing loads; kept async so the match setup awaits it as before.
    const presets: BuildingPreset[] = HOUSE_DESIGNS.map((design) => ({
      design,
      template: design.build(),
      interiorTemplate: design.buildInterior(),
      footprintWidth: design.footprintWidth,
      footprintDepth: design.footprintDepth,
    }));
    return new BuildingManager(scene, physics, presets, obstacles, options.lampsOn ?? false);
  }

  /** Where house `ref` stands in the world, streamed in or not (the same memoized town layout
   * placement uses), or null when there is no such house. */
  houseAt(ref: HouseRef): HousePlacement | null {
    const site = getFlatZoneSite(ref.gx, ref.gz);
    if (!site) return null;
    const placement = this.getTownLayout(ref.gx, ref.gz, site).buildings[ref.index];
    if (!placement || !this.presets[placement.presetIndex]) return null;
    const x = site.siteX + placement.localX, z = site.siteZ + placement.localZ;
    return { ref, design: placement.presetIndex, x, groundY: sampleHeight(x, z), z, rotationY: placement.rotationY };
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
          this.houses.housePlaced(id, {
            ref: { gx, gz, index }, design: placement.presetIndex, x: worldX, groundY: placed.group.position.y, z: worldZ, rotationY: placement.rotationY,
          }, placed.interior);
          this.obstacles?.add(chunkKey(cx, cz), {
            kind: 'house',
            footprint: {
              originX: worldX,
              originZ: worldZ,
              offsetX: 0,
              offsetZ: 0,
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
      this.houses.houseRemoved(id);

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
   * is each design's full XZ rectangle (eaves included, wider than its walls), turned with the
   * building's own rotation; `margin` is Euclidean distance from that
   * rectangle, and a negative margin counts as 0. Only the one to four flat-zone cells within reach
   * are looked at, each a dozen or so rectangle tests, so ~50 calls per respawn cost next to nothing. */
  isPointInsideBuilding(x: number, z: number, margin: number): boolean {
    // Same cell bound placeForChunk uses (a site sits inside its own cell and every building center
    // within FLAT_ZONE_RADIUS_MAX of it), widened by the farthest any footprint edge reaches from its
    // building's placement point, plus the margin itself.
    let footprintReach = 0;
    for (const preset of this.presets) {
      footprintReach = Math.max(footprintReach, Math.hypot(preset.footprintWidth, preset.footprintDepth) / 2);
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
            offsetX: 0,
            offsetZ: 0,
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

  /** One soft darkened rectangle under each house, a little wider than its walls, shared by all. */
  private readonly contactShadowGeometry = createContactShadowGeometry();
  private readonly contactShadowMaterial = createContactShadowMaterial('rect', HOUSE_CONTACT_SHADOW_STRENGTH);

  private createBuilding(worldX: number, worldZ: number, rotationY: number, preset: BuildingPreset): PlacedBuilding {
    const groundY = sampleHeight(worldX, worldZ);

    // Clones share the template's merged geometry and materials.
    const group = preset.template.clone();
    group.rotation.y = rotationY;
    group.position.set(worldX, groundY, worldZ);
    const contactShadow = new THREE.Mesh(this.contactShadowGeometry, this.contactShadowMaterial);
    contactShadow.scale.set(preset.footprintWidth + HOUSE_CONTACT_SHADOW_MARGIN * 2, 1, preset.footprintDepth + HOUSE_CONTACT_SHADOW_MARGIN * 2);
    contactShadow.position.y = CONTACT_SHADOW_LIFT;
    contactShadow.renderOrder = -1;
    group.add(contactShadow);
    const interior = preset.interiorTemplate.clone();
    interior.name = 'house-interior';
    group.add(interior);
    this.scene.add(group);

    // The design's solids and gable fills, in its local frame, on a body given exactly the visual
    // group's position and Y rotation, so collider and mesh share one transform. three's rotation.y
    // and this quaternion are the same right-handed turn about +Y.
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(worldX, groundY, worldZ)
      .setRotation({ x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) });
    const rigidBody = this.physics.world.createRigidBody(bodyDesc);
    const colliderHandles = preset.design.solids.map((solid) => createBoxCollider(this.physics.world, rigidBody, solid.box).handle);
    for (const points of preset.design.hulls) {
      const hull = createHullCollider(this.physics.world, rigidBody, points);
      if (hull) colliderHandles.push(hull.handle);
    }

    return {
      group,
      interior,
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
