import { describe, expect, it } from 'vitest';
import { applyPlayerDied } from './multiplayerScoring.ts';
import type { PlayerSlot } from '../network/protocol.ts';

describe('applyPlayerDied', () => {
  it('credits the killer and increments the victim death count', () => {
    const scoreboard = new Map<PlayerSlot, number>();
    const deathCounts = new Map<PlayerSlot, number>();
    applyPlayerDied(scoreboard, deathCounts, { victimSlot: 1, killerSlot: 2 });
    expect(scoreboard.get(2)).toBe(1);
    expect(deathCounts.get(1)).toBe(1);
  });

  it('accumulates across multiple deaths for the same killer', () => {
    const scoreboard = new Map<PlayerSlot, number>();
    const deathCounts = new Map<PlayerSlot, number>();
    applyPlayerDied(scoreboard, deathCounts, { victimSlot: 1, killerSlot: 0 });
    applyPlayerDied(scoreboard, deathCounts, { victimSlot: 2, killerSlot: 0 });
    applyPlayerDied(scoreboard, deathCounts, { victimSlot: 3, killerSlot: 0 });
    expect(scoreboard.get(0)).toBe(3);
    expect(deathCounts.get(1)).toBe(1);
    expect(deathCounts.get(2)).toBe(1);
    expect(deathCounts.get(3)).toBe(1);
  });

  it('increments the victim death count without touching the scoreboard when killerSlot is null', () => {
    const scoreboard = new Map<PlayerSlot, number>();
    const deathCounts = new Map<PlayerSlot, number>();
    applyPlayerDied(scoreboard, deathCounts, { victimSlot: 1, killerSlot: null });
    expect(scoreboard.size).toBe(0);
    expect(deathCounts.get(1)).toBe(1);
  });

  it('does not credit a self-kill differently from any other kill (killerSlot === victimSlot is treated the same)', () => {
    const scoreboard = new Map<PlayerSlot, number>();
    const deathCounts = new Map<PlayerSlot, number>();
    applyPlayerDied(scoreboard, deathCounts, { victimSlot: 1, killerSlot: 1 });
    expect(scoreboard.get(1)).toBe(1);
    expect(deathCounts.get(1)).toBe(1);
  });
});
