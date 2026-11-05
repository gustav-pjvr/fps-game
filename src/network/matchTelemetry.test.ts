import { describe, expect, it } from 'vitest';
import {
  MAX_COUNTED_GAP_MS,
  MatchTelemetryAccumulator,
  STALL_GAP_MS,
  buildMultiplayerTelemetryExtras,
  percentile,
} from './matchTelemetry.ts';

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 100)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([10, 20], 50)).toBe(10);
  });

  it('is undefined for no samples', () => {
    expect(percentile([], 50)).toBeUndefined();
  });
});

describe('MatchTelemetryAccumulator pings', () => {
  it('reports the median and 95th percentile, rounded', () => {
    const acc = new MatchTelemetryAccumulator();
    for (let i = 1; i <= 100; i++) acc.recordPing(i + 0.4);
    const stats = acc.summary(60000);
    expect(stats.pingP50).toBe(50);
    expect(stats.pingP95).toBe(95);
    expect(stats.pingSamples).toBe(100);
  });

  it('ignores unknown and invalid readings', () => {
    const acc = new MatchTelemetryAccumulator();
    acc.recordPing(null);
    acc.recordPing(undefined);
    acc.recordPing(Number.NaN);
    acc.recordPing(-5);
    expect(acc.summary(60000).pingP50).toBeUndefined();
    expect(acc.summary(60000).pingSamples).toBe(0);
  });
});

describe('MatchTelemetryAccumulator snapshot gaps', () => {
  it('records the gap per opponent and none for the first snapshot', () => {
    const acc = new MatchTelemetryAccumulator();
    acc.recordSnapshot(1, 1000);
    acc.recordSnapshot(2, 1010);
    acc.recordSnapshot(1, 1050);
    acc.recordSnapshot(2, 1090);
    const stats = acc.summary(60000);
    expect(stats.gapSamples).toBe(2);
    expect(stats.snapshotGapP95).toBe(80);
  });

  it('counts only gaps over the stall threshold, per minute of match time', () => {
    const acc = new MatchTelemetryAccumulator();
    let t = 0;
    acc.recordSnapshot(1, t);
    for (const gap of [50, STALL_GAP_MS, STALL_GAP_MS + 1, 400, 60]) {
      t += gap;
      acc.recordSnapshot(1, t);
    }
    expect(acc.summary(120000).stallsPerMin).toBe(1);
    expect(acc.summary(30000).stallsPerMin).toBe(4);
  });

  it('leaves a death or reload sized gap out of both the series and the stall count', () => {
    const acc = new MatchTelemetryAccumulator();
    acc.recordSnapshot(1, 0);
    acc.recordSnapshot(1, MAX_COUNTED_GAP_MS + 1);
    acc.recordSnapshot(1, MAX_COUNTED_GAP_MS + 51);
    const stats = acc.summary(60000);
    expect(stats.gapSamples).toBe(1);
    expect(stats.stallsPerMin).toBe(0);
    expect(stats.snapshotGapP95).toBe(50);
  });

  it('ignores a clock that went backwards', () => {
    const acc = new MatchTelemetryAccumulator();
    acc.recordSnapshot(1, 500);
    acc.recordSnapshot(1, 400);
    expect(acc.summary(60000).gapSamples).toBe(0);
  });

  it('reports no stalls for zero match time', () => {
    const acc = new MatchTelemetryAccumulator();
    acc.recordSnapshot(1, 0);
    acc.recordSnapshot(1, 300);
    expect(acc.summary(0).stallsPerMin).toBe(0);
  });
});

describe('MatchTelemetryAccumulator memory cap', () => {
  it('never stores more than the cap per series but keeps counting', () => {
    const acc = new MatchTelemetryAccumulator(50);
    for (let i = 0; i < 10000; i++) acc.recordPing(i % 200);
    let t = 0;
    acc.recordSnapshot(1, t);
    for (let i = 0; i < 10000; i++) {
      t += 40 + (i % 30);
      acc.recordSnapshot(1, t);
    }
    expect(acc.storedSamples).toBeLessThanOrEqual(100);
    const stats = acc.summary(600000);
    expect(stats.pingSamples).toBe(10000);
    expect(stats.gapSamples).toBe(10000);
  });

  it('keeps the percentiles close to the truth once past the cap', () => {
    const acc = new MatchTelemetryAccumulator(500);
    for (let i = 0; i < 20000; i++) acc.recordPing((i * 7919) % 1000);
    const stats = acc.summary(60000);
    expect(Math.abs((stats.pingP50 ?? 0) - 500)).toBeLessThan(80);
    expect(Math.abs((stats.pingP95 ?? 0) - 950)).toBeLessThan(60);
  });

  it('replaces by the injected random choice (reservoir sampling)', () => {
    // random() = 0.99 always picks slot floor(0.99 * seen) >= cap, so nothing past the cap is kept.
    const acc = new MatchTelemetryAccumulator(3, () => 0.99);
    for (const v of [10, 20, 30, 1000, 2000, 3000]) acc.recordPing(v);
    expect(acc.summary(60000).pingP95).toBe(30);
    // random() = 0 always replaces slot 0, so the newest sample displaces the first.
    const replacing = new MatchTelemetryAccumulator(3, () => 0);
    for (const v of [10, 20, 30, 1000]) replacing.recordPing(v);
    expect(replacing.summary(60000).pingP95).toBe(1000);
  });
});

describe('buildMultiplayerTelemetryExtras', () => {
  it('carries the stats, the transport and the roster size', () => {
    const acc = new MatchTelemetryAccumulator();
    acc.recordPing(40);
    acc.recordSnapshot(1, 0);
    acc.recordSnapshot(1, 200);
    const extras = buildMultiplayerTelemetryExtras(acc.summary(60000), 3, 812.4);
    expect(extras).toEqual({ transport: 'p2p', players: 3, pingP50: 40, pingP95: 40, snapshotGapP95: 200, stallsPerMin: 1, joinMs: 812 });
  });

  it('leaves out what is unknown', () => {
    const acc = new MatchTelemetryAccumulator();
    const extras = buildMultiplayerTelemetryExtras(acc.summary(60000), 2, undefined);
    expect(extras).toEqual({ transport: 'p2p', players: 2, stallsPerMin: 0 });
    expect(JSON.parse(JSON.stringify(extras))).toEqual({ transport: 'p2p', players: 2, stallsPerMin: 0 });
  });
});
