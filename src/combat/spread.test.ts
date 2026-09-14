import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applySpreadCone } from './spread.ts';
import { mulberry32 } from '../utils/rng.ts';

const HALF_ANGLE = THREE.MathUtils.degToRad(6); // shotgun-scale spread
const SAMPLES = 2000;
const SEED = 1234;
const UP = new THREE.Vector3(0, 1, 0);

const HEADINGS: Record<string, THREE.Vector3> = {
  '-Z': new THREE.Vector3(0, 0, -1),
  '+X': new THREE.Vector3(1, 0, 0),
  '-X': new THREE.Vector3(-1, 0, 0),
  '+Z': new THREE.Vector3(0, 0, 1),
};

/** Deviation of `shot` from a horizontal `base`, in base's own frame (radians): horizontal is the
 * yaw offset, vertical the elevation offset. Independent of compass heading by construction. */
function deviation(base: THREE.Vector3, shot: THREE.Vector3): { horizontal: number; vertical: number } {
  const right = base.clone().cross(UP).normalize();
  return {
    horizontal: Math.atan2(shot.dot(right), shot.dot(base)),
    vertical: Math.asin(THREE.MathUtils.clamp(shot.dot(UP), -1, 1)),
  };
}

function sampleDeviations(base: THREE.Vector3): { horizontal: number; vertical: number }[] {
  const rng = mulberry32(SEED);
  const out: { horizontal: number; vertical: number }[] = [];
  for (let i = 0; i < SAMPLES; i++) out.push(deviation(base, applySpreadCone(base.clone(), HALF_ANGLE, rng)));
  return out;
}

describe('applySpreadCone', () => {
  it('spreads both horizontally and vertically in every compass heading (the flattened-shotgun bug)', () => {
    // Under the old world-Y-then-world-X rotation, facing +X/-X the vertical deviation was capped at
    // about sin(a)*sin(b) (~0.6 degrees here), a flat line instead of a 6 degree pattern.
    for (const [name, base] of Object.entries(HEADINGS)) {
      const samples = sampleDeviations(base);
      const maxVertical = Math.max(...samples.map((s) => Math.abs(s.vertical)));
      const maxHorizontal = Math.max(...samples.map((s) => Math.abs(s.horizontal)));
      expect(maxVertical, `vertical spread facing ${name}`).toBeGreaterThan(HALF_ANGLE * 0.9);
      expect(maxHorizontal, `horizontal spread facing ${name}`).toBeGreaterThan(HALF_ANGLE * 0.9);
    }
  });

  it('produces the identical deviation sequence facing -Z, +X, -X and +Z from the same rng stream', () => {
    const reference = sampleDeviations(HEADINGS['-Z']!);
    for (const name of ['+X', '-X', '+Z']) {
      const samples = sampleDeviations(HEADINGS[name]!);
      samples.forEach((s, i) => {
        expect(s.horizontal).toBeCloseTo(reference[i]!.horizontal, 9);
        expect(s.vertical).toBeCloseTo(reference[i]!.vertical, 9);
      });
    }
  });

  it('matches the old world-axis math exactly facing -Z, so the tuned feel there is unchanged', () => {
    const rngNew = mulberry32(SEED);
    const rngOld = mulberry32(SEED);
    for (let i = 0; i < 200; i++) {
      const shot = applySpreadCone(new THREE.Vector3(0, 0, -1), HALF_ANGLE, rngNew);
      const legacy = new THREE.Vector3(0, 0, -1)
        .applyAxisAngle(UP, (rngOld() - 0.5) * 2 * HALF_ANGLE)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), (rngOld() - 0.5) * 2 * HALF_ANGLE);
      expect(shot.distanceTo(legacy)).toBeLessThan(1e-12);
    }
  });

  it('draws yaw first, then pitch (rng call order unchanged)', () => {
    const draws = [1, 0.5];
    const shot = applySpreadCone(new THREE.Vector3(1, 0, 0), HALF_ANGLE, () => draws.shift()!);
    expect(draws).toHaveLength(0);
    const { horizontal, vertical } = deviation(new THREE.Vector3(1, 0, 0), shot);
    expect(Math.abs(horizontal)).toBeCloseTo(HALF_ANGLE, 9);
    expect(vertical).toBeCloseTo(0, 9);
  });

  it('stays unit length for horizontal, steeply pitched and exactly vertical shots', () => {
    const rng = mulberry32(SEED);
    const bases = [
      ...Object.values(HEADINGS),
      new THREE.Vector3(1, 3, -2).normalize(),
      new THREE.Vector3(-0.2, -5, 0.1).normalize(),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
    ];
    for (const base of bases) {
      for (let i = 0; i < 200; i++) {
        const shot = applySpreadCone(base.clone(), HALF_ANGLE, rng);
        expect(shot.length()).toBeCloseTo(1, 12);
        // Two independent rotations of at most HALF_ANGLE each can't exceed sqrt(2) * HALF_ANGLE.
        expect(shot.angleTo(base)).toBeLessThanOrEqual(Math.SQRT2 * HALF_ANGLE + 1e-9);
      }
    }
  });

  it('still spreads (via the fallback frame) when the shot points straight down', () => {
    const rng = mulberry32(SEED);
    const base = new THREE.Vector3(0, -1, 0);
    let maxAngle = 0;
    for (let i = 0; i < SAMPLES; i++) maxAngle = Math.max(maxAngle, applySpreadCone(base.clone(), HALF_ANGLE, rng).angleTo(base));
    expect(maxAngle).toBeGreaterThan(HALF_ANGLE * 0.9);
  });
});
