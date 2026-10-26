import type { PeerConnection, MultiplayerRole } from './PeerConnection.ts';
import type { HostRoster } from './HostRoster.ts';
import type { SpawnPoint } from '../core/multiplayerSpawn.ts';
import type { PlayerSlot, RosterEntry } from './protocol.ts';
import type { GooseExplosionDifficulty, MatchMap, MatchWeather } from '../core/config.ts';
import type { GameMode } from '../core/gameModes.ts';

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
  /** Goose explosion blast radius/damage tuning - the host's choice, carried alongside killLimit
   * on the same MatchStartMessage/WelcomeMessage.activeMatch. */
  gooseDifficulty: GooseExplosionDifficulty;
  /** Loadout/damage-rules mode - the host's choice, multiplayer-only (single-player has no
   * concept of a mode), carried alongside killLimit/gooseDifficulty on the same messages. */
  gameMode: GameMode;
  /** Purely cosmetic/atmospheric lighting+fog choice - the host's choice, carried alongside
   * killLimit/gooseDifficulty/gameMode on the same messages. */
  weather: MatchWeather;
  map: MatchMap;
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
  /** True for a genuinely fresh match start (original Start Match click, or a rematch) - false
   * only for a mid-match late join/rejoin (see WelcomeMessage.activeMatch), where the match is
   * already live and every other player has long since dismissed their own briefing. Gates
   * Game.ts's mode-explanation briefing (see worldBriefingActive) - a late joiner must never
   * re-freeze/re-gate an already-running match for everyone else. */
  showModeExplanation: boolean;
  /** Facility only, a late join/rejoin only (see WelcomeMessage.activeMatch): lamps already shot
   * out, applied once the facility is built. */
  deadLamps?: number[];
  /** Facility only, a late join/rejoin only: the doors and breakers as the host has them
   * (docs/facility-map.md, section 12), applied once the facility is built. */
  worldObjects?: { doors: string; breakers: string; valleyDoors?: number[] };
}

/** Everything a matchStart message carries beyond the connection/role itself - used as one bundle
 * through the room screens -> App.ts handoff (see CreateRoomScreen/JoinRoomScreen's onStartMatch)
 * instead of growing that callback's positional parameter list every time this message gains
 * another field. */
export interface MultiplayerMatchStartParams {
  seed: number;
  killLimit: number;
  gooseDifficulty: GooseExplosionDifficulty;
  gameMode: GameMode;
  weather: MatchWeather;
  map: MatchMap;
  ownSlot: PlayerSlot;
  spawns: { slot: PlayerSlot; point: SpawnPoint }[];
  roster: RosterEntry[];
  roomCode: string;
  initialScoreboard: { slot: PlayerSlot; score: number }[];
  hostRoster?: HostRoster;
  showModeExplanation: boolean;
  /** Facility only, a late join/rejoin only (see WelcomeMessage.activeMatch): lamps already shot
   * out, applied once the facility is built. */
  deadLamps?: number[];
  /** Facility only, a late join/rejoin only: the doors and breakers as the host has them
   * (docs/facility-map.md, section 12), applied once the facility is built. */
  worldObjects?: { doors: string; breakers: string; valleyDoors?: number[] };
}
