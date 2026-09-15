import { describe, expect, it } from 'vitest';
import { awarenessLevel, hearingRangeFor, isInViewCone, stepAwareness, viewHalfAngleDeg, visibilityFactor } from './perception.ts';
import { ENEMY_ARCHETYPES } from './archetypes.ts';
import {
  ENEMY_AWARENESS_DRAIN_TIME,
  ENEMY_AWARENESS_FAR_FACTOR,
  ENEMY_AWARENESS_FILL_TIME,
  ENEMY_AWARENESS_MOVEMENT_BONUS,
  ENEMY_AWARENESS_SUSPICIOUS,
  ENEMY_HEARING_RANGE,
  ENEMY_PERIPHERAL_RANGE,
  ENEMY_RING_BASE_RADIUS,
  ENEMY_VIEW_HALF_ANGLE_FAR_DEG,
  ENEMY_VIEW_HALF_ANGLE_NEAR_DEG,
} from '../../core/config.ts';

const TICK = 1 / 60;

describe('view cone', () => {
  it('is a full circle inside peripheral range and narrows steadily with distance', () => {
    expect(viewHalfAngleDeg(ENEMY_PERIPHERAL_RANGE, 18)).toBe(180);
    let previous = Infinity;
    for (let distance = ENEMY_PERIPHERAL_RANGE + 0.5; distance <= 18; distance += 0.5) {
      const angle = viewHalfAngleDeg(distance, 18);
      expect(angle).toBeLessThanOrEqual(previous);
      expect(angle).toBeLessThanOrEqual(ENEMY_VIEW_HALF_ANGLE_NEAR_DEG);
      previous = angle;
    }
    expect(viewHalfAngleDeg(18, 18)).toBeCloseTo(ENEMY_VIEW_HALF_ANGLE_FAR_DEG);
  });

  it('sees straight ahead, not behind, except up close', () => {
    // Yaw 0 faces +z (the mesh convention: rotation.y = atan2(dx, dz)).
    const enemy = { x: 0, z: 0 };
    expect(isInViewCone(enemy, 0, { x: 0, z: 10 }, 18)).toBe(true);
    expect(isInViewCone(enemy, 0, { x: 0, z: -10 }, 18)).toBe(false);
    expect(isInViewCone(enemy, 0, { x: 10, z: 0 }, 18)).toBe(false);
    expect(isInViewCone(enemy, 0, { x: 0, z: -2 }, 18)).toBe(true);
    expect(isInViewCone(enemy, Math.PI / 2, { x: 10, z: 0 }, 18)).toBe(true);
  });
});

describe('visibility factor', () => {
  it('is full strength to half of detection range and falls to the far factor at detection range', () => {
    expect(visibilityFactor(4, 18, 0)).toBe(1);
    expect(visibilityFactor(9, 18, 0)).toBe(1);
    expect(visibilityFactor(18, 18, 0)).toBeCloseTo(ENEMY_AWARENESS_FAR_FACTOR);
  });

  it('is zero beyond detection range', () => {
    expect(visibilityFactor(18.01, 18, 1)).toBe(0);
  });

  it('never lets any archetype notice a player on the enemy spawn ring (the match-start invariant)', () => {
    for (const archetype of ENEMY_ARCHETYPES) {
      expect(archetype.detectionRange).toBeLessThan(ENEMY_RING_BASE_RADIUS);
      expect(visibilityFactor(ENEMY_RING_BASE_RADIUS, archetype.detectionRange, 1)).toBe(0);
    }
  });

  it('rewards a still player and punishes a sprinting one', () => {
    expect(visibilityFactor(5, 18, 1)).toBeCloseTo(1 + ENEMY_AWARENESS_MOVEMENT_BONUS);
  });
});

describe('awareness meter', () => {
  it('fills from nothing to detected in ENEMY_AWARENESS_FILL_TIME at full visibility', () => {
    let awareness = 0;
    let ticks = 0;
    while (awareness < 1 && ticks < 10000) {
      awareness = stepAwareness(awareness, 1, TICK);
      ticks++;
    }
    expect(ticks * TICK).toBeCloseTo(ENEMY_AWARENESS_FILL_TIME, 1);
    expect(awarenessLevel(awareness)).toBe('detected');
  });

  it('takes longer at the edge of detection range', () => {
    let awareness = 0;
    let ticks = 0;
    while (awareness < 1 && ticks < 10000) {
      awareness = stepAwareness(awareness, visibilityFactor(18, 18, 0), TICK);
      ticks++;
    }
    expect(ticks * TICK).toBeCloseTo(ENEMY_AWARENESS_FILL_TIME / ENEMY_AWARENESS_FAR_FACTOR, 1);
  });

  it('drains over ENEMY_AWARENESS_DRAIN_TIME once the player is out of sight, never below zero', () => {
    expect(stepAwareness(1, 0, ENEMY_AWARENESS_DRAIN_TIME / 2)).toBeCloseTo(0.5);
    expect(stepAwareness(0.1, 0, ENEMY_AWARENESS_DRAIN_TIME)).toBe(0);
  });

  it('reads oblivious, suspicious and detected at the right thresholds', () => {
    expect(awarenessLevel(0)).toBe('oblivious');
    expect(awarenessLevel(ENEMY_AWARENESS_SUSPICIOUS - 0.01)).toBe('oblivious');
    expect(awarenessLevel(ENEMY_AWARENESS_SUSPICIOUS)).toBe('suspicious');
    expect(awarenessLevel(0.99)).toBe('suspicious');
    expect(awarenessLevel(1)).toBe('detected');
  });
});

describe('hearing', () => {
  it('hears louder weapons from farther away', () => {
    expect(hearingRangeFor('pistol')).toBeLessThan(hearingRangeFor('rifle'));
    expect(hearingRangeFor('rifle')).toBeLessThan(hearingRangeFor('sniper'));
    expect(hearingRangeFor('rifle')).toBe(ENEMY_HEARING_RANGE);
    expect(hearingRangeFor('knife')).toBe(0);
  });

  it('falls back to the default hearing range for an unknown or missing weapon', () => {
    expect(hearingRangeFor('railgun')).toBe(ENEMY_HEARING_RANGE);
    expect(hearingRangeFor(undefined)).toBe(ENEMY_HEARING_RANGE);
  });
});
