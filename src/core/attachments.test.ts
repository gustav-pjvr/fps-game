import { afterEach, describe, expect, it, vi } from 'vitest';
import { fittedAttachments, loadStoredAttachments, saveAttachments, toggleFitted } from './attachments.ts';

function stubStorage(initial: string | null) {
  const storage = { value: initial, getItem: vi.fn(() => storage.value), setItem: vi.fn((_key: string, next: string) => { storage.value = next; }) };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

describe('fitted attachments', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('every gun is bare until something is fitted', () => {
    stubStorage(null);
    const fitted = loadStoredAttachments();
    expect(fitted).toEqual({});
    expect(fittedAttachments(fitted, 'rifle')).toEqual([]);
  });

  it('fits and takes off per gun, and a bare gun loses its entry', () => {
    let fitted = toggleFitted({}, 'rifle', 'torch');
    fitted = toggleFitted(fitted, 'rifle', 'laser');
    fitted = toggleFitted(fitted, 'pistol', 'laser');
    expect(fitted).toEqual({ rifle: ['laser', 'torch'], pistol: ['laser'] });
    // One rail on the pistol: the torch takes the laser's place.
    expect(toggleFitted(fitted, 'pistol', 'torch').pistol).toEqual(['torch']);
    expect(toggleFitted(fitted, 'pistol', 'laser')).toEqual({ rifle: ['laser', 'torch'] });
    // A gun that cannot take it changes nothing.
    expect(toggleFitted(fitted, 'sniper', 'laser')).toEqual(fitted);
  });

  it('saves and loads through wrapped localStorage', () => {
    const storage = stubStorage(null);
    saveAttachments({ rifle: ['laser', 'torch'] });
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(loadStoredAttachments()).toEqual({ rifle: ['laser', 'torch'] });
  });

  it('drops anything it cannot trust', () => {
    stubStorage(JSON.stringify({ rifle: ['torch', 'bayonet'], sniper: ['laser'], noSuchWeapon: ['laser'], shotgun: 'torch', pistol: ['laser', 'torch'], smg: [] }));
    expect(loadStoredAttachments()).toEqual({ rifle: ['torch'], pistol: ['torch'] });
    stubStorage('not json');
    expect(loadStoredAttachments()).toEqual({});
    stubStorage('[1,2]');
    expect(loadStoredAttachments()).toEqual({});
  });
});
