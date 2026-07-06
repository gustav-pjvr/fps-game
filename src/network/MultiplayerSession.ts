import type { PeerConnection } from './PeerConnection.ts';

export type MultiplayerRole = 'host' | 'guest';

/** Handed from the room screens (CreateRoomScreen/JoinRoomScreen) into App.startMultiplayerMatch
 * once a match is actually starting - see MULTIPLAYER_PLAN.md §5. `seed` is always the same value
 * on both sides (the host generates it once via generateMultiplayerSeed() and sends it across, see
 * the MatchStartMessage comment in protocol.ts), never independently randomized per client. */
export interface MultiplayerSession {
  connection: PeerConnection;
  role: MultiplayerRole;
  seed: number;
  /** Win condition (MULTIPLAYER_PLAN.md §4) - the host's choice, carried on the same MatchStartMessage as `seed`. */
  killLimit: number;
}
