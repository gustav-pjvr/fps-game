import { describe, expect, it } from 'vitest';
import { BUS_LEVELS, CLIP_KNEE, DUCKED_BUSES, MAX_SPATIAL_VOICES, SILENT_BELOW, dynamicsFor, softClip, type SoundBus } from './mix.ts';

const BUSES = Object.keys(BUS_LEVELS) as SoundBus[];

describe('mix buses', () => {
  it('has the six buses, each with a positive finite level', () => {
    expect([...BUSES].sort()).toEqual(['blast', 'movement', 'ui', 'voices', 'weapons', 'world']);
    for (const bus of BUSES) {
      expect(BUS_LEVELS[bus], bus).toBeGreaterThan(0);
      expect(Number.isFinite(BUS_LEVELS[bus]), bus).toBe(true);
      // These are gain-node levels set from offline measurements: boosts above 1 are expected, but
      // nothing near the soft clipper's ceiling for good.
      expect(BUS_LEVELS[bus], bus).toBeLessThan(4);
    }
  });

  it('does not duck the blast or the interface, but ducks weapons, movement, world and voices', () => {
    expect(DUCKED_BUSES.has('blast')).toBe(false);
    expect(DUCKED_BUSES.has('ui')).toBe(false);
    for (const bus of ['weapons', 'movement', 'world', 'voices'] as const) expect(DUCKED_BUSES.has(bus), bus).toBe(true);
    expect(DUCKED_BUSES.size).toBe(4);
  });

  it('keeps sane voice limits', () => {
    expect(SILENT_BELOW).toBeGreaterThan(0);
    expect(SILENT_BELOW).toBeLessThan(0.05);
    expect(MAX_SPATIAL_VOICES).toBeGreaterThan(0);
  });
});

describe('dynamicsFor', () => {
  it('compresses harder from a lower threshold at night', () => {
    const night = dynamicsFor('night'), full = dynamicsFor('full');
    expect(night.threshold).toBeLessThan(full.threshold);
    expect(night.makeup).toBeGreaterThan(0);
  });

  it('gives night mode a higher makeup gain than full range', () => {
    expect(dynamicsFor('night').makeup).toBeGreaterThan(dynamicsFor('full').makeup);
  });

  it('makes full range a limiter: a ratio of at least 10', () => {
    expect(dynamicsFor('full').ratio).toBeGreaterThanOrEqual(10);
    expect(dynamicsFor('full').makeup).toBe(1);
  });

  it('has positive times and a gentler ratio at night', () => {
    for (const range of ['full', 'night'] as const) {
      const dynamics = dynamicsFor(range);
      expect(dynamics.attack).toBeGreaterThan(0);
      expect(dynamics.release).toBeGreaterThan(dynamics.attack);
      expect(dynamics.knee).toBeGreaterThanOrEqual(0);
      expect(dynamics.ratio).toBeGreaterThan(1);
    }
    expect(dynamicsFor('night').ratio).toBeLessThan(dynamicsFor('full').ratio);
  });
});

describe('softClip', () => {
  it('leaves samples up to the knee alone, either sign', () => {
    for (const x of [0, 0.1, -0.3, CLIP_KNEE, -CLIP_KNEE]) expect(softClip(x)).toBe(x);
  });

  it('bends above the knee, never reaching 1 whatever the input', () => {
    for (const x of [0.71, 0.9, 1, 2, 10, 1e6]) {
      expect(softClip(x)).toBeGreaterThan(CLIP_KNEE);
      expect(softClip(x)).toBeLessThanOrEqual(1);
      expect(softClip(-x)).toBe(-softClip(x));
    }
  });

  it('rises with the input and is continuous at the knee', () => {
    let previous = softClip(CLIP_KNEE);
    for (const x of [0.75, 0.8, 0.9, 1, 1.3, 2]) {
      expect(softClip(x)).toBeGreaterThanOrEqual(previous);
      previous = softClip(x);
    }
    expect(Math.abs(softClip(CLIP_KNEE + 1e-9) - CLIP_KNEE)).toBeLessThan(1e-6);
  });
});
