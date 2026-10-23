import * as THREE from 'three';
import { gradeMaterial } from '../render/materialGrade.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Chunk } from './Chunk.ts';
import {
  GROUND_AO_TEXTURE_URL,
  GROUND_NORMAL_TEXTURE_URL,
  GROUND_ROUGHNESS_TEXTURE_URL,
  GROUND_TEXTURE_REPEAT,
  GROUND_TEXTURE_URL,
  MAX_CHUNK_GENERATIONS_PER_TICK,
  TERRAIN_CHUNK_SIZE,
  TERRAIN_RESOLUTION,
  UNLOAD_RADIUS_CHUNKS,
  VIEW_RADIUS_CHUNKS,
  WORLD_MAX_CHUNK,
  WORLD_MIN_CHUNK,
} from '../core/config.ts';

const textureLoader = new THREE.TextureLoader();

/** aoMap/normalMap/roughnessMap must not repeat via the color-space-corrected diffuse map's own
 * settings - each needs its own RepeatWrapping + repeat, since Three.js textures don't share wrap
 * state even when they tile identically (VISUAL_REALISM.md §2). Only the diffuse map is sRGB;
 * normal/rough/AO are linear data, not color, so they're left at the TextureLoader default. */
function loadTiledTexture(url: string, colorSpace?: THREE.ColorSpace): THREE.Texture {
  const texture = textureLoader.load(url, undefined, undefined, (error) => {
    console.error(`Failed to load ground texture from ${url}`, error);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(GROUND_TEXTURE_REPEAT, GROUND_TEXTURE_REPEAT);
  if (colorSpace) texture.colorSpace = colorSpace;
  return texture;
}

export function createGroundMaterial(): THREE.Material {
  const material = new THREE.MeshStandardMaterial({
    map: loadTiledTexture(GROUND_TEXTURE_URL, THREE.SRGBColorSpace),
    normalMap: loadTiledTexture(GROUND_NORMAL_TEXTURE_URL),
    roughnessMap: loadTiledTexture(GROUND_ROUGHNESS_TEXTURE_URL),
    aoMap: loadTiledTexture(GROUND_AO_TEXTURE_URL),
    roughness: 1,
    // Baked terrain AO (terrainShading.ts): every geometry using this material carries a colour.
    vertexColors: true,
  });
  gradeMaterial(material, 'ground');
  return material;
}

function isWithinWorldBounds(cx: number, cz: number): boolean {
  return cx >= WORLD_MIN_CHUNK && cx <= WORLD_MAX_CHUNK && cz >= WORLD_MIN_CHUNK && cz <= WORLD_MAX_CHUNK;
}

interface LoadedChunk {
  cx: number;
  cz: number;
  chunk: Chunk;
}

/** Lets other per-chunk content (vegetation, buildings) hang its own placement/cleanup off terrain
 * streaming without ChunkManager needing to know those systems exist. */
export interface ChunkStreamHooks {
  onChunkLoaded?: (cx: number, cz: number, originX: number, originZ: number, size: number) => void;
  onChunkUnloaded?: (cx: number, cz: number) => void;
}

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** Streams terrain chunks in/out around the player. Generation is main-thread and budgeted per tick to avoid hitches. */
export class ChunkManager {
  private readonly loaded = new Map<string, LoadedChunk>();
  private readonly material: THREE.Material;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly hooks: ChunkStreamHooks = {},
  ) {
    this.material = createGroundMaterial();
  }

  update(playerX: number, playerZ: number): void {
    const centerCx = Math.floor(playerX / TERRAIN_CHUNK_SIZE);
    const centerCz = Math.floor(playerZ / TERRAIN_CHUNK_SIZE);

    this.loadNearestMissing(centerCx, centerCz);
    this.unloadFarChunks(centerCx, centerCz);
  }

  private loadNearestMissing(centerCx: number, centerCz: number): void {
    const missing: { cx: number; cz: number; distSq: number }[] = [];

    for (let dz = -VIEW_RADIUS_CHUNKS; dz <= VIEW_RADIUS_CHUNKS; dz++) {
      for (let dx = -VIEW_RADIUS_CHUNKS; dx <= VIEW_RADIUS_CHUNKS; dx++) {
        const cx = centerCx + dx;
        const cz = centerCz + dz;
        if (isWithinWorldBounds(cx, cz) && !this.loaded.has(chunkKey(cx, cz))) {
          missing.push({ cx, cz, distSq: dx * dx + dz * dz });
        }
      }
    }

    missing.sort((a, b) => a.distSq - b.distSq);

    const budget = Math.min(MAX_CHUNK_GENERATIONS_PER_TICK, missing.length);
    for (let i = 0; i < budget; i++) {
      const next = missing[i];
      if (next) this.loadChunk(next.cx, next.cz);
    }
  }

  private unloadFarChunks(centerCx: number, centerCz: number): void {
    for (const [key, entry] of this.loaded) {
      const dx = entry.cx - centerCx;
      const dz = entry.cz - centerCz;
      if (Math.max(Math.abs(dx), Math.abs(dz)) > UNLOAD_RADIUS_CHUNKS) {
        this.unloadChunk(key, entry);
      }
    }
  }

  private loadChunk(cx: number, cz: number): void {
    const originX = cx * TERRAIN_CHUNK_SIZE;
    const originZ = cz * TERRAIN_CHUNK_SIZE;
    const chunk = new Chunk(this.physics, this.material, {
      originX,
      originZ,
      size: TERRAIN_CHUNK_SIZE,
      resolution: TERRAIN_RESOLUTION,
    });
    this.scene.add(chunk.mesh);
    this.loaded.set(chunkKey(cx, cz), { cx, cz, chunk });
    this.hooks.onChunkLoaded?.(cx, cz, originX, originZ, TERRAIN_CHUNK_SIZE);
  }

  private unloadChunk(key: string, entry: LoadedChunk): void {
    this.scene.remove(entry.chunk.mesh);
    entry.chunk.dispose(this.physics);
    this.loaded.delete(key);
    this.hooks.onChunkUnloaded?.(entry.cx, entry.cz);
  }
}
