import { describe, expect, it, vi } from 'vitest';
import { MATCH_MAPS } from '../core/config.ts';
import { routeMatchMessage, type MatchMessageContext } from './MatchMessageRouter.ts';
import {
  CLIENT_FEATURES, DAMAGE_EVENT_MAX_AMOUNT, HELLO_USERNAME_MAX_LENGTH, KOTH_SCORE_TICK_MAX, NETWORK_MAX_COORD, helloSupportsMap, isNetworkMessage,
  type MatchStartMessage, type WelcomeMessage,
} from './protocol.ts';

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

describe('pickup message validation', () => {
  it('accepts well-formed pickup messages', () => {
    for (const message of [
      { type: 'pickupClaim', id: 0 },
      { type: 'pickupClaim', id: 17 },
      { type: 'pickupTaken', id: 3, slot: 2, respawnIn: 30 },
      { type: 'pickupTaken', id: 3, slot: 0, respawnIn: 0 },
      { type: 'pickupRespawned', id: 5 },
      { type: 'pickupSyncRequest', senderSlot: 1 },
      { type: 'pickupState', available: '' },
      { type: 'pickupState', available: '1101001' },
    ]) {
      expect(isNetworkMessage(JSON.parse(JSON.stringify(message)))).toBe(true);
    }
  });

  it('rejects a bad id: negative, fractional, huge, missing or not a number', () => {
    for (const id of [-1, 1.5, 256, 1e9, Number.NaN, '3', null, undefined]) {
      expect(isNetworkMessage({ type: 'pickupClaim', id })).toBe(false);
      expect(isNetworkMessage({ type: 'pickupRespawned', id })).toBe(false);
      expect(isNetworkMessage({ type: 'pickupTaken', id, slot: 1, respawnIn: 30 })).toBe(false);
    }
  });

  it('rejects a bad slot', () => {
    for (const slot of [-1, 4, 0.5, '1', null, undefined]) {
      expect(isNetworkMessage({ type: 'pickupTaken', id: 1, slot, respawnIn: 30 })).toBe(false);
      expect(isNetworkMessage({ type: 'pickupSyncRequest', senderSlot: slot })).toBe(false);
    }
  });

  it('rejects a bad respawn time', () => {
    for (const respawnIn of [-1, 601, Number.POSITIVE_INFINITY, Number.NaN, '30', null, undefined]) {
      expect(isNetworkMessage({ type: 'pickupTaken', id: 1, slot: 1, respawnIn })).toBe(false);
    }
  });

  it('rejects a state string with anything but 0 and 1, or one that is too long', () => {
    for (const available of ['102', 'abc', '1 0', 7, null, undefined, '1'.repeat(257)]) {
      expect(isNetworkMessage({ type: 'pickupState', available })).toBe(false);
    }
    expect(isNetworkMessage({ type: 'pickupState', available: '1'.repeat(256) })).toBe(true);
  });

  it('rejects an unknown pickup type', () => {
    expect(isNetworkMessage({ type: 'pickupGift', id: 1 })).toBe(false);
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

describe('Valley house doors on the wire (docs/enterable-buildings.md)', () => {
  it('accept a worldObjectState with a list of open house door ids, and reject a malformed list', () => {
    expect(isNetworkMessage({ type: 'worldObjectState', doors: '', breakers: '', valleyDoors: [4, 4099] })).toBe(true);
    expect(isNetworkMessage({ type: 'worldObjectState', doors: '01', breakers: '1' })).toBe(true);
    for (const valleyDoors of [[-1], [1.5], ['4'], 'x', Array.from({ length: 5000 }, (_, i) => i)]) {
      expect(isNetworkMessage({ type: 'worldObjectState', doors: '', breakers: '', valleyDoors })).toBe(false);
    }
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

  it('kothState needs every part of the hill inside what the mode can produce', () => {
    const state = { type: 'kothState', hill: [0, 0], next: [40, 0], radius: 8, moveIn: 30, hold: 'held', holder: 1, crown: 1, crownAt: null, push: false, teams: false, scores: [{ slot: 0, score: 4 }, { slot: 1, score: 9 }] };
    expect(accepts(state)).toBe(true);
    expect(accepts({ ...state, crown: null, crownAt: [3, -4], hold: 'contested', holder: null })).toBe(true);
    expect(accepts({ ...state, hill: [1e9, 0] })).toBe(false);
    expect(accepts({ ...state, next: [0] })).toBe(false);
    expect(accepts({ ...state, radius: 0 })).toBe(false);
    expect(accepts({ ...state, radius: 500 })).toBe(false);
    expect(accepts({ ...state, moveIn: -1 })).toBe(false);
    expect(accepts({ ...state, hold: 'mine' })).toBe(false);
    expect(accepts({ ...state, holder: 7 })).toBe(false);
    expect(accepts({ ...state, crown: 4 })).toBe(false);
    expect(accepts({ ...state, crownAt: [Number.NaN, 0] })).toBe(false);
    expect(accepts({ ...state, push: 'yes' })).toBe(false);
    expect(accepts({ ...state, scores: [{ slot: 0, score: 1e9 }] })).toBe(false);
    expect(accepts({ ...state, scores: [{ slot: 0, score: 1.5 }] })).toBe(false);
    expect(accepts({ ...state, scores: Array.from({ length: 5 }, () => ({ slot: 0, score: 1 })) })).toBe(false);
    expect(accepts({ type: 'kothCrownClaim' })).toBe(true);
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

describe('self-reported numbers and hello fields', () => {
  const ok = (message: object): boolean => isNetworkMessage(JSON.parse(JSON.stringify(message)));
  // NaN and Infinity do not survive JSON, so those are checked on the raw object.
  const raw = (message: object): boolean => isNetworkMessage(message);

  it('a damageEvent needs a finite amount between 0 and the cap, and a real target slot', () => {
    const hit = { type: 'damageEvent', senderSlot: 1, targetSlot: 2, amount: 45, weaponId: 'rifle' };
    expect(ok(hit)).toBe(true);
    expect(ok({ ...hit, amount: 0 })).toBe(true);
    expect(ok({ ...hit, amount: DAMAGE_EVENT_MAX_AMOUNT })).toBe(true);
    expect(raw({ ...hit, amount: Number.NaN })).toBe(false);
    expect(raw({ ...hit, amount: Number.POSITIVE_INFINITY })).toBe(false);
    expect(ok({ ...hit, amount: -10 })).toBe(false);
    expect(ok({ ...hit, amount: DAMAGE_EVENT_MAX_AMOUNT + 1 })).toBe(false);
    expect(ok({ ...hit, amount: '45' })).toBe(false);
    expect(ok({ ...hit, targetSlot: 4 })).toBe(false);
    expect(ok({ ...hit, senderSlot: 9 })).toBe(false);
  });

  it('a kothScoreTick needs a whole score no higher than the win plus a little', () => {
    const tick = { type: 'kothScoreTick', senderSlot: 1, score: 12 };
    expect(ok(tick)).toBe(true);
    expect(ok({ ...tick, score: KOTH_SCORE_TICK_MAX })).toBe(true);
    expect(ok({ ...tick, score: 1e9 })).toBe(false);
    expect(ok({ ...tick, score: -1 })).toBe(false);
    expect(ok({ ...tick, score: 1.5 })).toBe(false);
  });

  it('a playerSnapshot, footstep, respawn or shot needs finite positions in range', () => {
    const snapshot = { type: 'playerSnapshot', senderSlot: 1, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100, t: 5 };
    expect(ok(snapshot)).toBe(true);
    expect(raw({ ...snapshot, x: Number.NaN })).toBe(false);
    expect(ok({ ...snapshot, z: NETWORK_MAX_COORD * 10 })).toBe(false);
    expect(raw({ ...snapshot, yaw: Number.POSITIVE_INFINITY })).toBe(false);
    expect(ok({ ...snapshot, health: -5 })).toBe(false);
    expect(ok({ ...snapshot, t: 'late' })).toBe(false);
    // The held weapon and its skin are short optional ids: an older build sends neither.
    expect(ok({ ...snapshot, w: 'battleRifle', k: 'whiteout' })).toBe(true);
    expect(ok({ ...snapshot, w: 'x'.repeat(25) })).toBe(false);
    expect(ok({ ...snapshot, k: 7 })).toBe(false);
    expect(ok({ type: 'footstepEvent', senderSlot: 2, x: 1, y: 2, z: 1e9 })).toBe(false);
    expect(ok({ type: 'respawnEvent', senderSlot: 2, x: 1, y: 2 })).toBe(false);
    expect(ok({ type: 'fireEvent', senderSlot: 2, originX: 0, originY: 0, originZ: 0, endX: 1, endY: 1, endZ: 1, weaponId: 'rifle' })).toBe(true);
    expect(raw({ type: 'fireEvent', senderSlot: 2, originX: Number.NaN, originY: 0, originZ: 0, endX: 1, endY: 1, endZ: 1, weaponId: 'rifle' })).toBe(false);
  });

  it('a gooseThrown needs a sane origin and speed', () => {
    const thrown = { type: 'gooseThrown', senderSlot: 1, id: 'g', originX: 0, originY: 1, originZ: 0, velX: 0, velY: 5, velZ: 20, source: 'gooseToss' };
    expect(ok(thrown)).toBe(true);
    expect(ok({ ...thrown, velX: 1e200 })).toBe(false);
    expect(ok({ ...thrown, originY: -1e300 })).toBe(false);
  });

  it('a playerDied names real slots', () => {
    const died = { type: 'playerDied', senderSlot: 2, victimSlot: 2, killerSlot: 1 };
    expect(ok(died)).toBe(true);
    expect(ok({ ...died, killerSlot: null })).toBe(true);
    expect(ok({ ...died, victimSlot: 5 })).toBe(false);
    expect(ok({ ...died, killerSlot: 'host' })).toBe(false);
  });

  it('a hello needs a short name, a string or null token and a short list of short features', () => {
    const hello = { type: 'hello', username: 'Bo', rejoinToken: null, features: ['facility'] };
    expect(ok(hello)).toBe(true);
    expect(ok({ ...hello, rejoinToken: '0c6a1f1e-3a39-4f3c-9c7e-4a3b1f1a2b3c' })).toBe(true);
    expect(ok({ type: 'hello', username: 'Old', rejoinToken: null })).toBe(true);
    expect(ok({ ...hello, username: 42 })).toBe(false);
    expect(ok({ ...hello, username: 'x'.repeat(HELLO_USERNAME_MAX_LENGTH + 1) })).toBe(false);
    expect(ok({ ...hello, rejoinToken: undefined })).toBe(false);
    expect(ok({ ...hello, rejoinToken: 7 })).toBe(false);
    expect(ok({ ...hello, rejoinToken: 't'.repeat(1000) })).toBe(false);
    expect(ok({ ...hello, features: 'facility' })).toBe(false);
    expect(ok({ ...hello, features: [7] })).toBe(false);
    expect(ok({ ...hello, features: ['f'.repeat(1000)] })).toBe(false);
    expect(ok({ ...hello, features: Array.from({ length: 1000 }, () => 'facility') })).toBe(false);
  });

  it('a self slot message names a real slot', () => {
    expect(ok({ type: 'modeExplanationReady', slot: 2 })).toBe(true);
    expect(ok({ type: 'modeExplanationReady', slot: 'everyone' })).toBe(false);
    expect(ok({ type: 'hordePlayerEliminated', slot: 9 })).toBe(false);
    expect(ok({ type: 'playerReady', slot: -1, ready: true })).toBe(false);
  });
});
