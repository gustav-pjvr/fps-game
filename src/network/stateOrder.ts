/** A sender clock this far behind the last one seen means the sender's page restarted (a reload
 * resets performance.now() to zero), not a late packet: no snapshot is ever delayed this long. */
export const SENDER_RESTART_GAP_MS = 10_000;

/** Whether a snapshot sent at `sentAt` on the sender's clock is newer than the last state applied
 * from that sender (`lastAppliedAt`: its newest snapshot, death or respawn). Snapshots come over
 * the unreliable fast channel, so a late one must not move a player backwards in time: back to
 * where they stood before a respawn, or alive again after a death. A message with no clock (a
 * browser on an older build) is always accepted, as it was before the fast channel. */
export function acceptsSnapshot(lastAppliedAt: number | undefined, sentAt: number | undefined): boolean {
  if (sentAt === undefined || lastAppliedAt === undefined) return true;
  return sentAt > lastAppliedAt || sentAt < lastAppliedAt - SENDER_RESTART_GAP_MS;
}

/** The new floor after a death or respawn sent at `sentAt`: reliable events always apply, they only
 * raise the bar for the snapshots behind them. */
export function afterStateEvent(lastAppliedAt: number | undefined, sentAt: number | undefined): number | undefined {
  if (sentAt === undefined) return lastAppliedAt;
  if (lastAppliedAt === undefined || sentAt < lastAppliedAt - SENDER_RESTART_GAP_MS) return sentAt;
  return Math.max(lastAppliedAt, sentAt);
}

/** A sender clock for `t` that never repeats a value. Some browsers coarsen performance.now() (to
 * 16.7 or 100 ms with fingerprinting protection), so two snapshots 33 ms apart could carry the same
 * time and the strict comparison above would drop the second; each stamp is nudged past the last. */
export function createSendClock(now: () => number = () => performance.now()): () => number {
  let last = -Infinity;
  return () => {
    last = Math.max(now(), last + 0.01);
    return last;
  };
}
