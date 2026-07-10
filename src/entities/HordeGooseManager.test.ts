import { describe, expect, it } from 'vitest';
import { computeConcurrentCap, computeSpawnBudget, resolveWaveCompletion } from './HordeGooseManager.ts';
import { HORDE_MAX_CONCURRENT_BASE, HORDE_MAX_CONCURRENT_CEILING, HORDE_WAVE_TABLE, HORDE_WAVE_TABLE_MULTIPLAYER } from '../core/config.ts';

// HordeGooseManager itself spawns real Rapier-backed HordeGoose instances (physics rigid bodies,
// steering raycasts) - this repo's Vitest unit-test layer deliberately never touches real
// WASM/physics (see vitest.config.ts's own comment: "never collides with the Playwright e2e suite
// ... which owns everything that needs a real browser/WASM/GL"). So wave progression is tested
// against the three pure accounting functions HordeGooseManager.update() delegates to instead -
// they carry the actual "does the wave advance / does the queue drain / is the concurrent cap
// respected" logic the task asks for, with no behavior change to the manager itself.

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

describe('wave progression across a fake wave table (simulating HordeGooseManager.update()\'s own bookkeeping)', () => {
  /** Re-derives exactly what HordeGooseManager.update() does each tick using the pure helpers
   * above, driven by a small fake wave table instead of a live manager - this is the "inject the
   * table, fake dt" shape the task asks for, minus the physics-backed goose objects themselves. */
  function simulateWaveTable(waveTable: readonly { count: number }[]): { finalWaveIndex: number; cleared: boolean; totalSpawned: number } {
    let waveIndex = 0;
    let spawnQueueRemaining = waveTable[0]!.count;
    let aliveCount = 0;
    let totalSpawned = 0;
    let cleared = false;

    // Each "tick" here spawns everything the cap allows, then immediately kills every alive goose
    // (aliveCount = 0) - equivalent to a wave where every goose dies the instant it spawns, which
    // is enough to drive the phase machine through every wave without needing real steering/combat.
    for (let tick = 0; tick < 1000 && !cleared; tick++) {
      const cap = computeConcurrentCap(waveIndex);
      const budget = computeSpawnBudget(spawnQueueRemaining, aliveCount, cap);
      spawnQueueRemaining -= budget;
      totalSpawned += budget;
      aliveCount = 0; // every spawned goose dies immediately this same tick, for this simulation

      const completion = resolveWaveCompletion(spawnQueueRemaining, aliveCount, waveIndex, waveTable.length);
      if (completion === 'cleared') {
        cleared = true;
      } else if (completion === 'intermission') {
        waveIndex++;
        spawnQueueRemaining = waveTable[waveIndex]!.count;
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

  it('spawns exactly the real single-player HORDE_WAVE_TABLE\'s total goose count across all waves', () => {
    const result = simulateWaveTable(HORDE_WAVE_TABLE);
    expect(result.cleared).toBe(true);
    expect(result.totalSpawned).toBe(HORDE_WAVE_TABLE.reduce((sum, wave) => sum + wave.count, 0));
  });

  it('spawns exactly the real multiplayer HORDE_WAVE_TABLE_MULTIPLAYER\'s total goose count across all waves', () => {
    const result = simulateWaveTable(HORDE_WAVE_TABLE_MULTIPLAYER);
    expect(result.cleared).toBe(true);
    expect(result.totalSpawned).toBe(HORDE_WAVE_TABLE_MULTIPLAYER.reduce((sum, wave) => sum + wave.count, 0));
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
