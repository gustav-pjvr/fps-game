import { describe, expect, it } from 'vitest';
import { resolveWeaponLoadout, pickGunGameUpgrade, modeUsesCustomLoadout, WEAPON_CATEGORIES } from './gameModes.ts';
import type { PlayerLoadout } from './gameModes.ts';

describe('modeUsesCustomLoadout', () => {
  it('is true only for the three unrestricted modes', () => {
    expect(modeUsesCustomLoadout('default')).toBe(true);
    expect(modeUsesCustomLoadout('kingOfTheHill')).toBe(true);
    expect(modeUsesCustomLoadout('gooseHorde')).toBe(true);
    expect(modeUsesCustomLoadout('gunGame')).toBe(false);
    expect(modeUsesCustomLoadout('oneShotOneKill')).toBe(false);
    expect(modeUsesCustomLoadout('sniperDuel')).toBe(false);
    expect(modeUsesCustomLoadout('knifeOnly')).toBe(false);
    expect(modeUsesCustomLoadout('gooseToss')).toBe(false);
  });
});

describe('resolveWeaponLoadout - unrestricted modes', () => {
  it('uses every chosen slot when a full custom loadout is provided', () => {
    const loadout: PlayerLoadout = { primary: 'shotgun', secondary: 'mp5', melee: 'knife' };
    expect(resolveWeaponLoadout('default', Math.random, loadout).weaponIds).toEqual(['shotgun', 'mp5', 'knife']);
  });

  it('falls back to the per-slot default for any empty slot rather than blocking', () => {
    const loadout: PlayerLoadout = { primary: null, secondary: null, melee: null };
    const resolved = resolveWeaponLoadout('kingOfTheHill', Math.random, loadout);
    expect(resolved.weaponIds).toEqual(['rifle', 'pistol', 'knife']);
  });

  it('falls back per-slot even when only some slots are chosen', () => {
    const loadout: PlayerLoadout = { primary: 'sniper', secondary: null, melee: null };
    expect(resolveWeaponLoadout('gooseHorde', Math.random, loadout).weaponIds).toEqual(['sniper', 'pistol', 'knife']);
  });

  it('falls back to the full 5-weapon arsenal when no custom loadout is passed at all', () => {
    expect(resolveWeaponLoadout('default').weaponIds).toEqual(['pistol', 'rifle', 'shotgun', 'sniper', 'knife']);
  });

  it('is unaffected by a custom loadout for a restricted mode', () => {
    const loadout: PlayerLoadout = { primary: 'shotgun', secondary: 'mp5', melee: 'knife' };
    expect(resolveWeaponLoadout('knifeOnly', Math.random, loadout).weaponIds).toEqual(['knife']);
    expect(resolveWeaponLoadout('oneShotOneKill', Math.random, loadout).weaponIds).toEqual(['pistol']);
  });
});

describe('resolveWeaponLoadout - gunGame', () => {
  it('picks exactly one weapon from the pool, including mp5', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const rng = () => i / 200;
      const resolved = resolveWeaponLoadout('gunGame', rng);
      expect(resolved.weaponIds).toHaveLength(1);
      seen.add(resolved.weaponIds[0]!);
    }
    expect(seen.has('mp5')).toBe(true);
    expect(seen.has('knife')).toBe(false);
  });
});

describe('pickGunGameUpgrade', () => {
  it('never returns the current weapon', () => {
    for (let i = 0; i < 200; i++) {
      const rng = () => i / 200;
      const upgrade = pickGunGameUpgrade('mp5', rng);
      expect(upgrade).not.toBe('mp5');
    }
  });
});

describe('WEAPON_CATEGORIES', () => {
  it('categorizes every equippable weapon per the requested grouping', () => {
    expect(WEAPON_CATEGORIES.sniper).toBe('primary');
    expect(WEAPON_CATEGORIES.rifle).toBe('primary');
    expect(WEAPON_CATEGORIES.shotgun).toBe('primary');
    expect(WEAPON_CATEGORIES.pistol).toBe('secondary');
    expect(WEAPON_CATEGORIES.mp5).toBe('secondary');
    expect(WEAPON_CATEGORIES.knife).toBe('melee');
    expect(WEAPON_CATEGORIES.gooseLauncher).toBe('special');
  });
});
