import { describe, expect, it } from 'vitest';
import { computeMinimumSpanningTree } from './RoadManager.ts';

function totalEdgeLength(points: readonly { x: number; z: number }[], edges: readonly [number, number][]): number {
  return edges.reduce((sum, [i, j]) => {
    const a = points[i]!;
    const b = points[j]!;
    return sum + Math.hypot(a.x - b.x, a.z - b.z);
  }, 0);
}

/** Brute-force reference MST (Kruskal + union-find) - deliberately not calling back into
 * RoadManager.ts's own Prim's-algorithm implementation, so this is a real check against an
 * independently-computed answer rather than the production code checked against itself (same
 * approach ZoneMap.test.ts's everyRayRespectsBothBoundaries takes). */
function bruteForceMinimumSpanningTreeLength(points: readonly { x: number; z: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;

  const edges: { i: number; j: number; distance: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push({ i, j, distance: Math.hypot(points[i]!.x - points[j]!.x, points[i]!.z - points[j]!.z) });
    }
  }
  edges.sort((a, b) => a.distance - b.distance);

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) x = parent[x]!;
    return x;
  }

  let total = 0;
  let edgesUsed = 0;
  for (const edge of edges) {
    const rootI = find(edge.i);
    const rootJ = find(edge.j);
    if (rootI === rootJ) continue;
    parent[rootI] = rootJ;
    total += edge.distance;
    edgesUsed++;
    if (edgesUsed === n - 1) break;
  }
  return total;
}

describe('computeMinimumSpanningTree', () => {
  it('returns no edges for 0 or 1 points', () => {
    expect(computeMinimumSpanningTree([])).toEqual([]);
    expect(computeMinimumSpanningTree([{ x: 0, z: 0 }])).toEqual([]);
  });

  it('connects exactly 2 points with 1 edge', () => {
    const points = [{ x: 0, z: 0 }, { x: 10, z: 0 }];
    expect(computeMinimumSpanningTree(points)).toEqual([[1, 0]]);
  });

  it('produces exactly n-1 edges for n points - a spanning tree, not a redundant web', () => {
    const points = Array.from({ length: 12 }, (_, i) => ({ x: (i * 37) % 97, z: (i * 53) % 89 }));
    const edges = computeMinimumSpanningTree(points);
    expect(edges.length).toBe(points.length - 1);
  });

  it('every node appears in at least one edge (the tree actually spans every building, none left isolated)', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ x: (i * 41) % 83, z: (i * 61) % 79 }));
    const edges = computeMinimumSpanningTree(points);
    const touched = new Set<number>();
    for (const [i, j] of edges) {
      touched.add(i);
      touched.add(j);
    }
    expect(touched.size).toBe(points.length);
  });

  it('matches the true minimum total length across many random point sets, verified against a brute-force reference', () => {
    let seed = 12345;
    const nextRandom = () => {
      // Tiny deterministic LCG, independent of this codebase's own mulberry32 - keeps this test
      // from accidentally depending on the RNG implementation it isn't testing.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let trial = 0; trial < 20; trial++) {
      const n = 3 + Math.floor(nextRandom() * 10); // 3-12 points
      const points = Array.from({ length: n }, () => ({ x: nextRandom() * 200, z: nextRandom() * 200 }));
      const edges = computeMinimumSpanningTree(points);
      const actualLength = totalEdgeLength(points, edges);
      const expectedLength = bruteForceMinimumSpanningTreeLength(points);
      expect(actualLength).toBeCloseTo(expectedLength, 6);
    }
  });

  it('is deterministic - the same point set always yields the same edge set', () => {
    const points = [{ x: 0, z: 0 }, { x: 5, z: 5 }, { x: 10, z: 0 }, { x: 5, z: -5 }];
    expect(computeMinimumSpanningTree(points)).toEqual(computeMinimumSpanningTree(points));
  });
});
