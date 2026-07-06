/** Wire format for the multiplayer DataChannel (see MULTIPLAYER_PLAN.md §5) - a discriminated union
 * so every message both sides send/receive is typed in one place. `scoreUpdate`/`matchEnd` still
 * aren't here - they're phase 4's job (host match settings/lifecycle), not needed for combat itself. */
export interface HelloMessage {
  type: 'hello';
}

/** Host -> guest, right before both sides call Game.create() - the single piece of data that
 * needs to cross the network for the whole world to generate identically on both machines (see
 * MULTIPLAYER_PLAN.md §1), plus the host's chosen win condition (§4) and this match's two spawn
 * points (host always at spawnA, guest always at spawnB - fixed for the match once picked, but the
 * points themselves are randomized fresh per match by the host - see multiplayerSpawn.ts - not the
 * fixed two-point layout the original plan used).
 *
 * Sent twice in a match's lifetime, not once: the initial send (from CreateRoomScreen) starts the
 * first match, and the host's "Rematch" button (MatchEndScreen, phase 4) sends a fresh one with a
 * new seed over the same still-open connection to start a second match without re-establishing the
 * room. Game.ts's onMessage handler treats *any* matchStart it receives mid-or-after a match as
 * that second case - the first one is always consumed by the room screen before Game.create() ever
 * attaches its own message handler. */
export interface MatchStartMessage {
  type: 'matchStart';
  seed: number;
  killLimit: number;
  spawnAX: number;
  spawnAZ: number;
  spawnBX: number;
  spawnBZ: number;
}

/** Broadcast periodically by each client for its own player (MULTIPLAYER_PLAN.md §3) - the only
 * state a RemotePlayer needs to look right: where it is, which way it's facing, and what it's
 * holding (so the opponent's view model matches, once weapon visuals matter for combat sync).
 * `health` piggybacks on this same message rather than a separate one - it's already sent at
 * PLAYER_SNAPSHOT_SEND_INTERVAL (~30Hz), plenty fresh for a live opponent health display, and a
 * second message type would just be more protocol surface for the same delivery guarantee this
 * one already has. */
export interface PlayerSnapshotMessage {
  type: 'playerSnapshot';
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
}

/** Sent by the shooter on every shot (MULTIPLAYER_PLAN.md §3's "drives muzzle flash/tracer on the
 * receiving end too, so both players see the same shot") - purely cosmetic, the hit itself (if any)
 * is reported separately via DamageEventMessage. Not gated on whether the shot actually hit
 * anything - a miss still needs to show a tracer on the receiving end. */
export interface FireEventMessage {
  type: 'fireEvent';
  originX: number;
  originY: number;
  originZ: number;
  endX: number;
  endY: number;
  endZ: number;
}

/** Sent by the shooter when their own hitscan registers a hit on the opponent's RemotePlayer
 * collider. The *receiving* client is what actually applies this to its own Player.takeDamage and
 * decides when it dies - each client stays authoritative over its own health (MULTIPLAYER_PLAN.md
 * §3/§6), the shooter never tells the victim's client "you're dead," only "you took N damage." */
export interface DamageEventMessage {
  type: 'damageEvent';
  amount: number;
}

/** Sent by a client to its opponent the moment its own player's health reaches 0 - this is how the
 * *other* client learns it scored a kill (it has no visibility into the victim's actual health,
 * only whatever damage it's dealt), and is what drives their score/kill-feed update. */
export interface PlayerDiedMessage {
  type: 'playerDied';
}

/** Sent once a dying player actually respawns (MULTIPLAYER_PLAN.md §4a) - lets the opponent's
 * RemotePlayer snap straight to the new spot instead of interpolating what would otherwise look
 * like an instant teleport-speed slide across the map. */
export interface RespawnEventMessage {
  type: 'respawnEvent';
  x: number;
  y: number;
  z: number;
}

export type NetworkMessage =
  | HelloMessage
  | MatchStartMessage
  | PlayerSnapshotMessage
  | FireEventMessage
  | DamageEventMessage
  | PlayerDiedMessage
  | RespawnEventMessage;

const MESSAGE_TYPES: ReadonlySet<NetworkMessage['type']> = new Set([
  'hello',
  'matchStart',
  'playerSnapshot',
  'fireEvent',
  'damageEvent',
  'playerDied',
  'respawnEvent',
]);

/** `DataConnection.on('data', ...)` hands back `unknown` (see peerjs's own types) - this is the one
 * place that boundary gets narrowed, so nothing downstream has to re-check message shape. */
export function isNetworkMessage(value: unknown): value is NetworkMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && MESSAGE_TYPES.has(type as NetworkMessage['type']);
}
