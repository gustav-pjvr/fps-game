import { describe, expect, it, vi } from 'vitest';
import { MATCH_MAPS } from '../core/config.ts';
import { routeMatchMessage, type MatchMessageContext } from './MatchMessageRouter.ts';
import { isNetworkMessage, type MatchStartMessage, type WelcomeMessage } from './protocol.ts';

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
