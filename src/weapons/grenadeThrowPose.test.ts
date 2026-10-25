import { describe, expect, it } from 'vitest';
import type { MeleePose } from './meleeSwing.ts';
import { GRENADE_ARM_HIDDEN, GRENADE_ARM_HOLD, GRENADE_LEAVES_HAND_AT, grenadeArmPose } from './grenadeThrowPose.ts';

function expectPose(actual: MeleePose, expected: MeleePose): void {
  for (const key of Object.keys(expected) as (keyof MeleePose)[]) expect(actual[key]).toBeCloseTo(expected[key], 6);
}

describe('grenade arm pose', () => {
  it('is hidden below the frame with the gun up and nothing thrown', () => {
    const arm = grenadeArmPose(0, null);
    expect(arm.visible).toBe(false);
    expectPose(arm.pose, GRENADE_ARM_HIDDEN);
  });

  it('rises into the hold as the gun lowers for a cook, grenade in hand', () => {
    const half = grenadeArmPose(0.5, null);
    expect(half.visible).toBe(true);
    expect(half.pose.py).toBeGreaterThan(GRENADE_ARM_HIDDEN.py);
    expect(half.pose.py).toBeLessThan(GRENADE_ARM_HOLD.py);
    const full = grenadeArmPose(1, null);
    expectPose(full.pose, GRENADE_ARM_HOLD);
    expect(full.holding).toBe(true);
  });

  it('swings forward from the hold, lets go early, then drops out of view', () => {
    const start = grenadeArmPose(1, 0);
    expectPose(start.pose, GRENADE_ARM_HOLD);
    expect(start.holding).toBe(true);
    const release = grenadeArmPose(1, 0.3);
    expect(release.pose.pz).toBeLessThan(GRENADE_ARM_HOLD.pz - 0.2);
    expect(grenadeArmPose(1, GRENADE_LEAVES_HAND_AT + 0.01).holding).toBe(false);
    const late = grenadeArmPose(0.2, 0.95);
    expect(late.pose.py).toBeLessThan(-0.5);
    expect(grenadeArmPose(0, 1).visible).toBe(false);
  });
});
