import { describe, expect, it } from 'vitest';
import { HOUSE_LAYOUTS, houseToWorld } from '../houses/houseLayout.ts';
import {
  BREAK_POWER, INTACT, MAX_HOLES, PANES_PER_HOUSE, PANE_STRENGTH, GLASS_SYNC_MAX_ENTRIES,
  applyHit, hitPower, isValidGlassHit, layoutPanes, mergeStates, paneId, paneToWorld, parseGlassSync, parsePaneId,
  rayPane, segmentCrossesPane, sweepPane,
  type PaneState, type WorldPane,
} from './glassPane.ts';

/** A pane 1 m wide and 1.2 m tall, centred at (0, 1.5, 0), facing +Z (outside toward +Z), u along +X. */
const PANE: WorldPane = {
  id: 1, x: 0, y: 1.5, z: 0, ux: 1, uz: 0, nx: 0, nz: 1,
  halfWidth: 0.5, halfHeight: 0.6, floorInside: 0, floorOutside: 0,
};

describe('hitPower', () => {
  it('maps weapon damage to 1, 2 or 3 points', () => {
    expect(hitPower(1)).toBe(1);
    expect(hitPower(34)).toBe(1);
    expect(hitPower(35)).toBe(2);
    expect(hitPower(59)).toBe(2);
    expect(hitPower(60)).toBe(3);
    expect(hitPower(500)).toBe(3);
  });
});

describe('applyHit', () => {
  it('breaks a pane after six power-1 hits and not after five', () => {
    let state: PaneState = INTACT;
    for (let i = 0; i < 5; i++) {
      const result = applyHit(state, 0, 0, 1);
      expect(result.outcome).toBe('cracked');
      state = result.state;
    }
    expect(state.broken).toBe(false);
    expect(state.damage).toBe(5);
    const last = applyHit(state, 0, 0, 1);
    expect(last.outcome).toBe('broke');
    expect(last.state.broken).toBe(true);
    expect(last.state.damage).toBe(PANE_STRENGTH);
  });

  it('adds a hole at the hit point, snapped to centimetres, for each non-breaking hit', () => {
    const first = applyHit(INTACT, 0.1234, -0.2567, 1);
    expect(first.state.holes).toHaveLength(2);
    expect(first.state.holes[0]).toBeCloseTo(0.12, 9);
    expect(first.state.holes[1]).toBeCloseTo(-0.26, 9);
    const second = applyHit(first.state.holes.length ? first.state : INTACT, 0.3, 0.4, 2);
    expect(second.state.holes).toHaveLength(4);
    expect(second.state.damage).toBe(3);
  });

  it('keeps at most MAX_HOLES holes but still counts the damage', () => {
    // Six strength means a real pane never reaches the cap, so check it with the list already full.
    const full: PaneState = { damage: 1, broken: false, holes: Array.from({ length: MAX_HOLES * 2 }, (_, i) => i / 100) };
    const result = applyHit(full, 0.5, 0.5, 1);
    expect(result.outcome).toBe('cracked');
    expect(result.state.holes).toHaveLength(MAX_HOLES * 2);
    expect(result.state.holes).toEqual(full.holes);
    expect(result.state.damage).toBe(2);
    expect(result.state.broken).toBe(false);
  });

  it('changes nothing for a hit on a broken pane', () => {
    const broken = applyHit(INTACT, 0, 0, BREAK_POWER).state;
    const again = applyHit(broken, 0.2, 0.2, 3);
    expect(again.outcome).toBe('none');
    expect(again.state).toBe(broken);
  });

  it('breaks an intact pane at once with BREAK_POWER, leaving no holes', () => {
    const result = applyHit(INTACT, 0.1, 0.1, BREAK_POWER);
    expect(result.outcome).toBe('broke');
    expect(result.state).toEqual({ damage: PANE_STRENGTH, broken: true, holes: [] });
    // Even a cracked pane with holes loses them on breaking.
    const cracked = applyHit(INTACT, 0.1, 0.1, 1).state;
    expect(applyHit(cracked, 0, 0, BREAK_POWER).state.holes).toEqual([]);
  });

  it('does nothing for zero, negative or non-numeric power', () => {
    for (const power of [0, -1, NaN]) {
      const result = applyHit(INTACT, 0, 0, power);
      expect(result.outcome).toBe('none');
      expect(result.state).toBe(INTACT);
    }
  });

  it('does nothing for a power under 1 (it floors to no damage)', () => {
    const result = applyHit(INTACT, 0.1, 0.1, 0.5);
    expect(result.outcome).toBe('none');
  });

  it('does not mutate the state it was given', () => {
    const before: PaneState = { damage: 2, broken: false, holes: [0.1, 0.2] };
    applyHit(before, 0.3, 0.3, 1);
    expect(before).toEqual({ damage: 2, broken: false, holes: [0.1, 0.2] });
  });
});

describe('mergeStates', () => {
  const cracked = (damage: number): PaneState => ({ damage, broken: false, holes: [0, 0] });
  const broken: PaneState = { damage: PANE_STRENGTH, broken: true, holes: [] };

  it('lets broken win, whichever side it is on', () => {
    expect(mergeStates(cracked(5), broken)).toBe(broken);
    expect(mergeStates(broken, cracked(5))).toBe(broken);
  });

  it('lets the higher damage win', () => {
    expect(mergeStates(cracked(2), cracked(4))).toEqual(cracked(4));
    const mine = cracked(4);
    expect(mergeStates(mine, cracked(2))).toBe(mine);
  });

  it('keeps mine when equal', () => {
    const mine = cracked(3), theirs = { ...cracked(3), holes: [0.5, 0.5] };
    expect(mergeStates(mine, theirs)).toBe(mine);
  });
});

describe('layoutPanes', () => {
  it('finds each design\'s windows, in order', () => {
    expect(HOUSE_LAYOUTS.map((layout) => layoutPanes(layout).length)).toEqual([4, 11, 6]);
  });

  it('numbers panes 0..n-1 and matches each opening\'s size', () => {
    for (const layout of HOUSE_LAYOUTS) {
      const panes = layoutPanes(layout);
      panes.forEach((pane, i) => {
        expect(pane.index).toBe(i);
        const opening = layout.walls[pane.wall]!.openings[pane.opening]!;
        expect(opening.kind).toBe('window');
        expect(pane.width).toBe(opening.width);
        expect(pane.height).toBe(opening.height);
        expect(pane.y).toBeCloseTo(opening.bottom + opening.height / 2, 9);
        expect(layout.walls[pane.wall]!.outward).not.toBe(0);
      });
      expect(panes.length).toBeLessThanOrEqual(PANES_PER_HOUSE);
    }
  });

  it('gives equal results when called twice', () => {
    for (const layout of HOUSE_LAYOUTS) expect(layoutPanes(layout)).toEqual(layoutPanes(layout));
  });

  it('leaves the pane in the wall\'s centre line, on the wall\'s run', () => {
    for (const layout of HOUSE_LAYOUTS) {
      for (const pane of layoutPanes(layout)) {
        const wall = layout.walls[pane.wall]!, opening = wall.openings[pane.opening]!;
        expect(pane.run).toBe(wall.run);
        if (wall.run === 'x') {
          expect(pane.x).toBe(opening.along);
          expect(pane.z).toBe(wall.at);
        } else {
          expect(pane.z).toBe(opening.along);
          expect(pane.x).toBe(wall.at);
        }
      }
    }
  });
});

describe('paneId and parsePaneId', () => {
  it('round-trip', () => {
    for (const [key, index] of [[0, 0], [0, 15], [1, 0], [37, 5], [123456, 3]] as const) {
      expect(parsePaneId(paneId(key, index))).toEqual({ houseKey: key, index });
    }
  });

  it('are unique across two house keys and every index', () => {
    const ids = new Set<number>();
    for (const key of [0, 1, 2, 1000, 1001]) {
      for (let index = 0; index < PANES_PER_HOUSE; index++) ids.add(paneId(key, index));
    }
    expect(ids.size).toBe(5 * PANES_PER_HOUSE);
  });

  it('refuse anything that is not a non-negative safe integer', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, 2 ** 60]) expect(parsePaneId(bad)).toBeNull();
  });
});

describe('paneToWorld', () => {
  const specs = HOUSE_LAYOUTS.flatMap((layout) => layoutPanes(layout).map((spec) => ({ layout, spec })));

  it('puts the pane centre where houseToWorld puts it, for no turn and a quarter turn', () => {
    for (const { spec } of specs) {
      for (const rotation of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const pane = paneToWorld(spec, 7, 100, 3, -40, rotation);
        const expected = houseToWorld(spec.x, spec.y, spec.z, 100, 3, -40, rotation);
        expect(pane.x).toBeCloseTo(expected.x, 9);
        expect(pane.y).toBeCloseTo(expected.y, 9);
        expect(pane.z).toBeCloseTo(expected.z, 9);
        expect(pane.id).toBe(7);
        expect(pane.halfWidth).toBeCloseTo(spec.width / 2, 9);
        expect(pane.halfHeight).toBeCloseTo(spec.height / 2, 9);
      }
    }
  });

  it('gives unit, perpendicular, horizontal axes', () => {
    for (const { spec } of specs) {
      for (const rotation of [0, Math.PI / 2, Math.PI]) {
        const pane = paneToWorld(spec, 0, 0, 0, 0, rotation);
        expect(Math.hypot(pane.ux, pane.uz)).toBeCloseTo(1, 9);
        expect(Math.hypot(pane.nx, pane.nz)).toBeCloseTo(1, 9);
        expect(pane.ux * pane.nx + pane.uz * pane.nz).toBeCloseTo(0, 9);
      }
    }
  });

  it('points the normal away from the house for an outside wall, at any turn', () => {
    for (const { layout, spec } of specs) {
      // The middle of the floor's footprint stands for the house centre.
      const floor = layout.floors[0]!;
      const centre = { x: (floor.minX + floor.maxX) / 2, z: (floor.minZ + floor.maxZ) / 2 };
      for (const rotation of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const pane = paneToWorld(spec, 0, 50, 0, 50, rotation);
        const middle = houseToWorld(centre.x, 0, centre.z, 50, 0, 50, rotation);
        const away = (pane.x - middle.x) * pane.nx + (pane.z - middle.z) * pane.nz;
        expect(away, `${layout.name} pane ${spec.index} rot ${rotation}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the u axis along the wall and the normal across it after a quarter turn', () => {
    const spec = layoutPanes(HOUSE_LAYOUTS[0]!)[0]!;
    const straight = paneToWorld(spec, 0, 0, 0, 0, 0);
    const turned = paneToWorld(spec, 0, 0, 0, 0, Math.PI / 2);
    // A quarter turn swaps which world axis the wall lies along.
    expect(Math.abs(straight.ux) > 0.99).toBe(spec.run === 'x');
    expect(Math.abs(turned.ux) > 0.99).toBe(spec.run !== 'x');
    expect(Math.abs(turned.nx) > 0.99).toBe(Math.abs(straight.nx) < 0.01);
  });

  it('puts the floors at the house ground plus the local floor height', () => {
    const spec = layoutPanes(HOUSE_LAYOUTS[1]!)[0]!;
    const pane = paneToWorld(spec, 0, 0, 5, 0, 0);
    expect(pane.floorOutside).toBe(5);
    expect(pane.floorInside).toBe(5 + spec.floorInside);
  });
});

describe('rayPane', () => {
  it('hits a pane straight through its centre at the right distance', () => {
    const hit = rayPane(PANE, { x: 0, y: 1.5, z: -3 }, { x: 0, y: 0, z: 1 }, 10)!;
    expect(hit).not.toBeNull();
    expect(hit.at).toBeCloseTo(3, 9);
    expect(hit.u).toBeCloseTo(0, 9);
    expect(hit.v).toBeCloseTo(0, 9);
    expect(hit.side).toBe(1);
  });

  it('reports the u and v of an offset hit', () => {
    const hit = rayPane(PANE, { x: 0.2, y: 1.8, z: -3 }, { x: 0, y: 0, z: 1 }, 10)!;
    expect(hit.u).toBeCloseTo(0.2, 9);
    expect(hit.v).toBeCloseTo(0.3, 9);
  });

  it('gives the same u and v from the other side, with the opposite side sign', () => {
    const inside = rayPane(PANE, { x: 0.2, y: 1.8, z: -3 }, { x: 0, y: 0, z: 1 }, 10)!;
    const outside = rayPane(PANE, { x: 0.2, y: 1.8, z: 3 }, { x: 0, y: 0, z: -1 }, 10)!;
    expect(outside.u).toBeCloseTo(inside.u, 9);
    expect(outside.v).toBeCloseTo(inside.v, 9);
    expect(inside.side).toBe(1);
    expect(outside.side).toBe(-1);
  });

  it('follows the pane\'s own u axis when the pane is turned', () => {
    const turned: WorldPane = { ...PANE, ux: 0, uz: -1, nx: 1, nz: 0 };
    const hit = rayPane(turned, { x: -3, y: 1.5, z: -0.25 }, { x: 1, y: 0, z: 0 }, 10)!;
    expect(hit.u).toBeCloseTo(0.25, 9);
    expect(hit.at).toBeCloseTo(3, 9);
  });

  it('misses past the rectangle, parallel to it, stopping short, or pointing away', () => {
    expect(rayPane(PANE, { x: 0.6, y: 1.5, z: -3 }, { x: 0, y: 0, z: 1 }, 10)).toBeNull();
    expect(rayPane(PANE, { x: 0, y: 2.2, z: -3 }, { x: 0, y: 0, z: 1 }, 10)).toBeNull();
    expect(rayPane(PANE, { x: -1, y: 1.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10)).toBeNull();
    expect(rayPane(PANE, { x: 0, y: 1.5, z: -3 }, { x: 0, y: 0, z: 1 }, 2.9)).toBeNull();
    expect(rayPane(PANE, { x: 0, y: 1.5, z: -3 }, { x: 0, y: 0, z: -1 }, 10)).toBeNull();
  });

  it('hits right at the edge and not just past it', () => {
    expect(rayPane(PANE, { x: 0.5, y: 1.5, z: -3 }, { x: 0, y: 0, z: 1 }, 10)).not.toBeNull();
    expect(rayPane(PANE, { x: 0.501, y: 1.5, z: -3 }, { x: 0, y: 0, z: 1 }, 10)).toBeNull();
  });

  it('hits on a slanted ray where it crosses the plane', () => {
    const d = Math.SQRT1_2;
    const hit = rayPane(PANE, { x: -1, y: 1.5, z: -1 }, { x: d, y: 0, z: d }, 10)!;
    expect(hit.at).toBeCloseTo(Math.SQRT2, 9);
    expect(hit.u).toBeCloseTo(0, 9);
  });
});

describe('segmentCrossesPane', () => {
  it('is true for a segment through the pane and false when it ends short, misses or is zero length', () => {
    expect(segmentCrossesPane(PANE, { x: 0, y: 1.5, z: -2 }, { x: 0, y: 1.5, z: 2 })).toBe(true);
    expect(segmentCrossesPane(PANE, { x: 0, y: 1.5, z: 2 }, { x: 0, y: 1.5, z: -2 })).toBe(true);
    expect(segmentCrossesPane(PANE, { x: 0, y: 1.5, z: -2 }, { x: 0, y: 1.5, z: -0.5 })).toBe(false);
    expect(segmentCrossesPane(PANE, { x: 2, y: 1.5, z: -2 }, { x: 2, y: 1.5, z: 2 })).toBe(false);
    expect(segmentCrossesPane(PANE, { x: 0, y: 1.5, z: -2 }, { x: 0, y: 1.5, z: -2 })).toBe(false);
  });
});

describe('sweepPane', () => {
  it('stops a ball moving toward the pane one radius before the plane', () => {
    const hit = sweepPane(PANE, { x: 0, y: 1.5, z: -3 }, { x: 0, y: 1.5, z: 0 }, 0.2)!;
    expect(hit).not.toBeNull();
    const stopZ = -3 + 3 * hit.at;
    expect(stopZ).toBeCloseTo(-0.2, 9);
    expect(hit.u).toBeCloseTo(0, 9);
    expect(hit.side).toBe(1);
  });

  it('reports the opposite side from the other face', () => {
    const hit = sweepPane(PANE, { x: 0, y: 1.5, z: 3 }, { x: 0, y: 1.5, z: 0 }, 0.2)!;
    expect(hit.side).toBe(-1);
    expect(3 - 3 * hit.at).toBeCloseTo(0.2, 9);
  });

  it('does not stop a ball moving away from the pane', () => {
    expect(sweepPane(PANE, { x: 0, y: 1.5, z: -1 }, { x: 0, y: 1.5, z: -3 }, 0.2)).toBeNull();
    expect(sweepPane(PANE, { x: 0, y: 1.5, z: 0.1 }, { x: 0, y: 1.5, z: 3 }, 0.2)).toBeNull();
  });

  it('does not stop a ball passing beside the rectangle or short of it', () => {
    expect(sweepPane(PANE, { x: 2, y: 1.5, z: -3 }, { x: 2, y: 1.5, z: 0 }, 0.2)).toBeNull();
    expect(sweepPane(PANE, { x: 0, y: 4, z: -3 }, { x: 0, y: 4, z: 0 }, 0.2)).toBeNull();
    expect(sweepPane(PANE, { x: 0, y: 1.5, z: -3 }, { x: 0, y: 1.5, z: -1 }, 0.2)).toBeNull();
  });

  it('clamps a graze at the edge to the pane\'s rectangle', () => {
    const hit = sweepPane(PANE, { x: 0.55, y: 1.5, z: -3 }, { x: 0.55, y: 1.5, z: 0 }, 0.2)!;
    expect(hit).not.toBeNull();
    expect(hit.u).toBeLessThanOrEqual(PANE.halfWidth);
  });

  it('touches at once (at 0) when already within a radius of the plane', () => {
    const hit = sweepPane(PANE, { x: 0, y: 1.5, z: -0.1 }, { x: 0, y: 1.5, z: 0.5 }, 0.2)!;
    expect(hit.at).toBe(0);
  });
});

describe('parseGlassSync', () => {
  const real = (id: number) => id >= 0 && id < 100;

  it('drops anything that is not an array', () => {
    for (const bad of [null, undefined, 'x', 5, {}, { length: 1, 0: { id: 1, d: 1, b: false, h: [] } }]) {
      expect(parseGlassSync(bad, real)).toEqual([]);
    }
  });

  it('drops non-object entries, unknown panes and bad numbers', () => {
    const list = [
      null, 5, 'a', [],
      { id: 500, d: 1, b: false, h: [] },
      { id: -1, d: 1, b: false, h: [] },
      { id: 1.5, d: 1, b: false, h: [] },
      { id: '2', d: 1, b: false, h: [] },
      { id: 3, d: -1, b: false, h: [] },
      { id: 3, d: 7, b: false, h: [] },
      { id: 3, d: 1.5, b: false, h: [] },
      { id: 3, d: NaN, b: false, h: [] },
      { id: 3, d: 1, b: 'no', h: [] },
      { id: 4, d: 2, b: false, h: [] },
    ];
    expect(parseGlassSync(list, real)).toEqual([{ id: 4, d: 2, b: false, h: [] }]);
  });

  it('keeps valid entries and snaps hole coordinates to centimetres', () => {
    const entries = parseGlassSync([{ id: 7, d: 3, b: false, h: [0.123, -0.456, 0.5, 0.5] }], real);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(7);
    expect(entries[0]!.d).toBe(3);
    expect(entries[0]!.h).toHaveLength(4);
    expect(entries[0]!.h[0]).toBeCloseTo(0.12, 9);
    expect(entries[0]!.h[1]).toBeCloseTo(-0.46, 9);
  });

  it('drops oversized or non-finite holes and caps their number at MAX_HOLES', () => {
    const holes = parseGlassSync([{ id: 1, d: 2, b: false, h: [0.1, 0.1, 9, 0, 0, 9, NaN, 0, Infinity, 0, '1', 0, 0.2, 0.2] }], real)[0]!.h;
    expect(holes).toHaveLength(4);
    const many = Array.from({ length: 40 }, () => 0.1);
    expect(parseGlassSync([{ id: 1, d: 2, b: false, h: many }], real)[0]!.h).toHaveLength(MAX_HOLES * 2);
  });

  it('turns a broken entry into damage PANE_STRENGTH with no holes', () => {
    expect(parseGlassSync([{ id: 2, d: 0, b: true, h: [0.1, 0.1] }], real)).toEqual([{ id: 2, d: PANE_STRENGTH, b: true, h: [] }]);
  });

  it('keeps one entry for duplicate ids (the last)', () => {
    const entries = parseGlassSync([{ id: 2, d: 1, b: false, h: [] }, { id: 2, d: 4, b: false, h: [] }], real);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.d).toBe(4);
  });

  it('reads at most GLASS_SYNC_MAX_ENTRIES entries', () => {
    const junk = Array.from({ length: GLASS_SYNC_MAX_ENTRIES }, () => null);
    expect(parseGlassSync([...junk, { id: 1, d: 1, b: false, h: [] }], real)).toEqual([]);
  });

  it('asks the world about each id', () => {
    const asked: number[] = [];
    parseGlassSync([{ id: 3, d: 1, b: false, h: [] }, { id: 8, d: 1, b: false, h: [] }], (id) => { asked.push(id); return true; });
    expect(asked).toEqual([3, 8]);
  });
});

describe('isValidGlassHit', () => {
  it('accepts sane values', () => {
    expect(isValidGlassHit(0.2, -0.3, 1, 1)).toBe(true);
    expect(isValidGlassHit(0, 0, PANE_STRENGTH, -1)).toBe(true);
    expect(isValidGlassHit(4, -4, 3, 1)).toBe(true);
  });

  it('rejects NaN, infinite and huge coordinates', () => {
    expect(isValidGlassHit(NaN, 0, 1, 1)).toBe(false);
    expect(isValidGlassHit(0, NaN, 1, 1)).toBe(false);
    expect(isValidGlassHit(Infinity, 0, 1, 1)).toBe(false);
    expect(isValidGlassHit(1e9, 0, 1, 1)).toBe(false);
    expect(isValidGlassHit(0, -1e9, 1, 1)).toBe(false);
    expect(isValidGlassHit('0', 0, 1, 1)).toBe(false);
    expect(isValidGlassHit(undefined, 0, 1, 1)).toBe(false);
  });

  it('rejects power 0, 7, fractions and non-numbers', () => {
    expect(isValidGlassHit(0, 0, 0, 1)).toBe(false);
    expect(isValidGlassHit(0, 0, 7, 1)).toBe(false);
    expect(isValidGlassHit(0, 0, 1.5, 1)).toBe(false);
    expect(isValidGlassHit(0, 0, -1, 1)).toBe(false);
    expect(isValidGlassHit(0, 0, '1', 1)).toBe(false);
  });

  it('rejects any side but 1 and -1', () => {
    for (const side of [0, 2, -2, 0.5, '1', null, undefined]) expect(isValidGlassHit(0, 0, 1, side), String(side)).toBe(false);
  });
});
