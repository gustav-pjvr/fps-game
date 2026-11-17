import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MAX_DELAY_MS,
  MAX_EXTRAPOLATION_MS,
  TELEPORT_MIN_DISTANCE,
  MIN_DELAY_MS,
  RemoteMotion,
  STALL_HOLD_MS,
} from './remoteMotion.ts';

const SPEED = 5; // m/s along x
const SEND_MS = 1000 / 30;
const CLOCK_OFFSET = 500; // receive clock minus sender clock, ms
const TICK_MS = 4;

interface Arrival {
  sentAt: number;
  receivedAt: number;
}

/** Deterministic pseudo random in [0, 1). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** One snapshot per SEND_MS for `durationMs`, each arriving after `delayOf(i)` (kept in order). */
function arrivals(durationMs: number, delayOf: (i: number) => number): Arrival[] {
  const out: Arrival[] = [];
  let lastReceived = -Infinity;
  for (let i = 0; i * SEND_MS <= durationMs; i++) {
    const sentAt = i * SEND_MS;
    const receivedAt = Math.max(lastReceived + 0.01, sentAt + CLOCK_OFFSET + delayOf(i));
    lastReceived = receivedAt;
    out.push({ sentAt, receivedAt });
  }
  return out;
}

/** Element at `i` (negative counts from the end); throws when absent, so tests need no non-null assertions. */
function at<T>(items: readonly T[], i: number): T {
  const item = items[i < 0 ? items.length + i : i];
  if (item === undefined) throw new Error(`no element at ${i}`);
  return item;
}

const xAt = (sentAt: number): number => (SPEED * sentAt) / 1000;

interface Frame {
  now: number;
  x: number;
  delay: number;
}

/** Plays arrivals into a motion, rendering every TICK_MS of local time between `from` and `to`. */
function play(motion: RemoteMotion, list: Arrival[], from: number, to: number): Frame[] {
  const frames: Frame[] = [];
  const out = new THREE.Vector3();
  let next = 0;
  for (let now = from; now <= to; now += TICK_MS) {
    while (next < list.length && at(list, next).receivedAt <= now) {
      const a = at(list, next++);
      motion.push(xAt(a.sentAt), 0, 0, a.sentAt, a.receivedAt);
    }
    motion.predict(now, out);
    frames.push({ now, x: out.x, delay: motion.delay });
  }
  return frames;
}

describe('RemoteMotion with steady 30 Hz input', () => {
  it('moves smoothly and monotonically at the delayed time', () => {
    const motion = new RemoteMotion(0, 0, 0);
    const frames = play(motion, arrivals(4000, () => 0), CLOCK_OFFSET, CLOCK_OFFSET + 4000);
    const settled = frames.filter((f) => f.now > CLOCK_OFFSET + 1500);
    for (let i = 1; i < settled.length; i++) {
      const step = at(settled, i).x - at(settled, i - 1).x;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual((SPEED * TICK_MS * 1.1) / 1000);
    }
    for (const f of settled) {
      expect(f.x).toBeCloseTo((SPEED * (f.now - CLOCK_OFFSET - f.delay)) / 1000, 2);
    }
    expect(motion.renderStalls).toBe(0);
  });

  it('returns the constructor position before any samples arrive', () => {
    const motion = new RemoteMotion(1, 2, 3);
    expect(motion.predict(1000, new THREE.Vector3()).toArray()).toEqual([1, 2, 3]);
  });

  it('interpolates y and z as well', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 1000);
    motion.push(0.1, 2, 0.4, 40, 1040);
    motion.push(0.2, 4, 0.8, 80, 1080);
    // Default delay is 100 ms, so 1120 renders local time 1020: halfway between the first two samples.
    const out = motion.predict(1120, new THREE.Vector3());
    expect(out.x).toBeCloseTo(0.05, 3);
    expect(out.y).toBeCloseTo(1, 3);
    expect(out.z).toBeCloseTo(0.2, 3);
  });
});

describe('RemoteMotion with jittered arrivals', () => {
  it('never steps backwards or jumps beyond the speed implied', () => {
    const random = lcg(12345);
    const motion = new RemoteMotion(0, 0, 0);
    const frames = play(motion, arrivals(8000, () => random() * 80), CLOCK_OFFSET, CLOCK_OFFSET + 8000);
    const settled = frames.filter((f) => f.now > CLOCK_OFFSET + 2000);
    // Extrapolation continues at the same speed, so a step is never more than ~5% off the true speed.
    const maxStep = (SPEED * TICK_MS * 1.25) / 1000;
    for (let i = 1; i < settled.length; i++) {
      const step = at(settled, i).x - at(settled, i - 1).x;
      expect(step).toBeGreaterThanOrEqual(-1e-9);
      expect(step).toBeLessThanOrEqual(maxStep);
    }
  });

  it('keeps the delay within bounds', () => {
    const random = lcg(99);
    const motion = new RemoteMotion(0, 0, 0);
    const frames = play(motion, arrivals(6000, () => random() * 80), CLOCK_OFFSET, CLOCK_OFFSET + 6000);
    for (const f of frames) {
      expect(f.delay).toBeGreaterThanOrEqual(MIN_DELAY_MS);
      expect(f.delay).toBeLessThanOrEqual(MAX_DELAY_MS);
    }
  });
});

describe('RemoteMotion delay adaptation', () => {
  it('sits near the minimum for steady input and grows with the spread of gaps', () => {
    const steady = new RemoteMotion(0, 0, 0);
    const steadyFrames = play(steady, arrivals(5000, () => 0), CLOCK_OFFSET, CLOCK_OFFSET + 5000);
    const steadyDelay = at(steadyFrames, -1).delay;
    expect(steadyDelay).toBeLessThan(65);

    const random = lcg(7);
    const rough = new RemoteMotion(0, 0, 0);
    const roughFrames = play(rough, arrivals(12000, () => random() * 120), CLOCK_OFFSET, CLOCK_OFFSET + 12000);
    expect(at(roughFrames, -1).delay).toBeGreaterThan(steadyDelay + 30);
  });

  it('changes slowly: the render clock never runs more than 5% fast or slow', () => {
    const random = lcg(3);
    const motion = new RemoteMotion(0, 0, 0);
    const frames = play(motion, arrivals(8000, (i) => (i > 100 ? random() * 120 : 0)), CLOCK_OFFSET, CLOCK_OFFSET + 8000);
    for (let i = 1; i < frames.length; i++) {
      const renderStep = at(frames, i).now - at(frames, i).delay - (at(frames, i - 1).now - at(frames, i - 1).delay);
      expect(renderStep).toBeGreaterThanOrEqual(TICK_MS * 0.95 - 1e-6);
      expect(renderStep).toBeLessThanOrEqual(TICK_MS * 1.05 + 1e-6);
    }
  });
});

describe('RemoteMotion gaps', () => {
  it('extrapolates at most MAX_EXTRAPOLATION_MS across a 300 ms gap, then holds, and counts one stall', () => {
    const motion = new RemoteMotion(0, 0, 0);
    const list = arrivals(3000, () => 0);
    play(motion, list, CLOCK_OFFSET, CLOCK_OFFSET + 3000);
    const last = at(list, -1);
    const lastX = xAt(last.sentAt);
    const out = new THREE.Vector3();
    const base = last.receivedAt;
    let previousX = -Infinity;
    for (let now = base; now <= base + 300; now += TICK_MS) {
      motion.predict(now, out);
      expect(out.x).toBeGreaterThanOrEqual(previousX);
      expect(out.x).toBeLessThanOrEqual(lastX + (SPEED * MAX_EXTRAPOLATION_MS) / 1000 + 1e-6);
      previousX = out.x;
    }
    expect(out.x).toBeCloseTo(lastX + (SPEED * MAX_EXTRAPOLATION_MS) / 1000, 2);
    expect(motion.renderStalls).toBe(1);
    // Still dry: the same stall is not counted again.
    motion.predict(base + 1000, out);
    expect(motion.renderStalls).toBe(1);
  });

  it('a gap shorter than the hold limit is not a stall', () => {
    const motion = new RemoteMotion(0, 0, 0);
    const list = arrivals(3000, () => 0);
    play(motion, list, CLOCK_OFFSET, CLOCK_OFFSET + 3000);
    const base = at(list, -1).receivedAt;
    const out = new THREE.Vector3();
    for (let now = base; now <= base + motion.delay + STALL_HOLD_MS - 5; now += TICK_MS) motion.predict(now, out);
    expect(motion.renderStalls).toBe(0);
  });

  it('counts a second stall after the buffer refilled', () => {
    const motion = new RemoteMotion(0, 0, 0);
    const list = arrivals(2000, () => 0);
    play(motion, list, CLOCK_OFFSET, CLOCK_OFFSET + 2000);
    const out = new THREE.Vector3();
    const base = at(list, -1).receivedAt;
    motion.predict(base + 400, out);
    expect(motion.renderStalls).toBe(1);
    // Samples resume (sender kept sending but they were all delayed): feed three, render within them.
    const resumeSent = at(list, -1).sentAt + 600;
    for (let k = 0; k < 6; k++) {
      const sentAt = resumeSent + k * SEND_MS;
      motion.push(xAt(sentAt), 0, 0, sentAt, base + 500 + k * SEND_MS);
    }
    motion.predict(base + 500 + 5 * SEND_MS + 1, out);
    motion.predict(base + 1500, out);
    expect(motion.renderStalls).toBe(2);
  });
});

describe('RemoteMotion ordering and clocks', () => {
  it('ignores a sample older than the newest one', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 1000);
    motion.push(1, 0, 0, 100, 1100);
    motion.push(2, 0, 0, 200, 1200);
    expect(motion.push(-50, 0, 0, 150, 1210)).toBe(false);
    expect(motion.push(2, 0, 0, 200, 1215)).toBe(false);
    const out = new THREE.Vector3();
    // Delay 100: 1250 renders sender time 150 (local 1150): halfway between x=1 and x=2.
    expect(motion.predict(1250, out).x).toBeCloseTo(1.5, 5);
  });

  it('works without sentAtMs, on receive times', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, undefined, 1000);
    motion.push(1, 0, 0, undefined, 1100);
    motion.push(2, 0, 0, undefined, 1200);
    const out = new THREE.Vector3();
    expect(motion.predict(1250, out).x).toBeCloseTo(1.5, 5);
    expect(motion.push(1.5, 0, 0, undefined, 1150)).toBe(false);
    expect(motion.predict(1250, out).x).toBeCloseTo(1.5, 5);
  });

  it('copes with samples where only some carry sentAtMs', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 1000);
    motion.push(1, 0, 0, undefined, 1100);
    motion.push(2, 0, 0, 200, 1200);
    const out = new THREE.Vector3();
    const x = motion.predict(1250, out).x;
    expect(x).toBeGreaterThan(0.9);
    expect(x).toBeLessThan(2.1);
  });
});

describe('RemoteMotion teleports, resets and deaths', () => {
  it('reports a jump no one could run as a teleport, and ordinary running or a long gap as not', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 0);
    expect(motion.push(0.17, 0, 0, 33, 33)).toBe(false); // 5 m/s
    expect(motion.push(40, 0, 0, 66, 66)).toBe(true); // respawn across the map
    expect(motion.push(45, 0, 0, 1066, 1066)).toBe(false); // 5 m over a 1 s gap
    expect(motion.push(45.5, 0, 0, 1070, 1070)).toBe(false); // fast but under 2 m: a correction
  });

  it('a teleport clears the buffer so the avatar snaps instead of interpolating across the map', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 1000);
    motion.push(0.17, 0, 0, 33, 1033);
    motion.push(0.34, 0, 0, 66, 1066);
    const x = 0.34 + TELEPORT_MIN_DISTANCE + 1; // far over MAX_PREDICT_SPEED in 33 ms
    expect(motion.push(x, 0, 0, 99, 1099)).toBe(true);
    const out = new THREE.Vector3();
    for (const now of [1100, 1150, 1199]) expect(motion.predict(now, out).x).toBeCloseTo(x, 5);
  });

  it('uses combined horizontal speed to detect teleports', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 1000);
    expect(motion.push(1.5, 0, 1.5, 33, 1033)).toBe(true);
  });

  it('reset drops the buffer and shows the given position', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 1000);
    motion.push(0.5, 0, 0, 100, 1100);
    motion.reset(10, 2, 3);
    expect(motion.predict(1150, new THREE.Vector3()).toArray()).toEqual([10, 2, 3]);
    motion.push(11, 4, 5, 200, 1200);
    expect(motion.predict(1250, new THREE.Vector3()).toArray()).toEqual([11, 4, 5]);
  });

  it('stop() holds the last real position and counts no stall', () => {
    const motion = new RemoteMotion(0, 0, 0);
    motion.push(0, 0, 0, 0, 1000);
    motion.push(0.17, 0, 0, 33, 1033);
    motion.push(0.34, 0, 0, 66, 1066);
    motion.stop();
    const out = new THREE.Vector3();
    for (const now of [1070, 1200, 5000]) expect(motion.predict(now, out).x).toBeCloseTo(0.34, 5);
    expect(motion.renderStalls).toBe(0);
  });
});
