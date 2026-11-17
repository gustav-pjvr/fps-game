import { describe, expect, it } from 'vitest';
import { REVIVE_RULES, ReviveTracker } from './reviveRules.ts';

const here = { x: 0, z: 0 };
const near = () => ({ x: 1, z: 1 });
const far = () => ({ x: 30, z: 0 });

describe('ReviveTracker', () => {
  it('offers a fallen teammate in reach and none out of reach', () => {
    const tracker = new ReviveTracker();
    tracker.fall(2);
    expect(tracker.update(0.1, here, near, false)).toEqual({ target: 2, progress: 0, completed: null });
    expect(tracker.update(0.1, here, far, false).target).toBeNull();
  });

  it('completes a revive only after the whole hold, and restarts a hold that was let go', () => {
    const tracker = new ReviveTracker();
    tracker.fall(1);
    expect(tracker.update(REVIVE_RULES.hold - 0.5, here, near, true).completed).toBeNull();
    // Letting go loses the progress.
    expect(tracker.update(0.1, here, near, false).progress).toBe(0);
    expect(tracker.update(REVIVE_RULES.hold - 0.5, here, near, true).completed).toBeNull();
    expect(tracker.update(0.6, here, near, true).completed).toBe(1);
  });

  it('stops offering a teammate who has bled out, but still lists it as fallen', () => {
    const tracker = new ReviveTracker();
    tracker.fall(3);
    tracker.update(REVIVE_RULES.bleedOut + 1, here, far, false);
    expect(tracker.bleedLeft(3)).toBe(0);
    expect(tracker.isFallen(3)).toBe(true);
    expect(tracker.update(0.1, here, near, true).target).toBeNull();
  });

  it('a fallen player revives nobody', () => {
    const tracker = new ReviveTracker();
    tracker.fall(1);
    expect(tracker.update(REVIVE_RULES.hold + 1, null, near, true)).toEqual({ target: null, progress: 0, completed: null });
  });

  it('forgets a teammate who stood up, and picks the nearest of two', () => {
    const tracker = new ReviveTracker();
    tracker.fall(1);
    tracker.fall(2);
    const positions = (slot: number) => (slot === 1 ? { x: 2, z: 0 } : { x: 1, z: 0 });
    expect(tracker.update(0.1, here, positions, false).target).toBe(2);
    tracker.standUp(2);
    expect(tracker.fallenSlots).toEqual([1]);
    expect(tracker.update(0.1, here, positions, false).target).toBe(1);
  });

  it('adopts a teammate already down without resetting one it knows', () => {
    const tracker = new ReviveTracker();
    tracker.fall(1);
    tracker.update(10, here, far, false);
    tracker.adopt(1);
    tracker.adopt(2);
    expect(tracker.bleedLeft(1)).toBe(REVIVE_RULES.bleedOut - 10);
    expect(tracker.bleedLeft(2)).toBe(REVIVE_RULES.bleedOut);
  });
});
