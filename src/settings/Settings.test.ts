import { describe, expect, it } from 'vitest';
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

  it('binds the grenades to their default G and Q in a save from before them, unless taken', () => {
    const stored = beforeTorch();
    delete stored.KeyG; delete stored.KeyQ;
    const merged = mergeKeyBindings(stored);
    expect(merged.KeyG).toBe('grenadeFrag');
    expect(merged.KeyQ).toBe('grenadeFlash');
    stored.KeyQ = 'reload';
    expect(mergeKeyBindings(stored).KeyQ).toBe('reload');
    expect(Object.values(mergeKeyBindings(stored))).not.toContain('grenadeFlash');
  });
});
