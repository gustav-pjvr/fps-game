import { describe, expect, it } from 'vitest';
import { ENEMY_WEAPON_LOUDNESS_RANGE, PLAYER_HEALTH, WEAPON_BURST_SHOT_INTERVAL_SECONDS } from '../core/config.ts';
import { falloffMultiplier, WEAPON_DEFINITIONS, weaponIdsIn } from './definitions.ts';
import { meleePose } from './meleeSwing.ts';
import { WEAPON_MODEL_BUILDERS } from './models/registry.ts';
import { getWeaponBlueprint } from './models/weaponModels.ts';

const definitions = Object.values(WEAPON_DEFINITIONS);

describe('the arsenal', () => {
  it('holds 5 secondaries, 7 primaries, 6 blades and the reward launcher, each with its own name', () => {
    expect(weaponIdsIn('secondary')).toEqual(['pistol', 'mp5', 'revolver', 'machinePistol', 'sawnOff']);
    expect(weaponIdsIn('primary')).toEqual(['rifle', 'smg', 'battleRifle', 'lmg', 'dmr', 'shotgun', 'sniper']);
    expect(weaponIdsIn('melee')).toEqual(['knife', 'karambit', 'machete', 'tanto', 'hatchet', 'spike']);
    expect(weaponIdsIn('special')).toEqual(['gooseLauncher']);
    expect(new Set(definitions.map((definition) => definition.name)).size).toBe(definitions.length);
    for (const [key, definition] of Object.entries(WEAPON_DEFINITIONS)) expect(definition.id).toBe(key);
  });

  it('gives every weapon but the empty hands a model, and every weapon a hearing range', () => {
    for (const definition of definitions) {
      expect(Object.hasOwn(WEAPON_MODEL_BUILDERS, definition.id), definition.id).toBe(definition.id !== 'unarmed');
      expect(ENEMY_WEAPON_LOUDNESS_RANGE[definition.id], `${definition.id} loudness`).toBeTypeOf('number');
    }
    expect(Object.keys(WEAPON_MODEL_BUILDERS).sort()).toEqual(definitions.filter((d) => d.id !== 'unarmed').map((d) => d.id).sort());
  });

  it('keeps every gun inside sane handling bounds', () => {
    for (const definition of definitions.filter((d) => d.kind === 'ranged')) {
      const { id } = definition;
      expect(definition.fireRate, id).toBeGreaterThan(0);
      expect(Number.isFinite(definition.magazineSize) && definition.magazineSize > 0, id).toBe(true);
      expect(definition.adsSpreadMultiplier, id).toBeLessThanOrEqual(1);
      expect(definition.mobility ?? 1, id).toBeGreaterThanOrEqual(0.85);
      expect(definition.mobility ?? 1, id).toBeLessThanOrEqual(1.1);
      if (definition.falloff) {
        expect(definition.falloff.end, id).toBeGreaterThan(definition.falloff.start);
        expect(definition.falloff.min, id).toBeGreaterThan(0);
        expect(definition.falloff.min, id).toBeLessThan(1);
      }
      // No gun kills a full-health player with one body shot at its own range (the fixed modes
      // do that with a damage override).
      if (!definition.isProjectile) expect(definition.damage * definition.pelletCount, id).toBeLessThanOrEqual(PLAYER_HEALTH * 1.1);
    }
  });

  it('gives every blade two attacks that connect inside their swing and recover after it', () => {
    for (const definition of definitions.filter((d) => d.category === 'melee')) {
      const { id, melee } = definition;
      expect(melee, id).toBeDefined();
      for (const attack of [melee!.primary, melee!.alt]) {
        expect(attack.poses.length, id).toBeGreaterThan(0);
        expect(attack.hitAt, id).toBeGreaterThan(0);
        const lastHit = attack.hitAt + (attack.repeats ?? 0) * (attack.repeatInterval ?? 0);
        expect(lastHit, `${id}: every strike lands during the swing`).toBeLessThan(attack.duration);
        expect(attack.cooldown, `${id}: recovery is not shorter than the swing`).toBeGreaterThanOrEqual(attack.duration);
        expect(attack.rays, id).toBeGreaterThanOrEqual(1);
        for (const poseId of attack.poses) {
          for (const t of [0, 0.2, 0.5, 0.8]) {
            for (const value of Object.values(meleePose(t, poseId))) expect(Number.isFinite(value), `${id} ${poseId}`).toBe(true);
          }
          expect(meleePose(1, poseId)).toEqual({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 });
        }
      }
      // The alternate attack hits harder and recovers slower than the primary.
      const altTotal = melee!.alt.damage * (1 + (melee!.alt.repeats ?? 0));
      expect(altTotal, id).toBeGreaterThan(melee!.primary.damage);
      expect(melee!.alt.cooldown, id).toBeGreaterThan(melee!.primary.cooldown);
      expect(definition.damage).toBe(melee!.primary.damage);
    }
  });

  it('plays each fire clip to its end before the next shot', () => {
    for (const definition of definitions.filter((d) => d.kind === 'ranged')) {
      let fire;
      try {
        fire = getWeaponBlueprint(definition.id).animations.fire;
      } catch (error) {
        if (String(error).includes('not built yet')) continue;
        throw error;
      }
      if (!fire) continue;
      const between = (definition.burstCount ?? 1) > 1 ? WEAPON_BURST_SHOT_INTERVAL_SECONDS : 1 / definition.fireRate;
      expect(fire.duration, `${definition.id} fire clip`).toBeLessThanOrEqual(between + 1e-6);
    }
  });
});

describe('falloffMultiplier', () => {
  const falloff = { start: 10, end: 30, min: 0.5 };
  it('holds full damage to the start, the floor from the end, and a straight line between', () => {
    expect(falloffMultiplier(falloff, 0)).toBe(1);
    expect(falloffMultiplier(falloff, 10)).toBe(1);
    expect(falloffMultiplier(falloff, 20)).toBeCloseTo(0.75);
    expect(falloffMultiplier(falloff, 30)).toBe(0.5);
    expect(falloffMultiplier(falloff, 400)).toBe(0.5);
  });
  it('is 1 at any range for a weapon without falloff', () => {
    expect(falloffMultiplier(undefined, 500)).toBe(1);
  });
});
