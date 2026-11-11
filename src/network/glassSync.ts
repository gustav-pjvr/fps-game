/** Glass state across clients (docs/glass.md), on the lamps' pattern (network/lampSync.ts). Each
 * glassHit is sent once, and a client still loading drops it, so every client also re-broadcasts its
 * whole set of hit panes as one glassSync message: once when it first sees each opponent's
 * playerSnapshot (they are in the match and listening now, which is also how a late joiner is told),
 * and every GLASS_SYNC_INTERVAL seconds while the set has changed since the last broadcast.
 * Receivers keep the more damaged state of each pane, so the views only ever grow towards the same
 * windows. */

/** Seconds between periodic re-broadcasts of a changed set. */
export const GLASS_SYNC_INTERVAL = 5;

/** Decides when this client broadcasts its glass. Pure bookkeeping: the caller sends. `revision`
 * is GlassStore.revision, which rises with every change; 0 means no pane has been hit. */
export class GlassSyncTracker {
  private readonly seen = new Set<number>();
  private sentRevision = 0;
  private elapsed = 0;

  /** An opponent's playerSnapshot arrived: true the first time this slot is seen, when there is
   * something to tell. */
  opponentSnapshot(slot: number, revision: number): boolean {
    if (this.seen.has(slot)) return false;
    this.seen.add(slot);
    if (revision === 0) return false;
    this.sentRevision = revision;
    return true;
  }

  /** A slot left: if it comes back (a rejoin), its first snapshot triggers a send again. */
  forget(slot: number): void {
    this.seen.delete(slot);
  }

  /** Per frame: true when the interval has passed and the glass has changed since the last send. */
  update(dt: number, revision: number): boolean {
    this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.elapsed < GLASS_SYNC_INTERVAL) return false;
    this.elapsed = 0;
    if (revision === 0 || revision === this.sentRevision) return false;
    this.sentRevision = revision;
    return true;
  }
}
