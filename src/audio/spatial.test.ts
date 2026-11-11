import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_DELAY_CAP, ARRIVAL_DELAY_FROM, LOUDNESS, MIN_AIR_CUTOFF, OPEN_CUTOFF, REAR_CUTOFF,
  airCutoff, arrivalDelay, distanceGain, poseFromQuaternion, rearShadowCutoff, relativeToListener, reverbSendAt,
  type ListenerPose, type LoudnessKind,
} from './spatial.ts';

const KINDS = Object.keys(LOUDNESS) as LoudnessKind[];
const NO_FLOOR = KINDS.filter((kind) => LOUDNESS[kind].floor === 0);
const WITH_FLOOR = KINDS.filter((kind) => LOUDNESS[kind].floor > 0);

describe('distanceGain', () => {
  it('is 1 inside the reference distance, for every kind', () => {
    for (const kind of KINDS) {
      const loudness = LOUDNESS[kind];
      expect(distanceGain(loudness, 0)).toBe(1);
      expect(distanceGain(loudness, loudness.refDistance * 0.5)).toBe(1);
      expect(distanceGain(loudness, loudness.refDistance)).toBe(1);
      expect(distanceGain(loudness, -5)).toBe(1);
    }
  });

  it('falls strictly beyond the reference distance', () => {
    for (const kind of KINDS) {
      const loudness = LOUDNESS[kind];
      // Stop short of the floor and of the maximum, where a flat run is expected.
      const stop = loudness.floor > 0 ? loudness.refDistance * 4 : loudness.maxDistance * 0.99;
      let previous = distanceGain(loudness, loudness.refDistance);
      for (let d = loudness.refDistance + 0.5; d < stop; d += (stop - loudness.refDistance) / 40) {
        const gain = distanceGain(loudness, d);
        expect(gain, `${kind} at ${d} m`).toBeLessThan(previous);
        previous = gain;
      }
    }
  });

  it('never drops under the floor for kinds that have one, even at 1000 m', () => {
    for (const kind of WITH_FLOOR) {
      const loudness = LOUDNESS[kind];
      for (const d of [loudness.maxDistance, loudness.maxDistance + 1, 1000, 1e6]) {
        expect(distanceGain(loudness, d), `${kind} at ${d} m`).toBeGreaterThanOrEqual(loudness.floor);
      }
      expect(distanceGain(loudness, 1000)).toBe(loudness.floor);
    }
  });

  it('is exactly 0 at and past the maximum for kinds without a floor', () => {
    for (const kind of NO_FLOOR) {
      const loudness = LOUDNESS[kind];
      expect(distanceGain(loudness, loudness.maxDistance), kind).toBe(0);
      expect(distanceGain(loudness, loudness.maxDistance + 0.01), kind).toBe(0);
      expect(distanceGain(loudness, loudness.maxDistance * 10), kind).toBe(0);
      expect(distanceGain(loudness, loudness.maxDistance - 0.5), kind).toBeGreaterThan(0);
    }
  });

  it('is continuous where the fade to silence starts', () => {
    for (const kind of NO_FLOOR) {
      const loudness = LOUDNESS[kind];
      const fadeStart = loudness.maxDistance * 0.75;
      const before = distanceGain(loudness, fadeStart - 1e-6);
      const after = distanceGain(loudness, fadeStart + 1e-6);
      expect(Math.abs(before - after), kind).toBeLessThan(1e-4);
      // And the fade itself never rises again.
      expect(distanceGain(loudness, fadeStart + 1)).toBeLessThan(before);
    }
  });

  it('keeps a gunshot at 150 m between its floor and 0.1', () => {
    const gain = distanceGain(LOUDNESS.gunshot, 150);
    expect(gain).toBeGreaterThanOrEqual(LOUDNESS.gunshot.floor);
    expect(gain).toBeLessThan(0.1);
  });
});

describe('airCutoff', () => {
  it('is wide open at 0 m and inside the reference distance', () => {
    for (const kind of KINDS) {
      expect(airCutoff(LOUDNESS[kind], 0)).toBe(OPEN_CUTOFF);
      expect(airCutoff(LOUDNESS[kind], LOUDNESS[kind].refDistance)).toBe(OPEN_CUTOFF);
    }
    expect(OPEN_CUTOFF).toBe(20000);
  });

  it('falls with distance until it reaches the minimum', () => {
    for (const kind of KINDS) {
      let previous = Infinity;
      for (const d of [0, 10, 30, 60, 100, 200]) {
        const cutoff = airCutoff(LOUDNESS[kind], d);
        expect(cutoff).toBeLessThanOrEqual(previous);
        previous = cutoff;
      }
      expect(airCutoff(LOUDNESS[kind], 40)).toBeLessThan(OPEN_CUTOFF);
    }
  });

  it('dulls a gunshot at 150 m under 2500 Hz', () => {
    expect(airCutoff(LOUDNESS.gunshot, 150)).toBeLessThan(2500);
  });

  it('never goes under MIN_AIR_CUTOFF, however far', () => {
    for (const kind of KINDS) {
      for (const d of [500, 5000, 1e6]) expect(airCutoff(LOUDNESS[kind], d)).toBeGreaterThanOrEqual(MIN_AIR_CUTOFF);
    }
    expect(airCutoff(LOUDNESS.small, 1e6)).toBe(MIN_AIR_CUTOFF);
  });
});

describe('arrivalDelay', () => {
  it('is 0 within the near range', () => {
    expect(arrivalDelay(0)).toBe(0);
    expect(arrivalDelay(10)).toBe(0);
    expect(arrivalDelay(ARRIVAL_DELAY_FROM)).toBe(0);
  });

  it('rises with distance past it, at the speed of sound', () => {
    expect(arrivalDelay(60)).toBeGreaterThan(0);
    expect(arrivalDelay(100)).toBeGreaterThan(arrivalDelay(60));
    expect(arrivalDelay(20 + 343 * 0.1)).toBeCloseTo(0.1, 6);
  });

  it('is capped at ARRIVAL_DELAY_CAP', () => {
    expect(arrivalDelay(5000)).toBe(ARRIVAL_DELAY_CAP);
    expect(arrivalDelay(1e9)).toBe(ARRIVAL_DELAY_CAP);
    for (let d = 0; d < 400; d += 7) expect(arrivalDelay(d)).toBeLessThanOrEqual(ARRIVAL_DELAY_CAP);
  });
});

describe('reverbSendAt', () => {
  it('grows as the gain falls', () => {
    expect(reverbSendAt(0.2, 0.2)).toBeGreaterThan(reverbSendAt(0.2, 0.8));
    expect(reverbSendAt(0.2, 1)).toBeCloseTo(0.2, 9);
    // The send grows up to four times with distance, so a barely ringing sound stays so.
    expect(reverbSendAt(0.2, 0)).toBeCloseTo(0.8, 9);
    expect(reverbSendAt(0.01, 0)).toBeCloseTo(0.04, 9);
    expect(reverbSendAt(0, 0)).toBe(0);
  });

  it('is clamped to 0..1 for any input', () => {
    expect(reverbSendAt(0.9, 0)).toBe(1);
    expect(reverbSendAt(-3, 1)).toBe(0);
    expect(reverbSendAt(0.3, -10)).toBeLessThanOrEqual(1);
    expect(reverbSendAt(0.3, 10)).toBeCloseTo(0.3, 9);
    for (const base of [-1, 0, 0.5, 1, 2]) {
      for (const gain of [-1, 0, 0.3, 1, 5]) {
        const send = reverbSendAt(base, gain);
        expect(send).toBeGreaterThanOrEqual(0);
        expect(send).toBeLessThanOrEqual(1);
      }
    }
  });
});

const ORIGIN = { x: 0, y: 0, z: 0 };
const FACING_MINUS_Z: ListenerPose = { position: ORIGIN, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };
const yawQuaternion = (angle: number) => ({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });

describe('relativeToListener', () => {
  it('puts a source ahead, behind, right, left, above and below on the right axis', () => {
    const ahead = relativeToListener(FACING_MINUS_Z, { x: 0, y: 0, z: -5 });
    expect(ahead.front).toBeCloseTo(1, 9);
    expect(ahead.right).toBeCloseTo(0, 9);
    expect(ahead.up).toBeCloseTo(0, 9);
    expect(ahead.distance).toBeCloseTo(5, 9);
    expect(relativeToListener(FACING_MINUS_Z, { x: 0, y: 0, z: 5 }).front).toBeCloseTo(-1, 9);
    expect(relativeToListener(FACING_MINUS_Z, { x: 3, y: 0, z: 0 }).right).toBeCloseTo(1, 9);
    expect(relativeToListener(FACING_MINUS_Z, { x: -3, y: 0, z: 0 }).right).toBeCloseTo(-1, 9);
    expect(relativeToListener(FACING_MINUS_Z, { x: 0, y: 2, z: 0 }).up).toBeCloseTo(1, 9);
    expect(relativeToListener(FACING_MINUS_Z, { x: 0, y: -2, z: 0 }).up).toBeCloseTo(-1, 9);
  });

  it('reports distance 0 for a coincident source, straight ahead', () => {
    expect(relativeToListener(FACING_MINUS_Z, ORIGIN)).toEqual({ right: 0, up: 0, front: 1, distance: 0 });
    expect(relativeToListener(FACING_MINUS_Z, { x: 1e-5, y: 0, z: 0 }).distance).toBe(0);
  });

  it('measures from the listener position, not the origin', () => {
    const pose: ListenerPose = { ...FACING_MINUS_Z, position: { x: 10, y: 5, z: 10 } };
    const rel = relativeToListener(pose, { x: 10, y: 5, z: 4 });
    expect(rel.front).toBeCloseTo(1, 9);
    expect(rel.distance).toBeCloseTo(6, 9);
  });

  it('has unit-length direction parts', () => {
    const rel = relativeToListener(FACING_MINUS_Z, { x: 3, y: -4, z: -12 });
    expect(Math.hypot(rel.right, rel.up, rel.front)).toBeCloseTo(1, 9);
    expect(rel.distance).toBeCloseTo(13, 9);
  });

  it('turns with the head: after a quarter turn what was ahead is at the side', () => {
    const turned = poseFromQuaternion(ORIGIN, yawQuaternion(Math.PI / 2));
    const wasAhead = relativeToListener(turned, { x: 0, y: 0, z: -5 });
    expect(wasAhead.front).toBeCloseTo(0, 9);
    expect(Math.abs(wasAhead.right)).toBeCloseTo(1, 9);
    // A +90 degree yaw turns the head towards -X, so -Z is on the right and -X is ahead.
    expect(wasAhead.right).toBeCloseTo(1, 9);
    expect(relativeToListener(turned, { x: -5, y: 0, z: 0 }).front).toBeCloseTo(1, 9);
    expect(relativeToListener(turned, { x: 5, y: 0, z: 0 }).front).toBeCloseTo(-1, 9);
  });
});

describe('poseFromQuaternion', () => {
  it('gives forward (0,0,-1) and up (0,1,0) for the identity', () => {
    const pose = poseFromQuaternion({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 });
    expect(pose.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(pose.forward.x).toBeCloseTo(0, 9);
    expect(pose.forward.y).toBeCloseTo(0, 9);
    expect(pose.forward.z).toBeCloseTo(-1, 9);
    expect(pose.up.x).toBeCloseTo(0, 9);
    expect(pose.up.y).toBeCloseTo(1, 9);
    expect(pose.up.z).toBeCloseTo(0, 9);
  });

  it('keeps forward and up unit and perpendicular for a tilted head', () => {
    const n = Math.hypot(0.3, 0.5, -0.2, 0.8);
    const pose = poseFromQuaternion(ORIGIN, { x: 0.3 / n, y: 0.5 / n, z: -0.2 / n, w: 0.8 / n });
    expect(Math.hypot(pose.forward.x, pose.forward.y, pose.forward.z)).toBeCloseTo(1, 9);
    expect(Math.hypot(pose.up.x, pose.up.y, pose.up.z)).toBeCloseTo(1, 9);
    expect(pose.forward.x * pose.up.x + pose.forward.y * pose.up.y + pose.forward.z * pose.up.z).toBeCloseTo(0, 9);
  });
});

describe('rearShadowCutoff', () => {
  it('is open for anything ahead or beside', () => {
    expect(rearShadowCutoff(1)).toBe(OPEN_CUTOFF);
    expect(rearShadowCutoff(0.5)).toBe(OPEN_CUTOFF);
    expect(rearShadowCutoff(0)).toBe(OPEN_CUTOFF);
  });

  it('is REAR_CUTOFF straight behind and falls monotonically towards it', () => {
    expect(rearShadowCutoff(-1)).toBeCloseTo(REAR_CUTOFF, 6);
    let previous = rearShadowCutoff(0);
    for (let front = -0.1; front >= -1.0001; front -= 0.1) {
      const cutoff = rearShadowCutoff(front);
      expect(cutoff).toBeLessThan(previous);
      expect(cutoff).toBeGreaterThanOrEqual(REAR_CUTOFF - 1e-6);
      previous = cutoff;
    }
  });

  it('does not go under REAR_CUTOFF for a front value past -1', () => {
    expect(rearShadowCutoff(-3)).toBeCloseTo(REAR_CUTOFF, 6);
  });
});
