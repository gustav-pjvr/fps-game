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

/** The effective tree threshold is exactly 0 (density tuning, see pickType's docstring), so any
 * rawNoise above -1 is "tree density". Bushes and rocks therefore get their own scatter roll FIRST,
 * independent of density: previously the roll only ran after the tree check failed, which at a zero
 * threshold was effectively never, so no bush or rock ever spawned (2026-09-14 fix). Note:
 * CODE_REVIEW.md's Phase 6 checklist asks for "pickType continuity at membership 0," a leftover from
 * a design (blending tree density by zone membership) that no longer exists in the source. */
describe('pickType', () => {
  it('returns a real tree type when the scatter roll misses and density is above the threshold', () => {
    for (const rawNoise of [-0.999, -0.5, 0, 0.3, 0.999, 1]) {
      const type = pickType(rawNoise, () => 0.99); // past the bush and rock bands
      expect(TREE_TYPES).toContain(type);
    }
  });

  it('spawns bushes and rocks at ANY density, from their own independent roll', () => {
    for (const rawNoise of [-0.5, 0, 0.3, 0.999]) {
      expect(pickType(rawNoise, () => 0)).toBe('bush');
      expect(pickType(rawNoise, () => VEGETATION_BUSH_PROBABILITY + 0.001)).toBe('rock');
    }
  });

  it('is a deterministic pure function of its inputs - same rawNoise/rng draw yields the same result', () => {
    const rng = () => 0.5;
    expect(pickType(0.2, rng)).toBe(pickType(0.2, rng));
  });

  it('places nothing when the scatter roll misses and density is at the zero threshold', () => {
    expect(pickType(-1, () => VEGETATION_BUSH_PROBABILITY + VEGETATION_ROCK_PROBABILITY + 0.001)).toBeNull();
  });

  it('keeps the configured clutter share: roughly bush + rock probability of all candidates', () => {
    let seed = 12345;
    const rng = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const samples = 20000;
    let clutter = 0;
    for (let i = 0; i < samples; i++) {
      const type = pickType(0.2, rng);
      if (type === 'bush' || type === 'rock') clutter++;
    }
    expect(clutter / samples).toBeCloseTo(VEGETATION_BUSH_PROBABILITY + VEGETATION_ROCK_PROBABILITY, 1);
  });
});
