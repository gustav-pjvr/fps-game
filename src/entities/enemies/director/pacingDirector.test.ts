import { describe, expect, it } from 'vitest';
import { PacingDirector, type DirectorCommand, type DirectorOptions, type DirectorSignals } from './pacingDirector.ts';
import { mulberry32 } from '../../../utils/rng.ts';

const OPTIONS: DirectorOptions = {
  intensityPerDamage: 0.02,
  intensityPerKill: 0.15,
  decayPerSecond: 0.08,
  peakThreshold: 1,
  peakMin: 3,
  peakMax: 5,
  fadeExit: 0.3,
  relaxMin: 30,
  relaxMax: 45,
  maxAlive: 8,
  waveSize: 2,
  waveInterval: 8,
  retryDelay: 1,
  rusherWaveShare: 0.2,
  sniperWaveShare: 0.2,
};

const DT = 0.5;
const quiet = (alive = 2, engaged = 0): DirectorSignals => ({ dt: DT, damageTaken: 0, nearbyKills: 0, engagedEnemies: engaged, aliveEnemies: alive, allPlayersUnderground: false });

/** Ticks until `stop` says so (or `limit` seconds pass), returning every wave command issued. */
function runUntil(director: PacingDirector, signals: () => DirectorSignals, stop: () => boolean, limit = 200): DirectorCommand[] {
  const waves: DirectorCommand[] = [];
  for (let t = 0; t < limit && !stop(); t += DT) {
    const command = director.update(signals());
    if (command.kind === 'spawnWave') waves.push(command);
  }
  return waves;
}

describe('PacingDirector', () => {
  it('holds relax without waves while all living players are underground, then resumes', () => {
    const director = new PacingDirector(OPTIONS, () => 0);
    for (let i = 0; i < 100; i++) {
      expect(director.update({ ...quiet(0), dt: 10, allPlayersUnderground: true })).toEqual({ kind: 'none' });
      expect(director.phase).toBe('relax');
      expect(director.phaseElapsed).toBe(0);
    }
    expect(director.update({ ...quiet(0), dt: OPTIONS.relaxMin - 1 })).toEqual({ kind: 'none' });
    expect(director.phase).toBe('relax');
    director.update({ ...quiet(0), dt: 1 });
    expect(director.phase).toBe('buildUp');
    expect(director.update(quiet(0))).toMatchObject({ kind: 'spawnWave', count: OPTIONS.waveSize });
  });

  it('preserves an existing relax clock while underground and resumes it on the surface', () => {
    const director = new PacingDirector(OPTIONS, () => 0);
    director.update({ ...quiet(), damageTaken: 50 });
    expect(director.phase).toBe('peak');
    director.update({ ...quiet(), allPlayersUnderground: true });
    expect(director.phase).toBe('relax');
    director.update({ ...quiet(), dt: 12 });
    director.update({ ...quiet(), dt: 100, allPlayersUnderground: true });
    expect(director.phaseElapsed).toBe(12);
    expect(director.phase).toBe('relax');
    director.update({ ...quiet(), dt: OPTIONS.relaxMin - 12 });
    expect(director.phase).toBe('buildUp');
  });

  it('sends a wave of two every 8 s during build-up', () => {
    const director = new PacingDirector(OPTIONS, mulberry32(1));
    let seconds = 0;
    const waves = runUntil(director, () => quiet(), () => (seconds += DT) > 24.01);
    expect(waves).toHaveLength(3);
    for (const wave of waves) expect(wave).toMatchObject({ kind: 'spawnWave', count: 2 });
  });

  it('never goes over the cap, and sends only what fits', () => {
    const director = new PacingDirector(OPTIONS, mulberry32(1));
    const atCap = runUntil(director, () => quiet(8), () => false, 30);
    expect(atCap).toEqual([]);
    // One place free: the waiting wave comes at once, one enemy strong.
    expect(director.update(quiet(7))).toMatchObject({ kind: 'spawnWave', count: 1 });
  });

  it('runs build-up, peak, fade, relax and back to build-up', () => {
    const director = new PacingDirector(OPTIONS, mulberry32(3));
    const phases: string[] = [director.phase];
    const note = () => {
      if (phases[phases.length - 1] !== director.phase) phases.push(director.phase);
    };
    // 50 HP lost while two enemies chase: a full peak.
    director.update({ dt: DT, damageTaken: 50, nearbyKills: 0, engagedEnemies: 2, aliveEnemies: 2, allPlayersUnderground: false });
    director.update(quiet(2, 2));
    note();
    // Still chasing: peak ends on its timer, but fade holds while anyone is engaged.
    runUntil(director, () => quiet(2, 2), () => (note(), false), 20);
    expect(director.phase).toBe('fade');
    // The player gets clear: intensity drains, fade ends, relax runs its 30 to 45 s, build-up again.
    runUntil(director, () => quiet(2, 0), () => (note(), director.phase === 'buildUp'), 100);
    expect(phases).toEqual(['buildUp', 'peak', 'fade', 'relax', 'buildUp']);
  });

  it('peaks on a heavy hit even when nothing is chasing (a sniper, a goose)', () => {
    // 50 HP is exactly a full peak; the same tick's drain must not take it back under the threshold.
    const director = new PacingDirector(OPTIONS, mulberry32(1));
    director.update({ dt: DT, damageTaken: 50, nearbyKills: 0, engagedEnemies: 0, aliveEnemies: 2, allPlayersUnderground: false });
    expect(director.phase).toBe('peak');
  });

  it('drains intensity only while nothing is chasing the player', () => {
    const director = new PacingDirector(OPTIONS, mulberry32(1));
    director.update({ dt: DT, damageTaken: 25, nearbyKills: 0, engagedEnemies: 1, aliveEnemies: 2, allPlayersUnderground: false });
    const hot = director.intensity;
    expect(hot).toBeCloseTo(0.5, 5);
    for (let i = 0; i < 10; i++) director.update(quiet(2, 1));
    expect(director.intensity).toBe(hot);
    for (let i = 0; i < 10; i++) director.update(quiet(2, 0));
    expect(director.intensity).toBeCloseTo(hot - 10 * DT * OPTIONS.decayPerSecond, 5);
  });

  it('sends no waves during peak, fade or relax', () => {
    const director = new PacingDirector(OPTIONS, mulberry32(2));
    director.update({ dt: DT, damageTaken: 0, nearbyKills: 7, engagedEnemies: 1, aliveEnemies: 1, allPlayersUnderground: false });
    expect(director.phase).toBe('peak');
    const waves = runUntil(director, () => quiet(0, 0), () => director.phase === 'buildUp', 100);
    expect(waves).toEqual([]);
  });

  it('retries a wave that found nowhere to spawn after the retry delay, not a whole interval', () => {
    const director = new PacingDirector(OPTIONS, mulberry32(1));
    runUntil(director, () => quiet(), () => director.totalSpawned > 0 || false, 8.01);
    director.confirmSpawned(0);
    let seconds = 0;
    const waves = runUntil(director, () => quiet(), () => (seconds += DT) > 1.01);
    expect(waves).toHaveLength(1);
  });

  it('is deterministic under a seed', () => {
    const run = (seed: number) => {
      const director = new PacingDirector(OPTIONS, mulberry32(seed));
      const biases: string[] = [];
      for (let t = 0; t < 200; t += DT) {
        const command = director.update(quiet(0));
        if (command.kind === 'spawnWave') biases.push(command.bias);
      }
      return biases.join(',');
    };
    expect(run(9)).toBe(run(9));
    expect(run(9).split(',').length).toBeGreaterThan(5);
  });
});
