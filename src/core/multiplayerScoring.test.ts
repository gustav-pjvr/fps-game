import { describe, expect, it } from 'vitest';
import { applyMatchDeath, applyPlayerDied, creditsKill, GUN_GAME_FINISHER_WEAPON } from './multiplayerScoring.ts';
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

describe('creditsKill', () => {
  it('counts every kill outside Gun Game', () => {
    expect(creditsKill('default', 10, 9, 'rifle')).toBe(true);
    expect(creditsKill('kingOfTheHill', 10, 9, 'rifle')).toBe(true);
  });

  it('scores nothing for a kill in King of the Hill, which is won on the hill, but still counts the death', () => {
    const scoreboard = new Map<PlayerSlot, number>([[0, 40]]);
    const deaths = new Map<PlayerSlot, number>();
    expect(applyMatchDeath(scoreboard, deaths, 'kingOfTheHill', 10, { victimSlot: 1, killerSlot: 0, killerWeaponId: 'rifle' })).toBe(false);
    expect(scoreboard.get(0)).toBe(40);
    expect(deaths.get(1)).toBe(1);
  });

  it('in Gun Game, the kill that would reach the limit needs the launcher', () => {
    expect(creditsKill('gunGame', 5, 3, 'rifle')).toBe(true);
    expect(creditsKill('gunGame', 5, 4, 'rifle')).toBe(false);
    expect(creditsKill('gunGame', 5, 4, GUN_GAME_FINISHER_WEAPON)).toBe(true);
  });

  it('counts a kill with no recorded weapon, and has no finisher round at a kill limit of 1', () => {
    expect(creditsKill('gunGame', 5, 4, undefined)).toBe(true);
    expect(creditsKill('gunGame', 1, 0, 'rifle')).toBe(true);
  });
});

describe('applyMatchDeath', () => {
  it('scores nothing in Goose Horde', () => {
    const scoreboard = new Map<PlayerSlot, number>();
    const deathCounts = new Map<PlayerSlot, number>();
    expect(applyMatchDeath(scoreboard, deathCounts, 'gooseHorde', 10, { victimSlot: 1, killerSlot: 2 })).toBe(false);
    expect(scoreboard.size).toBe(0);
    expect(deathCounts.size).toBe(0);
  });

  it('an uncredited Gun Game finisher still counts the victim death but gives the killer nothing', () => {
    const scoreboard = new Map<PlayerSlot, number>([[2, 4]]);
    const deathCounts = new Map<PlayerSlot, number>();
    expect(applyMatchDeath(scoreboard, deathCounts, 'gunGame', 5, { victimSlot: 1, killerSlot: 2, killerWeaponId: 'rifle' })).toBe(false);
    expect(scoreboard.get(2)).toBe(4);
    expect(deathCounts.get(1)).toBe(1);
    expect(applyMatchDeath(scoreboard, deathCounts, 'gunGame', 5, { victimSlot: 1, killerSlot: 2, killerWeaponId: GUN_GAME_FINISHER_WEAPON })).toBe(true);
    expect(scoreboard.get(2)).toBe(5);
  });

  it('a death with no killer is never credited', () => {
    const scoreboard = new Map<PlayerSlot, number>();
    const deathCounts = new Map<PlayerSlot, number>();
    expect(applyMatchDeath(scoreboard, deathCounts, 'default', 10, { victimSlot: 3, killerSlot: null })).toBe(false);
    expect(deathCounts.get(3)).toBe(1);
  });
});
