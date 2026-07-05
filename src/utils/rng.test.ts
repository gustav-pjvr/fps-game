import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng.ts';

describe('mulberry32', () => {
  it('produces an identical sequence for an identical seed', () => {
    const a = mulberry32(1337);
    const b = mulberry32(1337);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const firstTen = { a: [] as number[], b: [] as number[] };
    for (let i = 0; i < 10; i++) {
      firstTen.a.push(a());
      firstTen.b.push(b());
    }
    expect(firstTen.a).not.toEqual(firstTen.b);
  });

  it('stays within [0, 1) across many draws and seeds', () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = mulberry32(seed);
      for (let i = 0; i < 200; i++) {
        const value = rng();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });

  it('is roughly uniform (mean near 0.5 over a large sample)', () => {
    const rng = mulberry32(42);
    let sum = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) sum += rng();
    expect(sum / n).toBeGreaterThan(0.47);
    expect(sum / n).toBeLessThan(0.53);
  });

  it('handles negative and float seeds via uint32 coercion without NaN output', () => {
    for (const seed of [-1, -1337, 0.5, 2 ** 33]) {
      const rng = mulberry32(seed);
      const value = rng();
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
