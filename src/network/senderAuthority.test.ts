import { describe, expect, it } from 'vitest';
import { RELAYABLE_MESSAGE_TYPES } from './MatchMessageRouter.ts';
import { DIRECT_MESSAGE_TYPES } from './directLinks.ts';
import type { NetworkMessage } from './protocol.ts';
import { acceptsFromSender, HOST_AUTHORED_MESSAGE_TYPES, SENDER_SLOT_MESSAGE_TYPES, serverAccepts } from './senderAuthority.ts';

const hostOnly: NetworkMessage[] = [
  { type: 'matchStart', seed: 1, killLimit: 10, gooseDifficulty: 'normal', gameMode: 'default', weather: 'day', spawns: [], roster: [] },
  { type: 'hostLeftRoom' },
  { type: 'playerLeft', slot: 2 },
  { type: 'playerJoinedMatch', slot: 3, username: 'Ghost', isRejoin: false },
  { type: 'rosterUpdate', roster: [] },
  { type: 'lobbyReadyUpdate', readySlots: [0, 1] },
  { type: 'gooseExploded', id: 'g', x: 0, y: 0, z: 0 },
  { type: 'hordeCleared' },
  { type: 'bonusGooseKilled', killerSlot: 1 },
  { type: 'matchEnded', winnerSlot: 1, scoreboard: [{ slot: 1, score: 10 }] },
  { type: 'rosterSync', roster: [] },
  { type: 'goldenGooseState', carrierSlot: 1, x: 0, y: 0, z: 0 },
  { type: 'kothState', hill: [0, 0], next: [40, 0], radius: 8, moveIn: 30, hold: 'held', holder: 1, crown: 1, crownAt: null, push: false, teams: false, scores: [{ slot: 0, score: 4 }, { slot: 1, score: 9 }] },
  { type: 'linkQuality', links: [] },
  { type: 'pickupTaken', id: 1, slot: 1, respawnIn: 30 },
  { type: 'pickupState', available: '11' },
  { type: 'worldObjectState', doors: '1', breakers: '0' },
  { type: 'scoreboardSync', scores: [{ slot: 1, score: 9, deaths: 0 }] },
];

describe('acceptsFromSender: host-authored messages', () => {
  it.each(hostOnly.map((message) => [message.type, message] as const))('the host drops a %s from any guest', (_type, message) => {
    for (const guest of [1, 2, 3] as const) expect(acceptsFromSender(message, guest, 'host')).toBe(false);
  });

  it.each(hostOnly.map((message) => [message.type, message] as const))('a guest takes a %s from its host only, never over a direct link', (_type, message) => {
    expect(acceptsFromSender(message, 0, 'guest')).toBe(true);
    expect(acceptsFromSender(message, 2, 'guest')).toBe(false);
  });

  it('lists every host broadcast, and none of them is ever relayed or sent on a direct link', () => {
    for (const type of ['welcome', 'roomFull', 'gooseSpawned', 'gooseSnapshot', 'hordeGooseSpawned', 'hordeGooseSnapshot', 'hordeGooseExploded',
      'hordeGooseRemoved', 'hordeWaveStarted', 'hordeReset', 'hordeAmmoDropSpawned', 'hordeSyncState', 'bonusGooseSpawned', 'bonusGooseSnapshot',
      'pickupRespawned'] as const) {
      expect(HOST_AUTHORED_MESSAGE_TYPES.has(type)).toBe(true);
    }
    for (const type of HOST_AUTHORED_MESSAGE_TYPES) {
      expect(RELAYABLE_MESSAGE_TYPES.has(type)).toBe(false);
      expect(DIRECT_MESSAGE_TYPES.has(type)).toBe(false);
    }
  });
});

describe('acceptsFromSender: messages about their sender', () => {
  const snapshot: NetworkMessage = { type: 'playerSnapshot', senderSlot: 2, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100 };
  const died: NetworkMessage = { type: 'playerDied', senderSlot: 2, victimSlot: 2, killerSlot: 1 };
  const tick: NetworkMessage = { type: 'kothScoreTick', senderSlot: 2, score: 5 };
  const hit: NetworkMessage = { type: 'damageEvent', senderSlot: 2, targetSlot: 1, amount: 20 };

  it('the host takes them when they name the guest they came from', () => {
    for (const message of [snapshot, died, tick, hit]) expect(acceptsFromSender(message, 2, 'host')).toBe(true);
    expect(acceptsFromSender({ type: 'hordePlayerEliminated', slot: 2 }, 2, 'host')).toBe(true);
    expect(acceptsFromSender({ type: 'modeExplanationReady', slot: 2 }, 2, 'host')).toBe(true);
    expect(acceptsFromSender({ type: 'playerReady', slot: 2, ready: true }, 2, 'host')).toBe(true);
  });

  it('the host drops a guest speaking for another slot', () => {
    for (const message of [snapshot, died, tick, hit]) expect(acceptsFromSender(message, 3, 'host')).toBe(false);
    // A forged victim: guest 2 reporting guest 3's death (a free kill for slot 1).
    expect(acceptsFromSender({ type: 'playerDied', senderSlot: 2, victimSlot: 3, killerSlot: 1 }, 2, 'host')).toBe(false);
    expect(acceptsFromSender({ type: 'hordePlayerEliminated', slot: 3 }, 2, 'host')).toBe(false);
    expect(acceptsFromSender({ type: 'modeExplanationReady', slot: 0 }, 2, 'host')).toBe(false);
    expect(acceptsFromSender({ type: 'playerReady', slot: 1, ready: true }, 2, 'host')).toBe(false);
  });

  it('a guest takes what its host relays for any slot, but never a death whose victim is not its sender', () => {
    for (const message of [snapshot, died, tick, hit]) expect(acceptsFromSender(message, 0, 'guest')).toBe(true);
    expect(acceptsFromSender({ type: 'hordePlayerEliminated', slot: 3 }, 0, 'guest')).toBe(true);
    expect(acceptsFromSender({ type: 'playerDied', senderSlot: 2, victimSlot: 3, killerSlot: 1 }, 0, 'guest')).toBe(false);
  });

  it('a guest takes a direct link\'s message only when it names that link', () => {
    expect(acceptsFromSender(snapshot, 2, 'guest')).toBe(true);
    expect(acceptsFromSender(snapshot, 3, 'guest')).toBe(false);
  });

  it('passes messages that name no one', () => {
    expect(acceptsFromSender({ type: 'pickupClaim', id: 3 }, 2, 'host')).toBe(true);
    expect(acceptsFromSender({ type: 'worldInteract', kind: 'door', id: 4 }, 1, 'host')).toBe(true);
    expect(acceptsFromSender({ type: 'gooseThrowExploded', id: 'x', x: 0, y: 0, z: 0, source: 'gooseToss' }, 1, 'host')).toBe(true);
  });
});

describe('serverAccepts', () => {
  it('accepts host-authored messages only from slot 0', () => {
    for (const message of hostOnly) {
      expect(serverAccepts(message, 0)).toBe(true);
      for (const slot of [1, 2, 3] as const) expect(serverAccepts(message, slot)).toBe(false);
    }
  });

  it('requires host and guest self-reported messages to name their transport slot', () => {
    for (const slot of [0, 1, 2, 3] as const) {
      expect(serverAccepts({ type: 'kothScoreTick', senderSlot: slot, score: 1 }, slot)).toBe(true);
      expect(serverAccepts({ type: 'kothScoreTick', senderSlot: slot === 0 ? 1 : 0, score: 1 }, slot)).toBe(false);
      const selfMessages: NetworkMessage[] = [
        { type: 'playerReady', slot, ready: true },
        { type: 'hordePlayerEliminated', slot },
        { type: 'modeExplanationReady', slot },
        { type: 'meshHello', slot, roomCode: 'ABCDEF' },
      ];
      for (const message of selfMessages) {
        expect(serverAccepts(message, slot)).toBe(true);
        expect(serverAccepts(message, slot === 0 ? 1 : 0)).toBe(false);
      }
      expect(serverAccepts({ type: 'playerDied', senderSlot: slot, victimSlot: slot, killerSlot: null }, slot)).toBe(true);
      expect(serverAccepts({ type: 'playerDied', senderSlot: slot, victimSlot: slot === 0 ? 1 : 0, killerSlot: null }, slot)).toBe(false);
      expect(serverAccepts({ type: 'playerDied', senderSlot: slot === 0 ? 1 : 0, victimSlot: slot === 0 ? 1 : 0, killerSlot: null }, slot)).toBe(false);
      expect(serverAccepts({ type: 'pickupClaim', id: 1 }, slot)).toBe(true);
    }
  });

  it('drops a message of any type that declares senderSlot when it leaves the field out or names another slot', () => {
    // The list is checked against protocol.ts by the compiler (senderAuthority.ts); 27 types today.
    expect(SENDER_SLOT_MESSAGE_TYPES.size).toBe(27);
    for (const type of SENDER_SLOT_MESSAGE_TYPES) {
      expect(HOST_AUTHORED_MESSAGE_TYPES.has(type), type).toBe(false);
      for (const slot of [0, 1, 2, 3] as const) {
        expect(serverAccepts({ type } as NetworkMessage, slot), `${type} with no senderSlot from ${slot}`).toBe(false);
        expect(serverAccepts({ type, senderSlot: undefined } as unknown as NetworkMessage, slot), `${type} with senderSlot undefined`).toBe(false);
        expect(serverAccepts({ type, senderSlot: slot === 3 ? 2 : 3 } as unknown as NetworkMessage, slot), `${type} naming another slot`).toBe(false);
      }
    }
    // The two the audit named, now and with the field.
    expect(serverAccepts({ type: 'damageEvent', targetSlot: 2, amount: 100 } as unknown as NetworkMessage, 1)).toBe(false);
    expect(serverAccepts({ type: 'hordeGooseHitEvent', id: 'h1', damage: 999 } as unknown as NetworkMessage, 1)).toBe(false);
    expect(serverAccepts({ type: 'damageEvent', senderSlot: 1, targetSlot: 2, amount: 100 }, 1)).toBe(true);
    expect(serverAccepts({ type: 'hordeGooseHitEvent', senderSlot: 1, id: 'h1' }, 1)).toBe(true);
  });

  it('leaves the peer-to-peer check as it was: a P2P host still decides on senderSlot only when present', () => {
    expect(acceptsFromSender({ type: 'damageEvent', targetSlot: 2, amount: 100 } as unknown as NetworkMessage, 1, 'host')).toBe(true);
    expect(acceptsFromSender({ type: 'damageEvent', senderSlot: 2, targetSlot: 2, amount: 100 }, 1, 'host')).toBe(false);
  });
});
