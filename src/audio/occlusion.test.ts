import { describe, expect, it } from 'vitest';
import { CLEAR, CLEAR_PATH, MAX_COUNTED_SOLIDS, loudestPath, occlusionFor, type SoundPath } from './occlusion.ts';
import { OPEN_CUTOFF } from './spatial.ts';

const path = (overrides: Partial<SoundPath>): SoundPath => ({ ...CLEAR_PATH, ...overrides });
const walls = (n: number) => occlusionFor(path({ solids: n }));

describe('occlusionFor', () => {
  it('leaves a clear path at full level and an open cutoff', () => {
    const clear = occlusionFor(CLEAR_PATH);
    expect(clear.gain).toBe(1);
    expect(clear.cutoff).toBe(OPEN_CUTOFF);
    expect(clear.blocked).toBe(0);
    expect(clear).toEqual(CLEAR);
  });

  it('makes one wall quieter and duller than clear, and each further wall more so', () => {
    expect(walls(1).gain).toBeLessThan(1);
    expect(walls(1).cutoff).toBeLessThan(OPEN_CUTOFF);
    expect(walls(2).gain).toBeLessThan(walls(1).gain);
    expect(walls(2).cutoff).toBeLessThan(walls(1).cutoff);
    expect(walls(3).gain).toBeLessThan(walls(2).gain);
    expect(walls(3).cutoff).toBeLessThan(walls(2).cutoff);
  });

  it('caps the count at MAX_COUNTED_SOLIDS', () => {
    expect(MAX_COUNTED_SOLIDS).toBe(3);
    expect(walls(4)).toEqual(walls(3));
    expect(walls(40)).toEqual(walls(3));
  });

  it('treats a negative or fractional wall count safely', () => {
    expect(walls(-2)).toEqual(CLEAR);
    expect(walls(1.9)).toEqual(walls(1));
  });

  it('makes earth heavier than three walls in the high end (lower cutoff)', () => {
    const earth = occlusionFor(path({ earth: true }));
    expect(earth.cutoff).toBeLessThan(walls(3).cutoff);
    expect(earth.gain).toBeLessThan(walls(1).gain);
    expect(earth.blocked).toBe(1);
  });

  it('makes earth quieter than three walls', () => {
    expect(occlusionFor(path({ earth: true })).gain).toBeLessThan(walls(3).gain);
  });

  it('makes one intact pane muffle less than one wall: louder and brighter', () => {
    const pane = occlusionFor(path({ glass: 1 }));
    expect(pane.gain).toBeLessThan(1);
    expect(pane.gain).toBeGreaterThan(walls(1).gain);
    expect(pane.cutoff).toBeGreaterThan(walls(1).cutoff);
  });

  it('makes two panes muffle more than one, and many panes stop at a limit', () => {
    const one = occlusionFor(path({ glass: 1 }));
    const two = occlusionFor(path({ glass: 2 }));
    expect(two.gain).toBeLessThan(one.gain);
    expect(two.cutoff).toBeLessThan(one.cutoff);
    expect(occlusionFor(path({ glass: 3 })).gain).toBeLessThan(two.gain);
    expect(occlusionFor(path({ glass: 9 }))).toEqual(occlusionFor(path({ glass: 3 })));
  });

  it('reduces a bent path only slightly', () => {
    const bent = occlusionFor(path({ bent: true }));
    expect(bent.gain).toBeGreaterThan(0.5);
    expect(bent.gain).toBeLessThan(1);
    expect(bent.cutoff).toBeLessThan(OPEN_CUTOFF);
  });

  it('orders gains: clear > bent > one pane > one wall > two walls > three walls', () => {
    const gains = [
      occlusionFor(CLEAR_PATH).gain,
      occlusionFor(path({ bent: true })).gain,
      occlusionFor(path({ glass: 1 })).gain,
      walls(1).gain,
      walls(2).gain,
      walls(3).gain,
    ];
    for (let i = 1; i < gains.length; i++) expect(gains[i]!, `step ${i}`).toBeLessThan(gains[i - 1]!);
  });

  it('puts earth at the bottom of the ordering by cutoff', () => {
    const cutoffs = [walls(1).cutoff, walls(2).cutoff, walls(3).cutoff, occlusionFor(path({ earth: true })).cutoff];
    for (let i = 1; i < cutoffs.length; i++) expect(cutoffs[i]!).toBeLessThan(cutoffs[i - 1]!);
  });

  it('combines a pane and a bend by taking the lower cutoff and the product of the gains', () => {
    const both = occlusionFor(path({ glass: 1, bent: true }));
    expect(both.gain).toBeCloseTo(occlusionFor(path({ glass: 1 })).gain * occlusionFor(path({ bent: true })).gain, 9);
    expect(both.cutoff).toBeLessThanOrEqual(Math.min(occlusionFor(path({ glass: 1 })).cutoff, occlusionFor(path({ bent: true })).cutoff));
  });

  it('reports blocked as 1 for walls and earth, between 0 and 1 for glass or a bend, 0 when clear', () => {
    expect(walls(1).blocked).toBe(1);
    expect(walls(3).blocked).toBe(1);
    expect(occlusionFor(path({ earth: true })).blocked).toBe(1);
    const glass = occlusionFor(path({ glass: 1 })).blocked;
    const bent = occlusionFor(path({ bent: true })).blocked;
    expect(glass).toBeGreaterThan(0);
    expect(glass).toBeLessThan(1);
    expect(bent).toBeGreaterThan(0);
    expect(bent).toBeLessThan(1);
    expect(occlusionFor(CLEAR_PATH).blocked).toBe(0);
  });
});

describe('loudestPath', () => {
  it('returns CLEAR_PATH for an empty list', () => {
    expect(loudestPath([])).toBe(CLEAR_PATH);
  });

  it('picks the path with the highest gain', () => {
    const wall = path({ solids: 1 });
    const pane = path({ glass: 1 });
    const bent = path({ bent: true });
    expect(loudestPath([wall, pane, bent])).toBe(bent);
    expect(loudestPath([wall, pane])).toBe(pane);
    expect(loudestPath([path({ solids: 3 }), wall])).toBe(wall);
    expect(loudestPath([wall, CLEAR_PATH, bent])).toBe(CLEAR_PATH);
  });

  it('returns the only path of a single-item list, and the first of equals', () => {
    const wall = path({ solids: 2 });
    expect(loudestPath([wall])).toBe(wall);
    const a = path({ solids: 1 }), b = path({ solids: 1 });
    expect(loudestPath([a, b])).toBe(a);
  });
});
