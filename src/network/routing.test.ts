import { describe, expect, it } from 'vitest';
import { ALL_MESSAGE_TYPES, type NetworkMessage } from './protocol.ts';
import { RELAYABLE_MESSAGE_TYPES as ROUTER_RELAYABLE_MESSAGE_TYPES } from './MatchMessageRouter.ts';
import { DROPPED_TYPES, GUEST_TO_HOST_TYPES, HOST_BROADCAST_TYPES, RELAYABLE_MESSAGE_TYPES, SERVER_HANDLED_TYPES, routeClassOf, type RouteClass } from './routing.ts';

const classes: readonly [RouteClass, ReadonlySet<NetworkMessage['type']>, number][] = [
  ['R', RELAYABLE_MESSAGE_TYPES, 19],
  ['H', GUEST_TO_HOST_TYPES, 9],
  ['B', HOST_BROADCAST_TYPES, 29],
  ['S', SERVER_HANDLED_TYPES, 3],
  ['D', DROPPED_TYPES, 3],
];

describe('server routing', () => {
  it('classifies every protocol type exactly once, with the design totals', () => {
    expect(ALL_MESSAGE_TYPES.size).toBe(63);
    for (const [route, types, count] of classes) {
      expect(types.size).toBe(count);
      for (const type of types) {
        expect(ALL_MESSAGE_TYPES.has(type)).toBe(true);
        expect(routeClassOf(type)).toBe(route);
      }
    }
    for (const type of ALL_MESSAGE_TYPES) {
      expect(classes.filter(([, types]) => types.has(type))).toHaveLength(1);
      expect(routeClassOf(type)).toBe(classes.find(([, types]) => types.has(type))![0]);
    }
  });

  it('preserves the old relay set and the router re-export', () => {
    expect(ROUTER_RELAYABLE_MESSAGE_TYPES).toBe(RELAYABLE_MESSAGE_TYPES);
    expect(RELAYABLE_MESSAGE_TYPES).toEqual(new Set([
      'playerSnapshot', 'fireEvent', 'lampDestroyed', 'lampSync', 'grenadeThrown', 'grenadeDetonated',
      'damageEvent', 'playerDied', 'respawnEvent', 'footstepEvent', 'goosePickedUp', 'gooseThrown',
      'gooseThrowExploded', 'goldenGoosePickedUp', 'goldenGooseDropped', 'kothScoreTick',
      'hordePlayerEliminated', 'hordeAmmoDropPickedUp', 'modeExplanationReady',
    ]));
  });

  it('routes guest requests only to the host', () => {
    expect(GUEST_TO_HOST_TYPES).toEqual(new Set([
      'playerReady', 'gooseSyncRequest', 'gooseHitEvent', 'hordeGooseHitEvent', 'hordeSyncRequest',
      'bonusGooseHitEvent', 'worldInteract', 'pickupClaim', 'pickupSyncRequest',
    ]));
    expect(SERVER_HANDLED_TYPES).toEqual(new Set(['hello', 'welcome', 'roomFull']));
    expect(DROPPED_TYPES).toEqual(new Set(['meshHello', 'meshStatus', 'linkQuality']));
  });
});
