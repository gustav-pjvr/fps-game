import type { PlayerSlot } from '../network/protocol.ts';
import type { GameMode } from './gameModes.ts';

/** The weapon Gun Game's winning kill must be made with (see modeControllers/GunGameController.ts). */
export const GUN_GAME_FINISHER_WEAPON = 'gooseLauncher';

/** Applies one received PlayerDiedMessage's kill-credit to the two running per-slot maps every
 * client keeps for the current match's scoreboard. Extracted as a standalone pure function (out
 * of Game.ts's onMessage switch) so it's unit-testable without a live Game instance - see
 * multiplayerScoring.test.ts. Mutates both maps in place, matching the Map-as-accumulator pattern
 * Game.ts already uses for these two fields. */
export function applyPlayerDied(
  scoreboard: Map<PlayerSlot, number>,
  deathCounts: Map<PlayerSlot, number>,
  message: { victimSlot: PlayerSlot; killerSlot: PlayerSlot | null },
): void {
  if (message.killerSlot !== null) {
    scoreboard.set(message.killerSlot, (scoreboard.get(message.killerSlot) ?? 0) + 1);
  }
  deathCounts.set(message.victimSlot, (deathCounts.get(message.victimSlot) ?? 0) + 1);
}

/** Gun Game's finisher: whoever is one kill from the limit must win with the Goose Launcher. The
 * grant (GunGameController.checkFinisherGrant) runs once a tick and swaps weapons asynchronously, so
 * two kills landing together, or one while the swap was in flight, used to take a player from two
 * short straight to the limit with an ordinary gun. So the rule lives in the scoring: the kill that
 * would reach the limit only counts when made with the launcher. A kill with no recorded weapon (an
 * older build) counts as before, and a kill limit of 1 has no finisher round at all. */
export function creditsKill(gameMode: GameMode, killLimit: number, killerScore: number, killerWeaponId: string | undefined): boolean {
  if (gameMode !== 'gunGame' || killLimit <= 1 || killerWeaponId === undefined) return true;
  return killerScore < killLimit - 1 || killerWeaponId === GUN_GAME_FINISHER_WEAPON;
}

/** One death under the match's own rules, applied the same way by every client (the victim for its
 * own death, everyone else from the playerDied message): Goose Horde is co-op and scores nothing,
 * and Gun Game's winning kill needs the launcher (creditsKill). The victim's death always counts.
 * Returns whether the killer was credited. */
export function applyMatchDeath(
  scoreboard: Map<PlayerSlot, number>,
  deathCounts: Map<PlayerSlot, number>,
  gameMode: GameMode,
  killLimit: number,
  payload: { victimSlot: PlayerSlot; killerSlot: PlayerSlot | null; killerWeaponId?: string },
): boolean {
  if (gameMode === 'gooseHorde') return false;
  const { killerSlot } = payload;
  const credited = killerSlot !== null && creditsKill(gameMode, killLimit, scoreboard.get(killerSlot) ?? 0, payload.killerWeaponId);
  applyPlayerDied(scoreboard, deathCounts, { victimSlot: payload.victimSlot, killerSlot: credited ? killerSlot : null });
  return credited;
}
