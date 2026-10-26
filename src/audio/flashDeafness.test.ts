import { describe, expect, it } from 'vitest';
import { DEAF_CUTOFF_CLOSED, DEAF_CUTOFF_OPEN, flashDeafness, RING_PEAK_GAIN } from './flashDeafness.ts';

describe('flash deafness', () => {
  it('is transparent and silent with no flash', () => {
    expect(flashDeafness(0)).toEqual({ cutoff: DEAF_CUTOFF_OPEN, ringGain: 0 });
    expect(flashDeafness(Number.NaN)).toEqual({ cutoff: DEAF_CUTOFF_OPEN, ringGain: 0 });
  });

  it('closes the muffle and raises the ring with the blind level', () => {
    const full = flashDeafness(1);
    expect(full.cutoff).toBeCloseTo(DEAF_CUTOFF_CLOSED);
    expect(full.ringGain).toBeCloseTo(RING_PEAK_GAIN);
    const half = flashDeafness(0.5);
    expect(half.cutoff).toBeLessThan(DEAF_CUTOFF_OPEN);
    expect(half.cutoff).toBeGreaterThan(DEAF_CUTOFF_CLOSED);
    expect(half.ringGain).toBeCloseTo(RING_PEAK_GAIN / 2);
    expect(flashDeafness(2)).toEqual(full);
  });
});
