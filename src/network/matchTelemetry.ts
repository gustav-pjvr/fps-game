/** Connection-quality stats for the match-end telemetry beacon (Game.sendMatchTelemetry, received by
 * functions/api/telemetry.ts): a before-and-after baseline for any future relay server. A small pure
 * accumulator with bounded memory: Game feeds it every HUD ping sample and every applied
 * playerSnapshot, and reads percentiles once, at match end. No timers, no DOM, no network. */

/** Samples kept per series. A long match at one ping per opponent per 2 s, or 20 snapshots a second
 * from three opponents, would otherwise grow without limit; past this the series is a uniform random
 * sample of everything seen (reservoir sampling), which keeps the percentiles unbiased. */
export const TELEMETRY_SAMPLE_CAP = 2048;

/** A gap between two applied snapshots from one opponent above this is a stall: the opponent's
 * avatar visibly froze (a snapshot goes out every ~50 ms). */
export const STALL_GAP_MS = 150;

/** A gap above this is not a network gap: the opponent died (a dead player sends no snapshots until
 * the respawn), left and rejoined, or sat on a loading screen. Left out of the gap series so one
 * death does not read as a ten-second stall. */
export const MAX_COUNTED_GAP_MS = 5000;

export interface MatchTelemetryStats {
  /** Median and 95th percentile of the HUD ping (ms, rounded); absent with no ping sample. */
  readonly pingP50?: number;
  readonly pingP95?: number;
  /** 95th percentile of the time between applied snapshots from one opponent (ms, rounded); absent
   * with no gap sample. */
  readonly snapshotGapP95?: number;
  /** Gaps over STALL_GAP_MS per minute of match time, two decimals. 0 when there was no match time. */
  readonly stallsPerMin: number;
  /** How many samples were seen (not just kept): the weight behind each percentile. */
  readonly pingSamples: number;
  readonly gapSamples: number;
}

/** Nearest-rank percentile of an ascending array; undefined when it is empty. */
export function percentile(sortedAscending: readonly number[], p: number): number | undefined {
  const n = sortedAscending.length;
  if (n === 0) return undefined;
  const rank = Math.min(n, Math.max(1, Math.ceil((p / 100) * n)));
  return sortedAscending[rank - 1];
}

/** Fixed-size uniform sample of a stream (Algorithm R). `seen` counts the whole stream. */
class Reservoir {
  private readonly values: number[] = [];
  seen = 0;

  constructor(
    private readonly cap: number,
    private readonly random: () => number,
  ) {}

  add(value: number): void {
    this.seen++;
    if (this.values.length < this.cap) {
      this.values.push(value);
      return;
    }
    const slot = Math.floor(this.random() * this.seen);
    if (slot < this.cap) this.values[slot] = value;
  }

  get stored(): number {
    return this.values.length;
  }

  sorted(): number[] {
    return [...this.values].sort((a, b) => a - b);
  }
}

export class MatchTelemetryAccumulator {
  private readonly pings: Reservoir;
  private readonly gaps: Reservoir;
  private readonly lastSnapshotAt = new Map<number, number>();
  private stalls = 0;

  /** `random` is injectable so a test can pin the reservoir's replacement choices. */
  constructor(cap: number = TELEMETRY_SAMPLE_CAP, random: () => number = Math.random) {
    this.pings = new Reservoir(cap, random);
    this.gaps = new Reservoir(cap, random);
  }

  /** One HUD ping sample (ms) for one opponent. Unknown or non-finite readings are ignored. */
  recordPing(rttMs: number | null | undefined): void {
    if (rttMs === null || rttMs === undefined || !Number.isFinite(rttMs) || rttMs < 0) return;
    this.pings.add(rttMs);
  }

  /** An applied playerSnapshot from `slot` arrived at `nowMs` (performance.now on receipt). The gap
   * since that slot's previous one is recorded; the first snapshot from a slot has no gap. */
  recordSnapshot(slot: number, nowMs: number): void {
    const previous = this.lastSnapshotAt.get(slot);
    this.lastSnapshotAt.set(slot, nowMs);
    if (previous === undefined) return;
    const gap = nowMs - previous;
    if (!(gap >= 0) || gap > MAX_COUNTED_GAP_MS) return;
    this.gaps.add(gap);
    if (gap > STALL_GAP_MS) this.stalls++;
  }

  /** Samples currently held in memory, both series together (never above twice the cap). */
  get storedSamples(): number {
    return this.pings.stored + this.gaps.stored;
  }

  summary(matchDurationMs: number): MatchTelemetryStats {
    const pings = this.pings.sorted();
    const gaps = this.gaps.sorted();
    const round = (value: number | undefined): number | undefined => (value === undefined ? undefined : Math.round(value));
    const minutes = matchDurationMs / 60000;
    return {
      pingP50: round(percentile(pings, 50)),
      pingP95: round(percentile(pings, 95)),
      snapshotGapP95: round(percentile(gaps, 95)),
      stallsPerMin: minutes > 0 && Number.isFinite(minutes) ? Math.round((this.stalls / minutes) * 100) / 100 : 0,
      pingSamples: this.pings.seen,
      gapSamples: this.gaps.seen,
    };
  }
}

/** The optional fields a multiplayer match adds to the beacon body (see functions/api/telemetry.ts,
 * which validates and clamps them). Fields that are unknown are left out, not sent as null. */
export interface MatchTelemetryExtras {
  transport?: 'p2p' | 'server';
  players?: number;
  pingP50?: number;
  pingP95?: number;
  snapshotGapP95?: number;
  stallsPerMin?: number;
  joinMs?: number;
}

export function buildMultiplayerTelemetryExtras(stats: MatchTelemetryStats, players: number, joinMs: number | null | undefined): MatchTelemetryExtras {
  const extras: MatchTelemetryExtras = { transport: 'p2p', players, stallsPerMin: stats.stallsPerMin };
  if (stats.pingP50 !== undefined) extras.pingP50 = stats.pingP50;
  if (stats.pingP95 !== undefined) extras.pingP95 = stats.pingP95;
  if (stats.snapshotGapP95 !== undefined) extras.snapshotGapP95 = stats.snapshotGapP95;
  if (joinMs !== null && joinMs !== undefined && Number.isFinite(joinMs)) extras.joinMs = Math.round(joinMs);
  return extras;
}
