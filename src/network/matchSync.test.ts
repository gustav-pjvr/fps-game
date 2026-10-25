import { describe, expect, it } from 'vitest';
import { buildMatchSync, type MatchSyncSource } from './matchSync.ts';
import { isNetworkMessage } from './protocol.ts';

const empty: MatchSyncSource = {
  roster: null,
  goldenGoose: null,
  geese: [],
  horde: null,
  ammoDrops: [],
  bonusGeese: [],
  thrownGeese: [],
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
      goldenGoose: { carrierSlot: 2, position: { x: 1, y: 2, z: 3 } },
      geese: [{ id: 'g1', x: 1, y: 0, z: 2 }],
      bonusGeese: [{ id: 'b1', x: 5, y: 0, z: 6 }],
      thrownGeese: [
        { id: 't1', throwerSlot: 1, source: 'gooseLauncher', position: { x: 1, y: 4, z: 1 }, velocity: { x: 0, y: 2, z: 9 } },
        { id: 't2', throwerSlot: null, source: 'gooseToss', position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      ],
      verdict: { winnerSlot: 1, scoreboard: [{ slot: 1, score: 10 }] },
    });
    expect(messages.map((m) => m.type)).toEqual(['rosterSync', 'goldenGooseState', 'gooseSpawned', 'bonusGooseSpawned', 'gooseThrown', 'matchEnded']);
    for (const message of messages) expect(isNetworkMessage(JSON.parse(JSON.stringify(message)))).toBe(true);
    expect(messages[1]).toEqual({ type: 'goldenGooseState', carrierSlot: 2, x: 1, y: 2, z: 3 });
    expect(messages[2]).toEqual({ type: 'gooseSpawned', id: 'g1', x: 1, y: 0, z: 2, killerSlot: null });
    expect(messages[4]).toEqual({
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

  it('carries the Horde wave, eliminated set, result, flock and ammo crates', () => {
    const messages = buildMatchSync({
      ...empty,
      horde: { wave: 4, eliminated: new Set([0, 2]), result: 'wiped', geese: [{ id: 'h1', x: 0, y: 3, z: 0, flavor: 'flyer' }] },
      ammoDrops: [{ id: 'a1', x: 7, y: 0, z: 8 }],
    });
    expect(messages).toEqual([
      { type: 'hordeSyncState', wave: 4, eliminated: [0, 2], result: 'wiped' },
      { type: 'hordeGooseSpawned', id: 'h1', x: 0, y: 3, z: 0, flavor: 'flyer' },
      { type: 'hordeAmmoDropSpawned', id: 'a1', x: 7, y: 0, z: 8 },
    ]);
  });

  it('leaves the Horde result out while the run is still going', () => {
    const [state] = buildMatchSync({ ...empty, horde: { wave: 1, eliminated: [], result: undefined, geese: [] } });
    expect(state).toEqual({ type: 'hordeSyncState', wave: 1, eliminated: [] });
  });
});
