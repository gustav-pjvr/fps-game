import type { RemotePlayer } from '../entities/RemotePlayer.ts';
import type { Minimap } from '../ui/minimap.ts';
import type { MultiplayerHud } from '../ui/multiplayerHud.ts';
import type { MultiplayerSession } from './MultiplayerSession.ts';
import type { HostRoster } from './HostRoster.ts';
import type { PlayerSlot } from './protocol.ts';
import type { GooseExplosionDifficulty, MatchWeather } from '../core/config.ts';
import type { GameMode } from '../core/gameModes.ts';

/** One other player currently in the match - keyed by slot in ActiveMultiplayer.opponents below,
 * replacing the old single `remotePlayer`/`opponentHealth` fields now that there can be up to 3. */
export interface RemoteOpponent {
  readonly slot: PlayerSlot;
  readonly remotePlayer: RemotePlayer;
  username: string;
  /** Piggybacked on their own playerSnapshot messages - this client has no other way to know it,
   * since it's never authoritative over another player's health. Starts at full health, matching
   * what a freshly spawned/joined opponent actually has before their first snapshot arrives. */
  health: number;
  /** Host-only liveness tracking (see MULTIPLAYER_CONNECTION_TIMEOUT_MS's own comment) - updated on
   * every message received from this slot, not just playerSnapshot. Unused on a guest's own client
   * (guests never run the staleness sweep - see updateMultiplayer). */
  lastMessageAt: number;
}

/** Everything Game tracks about an in-progress multiplayer match beyond the MultiplayerSession it
 * was handed (see network/MultiplayerSession.ts) - the parts that only exist once the match is
 * actually running, not at hand-off time. `snapshotAccumulator` is mutated every tick (see
 * update()); the object itself is still only ever assigned once, at construction. */
export interface ActiveMultiplayer {
  readonly session: MultiplayerSession;
  /** Every OTHER player currently connected to the match, keyed by slot. Entries are removed on a
   * mid-match disconnect (playerLeft) and re-added on a rejoin/late-join (playerJoinedMatch) - see
   * the onMessage handling in create(). */
  readonly opponents: Map<PlayerSlot, RemoteOpponent>;
  /** Every slot ever seen in this match, own included, NEVER removed (unlike `opponents` above) -
   * a disconnected player's name/score still needs to show correctly on the final podium. */
  readonly usernames: Map<PlayerSlot, string>;
  readonly minimap: Minimap;
  readonly multiplayerHud: MultiplayerHud;
  /** Win condition: first to this many kills wins. Fixed for the match - the host's choice at
   * room-creation time, carried on MatchStartMessage. */
  readonly killLimit: number;
  /** Goose explosion blast radius/damage tuning - the host's choice, fixed for the match, carried
   * on MatchStartMessage alongside killLimit. */
  readonly gooseDifficulty: GooseExplosionDifficulty;
  /** Loadout/damage-rules mode - the host's choice, fixed for the match, carried on
   * MatchStartMessage alongside killLimit/gooseDifficulty. Drives both the initial
   * WeaponManager.create() call (see create()) and Gun Game's kill-upgrade hook (see the
   * 'playerDied' case below). */
  readonly gameMode: GameMode;
  /** Cosmetic lighting/fog choice, fixed for the match - carried here (not just applied once via
   * the matchWeather field) so a late-joining/rejoining guest's WelcomeMessage.activeMatch can
   * still report it (see onHostHello below). */
  readonly weather: MatchWeather;
  /** Host-only (see MultiplayerSession.hostRoster) - non-null exactly when role==='host', used to
   * resolve a mid-match join/rejoin's hello (see onHostHello below) and to periodically free
   * expired rejoin reservations (see hostSweepAccumulator). */
  readonly hostRoster: HostRoster | null;
  snapshotAccumulator: number;
  /** Host-only throttle for HostRoster.sweepExpiredReservations - there's no separate server tick
   * to hang this off of (the host IS just another player's own tab), so it's polled from this
   * client's own update loop instead, at a coarse interval rather than every frame. */
  hostSweepAccumulator: number;
  /** Counts up while this client's own player is dead; 0 whenever alive. Compared against
   * MULTIPLAYER_RESPAWN_DELAY in updateMultiplayer() to trigger the automatic respawn. */
  deathTimer: number;
  /** This client's own best-effort "who last damaged me" tracking for kill-credit (see
   * protocol.ts's PlayerDiedMessage doc) - reset to null on respawn/match start. */
  lastDamageSourceSlot: PlayerSlot | null;
  /** Goose Horde co-op only (per explicit user request): this client's own count of respawns
   * already used, out of HORDE_MAX_RESPAWNS - self-authoritative, same trust model as everything
   * else this client alone decides about itself. Once it reaches HORDE_MAX_RESPAWNS, the next
   * death permanently eliminates this player instead of auto-respawning (see updateMultiplayer). */
  hordeRespawnsUsed: number;
  /** Every slot known to be permanently eliminated (respawns exhausted) - includes this client's
   * own slot once it's out. Populated by the self-reported 'hordePlayerEliminated' broadcast, so
   * every client converges on the same set without host adjudication. When this covers every
   * currently-connected roster slot, the whole co-op run ends in a loss (every client decides this
   * identically, same "converge on the same relayed events" pattern used for other win conditions). */
  hordeEliminatedSlots: Set<PlayerSlot>;
}
