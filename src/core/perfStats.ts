/**
 * Once-a-second performance log (enemy AI v2, task 3 - see docs/enemy-ai-v2.md). The F3 overlay
 * shows a live number to a person watching; this records a row per second that a script (or a
 * person with the console open) can read back afterwards and compare across builds: frame rate,
 * where the fixed-step tick spends its time (physics / world streaming / entity AI), render
 * submission time, raycasts per second, and how many enemies sit in each AI state.
 *
 * Always recording (one small object per second, capped), printing only when asked: load the game
 * with `?perflog` in the URL, or press F4 in a match. Read the rows back with
 * `window.__gameDebug.getPerfLog()`.
 *
 * Per-tick section times (physics, world, ai) are CPU work and stay comparable even in the
 * SwiftShader test sandbox, where FPS itself is meaningless (see PERFORMANCE.md). Frame rate and
 * render time need real hardware.
 */

/** Incremented by castHitscan (combat/hitscan.ts) - every raycast in the game goes through it, so
 * this is the total for player shots, enemy line-of-sight, enemy shots and steering whiskers. */
export const perfCounters = {
  raycasts: 0,
  /** The part of `raycasts` spent on enemy position picking (EntityManager's tactical probe). */
  tacticalRaycasts: 0,
  /** Ticks on which some enemy wanted more position-picking rays than the shared budget had left. */
  rayBudgetExhaustedTicks: 0,
  /** Spots enemies committed to, and how many of those they then found they could not reach - the
   * step 7 navmesh trigger (docs/enemy-ai-v2.md). Cumulative for the page, like `raycasts`. */
  tacticalPicks: 0,
  tacticalPicksUnreachable: 0,
};

export type PerfSection = 'physics' | 'world' | 'ai' | 'render';

export interface PerfContext {
  /** EntityManager.getLiveEntityStates() - undefined entries are targets, which have no AI. */
  readonly states: readonly (string | undefined)[];
  readonly drawCalls: number;
  readonly triangles: number;
}

export interface PerfLogEntry {
  /** Seconds since the logger started (match start). */
  readonly t: number;
  readonly fps: number;
  readonly frameMsAvg: number;
  readonly frameMsP95: number;
  readonly frameMsMax: number;
  /** Fixed-step updates that ran in this window (60 per second when the game keeps up). */
  readonly ticks: number;
  /** Average milliseconds per tick. */
  readonly physicsMs: number;
  readonly worldMs: number;
  readonly aiMs: number;
  /** Worst single tick's AI time in this window - catches a spike an average hides. */
  readonly aiMsMax: number;
  /** Average milliseconds per frame spent submitting the scene to WebGL (CPU side only). */
  readonly renderMs: number;
  readonly raycastsPerSec: number;
  /** Position-picking rays per second (already included in raycastsPerSec). */
  readonly tacticalRaysPerSec: number;
  /** Percent of this window's ticks on which the position-picking ray budget ran short. */
  readonly budgetExhaustedPercent: number;
  /** Spots picked so far, and the percent of those found unreachable (cumulative). */
  readonly tacticalPicks: number;
  readonly unreachablePercent: number;
  readonly enemies: number;
  readonly states: Readonly<Record<string, number>>;
  readonly drawCalls: number;
  readonly triangles: number;
  /** Chrome-only (performance.memory); null elsewhere. */
  readonly heapMb: number | null;
}

export interface PerfLoggerOptions {
  consoleEnabled: boolean;
  now?: () => number;
  sink?: (line: string) => void;
}

const EMIT_INTERVAL_MS = 1000;
/** Fifteen minutes of rows - plenty for a play session, bounded so it never grows without limit. */
const MAX_ENTRIES = 900;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function readHeapMb(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? round2(memory.usedJSHeapSize / (1024 * 1024)) : null;
}

export function formatPerfLine(entry: PerfLogEntry): string {
  const states = Object.entries(entry.states)
    .map(([state, count]) => `${state} ${count}`)
    .join(', ');
  const heap = entry.heapMb === null ? '' : ` | heap ${entry.heapMb.toFixed(0)}MB`;
  return (
    `[perf] t=${entry.t.toFixed(0)}s | fps ${entry.fps.toFixed(0)} | frame ${entry.frameMsAvg.toFixed(1)}/${entry.frameMsP95.toFixed(1)}/${entry.frameMsMax.toFixed(1)}ms avg/p95/max` +
    ` | ticks ${entry.ticks} | per tick: physics ${entry.physicsMs.toFixed(2)} world ${entry.worldMs.toFixed(2)} ai ${entry.aiMs.toFixed(2)} (max ${entry.aiMsMax.toFixed(2)})ms` +
    ` | render ${entry.renderMs.toFixed(1)}ms | rays ${entry.raycastsPerSec}/s (tactical ${entry.tacticalRaysPerSec}/s, budget out ${entry.budgetExhaustedPercent.toFixed(0)}% of ticks)` +
    ` | spots ${entry.tacticalPicks} (${entry.unreachablePercent.toFixed(0)}% unreachable) | enemies ${entry.enemies}${states ? ` (${states})` : ''}` +
    ` | draws ${entry.drawCalls} tris ${entry.triangles}${heap}`
  );
}

export class PerfLogger {
  private readonly entries: PerfLogEntry[] = [];
  private readonly now: () => number;
  private readonly sink: (line: string) => void;
  private readonly startTime: number;
  private consoleEnabled: boolean;

  private windowStart: number;
  private frameTimes: number[] = [];
  private ticks = 0;
  private physicsTotal = 0;
  private worldTotal = 0;
  private aiTotal = 0;
  private aiMax = 0;
  private renderTotal = 0;
  private raycastsAtWindowStart: number;
  private tacticalRaysAtWindowStart: number;
  private exhaustedTicksAtWindowStart: number;

  constructor(options: PerfLoggerOptions) {
    this.now = options.now ?? (() => performance.now());
    this.sink = options.sink ?? ((line) => console.info(line));
    this.consoleEnabled = options.consoleEnabled;
    this.startTime = this.now();
    this.windowStart = this.startTime;
    this.raycastsAtWindowStart = perfCounters.raycasts;
    this.tacticalRaysAtWindowStart = perfCounters.tacticalRaycasts;
    this.exhaustedTicksAtWindowStart = perfCounters.rayBudgetExhaustedTicks;
  }

  get log(): readonly PerfLogEntry[] {
    return this.entries;
  }

  get isConsoleEnabled(): boolean {
    return this.consoleEnabled;
  }

  toggleConsole(): boolean {
    this.consoleEnabled = !this.consoleEnabled;
    return this.consoleEnabled;
  }

  /** The current time on this logger's clock - the start value for endSection. */
  mark(): number {
    return this.now();
  }

  recordFrame(frameMs: number): void {
    this.frameTimes.push(frameMs);
  }

  recordTick(): void {
    this.ticks += 1;
  }

  /** Adds the time since `sectionStart` to `section` and returns the current time, so consecutive
   * sections chain without an extra clock read between them. */
  endSection(section: PerfSection, sectionStart: number): number {
    const now = this.now();
    const ms = now - sectionStart;
    switch (section) {
      case 'physics':
        this.physicsTotal += ms;
        break;
      case 'world':
        this.worldTotal += ms;
        break;
      case 'ai':
        this.aiTotal += ms;
        if (ms > this.aiMax) this.aiMax = ms;
        break;
      case 'render':
        this.renderTotal += ms;
        break;
    }
    return now;
  }

  /** Call once per rendered frame. Emits (records, and prints when enabled) a row once at least a
   * second has passed since the last one; `getContext` is only evaluated then. */
  maybeEmit(getContext: () => PerfContext): PerfLogEntry | null {
    const now = this.now();
    const elapsedMs = now - this.windowStart;
    if (elapsedMs < EMIT_INTERVAL_MS) return null;

    const entry = this.buildEntry(now, elapsedMs, getContext());
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    if (this.consoleEnabled) this.sink(formatPerfLine(entry));
    this.resetWindow(now);
    return entry;
  }

  private buildEntry(now: number, elapsedMs: number, context: PerfContext): PerfLogEntry {
    const frames = this.frameTimes.length;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const frameMsAvg = frames > 0 ? sorted.reduce((sum, ms) => sum + ms, 0) / frames : 0;
    const frameMsP95 = frames > 0 ? sorted[Math.min(frames - 1, Math.floor(frames * 0.95))]! : 0;
    const frameMsMax = frames > 0 ? sorted[frames - 1]! : 0;
    const perTick = (total: number): number => (this.ticks > 0 ? round2(total / this.ticks) : 0);

    const states: Record<string, number> = {};
    let enemies = 0;
    for (const state of context.states) {
      if (state === undefined || state === null) continue;
      enemies += 1;
      states[state] = (states[state] ?? 0) + 1;
    }

    return {
      t: round2((now - this.startTime) / 1000),
      fps: round2(frames / (elapsedMs / 1000)),
      frameMsAvg: round2(frameMsAvg),
      frameMsP95: round2(frameMsP95),
      frameMsMax: round2(frameMsMax),
      ticks: this.ticks,
      physicsMs: perTick(this.physicsTotal),
      worldMs: perTick(this.worldTotal),
      aiMs: perTick(this.aiTotal),
      aiMsMax: round2(this.aiMax),
      renderMs: frames > 0 ? round2(this.renderTotal / frames) : 0,
      raycastsPerSec: Math.round((perfCounters.raycasts - this.raycastsAtWindowStart) / (elapsedMs / 1000)),
      tacticalRaysPerSec: Math.round((perfCounters.tacticalRaycasts - this.tacticalRaysAtWindowStart) / (elapsedMs / 1000)),
      budgetExhaustedPercent:
        this.ticks > 0 ? round2(((perfCounters.rayBudgetExhaustedTicks - this.exhaustedTicksAtWindowStart) / this.ticks) * 100) : 0,
      tacticalPicks: perfCounters.tacticalPicks,
      unreachablePercent:
        perfCounters.tacticalPicks > 0 ? round2((perfCounters.tacticalPicksUnreachable / perfCounters.tacticalPicks) * 100) : 0,
      enemies,
      states,
      drawCalls: context.drawCalls,
      triangles: context.triangles,
      heapMb: readHeapMb(),
    };
  }

  private resetWindow(now: number): void {
    this.windowStart = now;
    this.frameTimes = [];
    this.ticks = 0;
    this.physicsTotal = 0;
    this.worldTotal = 0;
    this.aiTotal = 0;
    this.aiMax = 0;
    this.renderTotal = 0;
    this.raycastsAtWindowStart = perfCounters.raycasts;
    this.tacticalRaysAtWindowStart = perfCounters.tacticalRaycasts;
    this.exhaustedTicksAtWindowStart = perfCounters.rayBudgetExhaustedTicks;
  }
}
