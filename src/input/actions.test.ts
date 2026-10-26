import { describe, expect, it } from 'vitest';
import { keyHint } from './actions.ts';
import { gamepadHint } from './GamepadInput.ts';
import { mergeKeyBindings } from '../settings/Settings.ts';

describe('input hints by action', () => {
  it('names the key the action is bound to, wherever the player put it', () => {
    expect(keyHint({ KeyQ: 'grenade' }, 'grenade')).toBe('Q');
    expect(keyHint({ KeyG: 'grenade', Space: 'jump' }, 'grenade')).toBe('G');
    expect(keyHint({ Space: 'jump' }, 'jump')).toBe('Space');
  });

  it('says Unbound when no key carries the action, as with an old save that has Q on another action', () => {
    expect(keyHint({}, 'grenade')).toBe('Unbound');
    const merged = mergeKeyBindings({ KeyQ: 'reload', KeyR: 'jump' });
    expect(merged.KeyQ).toBe('reload');
    expect(keyHint(merged, 'grenade')).toBe('Unbound');
  });

  it('names the pad button from the action mapping, not from a key letter', () => {
    expect(gamepadHint('interact')).toBe('B (Circle)');
    expect(gamepadHint('flashlight')).toBe('D-pad up');
    expect(gamepadHint('grenade')).toBe('RB (R1)');
    expect(gamepadHint('sprint')).toBeNull();
  });
});
