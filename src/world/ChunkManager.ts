import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Chunk } from './Chunk.ts';
import {
  MAX_CHUNK_GENERATIONS_PER_TICK,
  TERRAIN_CHUNK_SIZE,
  TERRAIN_RESOLUTION,
  UNLOAD_RADIUS_CHUNKS,
  VIEW_RADIUS_CHUNKS,
} from '../core/config.ts';

interface LoadedChunk {
  cx: number;
  cz: number;
  chunk: Chunk;
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
  ) {
    this.material = new THREE.MeshStandardMaterial({ color: 0x4a7a3a });
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
        if (!this.loaded.has(chunkKey(cx, cz))) {
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
    const chunk = new Chunk(this.physics, this.material, {
      originX: cx * TERRAIN_CHUNK_SIZE,
      originZ: cz * TERRAIN_CHUNK_SIZE,
      size: TERRAIN_CHUNK_SIZE,
      resolution: TERRAIN_RESOLUTION,
    });
    this.scene.add(chunk.mesh);
    this.loaded.set(chunkKey(cx, cz), { cx, cz, chunk });
  }

  private unloadChunk(key: string, entry: LoadedChunk): void {
    this.scene.remove(entry.chunk.mesh);
    entry.chunk.dispose(this.physics);
    this.loaded.delete(key);
  }
}
