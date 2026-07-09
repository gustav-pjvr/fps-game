import { describe, expect, it } from 'vitest';
import { computeExplosionDamage, computeKnockbackStrength } from './explosion.ts';

describe('computeExplosionDamage', () => {
  it('deals full damage at zero distance', () => {
    expect(computeExplosionDamage(0, 7, 70)).toBe(70);
  });

  it('falls off linearly with distance', () => {
    expect(computeExplosionDamage(3.5, 7, 70)).toBeCloseTo(35, 5);
  });

  it('deals no damage at the radius boundary', () => {
    expect(computeExplosionDamage(7, 7, 70)).toBe(0);
  });

  it('deals no damage beyond the radius', () => {
    expect(computeExplosionDamage(20, 7, 70)).toBe(0);
  });

  it('scales with maxDamage independently of radius', () => {
    expect(computeExplosionDamage(0, 13, 130)).toBe(130);
    expect(computeExplosionDamage(6.5, 13, 130)).toBeCloseTo(65, 5);
  });
});

describe('computeKnockbackStrength', () => {
  it('applies full strength at zero distance', () => {
    expect(computeKnockbackStrength(0, 7, 8)).toBe(8);
  });

  it('falls off linearly with distance', () => {
    expect(computeKnockbackStrength(3.5, 7, 8)).toBeCloseTo(4, 5);
  });

  it('applies no knockback at the radius boundary or beyond', () => {
    expect(computeKnockbackStrength(7, 7, 8)).toBe(0);
    expect(computeKnockbackStrength(20, 7, 8)).toBe(0);
  });
});
