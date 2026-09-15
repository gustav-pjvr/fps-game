import { describe, expect, it } from 'vitest';
import { aimErrorDeg, createCombatState, releaseEngagementSlot, stepRangedFiring } from './enemyCombat.ts';
import { ENEMY_ARCHETYPES, type EnemyArchetype } from './archetypes.ts';
import { EngagementSlots } from './engagementSlots.ts';
import { ENEMY_VELOCITY_AIM_PENALTY_MAX_DEG } from '../../core/config.ts';

// Pins the firing behaviour the enemy AI v2 split (commit 0) moved out of Enemy.ts, so later steps
// can change when enemies fire without silently changing how accurately or how often they do.

const straggler = ENEMY_ARCHETYPES[0]!;

/** Binary-exact timings (0.25 s ticks, 0.5 s shot interval, 1 s pause) so tick counts are not at
 * the mercy of floating-point drift. */
const exactCadence: EnemyArchetype = { ...straggler, burstCount: 3, fireInterval: 0.5, burstPause: 1 };

describe('aimErrorDeg', () => {
  it('uses the widest error for the first shot after acquiring a slot, whatever the hold time or movement', () => {
    expect(aimErrorDeg(straggler, 10, true, 1)).toBe(straggler.aimErrorMaxDeg);
  });

  it('settles from the widest to the tightest error over aimSettleTime for a still player', () => {
    expect(aimErrorDeg(straggler, 0, false, 0)).toBe(straggler.aimErrorMaxDeg);
    expect(aimErrorDeg(straggler, straggler.aimSettleTime / 2, false, 0)).toBeCloseTo(
      (straggler.aimErrorMaxDeg + straggler.aimErrorMinDeg) / 2,
    );
    expect(aimErrorDeg(straggler, straggler.aimSettleTime, false, 0)).toBeCloseTo(straggler.aimErrorMinDeg);
    expect(aimErrorDeg(straggler, straggler.aimSettleTime * 5, false, 0)).toBeCloseTo(straggler.aimErrorMinDeg);
  });

  it('adds up to the movement penalty for a player at full speed', () => {
    const settled = aimErrorDeg(straggler, straggler.aimSettleTime, false, 0);
    expect(aimErrorDeg(straggler, straggler.aimSettleTime, false, 1)).toBeCloseTo(settled + ENEMY_VELOCITY_AIM_PENALTY_MAX_DEG);
    expect(aimErrorDeg(straggler, straggler.aimSettleTime, false, 0.5)).toBeCloseTo(settled + ENEMY_VELOCITY_AIM_PENALTY_MAX_DEG / 2);
  });
});

describe('stepRangedFiring', () => {
  it('fires in bursts: burstCount shots fireInterval apart, then a burstPause', () => {
    const state = createCombatState();
    const slots = new EngagementSlots(2);
    const fireTicks: number[] = [];
    for (let tick = 1; tick <= 14; tick++) {
      stepRangedFiring(state, 0.25, true, exactCadence, slots, 1, () => fireTicks.push(tick));
    }
    expect(fireTicks).toEqual([1, 3, 5, 9, 11, 13]);
  });

  it('flags only the first shot after acquiring a slot as the first shot', () => {
    const state = createCombatState();
    const slots = new EngagementSlots(2);
    const flags: boolean[] = [];
    for (let tick = 0; tick < 6; tick++) {
      stepRangedFiring(state, 0.25, true, exactCadence, slots, 1, () => {
        flags.push(state.nextShotIsFirstSinceAcquiring);
        state.nextShotIsFirstSinceAcquiring = false;
      });
    }
    expect(flags).toEqual([true, false, false]);
  });

  it('holds fire and keeps aim unsettled while every slot is taken, then fires once one frees up', () => {
    const slots = new EngagementSlots(2);
    slots.tryAcquire(101);
    slots.tryAcquire(102);
    const state = createCombatState();
    let shots = 0;
    for (let tick = 0; tick < 8; tick++) stepRangedFiring(state, 0.25, true, exactCadence, slots, 3, () => shots++);
    expect(shots).toBe(0);
    expect(state.aimHoldTimer).toBe(0);
    expect(state.hasEngagementSlot).toBe(false);

    slots.release(101);
    stepRangedFiring(state, 0.25, true, exactCadence, slots, 3, () => shots++);
    expect(shots).toBe(1);
    expect(state.hasEngagementSlot).toBe(true);
    expect(state.nextShotIsFirstSinceAcquiring).toBe(true);
  });

  it('only builds aim hold time while stationary', () => {
    const state = createCombatState();
    const slots = new EngagementSlots(2);
    stepRangedFiring(state, 0.25, true, exactCadence, slots, 1, () => {});
    stepRangedFiring(state, 0.25, true, exactCadence, slots, 1, () => {});
    expect(state.aimHoldTimer).toBe(0.5);
    stepRangedFiring(state, 0.25, false, exactCadence, slots, 1, () => {});
    expect(state.aimHoldTimer).toBe(0);
  });

  it('releaseEngagementSlot frees the slot for another enemy', () => {
    const slots = new EngagementSlots(1);
    const first = createCombatState();
    stepRangedFiring(first, 0.25, true, exactCadence, slots, 1, () => {});
    expect(slots.tryAcquire(2)).toBe(false);
    releaseEngagementSlot(first, slots, 1);
    expect(first.hasEngagementSlot).toBe(false);
    expect(slots.tryAcquire(2)).toBe(true);
  });
});
