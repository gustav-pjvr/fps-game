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

describe('Facility object messages', () => {
  it('accepts interactions and compact object state after a JSON round trip', () => {
    for (const message of [
      { type: 'worldInteract', kind: 'door', id: 0 },
      { type: 'worldInteract', kind: 'breaker', id: 5 },
      { type: 'worldObjectState', doors: '0101', breakers: '110' },
      { type: 'worldObjectState', doors: '', breakers: '' },
      { type: 'worldObjectState', doors: '1'.repeat(4096), breakers: '0'.repeat(4096) },
    ]) expect(isNetworkMessage(JSON.parse(JSON.stringify(message)))).toBe(true);
  });

  it('rejects invalid interaction kinds and ids', () => {
    for (const kind of [undefined, null, 'lamp', 0]) expect(isNetworkMessage({ type: 'worldInteract', kind, id: 0 })).toBe(false);
    for (const id of [undefined, null, -1, 0.5, NaN, Infinity, '0']) {
      expect(isNetworkMessage({ type: 'worldInteract', kind: 'door', id })).toBe(false);
    }
  });

  it('rejects missing, non-binary, oversized or non-string object state', () => {
    for (const bad of [undefined, null, 0, [], '2', 'true', '0\n', '1'.repeat(4097)]) {
      expect(isNetworkMessage({ type: 'worldObjectState', doors: bad, breakers: '1' })).toBe(false);
      expect(isNetworkMessage({ type: 'worldObjectState', doors: '1', breakers: bad })).toBe(false);
    }
  });
});
