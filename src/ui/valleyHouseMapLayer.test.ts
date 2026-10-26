import { describe, expect, it } from 'vitest';
import { HOUSE_LAYOUTS, type AxisBox } from '../world/houses/houseLayout.ts';
import { AMBER } from './theme.ts';
import { HOUSE_ZOOM_RADIUS, housePlan, ValleyHouseMapLayer, type MapHouse } from './valleyHouseMapLayer.ts';

const coversXZ = (boxes: readonly AxisBox[], x: number, z: number): boolean =>
  boxes.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);

describe('house plan on the minimap', () => {
  it('draws the ground floor walls with gaps at the door, the windows and the inner doorways', () => {
    for (const layout of HOUSE_LAYOUTS) {
      const plan = housePlan(layout), door = layout.door;
      expect(plan.walls.length, layout.name).toBeGreaterThan(4);
      expect(coversXZ(plan.walls, door.x, door.z), `${layout.name} door gap`).toBe(false);
      expect(coversXZ([plan.door], door.x, door.z)).toBe(true);
      // A wall corner is wall.
      expect(coversXZ(plan.walls, plan.halfX - 0.1, plan.halfZ - 0.1), `${layout.name} corner`).toBe(true);
      for (const wall of layout.walls) {
        if (wall.bottom > 0.1) continue;
        for (const opening of wall.openings) {
          const [x, z] = wall.run === 'x' ? [opening.along, wall.at] : [wall.at, opening.along];
          expect(coversXZ(plan.walls, x, z), `${layout.name} ${opening.kind} at ${opening.along}`).toBe(false);
          if (opening.kind === 'window') expect(coversXZ(plan.windows, x, z)).toBe(true);
        }
      }
    }
    // The block's plan is its ground floor: no upper floor window marks (four below, none above).
    expect(housePlan(HOUSE_LAYOUTS[1]!).windows).toHaveLength(4);
  });

  it('shows a house once entered, keeps it after leaving, and zooms in only while inside', () => {
    const houses: MapHouse[] = [
      { key: 4, design: 0, x: 10, z: 20, rotationY: 0, doorOpen: false },
      { key: 8, design: 2, x: 40, z: 20, rotationY: Math.PI / 2, doorOpen: true },
    ];
    const layer = new ValleyHouseMapLayer({ mapHouses: () => houses });
    layer.update(0, 0);
    expect(layer.debugState()).toEqual({ entered: [], inside: null });
    expect(layer.zoomRadius()).toBeNull();
    layer.update(10, 19);
    expect(layer.debugState()).toEqual({ entered: [4], inside: 4 });
    expect(layer.zoomRadius()).toBe(HOUSE_ZOOM_RADIUS);
    layer.update(10, 30);
    expect(layer.debugState()).toEqual({ entered: [4], inside: null });
    expect(layer.zoomRadius()).toBeNull();
    // The workshop turned a quarter: 7.22 m deep along x now, 6.56 m wide along z.
    layer.update(43, 20);
    expect(layer.debugState().inside).toBe(8);
    layer.update(40, 23.5);
    expect(layer.debugState().inside).toBeNull();
  });

  it('draws only entered houses, the door amber while shut', () => {
    const houses: MapHouse[] = [
      { key: 4, design: 0, x: 10, z: 20, rotationY: 0, doorOpen: false },
      { key: 8, design: 1, x: 40, z: 20, rotationY: 0, doorOpen: true },
    ];
    const layer = new ValleyHouseMapLayer({ mapHouses: () => houses });
    const fills: string[] = [];
    const context = {
      fillStyle: '',
      save() {}, restore() {}, translate() {}, rotate() {},
      fillRect() { fills.push(String(this.fillStyle)); },
    };
    layer.update(10, 20);
    layer.draw(context as unknown as CanvasRenderingContext2D);
    const plan = housePlan(HOUSE_LAYOUTS[0]!);
    expect(fills).toHaveLength(plan.walls.length + plan.windows.length + 1);
    expect(fills[fills.length - 1]).toBe(AMBER);
    fills.length = 0;
    houses[0] = { ...houses[0]!, doorOpen: true };
    layer.update(10, 20);
    layer.draw(context as unknown as CanvasRenderingContext2D);
    expect(fills[fills.length - 1]).not.toBe(AMBER);
  });
});
