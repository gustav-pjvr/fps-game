/**
 * The shared raycast budget for position picking (enemy AI v2, step 3). The Last of Us spent a
 * fixed number of rays per frame (160 on PS3) across every NPC rather than letting each one cast
 * freely; this does the same so a 50-enemy fight costs the same per tick as a 5-enemy one, just
 * with each enemy refreshing its spot less often.
 *
 * Pure: no Rapier, no clock of its own.
 */

export class RayBudget {
  private left: number;
  private exhausted = false;

  constructor(private readonly perTick: number) {
    this.left = perTick;
  }

  get remaining(): number {
    return this.left;
  }

  /** True if any request this tick got fewer rays than it asked for. */
  get exhaustedThisTick(): boolean {
    return this.exhausted;
  }

  beginTick(): void {
    this.left = this.perTick;
    this.exhausted = false;
  }

  /** Grants up to `wanted` rays (maybe fewer, maybe none). */
  take(wanted: number): number {
    const granted = Math.max(0, Math.min(wanted, this.left));
    this.left -= granted;
    if (granted < wanted) this.exhausted = true;
    return granted;
  }

  /** Returns rays a job was granted but did not use. */
  giveBack(unused: number): void {
    this.left = Math.min(this.perTick, this.left + Math.max(0, unused));
  }
}

export interface SchedulerTickStats {
  readonly ran: number;
  /** Jobs that were due but got no rays this tick (they stay due, stalest first next tick). */
  readonly deferred: number;
}

/**
 * Who refreshes their spot this tick. Each enemy that wants a spot is a job; a job is due once
 * `refreshInterval` has passed since it last ran, and due jobs run stalest first until the budget
 * runs out, so nobody starves: a deferred job is the stalest next tick.
 */
interface JobRecord {
  /** Squad clock time of the last run - decides whether the job is due. */
  lastRunAt: number;
  /** Order of the last run - decides who goes first among due jobs. A counter, not the time, so
   * jobs that ran in the same tick keep their order and the rotation stays strictly first-in
   * first-out (a time tie broken by id would always favour the lowest ids). */
  lastRunOrder: number;
}

export class TacticalScheduler {
  private readonly jobs = new Map<number, JobRecord>();
  private runCounter = 0;

  constructor(
    private readonly refreshInterval: number,
    private readonly maxRaysPerJob: number,
  ) {}

  /** Makes the job list exactly `ids`. A newly added enemy is due at once, ahead of everyone. */
  sync(ids: readonly number[]): void {
    const wanted = new Set(ids);
    for (const id of [...this.jobs.keys()]) {
      if (!wanted.has(id)) this.jobs.delete(id);
    }
    for (const id of ids) {
      if (!this.jobs.has(id)) this.jobs.set(id, { lastRunAt: Number.NEGATIVE_INFINITY, lastRunOrder: Number.NEGATIVE_INFINITY });
    }
  }

  /** Runs due jobs; `run` gets the rays it may spend and returns how many it actually used. */
  update(now: number, budget: RayBudget, run: (id: number, rayAllowance: number) => number): SchedulerTickStats {
    const due = [...this.jobs.entries()]
      .filter(([, job]) => now - job.lastRunAt >= this.refreshInterval)
      .sort(([idA, a], [idB, b]) => (a.lastRunOrder === b.lastRunOrder ? idA - idB : a.lastRunOrder - b.lastRunOrder));
    let ran = 0;
    for (const [id, job] of due) {
      const granted = budget.take(this.maxRaysPerJob);
      if (granted === 0) break;
      const used = run(id, granted);
      budget.giveBack(granted - used);
      job.lastRunAt = now;
      job.lastRunOrder = ++this.runCounter;
      ran++;
    }
    return { ran, deferred: due.length - ran };
  }

  clear(): void {
    this.jobs.clear();
  }
}
