import type { NetworkMessage } from './protocol.ts';

/** Message types the host transparently re-broadcasts to every other connected guest, unchanged,
 * tagged with the original sender's own slot - see the doc on routeMatchMessage below.
 * Lobby/roster messages (hello/welcome/rosterUpdate/roomFull) and host-authored broadcasts
 * (matchStart/hostLeftRoom/playerLeft/playerJoinedMatch, the full list is senderAuthority.ts's
 * HOST_AUTHORED_MESSAGE_TYPES) are deliberately excluded - the host authors those itself, and the
 * connection drops any that arrive from a guest. */
export const RELAYABLE_MESSAGE_TYPES: ReadonlySet<NetworkMessage['type']> = new Set([
  'playerSnapshot',
  'fireEvent',
  'lampDestroyed',
  'lampSync',
  'glassHit',
  'glassSync',
  'grenadeThrown',
  'grenadeDetonated',
  'damageEvent',
  'playerDied',
  'respawnEvent',
  'footstepEvent',
  'goosePickedUp',
  'gooseThrown',
  'gooseThrowExploded',
  'hordePlayerEliminated',
  'reviveEvent',
  'ping',
  'hordeAmmoDropPickedUp',
  'modeExplanationReady',
]);

export const GUEST_TO_HOST_TYPES: ReadonlySet<NetworkMessage['type']> = new Set([
  'playerReady',
  'gooseSyncRequest',
  'gooseHitEvent',
  'hordeGooseHitEvent',
  'hordeSyncRequest',
  'bonusGooseHitEvent',
  'worldInteract',
  'pickupClaim',
  'pickupSyncRequest',
  'kothCrownClaim',
]);

export const HOST_BROADCAST_TYPES: ReadonlySet<NetworkMessage['type']> = new Set([
  'rosterUpdate',
  'lobbyReadyUpdate',
  'matchStart',
  'matchEnded',
  'scoreboardSync',
  'playerJoinedMatch',
  'playerLeft',
  'rosterSync',
  'hostLeftRoom',
  'gooseSpawned',
  'gooseSnapshot',
  'gooseExploded',
  'hordeGooseSpawned',
  'hordeGooseSnapshot',
  'hordeGooseExploded',
  'hordeGooseRemoved',
  'hordeWaveStarted',
  'hordeCleared',
  'hordeReset',
  'hordeAmmoDropSpawned',
  'hordeSyncState',
  'bonusGooseSpawned',
  'bonusGooseSnapshot',
  'bonusGooseKilled',
  'worldObjectState',
  'pickupTaken',
  'pickupRespawned',
  'pickupState',
  'kothState',
  'hordeState',
]);

export const SERVER_HANDLED_TYPES: ReadonlySet<NetworkMessage['type']> = new Set([
  'hello',
  'welcome',
  'roomFull',
]);

export const DROPPED_TYPES: ReadonlySet<NetworkMessage['type']> = new Set([
  'meshHello',
  'meshStatus',
  'linkQuality',
  // Retired with the v5.0.0 King of the Hill: kept in the protocol for older builds, read by no one.
  'kothScoreTick',
  'goldenGoosePickedUp',
  'goldenGooseDropped',
  'goldenGooseState',
]);

export type RouteClass = 'R' | 'H' | 'B' | 'S' | 'D';

/** Classify a game message for server routing (server-relay-design.md section 3.2). */
export function routeClassOf(type: NetworkMessage['type']): RouteClass {
  if (RELAYABLE_MESSAGE_TYPES.has(type)) return 'R';
  if (GUEST_TO_HOST_TYPES.has(type)) return 'H';
  if (HOST_BROADCAST_TYPES.has(type)) return 'B';
  if (SERVER_HANDLED_TYPES.has(type)) return 'S';
  if (DROPPED_TYPES.has(type)) return 'D';
  throw new Error('Unclassified message type: ' + type);
}
