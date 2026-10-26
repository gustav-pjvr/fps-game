import { describe, expect, it } from 'vitest';
import { HOUSE_LAYOUTS } from './houseLayout.ts';
import {
  buildHouseWalkGrid, CLEARANCE, floorAt, levelAt, nearestNode, OUTSIDE_LEVEL, pointClear, rampHeight, segmentClear, STAIR_LEVEL, walkField,
} from './houseWalkGrid.ts';

const [BUNKHOUSE, BLOCK, WORKSHOP] = HOUSE_LAYOUTS.map(buildHouseWalkGrid) as [ReturnType<typeof buildHouseWalkGrid>, ReturnType<typeof buildHouseWalkGrid>, ReturnType<typeof buildHouseWalkGrid>];

describe('house walk grid', () => {
  it('covers each room of each design with cells about half a metre apart, all reaching the door', () => {
    HOUSE_LAYOUTS.forEach((layout, index) => {
      const grid = [BUNKHOUSE, BLOCK, WORKSHOP][index]!, field = walkField(grid, grid.outside);
      expect(field.every((next) => next >= 0), layout.name).toBe(true);
      for (const room of layout.rooms) {
        const level = grid.levels.findIndex((l) => Math.abs(l.y - room.bounds.minY) < 1e-3);
        const cells = grid.nodes.filter((n) => n.level === level && n.x > room.bounds.minX && n.x < room.bounds.maxX && n.z > room.bounds.minZ && n.z < room.bounds.maxZ);
        expect(cells.length, `${layout.name} ${room.name}`).toBeGreaterThanOrEqual(4);
      }
      // Neighbouring cells are 0.5 to 0.6 m apart (diagonals up to about 0.85).
      for (const [a, list] of grid.edges.entries()) for (const { to } of list) {
        const p = grid.nodes[a]!, q = grid.nodes[to]!;
        if (p.level >= 0 && p.level === q.level && a !== grid.threshold && to !== grid.threshold) {
          expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(0.49);
          expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThanOrEqual(0.86);
        }
      }
    });
  });

  it('keeps every cell clear of walls and furniture, and never links through a wall', () => {
    HOUSE_LAYOUTS.forEach((layout, index) => {
      const grid = [BUNKHOUSE, BLOCK, WORKSHOP][index]!;
      for (const node of grid.nodes) if (node.level >= 0) expect(pointClear(grid.levels[node.level]!, node.x, node.z), layout.name).toBe(true);
      for (const [a, list] of grid.edges.entries()) for (const { to } of list) {
        const p = grid.nodes[a]!, q = grid.nodes[to]!;
        if (p.level >= 0 && p.level === q.level) expect(segmentClear(grid.levels[p.level]!, p.x, p.z, q.x, q.z)).toBe(true);
      }
      // A furniture piece's middle is never walkable on its floor.
      for (const item of layout.furniture) {
        const level = grid.levels.findIndex((l) => Math.abs(l.y - item.bounds.minY) < 1e-3);
        expect(pointClear(grid.levels[level]!, (item.bounds.minX + item.bounds.maxX) / 2, (item.bounds.minZ + item.bounds.maxZ) / 2)).toBe(false);
      }
    });
    // The bunkhouse partition (z = 0) is crossed only at its doorway (x -1.1 to 0).
    const ground = BUNKHOUSE.levels[0]!;
    expect(segmentClear(ground, 0.4, 0.8, 0.4, -0.6)).toBe(false);
    expect(segmentClear(ground, -0.55, 0.8, -0.55, -0.6)).toBe(true);
    // The front wall is crossed only through the door.
    const door = HOUSE_LAYOUTS[0]!.door;
    expect(segmentClear(ground, door.x, door.z - 0.8, door.x, door.z + 0.8)).toBe(true);
    expect(segmentClear(ground, door.x + 1.0, door.z - 0.8, door.x + 1.0, door.z + 0.8)).toBe(false);
  });

  it('joins the door to the street and the inside', () => {
    for (const grid of [BUNKHOUSE, BLOCK, WORKSHOP]) {
      const outside = grid.nodes[grid.outside]!, threshold = grid.nodes[grid.threshold]!;
      expect(outside.level).toBe(OUTSIDE_LEVEL);
      expect(outside.z).toBeGreaterThan(grid.halfZ);
      expect(threshold.z).toBeLessThan(grid.halfZ);
      expect(grid.edges[grid.threshold]!.some(({ to }) => to === grid.outside)).toBe(true);
      expect(grid.edges[grid.threshold]!.filter(({ to }) => grid.nodes[to]!.level === 0).length).toBeGreaterThan(0);
    }
  });

  it('runs the block stair as a ramp of nodes from the ground floor to the upper floor', () => {
    const stair = HOUSE_LAYOUTS[1]!.stair!;
    expect(BLOCK.levels.map((l) => l.y)).toEqual([0.05, 3.05]);
    const flight = BLOCK.nodes.filter((n) => n.level === STAIR_LEVEL);
    expect(flight.length).toBeGreaterThanOrEqual(8);
    for (const node of flight) expect(node.y).toBeCloseTo(rampHeight(stair, node.z), 6);
    // The cheapest way from an upper floor cell to the door goes down the flight.
    const upper = nearestNode(BLOCK, -1.0, 0, 1), field = walkField(BLOCK, BLOCK.outside);
    const path: number[] = [upper];
    while (path[path.length - 1] !== BLOCK.outside) path.push(field[path[path.length - 1]!]!);
    const levels = path.map((id) => BLOCK.nodes[id]!.level);
    expect(levels[0]).toBe(1);
    expect(levels).toContain(STAIR_LEVEL);
    expect(levels.indexOf(0)).toBeGreaterThan(levels.indexOf(STAIR_LEVEL));
    // Along the path the floor height changes by no more than a stair step between nodes.
    for (let k = 1; k < path.length; k++) expect(Math.abs(BLOCK.nodes[path[k]!]!.y - BLOCK.nodes[path[k - 1]!]!.y)).toBeLessThan(0.5);
    // Single-storey designs have no stair nodes.
    expect(BUNKHOUSE.nodes.some((n) => n.level === STAIR_LEVEL)).toBe(false);
  });

  it('gives the floor under the feet: ground, ramp or upper floor', () => {
    const stair = HOUSE_LAYOUTS[1]!.stair!;
    // Over the stair's foot the upper floor is overhead: who stands below stays below.
    expect(floorAt(BLOCK, 1.0, 2.0, 0.05)).toBeCloseTo(rampHeight(stair, 2.0), 6);
    expect(floorAt(BLOCK, 1.0, 2.0, 3.05)).toBeCloseTo(3.05, 6);
    expect(floorAt(BLOCK, -1.0, 0, 0.05)).toBeCloseTo(0.05, 6);
    expect(floorAt(BLOCK, -1.0, 0, 3.05)).toBeCloseTo(3.05, 6);
    // Halfway up the flight.
    const midZ = (stair.bottomZ + stair.topZ) / 2, mid = rampHeight(stair, midZ);
    expect(floorAt(BLOCK, 1.0, midZ, mid - 0.1)).toBeCloseTo(mid, 6);
    expect(levelAt(BLOCK, 1.0, midZ, mid)).toBe(STAIR_LEVEL);
    expect(levelAt(BLOCK, -1.0, 0, 3.05)).toBe(1);
    expect(levelAt(BLOCK, -1.0, 0, 0.05)).toBe(0);
    expect(CLEARANCE).toBeGreaterThan(0.2);
  });
});
