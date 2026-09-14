import { describe, expect, it } from 'vitest';
import { findClearSpawnPoint, pickRandomRespawnPoint, type SpawnBlockedCheck } from './multiplayerSpawn.ts';

/** A 10 m square "house" centred on (35, 0), right on the spawn ring's +X point. */
const houseAtRingEast: SpawnBlockedCheck = (x, z) => Math.abs(x - 35) < 5 && Math.abs(z) < 5;

describe('findClearSpawnPoint', () => {
  it('keeps a point that is already clear', () => {
    expect(findClearSpawnPoint({ x: 0, z: 0 }, houseAtRingEast)).toEqual({ x: 0, z: 0 });
  });

  it('moves a blocked point to the nearest clear ground just outside the obstacle', () => {
    const result = findClearSpawnPoint({ x: 35, z: 0 }, houseAtRingEast);
    expect(houseAtRingEast(result.x, result.z)).toBe(false);
    // 5 m to the nearest edge; the 2 m ring search lands on the first ring past it.
    expect(Math.hypot(result.x - 35, result.z)).toBeLessThanOrEqual(6 + 1e-9);
  });

  it('falls back to the preferred point when nothing within reach is clear', () => {
    expect(findClearSpawnPoint({ x: 1, z: 2 }, () => true)).toEqual({ x: 1, z: 2 });
  });
});

describe('pickRandomRespawnPoint with a blocked check', () => {
  it('never returns a point inside a structure', () => {
    // Blocks the whole eastern half of the ring, so roughly half the random candidates are rejected.
    const eastBlocked: SpawnBlockedCheck = (x) => x > 0;
    for (let i = 0; i < 200; i++) {
      const point = pickRandomRespawnPoint([], eastBlocked);
      expect(eastBlocked(point.x, point.z)).toBe(false);
    }
  });

  it('still finds clear ground when every ring candidate is blocked', () => {
    // The ring (radius 35) is entirely blocked; only points well inside it are clear.
    const ringBlocked: SpawnBlockedCheck = (x, z) => Math.hypot(x, z) > 20;
    const point = pickRandomRespawnPoint([], ringBlocked);
    expect(ringBlocked(point.x, point.z)).toBe(false);
  });
});
