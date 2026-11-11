import { describe, expect, it } from 'vitest';
import {
  computeFragDamage,
  FRAG_FULL_DAMAGE_RADIUS,
  FRAG_MAX_DAMAGE,
  FRAG_RADIUS,
  FRAG_KNOCKBACK_RADIUS,
  FRAG_KNOCKBACK_STRENGTH,
  FRAG_SHAKE_PEAK,
  FRAG_SHAKE_RANGE,
  fragKnockback,
  fragShakeAmplitude,
  isGrenadeKind,
} from './grenadeTuning.ts';

describe('frag damage falloff', () => {
  it('deals full damage out to the full-damage radius', () => {
    expect(computeFragDamage(0)).toBe(FRAG_MAX_DAMAGE);
    expect(computeFragDamage(1)).toBe(FRAG_MAX_DAMAGE);
    expect(computeFragDamage(FRAG_FULL_DAMAGE_RADIUS)).toBe(FRAG_MAX_DAMAGE);
  });

  it('falls with the square of the radius left, to 0 at the edge', () => {
    const midway = (FRAG_FULL_DAMAGE_RADIUS + FRAG_RADIUS) / 2;
    expect(computeFragDamage(midway)).toBeCloseTo(FRAG_MAX_DAMAGE / 4);
    expect(computeFragDamage(FRAG_RADIUS - 0.001)).toBeGreaterThan(0);
    expect(computeFragDamage(FRAG_RADIUS)).toBe(0);
    expect(computeFragDamage(30)).toBe(0);
  });

  it('kills a 100 health body in the open out to about 3.5 m and takes about half at 5 m', () => {
    expect(computeFragDamage(3.4)).toBeGreaterThanOrEqual(100);
    expect(computeFragDamage(3.9)).toBeLessThan(100);
    expect(computeFragDamage(5)).toBeGreaterThan(40);
    expect(computeFragDamage(5)).toBeLessThan(60);
    expect(computeFragDamage(8)).toBeLessThan(5);
  });

  it('never rises with distance', () => {
    let last = Infinity;
    for (let d = 0; d <= 10; d += 0.25) {
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

describe('frag knockback falloff', () => {
  it('is strongest at the blast and gone at its radius, short of the fragments', () => {
    expect(fragKnockback(0)).toBe(FRAG_KNOCKBACK_STRENGTH);
    expect(fragKnockback(FRAG_KNOCKBACK_RADIUS / 2)).toBeCloseTo(FRAG_KNOCKBACK_STRENGTH / 2);
    expect(fragKnockback(FRAG_KNOCKBACK_RADIUS)).toBe(0);
    expect(fragKnockback(Number.NaN)).toBe(0);
    expect(FRAG_KNOCKBACK_RADIUS).toBeLessThan(FRAG_RADIUS);
  });
});

describe('frag camera shake falloff', () => {
  it('peaks at the blast and reaches 0 at its range', () => {
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
