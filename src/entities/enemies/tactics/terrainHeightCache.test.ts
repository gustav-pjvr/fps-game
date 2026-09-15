import { describe, expect, it } from 'vitest';
import { TerrainHeightCache } from './terrainHeightCache.ts';

function countingSampler() {
  const calls: { x: number; z: number }[] = [];
  return { calls, sample: (x: number, z: number) => (calls.push({ x, z }), x * 10 + z) };
}

describe('TerrainHeightCache', () => {
  it('samples each 1 m cell once, at the cell point', () => {
    const { calls, sample } = countingSampler();
    const cache = new TerrainHeightCache(sample, 1, 100);
    expect(cache.heightAt(1.2, 3.4)).toBe(13);
    expect(cache.heightAt(1.4, 2.6)).toBe(13);
    expect(calls).toEqual([{ x: 1, z: 3 }]);
  });

  it('keeps negative and positive coordinates apart', () => {
    const { sample } = countingSampler();
    const cache = new TerrainHeightCache(sample, 1, 100);
    expect(cache.heightAt(-1, 0)).toBe(-10);
    expect(cache.heightAt(1, 0)).toBe(10);
    expect(cache.heightAt(0, -1)).toBe(-1);
  });

  it('stays within its size bound', () => {
    const { sample } = countingSampler();
    const cache = new TerrainHeightCache(sample, 1, 3);
    for (let i = 0; i < 10; i++) cache.heightAt(i, 0);
    expect(cache.size).toBeLessThanOrEqual(3);
  });
});
