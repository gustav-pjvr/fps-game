import { describe, expect, it } from 'vitest';
import { FACILITY_ENEMY_DOOR_WAIT } from '../../core/config.ts';
import { generateFacilityLayout } from './facilityLayout.ts';
import { EnemyDoorWaits, facilityDoors, facilityOpenings } from './facilityDoors.ts';

describe('Facility door placement', () => {
  it('merges openings and deterministically doors eligible dark rooms across 30 seeds', () => {
    let eligible = 0, chosen = 0, wide = 0, dark = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const layout = generateFacilityLayout(seed), openings = facilityOpenings(layout), doors = facilityDoors(layout);
      expect(facilityOpenings(generateFacilityLayout(seed))).toEqual(openings);
      expect(facilityDoors(generateFacilityLayout(seed))).toEqual(doors);
      const cells = new Set<string>();
      for (const opening of openings) {
        opening.cells.forEach((cell, index) => {
          const key = `${cell.i},${cell.j},${opening.axis}`;
          expect(cells.has(key)).toBe(false); cells.add(key);
          expect(layout.doorways).toContainEqual({ ...cell, axis: opening.axis });
          const roomCell = (cell.j + (opening.axis === 'z' ? opening.side : 0)) * layout.size
            + cell.i + (opening.axis === 'x' ? opening.side : 0);
          expect(layout.region[roomCell]).toBe(opening.room);
          if (index > 0) {
            const previous = opening.cells[index - 1]!;
            expect(cell.i - previous.i).toBe(opening.axis === 'z' ? 1 : 0);
            expect(cell.j - previous.j).toBe(opening.axis === 'x' ? 1 : 0);
          }
        });
        const ids = opening.cells.map(c => c.j * layout.size + c.i);
        const door = doors.find(d => d.axis === opening.axis && d.cells[0] === ids[0]);
        if (ids.length > 3) { wide++; expect(door).toBeUndefined(); continue; }
        eligible++;
        if (door) { chosen++; expect(door.cells).toEqual(ids); expect(door.startsClosed).toBe(layout.rooms[opening.room]!.dark); }
        if (layout.rooms[opening.room]!.dark) { dark++; expect(door?.startsClosed).toBe(true); }
      }
      expect(cells.size).toBe(layout.doorways.length);
      expect(doors.map(d => d.id)).toEqual(doors.map((_, index) => index));
    }
    expect(wide).toBeGreaterThan(0); expect(dark).toBeGreaterThan(0);
    expect(chosen / eligible).toBeGreaterThan(0.5);
    expect(chosen / eligible).toBeLessThan(0.75);
  }, 30000);
});

describe('enemy door wait', () => {
  it('opens after 0.8 seconds at the same door and tracks enemies independently', () => {
    expect(FACILITY_ENEMY_DOOR_WAIT).toBe(0.8);
    const waits = new EnemyDoorWaits();
    expect(waits.step(1, 2, 0.5)).toBe('wait');
    expect(waits.step(2, 2, 0.4)).toBe('wait');
    expect(waits.step(1, 2, 0.3)).toBe('open');
    expect(waits.step(2, 2, 0.4)).toBe('open');
    expect(waits.step(1, 2, 0.1)).toBe('wait');
  });

  it('restarts on a different door, a clear path or reset, and ignores invalid time', () => {
    const waits = new EnemyDoorWaits();
    expect(waits.step(1, 2, 0.7)).toBe('wait');
    expect(waits.step(1, 3, 0.2)).toBe('wait');
    for (const dt of [-1, NaN, Infinity]) expect(waits.step(1, 3, dt)).toBe('wait');
    expect(waits.step(1, -1, 1)).toBe('walk');
    expect(waits.step(1, 3, 0.7)).toBe('wait');
    waits.clear();
    expect(waits.step(1, 3, 0.7)).toBe('wait');
  });
});
