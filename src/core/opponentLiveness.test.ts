import { describe, expect, it } from 'vitest';
import { MULTIPLAYER_CONNECTION_TIMEOUT_MS, MULTIPLAYER_LOADING_TIMEOUT_MS, MULTIPLAYER_SETTLE_MS } from './config.ts';
import { isOpponentSilent } from './opponentLiveness.ts';

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

  it('still gives up on a player that never settles', () => {
    expect(isOpponentSilent(1000 + MULTIPLAYER_LOADING_TIMEOUT_MS, 1000, null)).toBe(true);
    expect(isOpponentSilent(1000 + MULTIPLAYER_LOADING_TIMEOUT_MS, 1000, 900)).toBe(true);
  });
});
