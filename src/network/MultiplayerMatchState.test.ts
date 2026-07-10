import { describe, expect, it } from 'vitest';
import { isHordeAllEliminated, MultiplayerMatchState } from './MultiplayerMatchState.ts';
import { KOTH_POINTS_TO_WIN } from '../core/config.ts';
import type { PlayerSlot } from './protocol.ts';

describe('MultiplayerMatchState.findWinner - win-condition threshold scan', () => {
  it('returns null when nobody has reached the kill limit yet', () => {
    const state = new MultiplayerMatchState();
    state.scoreboard.set(0, 3);
    state.scoreboard.set(1, 4);
    expect(state.findWinner('default', 5)).toBeNull();
  });

  it('returns the first slot whose score has crossed the kill limit', () => {
    const state = new MultiplayerMatchState();
    state.scoreboard.set(0, 2);
    state.scoreboard.set(1, 5);
    expect(state.findWinner('default', 5)).toBe(1);
  });

  it('treats a score exactly equal to the threshold as a win, not just strictly above it', () => {
    const state = new MultiplayerMatchState();
    state.scoreboard.set(2, 5);
    expect(state.findWinner('default', 5)).toBe(2);
  });

  it('King of the Hill always uses KOTH_POINTS_TO_WIN, ignoring the host-chosen killLimit entirely', () => {
    const state = new MultiplayerMatchState();
    state.scoreboard.set(0, KOTH_POINTS_TO_WIN - 1);
    // A killLimit far below KOTH_POINTS_TO_WIN must NOT trigger a win - KOTH scores points, not
    // kills, against its own fixed threshold regardless of what killLimit the host picked.
    expect(state.findWinner('kingOfTheHill', 1)).toBeNull();

    state.scoreboard.set(0, KOTH_POINTS_TO_WIN);
    expect(state.findWinner('kingOfTheHill', 1)).toBe(0);
  });

  it('Goose Horde has no scoreboard-based win condition at all - always null regardless of score', () => {
    const state = new MultiplayerMatchState();
    state.scoreboard.set(0, 9999);
    expect(state.findWinner('gooseHorde', 1)).toBeNull();
  });

  it('every other kill-limit mode (gunGame/oneShotOneKill/sniperDuel/knifeOnly/gooseToss) uses killLimit directly', () => {
    const state = new MultiplayerMatchState();
    state.scoreboard.set(0, 3);
    for (const mode of ['gunGame', 'oneShotOneKill', 'sniperDuel', 'knifeOnly', 'gooseToss'] as const) {
      expect(state.findWinner(mode, 3)).toBe(0);
      expect(state.findWinner(mode, 4)).toBeNull();
    }
  });
});

describe('MultiplayerMatchState.applyDeath', () => {
  it('credits the killer for a normal PvP mode', () => {
    const state = new MultiplayerMatchState();
    state.applyDeath('default', { victimSlot: 1, killerSlot: 0 });
    expect(state.scoreboard.get(0)).toBe(1);
  });

  it('never credits anyone in Goose Horde (co-op, no friendly-fire scoring)', () => {
    const state = new MultiplayerMatchState();
    state.applyDeath('gooseHorde', { victimSlot: 1, killerSlot: 0 });
    expect(state.scoreboard.size).toBe(0);
    expect(state.deathCounts.size).toBe(0);
  });
});

describe('MultiplayerMatchState.buildPlacements', () => {
  it('sorts every known username by score, highest first, marking the local player', () => {
    const state = new MultiplayerMatchState();
    state.scoreboard.set(0, 2);
    state.scoreboard.set(1, 7);
    const usernames = new Map<PlayerSlot, string>([
      [0, 'Alice'],
      [1, 'Bob'],
      [2, 'Cara'], // never scored - defaults to 0, still appears
    ]);
    const placements = state.buildPlacements(usernames, 0);
    expect(placements.map((p) => p.username)).toEqual(['Bob', 'Alice', 'Cara']);
    expect(placements.find((p) => p.username === 'Cara')!.score).toBe(0);
    expect(placements.find((p) => p.username === 'Alice')!.isYou).toBe(true);
    expect(placements.find((p) => p.username === 'Bob')!.isYou).toBe(false);
  });
});

describe('isHordeAllEliminated - Goose Horde limited-lives loss condition', () => {
  it('is false while at least one connected player has not been eliminated', () => {
    expect(isHordeAllEliminated(1, 2)).toBe(false);
  });

  it('is true once the eliminated count reaches the connected count', () => {
    expect(isHordeAllEliminated(2, 2)).toBe(true);
  });

  it('holds for a 3-4 player room too, not just the 2-player case', () => {
    expect(isHordeAllEliminated(3, 4)).toBe(false);
    expect(isHordeAllEliminated(4, 4)).toBe(true);
  });

  it('treats an eliminated count that somehow exceeds connected count as still eliminated (>=, not ==)', () => {
    expect(isHordeAllEliminated(3, 2)).toBe(true);
  });
});
