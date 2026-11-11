import { describe, expect, it } from 'vitest';
import { blastDistance, blastExposure, CameraShake, flashCosAngle, yawViewDirection } from './grenadeBlast.ts';
import { FRAG_SHAKE_SECONDS } from './grenadeTuning.ts';
import type { Vec3 } from './grenadeFlight.ts';

const blast = { x: 0, y: 0.1, z: 0 };
/** A body 1.8 m tall standing on y = 0, 3 m away. */
const target = { center: { x: 3, y: 0.9, z: 0 }, height: 1.8 };

describe('how much of a body a frag sees', () => {
  it('sees all of a body in the open and none of one fully behind cover', () => {
    expect(blastExposure(blast, target, () => true)).toBeCloseTo(1);
    expect(blastExposure(blast, target, () => false)).toBe(0);
  });

  it('looks at the legs, the chest and the head', () => {
    const heights: number[] = [];
    blastExposure(blast, target, (_from, to) => {
      heights.push(to.y);
      return false;
    });
    expect(heights.map((y) => Math.round(y * 100) / 100)).toEqual([0.4, 1.12, 1.66]);
  });

  it('a low wall leaves the head, a higher one hides the chest too', () => {
    // A wall 0.8 m high hides the legs: three quarters of the body still shows.
    const overLowWall = (_from: Vec3, to: Vec3): boolean => to.y > 0.8;
    expect(blastExposure(blast, target, overLowWall)).toBeCloseTo(0.75);
    // One 1.4 m high leaves the head alone.
    const overHighWall = (_from: Vec3, to: Vec3): boolean => to.y > 1.4;
    expect(blastExposure(blast, target, overHighWall)).toBeCloseTo(0.25);
  });
});

describe('how far a frag is from a body', () => {
  it('measures to the nearest point of the body, not its middle', () => {
    // On the ground beside the feet: the legs are 3 m off, though the chest is further.
    expect(blastDistance(blast, target)).toBeCloseTo(Math.hypot(3, 0.05), 2);
    // Level with the chest: straight across.
    expect(blastDistance({ x: 0, y: 1.2, z: 0 }, target)).toBeCloseTo(3);
    // Right under the feet of a body standing on it.
    expect(blastDistance({ x: 3, y: 0.1, z: 0 }, target)).toBeLessThan(0.1);
    // High above the head: to the top of the middle line.
    expect(blastDistance({ x: 3, y: 4, z: 0 }, target)).toBeCloseTo(4 - 1.65);
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
