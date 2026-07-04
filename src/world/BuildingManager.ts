import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { loadGLTF } from '../core/AssetLoader.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { mulberry32 } from '../utils/rng.ts';
import { chunkKey, hashChunkSeed } from './chunkSeed.ts';
import { sampleHeight } from './TerrainGenerator.ts';
import {
  BUILDING_CHUNK_SPAWN_CHANCE,
  BUILDING_MIN_GAP,
  BUILDING_SPAWN_CLEARANCE,
  SPAWN_X,
  SPAWN_Z,
  WORLD_HARD_CLAMP_RADIUS,
  WORLD_SEED,
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

/** Distinct from vegetation/terrain seeds so building placement doesn't correlate with either. */
const BUILDING_SEED_OFFSET = 3;

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

interface PlacedBuilding {
  centerX: number;
  centerZ: number;
  halfDiagonal: number;
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

/**
 * Per-chunk deterministic building placement (WORLD_PLAN.md §3). At most one building per chunk,
 * gated by BUILDING_CHUNK_SPAWN_CHANCE so most chunks have none. A single fixed box collider per
 * building (sized to its measured footprint) both blocks movement and serves as the rooftop's
 * walkable surface - an axis-aligned box's top face is already flat, so no separate platform
 * collider is needed.
 */
export class BuildingManager {
  private readonly chunkBuildings = new Map<string, PlacedBuilding>();

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
    const rng = mulberry32(hashChunkSeed(cx, cz, WORLD_SEED + BUILDING_SEED_OFFSET));
    if (rng() > BUILDING_CHUNK_SPAWN_CHANCE) return;

    const preset = this.presets[Math.floor(rng() * this.presets.length)];
    if (!preset) return;

    const halfDiagonal = Math.sqrt(preset.footprintWidth ** 2 + preset.footprintDepth ** 2) / 2;
    const margin = Math.max(preset.footprintWidth, preset.footprintDepth) / 2;
    if (margin * 2 >= size) return;

    const centerX = originX + margin + rng() * (size - margin * 2);
    const centerZ = originZ + margin + rng() * (size - margin * 2);
    const rotationY = Math.floor(rng() * 4) * (Math.PI / 2);

    if (!this.isPlacementValid(centerX, centerZ, halfDiagonal)) return;

    this.chunkBuildings.set(chunkKey(cx, cz), this.createBuilding(centerX, centerZ, rotationY, preset, halfDiagonal));
  }

  /** Called by ChunkManager's onChunkUnloaded hook. */
  removeChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const building = this.chunkBuildings.get(key);
    if (!building) return;

    this.scene.remove(building.group);

    const collider = this.physics.world.getCollider(building.colliderHandle);
    if (collider) this.physics.world.removeCollider(collider, true);
    const rigidBody = this.physics.world.getRigidBody(building.rigidBodyHandle);
    if (rigidBody) this.physics.world.removeRigidBody(rigidBody);

    this.chunkBuildings.delete(key);
  }

  private isPlacementValid(centerX: number, centerZ: number, halfDiagonal: number): boolean {
    const distanceFromOrigin = Math.sqrt(centerX * centerX + centerZ * centerZ);
    if (distanceFromOrigin > WORLD_HARD_CLAMP_RADIUS) return false;

    const dxSpawn = centerX - SPAWN_X;
    const dzSpawn = centerZ - SPAWN_Z;
    const distanceFromSpawn = Math.sqrt(dxSpawn * dxSpawn + dzSpawn * dzSpawn) - halfDiagonal;
    if (distanceFromSpawn < BUILDING_SPAWN_CLEARANCE) return false;

    for (const existing of this.chunkBuildings.values()) {
      const dx = centerX - existing.centerX;
      const dz = centerZ - existing.centerZ;
      const centerDistance = Math.sqrt(dx * dx + dz * dz);
      const requiredDistance = halfDiagonal + existing.halfDiagonal + BUILDING_MIN_GAP;
      if (centerDistance < requiredDistance) return false;
    }

    return true;
  }

  private createBuilding(
    centerX: number,
    centerZ: number,
    rotationY: number,
    preset: BuildingPreset,
    halfDiagonal: number,
  ): PlacedBuilding {
    const groundY = sampleHeight(centerX, centerZ);

    const group = preset.scene.clone(true);
    group.scale.setScalar(preset.scaleFactor);
    group.rotation.y = rotationY;
    group.position.set(centerX, groundY, centerZ);
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
    const colliderCenterX = centerX + (preset.footprintOffsetX * cos + preset.footprintOffsetZ * sin);
    const colliderCenterZ = centerZ + (-preset.footprintOffsetX * sin + preset.footprintOffsetZ * cos);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(colliderCenterX, centerY, colliderCenterZ);
    const rigidBody = this.physics.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(colliderHalfWidth, preset.height / 2, colliderHalfDepth);
    const collider = this.physics.world.createCollider(colliderDesc, rigidBody);

    return {
      centerX,
      centerZ,
      halfDiagonal,
      group,
      rigidBodyHandle: rigidBody.handle,
      colliderHandle: collider.handle,
    };
  }
}
