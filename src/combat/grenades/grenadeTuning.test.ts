import { describe, expect, it } from 'vitest';
import {
  computeFragDamage,
  FRAG_FULL_DAMAGE_RADIUS,
  FRAG_MAX_DAMAGE,
  FRAG_RADIUS,
  FRAG_SHAKE_PEAK,
  FRAG_SHAKE_RANGE,
  fragShakeAmplitude,
  isGrenadeKind,
} from './grenadeTuning.ts';

describe('frag damage falloff', () => {
  it('deals full damage out to 1.5 m', () => {
    expect(computeFragDamage(0)).toBe(FRAG_MAX_DAMAGE);
    expect(computeFragDamage(1)).toBe(FRAG_MAX_DAMAGE);
    expect(computeFragDamage(FRAG_FULL_DAMAGE_RADIUS)).toBe(FRAG_MAX_DAMAGE);
  });

  it('falls linearly to 0 at 7 m', () => {
    const midway = (FRAG_FULL_DAMAGE_RADIUS + FRAG_RADIUS) / 2;
    expect(computeFragDamage(midway)).toBeCloseTo(FRAG_MAX_DAMAGE / 2);
    expect(computeFragDamage(FRAG_RADIUS - 0.001)).toBeGreaterThan(0);
    expect(computeFragDamage(FRAG_RADIUS)).toBe(0);
    expect(computeFragDamage(30)).toBe(0);
  });

  it('never rises with distance', () => {
    let last = Infinity;
    for (let d = 0; d <= 8; d += 0.25) {
      const damage = computeFragDamage(d);
      expect(damage).toBeLessThanOrEqual(last);
      last = damage;
    }
  });

  it('treats a non-finite distance as out of range', () => {
    expect(computeFragDamage(Number.NaN)).toBe(0);
    expect(computeFragDamage(Infinity)).toBe(0);
  });
});

describe('frag camera shake falloff', () => {
  it('peaks at the blast and reaches 0 at 15 m', () => {
    expect(fragShakeAmplitude(0)).toBeCloseTo(FRAG_SHAKE_PEAK);
    expect(fragShakeAmplitude(FRAG_SHAKE_RANGE / 2)).toBeCloseTo(FRAG_SHAKE_PEAK / 2);
    expect(fragShakeAmplitude(FRAG_SHAKE_RANGE)).toBe(0);
    expect(fragShakeAmplitude(100)).toBe(0);
  });

  it('clamps a negative distance to the peak and ignores NaN', () => {
    expect(fragShakeAmplitude(-2)).toBeCloseTo(FRAG_SHAKE_PEAK);
    expect(fragShakeAmplitude(Number.NaN)).toBe(0);
  });
});

describe('grenade kind guard', () => {
  it('accepts frag and flash only', () => {
    expect(isGrenadeKind('frag')).toBe(true);
    expect(isGrenadeKind('flash')).toBe(true);
    expect(isGrenadeKind('smoke')).toBe(false);
    expect(isGrenadeKind(1)).toBe(false);
  });
});
