import { createNoise2D } from 'simplex-noise';
import { gradeMaterial, type SurfaceKind } from '../render/materialGrade.ts';
import * as THREE from 'three';
import { loadGLTF } from '../core/AssetLoader.ts';
import { getWorldSeed } from '../core/worldSeed.ts';
import { mulberry32 } from '../utils/rng.ts';
import { chunkKey, hashChunkSeed } from './chunkSeed.ts';
import { sampleHeight } from './TerrainGenerator.ts';
import { sampleFlatZone } from './ZoneMap.ts';
import { isPointInsideWatchTower } from './WatchTowerManager.ts';

/** Extra metres of vegetation-free ground around each watch tower's solid footprint. */
const WATCH_TOWER_VEGETATION_CLEARANCE = 1.5;
import {
  FOREST_TREE_THRESHOLD_DROP,
  MULTIPLAYER_SPAWN_POINTS,
  SPAWN_X,
  SPAWN_Z,
  VEGETATION_BUSH_PROBABILITY,
  VEGETATION_CANDIDATES_PER_CHUNK,
  VEGETATION_CANOPY_CENTER_HEIGHT_FRACTION,
  VEGETATION_CANOPY_RADIUS,
  VEGETATION_DENSITY_NOISE_FREQUENCY,
  VEGETATION_FOREST_EXTRA_CANDIDATES,
  VEGETATION_FOREST_TEXTURE_FREQUENCY,
  VEGETATION_INSTANCE_CAPACITY,
  VEGETATION_MAX_PER_CHUNK_PER_TYPE,
  VEGETATION_ROCK_PROBABILITY,
  VEGETATION_SCALE_VARIANCE,
  VEGETATION_SPAWN_CLEARANCE,
  VEGETATION_TREE_DENSITY_THRESHOLD,
  VEGETATION_TREE_MIN_SPACING_DENSE,
  VEGETATION_TREE_MIN_SPACING_NORMAL,
  VEGETATION_TRUNK_RADIUS,
  WORLD_HARD_CLAMP_RADIUS,
} from '../core/config.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { ObstacleRegistry } from '../entities/enemies/tactics/obstacleRegistry.ts';

type VegetationTypeId = 'treeDefault' | 'treePine' | 'bush' | 'rock';
type ColliderShape = 'cylinder' | 'box' | 'none';

interface VegetationTypeDef {
  id: VegetationTypeId;
  modelPath: string;
  targetHeight: number;
  colliderShape: ColliderShape;
}

const VEGETATION_TYPES: VegetationTypeDef[] = [
  { id: 'treeDefault', modelPath: '/assets/models/vegetation/tree_default.glb', targetHeight: 6.0, colliderShape: 'cylinder' },
  { id: 'treePine', modelPath: '/assets/models/vegetation/tree_pineRoundA.glb', targetHeight: 4.5, colliderShape: 'cylinder' },
  { id: 'bush', modelPath: '/assets/models/vegetation/plant_bushLarge.glb', targetHeight: 1.0, colliderShape: 'none' },
  // Box, not 'none': rocks are large enough that walking through them looked broken - a player
  // should have to walk around (or over, if small enough to autostep) a solid boulder.
  { id: 'rock', modelPath: '/assets/models/vegetation/rock_largeA.glb', targetHeight: 0.9, colliderShape: 'box' },
];

const TREE_TYPES: VegetationTypeId[] = ['treeDefault', 'treePine'];

interface VegetationPool {
  instancedMeshes: THREE.InstancedMesh[];
  scaleFactor: number;
  /** Raw (unscaled) footprint, measured once at load time - see extractBakedPrimitives. */
  rawFootprintWidth: number;
  rawFootprintDepth: number;
  freeIndices: number[];
  nextFreeIndex: number;
}

interface PlacedInstance {
  type: VegetationTypeId;
  index: number;
  colliderHandle?: number;
  rigidBodyHandle?: number;
  /** Tree types only - separate rigid body/collider from the trunk (see placeInstance). */
  canopyColliderHandle?: number;
  canopyRigidBodyHandle?: number;
}

const ZERO_SCALE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/** Bakes each glTF node's world transform into flat geometry (handles arbitrary author-side node
 * offsets, e.g. Kenney's tree models nest a small translation under a "tmpParent" node) and returns
 * one {geometry, material} pair per mesh primitive, normalized so the combined bounding box's
 * lowest point sits at local Y=0 - regardless of what offset the source file actually used. */
/** Nature Kit material names: woodBark/woodBarkDark, leafsGreen/leafsDark, grass, dirt. */
function vegetationSurfaceKind(materialName: string): SurfaceKind {
  if (materialName.startsWith('wood')) return 'bark';
  if (materialName === 'dirt') return 'rock';
  return 'foliage';
}

function extractBakedPrimitives(root: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  root.updateMatrixWorld(true);
  const primitives: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    // Kenney's Nature Kit glTF export bakes metallicFactor: 1 into every material (unlike the
    // Blaster Kit/Mini Characters packs already used elsewhere, which export metallic: 0). With no
    // scene.environment for IBL, a fully metallic MeshStandardMaterial has near-zero diffuse
    // reflectance and renders almost black except at grazing specular angles - confirmed by
    // screenshotting distant vs. close vegetation before this fix (see NOTES.md).
    if (material instanceof THREE.MeshStandardMaterial) material.metalness = 0;
    gradeMaterial(material, vegetationSurfaceKind(material.name));
    primitives.push({ geometry, material });
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const { geometry } of primitives) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) continue;
    minX = Math.min(minX, box.min.x);
    maxX = Math.max(maxX, box.max.x);
    minY = Math.min(minY, box.min.y);
    maxY = Math.max(maxY, box.max.y);
    minZ = Math.min(minZ, box.min.z);
    maxZ = Math.max(maxZ, box.max.z);
  }
  for (const { geometry } of primitives) {
    geometry.translate(0, -minY, 0);
  }

  // Stash pre-normalization measurements on the first primitive's geometry userData for the caller.
  if (primitives[0]) {
    primitives[0].geometry.userData.rawHeight = maxY - minY;
    primitives[0].geometry.userData.rawFootprintWidth = maxX - minX;
    primitives[0].geometry.userData.rawFootprintDepth = maxZ - minZ;
  }
  return primitives;
}

/**
 * Per-chunk deterministic vegetation scatter (WORLD_PLAN.md §4): trees/bushes/rocks rendered via
 * one shared THREE.InstancedMesh pool per (type, sub-mesh) so the whole bounded world's vegetation
 * costs a handful of draw calls total, not one per tree. Placement is seeded from chunk coordinates
 * so a given chunk always generates the same scatter, and density is gated by a low-frequency noise
 * field so vegetation clusters into forest patches and clearings instead of uniform speckling.
 */
export class VegetationManager {
  private readonly pools = new Map<VegetationTypeId, VegetationPool>();
  private readonly chunkInstances = new Map<string, PlacedInstance[]>();
  private readonly densityNoise2D: (x: number, y: number) => number;
  private readonly forestTextureNoise2D: (x: number, y: number) => number;

  private constructor(
    private readonly physics: PhysicsWorld,
    pools: Map<VegetationTypeId, VegetationPool>,
    /** Where enemies look for cover (enemy AI v2 step 3): tree trunks are registered per chunk as
     * they are placed and dropped when the chunk unloads. Rocks are not: at about 0.9 m they sit
     * below an enemy's chest and hide nothing. */
    private readonly obstacles?: ObstacleRegistry,
  ) {
    this.pools = pools;
    this.densityNoise2D = createNoise2D(mulberry32(getWorldSeed() + 2));
    // Distinct seed/frequency from the main density field - textures a forest's *interior* into
    // thicket/clearing patches, independent of the broad forest-vs-not gating that field drives.
    this.forestTextureNoise2D = createNoise2D(mulberry32(getWorldSeed() + 13));
  }

  static async create(scene: THREE.Scene, physics: PhysicsWorld, obstacles?: ObstacleRegistry): Promise<VegetationManager> {
    const pools = new Map<VegetationTypeId, VegetationPool>();

    for (const def of VEGETATION_TYPES) {
      const gltf = await loadGLTF(def.modelPath);
      const primitives = extractBakedPrimitives(gltf.scene.clone());
      const rawHeight = (primitives[0]?.geometry.userData.rawHeight as number | undefined) ?? def.targetHeight;
      const rawFootprintWidth = (primitives[0]?.geometry.userData.rawFootprintWidth as number | undefined) ?? 0;
      const rawFootprintDepth = (primitives[0]?.geometry.userData.rawFootprintDepth as number | undefined) ?? 0;
      const scaleFactor = def.targetHeight / rawHeight;

      const instancedMeshes = primitives.map(({ geometry, material }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, VEGETATION_INSTANCE_CAPACITY);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        for (let i = 0; i < VEGETATION_INSTANCE_CAPACITY; i++) mesh.setMatrixAt(i, ZERO_SCALE_MATRIX);
        scene.add(mesh);
        return mesh;
      });

      pools.set(def.id, { instancedMeshes, scaleFactor, rawFootprintWidth, rawFootprintDepth, freeIndices: [], nextFreeIndex: 0 });
    }

    return new VegetationManager(physics, pools, obstacles);
  }

  /** Called by ChunkManager's onChunkLoaded hook - scatters vegetation across the newly loaded chunk. */
  placeForChunk(cx: number, cz: number, originX: number, originZ: number, size: number): void {
    const rng = mulberry32(hashChunkSeed(cx, cz, getWorldSeed()));
    const placed: PlacedInstance[] = [];
    const perTypeCount = new Map<VegetationTypeId, number>();
    const placedTreePositions: { x: number; z: number }[] = [];

    // Per user request ("remove forest spawn and generation restrictions"): every chunk now draws
    // the full forest-level candidate budget unconditionally, not just chunks that happen to
    // overlap a forest zone - forest zones are geographically rare (only a handful fit in this
    // world's safe annulus even at max density), so gating the higher candidate count on forest
    // membership left most of the explorable map on the much sparser base budget regardless of how
    // dense forest zones themselves got tuned. See pickType/minTreeSpacingFor below for the
    // matching change to the density/spacing thresholds themselves.
    const candidateCount = VEGETATION_CANDIDATES_PER_CHUNK + VEGETATION_FOREST_EXTRA_CANDIDATES;

    for (let i = 0; i < candidateCount; i++) {
      const worldX = originX + rng() * size;
      const worldZ = originZ + rng() * size;

      const distanceFromOrigin = Math.sqrt(worldX * worldX + worldZ * worldZ);
      if (distanceFromOrigin > WORLD_HARD_CLAMP_RADIUS) continue;

      const dxSpawn = worldX - SPAWN_X;
      const dzSpawn = worldZ - SPAWN_Z;
      const distanceFromSpawn = Math.sqrt(dxSpawn * dxSpawn + dzSpawn * dzSpawn);
      if (distanceFromSpawn < VEGETATION_SPAWN_CLEARANCE) continue;

      // Also clears every candidate multiplayer spawn point (see the MULTIPLAYER_SPAWN_POINTS
      // comment in config.ts) - checked unconditionally, not just in multiplayer matches, since a
      // single-player match never uses these coordinates anyway and it keeps world generation
      // itself mode-agnostic rather than branching on match type.
      const tooCloseToMultiplayerSpawn = MULTIPLAYER_SPAWN_POINTS.some(
        (point) => Math.hypot(worldX - point.x, worldZ - point.z) < VEGETATION_SPAWN_CLEARANCE,
      );
      if (tooCloseToMultiplayerSpawn) continue;

      // Keep town pads entirely clear of vegetation - a tree or boulder in the middle of a
      // building cluster would look wrong and a rock's collider could interfere with a building.
      if (sampleFlatZone(worldX, worldZ).membership > 0) continue;
      // Same for watch towers: a tree trunk or (now that clutter spawns again) a rock's box collider
      // on a tower's stairs or in its flattened clearing blocked the climb and looked broken.
      if (isPointInsideWatchTower(worldX, worldZ, WATCH_TOWER_VEGETATION_CLEARANCE)) continue;

      const rawNoise = this.densityNoise2D(worldX * VEGETATION_DENSITY_NOISE_FREQUENCY, worldZ * VEGETATION_DENSITY_NOISE_FREQUENCY);
      const type = pickType(rawNoise, rng);
      if (!type) continue;

      if (TREE_TYPES.includes(type)) {
        const textureNoise = this.forestTextureNoise2D(worldX * VEGETATION_FOREST_TEXTURE_FREQUENCY, worldZ * VEGETATION_FOREST_TEXTURE_FREQUENCY);
        const minSpacing = minTreeSpacingFor(textureNoise);
        const tooClose = placedTreePositions.some((p) => {
          const dx = worldX - p.x;
          const dz = worldZ - p.z;
          return Math.sqrt(dx * dx + dz * dz) < minSpacing;
        });
        if (tooClose) continue;
        placedTreePositions.push({ x: worldX, z: worldZ });
      }

      const countSoFar = perTypeCount.get(type) ?? 0;
      if (countSoFar >= VEGETATION_MAX_PER_CHUNK_PER_TYPE) continue;
      perTypeCount.set(type, countSoFar + 1);

      const instance = this.placeInstance(type, worldX, worldZ, rng);
      if (instance) placed.push(instance);
      if (instance?.colliderHandle !== undefined && TREE_TYPES.includes(type)) {
        this.obstacles?.add(chunkKey(cx, cz), { kind: 'trunk', x: worldX, z: worldZ, radius: VEGETATION_TRUNK_RADIUS });
      }
    }

    this.chunkInstances.set(chunkKey(cx, cz), placed);
    this.markPoolsDirty();
  }

  /** Called by ChunkManager's onChunkUnloaded hook - hides this chunk's instances and removes their colliders. */
  removeChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const placed = this.chunkInstances.get(key);
    if (!placed) return;

    for (const instance of placed) {
      const pool = this.pools.get(instance.type);
      if (!pool) continue;
      for (const mesh of pool.instancedMeshes) mesh.setMatrixAt(instance.index, ZERO_SCALE_MATRIX);
      pool.freeIndices.push(instance.index);

      if (instance.colliderHandle !== undefined) {
        const collider = this.physics.world.getCollider(instance.colliderHandle);
        if (collider) this.physics.world.removeCollider(collider, true);
      }
      if (instance.rigidBodyHandle !== undefined) {
        const rigidBody = this.physics.world.getRigidBody(instance.rigidBodyHandle);
        if (rigidBody) this.physics.world.removeRigidBody(rigidBody);
      }
      if (instance.canopyColliderHandle !== undefined) {
        const collider = this.physics.world.getCollider(instance.canopyColliderHandle);
        if (collider) this.physics.world.removeCollider(collider, true);
      }
      if (instance.canopyRigidBodyHandle !== undefined) {
        const rigidBody = this.physics.world.getRigidBody(instance.canopyRigidBodyHandle);
        if (rigidBody) this.physics.world.removeRigidBody(rigidBody);
      }
    }

    this.chunkInstances.delete(key);
    this.obstacles?.removeChunk(key);
    this.markPoolsDirty();
  }

  private placeInstance(type: VegetationTypeId, worldX: number, worldZ: number, rng: () => number): PlacedInstance | null {
    const pool = this.pools.get(type);
    if (!pool) return null;

    // Reuse a freed slot if one exists; otherwise claim the next slot only if capacity allows -
    // nextFreeIndex must never advance past capacity, or markPoolsDirty's mesh.count would ask
    // Three.js to draw/shadow-cast past the InstancedMesh's actual allocated instance buffer.
    if (pool.freeIndices.length === 0 && pool.nextFreeIndex >= VEGETATION_INSTANCE_CAPACITY) return null;
    const index = pool.freeIndices.pop() ?? pool.nextFreeIndex++;

    const worldY = sampleHeight(worldX, worldZ);
    const scaleJitter = 1 + (rng() * 2 - 1) * VEGETATION_SCALE_VARIANCE;
    const scale = pool.scaleFactor * scaleJitter;
    const rotationY = rng() * Math.PI * 2;

    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(worldX, worldY, worldZ),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
      new THREE.Vector3(scale, scale, scale),
    );
    for (const mesh of pool.instancedMeshes) mesh.setMatrixAt(index, matrix);

    const def = VEGETATION_TYPES.find((d) => d.id === type);
    const instance: PlacedInstance = { type, index };

    const scaledHeight = def?.targetHeight ? def.targetHeight * scaleJitter : 0;
    const halfHeight = scaledHeight / 2;

    if (def?.colliderShape === 'cylinder') {
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(worldX, worldY + halfHeight, worldZ);
      const rigidBody = this.physics.world.createRigidBody(bodyDesc);
      const collider = this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, VEGETATION_TRUNK_RADIUS), rigidBody);
      instance.colliderHandle = collider.handle;
      instance.rigidBodyHandle = rigidBody.handle;
    } else if (def?.colliderShape === 'box') {
      // Rocks are irregular/randomly rotated - an axis-aligned box close to the real footprint is
      // good enough to stop players walking straight through, without needing rotation-aware sizing.
      const halfWidth = (pool.rawFootprintWidth * scale) / 2;
      const halfDepth = (pool.rawFootprintDepth * scale) / 2;
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(worldX, worldY + halfHeight, worldZ);
      const rigidBody = this.physics.world.createRigidBody(bodyDesc);
      const collider = this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfDepth), rigidBody);
      instance.colliderHandle = collider.handle;
      instance.rigidBodyHandle = rigidBody.handle;
    }

    // Leaf/canopy hit volume (trees only) - a sensor, so it's hit by hitscan raycasts (Rapier
    // includes sensors in raycasts by default) but never blocks movement (sensors never
    // participate in solid collision resolution) - see the VEGETATION_CANOPY_* comment in
    // config.ts for why this is the right primitive for "bullets yes, walking no."
    if (TREE_TYPES.includes(type)) {
      const { radius: canopyRadius, centerY: canopyCenterY } = canopyGeometryFor(worldY, scaledHeight, scaleJitter);
      const canopyBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(worldX, canopyCenterY, worldZ);
      const canopyRigidBody = this.physics.world.createRigidBody(canopyBodyDesc);
      const canopyColliderDesc = RAPIER.ColliderDesc.ball(canopyRadius).setSensor(true);
      const canopyCollider = this.physics.world.createCollider(canopyColliderDesc, canopyRigidBody);
      instance.canopyColliderHandle = canopyCollider.handle;
      instance.canopyRigidBodyHandle = canopyRigidBody.handle;
    }

    return instance;
  }

  /** mesh.count bounds how many instances the GPU draws/shadow-casts per frame - capping it at the
   * high-water mark of indices ever used (not the full fixed-size capacity) avoids wastefully
   * rendering hundreds of degenerate zero-scale instances while only a few chunks are loaded. */
  private markPoolsDirty(): void {
    for (const pool of this.pools.values()) {
      const count = Math.min(pool.nextFreeIndex, VEGETATION_INSTANCE_CAPACITY);
      for (const mesh of pool.instancedMeshes) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

/**
 * Trees are gated by the density noise field against a threshold - per user request ("remove
 * forest spawn and generation restrictions"), this is now a single flat threshold applied
 * everywhere rather than being lerped by forest zone membership (rare stragglers outside a forest,
 * a dense in-forest value inside one). The whole map now generates at the same tree density a
 * forest zone's *core* used to be reserved for. Bushes/rocks get their own uniform roll from the
 * chunk RNG, entirely independent of the density field - per project decision, clutter should
 * scatter randomly rather than cluster with trees.
 *
 * Exported for the unit-test layer (2026-07-10 review, Phase 6 test-coverage pass). Note: this
 * function no longer depends on zone membership at all (see the flat-threshold rationale above) -
 * the CODE_REVIEW.md checklist item asking for "pickType continuity at membership 0" predates that
 * refactor and no longer applies; tested here instead are the actual current threshold/scatter
 * invariants.
 */
export function pickType(rawNoise: number, rng: () => number): VegetationTypeId | null {
  // Clutter rolls FIRST, independent of the density field, exactly as the docstring above intends.
  // It used to roll only after the tree check failed, and once the effective tree threshold was
  // tuned down to 0 (density is in [0, 1], so any rawNoise above -1 passes) that fallthrough became
  // unreachable in practice: bushes and rocks silently stopped spawning anywhere (2026-09-14 fix).
  const scatterRoll = rng();
  if (scatterRoll < VEGETATION_BUSH_PROBABILITY) return 'bush';
  if (scatterRoll < VEGETATION_BUSH_PROBABILITY + VEGETATION_ROCK_PROBABILITY) return 'rock';

  const density = (rawNoise + 1) / 2;
  const treeThreshold = VEGETATION_TREE_DENSITY_THRESHOLD - FOREST_TREE_THRESHOLD_DROP;
  if (density > treeThreshold) {
    return TREE_TYPES[Math.floor((density * 997) % TREE_TYPES.length)] ?? TREE_TYPES[0]!;
  }
  return null;
}

/**
 * Minimum spacing enforced between trees placed in the same chunk - forest texture noise
 * (independent of and much finer than the main density field) decides where THIS specific patch
 * sits between "normal forest" and "extreme thicket" spacing, producing real internal variance
 * (some patches barely walkable, others comfortably open) per project decision. Per user request
 * ("remove forest spawn and generation restrictions"), this no longer blends back out to open,
 * sparse spacing outside a forest zone - the whole map now uses this same normal/thicket range
 * everywhere. */
function minTreeSpacingFor(textureNoise: number): number {
  const textureIntensity = (textureNoise + 1) / 2;
  return VEGETATION_TREE_MIN_SPACING_NORMAL - textureIntensity * (VEGETATION_TREE_MIN_SPACING_NORMAL - VEGETATION_TREE_MIN_SPACING_DENSE);
}

/** Leaf/canopy sensor geometry for a tree instance - exported (and pulled out as a pure function)
 * specifically so a unit test can lock in the "canopy floats above where a standing player's
 * capsule can reach" invariant across the real scale-jitter range, without needing a running
 * PhysicsWorld. See the VEGETATION_CANOPY_* comment in config.ts for why this needs to hold. */
export function canopyGeometryFor(worldY: number, scaledHeight: number, scaleJitter: number): { radius: number; centerY: number } {
  return {
    radius: VEGETATION_CANOPY_RADIUS * scaleJitter,
    centerY: worldY + scaledHeight * VEGETATION_CANOPY_CENTER_HEIGHT_FRACTION,
  };
}
