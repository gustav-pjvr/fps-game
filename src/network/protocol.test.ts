import { describe, expect, it, vi } from 'vitest';
import { MATCH_MAPS } from '../core/config.ts';
import { routeMatchMessage, type MatchMessageContext } from './MatchMessageRouter.ts';
import { CLIENT_FEATURES, helloSupportsMap, isNetworkMessage, type MatchStartMessage, type WelcomeMessage } from './protocol.ts';

const matchStart: MatchStartMessage = {
  type: 'matchStart',
  seed: 123,
  killLimit: 15,
  gooseDifficulty: 'normal',
  gameMode: 'default',
  weather: 'fog',
  spawns: [{ slot: 1, x: 10, z: 20 }],
  roster: [{ slot: 0, username: 'Host' }, { slot: 1, username: 'Guest' }],
};

function receiveRematch(message: MatchStartMessage) {
  const onRematchReceived = vi.fn();
  // Only the rematch branch's context is needed; no world or player managers are touched.
  const context = {
    multiplayer: {
      session: { role: 'guest', ownSlot: 1, roomCode: 'ABCDEF' },
      opponents: new Map(),
      hostRoster: null,
    },
    onRematchReceived,
  } as unknown as MatchMessageContext;
  const decoded: unknown = JSON.parse(JSON.stringify(message));
  expect(isNetworkMessage(decoded)).toBe(true);
  if (!isNetworkMessage(decoded)) throw new Error('Unrecognised match message');
  routeMatchMessage(context, decoded, 0);
  return onRematchReceived;
}

describe('match map protocol', () => {
  it.each(MATCH_MAPS)('carries %s through a matchStart round trip and rematch handoff', (map) => {
    const onRematchReceived = receiveRematch({ ...matchStart, map });
    expect(onRematchReceived).toHaveBeenCalledWith(expect.objectContaining({
      map,
      weather: 'fog',
      seed: 123,
      ownSlot: 1,
      spawns: [{ slot: 1, point: { x: 10, z: 20 } }],
    }));
  });

  it('defaults a matchStart without map from an older build to valley', () => {
    const onRematchReceived = receiveRematch(matchStart);
    expect(onRematchReceived).toHaveBeenCalledWith(expect.objectContaining({ map: 'valley', weather: 'fog' }));
  });

  it.each(MATCH_MAPS)('keeps %s in a late join welcome round trip', (map) => {
    const welcome: WelcomeMessage = {
      type: 'welcome',
      yourSlot: 1,
      isRejoin: false,
      hostUsername: 'Host',
      roster: matchStart.roster,
      activeMatch: {
        seed: matchStart.seed,
        killLimit: matchStart.killLimit,
        gooseDifficulty: matchStart.gooseDifficulty,
        gameMode: matchStart.gameMode,
        weather: matchStart.weather,
        map,
        scoreboard: [{ slot: 0, score: 3 }],
        spawnPoint: { x: 10, z: 20 },
      },
    };
    const decoded: unknown = JSON.parse(JSON.stringify(welcome));
    expect(isNetworkMessage(decoded)).toBe(true);
    expect(decoded).toEqual(welcome);
  });
});

describe('hello features', () => {
  it('turns away a build without the facility feature from a Facility room only', () => {
    expect(helloSupportsMap(undefined, 'facility')).toBe(false);
    expect(helloSupportsMap([], 'facility')).toBe(false);
    expect(helloSupportsMap('facility', 'facility')).toBe(false);
    expect(helloSupportsMap(undefined, 'valley')).toBe(true);
    expect(helloSupportsMap(['facility'], 'facility')).toBe(true);
  });

  it('is always sent with the facility feature by this build', () => {
    expect(helloSupportsMap([...CLIENT_FEATURES], 'facility')).toBe(true);
  });
});

describe('squad message validation', () => {
  const accepts = (message: unknown) => isNetworkMessage(JSON.parse(JSON.stringify(message)));

  it('meshHello needs a guest slot and a room code string', () => {
    expect(accepts({ type: 'meshHello', slot: 2, roomCode: 'ABCDEF' })).toBe(true);
    expect(accepts({ type: 'meshHello', slot: 4, roomCode: 'ABCDEF' })).toBe(false);
    expect(accepts({ type: 'meshHello', slot: -1, roomCode: 'ABCDEF' })).toBe(false);
    expect(accepts({ type: 'meshHello', slot: '2', roomCode: 'ABCDEF' })).toBe(false);
    expect(accepts({ type: 'meshHello', slot: 2 })).toBe(false);
    expect(accepts({ type: 'meshHello', slot: 2, roomCode: 7 })).toBe(false);
  });

  it('meshStatus needs a sender slot and a list of slots', () => {
    expect(accepts({ type: 'meshStatus', senderSlot: 1, linked: [2, 3] })).toBe(true);
    expect(accepts({ type: 'meshStatus', senderSlot: 1, linked: [] })).toBe(true);
    expect(accepts({ type: 'meshStatus', senderSlot: 1 })).toBe(false);
    expect(accepts({ type: 'meshStatus', senderSlot: 1, linked: 2 })).toBe(false);
    expect(accepts({ type: 'meshStatus', senderSlot: 1, linked: [2, 9] })).toBe(false);
    expect(accepts({ type: 'meshStatus', senderSlot: 7, linked: [] })).toBe(false);
  });

  it('rosterSync needs a list of roster entries, each with a slot and a name, and a string peer id if any', () => {
    expect(accepts({ type: 'rosterSync', roster: [{ slot: 0, username: 'Host' }, { slot: 2, username: 'Dee', peerId: 'p2' }] })).toBe(true);
    expect(accepts({ type: 'rosterSync', roster: [] })).toBe(true);
    expect(accepts({ type: 'rosterSync' })).toBe(false);
    expect(accepts({ type: 'rosterSync', roster: [{ slot: 5, username: 'X' }] })).toBe(false);
    expect(accepts({ type: 'rosterSync', roster: [{ slot: 1 }] })).toBe(false);
    expect(accepts({ type: 'rosterSync', roster: [{ slot: 1, username: 'X', peerId: 3 }] })).toBe(false);
    expect(accepts({ type: 'rosterSync', roster: [null] })).toBe(false);
  });

  it('linkQuality needs a round trip (or null) and a relay flag per link', () => {
    expect(accepts({ type: 'linkQuality', links: [{ slot: 1, rttMs: 40, relay: false }, { slot: 2, rttMs: null, relay: true }] })).toBe(true);
    expect(accepts({ type: 'linkQuality', links: [] })).toBe(true);
    expect(accepts({ type: 'linkQuality' })).toBe(false);
    expect(accepts({ type: 'linkQuality', links: [{ slot: 1, rttMs: '40', relay: false }] })).toBe(false);
    expect(accepts({ type: 'linkQuality', links: [{ slot: 1, rttMs: 40 }] })).toBe(false);
    expect(accepts({ type: 'linkQuality', links: [{ slot: 9, rttMs: 40, relay: false }] })).toBe(false);
  });

  it('goldenGooseState needs a carrier slot or null and three numbers', () => {
    expect(accepts({ type: 'goldenGooseState', carrierSlot: 2, x: 1, y: 2, z: 3 })).toBe(true);
    expect(accepts({ type: 'goldenGooseState', carrierSlot: null, x: 1, y: 2, z: 3 })).toBe(true);
    expect(accepts({ type: 'goldenGooseState', x: 1, y: 2, z: 3 })).toBe(false);
    expect(accepts({ type: 'goldenGooseState', carrierSlot: 4, x: 1, y: 2, z: 3 })).toBe(false);
    expect(accepts({ type: 'goldenGooseState', carrierSlot: null, x: 1, y: '2', z: 3 })).toBe(false);
    expect(accepts({ type: 'goldenGooseState', carrierSlot: null, x: 1, y: 2 })).toBe(false);
  });

  it('hordeSyncState needs a wave, a slot list if any, and a known result if any', () => {
    expect(accepts({ type: 'hordeSyncState', wave: 3 })).toBe(true);
    expect(accepts({ type: 'hordeSyncState', wave: 3, eliminated: [0, 2], result: 'wiped' })).toBe(true);
    expect(accepts({ type: 'hordeSyncState', wave: 3, result: 'cleared' })).toBe(true);
    expect(accepts({ type: 'hordeSyncState' })).toBe(false);
    expect(accepts({ type: 'hordeSyncState', wave: '3' })).toBe(false);
    expect(accepts({ type: 'hordeSyncState', wave: 3, eliminated: [0, 8] })).toBe(false);
    expect(accepts({ type: 'hordeSyncState', wave: 3, eliminated: 'all' })).toBe(false);
    expect(accepts({ type: 'hordeSyncState', wave: 3, result: 'won' })).toBe(false);
  });

  it('still drops anything that is not an object or has an unknown type', () => {
    expect(isNetworkMessage(null)).toBe(false);
    expect(isNetworkMessage('meshHello')).toBe(false);
    expect(isNetworkMessage({ type: 'meshGoodbye' })).toBe(false);
    expect(isNetworkMessage({})).toBe(false);
  });
});
