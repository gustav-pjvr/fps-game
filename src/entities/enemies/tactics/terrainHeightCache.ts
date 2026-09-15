/**
 * Memoised terrain height for position picking (enemy AI v2, step 3). sampleHeight is the enemy
 * hot path's dominant cost (see Enemy.ts's HEIGHT_RESAMPLE_DISTANCE_SQ comment), and picking asks
 * for the height of dozens of candidate spots per refresh. Quantising to ENEMY_TERRAIN_HEIGHT_
 * CACHE_QUANTUM (1 m) is far finer than the terrain's noise period (about 67 m), so the error is
 * negligible for deciding cover. Bounded: when full it simply starts over.
 */
export class TerrainHeightCache {
  private readonly cache = new Map<number, number>();

  constructor(
    private readonly sample: (x: number, z: number) => number,
    private readonly quantum: number,
    private readonly maxEntries: number,
  ) {}

  get size(): number {
    return this.cache.size;
  }

  heightAt(x: number, z: number): number {
    const qx = Math.round(x / this.quantum);
    const qz = Math.round(z / this.quantum);
    // The world spans well inside +/-32768 quanta, so this packs both into one exact integer key.
    const key = (qx + 32768) * 65536 + (qz + 32768);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    if (this.cache.size >= this.maxEntries) this.cache.clear();
    const height = this.sample(qx * this.quantum, qz * this.quantum);
    this.cache.set(key, height);
    return height;
  }

  clear(): void {
    this.cache.clear();
  }
}
