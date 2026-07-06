/** Wire format for the multiplayer DataChannel (see MULTIPLAYER_PLAN.md §5) - a discriminated union
 * so every message both sides send/receive is typed in one place. `fireEvent`/`damageEvent`/
 * `respawnEvent`/`scoreUpdate`/`matchEnd` get added here as later phases actually need them, not
 * ahead of time. */
export interface HelloMessage {
  type: 'hello';
}

/** Host -> guest only, once, right before both sides call Game.create() - the single piece of
 * data that needs to cross the network for the whole world to generate identically on both
 * machines (see MULTIPLAYER_PLAN.md §1). Spawn point assignment isn't part of this message: it's
 * always host=A/guest=B, a fixed rule both sides already know (see the MULTIPLAYER_SPAWN_* comment
 * in config.ts), not something that needs negotiating per match. */
export interface MatchStartMessage {
  type: 'matchStart';
  seed: number;
}

/** Broadcast periodically by each client for its own player (MULTIPLAYER_PLAN.md §3) - the only
 * state a RemotePlayer needs to look right: where it is, which way it's facing, and what it's
 * holding (so the opponent's view model matches, once weapon visuals matter for combat sync). */
export interface PlayerSnapshotMessage {
  type: 'playerSnapshot';
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export type NetworkMessage = HelloMessage | MatchStartMessage | PlayerSnapshotMessage;

const MESSAGE_TYPES: ReadonlySet<NetworkMessage['type']> = new Set(['hello', 'matchStart', 'playerSnapshot']);

/** `DataConnection.on('data', ...)` hands back `unknown` (see peerjs's own types) - this is the one
 * place that boundary gets narrowed, so nothing downstream has to re-check message shape. */
export function isNetworkMessage(value: unknown): value is NetworkMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && MESSAGE_TYPES.has(type as NetworkMessage['type']);
}
