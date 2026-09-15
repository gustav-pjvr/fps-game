import { describe, expect, it } from 'vitest';
import { findPick, requestFor, revalidatePick, type PickPlan, type PlannerWorld } from './planner.ts';
import { ObstacleRegistry } from './obstacleRegistry.ts';
import { pointSegmentDistance, type LosProbe } from './tacticalQuery.ts';
import { mulberry32 } from '../../../utils/rng.ts';

const TRUNK = { x: 2, z: 8, radius: 0.35 };
/** Blocked only where the straight line passes through the trunk. */
const trunkProbe: LosProbe = (from, to) => pointSegmentDistance(TRUNK, from, to) > TRUNK.radius;

function world(withTrunk: boolean): PlannerWorld {
  const obstacles = new ObstacleRegistry();
  if (withTrunk) obstacles.add('c', { kind: 'trunk', ...TRUNK });
  return { obstacles, towers: [], isBlocked: () => false, heightAt: () => 0, probe: trunkProbe };
}

function plan(overrides: Partial<PickPlan> = {}): PickPlan {
  return {
    from: { x: 0, z: 10 },
    threat: { x: 0, z: 0 },
    threatEyeY: 1.6,
    rangedRange: 16,
    role: 'shooter',
    preferHighGround: false,
    claimed: [],
    fireLines: [],
    ...overrides,
  };
}

describe('requestFor', () => {
  it("sets the distance band from the enemy's own weapon range", () => {
    expect(requestFor(plan()).minRange).toBeCloseTo(5.6);
    expect(requestFor(plan()).maxRange).toBeCloseTo(14.4);
    expect(requestFor(plan({ rangedRange: 30 })).minRange).toBeCloseTo(10.5);
    expect(requestFor(plan({ rangedRange: 30 })).maxRange).toBeCloseTo(27);
  });

  it('never lets the band start nearer than the minimum range', () => {
    expect(requestFor(plan({ rangedRange: 8 })).minRange).toBe(4);
  });
});

describe('findPick', () => {
  it('sends a shooter behind the nearby trunk, with a peek spot that can hit', () => {
    const result = findPick(plan(), world(true), mulberry32(1), 8);
    expect(result.pick?.source).toBe('trunk');
    expect(result.pick?.cover?.x).toBeCloseTo(2.267, 2);
    expect(result.pick?.cover?.z).toBeCloseTo(9.067, 2);
    expect(result.pick?.canHit).toBe(true);
  });

  it('settles for an open firing spot when there is no cover', () => {
    const result = findPick(plan(), world(false), mulberry32(1), 8);
    expect(result.pick?.source).toBe('open');
    expect(result.pick?.cover).toBeNull();
  });

  it('never gives a reserve an open spot', () => {
    expect(findPick(plan({ role: 'reserve' }), world(false), mulberry32(1), 8).pick).toBeNull();
  });
});

describe('revalidatePick', () => {
  const held = findPick(plan(), world(true), mulberry32(1), 8).pick!;

  it('keeps a spot that is still covered and can still hit', () => {
    expect(revalidatePick(held, plan(), world(true), 8)).toEqual({ valid: true, raysUsed: 2 });
  });

  it('drops a spot once the player has moved round to see it', () => {
    const check = revalidatePick(held, plan({ threat: { x: 8, z: 9.07 } }), world(true), 8);
    expect(check.valid).toBe(false);
  });

  it('drops a spot outside the distance band without spending rays', () => {
    expect(revalidatePick(held, plan({ threat: { x: 0, z: -20 } }), world(true), 8)).toEqual({ valid: false, raysUsed: 0 });
  });

  it('keeps the spot unchecked when there are too few rays to check it', () => {
    expect(revalidatePick(held, plan(), world(true), 1)).toEqual({ valid: true, raysUsed: 0 });
  });
});
