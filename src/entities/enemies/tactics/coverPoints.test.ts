import { describe, expect, it } from 'vitest';
import { circleCoverCandidates, houseCoverCandidates, openCandidates } from './coverPoints.ts';
import { pointSegmentDistance } from './tacticalQuery.ts';
import { isPointNearFootprint, type HouseFootprint } from '../../../world/houseFootprint.ts';
import { mulberry32 } from '../../../utils/rng.ts';
import { ENEMY_COVER_MARGIN, ENEMY_RADIUS, ENEMY_TACTICAL_OPEN_RADII, ENEMY_TACTICAL_OPEN_SAMPLES } from '../../../core/config.ts';

const STAND_OFF = ENEMY_RADIUS + ENEMY_COVER_MARGIN;

/** True if the straight line from a to b passes through the footprint (sampled every 10 cm). */
function lineCrossesFootprint(a: { x: number; z: number }, b: { x: number; z: number }, footprint: HouseFootprint): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (isPointNearFootprint(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, footprint, 0)) return true;
  }
  return false;
}

describe('circle (trunk and tower) cover', () => {
  const threat = { x: 0, z: 0 };
  const radius = 0.35;
  const candidates = circleCoverCandidates(0, 10, radius, threat, 'trunk');

  it('hides directly behind the obstacle as seen from the threat', () => {
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(candidate.cover?.x).toBeCloseTo(0);
      expect(candidate.cover?.z).toBeCloseTo(10 + radius + STAND_OFF);
      expect(pointSegmentDistance({ x: 0, z: 10 }, threat, candidate.cover!)).toBeCloseTo(0);
    }
  });

  it('peeks out either side, far enough that the line to the threat clears the obstacle', () => {
    const sides = candidates.map((candidate) => Math.sign(candidate.peek.x));
    expect(sides.sort()).toEqual([-1, 1]);
    for (const candidate of candidates) {
      expect(pointSegmentDistance({ x: 0, z: 10 }, threat, candidate.peek)).toBeGreaterThan(radius);
    }
  });

  it('gives nothing when the threat stands on the obstacle', () => {
    expect(circleCoverCandidates(0, 0, 1, threat, 'tower')).toHaveLength(0);
  });
});

describe('house corner cover', () => {
  it('only uses the walls that face away from the threat, and every spot is outside the house', () => {
    const footprint: HouseFootprint = { originX: 0, originZ: 0, offsetX: 0, offsetZ: 0, halfWidth: 4, halfDepth: 3, rotationY: 0 };
    const threat = { x: 30, z: 0 };
    const candidates = houseCoverCandidates(footprint, threat);
    // Only the far (-x) wall is hidden, reached from its two corners.
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(candidate.cover!.x).toBeLessThan(-4);
      expect(isPointNearFootprint(candidate.cover!.x, candidate.cover!.z, footprint, ENEMY_RADIUS)).toBe(false);
      expect(isPointNearFootprint(candidate.peek.x, candidate.peek.z, footprint, ENEMY_RADIUS)).toBe(false);
      expect(lineCrossesFootprint(threat, candidate.cover!, footprint)).toBe(true);
    }
  });

  it('works for a rotated, off-centre house: every spot outside it, and real cover among them', () => {
    const footprint: HouseFootprint = { originX: 12, originZ: -7, offsetX: 1, offsetZ: -0.5, halfWidth: 5, halfDepth: 3.5, rotationY: 0.9 };
    const threat = { x: -20, z: 15 };
    const candidates = houseCoverCandidates(footprint, threat);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(isPointNearFootprint(candidate.cover!.x, candidate.cover!.z, footprint, ENEMY_RADIUS)).toBe(false);
      expect(isPointNearFootprint(candidate.peek.x, candidate.peek.z, footprint, ENEMY_RADIUS)).toBe(false);
    }
    // Seen at an angle, a spot near a corner can still be in view - that is what the confirming ray
    // (tacticalQuery.validateCandidates) is for - but the geometry must offer real cover.
    expect(candidates.some((candidate) => lineCrossesFootprint(threat, candidate.cover!, footprint))).toBe(true);
  });
});

describe('open spots', () => {
  it('rings the enemy at the configured radii, reproducibly for a seed', () => {
    const from = { x: 5, z: -3 };
    const a = openCandidates(from, mulberry32(3));
    const b = openCandidates(from, mulberry32(3));
    expect(a).toHaveLength(ENEMY_TACTICAL_OPEN_RADII.length * ENEMY_TACTICAL_OPEN_SAMPLES);
    expect(a).toEqual(b);
    const radii = new Set(a.map((candidate) => Math.round(Math.hypot(candidate.peek.x - from.x, candidate.peek.z - from.z))));
    expect([...radii].sort((x, y) => x - y)).toEqual([...ENEMY_TACTICAL_OPEN_RADII]);
    expect(a.every((candidate) => candidate.cover === null && candidate.source === 'open')).toBe(true);
  });
});
