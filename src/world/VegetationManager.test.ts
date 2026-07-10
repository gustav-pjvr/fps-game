import { describe, expect, it } from 'vitest';
import { canopyGeometryFor, pickType } from './VegetationManager.ts';
import { PLAYER_HEIGHT, VEGETATION_BUSH_PROBABILITY, VEGETATION_ROCK_PROBABILITY, VEGETATION_SCALE_VARIANCE } from '../core/config.ts';

// Mirrors VegetationManager.ts's own private TREE_TYPES list - kept here as a literal (not
// imported) since it's intentionally not part of the module's public surface.
const TREE_TYPES = ['treeDefault', 'treePine'];

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

/** pickType's own docstring records that this codebase's density tuning ("remove forest spawn and
 * generation restrictions") landed the effective tree threshold at exactly 0 - so density > 0 (i.e.
 * any rawNoise strictly greater than -1) always returns a tree, and the bush/rock scatter roll only
 * ever runs at the single boundary point rawNoise === -1 (density === 0 exactly). These tests lock
 * in that actual current behavior. Note: CODE_REVIEW.md's Phase 6 checklist asks for "pickType
 * continuity at membership 0," a leftover from a design (blending tree density by zone membership)
 * that predates this flat-threshold refactor and no longer exists in the source - membership isn't
 * a parameter of pickType at all anymore, so that specific invariant no longer applies. */
describe('pickType', () => {
  it('always returns a real tree type once density is above the (currently zero) threshold', () => {
    for (const rawNoise of [-0.999, -0.5, 0, 0.3, 0.999, 1]) {
      const type = pickType(rawNoise, () => 0.99); // rng should never even be consulted on this path
      expect(TREE_TYPES).toContain(type);
    }
  });

  it('is a deterministic pure function of its inputs - same rawNoise/rng draw yields the same result', () => {
    const rng = () => 0.5;
    expect(pickType(0.2, rng)).toBe(pickType(0.2, rng));
  });

  it('falls through to the bush/rock scatter roll only at the exact density-zero boundary (rawNoise = -1)', () => {
    const bushRoll = pickType(-1, () => 0); // 0 < VEGETATION_BUSH_PROBABILITY
    expect(bushRoll).toBe('bush');

    const rockRoll = pickType(-1, () => VEGETATION_BUSH_PROBABILITY + 0.001); // past bush, still within rock band
    expect(rockRoll).toBe('rock');

    const nothingRoll = pickType(-1, () => VEGETATION_BUSH_PROBABILITY + VEGETATION_ROCK_PROBABILITY + 0.001);
    expect(nothingRoll).toBeNull();
  });
});
