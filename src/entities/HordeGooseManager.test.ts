import { describe, expect, it } from 'vitest';
import { advanceSupplyMeter, computeConcurrentCap, computeSpawnBudget, resolveWaveCompletion } from './HordeGooseManager.ts';
import { HORDE_MAX_CONCURRENT_BASE, HORDE_MAX_CONCURRENT_CEILING, HORDE_WAVE_TABLE } from '../core/config.ts';
import {
  HORDE_BOSSES,
  HORDE_FLAVORS,
  hordeBossHealth,
  hordeBruteCount,
  hordeBruteHealth,
  hordeWaveCount,
  supplyKillValue,
  supplyKillsNeeded,
} from './hordeRules.ts';

// HordeGooseManager itself spawns real Rapier-backed HordeGoose instances (physics rigid bodies,
// steering raycasts) - this repo's Vitest unit-test layer deliberately never touches real
// WASM/physics (see vitest.config.ts's own comment: "never collides with the Playwright e2e suite
// ... which owns everything that needs a real browser/WASM/GL"). So wave progression is tested
// against the pure accounting functions HordeGooseManager.update() delegates to instead, and the
// rules in hordeRules.ts - they carry the actual "does the wave advance / does the queue drain / is
// the concurrent cap respected / how does it grow with the squad" logic. e2e/horde.spec.ts plays
// the real thing.

describe('computeConcurrentCap - wave-scaled concurrent goose limit', () => {
  it('starts at HORDE_MAX_CONCURRENT_BASE on wave index 0', () => {
    expect(computeConcurrentCap(0)).toBe(HORDE_MAX_CONCURRENT_BASE);
  });

  it('grows by one per wave index', () => {
    expect(computeConcurrentCap(1)).toBe(HORDE_MAX_CONCURRENT_BASE + 1);
    expect(computeConcurrentCap(5)).toBe(HORDE_MAX_CONCURRENT_BASE + 5);
  });

  it('never exceeds HORDE_MAX_CONCURRENT_CEILING no matter how high the wave index climbs', () => {
    expect(computeConcurrentCap(1000)).toBe(HORDE_MAX_CONCURRENT_CEILING);
  });

  it('allows two more at once for each player past the first, and no more than four players\' worth', () => {
    expect(computeConcurrentCap(0, 2)).toBe(HORDE_MAX_CONCURRENT_BASE + 2);
    expect(computeConcurrentCap(1000, 4)).toBe(HORDE_MAX_CONCURRENT_CEILING + 6);
    expect(computeConcurrentCap(1000, 9)).toBe(HORDE_MAX_CONCURRENT_CEILING + 6);
  });
});

describe('computeSpawnBudget - how many geese to spawn this tick', () => {
  it('spawns nothing when the queue is already empty', () => {
    expect(computeSpawnBudget(0, 0, 5)).toBe(0);
  });

  it('spawns nothing when already at the concurrent cap', () => {
    expect(computeSpawnBudget(10, 5, 5)).toBe(0);
  });

  it('spawns up to the cap, not the whole remaining queue, when the queue is larger than the room available', () => {
    expect(computeSpawnBudget(10, 2, 5)).toBe(3); // room for 3 more before hitting the cap of 5
  });

  it('spawns the entire remaining queue when there is more than enough room under the cap', () => {
    expect(computeSpawnBudget(2, 0, 5)).toBe(2);
  });

  it('never returns negative even if aliveCount somehow already exceeds the cap', () => {
    expect(computeSpawnBudget(5, 8, 5)).toBe(0);
  });
});

describe('resolveWaveCompletion - phase transition once a wave drains', () => {
  it('reports no transition while geese are still queued', () => {
    expect(resolveWaveCompletion(3, 0, 0, 10)).toBeNull();
  });

  it('reports no transition while geese are still alive, even with an empty queue', () => {
    expect(resolveWaveCompletion(0, 2, 0, 10)).toBeNull();
  });

  it('moves to intermission once the queue and the field are both empty, with waves still remaining', () => {
    expect(resolveWaveCompletion(0, 0, 0, 10)).toBe('intermission');
  });

  it('reports cleared once the queue/field are empty on the table\'s final wave index', () => {
    expect(resolveWaveCompletion(0, 0, 9, 10)).toBe('cleared');
  });

  it('reports cleared for a single-wave table immediately on wave index 0', () => {
    expect(resolveWaveCompletion(0, 0, 0, 1)).toBe('cleared');
  });
});

describe('wave progression across a wave table (simulating HordeGooseManager.update()\'s own bookkeeping)', () => {
  /** Re-derives exactly what HordeGooseManager.update() does each tick using the pure helpers
   * above, driven by a wave table instead of a live manager - minus the physics-backed goose
   * objects themselves. */
  function simulateWaveTable(waveTable: readonly { count: number }[], players = 1): { finalWaveIndex: number; cleared: boolean; totalSpawned: number } {
    const sized = (index: number): number => hordeWaveCount({ speedMultiplier: 1, jumperChance: 0, flyerChance: 0, ...waveTable[index]! }, players);
    let waveIndex = 0;
    let spawnQueueRemaining = sized(0);
    let aliveCount = 0;
    let totalSpawned = 0;
    let cleared = false;

    // Each "tick" here spawns everything the cap allows, then immediately kills every alive goose
    // (aliveCount = 0) - equivalent to a wave where every goose dies the instant it spawns, which
    // is enough to drive the phase machine through every wave without needing real steering/combat.
    for (let tick = 0; tick < 1000 && !cleared; tick++) {
      const cap = computeConcurrentCap(waveIndex, players);
      const budget = computeSpawnBudget(spawnQueueRemaining, aliveCount, cap);
      spawnQueueRemaining -= budget;
      totalSpawned += budget;
      aliveCount = 0; // every spawned goose dies immediately this same tick, for this simulation

      const completion = resolveWaveCompletion(spawnQueueRemaining, aliveCount, waveIndex, waveTable.length);
      if (completion === 'cleared') {
        cleared = true;
      } else if (completion === 'intermission') {
        waveIndex++;
        spawnQueueRemaining = sized(waveIndex);
      }
    }

    return { finalWaveIndex: waveIndex, cleared, totalSpawned };
  }

  it('advances through every wave and clears on a small fake table', () => {
    const fakeTable = [{ count: 3 }, { count: 5 }, { count: 2 }];
    const result = simulateWaveTable(fakeTable);
    expect(result.cleared).toBe(true);
    expect(result.finalWaveIndex).toBe(fakeTable.length - 1);
    expect(result.totalSpawned).toBe(3 + 5 + 2);
  });

  it('spawns exactly the real HORDE_WAVE_TABLE\'s goose count across all waves, for one player and for four', () => {
    for (const players of [1, 4]) {
      const result = simulateWaveTable(HORDE_WAVE_TABLE, players);
      expect(result.cleared).toBe(true);
      expect(result.totalSpawned).toBe(HORDE_WAVE_TABLE.reduce((sum, wave) => sum + hordeWaveCount(wave, players), 0));
    }
  });

  it('respects the concurrent cap even on a wave whose count exceeds it (spawns are budget-limited per tick)', () => {
    // HORDE_MAX_CONCURRENT_CEILING is a hard ceiling regardless of wave index - a single-tick
    // budget can never exceed it, confirmed directly rather than just assumed.
    const cap = computeConcurrentCap(0);
    const budget = computeSpawnBudget(cap * 10, 0, cap);
    expect(budget).toBeLessThanOrEqual(cap);
    expect(budget).toBe(cap);
  });
});

describe('the wave table (docs/goose-horde.md)', () => {
  it('is twelve waves, with a boss on the sixth and the last, and never eases off between them', () => {
    expect(HORDE_WAVE_TABLE).toHaveLength(12);
    expect(HORDE_WAVE_TABLE.map((wave) => wave.boss)).toEqual([
      undefined, undefined, undefined, undefined, undefined, 'mother', undefined, undefined, undefined, undefined, undefined, 'matriarch',
    ]);
    for (let i = 1; i < HORDE_WAVE_TABLE.length; i++) {
      expect(HORDE_WAVE_TABLE[i]!.speedMultiplier).toBeGreaterThanOrEqual(HORDE_WAVE_TABLE[i - 1]!.speedMultiplier);
      // A boss wave's count is the boss's escort, smaller than the wave before it.
      if (!HORDE_WAVE_TABLE[i]!.boss && !HORDE_WAVE_TABLE[i - 1]!.boss) expect(HORDE_WAVE_TABLE[i]!.count).toBeGreaterThan(HORDE_WAVE_TABLE[i - 1]!.count);
    }
    for (const wave of HORDE_WAVE_TABLE) expect(wave.jumperChance + wave.flyerChance).toBeLessThanOrEqual(1);
  });
});

describe('scaling to the squad (entities/hordeRules.ts)', () => {
  const wave = { count: 20, speedMultiplier: 1, jumperChance: 0, flyerChance: 0, brutes: 2 };

  it('sizes a wave for one player as the table says, and for four at well under four times that', () => {
    expect(hordeWaveCount(wave, 1)).toBe(20);
    expect(hordeWaveCount(wave, 2)).toBe(29);
    expect(hordeWaveCount(wave, 4)).toBe(47);
    // Each player of a full squad faces fewer geese than a player alone: a squad covers itself.
    expect(hordeWaveCount(wave, 4) / 4).toBeLessThan(hordeWaveCount(wave, 1));
    expect(hordeWaveCount(wave, 0)).toBe(20);
    expect(hordeWaveCount(wave, 9)).toBe(47);
  });

  it('adds brutes only for three or four players, and none to a wave that has none', () => {
    expect(hordeBruteCount(wave, 1)).toBe(2);
    expect(hordeBruteCount(wave, 2)).toBe(2);
    expect(hordeBruteCount(wave, 3)).toBe(3);
    expect(hordeBruteCount({ ...wave, brutes: undefined }, 4)).toBe(0);
  });

  it('gives a boss and a brute more health for a bigger squad, less than in proportion', () => {
    expect(hordeBossHealth('mother', 1)).toBe(HORDE_BOSSES.mother.health);
    expect(hordeBossHealth('mother', 4)).toBe(HORDE_BOSSES.mother.health * 2.5);
    expect(hordeBossHealth('matriarch', 1)).toBeGreaterThan(hordeBossHealth('mother', 1));
    expect(hordeBruteHealth(1)).toBe(HORDE_FLAVORS.brute.health);
    expect(hordeBruteHealth(4)).toBe(HORDE_FLAVORS.brute.health * 1.75);
  });

  it('asks a bigger squad for more kills per supply drop', () => {
    expect(supplyKillsNeeded(1)).toBe(14);
    expect(supplyKillsNeeded(4)).toBe(26);
  });
});

describe('advanceSupplyMeter - the squad\'s kills toward a supply drop', () => {
  it('counts a small goose as one, a brute as three, and a boss as a drop on its own', () => {
    expect(supplyKillValue('walker')).toBe(1);
    expect(supplyKillValue('flyer')).toBe(1);
    expect(supplyKillValue('brute')).toBe(3);
    expect(advanceSupplyMeter(0, supplyKillValue('boss'), 26)).toEqual({ meter: 0, earned: true });
  });

  it('earns a drop when the meter fills and starts again from empty', () => {
    expect(advanceSupplyMeter(12, 1, 14)).toEqual({ meter: 13, earned: false });
    expect(advanceSupplyMeter(13, 1, 14)).toEqual({ meter: 0, earned: true });
    expect(advanceSupplyMeter(13, 3, 14)).toEqual({ meter: 0, earned: true });
  });
});
