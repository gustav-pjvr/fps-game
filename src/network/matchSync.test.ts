import { describe, expect, it } from 'vitest';
import { buildMatchSync, type MatchSyncSource } from './matchSync.ts';
import { isNetworkMessage } from './protocol.ts';

const empty: MatchSyncSource = {
  roster: null,
  koth: null,
  geese: [],
  horde: null,
  ammoDrops: [],
  bonusGeese: [],
  thrownGeese: [],
  scoreboard: new Map(),
  deathCounts: new Map(),
  verdict: null,
};

describe('buildMatchSync', () => {
  it('sends nothing for parts the mode does not use', () => {
    expect(buildMatchSync(empty)).toEqual([]);
  });

  it('puts the roster first and the result last, and every message passes the receive check', () => {
    const messages = buildMatchSync({
      ...empty,
      roster: [{ slot: 0, username: 'Host' }, { slot: 3, username: 'Dee', peerId: 'p3' }],
      koth: { type: 'kothState', hill: [0, 0], next: [40, 0], radius: 8, moveIn: 30, hold: 'held', holder: 1, crown: 1, crownAt: null, push: false, teams: false, scores: [{ slot: 0, score: 4 }, { slot: 1, score: 9 }] },
      geese: [{ id: 'g1', x: 1, y: 0, z: 2 }],
      bonusGeese: [{ id: 'b1', x: 5, y: 0, z: 6 }],
      thrownGeese: [
        { id: 't1', throwerSlot: 1, source: 'gooseLauncher', position: { x: 1, y: 4, z: 1 }, velocity: { x: 0, y: 2, z: 9 } },
        { id: 't2', throwerSlot: null, source: 'gooseToss', position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      ],
      verdict: { winnerSlot: 1, scoreboard: [{ slot: 1, score: 10 }] },
    });
    expect(messages.map((m) => m.type)).toEqual(['rosterSync', 'scoreboardSync', 'kothState', 'gooseSpawned', 'bonusGooseSpawned', 'gooseThrown', 'matchEnded']);
    for (const message of messages) expect(isNetworkMessage(JSON.parse(JSON.stringify(message)))).toBe(true);
    expect(messages[2]).toMatchObject({ type: 'kothState', crown: 1, hill: [0, 0] });
    expect(messages[3]).toEqual({ type: 'gooseSpawned', id: 'g1', x: 1, y: 0, z: 2, killerSlot: null });
    expect(messages[5]).toEqual({
      type: 'gooseThrown',
      senderSlot: 1,
      id: 't1',
      originX: 1,
      originY: 4,
      originZ: 1,
      velX: 0,
      velY: 2,
      velZ: 9,
      source: 'gooseLauncher',
    });
  });

  it("carries every connected slot's score and deaths, 0 for a slot with none, and no one else's", () => {
    const messages = buildMatchSync({
      ...empty,
      roster: [{ slot: 0, username: 'Host' }, { slot: 1, username: 'Bo' }, { slot: 3, username: 'Dee' }],
      // Slot 2 left (its score stays for the podium); slot 3 is a newcomer with nothing yet.
      scoreboard: new Map([[0, 2], [1, 5], [2, 7]]),
      deathCounts: new Map([[0, 4], [2, 1]]),
    });
    expect(messages[1]).toEqual({
      type: 'scoreboardSync',
      scores: [
        { slot: 0, score: 2, deaths: 4 },
        { slot: 1, score: 5, deaths: 0 },
        { slot: 3, score: 0, deaths: 0 },
      ],
    });
  });

  it('drops a scoreboardSync with a malformed entry', () => {
    const entry = { slot: 1, score: 2, deaths: 0 };
    expect(isNetworkMessage({ type: 'scoreboardSync', scores: [entry] })).toBe(true);
    for (const bad of [{ ...entry, slot: 7 }, { ...entry, score: -1 }, { ...entry, score: Number.NaN }, { ...entry, deaths: 1.5 }]) {
      expect(isNetworkMessage({ type: 'scoreboardSync', scores: [bad] })).toBe(false);
    }
    expect(isNetworkMessage({ type: 'scoreboardSync', scores: [entry, entry, entry, entry, entry] })).toBe(false);
  });

  it('carries the Horde wave, fallen set, result, state, flock and supply crates', () => {
    const state = { wave: 6, phase: 'active' as const, nextIn: 0, left: 9, meter: 3, need: 18, boss: { id: 'mother' as const, hp: 900, max: 2250 }, kills: [{ slot: 0 as const, kills: 31 }] };
    const messages = buildMatchSync({
      ...empty,
      horde: { wave: 6, eliminated: new Set([0, 2]), result: 'wiped', state, geese: [{ id: 'h1', x: 0, y: 3, z: 0, flavor: 'boss', boss: 'mother' }] },
      ammoDrops: [{ id: 'a1', x: 7, y: 0, z: 8 }],
    });
    // The state comes before the flock: a boss is built with the health its state names.
    expect(messages).toEqual([
      { type: 'hordeSyncState', wave: 6, eliminated: [0, 2], result: 'wiped' },
      { type: 'hordeState', ...state },
      { type: 'hordeGooseSpawned', id: 'h1', x: 0, y: 3, z: 0, flavor: 'boss', boss: 'mother' },
      { type: 'hordeAmmoDropSpawned', id: 'a1', x: 7, y: 0, z: 8 },
    ]);
    for (const message of messages) expect(isNetworkMessage(JSON.parse(JSON.stringify(message)))).toBe(true);
  });

  it('leaves the Horde result out while the run is still going', () => {
    const [state] = buildMatchSync({ ...empty, horde: { wave: 1, eliminated: [], result: undefined, state: null, geese: [] } });
    expect(state).toEqual({ type: 'hordeSyncState', wave: 1, eliminated: [] });
  });
});
