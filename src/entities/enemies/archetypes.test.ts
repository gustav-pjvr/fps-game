import { describe, expect, it } from 'vitest';
import { archetypeNamed, createArchetypePicker, ELITE_ARCHETYPES, ENEMY_ARCHETYPES, WARDEN } from './archetypes.ts';
import { ENEMY_RING_BASE_RADIUS } from '../../core/config.ts';

describe('archetype invariants', () => {
  it('no archetype can detect a passive player from the match-start spawn ring', () => {
    // Learned the hard way (see NOTES.md, per-archetype loadouts): Ridge Walker's first draft set
    // detectionRange to 30 > ENEMY_RING_BASE_RADIUS (25), so it sniped a completely passive player
    // from the moment the match started. Enforced only by comment until this test.
    for (const archetype of ENEMY_ARCHETYPES) {
      expect(archetype.detectionRange, archetype.name).toBeLessThan(ENEMY_RING_BASE_RADIUS);
    }
  });

  it('kiters stop kiting at a strictly greater range than they start (hysteresis)', () => {
    for (const archetype of ENEMY_ARCHETYPES) {
      if (archetype.movementStyle !== 'kite') continue;
      expect(archetype.kiteStopRange, archetype.name).toBeGreaterThan(archetype.kiteTriggerRange);
    }
  });

  it('leash range always exceeds detection range (no flicker at the detection boundary)', () => {
    for (const archetype of ENEMY_ARCHETYPES) {
      expect(archetype.leashRange, archetype.name).toBeGreaterThan(archetype.detectionRange);
    }
  });

  it('every archetype has a positive spawn weight and positive health', () => {
    for (const archetype of ENEMY_ARCHETYPES) {
      expect(archetype.spawnWeight, archetype.name).toBeGreaterThan(0);
      expect(archetype.health, archetype.name).toBeGreaterThan(0);
    }
  });
});

describe('createArchetypePicker', () => {
  it('is deterministic - the same seed yields the same assignment sequence', () => {
    const a = createArchetypePicker(1337);
    const b = createArchetypePicker(1337);
    for (let i = 0; i < 50; i++) {
      expect(a().name).toBe(b().name);
    }
  });

  it('only ever returns real archetypes', () => {
    const pick = createArchetypePicker(99);
    for (let i = 0; i < 200; i++) {
      expect(ENEMY_ARCHETYPES).toContain(pick());
    }
  });

  it('roughly matches the configured spawn weights over a large sample', () => {
    const pick = createArchetypePicker(7);
    const counts = new Map<string, number>();
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const name = pick().name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const totalWeight = ENEMY_ARCHETYPES.reduce((sum, a) => sum + a.spawnWeight, 0);
    for (const archetype of ENEMY_ARCHETYPES) {
      const expected = archetype.spawnWeight / totalWeight;
      const actual = (counts.get(archetype.name) ?? 0) / n;
      // Loose tolerance - this guards against a weight being ignored entirely, not sampling noise.
      expect(Math.abs(actual - expected), archetype.name).toBeLessThan(0.03);
    }
  });
});

describe('the Warden', () => {
  const straggler = archetypeNamed('The Straggler');

  it('is spawned by name and never by the random picker', () => {
    expect(archetypeNamed('The Warden')).toBe(WARDEN);
    expect(ENEMY_ARCHETYPES).not.toContain(WARDEN);
    expect(ELITE_ARCHETYPES).toContain(WARDEN);
    const pick = createArchetypePicker(4242);
    for (let i = 0; i < 2000; i++) expect(pick().name).not.toBe(WARDEN.name);
  });

  it('has four times the health of a rifleman, is slower, and fires longer bursts', () => {
    expect(WARDEN.health).toBe(straggler.health * 4);
    expect(WARDEN.moveSpeed).toBeLessThan(straggler.moveSpeed);
    expect(WARDEN.burstCount).toBeGreaterThan(straggler.burstCount);
    // A burst is not simply more damage per second for longer: per round it hits softer.
    expect(WARDEN.rangedDamage).toBeLessThan(straggler.rangedDamage);
  });

  it('is visibly bigger and tinted, and no ordinary archetype is', () => {
    expect(WARDEN.look!.scale).toBeGreaterThan(1.15);
    expect(WARDEN.look!.tint).not.toBe(0xffffff);
    for (const archetype of ENEMY_ARCHETYPES) expect(archetype.look, archetype.name).toBeUndefined();
  });

  it('keeps the invariants every archetype keeps', () => {
    expect(WARDEN.detectionRange).toBeLessThan(ENEMY_RING_BASE_RADIUS);
    expect(WARDEN.leashRange).toBeGreaterThan(WARDEN.detectionRange);
    expect(WARDEN.health).toBeGreaterThan(0);
  });
});
