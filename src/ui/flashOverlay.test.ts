import { describe, expect, it } from 'vitest';
import { flashOverlayOpacity, REDUCED_MOTION_WHITE_CAP } from './flashOverlay.ts';

describe('flash overlay opacity', () => {
  it('is clear with no flash', () => {
    expect(flashOverlayOpacity(0, false)).toEqual({ white: 0, afterimage: 0 });
  });

  it('whites out at the blind level, the afterimage showing through and outlasting it', () => {
    const peak = flashOverlayOpacity(1, false);
    expect(peak.white).toBeGreaterThan(0.9);
    expect(peak.afterimage).toBeGreaterThan(0);
    const fading = flashOverlayOpacity(0.25, false);
    expect(fading.white).toBeCloseTo(0.235);
    expect(fading.afterimage).toBeGreaterThan(fading.white);
  });

  it('caps the white and drops the afterimage under reduced motion', () => {
    expect(flashOverlayOpacity(1, true)).toEqual({ white: REDUCED_MOTION_WHITE_CAP, afterimage: 0 });
    expect(flashOverlayOpacity(0.5, true).white).toBe(0.5);
  });
});
