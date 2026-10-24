import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MAX_LEAD_SECONDS, MAX_PREDICT_SPEED, RemoteMotion, STALE_MS } from './remoteMotion.ts';

function moving(): RemoteMotion {
  const motion = new RemoteMotion(0, 0, 0);
  motion.push(0, 0, 0, 0, 1000);
  motion.push(0.5, 0, 0, 100, 1100);
  return motion;
}

describe('RemoteMotion', () => {
  it('predicts a player moving at 5 m/s ahead using smoothed speed times lead', () => {
    const motion = moving();
    motion.setLeadSeconds(0.03);
    const out = new THREE.Vector3();
    expect(motion.predict(1120, out)).toBe(out);
    expect(out.x).toBeCloseTo(0.5 + 2.5 * 0.05);
    motion.push(1, 0, 0, 200, 1200);
    expect(motion.predict(1220, out).x).toBeCloseTo(1 + 3.75 * 0.05);
  });

  it('caps total lead at MAX_LEAD_SECONDS', () => {
    const motion = moving();
    motion.setLeadSeconds(0.1);
    expect(motion.predict(1200, new THREE.Vector3()).x).toBeCloseTo(0.5 + 2.5 * MAX_LEAD_SECONDS);
  });

  it('clamps extra network lead to zero through MAX_LEAD_SECONDS', () => {
    const motion = moving();
    motion.setLeadSeconds(-1);
    expect(motion.predict(1100, new THREE.Vector3()).x).toBe(0.5);
    motion.setLeadSeconds(1);
    expect(motion.predict(1100, new THREE.Vector3()).x).toBeCloseTo(0.5 + 2.5 * MAX_LEAD_SECONDS);
  });

  it('returns the last real position after STALE_MS of silence', () => {
    const motion = moving();
    motion.setLeadSeconds(0.05);
    expect(motion.predict(1100 + STALE_MS, new THREE.Vector3()).x).toBeGreaterThan(0.5);
    expect(motion.predict(1101 + STALE_MS, new THREE.Vector3()).toArray()).toEqual([0.5, 0, 0]);
  });

  it('clears velocity for a jump over MAX_PREDICT_SPEED', () => {
    const motion = moving();
    const x = 0.5 + (MAX_PREDICT_SPEED + 1) * 0.1;
    motion.push(x, 0, 0, 200, 1200);
    expect(motion.predict(1250, new THREE.Vector3()).toArray()).toEqual([x, 0, 0]);
  });

  it('uses combined horizontal speed to detect teleports', () => {
    const motion = moving();
    motion.push(2, 0, 1.5, 200, 1200);
    expect(motion.predict(1250, new THREE.Vector3()).toArray()).toEqual([2, 0, 1.5]);
  });

  it('reset clears velocity and the previous sample', () => {
    const motion = moving();
    motion.reset(10, 2, 3);
    expect(motion.predict(1150, new THREE.Vector3()).toArray()).toEqual([10, 2, 3]);
    motion.push(11, 4, 5, 200, 1200);
    expect(motion.predict(1250, new THREE.Vector3()).toArray()).toEqual([11, 4, 5]);
  });

  it('predicts z but never predicts y', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 1000);
    motion.push(0, 100, 0.5, 100, 1100);
    const predicted = motion.predict(1150, new THREE.Vector3());
    expect(predicted.y).toBe(100);
    expect(predicted.z).toBeCloseTo(0.5 + 2.5 * 0.05);
  });

  it('uses receive times when either sample lacks sentAtMs', () => {
    for (const times of [[undefined, undefined], [0, undefined], [undefined, 100]] as const) {
      const motion = new RemoteMotion(0, 0, 0);
      motion.push(0, 0, 0, times[0], 1000);
      motion.push(0.5, 0, 0, times[1], 1100);
      expect(motion.predict(1150, new THREE.Vector3()).x).toBeCloseTo(0.5 + 2.5 * 0.05);
    }
  });

  it('prefers sender times over jittered receive times', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 1000);
    motion.push(0.5, 0, 0, 100, 1200);
    expect(motion.predict(1250, new THREE.Vector3()).x).toBeCloseTo(0.5 + 2.5 * 0.05);
  });

  it('clears velocity for sample intervals above 250 ms', () => {
    for (const dtMs of [251, 400]) {
      const motion = moving();
      motion.push(0.51, 0, 0, 100 + dtMs, 1100 + dtMs);
      expect(motion.predict(1150 + dtMs, new THREE.Vector3()).x).toBe(0.51);
    }
  });

  it('allows sample intervals of exactly 5 ms and 250 ms', () => {
    for (const dtMs of [5, 250]) {
      const motion = new RemoteMotion(0, 0, 0);
      motion.push(0, 0, 0, 0, 1000);
      const x = 5 * dtMs / 1000;
      motion.push(x, 0, 0, dtMs, 1000 + dtMs);
      expect(motion.predict(1050 + dtMs, new THREE.Vector3()).x).toBeCloseTo(x + 2.5 * 0.05);
    }
  });

  it('returns the constructor position before any samples arrive', () => {
    const motion = new RemoteMotion(1, 2, 3);
    expect(motion.predict(1000, new THREE.Vector3()).toArray()).toEqual([1, 2, 3]);
  });
});

describe('RemoteMotion teleports and deaths', () => {
  it('reports a jump no one could run as a teleport, and ordinary running or a long gap as not', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 0);
    expect(motion.push(0.17, 0, 0, 33, 33)).toBe(false); // 5 m/s
    expect(motion.push(40, 0, 0, 66, 66)).toBe(true); // respawn across the map
    expect(motion.push(45, 0, 0, 1066, 1066)).toBe(false); // 5 m over a 1 s gap
    expect(motion.push(45.5, 0, 0, 1070, 1070)).toBe(false); // fast but under 2 m: a correction
  });

  it('stop() keeps a dying player at their last snapshot', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 0);
    motion.push(0.17, 0, 0, 33, 33);
    motion.stop();
    const out = motion.predict(100, new THREE.Vector3());
    expect(out.x).toBeCloseTo(0.17);
  });
});

describe('RemoteMotion on a coarse sender clock', () => {
  it('a sample under 5 ms after the last keeps the speed estimate instead of zeroing it', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 0);
    motion.push(0.17, 0, 0, 33, 33);
    motion.push(0.34, 0, 0, 33.01, 66);
    const out = motion.predict(66, new THREE.Vector3());
    motion.setLeadSeconds(0.1);
    expect(motion.predict(66, out).x).toBeGreaterThan(0.34);
  });
});
