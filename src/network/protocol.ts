/** Wire format for the multiplayer DataChannel - a discriminated union so every message every
 * client sends/receives is typed in one place. Host-relay star topology (up to
 * MULTIPLAYER_MAX_PLAYERS, see config.ts): every non-host client holds exactly one connection, to
 * the host; the host relays gameplay messages between guests (see PeerConnection.ts/Game.ts's
 * relay logic) transparently, unchanged, tagged with the ORIGINAL sender's own slot. */

/** Stable small identity for up to MULTIPLAYER_MAX_PLAYERS players in one room - slot 0 is always
 * the host, slots 1-3 are assigned to guests in join order by the host (see HostRoster.ts) and are
 * the one identity primitive threaded through every message and every per-opponent data structure
 * (RemotePlayer, HUD row, minimap dot, scoreboard entry) instead of a singular "opponent" field. */
export type PlayerSlot = 0 | 1 | 2 | 3;
export const HOST_SLOT: PlayerSlot = 0;

/** Sent guest -> host the moment a guest's connection opens, before it knows anything about the
 * room (no senderSlot - it doesn't have one yet, that's what WelcomeMessage grants).
 * `rejoinToken`, if present, lets the host recognize this as the same player reconnecting after a
 * mid-match drop (see HostRoster.ts's grace-period reservation) rather than a brand new player -
 * null on a guest's very first connection to a given room code (see core/multiplayerRejoin.ts). */
export interface HelloMessage {
  type: 'hello';
  username: string;
  rejoinToken: string | null;
}

/** One entry in the room roster - the same shape whether it's carried in a pre-match
 * WelcomeMessage/RosterUpdateMessage or a mid-match MatchStartMessage, so roster-rendering code
 * doesn't need two parsers. */
export interface RosterEntry {
  slot: PlayerSlot;
  username: string;
}

/** Host -> the one guest that just sent HelloMessage (targeted, not broadcast - see
 * PeerConnection.sendTo). Assigns that guest's slot and hands back the current full roster, so a
 * 3rd/4th joiner immediately sees who else is already there, not just the host. */
export interface WelcomeMessage {
  type: 'welcome';
  yourSlot: PlayerSlot;
  isRejoin: boolean;
  hostUsername: string;
  roster: RosterEntry[];
  /** Present only if the host was already mid-match when this hello resolved (a rejoin, or a
   * brand-new player joining after Start Match was clicked) - lets the joining client skip the
   * lobby-wait screen entirely and jump straight into the already-running match, since the host
   * only ever sends MatchStartMessage once, at the moment the match actually starts/restarts. */
  activeMatch?: {
    seed: number;
    killLimit: number;
    scoreboard: { slot: PlayerSlot; score: number }[];
    spawnPoint: { x: number; z: number };
  };
}

/** Host -> every already-connected guest (broadcast), sent whenever the pre-match lobby roster
 * changes (a new guest joined, or one disconnected before Start Match was ever clicked).
 * Deliberately distinct from the mid-match PlayerLeftMessage/PlayerJoinedMatchMessage pair below -
 * lobby roster UI and mid-match roster/scoreboard removal are different enough screens/logic that
 * reusing one shape would force one of them to carry fields the other never uses. */
export interface RosterUpdateMessage {
  type: 'rosterUpdate';
  roster: RosterEntry[];
}

/** Host -> a guest connection it is closing immediately because the room already has
 * MULTIPLAYER_MAX_PLAYERS - 1 guests (and no reserved/rejoinable slot matched this hello) - sent
 * once, right before that one DataConnection is closed; never reaches the room's other, already-
 * accepted parties. */
export interface RoomFullMessage {
  type: 'roomFull';
}

/** Host -> guests, right before everyone calls Game.create() (or, for a rematch, re-calls it on
 * the same still-open connections) - the seed/killLimit/spawn data needed for every client's world
 * to generate identically. `spawns` has one entry per roster slot in this match, looked up by
 * `slot` rather than array position, so it stays correct even if slot numbers aren't contiguous
 * (e.g. slot 2 left the lobby before slot 3 joined - the host never reuses a freed slot within one
 * room's lifetime). */
export interface MatchStartMessage {
  type: 'matchStart';
  seed: number;
  killLimit: number;
  spawns: { slot: PlayerSlot; x: number; z: number }[];
  roster: RosterEntry[];
}

/** Broadcast periodically by each client for its own player - the only state a RemotePlayer needs
 * to look right: where it is, which way it's facing, and its current health (piggybacked here
 * rather than a separate message - already sent at PLAYER_SNAPSHOT_SEND_INTERVAL, plenty fresh for
 * a live health display). `senderSlot` is required now that a client may have up to 3 possible
 * remote senders instead of exactly one. */
export interface PlayerSnapshotMessage {
  type: 'playerSnapshot';
  senderSlot: PlayerSlot;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
}

/** Sent by the shooter on every shot - purely cosmetic (tracer/muzzle flash/positional gunshot
 * audio), the hit itself (if any) is reported separately via DamageEventMessage. Not gated on
 * whether the shot actually hit anything - a miss still needs to show a tracer/play a sound on
 * every other receiving client. */
export interface FireEventMessage {
  type: 'fireEvent';
  senderSlot: PlayerSlot;
  originX: number;
  originY: number;
  originZ: number;
  endX: number;
  endY: number;
  endZ: number;
  weaponId: string;
}

/** Sent by the shooter (`senderSlot`, the attacker) when their own hitscan registers a hit on a
 * specific victim's RemotePlayer collider (`targetSlot`). Every client receives every
 * damageEvent (host relay is transparent - see Game.ts), but only the client whose own slot equals
 * `targetSlot` applies it to its own Player.takeDamage; everyone else ignores it for health
 * purposes. The *receiving* (targeted) client is what decides when it dies - each client stays
 * authoritative over its own health, the attacker never tells the victim's client "you're dead,"
 * only "you took N damage." */
export interface DamageEventMessage {
  type: 'damageEvent';
  senderSlot: PlayerSlot;
  targetSlot: PlayerSlot;
  amount: number;
}

/** Sent by a client to everyone the moment its own player's health reaches 0 - `victimSlot` is
 * always the sender's own slot (kept explicit/named for readability at every call site that reads
 * this for scoreboard purposes, even though it's redundant with `senderSlot`). `killerSlot` is the
 * dying client's own best-effort "who last damaged me" tracking (see Game.ts's
 * lastDamageSourceSlot) - null if untracked (e.g. died with no recorded attacker). Self-reported,
 * not host-adjudicated - consistent with the existing no-anti-cheat trust model (each client is
 * already authoritative over its own health, this just extends that to "who gets kill credit"). */
export interface PlayerDiedMessage {
  type: 'playerDied';
  senderSlot: PlayerSlot;
  victimSlot: PlayerSlot;
  killerSlot: PlayerSlot | null;
}

/** Sent once a dying player actually respawns - lets every other client's RemotePlayer for that
 * slot snap straight to the new spot instead of interpolating what would otherwise look like an
 * instant teleport-speed slide across the map. */
export interface RespawnEventMessage {
  type: 'respawnEvent';
  senderSlot: PlayerSlot;
  x: number;
  y: number;
  z: number;
}

/** Sent by the host when they click "Return to Lobby" from the podium/match-end screen - every
 * remaining guest's own client returns itself to the lobby on receiving this (see Game.ts's
 * onOpponentLeftRoom), since without it a guest would be stuck on that screen forever once the
 * host's connection just silently closes, with no signal to explain why. Now a real broadcast
 * (fans out to every currently-connected guest) rather than a single send. */
export interface HostLeftRoomMessage {
  type: 'hostLeftRoom';
}

/** Host -> everyone, the instant a guest's connection closes mid-match. Every remaining client
 * removes that slot's RemotePlayer/HUD row/minimap dot immediately and the match continues (per
 * user decision) - score/death-count entries are deliberately NOT deleted, so a later rejoin or
 * the final podium still reflects them. */
export interface PlayerLeftMessage {
  type: 'playerLeft';
  slot: PlayerSlot;
}

/** Host -> everyone, when a rejoin or a brand-new mid-match join completes - the same mechanism
 * serves both (a rejoin is just a hello whose token matched a still-reserved slot within its grace
 * period), which is why this carries `isRejoin` as a flag rather than being two message types.
 * Mirrors PlayerLeftMessage: every other client adds a fresh RemotePlayer/HUD row/minimap dot for
 * this slot. */
export interface PlayerJoinedMatchMessage {
  type: 'playerJoinedMatch';
  slot: PlayerSlot;
  username: string;
  isRejoin: boolean;
}

export type NetworkMessage =
  | HelloMessage
  | WelcomeMessage
  | RosterUpdateMessage
  | RoomFullMessage
  | MatchStartMessage
  | PlayerSnapshotMessage
  | FireEventMessage
  | DamageEventMessage
  | PlayerDiedMessage
  | RespawnEventMessage
  | HostLeftRoomMessage
  | PlayerLeftMessage
  | PlayerJoinedMatchMessage;

const MESSAGE_TYPES: ReadonlySet<NetworkMessage['type']> = new Set([
  'hello',
  'welcome',
  'rosterUpdate',
  'roomFull',
  'matchStart',
  'playerSnapshot',
  'fireEvent',
  'damageEvent',
  'playerDied',
  'respawnEvent',
  'hostLeftRoom',
  'playerLeft',
  'playerJoinedMatch',
]);

/** `DataConnection.on('data', ...)` hands back `unknown` (see peerjs's own types) - this is the one
 * place that boundary gets narrowed, so nothing downstream has to re-check message shape. */
export function isNetworkMessage(value: unknown): value is NetworkMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && MESSAGE_TYPES.has(type as NetworkMessage['type']);
}
