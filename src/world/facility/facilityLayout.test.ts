import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../utils/rng.ts';
import {
  SOLID, OPEN, PROP, generateFacilityLayout, cellOf, cellCentre, isWalkable,
  isSpawnBlocked, encounterPoints, playerStart, type FacilityLayout,
} from './facilityLayout.ts';

function reachableCount(layout: FacilityLayout): number {
  const start = cellOf(0, 0), queue = [start.j * layout.size + start.i], seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!, i = id % layout.size, j = Math.floor(id / layout.size);
    for (const [x, z] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
      if (x! < 0 || z! < 0 || x! >= layout.size || z! >= layout.size) continue;
      const next = z! * layout.size + x!;
      if (layout.kinds[next] === OPEN && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen.size;
}

describe('Facility layout', () => {
  const layouts = Array.from({ length: 50 }, (_, seed) => generateFacilityLayout(seed + 1));

  it.each(layouts.map(layout => [layout.seed, layout] as const))('preserves layout invariants for seed %i', (seed, layout) => {
    const copy = generateFacilityLayout(seed);
    expect(copy.kinds).toEqual(layout.kinds);
    expect(new Uint8Array(copy.ceiling.buffer)).toEqual(new Uint8Array(layout.ceiling.buffer));
    expect(new TextEncoder().encode(JSON.stringify(copy.lamps))).toEqual(new TextEncoder().encode(JSON.stringify(layout.lamps)));
    expect(copy).toEqual(layout);
    expect(layout.size).toBe(56);
    expect(layout.cell).toBe(1.5);
    for (let n = 0; n < layout.size; n++) {
      for (const id of [n, (layout.size - 1) * layout.size + n, n * layout.size, n * layout.size + layout.size - 1]) expect(layout.kinds[id]).toBe(SOLID);
    }
    expect(isWalkable(layout, 0, 0, 0)).toBe(true);
    for (const j of [25, 29]) for (const i of [25, 29]) {
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) expect(layout.kinds[(j + dz) * layout.size + i + dx]).toBe(SOLID);
    }
    const open = layout.kinds.filter(kind => kind === OPEN).length;
    expect(reachableCount(layout)).toBe(open);
    expect(open / layout.kinds.length).toBeGreaterThanOrEqual(0.35);
    expect(open / layout.kinds.length).toBeLessThanOrEqual(0.6);
    expect(layout.rooms.length).toBeGreaterThanOrEqual(10);
    for (let id = 0; id < layout.kinds.length; id++) {
      if (layout.kinds[id] === SOLID) { expect(layout.ceiling[id]).toBe(0); expect(layout.region[id]).toBe(-2); }
      else { expect(layout.ceiling[id]).toBeGreaterThan(0); expect(layout.region[id]).toBeGreaterThanOrEqual(-1); }
    }
    expect(layout.kinds.filter(kind => kind === PROP).length).toBe(layout.crates.length);
    for (const crate of layout.crates) {
      expect(layout.kinds[crate.j * layout.size + crate.i]).toBe(PROP);
      expect([0.9, 1.2, 1.8]).toContain(crate.height);
      for (const door of layout.doorways) expect(Math.max(Math.abs(crate.i - door.i), Math.abs(crate.j - door.j))).toBeGreaterThan(2);
    }
    layout.rooms.forEach((room, region) => {
      const lamps = layout.lamps.filter(lamp => {
        const p = cellOf(lamp.x, lamp.z);
        return layout.region[p.j * layout.size + p.i] === region;
      });
      if (room.dark) { expect(lamps).toHaveLength(1); expect(lamps[0]!.color).toBe(0xffa040); }
      else expect(lamps.length).toBeGreaterThanOrEqual(1);
      if (region !== 0) {
        expect(room.i1 - room.i0).toBeGreaterThanOrEqual(5);
        expect(room.i1 - room.i0).toBeLessThanOrEqual(12);
        expect(room.j1 - room.j0).toBeGreaterThanOrEqual(5);
        expect(room.j1 - room.j0).toBeLessThanOrEqual(12);
      }
      for (const other of layout.rooms.slice(region + 1)) {
        expect(room.i1 + 2 <= other.i0 || other.i1 + 2 <= room.i0 || room.j1 + 2 <= other.j0 || other.j1 + 2 <= room.j0).toBe(true);
      }
    });
    for (const lamp of layout.lamps) {
      const p = cellOf(lamp.x, lamp.z), id = p.j * layout.size + p.i;
      expect(layout.kinds[id]).not.toBe(SOLID);
      expect(lamp.y).toBeCloseTo(layout.ceiling[id]! - 0.15);
      if (lamp.kind === 'emergency') {
        expect(layout.region[id]).toBe(-1);
        expect(lamp.color).toBe(0xffa040);
      }
    }
    const avoid = { x: 0, z: 0, radius: 12 }, points = encounterPoints(layout, 30, avoid, mulberry32(seed));
    expect(points).toHaveLength(30);
    const counts = new Map<number, number>();
    for (const point of points) {
      expect(isWalkable(layout, point.x, point.z, 0.8)).toBe(true);
      expect(Math.hypot(point.x, point.z)).toBeGreaterThanOrEqual(avoid.radius);
      const p = cellOf(point.x, point.z), region = layout.region[p.j * layout.size + p.i]!;
      counts.set(region, (counts.get(region) ?? 0) + 1);
    }
    expect(new Set(points.map(p => `${p.x},${p.z}`)).size).toBe(points.length);
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(3);
    for (let n = 0; n < 10; n++) {
      const spawn = playerStart(layout, mulberry32(seed + n));
      expect(isSpawnBlocked(layout, spawn.x, spawn.z)).toBe(false);
      const p = cellOf(spawn.x, spawn.z);
      expect(layout.region[p.j * layout.size + p.i]).toBeGreaterThan(0);
    }
  });

  it('produces a different grid for every seed in the sweep', () => {
    expect(new Set(layouts.map(layout => Array.from(layout.kinds).join(''))).size).toBe(50);
  });

  it('converts cell centres and tests circular clearance at walls and crates', () => {
    for (let j = 0; j < 56; j++) for (let i = 0; i < 56; i++) {
      const point = cellCentre(i, j); expect(cellOf(point.x, point.z)).toEqual({ i, j });
    }
    const layout = { ...layouts[0]!, kinds: new Uint8Array(56 * 56).fill(OPEN) };
    layout.kinds[28 * 56 + 28] = PROP;
    expect(isWalkable(layout, -0.46, 0.75, 0.45)).toBe(true);
    expect(isWalkable(layout, -0.44, 0.75, 0.45)).toBe(false);
    expect(isWalkable(layout, -0.4, -0.4, 0.45)).toBe(true);
    expect(isWalkable(layout, -0.3, -0.3, 0.45)).toBe(false);
    expect(isWalkable(layout, 100, 100, 0)).toBe(false);
    expect(isWalkable(layout, NaN, 0, 0)).toBe(false);
    expect(encounterPoints(layouts[0]!, 10, { x: 0, z: 0, radius: 1000 }, mulberry32(1))).toEqual([]);
  });

  it('prints the seed 1 map for visual review', () => {
    const layout = layouts[0]!;
    const lamps = new Set(layout.lamps.map(lamp => { const p = cellOf(lamp.x, lamp.z); return p.j * layout.size + p.i; }));
    const rows = Array.from({ length: layout.size }, (_, j) => Array.from({ length: layout.size }, (_, i) => {
      const id = j * layout.size + i;
      return lamps.has(id) ? '*' : layout.kinds[id] === SOLID ? '#' : layout.kinds[id] === PROP ? 'c' : '.';
    }).join(''));
    console.log(`Seed 1: # SOLID, . OPEN, c PROP, * lamp cell\n${rows.join('\n')}`);
    expect(rows).toHaveLength(56);
    expect(rows.every(row => row.length === 56)).toBe(true);
  });
});
