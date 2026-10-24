import { describe, expect, it } from 'vitest';
import { LAMP_SYNC_INTERVAL, LampSyncTracker, parseLampList } from './lampSync.ts';
import { isNetworkMessage } from './protocol.ts';
import { RELAYABLE_MESSAGE_TYPES } from './MatchMessageRouter.ts';

describe('lamp sync', () => {
  it('keeps only integer lamp indices within the lamp count, capped at the lamp count', () => {
    expect(parseLampList([0, 3, 2], 4)).toEqual([0, 3, 2]);
    expect(parseLampList([1, -1, 4, 2.5, '2', null, 3], 8)).toEqual([1, 4, 3]);
    // Capped before filtering, so a huge list costs at most lampCount checks.
    expect(parseLampList([1, -1, 4, 2.5, 3], 4)).toEqual([1]);
    expect(parseLampList(Array.from({ length: 1000 }, () => 1), 4)).toEqual([1, 1, 1, 1]);
    expect(parseLampList('0,1', 4)).toEqual([]);
    expect(parseLampList(undefined, 4)).toEqual([]);
  });

  it('is a known message the host relays', () => {
    expect(isNetworkMessage({ type: 'lampSync', senderSlot: 1, lamps: [2] })).toBe(true);
    expect(RELAYABLE_MESSAGE_TYPES.has('lampSync')).toBe(true);
  });

  it('sends the dead set once per opponent on their first snapshot, again after they leave and come back', () => {
    const tracker = new LampSyncTracker();
    let dead: number[] = [];
    // Nothing to tell yet: the opponent still counts as seen.
    expect(tracker.opponentSnapshot(1, () => dead)).toBeNull();
    dead = [4, 7];
    expect(tracker.opponentSnapshot(1, () => dead)).toBeNull();
    // A lamp shot while slot 2 was still loading reaches it on its first snapshot.
    expect(tracker.opponentSnapshot(2, () => dead)).toEqual([4, 7]);
    expect(tracker.opponentSnapshot(2, () => dead)).toBeNull();
    tracker.forget(2);
    expect(tracker.opponentSnapshot(2, () => dead)).toEqual([4, 7]);
  });

  it('re-broadcasts every interval only while the set is non-empty and changed since the last send', () => {
    const tracker = new LampSyncTracker();
    let dead: number[] = [], reads = 0;
    const read = (): number[] => { reads++; return dead; };
    expect(tracker.update(LAMP_SYNC_INTERVAL, read)).toBeNull();
    dead = [3];
    expect(tracker.update(LAMP_SYNC_INTERVAL / 2, read)).toBeNull();
    expect(reads).toBe(1);
    expect(tracker.update(LAMP_SYNC_INTERVAL / 2, read)).toEqual([3]);
    expect(tracker.update(LAMP_SYNC_INTERVAL, read)).toBeNull();
    dead = [3, 5];
    expect(tracker.update(LAMP_SYNC_INTERVAL, read)).toEqual([3, 5]);
    // A first-snapshot send counts as the last broadcast too.
    dead = [3, 5, 6];
    expect(tracker.opponentSnapshot(1, read)).toEqual([3, 5, 6]);
    expect(tracker.update(LAMP_SYNC_INTERVAL, read)).toBeNull();
  });
});
