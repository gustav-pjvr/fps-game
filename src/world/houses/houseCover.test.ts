import { describe, expect, it } from 'vitest';
import { interiorCoverCandidates } from '../../entities/enemies/tactics/coverPoints.ts';
import { scoreCandidates, type TacticalRequest } from '../../entities/enemies/tactics/tacticalQuery.ts';
import { HOUSE_LAYOUTS, houseToWorld } from './houseLayout.ts';
import { COVER_MIN_HEIGHT, houseCoverSlots, houseCoverSlotsInWorld, INTERIOR_STAND_OFF } from './houseCover.ts';
import { buildHouseWalkGrid, pointClear } from './houseWalkGrid.ts';

describe('cover inside houses', () => {
  it('gives every design spots beside furniture and (where there is room) its ground floor windows, all on its walk grid', () => {
    for (const layout of HOUSE_LAYOUTS) {
      const grid = buildHouseWalkGrid(layout), slots = houseCoverSlots(layout, grid);
      expect(slots.filter((s) => s.kind === 'furniture').length, layout.name).toBeGreaterThanOrEqual(2);
      // The bunkhouse's ground floor windows have its table and crates right under them, and the
      // block's its stair, shelf and table: little or no room to stand there. The workshop's are clear.
      if (layout.name === 'workshop') expect(slots.filter((s) => s.kind === 'window').length, layout.name).toBeGreaterThanOrEqual(4);
      for (const slot of slots) {
        expect(pointClear(grid.levels[0]!, slot.cover.x, slot.cover.z)).toBe(true);
        expect(pointClear(grid.levels[0]!, slot.peek.x, slot.peek.z)).toBe(true);
        expect(Math.hypot(slot.normal.x, slot.normal.z)).toBeCloseTo(1, 9);
      }
    }
  });

  it('stands each furniture spot just off a tall piece on the ground floor, on the side its face points to', () => {
    for (const layout of HOUSE_LAYOUTS) {
      const tall = layout.furniture.filter((f) => f.bounds.minY < 0.1 && f.bounds.maxY - f.bounds.minY >= COVER_MIN_HEIGHT);
      for (const slot of houseCoverSlots(layout).filter((s) => s.kind === 'furniture')) {
        // Some tall piece has this spot exactly INTERIOR_STAND_OFF out from one face, along the normal.
        const owner = tall.find((f) => {
          const b = f.bounds;
          const gapX = slot.normal.x > 0 ? slot.cover.x - b.maxX : slot.normal.x < 0 ? b.minX - slot.cover.x : NaN;
          const gapZ = slot.normal.z > 0 ? slot.cover.z - b.maxZ : slot.normal.z < 0 ? b.minZ - slot.cover.z : NaN;
          const gap = Number.isNaN(gapX) ? gapZ : gapX;
          const across = slot.normal.x !== 0 ? slot.cover.z > b.minZ && slot.cover.z < b.maxZ : slot.cover.x > b.minX && slot.cover.x < b.maxX;
          return Math.abs(gap - INTERIOR_STAND_OFF) < 1e-9 && across;
        });
        expect(owner, `${layout.name} slot at ${slot.cover.x}, ${slot.cover.z}`).toBeDefined();
      }
    }
  });

  it('places window spots against the wall either side of a window, peeking square in front of it', () => {
    const layout = HOUSE_LAYOUTS[2]!; // workshop: three windows a side
    for (const slot of houseCoverSlots(layout).filter((s) => s.kind === 'window')) {
      // Side walls run along z: the normal points into the room across x; both spots stand within
      // 0.75 m of that wall's inner face (x = +-2.8), the peek square in front of a window.
      expect(Math.abs(slot.normal.x)).toBe(1);
      expect(Math.sign(slot.normal.x)).toBe(-Math.sign(slot.cover.x));
      for (const spot of [slot.cover, slot.peek]) expect(2.8 - Math.abs(spot.x)).toBeLessThanOrEqual(0.75);
      const wall = layout.walls.find((w) => w.run === 'z' && Math.sign(w.at) === Math.sign(slot.cover.x))!;
      expect(wall.openings.some((o) => o.kind === 'window' && Math.abs(o.along - slot.peek.z) < 1e-9)).toBe(true);
    }
  });

  it('turns with the house, and hides only from a threat beyond the face', () => {
    const local = houseCoverSlots(HOUSE_LAYOUTS[0]!);
    const world = houseCoverSlotsInWorld(0, 100, -50, Math.PI / 2);
    expect(world).toHaveLength(local.length);
    const at = houseToWorld(local[0]!.cover.x, 0, local[0]!.cover.z, 100, 0, -50, Math.PI / 2);
    expect(world[0]!.cover.x).toBeCloseTo(at.x, 9);
    expect(world[0]!.cover.z).toBeCloseTo(at.z, 9);
    for (const slot of world) {
      const [only] = interiorCoverCandidates([slot], { x: slot.cover.x - slot.normal.x * 10, z: slot.cover.z - slot.normal.z * 10 });
      expect(only).toMatchObject({ cover: slot.cover, peek: slot.peek, source: 'houseInterior' });
      expect(interiorCoverCandidates([slot], { x: slot.cover.x + slot.normal.x * 10, z: slot.cover.z + slot.normal.z * 10 })).toHaveLength(0);
    }
  });

  it('are kept by position scoring though they stand inside a building footprint', () => {
    const slot = houseCoverSlotsInWorld(2, 0, 0, 0)[0]!;
    const threat = { x: slot.cover.x - slot.normal.x * 12, z: slot.cover.z - slot.normal.z * 12 };
    const request: TacticalRequest = {
      from: { x: slot.cover.x + 4, z: slot.cover.z + 4 }, threat, minRange: 5, maxRange: 30,
      requireCover: true, requireLineOfFire: false, preferHighGround: false, claimed: [], fireLines: [],
    };
    const candidates = interiorCoverCandidates([slot], threat);
    const everythingBlocked = () => true;
    expect(scoreCandidates(request, candidates, () => 0, everythingBlocked)).toHaveLength(1);
    expect(scoreCandidates(request, candidates.map((c) => ({ ...c, source: 'houseCorner' as const })), () => 0, everythingBlocked)).toHaveLength(0);
  });
});
