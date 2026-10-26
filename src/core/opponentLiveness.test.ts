import { describe, expect, it } from 'vitest';
import { MULTIPLAYER_CONNECTION_TIMEOUT_MS, MULTIPLAYER_LOADING_TIMEOUT_MS, MULTIPLAYER_SETTLE_MS } from './config.ts';
import { isOpponentSilent, restartOpponentForRejoin } from './opponentLiveness.ts';

describe('isOpponentSilent', () => {
  it('drops a player that has been playing and went quiet for the connection timeout', () => {
    const now = MULTIPLAYER_SETTLE_MS + 100_000;
    const last = now - MULTIPLAYER_CONNECTION_TIMEOUT_MS;
    expect(isOpponentSilent(now - 1, last, 0)).toBe(false);
    expect(isOpponentSilent(now, last, 0)).toBe(true);
  });

  it('lets a player that is still loading finish, before and just after its first snapshots', () => {
    // A rejoiner sent a snapshot or two, then stalled for 9 s compiling its first frames: not silent.
    const stalled = 1000 + MULTIPLAYER_CONNECTION_TIMEOUT_MS + 1000;
    expect(isOpponentSilent(stalled, 1000, null)).toBe(false);
    expect(isOpponentSilent(stalled, 1000, 900)).toBe(false);
    expect(isOpponentSilent(1000 + MULTIPLAYER_LOADING_TIMEOUT_MS - 1, 1000, null)).toBe(false);
  });

  it('keeps a player that stalls right after its first snapshot past the settle window', () => {
    // The four-player browser test: a late joiner sent one snapshot, then its page froze for about a
    // minute; the host dropped it 30 s after that snapshot, so nobody else ever added it.
    const first = 1000;
    expect(isOpponentSilent(first + MULTIPLAYER_SETTLE_MS + 1, first, first)).toBe(false);
    expect(isOpponentSilent(first + MULTIPLAYER_LOADING_TIMEOUT_MS - 1, first, first)).toBe(false);
    expect(isOpponentSilent(first + MULTIPLAYER_LOADING_TIMEOUT_MS, first, first)).toBe(true);
  });

  it('waits out a dead player that sends nothing until its respawn, but not forever', () => {
    // Settled, then killed: silent past the connection timeout while its respawn timer runs.
    const now = MULTIPLAYER_SETTLE_MS + 100_000;
    const last = now - MULTIPLAYER_CONNECTION_TIMEOUT_MS - 5_000;
    expect(isOpponentSilent(now, last, 0, true)).toBe(false);
    expect(isOpponentSilent(now, last, 0, false)).toBe(true);
    expect(isOpponentSilent(last + MULTIPLAYER_LOADING_TIMEOUT_MS, last, 0, true)).toBe(true);
  });

  it('still gives up on a player that never settles', () => {
    expect(isOpponentSilent(1000 + MULTIPLAYER_LOADING_TIMEOUT_MS, 1000, null)).toBe(true);
    expect(isOpponentSilent(1000 + MULTIPLAYER_LOADING_TIMEOUT_MS, 1000, 900)).toBe(true);
  });
});

describe('restartOpponentForRejoin', () => {
  it('turns a dead, long-settled slot into a fresh, loading, living player the sweep waits for', () => {
    const settledAt = MULTIPLAYER_SETTLE_MS + 1000;
    const opponent = { lastMessageAt: settledAt, firstSnapshotAt: 0, isDead: true, lastStateSentAt: 987_654 };
    const now = settledAt + MULTIPLAYER_CONNECTION_TIMEOUT_MS + 5000;
    // Before: settled long ago and silent since, so the next sweep would drop the rejoiner.
    expect(isOpponentSilent(now, opponent.lastMessageAt, opponent.firstSnapshotAt, false)).toBe(true);
    restartOpponentForRejoin(opponent, now);
    expect(opponent).toEqual({ lastMessageAt: now, firstSnapshotAt: null, isDead: false, lastStateSentAt: undefined });
    // Its first frames may stall far past the connection timeout without it counting as gone.
    expect(isOpponentSilent(now + MULTIPLAYER_CONNECTION_TIMEOUT_MS + 1000, opponent.lastMessageAt, opponent.firstSnapshotAt, opponent.isDead)).toBe(false);
  });
});
