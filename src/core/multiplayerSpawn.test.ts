import { describe, expect, it } from 'vitest';
import { pickMultiplayerSpawnPoints, pickRandomRespawnPoint, type SpawnPoint } from './multiplayerSpawn.ts';
import { MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT } from './config.ts';

function distance(a: SpawnPoint, b: SpawnPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const BOUNDARY_EPSILON = 1e-9;
const SAMPLE_ROUNDS = 200;

describe('pickMultiplayerSpawnPoints', () => {
  it.each([2, 3, 4])('returns exactly N points for N=%i', (n) => {
    expect(pickMultiplayerSpawnPoints(n)).toHaveLength(n);
  });

  it.each([2, 3, 4])(
    'guarantees the closed-form minimum pairwise separation for N=%i, across many random rotations',
    (n) => {
      const expectedMinDistance = 2 * 35 * Math.sin(Math.PI / n);
      for (let round = 0; round < SAMPLE_ROUNDS; round++) {
        const points = pickMultiplayerSpawnPoints(n);
        for (let i = 0; i < points.length; i++) {
          for (let j = i + 1; j < points.length; j++) {
            expect(distance(points[i]!, points[j]!)).toBeGreaterThanOrEqual(expectedMinDistance - BOUNDARY_EPSILON);
          }
        }
      }
    },
  );

  it('varies the rotation offset across calls (not the same fixed layout every time)', () => {
    const first = pickMultiplayerSpawnPoints(4);
    const layouts = Array.from({ length: 20 }, () => pickMultiplayerSpawnPoints(4));
    expect(layouts.some((points) => distance(points[0]!, first[0]!) > BOUNDARY_EPSILON)).toBe(true);
  });
});

describe('pickRandomRespawnPoint', () => {
  it('returns any valid point when there are no other players to avoid', () => {
    const point = pickRandomRespawnPoint([]);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.z)).toBe(true);
  });

  // Others are clustered together in one direction (not adversarially spread evenly around the
  // whole ring) - a real match's other players are rarely positioned to mathematically corner
  // every possible respawn point, and this keeps a genuinely large clear arc available so the
  // assertion below tests real filtering behavior rather than an unsolvable worst case (evenly
  // spreading 3+ others around the same-radius ring can shrink the achievable clearance below the
  // threshold everywhere, which this best-effort function was never designed to guarantee).
  it.each([1, 2, 3])('clears MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT from every one of %i clustered other players', (count) => {
    for (let round = 0; round < SAMPLE_ROUNDS; round++) {
      const others: SpawnPoint[] = Array.from({ length: count }, (_, i) => {
        const angle = (i * (Math.PI / 18)) - Math.PI / 36; // clustered within a 10-degree wedge
        return { x: Math.cos(angle) * 35, z: Math.sin(angle) * 35 };
      });
      const point = pickRandomRespawnPoint(others);
      for (const other of others) {
        expect(distance(point, other)).toBeGreaterThanOrEqual(MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT - BOUNDARY_EPSILON);
      }
    }
  });

  it('falls back to the best achievable point without throwing when others surround the whole ring', () => {
    // Adversarial case: 3 others evenly spaced around the same radius leaves no point that clears
    // the full threshold from all three (their pairwise exclusion arcs exactly tile the circle) -
    // this only asserts the function still returns a well-formed point, not that it hits the
    // (here, unreachable) threshold.
    const others: SpawnPoint[] = [0, 120, 240].map((deg) => {
      const angle = (deg * Math.PI) / 180;
      return { x: Math.cos(angle) * 35, z: Math.sin(angle) * 35 };
    });
    const point = pickRandomRespawnPoint(others);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.z)).toBe(true);
  });
});
