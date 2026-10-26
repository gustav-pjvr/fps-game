import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hud } from './hud.ts';
import { Settings } from '../settings/Settings.ts';

/** A bare element that counts every property write, style and dataset writes included. */
function fakeDom(): { createElement: () => Record<string, unknown>; writes: () => number; reset: () => void } {
  let count = 0;
  const counting = <T extends object>(target: T): T => new Proxy(target, {
    set(object, key, value) { count++; (object as Record<string | symbol, unknown>)[key] = value; return true; },
  });
  return {
    createElement: () => {
      const noop = (): void => {};
      return counting({
        style: counting({}), dataset: counting({}), appendChild: noop, append: noop, insertBefore: noop,
        remove: noop, replaceChildren: noop, setAttribute: () => { count++; }, addEventListener: noop,
        getContext: () => null,
      });
    },
    writes: () => count,
    reset: () => { count = 0; },
  };
}

function makeHud(): { hud: Hud; dom: ReturnType<typeof fakeDom> } {
  const dom = fakeDom();
  vi.stubGlobal('document', { createElement: dom.createElement });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) });
  const hud = new Hud(dom.createElement() as unknown as HTMLElement);
  return { hud, dom };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Hud per-tick writes', () => {
  it('writes the light meter only when the shown percent changes', () => {
    const { hud, dom } = makeHud();
    hud.setVisibility(0.5);
    dom.reset();
    for (let i = 0; i < 20; i++) hud.setVisibility(0.5 + i * 0.0001);
    expect(dom.writes()).toBe(0);
    hud.setVisibility(0.62);
    expect(dom.writes()).toBeGreaterThan(0);
    dom.reset();
    hud.setVisibility(0.62);
    hud.setVisibility(null);
    const afterHide = dom.writes();
    hud.setVisibility(null);
    expect(dom.writes()).toBe(afterHide);
  });

  it('writes the prompt only when its key, hint or text changes', () => {
    const { hud, dom } = makeHud();
    hud.setPrompt('interact', 'OPEN DOOR');
    dom.reset();
    for (let i = 0; i < 20; i++) hud.setPrompt('interact', 'OPEN DOOR');
    expect(dom.writes()).toBe(0);
    hud.setPrompt('interact', 'CLOSE DOOR');
    expect(dom.writes()).toBeGreaterThan(0);
    hud.setPrompt('interact', null);
    dom.reset();
    hud.setPrompt('interact', null);
    expect(dom.writes()).toBe(0);
  });

  it('takes the prompt key from the action, so a rebound or unbound key shows truthfully', () => {
    const { hud } = makeHud();
    const spy = vi.spyOn(Settings, 'getKeyBindings');
    spy.mockReturnValue({ KeyG: 'interact' });
    hud.setPrompt('interact', 'OPEN DOOR');
    const key = (hud as unknown as { promptKey: { dataset: Record<string, string> } }).promptKey;
    expect(key.dataset.mouseHint).toBe('G');
    expect(key.dataset.gamepadHint).toBe('B (Circle)');
    spy.mockReturnValue({});
    hud.setPrompt('interact', 'OPEN DOOR');
    expect(key.dataset.mouseHint).toBe('Unbound');
    hud.setPrompt('flashlight', 'TORCH');
    expect(key.dataset.gamepadHint).toBe('D-pad up');
  });
});
