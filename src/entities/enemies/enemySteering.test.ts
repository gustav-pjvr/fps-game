import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { horizontalDistance, pickPatrolDestination } from './enemySteering.ts';
import { mulberry32 } from '../../utils/rng.ts';
import { setWorldSeedForTesting } from '../../core/worldSeed.ts';
import { ENEMY_ROAM_RADIUS, WORLD_SOFT_PUSH_START_RADIUS } from '../../core/config.ts';

// pickPatrolDestination's own RNG plumbing (a plain `rng: () => number` parameter, not a direct
// Math.random() call) is what makes deterministic AI testing possible at all - EntityManager.ts
// already seeds this per-enemy via `mulberry32(getWorldSeed() + PATROL_SEED_OFFSET + spawnIndex)`
// (see EntityManager.spawnEnemy), matching the same per-system seed-offset convention
// chunkSeed.ts's hashChunkSeed uses. These tests lock in the determinism that plumbing exists to
// provide, at the pickPatrolDestination level itself.

describe('pickPatrolDestination determinism', () => {
  it('the same seed produces the exact same destination for the same spawn point', () => {
    setWorldSeedForTesting(4242);
    const spawn = new THREE.Vector3(10, 0, -20);

    const a = pickPatrolDestination(spawn, mulberry32(777));
    const b = pickPatrolDestination(spawn, mulberry32(777));

    expect(a.x).toBe(b.x);
    expect(a.z).toBe(b.z);
  });

  it('the same seed reproduces an identical sequence of repath destinations, not just a single call', () => {
    setWorldSeedForTesting(101);
    const spawn = new THREE.Vector3(-30, 0, 15);

    const rngA = mulberry32(55);
    const rngB = mulberry32(55);
    for (let i = 0; i < 20; i++) {
      const a = pickPatrolDestination(spawn, rngA);
      const b = pickPatrolDestination(spawn, rngB);
      expect(a.x).toBe(b.x);
      expect(a.z).toBe(b.z);
    }
  });

  it('a different seed generally produces a different destination (not a constant fallback regardless of RNG)', () => {
    setWorldSeedForTesting(9001);
    const spawn = new THREE.Vector3(0, 0, 0);

    const a = pickPatrolDestination(spawn, mulberry32(1));
    const b = pickPatrolDestination(spawn, mulberry32(2));

    expect(a.x !== b.x || a.z !== b.z).toBe(true);
  });

  it('every destination stays within ENEMY_ROAM_RADIUS of spawn and inside the world soft-push boundary', () => {
    setWorldSeedForTesting(2026);
    const spawn = new THREE.Vector3(40, 0, -60);
    const rng = mulberry32(314);

    for (let i = 0; i < 100; i++) {
      const destination = pickPatrolDestination(spawn, rng);
      expect(horizontalDistance(spawn, destination)).toBeLessThanOrEqual(ENEMY_ROAM_RADIUS + 1e-9);
      expect(Math.hypot(destination.x, destination.z)).toBeLessThan(WORLD_SOFT_PUSH_START_RADIUS);
    }
  });
});
