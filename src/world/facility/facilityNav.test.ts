import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../utils/rng.ts';
import { generateFacilityLayout, OPEN, SOLID, PROP, cellCentre, cellOf, isWalkable, type FacilityLayout } from './facilityLayout.ts';
import { FacilityNav, flowField, segmentClear } from './facilityNav.ts';
import { doorCrossings, type FacilityDoor } from './facilityDoors.ts';
import { FACILITY_DOOR_NAV_COST } from '../../core/config.ts';

function emptyLayout(): FacilityLayout {
  const kinds = new Uint8Array(56 * 56).fill(SOLID);
  for (let j = 1; j < 55; j++) for (let i = 1; i < 55; i++) kinds[j * 56 + i] = OPEN;
  return { seed: 0, size: 56, cell: 1.5, kinds, ceiling: new Float32Array(kinds.length), region: new Int16Array(kinds.length), rooms: [], doorways: [], crates: [], lamps: [] };
}

describe('Facility navigation', () => {
  it.each([1, 5])('prices a closed door against a detour %i cells deep', depth => {
    const layout = emptyLayout(), size = layout.size, total = size * size;
    layout.kinds.fill(SOLID);
    for (let i = 20; i <= 24; i++) {
      layout.kinds[20 * size + i] = OPEN;
      layout.kinds[(20 + depth) * size + i] = OPEN;
    }
    for (let j = 20; j <= 20 + depth; j++) {
      layout.kinds[j * size + 20] = OPEN; layout.kinds[j * size + 24] = OPEN;
    }
    const start = 20 * size + 20, target = 20 * size + 24;
    const door: FacilityDoor = { id: 0, room: 0, axis: 'x', side: 1,
      cells: [20 * size + 21], roomCells: [20 * size + 22],
      x: -9, z: -11.25, width: 1.5, height: 3, startsClosed: true };
    const crossings = doorCrossings([door], size);
    expect(FACILITY_DOOR_NAV_COST).toBe(4);
    const field = flowField(layout, target, (from, to) => crossings.has(from * total + to) ? FACILITY_DOOR_NAV_COST : 0);
    let id = start, crossed = false, steps = 0;
    while (id !== target && steps++ < total) {
      const next = field[id]!;
      expect(next).toBeGreaterThanOrEqual(0);
      crossed ||= crossings.has(id * total + next); id = next;
    }
    expect(id).toBe(target);
    expect(crossed).toBe(depth === 5);
    if (depth === 5) expect(steps).toBe(4);
  });

  it.each([1, 2, 3, 4, 5])('reaches 30 targets from each of 30 starts on seed %i', seed => {
    const layout = generateFacilityLayout(seed), nav = new FacilityNav(layout), rng = mulberry32(seed + 100);
    const points = Array.from(layout.kinds, (kind, id) => kind === OPEN ? cellCentre(id % layout.size, Math.floor(id / layout.size)) : null)
      .filter((point): point is { x: number; z: number } => point !== null);
    const sample = (): { x: number; z: number } => {
      const p = points[Math.floor(rng() * points.length)]!;
      const x = p.x + (rng() - 0.5) * 0.5, z = p.z + (rng() - 0.5) * 0.5;
      return { x, z };
    };
    const starts = Array.from({ length: 30 }, sample), targets = Array.from({ length: 30 }, sample);
    for (const start of starts) for (const target of targets) {
      let { x, z } = start, steps = 0;
      while (Math.hypot(x - target.x, z - target.z) > 0.01 && steps < 400) {
        const waypoint = nav.nextWaypoint(x, z, target.x, target.z);
        const distance = Math.hypot(waypoint.x - x, waypoint.z - z);
        const fraction = distance > 0 ? Math.min(0.5 / distance, 1) : 0;
        const nx = x + (waypoint.x - x) * fraction, nz = z + (waypoint.z - z) * fraction;
        if (!isWalkable(layout, nx, nz, 0.45)) throw new Error(`Seed ${seed}: blocked step ${steps} at ${nx},${nz}`);
        const cell = cellOf(nx, nz);
        if (layout.kinds[cell.j * layout.size + cell.i] !== OPEN) throw new Error(`Seed ${seed}: non-walkable cell`);
        x = nx; z = nz; steps++;
      }
      expect(Math.hypot(x - target.x, z - target.z), `Seed ${seed}: ${JSON.stringify(start)} to ${JSON.stringify(target)}, ${steps} steps`).toBeLessThanOrEqual(0.01);
    }
  }, 120_000);

  it('returns the precise target on a clear straight line', () => {
    const layout = emptyLayout(), nav = new FacilityNav(layout);
    expect(segmentClear(layout, -20, 10, 21.3, -11.1, 0.45)).toBe(true);
    expect(nav.nextWaypoint(-20, 10, 21.3, -11.1)).toEqual({ x: 21.3, z: -11.1 });
    expect(segmentClear(layout, 1.5, -1.5, 0, 0, 0.45)).toBe(true);
    expect(segmentClear(layout, 0, 0, 0, 0, 0.45)).toBe(true);
  });

  it('detects wall and crate clearance along the whole segment in both directions', () => {
    const layout = emptyLayout();
    for (const kind of [SOLID, PROP]) {
      layout.kinds[28 * 56 + 28] = kind;
      expect(segmentClear(layout, -4, 0.75, 4, 0.75, 0.45)).toBe(false);
      expect(segmentClear(layout, 4, 0.75, -4, 0.75, 0.45)).toBe(false);
      expect(segmentClear(layout, -4, -0.44, 4, -0.44, 0.45)).toBe(false);
      expect(segmentClear(layout, -4, -0.46, 4, -0.46, 0.45)).toBe(true);
      expect(segmentClear(layout, -0.4, -0.4, -0.4, -0.4, 0.45)).toBe(true);
      expect(segmentClear(layout, -0.3, -0.3, -0.3, -0.3, 0.45)).toBe(false);
    }
    expect(segmentClear(layout, -100, 0, 0, 0, 0.45)).toBe(false);
  });

  it('snaps blocked targets to the nearest walkable cell', () => {
    const layout = emptyLayout(), nav = new FacilityNav(layout);
    layout.kinds[28 * 56 + 28] = SOLID;
    expect(nav.nextWaypoint(0.75, -10, 0.75, 0.75)).toEqual(cellCentre(28, 27));
    expect(nav.nextWaypoint(10, 0.75, 100, 0.75)).toEqual(cellCentre(54, 28));
  });

  it('snaps a target pressed against a wall to an adjacent walkable cell, from a cache after the first time', () => {
    const layout = emptyLayout(), nav = new FacilityNav(layout);
    // A player (radius 0.4) against the west wall: under the 0.45 clearance, so not itself walkable.
    const wallX = cellCentre(1, 20).x - 0.75, target = { x: wallX + 0.4, z: cellCentre(1, 20).z };
    expect(isWalkable(layout, target.x, target.z, 0.45)).toBe(false);
    const from = cellCentre(30, 20);
    expect(nav.nextWaypoint(from.x, from.z, target.x, target.z)).toEqual(cellCentre(1, 20));
    const cache = (nav as unknown as { snapped: Map<number, { x: number; z: number }> }).snapped;
    expect(cache.size).toBe(1);
    expect(nav.nextWaypoint(from.x, from.z, target.x + 0.01, target.z)).toEqual(cellCentre(1, 20));
    expect(cache.size).toBe(1);
    // In a corner the snapped cell is the diagonal neighbour of the solid one, not a far scan.
    const corner = cellCentre(0, 0);
    expect(nav.nextWaypoint(from.x, from.z, corner.x, corner.z)).toEqual(cellCentre(1, 1));
  });

  it('does not cut corners and returns an unreachable target unchanged', () => {
    const layout = emptyLayout();
    layout.kinds.fill(SOLID);
    layout.kinds[28 * 56 + 28] = OPEN;
    layout.kinds[29 * 56 + 29] = OPEN;
    const start = cellCentre(28, 28), target = cellCentre(29, 29);
    expect(segmentClear(layout, start.x, start.z, target.x, target.z, 0.45)).toBe(false);
    expect(new FacilityNav(layout).nextWaypoint(start.x, start.z, target.x, target.z)).toEqual(target);
  });

  it('evicts the least recently used field and never caches more than 24', () => {
    const layout = emptyLayout();
    for (let j = 2; j < 55; j++) layout.kinds[j * 56 + 28] = SOLID;
    const nav = new FacilityNav(layout);
    const cache = (nav as unknown as { fields: Map<number, Int32Array> }).fields;
    const start = cellCentre(20, 28);
    const visit = (j: number): void => {
      const target = cellCentre(35, j); nav.nextWaypoint(start.x, start.z, target.x, target.z);
      expect(cache.size).toBeLessThanOrEqual(24);
    };
    for (let j = 5; j < 29; j++) visit(j);
    expect(cache.size).toBe(24);
    const first = 5 * 56 + 35, second = 6 * 56 + 35, field = cache.get(first);
    visit(5); visit(29);
    expect(cache.get(first)).toBe(field);
    expect(cache.has(second)).toBe(false);
    for (let j = 30; j < 50; j++) visit(j);
    expect(cache.size).toBe(24);
  });
});
