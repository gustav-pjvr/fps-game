import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../utils/rng.ts';
import { HEARTBEAT_THRESHOLD, heartbeatFor, musicMix, reactorHumGain, undergroundReverbScale, roomImpulse, valleyImpulse, windLevel } from './ambience.ts';

describe('musicMix', () => {
  it('keeps only a dark pad in the quiet phase', () => {
    const mix = musicMix('relax', 0.9);
    expect(mix.pulse).toBe(0);
    expect(mix.bass).toBe(0);
    expect(mix.pad).toBeGreaterThan(0);
    expect(mix.padCutoff).toBeLessThan(500);
  });

  it('brings the pulse in as a build-up intensifies, and saves the bass for the peak', () => {
    const low = musicMix('buildUp', 0.1);
    const high = musicMix('buildUp', 0.9);
    expect(high.pulse).toBeGreaterThan(low.pulse);
    expect(high.padCutoff).toBeGreaterThan(low.padCutoff);
    expect(high.bass).toBe(0);
    const peak = musicMix('peak', 0.5);
    expect(peak.bass).toBeGreaterThan(0.5);
    expect(peak.pulse).toBeGreaterThanOrEqual(high.pulse);
  });

  it('drains the pulse with intensity as the fight fades', () => {
    expect(musicMix('fade', 0).pulse).toBe(0);
    expect(musicMix('fade', 0.8).pulse).toBeGreaterThan(musicMix('fade', 0.2).pulse);
  });

  it('stays within 0 to 1 for any intensity', () => {
    for (const phase of ['relax', 'buildUp', 'peak', 'fade'] as const) {
      for (const intensity of [-1, 0, 0.5, 1, 3]) {
        const mix = musicMix(phase, intensity);
        for (const gain of [mix.pad, mix.pulse, mix.bass]) {
          expect(gain).toBeGreaterThanOrEqual(0);
          expect(gain).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('heartbeatFor', () => {
  it('is silent when healthy and when dead', () => {
    expect(heartbeatFor(1)).toBeNull();
    expect(heartbeatFor(HEARTBEAT_THRESHOLD)).toBeNull();
    expect(heartbeatFor(0)).toBeNull();
  });

  it('gets faster and louder as health falls', () => {
    const hurt = heartbeatFor(0.3)!;
    const dying = heartbeatFor(0.05)!;
    expect(dying.bpm).toBeGreaterThan(hurt.bpm);
    expect(dying.gain).toBeGreaterThan(hurt.gain);
    expect(hurt.bpm).toBeGreaterThanOrEqual(72);
    expect(dying.bpm).toBeLessThanOrEqual(118);
  });
});

describe('valleyImpulse', () => {
  const [left, right] = valleyImpulse(8000, 1.5, mulberry32(7));

  it('is silent during the pre-delay, then decays', () => {
    expect(left.length).toBe(12000);
    expect(left.slice(0, 100).every((v) => v === 0)).toBe(true);
    const energy = (data: Float32Array, from: number, to: number): number => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += data[i]! ** 2;
      return sum;
    };
    const early = energy(left, 1000, 3000);
    const late = energy(left, 9000, 11000);
    expect(late).toBeLessThan(early / 20);
    expect(Math.abs(left[left.length - 1]!)).toBeLessThan(0.01);
  });

  it('decorrelates the two channels', () => {
    let same = 0;
    for (let i = 200; i < 4000; i++) if (left[i] === right[i]) same++;
    expect(same).toBeLessThan(10);
  });

  it('never clips', () => {
    for (const data of [left, right]) for (const v of data) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });
});

describe('underground ambience', () => {
  it('scales the hall reverb up as the listener settles underground', () => {
    expect(undergroundReverbScale(0)).toBe(1);
    expect(undergroundReverbScale(0.5)).toBeCloseTo(1.3);
    expect(undergroundReverbScale(1)).toBeCloseTo(1.6);
    expect(undergroundReverbScale(-1)).toBe(1);
    expect(undergroundReverbScale(2)).toBeCloseTo(1.6);
  });

  it('keeps the reactor hum full within 4 m and silent from 22 m, including no lab', () => {
    for (const distance of [0, 2, 4]) expect(reactorHumGain(distance)).toBe(1);
    expect(reactorHumGain(13)).toBeCloseTo(0.5);
    for (const distance of [22, 50, Infinity]) expect(reactorHumGain(distance)).toBe(0);
    let previous = 1;
    for (let distance = 4; distance <= 22; distance++) {
      const gain = reactorHumGain(distance);
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(previous);
      previous = gain;
    }
  });
});

const energy = (data: Float32Array, from: number, to: number): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i]! * data[i]!;
  return sum;
};
/** Mean absolute difference between neighbouring samples: higher means more high-frequency content. */
const roughness = (data: Float32Array): number => {
  let sum = 0;
  for (let i = 1; i < data.length; i++) sum += Math.abs(data[i]! - data[i - 1]!);
  return sum / (data.length - 1);
};

describe('roomImpulse', () => {
  it('returns two channels of the right length', () => {
    const [left, right] = roomImpulse(8000, 0.5, 0.5, mulberry32(1));
    expect(left).toHaveLength(4000);
    expect(right).toHaveLength(4000);
    expect(roomImpulse(8000, 0.0001, 0.5, mulberry32(1))[0]).toHaveLength(1);
  });

  it('is deterministic for a seeded random, and the channels differ', () => {
    const a = roomImpulse(8000, 0.4, 0.6, mulberry32(7));
    const b = roomImpulse(8000, 0.4, 0.6, mulberry32(7));
    expect(Array.from(a[0])).toEqual(Array.from(b[0]));
    expect(Array.from(a[1])).toEqual(Array.from(b[1]));
    expect(Array.from(a[0])).not.toEqual(Array.from(a[1]));
    const other = roomImpulse(8000, 0.4, 0.6, mulberry32(8));
    expect(Array.from(other[0])).not.toEqual(Array.from(a[0]));
  });

  it('stays finite and under full scale', () => {
    for (const channel of roomImpulse(8000, 0.6, 1, mulberry32(3))) {
      for (const sample of channel) {
        expect(Number.isFinite(sample)).toBe(true);
        expect(Math.abs(sample)).toBeLessThan(1);
      }
    }
  });

  it('decays: the last quarter holds far less energy than the first', () => {
    for (const channel of roomImpulse(8000, 1, 0.5, mulberry32(2))) {
      const quarter = Math.floor(channel.length / 4);
      const first = energy(channel, 0, quarter);
      const last = energy(channel, channel.length - quarter, channel.length);
      expect(first).toBeGreaterThan(0);
      expect(last).toBeLessThan(first * 0.01);
    }
  });

  it('gives a brighter room more high-frequency energy than a dull one', () => {
    const bright = roomImpulse(8000, 0.5, 1, mulberry32(5))[0];
    const dull = roomImpulse(8000, 0.5, 0, mulberry32(5))[0];
    // Compare without the shared early reflections: the noise tail after 50 ms.
    expect(roughness(bright.subarray(400))).toBeGreaterThan(roughness(dull.subarray(400)));
  });
});

describe('windLevel', () => {
  it('is full outdoors on an outdoor map', () => {
    expect(windLevel(true, 'outdoor').gain).toBe(1);
  });

  it('is a lower, duller rumour inside a room', () => {
    const outdoor = windLevel(true, 'outdoor'), room = windLevel(true, 'room');
    expect(room.gain).toBeGreaterThan(0);
    expect(room.gain).toBeLessThan(outdoor.gain);
    expect(room.cutoff).toBeLessThan(outdoor.cutoff);
  });

  it('is silent in a hall and underground', () => {
    expect(windLevel(true, 'hall').gain).toBe(0);
    expect(windLevel(true, 'underground').gain).toBe(0);
  });

  it('is silent for every space when the map is not outdoor', () => {
    for (const space of ['outdoor', 'room', 'hall', 'underground'] as const) expect(windLevel(false, space).gain, space).toBe(0);
  });
});
