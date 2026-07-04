/** Deterministic per-chunk seed, distinct per system via seedOffset so vegetation/building/etc.
 * placement don't correlate with each other or with terrain despite sharing the world seed
 * (see worldSeed.ts). */
export function hashChunkSeed(cx: number, cz: number, seed: number): number {
  return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ seed) >>> 0;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}
