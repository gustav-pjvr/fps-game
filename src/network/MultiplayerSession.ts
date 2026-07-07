import type { PeerConnection } from './PeerConnection.ts';
import type { SpawnPoint } from '../core/multiplayerSpawn.ts';

export type MultiplayerRole = 'host' | 'guest';

/** Handed from the room screens (CreateRoomScreen/JoinRoomScreen) into App.startMultiplayerMatch
 * once a match is actually starting - see MULTIPLAYER_PLAN.md §5. `seed`/`spawnA`/`spawnB` are
 * always the same values on both sides (the host generates/picks them once and sends them across,
 * see the MatchStartMessage comment in protocol.ts), never independently randomized per client. */
export interface MultiplayerSession {
  connection: PeerConnection;
  role: MultiplayerRole;
  seed: number;
  /** Win condition (MULTIPLAYER_PLAN.md §4) - the host's choice, carried on the same MatchStartMessage as `seed`. */
  killLimit: number;
  /** This match's two spawn points - host always at spawnA, guest always at spawnB. Picked fresh
   * by the host each match (see multiplayerSpawn.ts), not the fixed two-point layout the original
   * plan used. */
  spawnA: SpawnPoint;
  spawnB: SpawnPoint;
  /** Exchanged once via the `hello` handshake (see protocol.ts's HelloMessage), not re-sent on
   * every rematch - a player's name doesn't change mid-connection, so there's no need to thread it
   * through MatchStartMessage too. */
  ownUsername: string;
  opponentUsername: string;
}

/** Everything a matchStart message carries beyond the connection/role itself - used as one bundle
 * through the room screens -> App.ts handoff (see CreateRoomScreen/JoinRoomScreen's onStartMatch)
 * instead of growing that callback's positional parameter list every time this message gains
 * another field. */
export interface MultiplayerMatchStartParams {
  seed: number;
  killLimit: number;
  spawnA: SpawnPoint;
  spawnB: SpawnPoint;
  ownUsername: string;
  opponentUsername: string;
}
