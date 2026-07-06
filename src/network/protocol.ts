/** Wire format for the multiplayer DataChannel (see MULTIPLAYER_PLAN.md §5) - a discriminated union
 * so every message both sides send/receive is typed in one place. Phase 1 only needs `hello` (prove
 * the connection works); `seed`/`matchSettings`/`playerSnapshot`/`fireEvent`/`damageEvent`/
 * `respawnEvent`/`scoreUpdate`/`matchEnd` get added here as later phases actually need them, not
 * ahead of time. */
export interface HelloMessage {
  type: 'hello';
}

export type NetworkMessage = HelloMessage;

/** `DataConnection.on('data', ...)` hands back `unknown` (see peerjs's own types) - this is the one
 * place that boundary gets narrowed, so nothing downstream has to re-check message shape. */
export function isNetworkMessage(value: unknown): value is NetworkMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'hello';
}
