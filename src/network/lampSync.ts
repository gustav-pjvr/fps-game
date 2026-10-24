/** Facility lamp state across clients (docs/facility-map.md, section 11). Each lampDestroyed is
 * sent once, and a client still loading (inside Game.create, a rematch, or a late joiner between
 * the host's welcome and the end of its load) drops it, so every client also re-broadcasts its full
 * dead-lamp set as one lampSync message: once when it first sees each opponent's playerSnapshot
 * (they are in the match and listening now), and every LAMP_SYNC_INTERVAL seconds while the set is
 * non-empty and has changed since the last broadcast. Receivers kill any listed lamp still lit, so
 * the sets only ever grow towards their union. */

/** Seconds between periodic re-broadcasts of a changed dead-lamp set. */
export const LAMP_SYNC_INTERVAL = 5;

/** At most this many entries of a received list are looked at, so a huge list from a misbehaving
 * peer costs little. A facility has about 100 to 150 lamps. */
export const LAMP_SYNC_MAX_SCAN = 4096;

/** The valid lamp indices in a received list: integers in [0, lampCount), at most lampCount of
 * them, kept in order. Invalid entries are skipped before the cap, so padding a list with junk
 * cannot push valid lamps past it; only the first LAMP_SYNC_MAX_SCAN entries are read. Anything that
 * is not an array gives none. */
export function parseLampList(value: unknown, lampCount: number): number[] {
  if (!Array.isArray(value)) return [];
  const lamps: number[] = [];
  for (let i = 0; i < value.length && i < LAMP_SYNC_MAX_SCAN && lamps.length < lampCount; i++) {
    const lamp: unknown = value[i];
    if (Number.isInteger(lamp) && (lamp as number) >= 0 && (lamp as number) < lampCount) lamps.push(lamp as number);
  }
  return lamps;
}

/** Decides when this client broadcasts its dead-lamp set. Pure bookkeeping: the caller sends. */
export class LampSyncTracker {
  private readonly seen = new Set<number>();
  private sentKey = '';
  private elapsed = 0;

  /** An opponent's playerSnapshot arrived: the set to send now, the first time this slot is seen
   * and only when there is something to tell, else null. */
  opponentSnapshot(slot: number, deadLamps: () => readonly number[]): number[] | null {
    if (this.seen.has(slot)) return null;
    this.seen.add(slot);
    const lamps = deadLamps();
    if (lamps.length === 0) return null;
    this.sentKey = lamps.join(',');
    return [...lamps];
  }

  /** A slot left: if it comes back (a rejoin), its first snapshot triggers a send again. */
  forget(slot: number): void {
    this.seen.delete(slot);
  }

  /** Per frame: the set to send when the interval has passed and it is non-empty and changed since
   * the last broadcast, else null. `deadLamps` is only read once per interval. */
  update(dt: number, deadLamps: () => readonly number[]): number[] | null {
    this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.elapsed < LAMP_SYNC_INTERVAL) return null;
    this.elapsed = 0;
    const lamps = deadLamps(), key = lamps.join(',');
    if (lamps.length === 0 || key === this.sentKey) return null;
    this.sentKey = key;
    return [...lamps];
  }
}
