import { MULTIPLAYER_CONNECTION_TIMEOUT_MS, MULTIPLAYER_LOADING_TIMEOUT_MS, MULTIPLAYER_SETTLE_MS } from './config.ts';

/** The host's staleness sweep (Game.updateMultiplayer): whether an opponent counts as silent at
 * `now`. One that has been sending snapshots for MULTIPLAYER_SETTLE_MS must keep sending
 * (MULTIPLAYER_CONNECTION_TIMEOUT_MS). One that has not may still be building its world or compiling
 * its first frames, which can stall it far longer (the connection layer sends messages of its own
 * meanwhile), so it gets MULTIPLAYER_LOADING_TIMEOUT_MS after its last message of any kind.
 * `firstSnapshotAt` is null until its first snapshot; times are performance.now() milliseconds. */
export function isOpponentSilent(now: number, lastMessageAt: number, firstSnapshotAt: number | null): boolean {
  const settled = firstSnapshotAt !== null && now - firstSnapshotAt >= MULTIPLAYER_SETTLE_MS;
  return now - lastMessageAt >= (settled ? MULTIPLAYER_CONNECTION_TIMEOUT_MS : MULTIPLAYER_LOADING_TIMEOUT_MS);
}
