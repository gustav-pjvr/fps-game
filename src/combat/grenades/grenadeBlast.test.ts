import { describe, expect, it } from 'vitest';
import { blastReaches, CameraShake, flashCosAngle, yawViewDirection } from './grenadeBlast.ts';
import { FRAG_CHEST_OFFSET, FRAG_HEAD_OFFSET, FRAG_SHAKE_SECONDS } from './grenadeTuning.ts';
import type { Vec3 } from './grenadeFlight.ts';

const blast = { x: 0, y: 0.1, z: 0 };
const target = { x: 3, y: 1, z: 0 };

describe('frag wall check', () => {
  it('reaches a target with a clear chest ray, a clear head ray, or both', () => {
    expect(blastReaches(blast, target, () => true)).toBe(true);
    // A low wall blocks the chest ray only.
    const headOnly = (_from: Vec3, to: Vec3) => to.y > target.y + FRAG_CHEST_OFFSET + 0.01;
    expect(blastReaches(blast, target, headOnly)).toBe(true);
  });

  it('is blocked only when both rays are', () => {
    expect(blastReaches(blast, target, () => false)).toBe(false);
  });

  it('aims the rays at the chest and head heights', () => {
    const heights: number[] = [];
    blastReaches(blast, target, (_from, to) => {
      heights.push(to.y);
      return false;
    });
    expect(heights).toEqual([target.y + FRAG_CHEST_OFFSET, target.y + FRAG_HEAD_OFFSET]);
  });
});

describe('flash facing angle', () => {
  it('is 1 looking at the flash, 0 side-on, -1 with it behind', () => {
    const eye = { x: 0, y: 1.6, z: 0 };
    const view = { x: 0, y: 0, z: -1 };
    expect(flashCosAngle(eye, view, { x: 0, y: 1.6, z: -5 })).toBeCloseTo(1);
    expect(flashCosAngle(eye, view, { x: 5, y: 1.6, z: 0 })).toBeCloseTo(0);
    expect(flashCosAngle(eye, view, { x: 0, y: 1.6, z: 5 })).toBeCloseTo(-1);
    expect(flashCosAngle(eye, view, eye)).toBe(1);
  });

  it('reads an enemy yaw the way perception does (forward is sin, cos)', () => {
    const forward = yawViewDirection(Math.PI / 2);
    expect(forward.x).toBeCloseTo(1);
    expect(forward.z).toBeCloseTo(0);
  });
});

describe('CameraShake', () => {
  it('fades linearly to nothing over the shake time', () => {
    const shake = new CameraShake();
    shake.add(0.08);
    expect(shake.amplitude).toBeCloseTo(0.08);
    shake.update(FRAG_SHAKE_SECONDS / 2);
    expect(shake.amplitude).toBeCloseTo(0.04);
    shake.update(FRAG_SHAKE_SECONDS);
    expect(shake.amplitude).toBe(0);
    expect(shake.offset(1)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('keeps the stronger of two overlapping shakes', () => {
    const shake = new CameraShake();
    shake.add(0.08);
    shake.add(0.02);
    expect(shake.amplitude).toBeCloseTo(0.08);
    shake.add(0.09);
    expect(shake.amplitude).toBeCloseTo(0.09);
  });

  it('never offsets the camera further than the amplitude on any axis', () => {
    const shake = new CameraShake();
    shake.add(0.05);
    for (let t = 0; t < 2; t += 0.013) {
      const o = shake.offset(t);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(Math.abs(o.z)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });
});
