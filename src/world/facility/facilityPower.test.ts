import { describe, expect, it } from 'vitest';
import { generateFacilityLayout, OPEN, SOLID } from './facilityLayout.ts';
import { facilityPower, unpoweredLamps } from './facilityPower.ts';

describe('Facility power zones', () => {
  it('places one wall panel per zone, outside the atrium and clear of doorways, across 30 seeds', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const layout = generateFacilityLayout(seed), power = facilityPower(layout);
      expect(facilityPower(generateFacilityLayout(seed))).toEqual(power);
      expect(power.zoneCount).toBeGreaterThanOrEqual(4);
      expect(power.zoneCount).toBeLessThanOrEqual(6);
      expect(power.breakers).toHaveLength(power.zoneCount);
      expect(new Set(power.roomZone).size).toBe(power.zoneCount);
      expect(power.lampZone).toHaveLength(layout.lamps.length);
      for (const zone of [...power.roomZone, ...power.lampZone]) {
        expect(zone).toBeGreaterThanOrEqual(0); expect(zone).toBeLessThan(power.zoneCount);
      }
      power.breakers.forEach((panel, zone) => {
        expect(panel.id).toBe(zone); expect(panel.zone).toBe(zone);
        expect(panel.room).not.toBe(0); expect(power.roomZone[panel.room]).toBe(zone);
        expect(layout.kinds[panel.wall.j * layout.size + panel.wall.i]).toBe(SOLID);
        expect(layout.kinds[panel.floor.j * layout.size + panel.floor.i]).toBe(OPEN);
        expect(layout.region[panel.floor.j * layout.size + panel.floor.i]).toBe(panel.room);
        expect(Math.abs(panel.wall.i - panel.floor.i) + Math.abs(panel.wall.j - panel.floor.j)).toBe(1);
        expect(panel.y).toBe(1.45);
        for (const door of layout.doorways) {
          expect(Math.max(Math.abs(panel.floor.i - door.i), Math.abs(panel.floor.j - door.j))).toBeGreaterThanOrEqual(3);
        }
        const unpowered = unpoweredLamps(layout, power, id => id !== zone);
        expect(unpowered).toEqual(layout.lamps.flatMap((lamp, id) => lamp.kind !== 'emergency' && power.lampZone[id] === zone ? [id] : []));
      });
      expect(unpoweredLamps(layout, power, () => true)).toEqual([]);
    }
  });
});
