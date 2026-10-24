import { describe, expect, it } from 'vitest';
import { cellCentre, generateFacilityLayout, OPEN, PROP, SOLID, type FacilityLayout, type FacilityRoom } from '../world/facility/facilityLayout.ts';
import { cellFill, FacilityMapReveal, planWorldRect, revealGroups, worldToPlanPixel } from './facilityMapLayer.ts';

const SIZE = 56;

/** Two rooms joined by a corridor along j = 4, plus a second corridor stretch at j = 30 that
 * touches neither, and one crate in the first room. */
function testLayout(): FacilityLayout {
  const kinds = new Uint8Array(SIZE * SIZE).fill(SOLID);
  const region = new Int16Array(SIZE * SIZE).fill(-2);
  const rooms: FacilityRoom[] = [
    { i0: 2, j0: 2, i1: 7, j1: 7, kind: 'storage', ceiling: 4.5, dark: false },
    { i0: 20, j0: 2, i1: 25, j1: 7, kind: 'office', ceiling: 3.5, dark: true },
  ];
  rooms.forEach((room, index) => {
    for (let j = room.j0; j < room.j1; j++) for (let i = room.i0; i < room.i1; i++) {
      kinds[j * SIZE + i] = OPEN;
      region[j * SIZE + i] = index;
    }
  });
  for (let i = 7; i < 20; i++) {
    kinds[4 * SIZE + i] = OPEN;
    region[4 * SIZE + i] = -1;
  }
  for (let i = 2; i < 11; i++) {
    kinds[30 * SIZE + i] = OPEN;
    region[30 * SIZE + i] = -1;
  }
  kinds[3 * SIZE + 3] = PROP;
  return { seed: 0, size: SIZE, cell: 1.5, kinds, ceiling: new Float32Array(kinds.length), region, rooms, doorways: [], crates: [], lamps: [] };
}

describe('revealGroups', () => {
  it('gives room cells their room, each corridor stretch its own group and SOLID none', () => {
    const { groups, count } = revealGroups(testLayout());
    expect(groups[4 * SIZE + 4]).toBe(0);
    expect(groups[3 * SIZE + 3]).toBe(0); // the crate belongs to its room
    expect(groups[4 * SIZE + 22]).toBe(1);
    const corridorA = groups[4 * SIZE + 10]!;
    const corridorB = groups[30 * SIZE + 5]!;
    expect(corridorA).toBeGreaterThanOrEqual(2);
    expect(corridorB).toBeGreaterThanOrEqual(2);
    expect(corridorA).not.toBe(corridorB);
    for (let i = 7; i < 20; i++) expect(groups[4 * SIZE + i]).toBe(corridorA);
    expect(groups[0]).toBe(-1);
    expect(count).toBe(4);
  });

  it('covers every non-SOLID cell of generated layouts', () => {
    for (const seed of [1, 2, 3]) {
      const layout = generateFacilityLayout(seed);
      const { groups, count } = revealGroups(layout);
      layout.kinds.forEach((kind, index) => {
        if (kind === SOLID) expect(groups[index]).toBe(-1);
        else {
          expect(groups[index]).toBeGreaterThanOrEqual(0);
          expect(groups[index]).toBeLessThan(count);
        }
      });
    }
  });
});

describe('FacilityMapReveal', () => {
  it('reveals a room once, when the player first stands in it, and nothing else', () => {
    const reveal = new FacilityMapReveal(testLayout());
    const inRoom = cellCentre(4, 4);
    expect(reveal.isRevealed(0)).toBe(false);
    expect(reveal.enter(inRoom.x, inRoom.z)).toBe(0);
    expect(reveal.enter(inRoom.x, inRoom.z)).toBe(-1);
    expect(reveal.isRevealed(0)).toBe(true);
    expect(reveal.isRevealed(1)).toBe(false);
  });

  it('reveals the whole corridor stretch the player steps into, not the other stretch', () => {
    const reveal = new FacilityMapReveal(testLayout());
    const corridor = cellCentre(12, 4);
    const group = reveal.enter(corridor.x, corridor.z);
    expect(group).toBeGreaterThanOrEqual(2);
    const far = cellCentre(18, 4);
    expect(reveal.groupAt(far.x, far.z)).toBe(group);
    expect(reveal.enter(far.x, far.z)).toBe(-1);
    const other = cellCentre(5, 30);
    expect(reveal.isRevealed(reveal.groupAt(other.x, other.z))).toBe(false);
  });

  it('ignores wall mass and positions off the grid', () => {
    const reveal = new FacilityMapReveal(testLayout());
    const wall = cellCentre(0, 0);
    expect(reveal.enter(wall.x, wall.z)).toBe(-1);
    expect(reveal.enter(500, -500)).toBe(-1);
  });
});

describe('plan mapping', () => {
  it('spans the centred grid', () => {
    expect(planWorldRect(testLayout())).toEqual({ x: -42, z: -42, size: 84 });
  });

  it('maps a cell centre to the middle of that cell in the image', () => {
    const layout = testLayout();
    for (const [i, j] of [[0, 0], [28, 28], [55, 3], [7, 41]] as const) {
      const centre = cellCentre(i, j);
      const { u, v } = worldToPlanPixel(layout, centre.x, centre.z, 4);
      expect(u).toBeCloseTo((i + 0.5) * 4);
      expect(v).toBeCloseTo((j + 0.5) * 4);
    }
  });

  it('dims unexplored floor, brightens explored floor, darkens crates and skips walls', () => {
    expect(cellFill(SOLID, false)).toBeNull();
    expect(cellFill(SOLID, true)).toBeNull();
    const alpha = (fill: string | null): number => Number(/([\d.]+)\)$/.exec(fill ?? '')?.[1]);
    expect(alpha(cellFill(OPEN, true))).toBeGreaterThan(alpha(cellFill(OPEN, false)));
    expect(alpha(cellFill(PROP, false))).toBeLessThan(alpha(cellFill(OPEN, false)));
    expect(alpha(cellFill(PROP, true))).toBeLessThan(alpha(cellFill(OPEN, true)));
  });
});
