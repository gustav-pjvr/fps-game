import { describe, expect, it } from 'vitest';
import { MultiplayerMatchState } from './MultiplayerMatchState.ts';
import { isNetworkMessage } from './protocol.ts';

describe('host-decided match end', () => {
  it('replaceScoreboard adopts the host scoreboard wholesale, dropping stale local entries', () => {
    const state = new MultiplayerMatchState();
    state.seedFrom([
      { slot: 0, score: 9 },
      { slot: 1, score: 10 },
      { slot: 3, score: 4 },
    ]);
    state.replaceScoreboard([
      { slot: 0, score: 10 },
      { slot: 1, score: 9 },
    ]);
    expect(Array.from(state.scoreboard)).toEqual([
      [0, 10],
      [1, 9],
    ]);
  });

  it('the podium built after adopting the host scoreboard names the host-decided winner first', () => {
    const state = new MultiplayerMatchState();
    // This guest's own view: it credited its own kill first and saw itself (slot 2) reach the limit.
    state.seedFrom([
      { slot: 0, score: 9 },
      { slot: 2, score: 10 },
    ]);
    // The host processed the two simultaneous kills in the other order: slot 0 won.
    state.replaceScoreboard([
      { slot: 0, score: 10 },
      { slot: 2, score: 9 },
    ]);
    const placements = state.buildPlacements(new Map([[0, 'Host'], [2, 'Guest']]), 2);
    expect(placements[0]).toMatchObject({ slot: 0, score: 10, isYou: false });
    expect(placements[1]).toMatchObject({ slot: 2, score: 9, isYou: true });
  });

  it('matchEnded is a recognised wire message', () => {
    expect(isNetworkMessage({ type: 'matchEnded', winnerSlot: 1, scoreboard: [{ slot: 1, score: 15 }] })).toBe(true);
  });
});
