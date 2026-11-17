import { afterEach, describe, expect, it } from 'vitest';
import { SPAWN_X, SPAWN_Z } from '../core/config.ts';
import { ZONE_RADIUS } from '../core/mission/missionState.ts';
import { setWorldSeedForTesting } from '../core/worldSeed.ts';
import { mulberry32 } from '../utils/rng.ts';
import { generateFacilityLayout, isWalkable, playerStart } from './facility/facilityLayout.ts';
import { CONSOLE_STAND_RADIUS, CORE_HOVER_HEIGHT, facilityOperationSites, facilityStandBlocked, standPointNear, TOWER_STAND_RADIUS, valleyOperationSites } from './missionSites.ts';
import { computeTowerLabs } from './towerUnderground.ts';
import { getWatchTowerPositions } from './WatchTowerManager.ts';

afterEach(() => setWorldSeedForTesting(1337));

describe('valleyOperationSites', () => {
  it('uses the four towers, the core in a lab under one of them, the same for a seed every time', () => {
    const start = { x: SPAWN_X, z: SPAWN_Z };
    let inLab = 0;
    for (let seed = 1; seed <= 40; seed++) {
      setWorldSeedForTesting(seed);
      const towers = getWatchTowerPositions();
      const { sites, coreY, consoles } = valleyOperationSites(start);
      expect(valleyOperationSites(start).sites).toEqual(sites);
      expect(consoles).toEqual([]);
      const surface = [sites.breach, sites.relay, sites.extraction];
      for (const site of surface) expect(towers).toContainEqual(site);
      expect(new Set(surface.map((site) => `${site.x},${site.z}`)).size).toBe(3);
      // The terminal is the tower nearest the start.
      const nearest = Math.min(...towers.map((tower) => Math.hypot(tower.x - start.x, tower.z - start.z)));
      expect(Math.hypot(sites.breach.x - start.x, sites.breach.z - start.z)).toBeCloseTo(nearest);
      if (!sites.core.underground) continue;
      inLab++;
      // The core lies inside the lab volume of the one tower that is no surface site.
      const lab = computeTowerLabs().find((candidate) => !surface.some((site) => site.x === candidate.x && site.z === candidate.z))!;
      expect(coreY, `seed ${seed}`).toBe(lab.floorY + CORE_HOVER_HEIGHT);
      const { x, z } = sites.core;
      expect(lab.volumes.some((v) => x > v.minX && x < v.maxX && z > v.minZ && z < v.maxZ), `seed ${seed}`).toBe(true);
    }
    expect(inLab).toBeGreaterThanOrEqual(36);
  });
});

describe('facilityOperationSites', () => {
  it('puts four different sites on clear floor with a console at each, and room to stand beside it', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const layout = generateFacilityLayout(seed);
      const start = playerStart(layout, mulberry32(seed));
      const { sites, consoles } = facilityOperationSites(layout, start);
      expect(facilityOperationSites(layout, start).sites).toEqual(sites);
      const all = [sites.breach, sites.core, sites.relay, sites.extraction];
      expect(new Set(all.map((site) => `${site.x},${site.z}`)).size).toBe(4);
      expect(consoles).toHaveLength(4);
      expect(sites.core.underground).toBe(false);
      for (const site of all) {
        expect(isWalkable(layout, site.x, site.z)).toBe(true);
        const stand = standPointNear(site, CONSOLE_STAND_RADIUS, (x, z) => facilityStandBlocked(layout, x, z));
        const away = Math.hypot(stand.x - site.x, stand.z - site.z);
        expect(away, `seed ${seed}`).toBeGreaterThan(1);
        expect(away).toBeLessThan(ZONE_RADIUS);
      }
    }
  });
});

describe('standPointNear', () => {
  it('takes the first clear point of the nearest ring, and the site when nothing is clear', () => {
    expect(standPointNear({ x: 10, z: 10 }, 2, () => false)).toEqual({ x: 12, z: 10 });
    const second = standPointNear({ x: 0, z: 0 }, 2, (x) => x > 1);
    expect(Math.hypot(second.x, second.z)).toBeCloseTo(2);
    expect(second.x).toBeLessThanOrEqual(1);
    expect(standPointNear({ x: 5, z: 5 }, 2, () => true)).toEqual({ x: 5, z: 5 });
  });

  it('keeps a redeploy at a tower inside the zone', () => {
    expect(TOWER_STAND_RADIUS).toBeLessThan(ZONE_RADIUS);
  });
});
