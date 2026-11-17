import { HOST_SLOT, type NetworkMessage, type PlayerSlot } from './protocol.ts';

/**
 * Who may send what. Peers are untrusted: a modified client can put anything on its connection, so
 * every inbound message passes acceptsFromSender (PeerConnection.receive) before anything reads it,
 * in the lobby and in the match alike. `transportSlot` is the link it came in on: on the host the
 * guest's own connection, on a guest HOST_SLOT for the host connection or the other guest's slot for
 * a direct link (GuestMesh.ts).
 */

/** Messages only the host writes (protocol.ts: "Host -> ..."). The host drops them from anyone; a
 * guest takes them only from its host connection, never from a direct link. */
export const HOST_AUTHORED_MESSAGE_TYPES: ReadonlySet<NetworkMessage['type']> = new Set<NetworkMessage['type']>([
  'welcome',
  'rosterUpdate',
  'lobbyReadyUpdate',
  'roomFull',
  'matchStart',
  'worldObjectState',
  'hostLeftRoom',
  'playerLeft',
  'playerJoinedMatch',
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
  'hordeState',
  'bonusGooseSpawned',
  'bonusGooseSnapshot',
  'bonusGooseKilled',
  'matchEnded',
  'pickupTaken',
  'pickupRespawned',
  'pickupState',
  'rosterSync',
  'linkQuality',
  'goldenGooseState',
  'kothState',
  'scoreboardSync',
]);

/** Messages whose `slot` names the sender itself (its readiness, its elimination, its Skip, its
 * direct-link greeting), unlike the host's playerLeft or pickupTaken, whose `slot` names someone else. */
const SELF_SLOT_MESSAGE_TYPES: ReadonlySet<NetworkMessage['type']> = new Set<NetworkMessage['type']>([
  'playerReady',
  'hordePlayerEliminated',
  'modeExplanationReady',
  'meshHello',
]);

/** Whether `message`, arriving on the link to `transportSlot`, may be acted on by a client in `role`.
 * Host-authored types come only from the host. A message about its sender (a `senderSlot`, a self
 * `slot`, a death's `victimSlot`) must name the link it came in on; the one exception is what a guest
 * gets from its host, which relays other guests' messages unchanged and has already checked them. */
export function acceptsFromSender(message: NetworkMessage, transportSlot: PlayerSlot, role: 'host' | 'guest'): boolean {
  const fromHost = role === 'guest' && transportSlot === HOST_SLOT;
  if (HOST_AUTHORED_MESSAGE_TYPES.has(message.type)) return fromHost;
  const fields = message as { senderSlot?: unknown; slot?: unknown };
  // A victim is always the sender of its own death, relayed or not.
  if (message.type === 'playerDied' && message.victimSlot !== message.senderSlot) return false;
  if (fromHost) return true;
  if (fields.senderSlot !== undefined && fields.senderSlot !== transportSlot) return false;
  if (SELF_SLOT_MESSAGE_TYPES.has(message.type) && fields.slot !== transportSlot) return false;
  return true;
}

/** The message types whose interface declares `senderSlot`, required or optional. */
type SenderSlotMessageType = NetworkMessage extends infer M ? (M extends NetworkMessage ? ('senderSlot' extends keyof M ? M['type'] : never) : never) : never;

/** Every type that declares `senderSlot`, checked by the compiler: a Record over the type above, so a
 * new message with a `senderSlot` fails the typecheck until it is listed here, and so does a listed
 * one that loses it. */
const SENDER_SLOT_TYPE_LIST: Record<SenderSlotMessageType, true> = {
  playerSnapshot: true,
  fireEvent: true,
  lampDestroyed: true,
  lampSync: true,
  glassHit: true,
  glassSync: true,
  damageEvent: true,
  grenadeThrown: true,
  grenadeDetonated: true,
  playerDied: true,
  respawnEvent: true,
  footstepEvent: true,
  gooseHitEvent: true,
  gooseSyncRequest: true,
  goosePickedUp: true,
  gooseThrown: true,
  goldenGoosePickedUp: true,
  goldenGooseDropped: true,
  kothScoreTick: true,
  hordeGooseHitEvent: true,
  reviveEvent: true,
  ping: true,
  hordeAmmoDropPickedUp: true,
  bonusGooseHitEvent: true,
  hordeSyncRequest: true,
  pickupSyncRequest: true,
  meshStatus: true,
};

/** Messages that name their sender in `senderSlot`. The relay owns sender identity, so it requires
 * the field on every one of them (serverAccepts); a peer-to-peer host checks it only when present. */
export const SENDER_SLOT_MESSAGE_TYPES: ReadonlySet<NetworkMessage['type']> = new Set(Object.keys(SENDER_SLOT_TYPE_LIST) as SenderSlotMessageType[]);

/** Server side: may the member in `fromSlot` send this? A type that declares `senderSlot` must carry
 * the sender's own slot there, never leave it out (docs/server-relay-design.md, section 3.4). The
 * host may author host-authored types; everything else must name its own slot, exactly as today's
 * host checked its guests. */
export function serverAccepts(message: NetworkMessage, fromSlot: PlayerSlot): boolean {
  if (SENDER_SLOT_MESSAGE_TYPES.has(message.type) && (message as { senderSlot?: unknown }).senderSlot !== fromSlot) return false;
  if (fromSlot === HOST_SLOT && HOST_AUTHORED_MESSAGE_TYPES.has(message.type)) return true;
  return acceptsFromSender(message, fromSlot, 'host');
}
