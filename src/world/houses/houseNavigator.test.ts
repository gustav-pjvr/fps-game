import { describe, expect, it } from 'vitest';
import { ENEMY_HEIGHT } from '../../core/config.ts';
import { HOUSE_LAYOUTS, houseToWorld } from './houseLayout.ts';
import { HouseNavigator } from './HouseNavigator.ts';
import { buildHouseWalkGrid, pointClear, levelAt } from './houseWalkGrid.ts';
import type { HousePlacement } from './ValleyHouses.ts';

const GROUND = 2;
const placement = (design: number, rotationY: number): HousePlacement =>
  ({ ref: { gx: 0, gz: 0, index: design }, design, x: 40, groundY: GROUND, z: -30, rotationY });

/** A point walker that follows the navigator the way Enemy.moveToward does (0.15 m steps, the floor
 * from floorAt, the terrain flat at GROUND outside), checking that inside the house it only ever
 * stands where the grid says a body may. Returns the steps taken, or -1 if it never arrived. */
function walk(nav: HouseNavigator, p: HousePlacement, from: { x: number; z: number; feet?: number }, to: { x: number; z: number; feet?: number }, maxSteps = 1500): number {
  const grid = buildHouseWalkGrid(HOUSE_LAYOUTS[p.design]!);
  let { x, z } = from, feet = from.feet ?? GROUND;
  const toFeet = to.feet ?? GROUND;
  const centre = ENEMY_HEIGHT / 2;
  for (let step = 0; step < maxSteps; step++) {
    if (Math.hypot(to.x - x, to.z - z) < 0.2 && Math.abs(feet - toFeet) < 0.3) return step;
    const waypoint = nav.navigate(x, z, to.x, to.z, feet + centre, toFeet + centre);
    const dx = waypoint.x - x, dz = waypoint.z - z, distance = Math.hypot(dx, dz);
    if (distance < 1e-4) return -1;
    const move = Math.min(distance, 0.15);
    x += (dx / distance) * move;
    z += (dz / distance) * move;
    feet = nav.floorAt(x, z, feet) ?? GROUND;
    // Inside the footprint: on the grid's walkable area for its floor (the stair is its own).
    const c = Math.cos(p.rotationY), s = Math.sin(p.rotationY), lx = (x - p.x) * c - (z - p.z) * s, lz = (x - p.x) * s + (z - p.z) * c;
    if (Math.abs(lx) < grid.halfX && Math.abs(lz) < grid.halfZ) {
      const level = levelAt(grid, lx, lz, feet - GROUND), stair = grid.stair;
      // Stepping on or off the flight's foot or top crosses the flight's own keep-off margin.
      const byStair = stair !== null && lx > stair.minX - 0.3 && lx < stair.maxX + 0.3 && lz > Math.min(stair.topZ, stair.bottomZ) - 0.3 && lz < Math.max(stair.topZ, stair.bottomZ) + 0.3;
      if (level >= 0 && !byStair) expect(pointClear(grid.levels[level]!, lx, lz), `stood in a wall or furniture at local (${lx.toFixed(2)}, ${lz.toFixed(2)}) level ${level}`).toBe(true);
    }
  }
  return -1;
}

/** The walk grid's cell nearest a room's middle (the middle itself may be under furniture). */
const roomCentre = (p: HousePlacement, room: number) => {
  const b = HOUSE_LAYOUTS[p.design]!.rooms[room]!.bounds, grid = buildHouseWalkGrid(HOUSE_LAYOUTS[p.design]!);
  const mx = (b.minX + b.maxX) / 2, mz = (b.minZ + b.maxZ) / 2;
  const cell = grid.nodes.filter((n) => n.level >= 0 && Math.abs(n.y - b.minY) < 1e-3 && n.x > b.minX && n.x < b.maxX && n.z > b.minZ && n.z < b.maxZ)
    .sort((m, n) => Math.hypot(m.x - mx, m.z - mz) - Math.hypot(n.x - mx, n.z - mz))[0]!;
  const at = houseToWorld(cell.x, cell.y, cell.z, p.x, p.groundY, p.z, p.rotationY);
  return { x: at.x, z: at.z, feet: at.y };
};

describe('house navigator', () => {
  it('leaves a move that never touches a house unchanged', () => {
    const nav = new HouseNavigator();
    nav.add('h', placement(0, 0));
    expect(nav.navigate(0, 0, 10, 5)).toEqual({ x: 10, z: 5 });
    expect(nav.navigate(40, -50, 40, -10)).toEqual({ x: 40, z: -10 });
    expect(nav.floorAt(0, 0, 0)).toBeNull();
    nav.remove('h');
    expect(nav.navigate(40, -30, 0, 0)).toEqual({ x: 0, z: 0 });
    expect(nav.floorAt(40, -30, GROUND)).toBeNull();
  });

  for (const rotationY of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    it(`routes outside to inside through the door, from in front and from behind (turned ${rotationY.toFixed(2)})`, () => {
      for (const design of [0, 1, 2]) {
        const p = placement(design, rotationY), nav = new HouseNavigator();
        nav.add('h', p);
        const target = roomCentre(p, design === 1 ? 0 : 1);
        const front = houseToWorld(0, 0, 12, p.x, p.groundY, p.z, rotationY), back = houseToWorld(1, 0, -12, p.x, p.groundY, p.z, rotationY);
        expect(walk(nav, p, front, target), `${HOUSE_LAYOUTS[design]!.name} from the front`).toBeGreaterThan(0);
        expect(walk(nav, p, back, target), `${HOUSE_LAYOUTS[design]!.name} from behind`).toBeGreaterThan(0);
      }
    });
  }

  it('routes inside to outside through the door', () => {
    for (const design of [0, 1, 2]) {
      const p = placement(design, Math.PI / 2), nav = new HouseNavigator();
      nav.add('h', p);
      const start = roomCentre(p, design === 1 ? 0 : 1), away = houseToWorld(-2, 0, -14, p.x, p.groundY, p.z, p.rotationY);
      expect(walk(nav, p, start, { x: away.x, z: away.z }), HOUSE_LAYOUTS[design]!.name).toBeGreaterThan(0);
    }
  });

  it('routes up the block stair to the upper floor and back down and out', () => {
    for (const rotationY of [0, Math.PI]) {
      const p = placement(1, rotationY), nav = new HouseNavigator();
      nav.add('h', p);
      const upper = roomCentre(p, 1), street = houseToWorld(0, 0, 10, p.x, p.groundY, p.z, rotationY);
      expect(upper.feet).toBeCloseTo(GROUND + 3.05, 6);
      expect(walk(nav, p, street, upper)).toBeGreaterThan(0);
      expect(walk(nav, p, roomCentre(p, 0), upper)).toBeGreaterThan(0);
      expect(walk(nav, p, upper, { x: street.x, z: street.z })).toBeGreaterThan(0);
    }
  });

  it('walks straight, without the whiskers, inside a house and onto its door', () => {
    const p = placement(0, 0), nav = new HouseNavigator();
    nav.add('h', p);
    const a = roomCentre(p, 0), b = roomCentre(p, 1);
    expect(nav.navigate(a.x, a.z, b.x, b.z, a.feet + 0.85, b.feet + 0.85).direct).toBe(true);
    // Far from the house the approach keeps the whiskers.
    expect(nav.navigate(p.x, p.z + 30, b.x, b.z).direct).toBe(false);
  });
});
