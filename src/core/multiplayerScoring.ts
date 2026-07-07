import type { PlayerSlot } from '../network/protocol.ts';

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
