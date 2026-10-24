import { afterAll, describe, expect, it } from 'vitest';
import { getWorldSeed, setWorldSeed } from '../core/worldSeed.ts';
import { sampleHeight, setHeightOverride } from './TerrainGenerator.ts';
import { getWatchTowerPositions, WATCH_TOWER_FOOTPRINT_RADIUS } from './WatchTowerManager.ts';
import { getGuaranteedFlatSites } from './ZoneMap.ts';
import { ENEMY_RING_BASE_RADIUS, FLAT_ZONE_INNER_FRACTION, SPAWN_X, SPAWN_Z, WORLD_EDGE_RAMP_START } from '../core/config.ts';

const SEEDS = [11, 222, 3333, 44444, 555555, 7, 98765];
const originalSeed = getWorldSeed();

function slopeDegrees(x: number, z: number): number {
  const dx = (sampleHeight(x + 0.5, z) - sampleHeight(x - 0.5, z)) / 1;
  const dz = (sampleHeight(x, z + 0.5) - sampleHeight(x, z - 0.5)) / 1;
  return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
}

/** Slopes over the playable ground (inside the edge mountains), every 5 m, for one seed. */
function playableSlopes(): number[] {
  const slopes: number[] = [];
  const reach = WORLD_EDGE_RAMP_START - 5;
  for (let x = -reach; x <= reach; x += 5) {
    for (let z = -reach; z <= reach; z += 5) {
      if (Math.hypot(x, z) <= reach) slopes.push(slopeDegrees(x, z));
    }
  }
  return slopes;
}

describe('terrain generation', () => {
  afterAll(() => setWorldSeed(originalSeed));

  it('keeps every slope in the playable area under the 45 degree climb limit, most of it gentle', () => {
    const all: number[] = [];
    for (const seed of SEEDS) {
      setWorldSeed(seed);
      all.push(...playableSlopes());
    }
    all.sort((a, b) => a - b);
    // Player.ts climbs up to 45 degrees; nothing a player can reach should be a wall. (Before the
    // 2026-10-24 rework: a tenth of the ground past 29 degrees and walls of 75 around town pads.)
    expect(all[all.length - 1]).toBeLessThan(45);
    expect(all[Math.floor(all.length * 0.9)]).toBeLessThan(26);
    expect(all[Math.floor(all.length * 0.5)]).toBeLessThan(10);
  });

  it('has real relief: a high side and a low side, not a flat plate', () => {
    for (const seed of SEEDS) {
      setWorldSeed(seed);
      let low = Infinity;
      let high = -Infinity;
      for (let x = -60; x <= 60; x += 6) {
        for (let z = -60; z <= 60; z += 6) {
          if (Math.hypot(x, z) > 60) continue;
          const h = sampleHeight(x, z);
          low = Math.min(low, h);
          high = Math.max(high, h);
        }
      }
      expect(high - low, `seed ${seed}`).toBeGreaterThan(6);
    }
  });

  it('keeps the spawn clearing, each town core and each tower footprint dead flat', () => {
    for (const seed of SEEDS) {
      setWorldSeed(seed);
      const spawnHeight = sampleHeight(SPAWN_X, SPAWN_Z);
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const r = (ENEMY_RING_BASE_RADIUS + 5) * 0.55;
        expect(Math.abs(sampleHeight(SPAWN_X + Math.cos(angle) * r, SPAWN_Z + Math.sin(angle) * r) - spawnHeight)).toBeLessThan(0.05);
      }
      for (const site of getGuaranteedFlatSites()) {
        const center = sampleHeight(site.siteX, site.siteZ);
        const core = Math.min(...site.radii) * FLAT_ZONE_INNER_FRACTION * 0.95;
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          expect(Math.abs(sampleHeight(site.siteX + Math.cos(angle) * core, site.siteZ + Math.sin(angle) * core) - center)).toBeLessThan(0.05);
        }
      }
      for (const tower of getWatchTowerPositions()) {
        const center = sampleHeight(tower.x, tower.z);
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          const r = WATCH_TOWER_FOOTPRINT_RADIUS * 0.98;
          expect(Math.abs(sampleHeight(tower.x + Math.cos(angle) * r, tower.z + Math.sin(angle) * r) - center)).toBeLessThan(0.02);
        }
      }
    }
  });
});

describe('height override (the Facility)', () => {
  afterAll(() => setHeightOverride(null));

  it('returns the override while set and the valley again once cleared', () => {
    const valley = [sampleHeight(SPAWN_X, SPAWN_Z), sampleHeight(120, -80), sampleHeight(-200, 35)];
    setHeightOverride(() => 0);
    expect(sampleHeight(SPAWN_X, SPAWN_Z)).toBe(0);
    expect(sampleHeight(120, -80)).toBe(0);
    setHeightOverride((x, z) => x + 2 * z);
    expect(sampleHeight(3, 4)).toBe(11);
    setHeightOverride(null);
    expect([sampleHeight(SPAWN_X, SPAWN_Z), sampleHeight(120, -80), sampleHeight(-200, 35)]).toEqual(valley);
    expect(valley.some((height) => height !== 0)).toBe(true);
  });
});
