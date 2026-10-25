import { describe, expect, it } from 'vitest';
import {
  doorToWorld, furnitureCollider, HOUSE_LAYOUTS, houseToWorld, stairRamp, stairSlopeDegrees, stairSteps, wallPieces,
  type AxisBox, type HouseLayout, type HouseWall,
} from './houseLayout.ts';
import { houseFromKey, houseKey, houseObjectId, houseRefName, parseHouseObjectId } from './valleyHouseIds.ts';
import { PLAYER_RADIUS } from '../../core/config.ts';

const inside = (b: AxisBox, x: number, y: number, z: number, eps = 1e-9): boolean =>
  x > b.minX + eps && x < b.maxX - eps && y > b.minY + eps && y < b.maxY - eps && z > b.minZ + eps && z < b.maxZ - eps;
const overlapXZ = (a: AxisBox, b: AxisBox): boolean => a.minX < b.maxX - 1e-9 && b.minX < a.maxX - 1e-9 && a.minZ < b.maxZ - 1e-9 && b.minZ < a.maxZ - 1e-9;
/** A point on the wall's centre plane at `along` and height `y`. */
const onWall = (wall: HouseWall, along: number, y: number): [number, number, number] =>
  wall.run === 'x' ? [along, y, wall.at] : [wall.at, y, along];
const outside = (layout: HouseLayout) => layout.walls.filter((wall) => wall.outward !== 0);

describe('house layouts', () => {
  it('give every design a front door, at least two windows and a doorway between rooms on one floor', () => {
    expect(HOUSE_LAYOUTS.map((l) => l.name)).toEqual(['bunkhouse', 'block', 'workshop']);
    for (const layout of HOUSE_LAYOUTS) {
      const openings = outside(layout).flatMap((wall) => wall.openings.map((opening) => ({ wall, opening })));
      const doors = openings.filter((o) => o.opening.kind === 'door');
      expect(doors, layout.name).toHaveLength(1);
      expect(doors[0]!.wall.run).toBe('x');
      expect(doors[0]!.wall.outward).toBe(1);
      expect(doors[0]!.opening.along).toBe(layout.door.x);
      expect(doors[0]!.wall.at).toBe(layout.door.z);
      expect(openings.filter((o) => o.opening.kind === 'window').length, layout.name).toBeGreaterThanOrEqual(2);
      const floors = new Set(layout.rooms.map((room) => room.bounds.minY));
      if (floors.size < layout.rooms.length) {
        expect(layout.walls.some((wall) => wall.outward === 0 && wall.openings.some((o) => o.kind === 'doorway')), layout.name).toBe(true);
      }
      expect(layout.rooms.length).toBeGreaterThanOrEqual(1);
      expect(layout.rooms.length).toBeLessThanOrEqual(2);
    }
  });

  it('keep openings inside their walls, apart, wide enough for a player, and the door leaves room to slide', () => {
    for (const layout of HOUSE_LAYOUTS) {
      for (const wall of layout.walls) {
        const sorted = [...wall.openings].sort((a, b) => a.along - b.along);
        sorted.forEach((opening, i) => {
          const label = `${layout.name} ${opening.kind} at ${opening.along}`;
          expect(opening.along - opening.width / 2, label).toBeGreaterThan(wall.from + 0.05);
          expect(opening.along + opening.width / 2, label).toBeLessThan(wall.to - 0.05);
          expect(opening.bottom, label).toBeGreaterThanOrEqual(wall.bottom);
          expect(opening.bottom + opening.height, label).toBeLessThan(wall.top);
          if (opening.kind !== 'window') expect(opening.width, label).toBeGreaterThan(2 * PLAYER_RADIUS + 0.25);
          const next = sorted[i + 1];
          if (next) expect(opening.along + opening.width / 2 + 0.1, label).toBeLessThan(next.along - next.width / 2);
        });
      }
      // Open, each leaf has slid a half width into the wall: from the door's centre out to one full
      // width on both sides, inside the room's wall faces and clear of any other opening.
      const door = layout.door, front = outside(layout).find((wall) => wall.openings.some((o) => o.kind === 'door'))!;
      const inner = { from: front.from, to: front.to };
      expect(door.x - door.width).toBeGreaterThan(inner.from);
      expect(door.x + door.width).toBeLessThan(inner.to);
      for (const other of front.openings.filter((o) => o.kind !== 'door')) {
        expect(other.along + other.width / 2 < door.x - door.width || other.along - other.width / 2 > door.x + door.width).toBe(true);
      }
    }
  });

  it('cut walls into pieces that leave every opening clear and the rest of the wall solid', () => {
    for (const layout of HOUSE_LAYOUTS) {
      for (const wall of layout.walls) {
        const pieces = wallPieces(wall);
        const solidAt = (along: number, y: number) => pieces.some((p) => inside(p, ...onWall(wall, along, y), -1e-9));
        for (const opening of wall.openings) {
          for (const [fa, fy] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.9]]) {
            expect(solidAt(opening.along + (fa! - 0.5) * opening.width, opening.bottom + fy! * opening.height), `${layout.name} ${opening.kind}`).toBe(false);
          }
        }
        for (let along = wall.from + 0.03; along < wall.to; along += 0.17) {
          for (let y = wall.bottom + 0.03; y < wall.top; y += 0.19) {
            const open = wall.openings.some((o) => Math.abs(along - o.along) < o.width / 2 && y > o.bottom && y < o.bottom + o.height);
            if (!open) expect(solidAt(along, y), `${layout.name} wall at ${wall.at} along ${along.toFixed(2)} y ${y.toFixed(2)}`).toBe(true);
          }
        }
        // Pieces never overlap: their volumes add up to the wall's less its openings.
        const volume = pieces.reduce((sum, p) => sum + (p.maxX - p.minX) * (p.maxY - p.minY) * (p.maxZ - p.minZ), 0);
        const expected = ((wall.to - wall.from) * (wall.top - wall.bottom) - wall.openings.reduce((sum, o) => sum + o.width * o.height, 0)) * wall.thickness;
        expect(volume).toBeCloseTo(expected, 6);
      }
    }
  });

  it('hang one lamp under each room ceiling and stand the furniture on its floor, apart and off the stair', () => {
    for (const layout of HOUSE_LAYOUTS) {
      for (const room of layout.rooms) {
        expect(inside(room.bounds, room.lamp.x, room.lamp.y, room.lamp.z), `${layout.name} ${room.name}`).toBe(true);
        expect(room.bounds.maxY - room.lamp.y).toBeLessThan(0.1);
        expect(room.bounds.maxY - room.bounds.minY, `${layout.name} ${room.name} headroom`).toBeGreaterThan(2.3);
      }
      const stairBox = layout.stair && { minX: layout.stair.minX, maxX: layout.stair.maxX, minY: 0, maxY: 0, minZ: Math.min(layout.stair.bottomZ, layout.stair.topZ), maxZ: Math.max(layout.stair.bottomZ, layout.stair.topZ) };
      layout.furniture.forEach((item, i) => {
        const label = `${layout.name} ${item.kind} ${i}`;
        const home = layout.rooms.find((room) => Math.abs(room.bounds.minY - item.bounds.minY) < 1e-9 &&
          item.bounds.minX >= room.bounds.minX - 1e-9 && item.bounds.maxX <= room.bounds.maxX + 1e-9 &&
          item.bounds.minZ >= room.bounds.minZ - 1e-9 && item.bounds.maxZ <= room.bounds.maxZ + 1e-9);
        expect(home, label).toBeDefined();
        expect(item.bounds.maxY).toBeLessThan(home!.bounds.maxY);
        for (const other of layout.furniture.slice(i + 1)) {
          if (Math.abs(other.bounds.minY - item.bounds.minY) < 1e-9) expect(overlapXZ(item.bounds, other.bounds), label).toBe(false);
        }
        if (stairBox && item.bounds.minY < 1) expect(overlapXZ(item.bounds, stairBox), label).toBe(false);
        const collider = furnitureCollider(item);
        expect(collider.maxY).toBe(item.bounds.maxY);
        if (item.kind === 'table') expect(collider.minY).toBeGreaterThan(item.bounds.minY + 0.5);
      });
    }
  });

  it('give the block a stair a player can walk: gentle enough, flush with the upper floor, its ramp under the steps', () => {
    const layout = HOUSE_LAYOUTS[1]!, stair = layout.stair!;
    expect(stairSlopeDegrees(stair)).toBeLessThan(33);
    // The landing at its top is part of the upper floor, a player wide.
    const landing = layout.floors.find((f) => f.maxY === stair.topY && f.minX === stair.minX && f.maxZ === stair.topZ);
    expect(landing).toBeDefined();
    expect(landing!.maxZ - landing!.minZ).toBeGreaterThan(2 * PLAYER_RADIUS + 0.2);
    // No floor over the flight where a climbing head (1.8 m) would meet its underside (the capsule's
    // round top drops away within a quarter metre of its axis).
    for (let z = stair.topZ; z <= stair.bottomZ; z += 0.05) {
      const feet = stair.bottomY + (stair.bottomZ - z) / (stair.bottomZ - stair.topZ) * (stair.topY - stair.bottomY);
      for (const f of layout.floors) {
        const over = f.minX < stair.maxX && f.maxX > stair.minX && z + 0.25 > f.minZ && z - 0.25 < f.maxZ && f.minY > feet;
        if (over) expect(f.minY - feet, `z ${z.toFixed(2)}`).toBeGreaterThan(1.85);
      }
    }
    // The ramp's top face runs through the foot of the flight and the edge of the landing.
    const ramp = stairRamp(stair);
    const dz = ramp.end.z - ramp.start.z, dy = ramp.end.y - ramp.start.y, length = Math.hypot(dz, dy);
    const normal = { y: -dz / length, z: dy / length };
    const up = normal.y > 0 ? normal : { y: -normal.y, z: -normal.z };
    for (const [end, y, z] of [[ramp.start, stair.bottomY, stair.bottomZ], [ramp.end, stair.topY, stair.topZ]] as const) {
      expect(end.y + up.y * ramp.thickness / 2).toBeCloseTo(y, 6);
      expect(end.z + up.z * ramp.thickness / 2).toBeCloseTo(z, 6);
    }
    const steps = stairSteps(stair);
    expect(steps.length).toBeGreaterThan(12);
    expect(steps[steps.length - 1]!.maxY).toBeCloseTo(stair.topY, 6);
    expect(Math.max(...steps.map((s) => s.maxY - s.minY))).toBeLessThan(0.5);
  });

  it('turn a house door into the world with the house, its inward side pointing into the house', () => {
    for (const layout of HOUSE_LAYOUTS) {
      for (const turn of [0, 1, 2, 3]) {
        const rotation = turn * Math.PI / 2;
        const door = doorToWorld(layout.door, 100, 7, -40, rotation);
        expect(door.axis).toBe(turn % 2 === 0 ? 'z' : 'x');
        expect(door.y).toBe(7 + (layout.door.y ?? 0));
        const centre = houseToWorld(0, 0, 0, 100, 7, -40, rotation);
        // One metre in from the door along +side is nearer the house's centre than the door is.
        const step = { x: door.axis === 'x' ? door.side : 0, z: door.axis === 'z' ? door.side : 0 };
        const before = Math.hypot(door.x - centre.x, door.z - centre.z);
        const after = Math.hypot(door.x + step.x - centre.x, door.z + step.z - centre.z);
        expect(after).toBeLessThan(before);
      }
    }
  });
});

describe('Valley house ids', () => {
  it('round-trip a house and its door and lamp slots, and refuse anything else', () => {
    for (const ref of [{ gx: 0, gz: 0, index: 0 }, { gx: -3, gz: 7, index: 19 }, { gx: 2047, gz: -2048, index: 63 }]) {
      const key = houseKey(ref);
      expect(key).toBeGreaterThanOrEqual(0);
      expect(houseFromKey(key)).toEqual(ref);
      for (const slot of [0, 1, 3]) {
        const id = houseObjectId(key, slot);
        expect(Number.isSafeInteger(id)).toBe(true);
        expect(parseHouseObjectId(id)).toEqual({ house: ref, key, slot });
      }
    }
    expect(houseKey({ gx: 2048, gz: 0, index: 0 })).toBe(-1);
    expect(houseKey({ gx: 0, gz: 0, index: 64 })).toBe(-1);
    expect(houseObjectId(5, 4)).toBe(-1);
    expect(houseObjectId(-1, 0)).toBe(-1);
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 60]) expect(parseHouseObjectId(bad)).toBeNull();
    expect(houseRefName({ gx: -3, gz: 7, index: 2 })).toBe('-3,7:2');
  });
});
