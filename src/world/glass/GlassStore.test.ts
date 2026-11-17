import { describe, expect, it, vi } from 'vitest';
import { GlassStore } from './GlassStore.ts';
import { INTACT, PANE_STRENGTH, BREAK_POWER, type HitOutcome, type PaneState, type WorldPane } from './glassPane.ts';

/** A pane 1 m wide, 1.2 m tall, centred 1.5 m up, facing +Z, standing at (x, 1.5, z). */
const pane = (id: number, x = 0, z = 0): WorldPane => ({
  id, x, y: 1.5, z, ux: 1, uz: 0, nx: 0, nz: 1, halfWidth: 0.5, halfHeight: 0.6, floorInside: 0, floorOutside: 0,
});
const FORWARD = { x: 0, y: 0, z: 1 };

interface Call { id: number; pane: WorldPane | null; state: PaneState; outcome: HitOutcome; side: 1 | -1 | 0 }
function listening(store: GlassStore): Call[] {
  const calls: Call[] = [];
  store.setListener((id, p, state, outcome, side) => calls.push({ id, pane: p, state, outcome, side }));
  return calls;
}

describe('GlassStore rays', () => {
  it('finds intact panes nearest first', () => {
    const store = new GlassStore();
    store.addPanes([pane(1, 0, 4), pane(2, 0, 0), pane(3, 0, 2)]);
    const hits = store.rayHits({ x: 0, y: 1.5, z: -5 }, FORWARD, 20);
    expect(hits.map((h) => h.pane.id)).toEqual([2, 3, 1]);
    expect(hits[0]!.at).toBeCloseTo(5, 9);
  });

  it('skips broken panes and panes the ray misses or stops short of', () => {
    const store = new GlassStore();
    store.addPanes([pane(1, 0, 0), pane(2, 0, 2), pane(3, 5, 4)]);
    store.hit(1, 0, 0, BREAK_POWER, 1);
    const hits = store.rayHits({ x: 0, y: 1.5, z: -5 }, FORWARD, 20);
    expect(hits.map((h) => h.pane.id)).toEqual([2]);
    expect(store.rayHits({ x: 0, y: 1.5, z: -5 }, FORWARD, 6)).toEqual([]);
  });

  it('counts only intact panes on a segment', () => {
    const store = new GlassStore();
    store.addPanes([pane(1, 0, 0), pane(2, 0, 2), pane(3, 0, 4)]);
    const from = { x: 0, y: 1.5, z: -1 }, to = { x: 0, y: 1.5, z: 6 };
    expect(store.intactBetween(from, to)).toBe(3);
    store.hit(2, 0, 0, BREAK_POWER, 1);
    expect(store.intactBetween(from, to)).toBe(2);
    expect(store.intactBetween(from, { x: 0, y: 1.5, z: 3 })).toBe(1);
    expect(store.intactBetween({ x: 3, y: 1.5, z: -1 }, { x: 3, y: 1.5, z: 6 })).toBe(0);
  });

  it('sweeps to the nearest intact pane', () => {
    const store = new GlassStore();
    store.addPanes([pane(1, 0, 0), pane(2, 0, 2)]);
    const hit = store.sweep({ x: 0, y: 1.5, z: -3 }, { x: 0, y: 1.5, z: 5 }, 0.2)!;
    expect(hit.pane.id).toBe(1);
    store.hit(1, 0, 0, BREAK_POWER, 1);
    expect(store.sweep({ x: 0, y: 1.5, z: -3 }, { x: 0, y: 1.5, z: 5 }, 0.2)!.pane.id).toBe(2);
    store.hit(2, 0, 0, BREAK_POWER, 1);
    expect(store.sweep({ x: 0, y: 1.5, z: -3 }, { x: 0, y: 1.5, z: 5 }, 0.2)).toBeNull();
  });

  it('finds intact panes near a point within the radius', () => {
    const store = new GlassStore();
    store.addPanes([pane(1, 0, 0), pane(2, 10, 0)]);
    expect(store.intactNear({ x: 0, y: 1.5, z: 3 }, 4).map((p) => p.id)).toEqual([1]);
    expect(store.intactNear({ x: 0, y: 1.5, z: 3 }, 2)).toEqual([]);
    expect(store.intactNear({ x: 5, y: 1.5, z: 0 }, 6).map((p) => p.id).sort()).toEqual([1, 2]);
    store.hit(1, 0, 0, BREAK_POWER, 1);
    expect(store.intactNear({ x: 0, y: 1.5, z: 3 }, 4)).toEqual([]);
  });
});

describe('GlassStore hits', () => {
  it('changes the state, bumps the revision and tells the listener with the outcome and side', () => {
    const store = new GlassStore();
    store.addPanes([pane(1)]);
    const calls = listening(store);
    expect(store.revision).toBe(0);
    expect(store.hit(1, 0.1, 0.2, 1, 1)).toBe('cracked');
    expect(store.revision).toBe(1);
    expect(store.stateOf(1)).toMatchObject({ damage: 1, broken: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 1, outcome: 'cracked', side: 1 });
    expect(calls[0]!.pane!.id).toBe(1);
    expect(store.hit(1, 0, 0, BREAK_POWER, -1)).toBe('broke');
    expect(store.revision).toBe(2);
    expect(calls[1]).toMatchObject({ outcome: 'broke', side: -1 });
    expect(store.stateOf(1).broken).toBe(true);
  });

  it('does nothing, and bumps nothing, for a hit on a broken pane or with no power', () => {
    const store = new GlassStore();
    store.addPanes([pane(1)]);
    store.hit(1, 0, 0, BREAK_POWER, 1);
    const calls = listening(store);
    const revision = store.revision;
    expect(store.hit(1, 0, 0, 3, 1)).toBe('none');
    expect(store.hit(2, 0, 0, 0, 1)).toBe('none');
    expect(store.revision).toBe(revision);
    expect(calls).toEqual([]);
  });

  it('applies a hit on a pane that is not streamed in, telling the listener with a null pane', () => {
    const store = new GlassStore();
    const calls = listening(store);
    expect(store.hit(77, 0, 0, 2, -1)).toBe('cracked');
    expect(store.stateOf(77).damage).toBe(2);
    expect(store.revision).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.pane).toBeNull();
    expect(store.pane(77)).toBeNull();
  });

  it('reports intact state for a pane never hit', () => {
    expect(new GlassStore().stateOf(5)).toBe(INTACT);
  });
});

describe('GlassStore streaming', () => {
  it('tells the listener a pane\'s state when it is added, quietly', () => {
    const store = new GlassStore();
    const calls = listening(store);
    store.addPanes([pane(1), pane(2)]);
    expect(calls.map((c) => [c.id, c.outcome, c.side])).toEqual([[1, 'none', 0], [2, 'none', 0]]);
    expect(store.streamedCount).toBe(2);
  });

  it('keeps the state when panes are removed and replays it when they are added again', () => {
    const store = new GlassStore();
    store.addPanes([pane(1), pane(2)]);
    store.hit(1, 0.25, 0.1, BREAK_POWER, 1);
    store.hit(2, 0.25, 0.1, 2, 1);
    const calls = listening(store);
    store.removePanes([1, 2]);
    expect(store.streamedCount).toBe(0);
    expect(store.pane(1)).toBeNull();
    // Their state stays.
    expect(store.stateOf(1).broken).toBe(true);
    expect(store.stateOf(2).damage).toBe(2);
    expect(calls.map((c) => [c.id, c.pane])).toEqual([[1, null], [2, null]]);
    // Streaming back in replays the state to the view.
    calls.length = 0;
    store.addPanes([pane(1), pane(2)]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.state.broken).toBe(true);
    expect(calls[1]!.state.damage).toBe(2);
    expect(calls[1]!.state.holes).toEqual([0.25, 0.1]);
    expect(store.revision).toBe(2);
  });

  it('ignores removing a pane that is not streamed in', () => {
    const store = new GlassStore();
    const calls = listening(store);
    store.removePanes([1, 2]);
    expect(calls).toEqual([]);
  });

  it('works with no listener', () => {
    const store = new GlassStore();
    store.setListener(null);
    store.addPanes([pane(1)]);
    expect(store.hit(1, 0, 0, 1, 1)).toBe('cracked');
    store.merge([{ id: 1, d: 4, b: false, h: [] }]);
    store.removePanes([1]);
    expect(store.stateOf(1).damage).toBe(4);
  });
});

describe('GlassStore debris', () => {
  const broken = (): GlassStore => {
    const store = new GlassStore();
    store.addPanes([{ ...pane(1, 0, 0), floorInside: 0, floorOutside: -0.5 }]);
    store.hit(1, 0, 0, BREAK_POWER, 1);
    return store;
  };

  it('is true next to a broken pane at floor height, on either side', () => {
    const store = broken();
    expect(store.debrisUnderfoot(0, 0, -0.5)).toBe(true);
    expect(store.debrisUnderfoot(0.3, 0.1, -0.9)).toBe(true);
    // Outside the window the floor is the outside ground.
    expect(store.debrisUnderfoot(0, -0.5, 0.5)).toBe(true);
    expect(store.debrisUnderfoot(0, 0, 0.5)).toBe(true);
  });

  it('is false for an intact pane', () => {
    const store = new GlassStore();
    store.addPanes([pane(1)]);
    expect(store.debrisUnderfoot(0, 0, -0.5)).toBe(false);
    store.hit(1, 0, 0, 1, 1);
    expect(store.debrisUnderfoot(0, 0, -0.5)).toBe(false);
  });

  it('is false far from the pane, off its width, or at another floor height', () => {
    const store = broken();
    expect(store.debrisUnderfoot(0, 0, -3)).toBe(false);
    expect(store.debrisUnderfoot(3, 0, -0.5)).toBe(false);
    expect(store.debrisUnderfoot(0, 3, -0.5)).toBe(false);
    expect(store.debrisUnderfoot(0, 0, 3)).toBe(false);
  });

  it('is false for a broken pane whose house is not streamed in', () => {
    const store = broken();
    store.removePanes([1]);
    expect(store.debrisUnderfoot(0, 0, -0.5)).toBe(false);
  });
});

describe('GlassStore snapshot and merge', () => {
  it('lists only hit panes', () => {
    const store = new GlassStore();
    store.addPanes([pane(1), pane(2), pane(3)]);
    expect(store.snapshot()).toEqual([]);
    store.hit(2, 0.1, 0.1, 1, 1);
    expect(store.snapshot()).toEqual([{ id: 2, d: 1, b: false, h: [expect.closeTo(0.1, 9), expect.closeTo(0.1, 9)] }]);
  });

  it('reproduces broken and cracked panes on another store', () => {
    const a = new GlassStore();
    a.addPanes([pane(1), pane(2), pane(3)]);
    a.hit(1, 0, 0, BREAK_POWER, 1);
    a.hit(2, 0.2, -0.1, 2, 1);
    const b = new GlassStore();
    b.addPanes([pane(1), pane(2), pane(3)]);
    const calls = listening(b);
    b.merge(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.stateOf(1)).toEqual({ damage: PANE_STRENGTH, broken: true, holes: [] });
    expect(b.stateOf(2).damage).toBe(2);
    expect(b.stateOf(2).broken).toBe(false);
    expect(b.stateOf(2).holes).toEqual(a.stateOf(2).holes);
    expect(b.stateOf(3)).toBe(INTACT);
    expect(b.revision).toBe(2);
    // Quietly: no burst, no sound.
    expect(calls.map((c) => [c.outcome, c.side])).toEqual([['none', 0], ['none', 0]]);
    // The merged pane no longer takes rays.
    expect(b.rayHits({ x: 0, y: 1.5, z: -3 }, FORWARD, 10).map((h) => h.pane.id)).toEqual([2, 3]);
  });

  it('changes nothing, and does not bump the revision, for a less damaged state', () => {
    const store = new GlassStore();
    store.addPanes([pane(1), pane(2)]);
    store.hit(1, 0, 0, 4, 1);
    store.hit(2, 0, 0, BREAK_POWER, 1);
    const revision = store.revision;
    const calls = listening(store);
    store.merge([
      { id: 1, d: 2, b: false, h: [0, 0] },
      { id: 1, d: 4, b: false, h: [0.5, 0.5] },
      { id: 2, d: 3, b: false, h: [] },
      { id: 9, d: 0, b: false, h: [] },
    ]);
    expect(store.revision).toBe(revision);
    expect(calls).toEqual([]);
    expect(store.stateOf(1).damage).toBe(4);
    expect(store.stateOf(2).broken).toBe(true);
  });

  it('is idempotent: merging the same snapshot twice bumps only once', () => {
    const a = new GlassStore();
    a.hit(1, 0, 0, 3, 1);
    const b = new GlassStore();
    b.merge(a.snapshot());
    const revision = b.revision;
    b.merge(a.snapshot());
    expect(b.revision).toBe(revision);
  });

  it('tells a store with a streamed-in pane about the merge with the pane', () => {
    const store = new GlassStore();
    store.addPanes([pane(4)]);
    const listener = vi.fn();
    store.setListener(listener);
    store.merge([{ id: 4, d: 3, b: false, h: [] }]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![1]).toMatchObject({ id: 4 });
  });
});
