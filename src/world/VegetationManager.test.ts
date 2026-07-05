import { describe, expect, it } from 'vitest';
import { canopyGeometryFor } from './VegetationManager.ts';
import { PLAYER_HEIGHT, VEGETATION_SCALE_VARIANCE } from '../core/config.ts';

describe('canopyGeometryFor', () => {
  it('the canopy sensor never reaches down to where a standing player can touch it', () => {
    // The whole point of the canopy being a sensor is "bullets yes, walking no" - but this
    // confirms the geometry itself already keeps them apart, for the common case of a tree
    // standing on flat ground: the two tree types' target heights (4.5 and 6.0), across the real
    // scale-jitter range this codebase actually produces (1 +/- VEGETATION_SCALE_VARIANCE - a tree
    // outside that range never gets placed at all, so it isn't a real case to guard against).
    const worldY = 0;
    const targetHeights = [4.5, 6.0];
    const scaleJitters = [1 - VEGETATION_SCALE_VARIANCE, 1, 1 + VEGETATION_SCALE_VARIANCE];

    for (const targetHeight of targetHeights) {
      for (const scaleJitter of scaleJitters) {
        const scaledHeight = targetHeight * scaleJitter;
        const { radius, centerY } = canopyGeometryFor(worldY, scaledHeight, scaleJitter);
        const canopyLowestPoint = centerY - radius;
        expect(canopyLowestPoint, `height=${targetHeight} jitter=${scaleJitter}`).toBeGreaterThan(PLAYER_HEIGHT);
      }
    }
  });

  it('scales with the same per-instance jitter as the rest of the tree, not a fixed size', () => {
    const small = canopyGeometryFor(0, 4.5 * 0.5, 0.5);
    const large = canopyGeometryFor(0, 4.5 * 1.5, 1.5);
    expect(large.radius).toBeGreaterThan(small.radius);
    expect(large.centerY).toBeGreaterThan(small.centerY);
  });
});
