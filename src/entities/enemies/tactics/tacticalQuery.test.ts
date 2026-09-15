import { describe, expect, it } from 'vitest';
import { pointSegmentDistance, scoreCandidates, validateCandidates, type LosProbe, type TacticalRequest } from './tacticalQuery.ts';
import type { CoverCandidate } from './coverPoints.ts';

const flat = (): number => 0;
const nothingBlocked = (): boolean => false;

function request(overrides: Partial<TacticalRequest> = {}): TacticalRequest {
  return {
    from: { x: 0, z: 12 },
    threat: { x: 0, z: 0 },
    minRange: 5,
    maxRange: 14,
    requireCover: false,
    requireLineOfFire: true,
    preferHighGround: false,
    claimed: [],
    fireLines: [],
    ...overrides,
  };
}

const covered = (x: number, z: number, peekX = x + 1.5): CoverCandidate => ({
  cover: { x, z },
  peek: { x: peekX, z },
  source: 'trunk',
});
const open = (x: number, z: number): CoverCandidate => ({ cover: null, peek: { x, z }, source: 'open' });

describe('pointSegmentDistance', () => {
  it('measures to the nearest point of the segment, ends included', () => {
    expect(pointSegmentDistance({ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(1);
    expect(pointSegmentDistance({ x: 3, z: 0 }, { x: -1, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(2);
  });
});

describe('scoreCandidates', () => {
  it('keeps spots inside the distance band and drops those outside', () => {
    const scored = scoreCandidates(request(), [open(0, 10), open(0, 20), open(0, 3)], flat, nothingBlocked);
    expect(scored).toHaveLength(1);
    expect(scored[0]!.peek).toEqual({ x: 0, z: 10 });
  });

  it('prefers real cover over an open spot at the same place', () => {
    const scored = scoreCandidates(request(), [open(2, 10), covered(0.5, 10, 2)], flat, nothingBlocked);
    expect(scored[0]!.source).toBe('trunk');
    expect(scored[1]!.source).toBe('open');
  });

  it('drops blocked, claimed, too-far and in-the-line-of-fire spots', () => {
    const base = request({ claimed: [{ x: -3, z: 10 }], fireLines: [{ from: { x: 10, z: 10 }, to: { x: 0, z: 0 } }] });
    const isBlocked = (x: number): boolean => x > 50;
    const scored = scoreCandidates(
      base,
      [open(60, 10), open(-3, 10.5), open(6, 6), open(0, 9), open(0, 12 + 20)],
      flat,
      isBlocked,
    );
    expect(scored.map((candidate) => candidate.peek)).toEqual([{ x: 0, z: 9 }]);
  });

  it('never routes an enemy past the player', () => {
    // Both spots are in the distance band and within walking range; only the first path crosses
    // the player.
    const scored = scoreCandidates(request({ from: { x: 4, z: 4 } }), [open(-4, -4), open(4, 9)], flat, nothingBlocked);
    expect(scored.map((candidate) => candidate.peek)).toEqual([{ x: 4, z: 9 }]);
  });

  it('drops open spots when cover is required', () => {
    const scored = scoreCandidates(request({ requireCover: true }), [open(0, 10), covered(-2, 10)], flat, nothingBlocked);
    expect(scored.every((candidate) => candidate.cover !== null)).toBe(true);
    expect(scored).toHaveLength(1);
  });

  it('gives a Ridge Walker a bonus for higher ground', () => {
    const heightAt = (x: number): number => (x > 0 ? 4 : 0);
    const scored = scoreCandidates(request({ preferHighGround: true }), [open(-3, 10), open(3, 10)], heightAt, nothingBlocked);
    expect(scored[0]!.peek.x).toBe(3);
    expect(scored[0]!.score).toBeGreaterThan(scored[1]!.score);
  });
});

describe('validateCandidates', () => {
  // A pillar across x in [-1, 1] at z = 5 between the threat (origin) and everything at z > 5.
  const probe: LosProbe = (from, to) => {
    if ((from.z - 5) * (to.z - 5) > 0) return true;
    const t = (5 - from.z) / (to.z - from.z);
    const x = from.x + (to.x - from.x) * t;
    return x < -1 || x > 1;
  };
  const hidden = covered(0, 8, 2.5);
  const exposed = covered(4, 8, 5.5);

  it('picks the first spot that is really covered and really has a line of fire', () => {
    const result = validateCandidates(request(), [
      { ...exposed, score: 0.9 },
      { ...hidden, score: 0.8 },
    ], probe, flat, 1.5, 8);
    expect(result.pick?.cover).toEqual({ x: 0, z: 8 });
    expect(result.pick?.canHit).toBe(true);
    expect(result.raysUsed).toBe(3);
  });

  it('stops at the ray allowance and tries again next refresh', () => {
    const result = validateCandidates(request(), [
      { ...exposed, score: 0.9 },
      { ...hidden, score: 0.8 },
    ], probe, flat, 1.5, 1);
    expect(result.pick).toBeNull();
    expect(result.raysUsed).toBe(1);
  });

  it('spends one ray for a reserve, which only needs to hide', () => {
    const result = validateCandidates(request({ requireLineOfFire: false, requireCover: true }), [{ ...hidden, score: 1 }], probe, flat, 1.5, 8);
    expect(result.pick?.cover).toEqual({ x: 0, z: 8 });
    expect(result.pick?.canHit).toBe(false);
    expect(result.raysUsed).toBe(1);
  });

  it('rejects a peek spot that cannot see the threat', () => {
    const blindPeek = covered(0, 8, 0.5);
    const result = validateCandidates(request(), [{ ...blindPeek, score: 1 }], probe, flat, 1.5, 8);
    expect(result.pick).toBeNull();
    expect(result.raysUsed).toBe(2);
  });
});
