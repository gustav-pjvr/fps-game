import { describe, expect, it } from 'vitest';
import { meleePose, type MeleeVariant } from './meleeSwing.ts';

const VARIANTS: MeleeVariant[] = ['slashRight', 'slashLeft', 'stab', 'draw'];

describe('meleePose', () => {
  for (const variant of VARIANTS) {
    it(`${variant} recovers to exactly zero`, () => {
      expect(meleePose(1, variant)).toEqual({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 });
    });

    it(`${variant} is continuous across sampled progress and phase boundaries`, () => {
      let previous = Object.values(meleePose(0, variant));
      for (let i = 1; i <= 1000; i++) {
        const current = Object.values(meleePose(i / 1000, variant));
        current.forEach((value, axis) => {
          expect(Number.isFinite(value)).toBe(true);
          expect(Math.abs(value - previous[axis]!)).toBeLessThan(0.02);
        });
        previous = current;
      }
      for (const boundary of [0.15, 0.5, 1]) {
        const before = Object.values(meleePose(boundary - 0.000001, variant));
        Object.values(meleePose(boundary, variant)).forEach((value, axis) => {
          expect(Math.abs(value - before[axis]!)).toBeLessThan(0.0001);
        });
      }
    });
  }

  it('slashes sweep and roll in opposite directions', () => {
    const right = meleePose(0.5, 'slashRight');
    const left = meleePose(0.5, 'slashLeft');
    expect(right.px * left.px).toBeLessThan(0);
    expect(right.rz * left.rz).toBeLessThan(0);
    expect(meleePose(0.15, 'slashRight').px * right.px).toBeLessThan(0);
    expect(meleePose(0.15, 'slashLeft').px * left.px).toBeLessThan(0);
  });

  it('stab pulls back then thrusts forward along negative z', () => {
    expect(meleePose(0.15, 'stab').pz).toBeGreaterThan(0);
    expect(meleePose(0.5, 'stab').pz).toBeLessThan(0);
  });

  it('draw starts with the blade flipped about x', () => {
    expect(meleePose(0, 'draw').rx).toBe(-1.6);
    expect(meleePose(0.5, 'draw').rx).toBeGreaterThan(-1.6);
    expect(meleePose(0.5, 'draw').rx).toBeLessThan(0);
  });
});
