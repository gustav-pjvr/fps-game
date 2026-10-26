import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { setWorldSeedForTesting } from '../core/worldSeed.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { BuildingManager } from '../world/BuildingManager.ts';
import { isPointNearFootprint } from '../world/houseFootprint.ts';
import { cellOf, generateFacilityLayout, isWalkable, OPEN, SOLID } from '../world/facility/facilityLayout.ts';
import { mulberry32 } from '../utils/rng.ts';
import { ROAD_WIDTH } from '../core/config.ts';
import { PICKUP_FACILITY_MIN_SPACING, PICKUP_VALLEY_COUNT, type PickupKind } from './pickupConfig.ts';
import { assignPickupKinds, pickupKindsForMode, placeFacilityPickups, placeValleyPickups } from './pickupPlacement.ts';
import { gatherValleyPlacementInput } from './valleyPickupInputs.ts';

const ALL: PickupKind[] = ['health', 'ammo', 'grenade'];
const count = (kinds: readonly PickupKind[], kind: PickupKind): number => kinds.filter((k) => k === kind).length;

describe('pickupKindsForMode', () => {
  it('gives health only in Knife Only and Goose Toss', () => {
    expect(pickupKindsForMode('knifeOnly', true)).toEqual(['health']);
    expect(pickupKindsForMode('gooseToss', true)).toEqual(['health']);
  });

  it('places grenade crates only where grenades are on', () => {
    expect(pickupKindsForMode('default', false)).toEqual(['health', 'ammo']);
    expect(pickupKindsForMode('default', true)).toEqual(['health', 'ammo', 'grenade']);
    expect(pickupKindsForMode('gunGame', false)).not.toContain('grenade');
  });
});

describe('assignPickupKinds', () => {
  it('follows the 45 / 40 / 15 mix within one pickup for any count', () => {
    for (let n = 1; n <= 40; n++) {
      const kinds = assignPickupKinds(n, ALL, mulberry32(n));
      expect(kinds).toHaveLength(n);
      expect(Math.abs(count(kinds, 'health') - n * 0.45)).toBeLessThanOrEqual(1);
      expect(Math.abs(count(kinds, 'ammo') - n * 0.4)).toBeLessThanOrEqual(1);
      expect(Math.abs(count(kinds, 'grenade') - n * 0.15)).toBeLessThanOrEqual(1);
    }
  });

  it('hands a missing kind its share to the others and never uses a kind that is not allowed', () => {
    const kinds = assignPickupKinds(20, ['health', 'ammo'], mulberry32(3));
    expect(count(kinds, 'grenade')).toBe(0);
    expect(Math.abs(count(kinds, 'health') - 10)).toBeLessThanOrEqual(1);
    expect(count(kinds, 'health') + count(kinds, 'ammo')).toBe(20);
    expect(new Set(assignPickupKinds(12, ['health'], mulberry32(3)))).toEqual(new Set(['health']));
  });

  it('is deterministic for a seed and varies the order between seeds', () => {
    expect(assignPickupKinds(16, ALL, mulberry32(9))).toEqual(assignPickupKinds(16, ALL, mulberry32(9)));
    expect(assignPickupKinds(16, ALL, mulberry32(9))).not.toEqual(assignPickupKinds(16, ALL, mulberry32(10)));
  });

  it('returns nothing for no pickups or no allowed kind', () => {
    expect(assignPickupKinds(0, ALL, mulberry32(1))).toEqual([]);
    expect(assignPickupKinds(5, [], mulberry32(1))).toEqual([]);
  });
});

describe('placeFacilityPickups', () => {
  const seeds = Array.from({ length: 30 }, (_, i) => i + 1);

  it('puts about one pickup per room, each on walkable floor inside a room', () => {
    let total = 0;
    let rooms = 0;
    for (const seed of seeds) {
      const layout = generateFacilityLayout(seed);
      const sites = placeFacilityPickups(layout, ALL);
      total += sites.length;
      rooms += layout.rooms.length;
      sites.forEach((site, index) => {
        expect(site.id).toBe(index);
        expect(site.y).toBe(0);
        expect(isWalkable(layout, site.x, site.z, 0.6)).toBe(true);
        const { i, j } = cellOf(site.x, site.z);
        expect(layout.rooms.some((r) => i >= r.i0 && i < r.i1 && j >= r.j0 && j < r.j1)).toBe(true);
      });
    }
    expect(total / rooms).toBeGreaterThan(0.85);
    expect(total / rooms).toBeLessThan(1.15);
  });

  it('stands them against a wall or pillar, clear of doorways, and apart', () => {
    let against = 0;
    let all = 0;
    for (const seed of seeds) {
      const layout = generateFacilityLayout(seed);
      const sites = placeFacilityPickups(layout, ALL);
      for (const site of sites) {
        const { i, j } = cellOf(site.x, site.z);
        all++;
        const solid = (a: number, b: number): boolean => layout.kinds[b * layout.size + a] === SOLID;
        if (solid(i - 1, j) || solid(i + 1, j) || solid(i, j - 1) || solid(i, j + 1)) against++;
        expect(layout.kinds[j * layout.size + i]).toBe(OPEN);
        expect(layout.doorways.some((d) => Math.max(Math.abs(d.i - i), Math.abs(d.j - j)) <= 2)).toBe(false);
      }
      for (const a of sites) {
        for (const b of sites) {
          if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(PICKUP_FACILITY_MIN_SPACING - 1e-9);
        }
      }
    }
    expect(against / all).toBeGreaterThan(0.9);
  });

  it('never places in a room holding an avoided point (the single-player start)', () => {
    for (const seed of seeds) {
      const layout = generateFacilityLayout(seed);
      const room = layout.rooms[1]!;
      const start = { x: ((room.i0 + room.i1) / 2 - layout.size / 2) * layout.cell, z: ((room.j0 + room.j1) / 2 - layout.size / 2) * layout.cell };
      for (const site of placeFacilityPickups(layout, ALL, [start])) {
        const { i, j } = cellOf(site.x, site.z);
        expect(i >= room.i0 && i < room.i1 && j >= room.j0 && j < room.j1).toBe(false);
      }
    }
  });

  it('is the same list every time for a seed and differs between seeds', () => {
    const a = placeFacilityPickups(generateFacilityLayout(5), ALL);
    expect(placeFacilityPickups(generateFacilityLayout(5), ALL)).toEqual(a);
    expect(placeFacilityPickups(generateFacilityLayout(6), ALL)).not.toEqual(a);
  });

  it('keeps the mix and the mode rules', () => {
    const layout = generateFacilityLayout(11);
    const sites = placeFacilityPickups(layout, ALL);
    const kinds = sites.map((s) => s.kind);
    expect(count(kinds, 'grenade')).toBeGreaterThanOrEqual(1);
    expect(Math.abs(count(kinds, 'health') - sites.length * 0.45)).toBeLessThanOrEqual(1);
    expect(placeFacilityPickups(layout, ['health']).every((s) => s.kind === 'health')).toBe(true);
    expect(placeFacilityPickups(layout, ['health', 'ammo']).some((s) => s.kind === 'grenade')).toBe(false);
    expect(placeFacilityPickups(layout, [])).toEqual([]);
  });

  it('keeps every site where it is when only the allowed kinds change', () => {
    const layout = generateFacilityLayout(11);
    const positions = (kinds: PickupKind[]) => placeFacilityPickups(layout, kinds).map((s) => [s.x, s.z]);
    expect(positions(['health'])).toEqual(positions(ALL));
  });
});

describe('placeValleyPickups', () => {
  let buildings: BuildingManager;
  let physics: PhysicsWorld;
  beforeAll(async () => {
    // The enterable houses build their colliders in a real physics world.
    physics = await PhysicsWorld.create();
    buildings = await BuildingManager.create(new Scene(), physics);
  });
  afterAll(() => physics.dispose());
  const seeds = Array.from({ length: 25 }, (_, i) => i + 1);

  it('places about PICKUP_VALLEY_COUNT, clear of every house, road and tower, on the ground, inside the world', () => {
    let atTower = 0;
    let towers = 0;
    for (const seed of seeds) {
      setWorldSeedForTesting(seed);
      const input = gatherValleyPlacementInput(buildings);
      const sites = placeValleyPickups(input, ALL);
      expect(sites.length).toBeGreaterThanOrEqual(12);
      expect(sites.length).toBeLessThanOrEqual(PICKUP_VALLEY_COUNT);
      for (const site of sites) {
        expect(input.footprints.some((f) => isPointNearFootprint(site.x, site.z, f, 0.9))).toBe(false);
        for (const road of input.roads) {
          const dx = road.bx - road.ax;
          const dz = road.bz - road.az;
          const t = Math.max(0, Math.min(1, ((site.x - road.ax) * dx + (site.z - road.az) * dz) / (dx * dx + dz * dz || 1)));
          expect(Math.hypot(site.x - (road.ax + t * dx), site.z - (road.az + t * dz))).toBeGreaterThan(ROAD_WIDTH / 2);
        }
        for (const tower of input.towers) expect(Math.hypot(site.x - tower.x, site.z - tower.z)).toBeGreaterThan(input.towerRadius);
        expect(Math.hypot(site.x, site.z)).toBeLessThanOrEqual(input.maxRadius);
        expect(site.y).toBe(input.groundHeight(site.x, site.z));
      }
      for (const tower of input.towers) {
        towers++;
        if (sites.some((s) => Math.hypot(s.x - tower.x, s.z - tower.z) < input.towerRadius + 3)) atTower++;
      }
    }
    // A tower with no clear ring point (a forest or a town around it) is rare, not the rule.
    expect(atTower / towers).toBeGreaterThan(0.9);
  });

  it('is deterministic per seed, spread out, with the mix and the mode rules', () => {
    setWorldSeedForTesting(7);
    const input = gatherValleyPlacementInput(buildings);
    const sites = placeValleyPickups(input, ALL);
    expect(placeValleyPickups(gatherValleyPlacementInput(buildings), ALL)).toEqual(sites);
    for (const a of sites) {
      for (const b of sites) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(8);
      }
    }
    const kinds = sites.map((s) => s.kind);
    expect(Math.abs(count(kinds, 'health') - sites.length * 0.45)).toBeLessThanOrEqual(1);
    expect(placeValleyPickups(input, ['health']).every((s) => s.kind === 'health')).toBe(true);
    expect(placeValleyPickups(input, ['health', 'ammo']).some((s) => s.kind === 'grenade')).toBe(false);
    setWorldSeedForTesting(8);
    expect(placeValleyPickups(gatherValleyPlacementInput(buildings), ALL)).not.toEqual(sites);
  });

  it('copes with a world that has nothing in it', () => {
    const empty = { seed: 1, footprints: [], roads: [], towers: [], towerRadius: 6, roadHalfWidth: 1.5, maxRadius: 60, groundHeight: () => 0 };
    expect(placeValleyPickups(empty, ALL)).toEqual([]);
    expect(placeValleyPickups({ ...empty, footprints: [{ originX: 0, originZ: 0, offsetX: 0, offsetZ: 0, halfWidth: 4, halfDepth: 3, rotationY: 0.7 }] }, [])).toEqual([]);
  });

  it('stands beside a rotated house, not inside it', () => {
    const footprint = { originX: 10, originZ: -5, offsetX: 0, offsetZ: 0, halfWidth: 4, halfDepth: 3, rotationY: Math.PI / 3 };
    const sites = placeValleyPickups({ seed: 2, footprints: [footprint], roads: [], towers: [], towerRadius: 6, roadHalfWidth: 1.5, maxRadius: 60, groundHeight: () => 0 }, ALL);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(isPointNearFootprint(site.x, site.z, footprint, 0.9)).toBe(false);
      expect(isPointNearFootprint(site.x, site.z, footprint, 3)).toBe(true);
    }
  });
});
