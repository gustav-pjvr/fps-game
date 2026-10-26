import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { equipGrenade, equipWeapon, equippedGrenade, equippedWeaponId, loadStoredLoadout, saveLoadout } from './loadout.ts';
import type { PlayerLoadout } from './gameModes.ts';

const KEY = 'fps-game-loadout';

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('loadStoredLoadout', () => {
  it('starts empty with the frag grenade when nothing is saved', () => {
    expect(loadStoredLoadout()).toEqual({ primary: null, secondary: null, melee: null, grenade: 'frag' });
  });

  it('round-trips the grenade choice', () => {
    saveLoadout({ primary: 'sniper', secondary: 'mp5', melee: 'knife', grenade: 'flash' });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ grenade: 'flash' });
    expect(loadStoredLoadout()).toEqual({ primary: 'sniper', secondary: 'mp5', melee: 'knife', grenade: 'flash' });
  });

  it('keeps the weapons of a loadout saved before grenades existed and gives it the frag', () => {
    localStorage.setItem(KEY, JSON.stringify({ primary: 'shotgun', secondary: null, melee: 'knife' }));
    expect(loadStoredLoadout()).toEqual({ primary: 'shotgun', secondary: null, melee: 'knife', grenade: 'frag' });
  });

  it('replaces an unknown grenade with the frag but keeps the weapons', () => {
    localStorage.setItem(KEY, JSON.stringify({ primary: 'rifle', secondary: 'pistol', melee: 'knife', grenade: 'smoke' }));
    expect(loadStoredLoadout()).toEqual({ primary: 'rifle', secondary: 'pistol', melee: 'knife', grenade: 'frag' });
  });

  it('falls back to the empty loadout on malformed data', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadStoredLoadout().primary).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ primary: 4, secondary: null, melee: null, grenade: 'flash' }));
    expect(loadStoredLoadout()).toEqual({ primary: null, secondary: null, melee: null, grenade: 'frag' });
  });

  it('hands out a fresh object each time, so a caller cannot change the default', () => {
    const first = loadStoredLoadout();
    first.grenade = 'flash';
    expect(loadStoredLoadout().grenade).toBe('frag');
  });
});

describe('loadout selection', () => {
  const base: PlayerLoadout = { primary: null, secondary: null, melee: null, grenade: 'frag' };

  it('puts a weapon only in its own category slot', () => {
    expect(equipWeapon(base, 'sniper')).toEqual({ ...base, primary: 'sniper' });
    expect(equipWeapon(base, 'mp5')).toEqual({ ...base, secondary: 'mp5' });
    expect(equipWeapon(base, 'knife')).toEqual({ ...base, melee: 'knife' });
  });

  it('ignores reward-only and unknown weapons', () => {
    expect(equipWeapon(base, 'gooseLauncher')).toBe(base);
    expect(equipWeapon(base, 'unarmed')).toBe(base);
    expect(equipWeapon(base, 'nope')).toBe(base);
  });

  it('swaps the grenade without touching the weapons', () => {
    const armed: PlayerLoadout = { primary: 'shotgun', secondary: 'mp5', melee: 'knife', grenade: 'frag' };
    expect(equipGrenade(armed, 'flash')).toEqual({ ...armed, grenade: 'flash' });
  });

  it('reads empty slots as their defaults', () => {
    expect(equippedWeaponId(base, 'primary')).toBe('rifle');
    expect(equippedWeaponId(base, 'secondary')).toBe('pistol');
    expect(equippedWeaponId({ ...base, primary: 'sniper' }, 'primary')).toBe('sniper');
    expect(equippedGrenade({ primary: null, secondary: null, melee: null })).toBe('frag');
    expect(equippedGrenade({ ...base, grenade: 'flash' })).toBe('flash');
  });
});
