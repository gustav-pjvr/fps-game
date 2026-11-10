import { afterEach, describe, expect, it, vi } from 'vitest';
import { equipSkin, equippedSkin, loadStoredSkins, saveSkins } from './skins.ts';

function stubStorage(initial: string | null) {
  const storage = { value: initial, getItem: vi.fn(() => storage.value), setItem: vi.fn((_key: string, next: string) => { storage.value = next; }) };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

describe('equipped skins', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('wears the default skin on everything until one is equipped', () => {
    stubStorage(null);
    const skins = loadStoredSkins();
    expect(skins).toEqual({});
    expect(equippedSkin(skins, 'rifle')).toBe('service');
  });

  it('equips a skin per weapon, and the default skin removes the entry', () => {
    let skins = equipSkin({}, 'rifle', 'pulse');
    skins = equipSkin(skins, 'knife', 'gilded');
    expect(skins).toEqual({ rifle: 'pulse', knife: 'gilded' });
    expect(equippedSkin(skins, 'rifle')).toBe('pulse');
    expect(equippedSkin(skins, 'pistol')).toBe('service');
    expect(equipSkin(skins, 'rifle', 'service')).toEqual({ knife: 'gilded' });
    expect(equipSkin(skins, 'noSuchWeapon', 'pulse')).toBe(skins);
  });

  it('saves and loads through wrapped localStorage', () => {
    const storage = stubStorage(null);
    saveSkins({ rifle: 'ember' });
    expect(storage.setItem).toHaveBeenCalledWith('fps-game-skins', JSON.stringify({ rifle: 'ember' }));
    expect(loadStoredSkins()).toEqual({ rifle: 'ember' });
  });

  it('drops unknown weapons, unknown skins and malformed data instead of trusting them', () => {
    stubStorage(JSON.stringify({ rifle: 'pulse', pistol: 'chrome', railgun: 'pulse', knife: 7, sniper: 'service' }));
    expect(loadStoredSkins()).toEqual({ rifle: 'pulse' });
    stubStorage('not json');
    expect(loadStoredSkins()).toEqual({});
    stubStorage('[1,2]');
    expect(loadStoredSkins()).toEqual({});
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(loadStoredSkins()).toEqual({});
    expect(() => saveSkins({ rifle: 'pulse' })).not.toThrow();
  });
});
