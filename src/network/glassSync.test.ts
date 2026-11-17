import { describe, expect, it } from 'vitest';
import { GLASS_SYNC_INTERVAL, GlassSyncTracker } from './glassSync.ts';

describe('GlassSyncTracker opponent snapshots', () => {
  it('sends on a slot\'s first snapshot only when there is something to tell', () => {
    const tracker = new GlassSyncTracker();
    expect(tracker.opponentSnapshot(1, 0)).toBe(false);
    // The slot still counts as seen, so a later change does not trigger a send by this route.
    expect(tracker.opponentSnapshot(1, 3)).toBe(false);
    expect(tracker.opponentSnapshot(2, 3)).toBe(true);
  });

  it('does not send for the second snapshot from the same slot', () => {
    const tracker = new GlassSyncTracker();
    expect(tracker.opponentSnapshot(1, 2)).toBe(true);
    expect(tracker.opponentSnapshot(1, 2)).toBe(false);
    expect(tracker.opponentSnapshot(1, 9)).toBe(false);
  });

  it('sends again after the slot is forgotten (a rejoin)', () => {
    const tracker = new GlassSyncTracker();
    expect(tracker.opponentSnapshot(1, 2)).toBe(true);
    tracker.forget(1);
    expect(tracker.opponentSnapshot(1, 2)).toBe(true);
    // Forgetting a slot never seen is harmless.
    tracker.forget(5);
  });

  it('tracks slots independently', () => {
    const tracker = new GlassSyncTracker();
    expect(tracker.opponentSnapshot(1, 1)).toBe(true);
    expect(tracker.opponentSnapshot(2, 1)).toBe(true);
    tracker.forget(1);
    expect(tracker.opponentSnapshot(2, 1)).toBe(false);
    expect(tracker.opponentSnapshot(1, 1)).toBe(true);
  });
});

describe('GlassSyncTracker periodic update', () => {
  it('is false before the interval has passed', () => {
    const tracker = new GlassSyncTracker();
    expect(tracker.update(GLASS_SYNC_INTERVAL / 2, 4)).toBe(false);
    expect(tracker.update(GLASS_SYNC_INTERVAL / 2 - 0.01, 4)).toBe(false);
  });

  it('is true after the interval when the revision changed, then false while unchanged', () => {
    const tracker = new GlassSyncTracker();
    expect(tracker.update(GLASS_SYNC_INTERVAL / 2, 4)).toBe(false);
    expect(tracker.update(GLASS_SYNC_INTERVAL / 2, 4)).toBe(true);
    expect(tracker.update(GLASS_SYNC_INTERVAL, 4)).toBe(false);
    expect(tracker.update(GLASS_SYNC_INTERVAL, 5)).toBe(true);
  });

  it('is false at revision 0 however long it waits', () => {
    const tracker = new GlassSyncTracker();
    expect(tracker.update(GLASS_SYNC_INTERVAL * 10, 0)).toBe(false);
    expect(tracker.update(GLASS_SYNC_INTERVAL * 10, 0)).toBe(false);
  });

  it('does not repeat what a first-snapshot send already covered', () => {
    const tracker = new GlassSyncTracker();
    expect(tracker.opponentSnapshot(1, 6)).toBe(true);
    expect(tracker.update(GLASS_SYNC_INTERVAL, 6)).toBe(false);
    expect(tracker.update(GLASS_SYNC_INTERVAL, 7)).toBe(true);
  });

  it('restarts the wait after each interval, even when nothing is sent', () => {
    const tracker = new GlassSyncTracker();
    expect(tracker.update(GLASS_SYNC_INTERVAL, 0)).toBe(false);
    // A change right after the check waits for the next full interval.
    expect(tracker.update(GLASS_SYNC_INTERVAL - 1, 3)).toBe(false);
    expect(tracker.update(1, 3)).toBe(true);
  });

  it('ignores a negative or non-finite dt', () => {
    const tracker = new GlassSyncTracker();
    expect(tracker.update(-100, 3)).toBe(false);
    expect(tracker.update(NaN, 3)).toBe(false);
    expect(tracker.update(Infinity, 3)).toBe(false);
    expect(tracker.update(GLASS_SYNC_INTERVAL, 3)).toBe(true);
  });
});
