import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEY_BINDINGS, type Action } from '../input/actions.ts';
import { mergeKeyBindings } from './Settings.ts';

/** Bindings saved before the torch existed: the defaults without KeyF. */
function beforeTorch(): Record<string, Action> {
  const stored = { ...DEFAULT_KEY_BINDINGS };
  delete stored.KeyF;
  return stored;
}

describe('mergeKeyBindings', () => {
  it('binds the torch to its default F when F is free', () => {
    expect(mergeKeyBindings(beforeTorch()).KeyF).toBe('flashlight');
    expect(mergeKeyBindings({}).KeyF).toBe('flashlight');
  });

  it('never takes F from an action the player bound there', () => {
    const stored = beforeTorch();
    delete stored.KeyR;
    stored.KeyF = 'reload';
    const merged = mergeKeyBindings(stored);
    expect(merged.KeyF).toBe('reload');
    expect(merged.KeyR).toBeUndefined();
    expect(Object.values(merged)).not.toContain('flashlight');
  });

  it('gives a displaced action its default key back once that key is free, and never binds an action twice', () => {
    // Reload moved to Q, jump moved to J: their defaults R and Space stay free, not re-added.
    const stored = beforeTorch();
    delete stored.KeyR; delete stored.Space;
    stored.KeyQ = 'reload'; stored.KeyJ = 'jump';
    const merged = mergeKeyBindings(stored);
    expect(merged.KeyQ).toBe('reload');
    expect(merged.KeyR).toBeUndefined();
    expect(merged.Space).toBeUndefined();
    expect(merged.KeyF).toBe('flashlight');
    // A fixed binding missing from an old save comes back on its free default key.
    delete stored.KeyE;
    expect(mergeKeyBindings(stored).KeyE).toBe('interact');
  });

  it('keeps a torch the player moved to another key there', () => {
    const stored = { ...beforeTorch(), KeyG: 'flashlight' as const };
    expect(mergeKeyBindings(stored).KeyG).toBe('flashlight');
    expect(mergeKeyBindings(stored).KeyF).toBeUndefined();
  });

  it('binds the one grenade to its default Q in a save from before it, unless Q is taken', () => {
    const stored = beforeTorch();
    delete stored.KeyQ;
    expect(mergeKeyBindings(stored).KeyQ).toBe('grenade');
    stored.KeyQ = 'reload';
    delete stored.KeyR;
    const merged = mergeKeyBindings(stored);
    expect(merged.KeyQ).toBe('reload');
    expect(Object.values(merged)).not.toContain('grenade');
  });

  it('drops the old frag and flash bindings and puts the grenade on Q', () => {
    // An earlier build's save: G threw the frag, Q the flash.
    const stored = { ...beforeTorch(), KeyG: 'grenadeFrag', KeyQ: 'grenadeFlash' } as unknown as Record<string, Action>;
    const merged = mergeKeyBindings(stored);
    expect(merged.KeyQ).toBe('grenade');
    expect(merged.KeyG).toBeUndefined();
    expect(Object.values(merged)).not.toContain('grenadeFrag');
    expect(Object.values(merged)).not.toContain('grenadeFlash');
    // Unknown actions are dropped wherever they sit.
    const odd = { ...beforeTorch(), KeyZ: 'noSuchAction' } as unknown as Record<string, Action>;
    expect(mergeKeyBindings(odd).KeyZ).toBeUndefined();
  });

  it('leaves Q alone when the player bound it to something else in an old save', () => {
    const stored = { ...beforeTorch(), KeyQ: 'jump', KeyG: 'grenadeFrag' } as unknown as Record<string, Action>;
    delete stored.Space;
    const merged = mergeKeyBindings(stored);
    expect(merged.KeyQ).toBe('jump');
    expect(merged.KeyG).toBeUndefined();
    expect(Object.values(merged)).not.toContain('grenade');
  });
});

describe('stored controller settings', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  async function load(saved: object) {
    const storage = { getItem: vi.fn(() => JSON.stringify(saved)), setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.resetModules();
    return { settings: (await import('./Settings.ts')).Settings, storage };
  }

  it('loads old saves with controller defaults without changing keyboard bindings', async () => {
    const { settings } = await load({ mouseSensitivity: 1.5, keyBindings: { ...DEFAULT_KEY_BINDINGS } });
    expect(settings.getControllerSensitivity()).toBe(1);
    expect(settings.getControllerInvertY()).toBe(false);
    expect(settings.getControllerAimAssist()).toBe(true);
    expect(settings.getControllerVibration()).toBe(true);
    expect(settings.getMouseSensitivity()).toBe(1.5);
    expect(settings.getKeyBindings()).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('hands out the same frozen bindings snapshot until a binding changes', async () => {
    const { settings } = await load({});
    const first = settings.getKeyBindings();
    expect(settings.getKeyBindings()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    settings.rebindKey('grenade', 'KeyZ');
    const second = settings.getKeyBindings();
    expect(second).not.toBe(first);
    expect(second.KeyZ).toBe('grenade');
    expect(first.KeyZ).toBeUndefined();
    expect(settings.getKeyBindings()).toBe(second);
    settings.resetKeyBindings();
    expect(settings.getKeyBindings()).not.toBe(second);
    expect(settings.getKeyBindings()).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('persists all controller settings under the existing key and reloads them', async () => {
    const { settings, storage } = await load({});
    settings.setControllerSensitivity(2);
    settings.setControllerInvertY(true);
    settings.setControllerAimAssist(false);
    settings.setControllerVibration(false);
    const [key, raw] = storage.setItem.mock.calls.at(-1)!;
    expect(key).toBe('fps-game-settings-v1');
    const { settings: reloaded } = await load(JSON.parse(raw));
    expect(reloaded.getControllerSensitivity()).toBe(2);
    expect(reloaded.getControllerInvertY()).toBe(true);
    expect(reloaded.getControllerAimAssist()).toBe(false);
    expect(reloaded.getControllerVibration()).toBe(false);
  });

  it('clamps sensitivity and ignores malformed saved values', async () => {
    const { settings } = await load({ controllerSensitivity: 10, controllerAimAssist: 'false', controllerInvertY: 1 });
    expect(settings.getControllerSensitivity()).toBe(3);
    expect(settings.getControllerAimAssist()).toBe(true);
    expect(settings.getControllerInvertY()).toBe(false);
    settings.setControllerSensitivity(0);
    expect(settings.getControllerSensitivity()).toBe(0.3);
    settings.setControllerSensitivity(NaN);
    expect(settings.getControllerSensitivity()).toBe(1);
  });
});
