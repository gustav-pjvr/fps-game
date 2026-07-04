import { createNoise2D } from 'simplex-noise';
import * as THREE from 'three';
import { loadGLTF } from '../core/AssetLoader.ts';
import { mulberry32 } from '../utils/rng.ts';
import { chunkKey, hashChunkSeed } from './chunkSeed.ts';
import { sampleHeight } from './TerrainGenerator.ts';
import {
  SPAWN_X,
  SPAWN_Z,
  VEGETATION_BUSH_DENSITY_THRESHOLD,
  VEGETATION_CANDIDATES_PER_CHUNK,
  VEGETATION_DENSITY_NOISE_FREQUENCY,
  VEGETATION_INSTANCE_CAPACITY,
  VEGETATION_MAX_PER_CHUNK_PER_TYPE,
  VEGETATION_ROCK_DENSITY_THRESHOLD,
  VEGETATION_SCALE_VARIANCE,
  VEGETATION_SPAWN_CLEARANCE,
  VEGETATION_TREE_DENSITY_THRESHOLD,
  VEGETATION_TRUNK_RADIUS,
  WORLD_HARD_CLAMP_RADIUS,
  WORLD_SEED,
} from '../core/config.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';

type VegetationTypeId = 'treeDefault' | 'treePine' | 'bush' | 'rock';

interface VegetationTypeDef {
  id: VegetationTypeId;
  modelPath: string;
  targetHeight: number;
  hasTrunkCollider: boolean;
}

const VEGETATION_TYPES: VegetationTypeDef[] = [
  { id: 'treeDefault', modelPath: '/assets/models/vegetation/tree_default.glb', targetHeight: 6.0, hasTrunkCollider: true },
  { id: 'treePine', modelPath: '/assets/models/vegetation/tree_pineRoundA.glb', targetHeight: 4.5, hasTrunkCollider: true },
  { id: 'bush', modelPath: '/assets/models/vegetation/plant_bushLarge.glb', targetHeight: 1.0, hasTrunkCollider: false },
  { id: 'rock', modelPath: '/assets/models/vegetation/rock_largeA.glb', targetHeight: 0.9, hasTrunkCollider: false },
];

const TREE_TYPES: VegetationTypeId[] = ['treeDefault', 'treePine'];

interface VegetationPool {
  instancedMeshes: THREE.InstancedMesh[];
  scaleFactor: number;
  freeIndices: number[];
  nextFreeIndex: number;
}

interface PlacedInstance {
  type: VegetationTypeId;
  index: number;
  colliderHandle?: number;
  rigidBodyHandle?: number;
}

const ZERO_SCALE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/** Bakes each glTF node's world transform into flat geometry (handles arbitrary author-side node
 * offsets, e.g. Kenney's tree models nest a small translation under a "tmpParent" node) and returns
 * one {geometry, material} pair per mesh primitive, normalized so the combined bounding box's
 * lowest point sits at local Y=0 - regardless of what offset the source file actually used. */
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
    primitives.push({ geometry, material });
  });

  let minY = Infinity;
  let maxY = -Infinity;
  for (const { geometry } of primitives) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) continue;
    minY = Math.min(minY, box.min.y);
    maxY = Math.max(maxY, box.max.y);
  }
  for (const { geometry } of primitives) {
    geometry.translate(0, -minY, 0);
  }

  // Stash the pre-normalization height on the first primitive's geometry userData for the caller.
  if (primitives[0]) primitives[0].geometry.userData.rawHeight = maxY - minY;
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

  private constructor(
    private readonly physics: PhysicsWorld,
    pools: Map<VegetationTypeId, VegetationPool>,
  ) {
    this.pools = pools;
    this.densityNoise2D = createNoise2D(mulberry32(WORLD_SEED + 2));
  }

  static async create(scene: THREE.Scene, physics: PhysicsWorld): Promise<VegetationManager> {
    const pools = new Map<VegetationTypeId, VegetationPool>();

    for (const def of VEGETATION_TYPES) {
      const gltf = await loadGLTF(def.modelPath);
      const primitives = extractBakedPrimitives(gltf.scene.clone());
      const rawHeight = (primitives[0]?.geometry.userData.rawHeight as number | undefined) ?? def.targetHeight;
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

      pools.set(def.id, { instancedMeshes, scaleFactor, freeIndices: [], nextFreeIndex: 0 });
    }

    return new VegetationManager(physics, pools);
  }

  /** Called by ChunkManager's onChunkLoaded hook - scatters vegetation across the newly loaded chunk. */
  placeForChunk(cx: number, cz: number, originX: number, originZ: number, size: number): void {
    const rng = mulberry32(hashChunkSeed(cx, cz, WORLD_SEED));
    const placed: PlacedInstance[] = [];
    const perTypeCount = new Map<VegetationTypeId, number>();

    for (let i = 0; i < VEGETATION_CANDIDATES_PER_CHUNK; i++) {
      const worldX = originX + rng() * size;
      const worldZ = originZ + rng() * size;

      const distanceFromOrigin = Math.sqrt(worldX * worldX + worldZ * worldZ);
      if (distanceFromOrigin > WORLD_HARD_CLAMP_RADIUS) continue;

      const dxSpawn = worldX - SPAWN_X;
      const dzSpawn = worldZ - SPAWN_Z;
      const distanceFromSpawn = Math.sqrt(dxSpawn * dxSpawn + dzSpawn * dzSpawn);
      if (distanceFromSpawn < VEGETATION_SPAWN_CLEARANCE) continue;

      const type = pickTypeForDensity(this.densityNoise2D(worldX * VEGETATION_DENSITY_NOISE_FREQUENCY, worldZ * VEGETATION_DENSITY_NOISE_FREQUENCY));
      if (!type) continue;

      const countSoFar = perTypeCount.get(type) ?? 0;
      if (countSoFar >= VEGETATION_MAX_PER_CHUNK_PER_TYPE) continue;
      perTypeCount.set(type, countSoFar + 1);

      const instance = this.placeInstance(type, worldX, worldZ, rng);
      if (instance) placed.push(instance);
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
    }

    this.chunkInstances.delete(key);
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

    if (def?.hasTrunkCollider) {
      const scaledHeight = def.targetHeight * scaleJitter;
      const halfHeight = scaledHeight / 2;
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(worldX, worldY + halfHeight, worldZ);
      const rigidBody = this.physics.world.createRigidBody(bodyDesc);
      const collider = this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, VEGETATION_TRUNK_RADIUS), rigidBody);
      instance.colliderHandle = collider.handle;
      instance.rigidBodyHandle = rigidBody.handle;
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

/** Bands a [-1,1] simplex sample into a vegetation type - trees need the deepest "forest" noise
 * peaks, rocks appear even in shallow/clearing noise, and low values place nothing at all so
 * combat sightlines/movement aren't universally obstructed. */
function pickTypeForDensity(rawNoise: number): VegetationTypeId | null {
  const density = (rawNoise + 1) / 2;
  if (density > VEGETATION_TREE_DENSITY_THRESHOLD) {
    return TREE_TYPES[Math.floor((density * 997) % TREE_TYPES.length)] ?? TREE_TYPES[0]!;
  }
  if (density > VEGETATION_BUSH_DENSITY_THRESHOLD) return 'bush';
  if (density > VEGETATION_ROCK_DENSITY_THRESHOLD) return 'rock';
  return null;
}
