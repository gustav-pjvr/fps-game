import type { PeerConnection, MultiplayerRole } from './PeerConnection.ts';
import type { HostRoster } from './HostRoster.ts';
import type { SpawnPoint } from '../core/multiplayerSpawn.ts';
import type { PlayerSlot, RosterEntry } from './protocol.ts';

export type { MultiplayerRole };

/** Handed from the room screens (CreateRoomScreen/JoinRoomScreen) into App.startMultiplayerMatch
 * once a match is actually starting. `seed`/`spawns`/`roster` are always the same values on every
 * client (the host generates/picks them once and sends them across, see the MatchStartMessage
 * comment in protocol.ts), never independently randomized per client. */
export interface MultiplayerSession {
  connection: PeerConnection;
  role: MultiplayerRole;
  ownSlot: PlayerSlot;
  seed: number;
  /** Win condition - the host's choice, carried on the same MatchStartMessage as `seed`. */
  killLimit: number;
  /** This match's spawn points, one per roster slot - looked up by `slot`, not array position
   * (see MatchStartMessage's own comment on why). Picked fresh each match/rematch/late-join (see
   * multiplayerSpawn.ts), not a fixed layout. */
  spawns: { slot: PlayerSlot; point: SpawnPoint }[];
  /** Usernames for every slot in this match, own included - exchanged once via the `hello`/
   * `welcome` handshake (see protocol.ts), not re-sent on every rematch since a player's name
   * doesn't change mid-connection. */
  roster: RosterEntry[];
  /** Known locally by whichever room screen started this session (the host generated it, the
   * guest typed it) - threaded through purely so MultiplayerHud can display it persistently
   * during the match (per user request: "constantly show the lobby code somewhere"), not because
   * it crosses the network anywhere. */
  roomCode: string;
  /** Non-empty only for a late join/rejoin (see WelcomeMessage.activeMatch) - seeds Game.ts's own
   * scoreboard so a player who joins or reconnects mid-match doesn't appear to start everyone back
   * at 0. Empty for a normal fresh match start (see App.ts's createMultiplayerGame). */
  initialScoreboard: { slot: PlayerSlot; score: number }[];
  /** Host-only, undefined for a guest - the same HostRoster instance CreateRoomScreen used for the
   * pre-match lobby, carried forward so mid-match join/rejoin hello resolution (see Game.ts's
   * onHostHello) continues using the one roster/rejoin-token state machine for this room's whole
   * lifetime rather than losing it at the lobby/match boundary. */
  hostRoster?: HostRoster;
}

/** Everything a matchStart message carries beyond the connection/role itself - used as one bundle
 * through the room screens -> App.ts handoff (see CreateRoomScreen/JoinRoomScreen's onStartMatch)
 * instead of growing that callback's positional parameter list every time this message gains
 * another field. */
export interface MultiplayerMatchStartParams {
  seed: number;
  killLimit: number;
  ownSlot: PlayerSlot;
  spawns: { slot: PlayerSlot; point: SpawnPoint }[];
  roster: RosterEntry[];
  roomCode: string;
  initialScoreboard: { slot: PlayerSlot; score: number }[];
  hostRoster?: HostRoster;
}
