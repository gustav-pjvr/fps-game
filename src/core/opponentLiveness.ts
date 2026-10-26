import { MULTIPLAYER_CONNECTION_TIMEOUT_MS, MULTIPLAYER_LOADING_TIMEOUT_MS, MULTIPLAYER_SETTLE_MS } from './config.ts';

/** The host's staleness sweep (Game.updateMultiplayer): whether an opponent counts as silent at
 * `now`. One that has been sending snapshots for MULTIPLAYER_SETTLE_MS must keep sending
 * (MULTIPLAYER_CONNECTION_TIMEOUT_MS). One that has not may still be building its world or compiling
 * its first frames, which can stall it far longer (the connection layer sends messages of its own
 * meanwhile), so it gets MULTIPLAYER_LOADING_TIMEOUT_MS after its last message of any kind.
 * `firstSnapshotAt` is null until its first snapshot; times are performance.now() milliseconds.
 * A dead opponent sends nothing until it respawns, and its respawn timer runs on its own frame time,
 * which a slow machine stretches well past the connection timeout, so it also gets the loading
 * allowance. "Has been sending" is measured up to its last message, not up to `now`: a late joiner or
 * rejoiner sends its first snapshot and can then stall for a minute compiling its first frames, and
 * timing the settle window from `now` declared it settled mid-stall and dropped it on the spot. */
export function isOpponentSilent(now: number, lastMessageAt: number, firstSnapshotAt: number | null, isDead = false): boolean {
  const settled = !isDead && firstSnapshotAt !== null && lastMessageAt - firstSnapshotAt >= MULTIPLAYER_SETTLE_MS;
  return now - lastMessageAt >= (settled ? MULTIPLAYER_CONNECTION_TIMEOUT_MS : MULTIPLAYER_LOADING_TIMEOUT_MS);
}

/** The liveness and state-order fields of an opponent (network/multiplayerMatchTypes.ts RemoteOpponent). */
export interface OpponentLivenessState {
  lastMessageAt: number;
  firstSnapshotAt: number | null;
  isDead: boolean;
  lastStateSentAt?: number;
}

/** A rejoin took over `opponent`'s slot before its old connection closed, so the same entry now
 * stands for a fresh page: just heard from, still loading (no snapshot yet), alive, and with a new
 * sender clock that starts near zero (the old floor would drop its snapshots, see stateOrder.ts).
 * Without this a takeover inherited a dead player's freeze and a long-settled clock, so the host's
 * sweep dropped the rejoiner the moment its first frames stalled. */
export function restartOpponentForRejoin(opponent: OpponentLivenessState, now: number): void {
  opponent.lastMessageAt = now;
  opponent.firstSnapshotAt = null;
  opponent.isDead = false;
  opponent.lastStateSentAt = undefined;
}
