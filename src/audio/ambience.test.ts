import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../utils/rng.ts';
import { HEARTBEAT_THRESHOLD, heartbeatFor, musicMix, outdoorAmbienceGain, reactorHumGain, reverbSendFor, undergroundReverbScale, valleyImpulse } from './ambience.ts';

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

describe('reverbSendFor', () => {
  it('sends distant sounds to the reverb more than close ones', () => {
    expect(reverbSendFor(0.2, 0.2)).toBeGreaterThan(reverbSendFor(1, 0.2));
    expect(reverbSendFor(1, 0.2)).toBeCloseTo(0.2);
    expect(reverbSendFor(0, 0.9)).toBe(1);
  });
});

describe('underground ambience', () => {
  it('fades the outdoor wind and valley layers with the eased underground amount', () => {
    expect(outdoorAmbienceGain(0)).toBe(1);
    expect(outdoorAmbienceGain(0.5)).toBe(0.5);
    expect(outdoorAmbienceGain(1)).toBe(0);
    expect(outdoorAmbienceGain(-1)).toBe(1);
    expect(outdoorAmbienceGain(2)).toBe(0);
  });

  it('scales the existing reverb send up as the outdoor layers fade', () => {
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
