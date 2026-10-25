import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../utils/rng.ts';
import { OPEN, cellCentre, cellOf, generateFacilityLayout, isSpawnBlocked, isWalkable, playerStart, type FacilityLayout } from './facilityLayout.ts';
import {
  FACILITY_FLIGHT_CEILING_GAP, FACILITY_FLIGHT_CRUISE, FACILITY_HORDE_MIN_SPAWN_DISTANCE, FACILITY_OBJECTIVE_MIN_DISTANCE,
  FACILITY_PICKUP_CLEARANCE, facilityBlocksThrow, facilityFloorPoints, facilityFlightHeight, facilityGoosePlacement, facilityHordeSpawnPoint,
  facilityMissionObjectives, pickPointNear,
} from './facilityModes.ts';

const layouts = Array.from({ length: 30 }, (_, seed) => generateFacilityLayout(seed + 1));
const regionAt = (layout: FacilityLayout, x: number, z: number): number => {
  const { i, j } = cellOf(x, z);
  return layout.region[j * layout.size + i]!;
};

describe('facilityFloorPoints', () => {
  it.each(layouts.slice(0, 10).map(l => [l.seed, l] as const))('only clear floor for seed %i', (_seed, layout) => {
    const points = facilityFloorPoints(layout, FACILITY_PICKUP_CLEARANCE);
    expect(points.length).toBeGreaterThan(200);
    for (const p of points) {
      expect(isWalkable(layout, p.x, p.z, FACILITY_PICKUP_CLEARANCE)).toBe(true);
      const { i, j } = cellOf(p.x, p.z);
      expect(layout.kinds[j * layout.size + i]).toBe(OPEN);
      // Never on or touching a crate.
      for (const crate of layout.crates) expect(Math.abs(crate.i - i) + Math.abs(crate.j - j)).toBeGreaterThan(0);
    }
    const rooms = facilityFloorPoints(layout, FACILITY_PICKUP_CLEARANCE, true);
    expect(rooms.length).toBeGreaterThan(0);
    for (const p of rooms) expect(regionAt(layout, p.x, p.z)).toBeGreaterThanOrEqual(0);
  });
});

describe('facilityFlightHeight', () => {
  it('stays under every open cell ceiling by the gap', () => {
    for (const layout of layouts.slice(0, 5)) {
      for (let j = 0; j < layout.size; j++) for (let i = 0; i < layout.size; i++) {
        if (layout.kinds[j * layout.size + i] !== OPEN) continue;
        const { x, z } = cellCentre(i, j);
        const height = facilityFlightHeight(layout, x, z);
        expect(height).toBeLessThanOrEqual(layout.ceiling[j * layout.size + i]! - FACILITY_FLIGHT_CEILING_GAP + 1e-6);
        expect(height).toBeLessThanOrEqual(FACILITY_FLIGHT_CRUISE);
        expect(height).toBeGreaterThan(1.5);
      }
    }
  });
});

describe('facilityHordeSpawnPoint', () => {
  it.each(layouts.map(l => [l.seed, l] as const))('spawns away from every player for seed %i', (_seed, layout) => {
    const rng = mulberry32(layout.seed);
    const floor = facilityFloorPoints(layout, FACILITY_PICKUP_CLEARANCE);
    const rooms = facilityFloorPoints(layout, FACILITY_PICKUP_CLEARANCE, true);
    for (let trial = 0; trial < 5; trial++) {
      const players = [floor[Math.floor(rng() * floor.length)]!, floor[Math.floor(rng() * floor.length)]!];
      const point = facilityHordeSpawnPoint(layout, rooms, players, rng)!;
      expect(isWalkable(layout, point.x, point.z, FACILITY_PICKUP_CLEARANCE)).toBe(true);
      expect(regionAt(layout, point.x, point.z)).toBeGreaterThanOrEqual(0);
      for (const player of players) {
        expect(Math.hypot(point.x - player.x, point.z - player.z)).toBeGreaterThanOrEqual(FACILITY_HORDE_MIN_SPAWN_DISTANCE);
        const playerRegion = regionAt(layout, player.x, player.z);
        if (playerRegion >= 0) expect(regionAt(layout, point.x, point.z)).not.toBe(playerRegion);
      }
    }
  });

  it('takes any room point with no players, and null with no points', () => {
    const layout = layouts[0]!;
    expect(facilityHordeSpawnPoint(layout, [], [{ x: 0, z: 0 }], Math.random)).toBeNull();
    expect(facilityHordeSpawnPoint(layout, [{ x: 3, z: 3 }], [], Math.random)).toEqual({ x: 3, z: 3 });
  });
});

describe('pickPointNear', () => {
  const points = [{ x: 2, z: 0 }, { x: 12, z: 0 }, { x: 30, z: 0 }];
  it('picks inside the band, else the nearest beyond its inner edge', () => {
    expect(pickPointNear(points, 0, 0, 10, 20, Math.random)).toEqual({ x: 12, z: 0 });
    expect(pickPointNear(points, 0, 0, 13, 20, Math.random)).toEqual({ x: 30, z: 0 });
    expect(pickPointNear(points, 0, 0, 40, 50, () => 0)).toEqual({ x: 2, z: 0 });
    expect(pickPointNear([], 0, 0, 1, 2, Math.random)).toBeNull();
  });
});

describe('facilityGoosePlacement', () => {
  it('places on clear floor and never wanders through a wall', () => {
    const layout = layouts[0]!;
    const placement = facilityGoosePlacement(layout, mulberry32(4));
    for (let n = 0; n < 50; n++) {
      const point = placement.randomPoint()!;
      expect(isWalkable(layout, point.x, point.z, FACILITY_PICKUP_CLEARANCE)).toBe(true);
    }
    // The atrium's west wall is solid at x = -9 except where a corridor meets it; straight through
    // from the atrium centre to well outside the grid is never clear.
    expect(placement.canWander(0, 0, -60, 0)).toBe(false);
    expect(placement.canWander(0, 0, 1, 1)).toBe(true);
  });
});

describe('facilityBlocksThrow', () => {
  it('stops at wall mass, the ceiling and crates, not in open air', () => {
    const layout = layouts[0]!;
    expect(facilityBlocksThrow(layout, 0, 1.5, 0, 0.3)).toBe(false);
    expect(facilityBlocksThrow(layout, 0, 7.4, 0, 0.3)).toBe(true);
    expect(facilityBlocksThrow(layout, -41.5, 1.5, -41.5, 0.3)).toBe(true);
    expect(facilityBlocksThrow(layout, 100, 1.5, 0, 0.3)).toBe(true);
    const crate = layout.crates[0]!;
    const { x, z } = cellCentre(crate.i, crate.j);
    expect(facilityBlocksThrow(layout, x, crate.height - 0.1, z, 0.3)).toBe(true);
    expect(facilityBlocksThrow(layout, x, crate.height + 0.5, z, 0.3)).toBe(false);
  });
});

describe('facilityMissionObjectives', () => {
  it.each(layouts.map(l => [l.seed, l] as const))('picks four far rooms for seed %i', (_seed, layout) => {
    const start = playerStart(layout, mulberry32(layout.seed));
    const objectives = facilityMissionObjectives(layout, start);
    expect(objectives).toHaveLength(4);
    expect(facilityMissionObjectives(layout, start)).toEqual(objectives);
    const startRegion = regionAt(layout, start.x, start.z);
    const regions = objectives.map(o => regionAt(layout, o.x, o.z));
    expect(new Set(regions).size).toBe(4);
    for (const [index, objective] of objectives.entries()) {
      expect(isSpawnBlocked(layout, objective.x, objective.z)).toBe(false);
      expect(regions[index]).toBeGreaterThan(0);
      expect(regions[index]).not.toBe(startRegion);
      expect(Math.hypot(objective.x - start.x, objective.z - start.z)).toBeGreaterThanOrEqual(FACILITY_OBJECTIVE_MIN_DISTANCE);
    }
  });

  it('spreads them over the four quadrants on nearly every layout', () => {
    let spread = 0;
    for (const layout of layouts) {
      const objectives = facilityMissionObjectives(layout, playerStart(layout, mulberry32(layout.seed)));
      const quadrants = new Set(objectives.map(o => (o.x >= 0 ? 1 : 0) + (o.z >= 0 ? 2 : 0)));
      expect(quadrants.size).toBeGreaterThanOrEqual(3);
      if (quadrants.size === 4) spread++;
    }
    expect(spread).toBeGreaterThanOrEqual(layouts.length * 0.8);
  });
});
