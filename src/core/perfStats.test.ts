import { describe, expect, it } from 'vitest';
import { formatPerfLine, PerfLogger, perfCounters, type PerfContext } from './perfStats.ts';

function makeLogger(consoleEnabled = true) {
  let clock = 1000;
  const lines: string[] = [];
  const logger = new PerfLogger({ consoleEnabled, now: () => clock, sink: (line) => lines.push(line) });
  return {
    logger,
    lines,
    advance: (ms: number) => {
      clock += ms;
    },
    time: () => clock,
  };
}

const context = (): PerfContext => ({
  states: ['idle', 'chase', 'chase', undefined, 'search'],
  drawCalls: 120,
  triangles: 45000,
});

describe('PerfLogger', () => {
  it('emits nothing until a full second has passed', () => {
    const { logger, advance } = makeLogger();
    advance(999);
    expect(logger.maybeEmit(context)).toBeNull();
    advance(1);
    expect(logger.maybeEmit(context)).not.toBeNull();
  });

  it('averages frame times and reports fps, p95 and max over the window', () => {
    const { logger, advance } = makeLogger();
    for (let i = 0; i < 19; i++) logger.recordFrame(10);
    logger.recordFrame(50);
    advance(1000);
    const entry = logger.maybeEmit(context)!;
    expect(entry.fps).toBe(20);
    expect(entry.frameMsAvg).toBe(12);
    expect(entry.frameMsP95).toBe(50);
    expect(entry.frameMsMax).toBe(50);
  });

  it('reports per-tick section averages, the worst AI tick, and per-frame render time', () => {
    const { logger, advance, time } = makeLogger();
    for (let tick = 0; tick < 4; tick++) {
      logger.recordTick();
      let start = time();
      advance(1);
      start = logger.endSection('physics', start);
      advance(tick === 3 ? 6 : 2);
      logger.endSection('ai', start);
    }
    logger.recordFrame(16);
    logger.recordFrame(16);
    const renderStart = time();
    advance(8);
    logger.endSection('render', renderStart);
    advance(1000);
    const entry = logger.maybeEmit(context)!;
    expect(entry.ticks).toBe(4);
    expect(entry.physicsMs).toBe(1);
    expect(entry.aiMs).toBe(3);
    expect(entry.aiMsMax).toBe(6);
    expect(entry.renderMs).toBe(4);
  });

  it('counts raycasts per second from the shared counter', () => {
    const { logger, advance } = makeLogger();
    perfCounters.raycasts += 300;
    advance(2000);
    expect(logger.maybeEmit(context)!.raycastsPerSec).toBe(150);
  });

  it('reports position-picking rays, budget shortfalls and the unreachable share', () => {
    const { logger, advance } = makeLogger();
    for (let tick = 0; tick < 4; tick++) logger.recordTick();
    perfCounters.tacticalRaycasts += 50;
    perfCounters.rayBudgetExhaustedTicks += 1;
    perfCounters.tacticalPicks = 10;
    perfCounters.tacticalPicksUnreachable = 2;
    advance(1000);
    const entry = logger.maybeEmit(context)!;
    expect(entry.tacticalRaysPerSec).toBe(50);
    expect(entry.budgetExhaustedPercent).toBe(25);
    expect(entry.tacticalPicks).toBe(10);
    expect(entry.unreachablePercent).toBe(20);
    expect(formatPerfLine(entry)).toContain('spots 10 (20% unreachable)');
  });

  it('counts enemies by AI state and skips targets, which have no state', () => {
    const { logger, advance } = makeLogger();
    advance(1000);
    const entry = logger.maybeEmit(context)!;
    expect(entry.enemies).toBe(4);
    expect(entry.states).toEqual({ idle: 1, chase: 2, search: 1 });
  });

  it('always records rows but only prints them when console output is on', () => {
    const { logger, lines, advance } = makeLogger(false);
    advance(1000);
    logger.maybeEmit(context);
    expect(logger.log).toHaveLength(1);
    expect(lines).toHaveLength(0);

    expect(logger.toggleConsole()).toBe(true);
    advance(1000);
    logger.maybeEmit(context);
    expect(logger.log).toHaveLength(2);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[perf\] t=2s/);
  });

  it('starts each window fresh after emitting', () => {
    const { logger, advance } = makeLogger();
    logger.recordTick();
    logger.recordFrame(16);
    advance(1000);
    logger.maybeEmit(context);
    advance(1000);
    const second = logger.maybeEmit(context)!;
    expect(second.ticks).toBe(0);
    expect(second.fps).toBe(0);
    expect(second.aiMsMax).toBe(0);
  });

  it('formats a readable one-line summary', () => {
    const { logger, advance } = makeLogger();
    logger.recordFrame(16.7);
    advance(1000);
    const line = formatPerfLine(logger.maybeEmit(context)!);
    expect(line).toContain('enemies 4 (idle 1, chase 2, search 1)');
    expect(line).toContain('draws 120 tris 45000');
  });
});
