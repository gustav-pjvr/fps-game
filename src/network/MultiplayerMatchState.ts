import { applyMatchDeath } from '../core/multiplayerScoring.ts';
import { KOTH_POINTS_TO_WIN } from '../core/config.ts';
import type { GameMode } from '../core/gameModes.ts';
import type { PlayerSlot } from './protocol.ts';

export interface MatchPlacement {
  readonly slot: PlayerSlot;
  readonly username: string;
  readonly score: number;
  readonly isYou: boolean;
}

/** Owns a multiplayer match's running scoreboard/death-count maps, the win-condition scan against
 * them, and the "has the match ended" flag - split out of Game.ts, which previously kept these as
 * three separate fields (`multiplayerScoreboard`, `multiplayerDeathCounts`, `matchEnded`) plus the
 * win-condition scan inline in updateMultiplayer() and the podium-building inline in
 * endMultiplayerMatch(). `scoreboard`/`deathCounts` stay plain public mutable Maps rather than
 * hiding them behind getter/setter methods - callers (MatchMessageRouter's kothScoreTick/
 * playerDied cases, KingOfTheHillController's own scoring) already mutate them directly the same
 * way Game.ts's fields were mutated before, and wrapping every single `.get`/`.set` in a forwarding
 * method would add no safety, just indirection.
 *
 * Deliberately does NOT own match-END side effects (releasing pointer lock, the
 * onMultiplayerMatchEnd callback, disposing the connection) - those depend on Game-owned systems
 * (InputManager, the callback Game.create() was handed) that have no business living here. Game's
 * own endMultiplayerMatch() still orchestrates those, calling markEnded()/buildPlacements() on this
 * class for the parts that are pure data/computation. */
export class MultiplayerMatchState {
  /** Every player's running kill count in the current multiplayer match, own slot included -
   * replaces the old single scoreState.value (mine)/multiplayerDeathCount (a 1v1-only proxy for
   * the one opponent's score) now that there can be up to 3 opponents. Updated symmetrically by
   * applyDeath for every playerDied this client sends or receives. */
  readonly scoreboard = new Map<PlayerSlot, number>();
  /** Every player's running death count - kept alongside the scoreboard for parity, though only
   * the scoreboard actually drives the win condition/podium. */
  readonly deathCounts = new Map<PlayerSlot, number>();
  /** True once the win condition (or a disconnect) has ended the match - freezes simulation the
   * same way `player.isDead` does, but permanently for the rest of the match instead of until a
   * respawn (see Game.update()'s own early-return on this). */
  private ended = false;

  get hasEnded(): boolean {
    return this.ended;
  }

  markEnded(): void {
    this.ended = true;
  }

  /** Seeds the scoreboard from whatever a late join/rejoin was handed (see
   * MultiplayerSession.initialScoreboard's own comment) - empty for a normal fresh match start. */
  seedFrom(entries: readonly { slot: PlayerSlot; score: number }[]): void {
    for (const entry of entries) this.scoreboard.set(entry.slot, entry.score);
  }

  /** Adopts the host's final scoreboard wholesale (see protocol.ts's MatchEndedMessage), so a guest's
   * podium matches the host's exactly even if a last playerDied/kothScoreTick was still in flight. */
  replaceScoreboard(entries: readonly { slot: PlayerSlot; score: number }[]): void {
    this.scoreboard.clear();
    for (const entry of entries) this.scoreboard.set(entry.slot, entry.score);
  }

  /** Applies one death's kill-credit to both maps - Goose Horde is co-op, so per explicit user
   * request nobody scores off a teammate's death (accidental friendly fire or otherwise), and this
   * mode has no kill-limit win condition anyway (see findWinner); Gun Game's winning kill needs the
   * launcher. The same rules MatchMessageRouter's 'playerDied' case applies (applyMatchDeath). */
  applyDeath(gameMode: GameMode, killLimit: number, payload: { victimSlot: PlayerSlot; killerSlot: PlayerSlot | null; killerWeaponId?: string }): void {
    applyMatchDeath(this.scoreboard, this.deathCounts, gameMode, killLimit, payload);
  }

  /** The win threshold for `gameMode`/`killLimit`, or null if this mode has no scoreboard-based win
   * condition at all. King of the Hill scores points (not kills) against a fixed KOTH_POINTS_TO_WIN
   * regardless of the host-chosen killLimit; Goose Horde is co-op survival with no scoreboard race -
   * its win/loss is driven entirely by HordeGooseManager.isCleared / the eliminated-slots set
   * instead (see Game.ts's own hordeCleared/hordeWipe handling). */
  private winThreshold(gameMode: GameMode, killLimit: number): number | null {
    if (gameMode === 'gooseHorde') return null;
    return gameMode === 'kingOfTheHill' ? KOTH_POINTS_TO_WIN : killLimit;
  }

  /** The first slot whose score has crossed the win threshold, or null if nobody has yet (or this
   * mode has no scoreboard win condition at all - see winThreshold). Every client runs this same
   * scan against its own copy of the scoreboard (kept in sync purely by relaying playerDied/
   * kothScoreTick messages), so no host adjudication is needed for everyone to converge on the same
   * outcome. */
  findWinner(gameMode: GameMode, killLimit: number): PlayerSlot | null {
    const threshold = this.winThreshold(gameMode, killLimit);
    if (threshold === null) return null;
    for (const [slot, score] of this.scoreboard) {
      if (score >= threshold) return slot;
    }
    return null;
  }

  /** The final podium for the match-end screen - every slot ever seen (via `usernames`, which never
   * shrinks even for a disconnected player - see ActiveMultiplayer.usernames's own comment), sorted
   * highest score first. */
  buildPlacements(usernames: ReadonlyMap<PlayerSlot, string>, ownSlot: PlayerSlot): MatchPlacement[] {
    return Array.from(usernames, ([slot, username]) => ({
      slot,
      username,
      score: this.scoreboard.get(slot) ?? 0,
      isYou: slot === ownSlot,
    })).sort((a, b) => b.score - a.score);
  }
}

/** Goose Horde's limited-lives loss condition (per explicit user request: "if both players have
 * used their respawns then they lose") - true once every currently-connected player has been
 * eliminated. Pulled out of Game.ts's checkHordeAllEliminated as a pure predicate over the two
 * numbers that actually decide the outcome (2026-07-10 review, Phase 6 test-coverage pass) so the
 * convergence condition itself can be unit tested without needing a live Game/multiplayer session -
 * Game.ts still owns every side effect (which reason string to end the match with, when to call
 * this at all). */
export function isHordeAllEliminated(eliminatedCount: number, connectedCount: number): boolean {
  return eliminatedCount >= connectedCount;
}
