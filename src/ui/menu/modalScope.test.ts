import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModalScope } from './modalScope.ts';

interface FakeElement {
  inert: boolean;
  isConnected: boolean;
  contains: (other: unknown) => boolean;
  focus: () => void;
  parentElement?: { children: FakeElement[] };
}

function setup(): { doc: { activeElement: unknown; body: object }; pause: FakeElement; hud: FakeElement; overlay: FakeElement; button: FakeElement; close: FakeElement } {
  const doc: { activeElement: unknown; body: object } = { activeElement: null, body: {} };
  vi.stubGlobal('document', doc);
  const make = (): FakeElement => {
    const element: FakeElement = {
      inert: false, isConnected: true, contains: (other) => other === element,
      focus: () => { doc.activeElement = element; },
    };
    return element;
  };
  const pause = make(); const hud = make(); const overlay = make(); const button = make(); const close = make();
  const parent = { children: [pause, hud, overlay] };
  for (const element of [pause, hud, overlay]) element.parentElement = parent;
  overlay.contains = (other) => other === overlay || other === close;
  button.focus(); // the pause menu's Loadout button had focus
  return { doc, pause, hud, overlay, button, close };
}

afterEach(() => vi.unstubAllGlobals());

describe('ModalScope', () => {
  it('makes the siblings inert, moves focus in, and puts everything back on leave', () => {
    const { doc, pause, hud, overlay, button, close } = setup();
    const scope = new ModalScope();
    scope.enter(overlay as unknown as HTMLElement, close as unknown as HTMLElement);
    expect(pause.inert && hud.inert).toBe(true);
    expect(overlay.inert).toBe(false);
    expect(doc.activeElement).toBe(close);
    scope.leave();
    expect(pause.inert || hud.inert).toBe(false);
    expect(doc.activeElement).toBe(button);
  });

  it('leaves siblings that were already inert as they were, and survives a second enter and a second leave', () => {
    const { doc, pause, hud, overlay, button, close } = setup();
    hud.inert = true;
    const scope = new ModalScope();
    scope.enter(overlay as unknown as HTMLElement, close as unknown as HTMLElement);
    scope.enter(overlay as unknown as HTMLElement, close as unknown as HTMLElement);
    scope.leave();
    scope.leave();
    expect(pause.inert).toBe(false);
    expect(hud.inert).toBe(true);
    expect(doc.activeElement).toBe(button);
  });

  it('nests: an overlay opened from inside another works while open and is inert again when it closes', () => {
    // The Loadout page (pause, here) opens first and makes the Skins page (overlay) inert with the rest.
    const { pause, hud, overlay, close } = setup();
    const outer = new ModalScope();
    outer.enter(pause as unknown as HTMLElement, null);
    expect(overlay.inert && hud.inert).toBe(true);

    const inner = new ModalScope();
    inner.enter(overlay as unknown as HTMLElement, close as unknown as HTMLElement);
    // The page on top can be used; the one under it cannot.
    expect(overlay.inert).toBe(false);
    expect(pause.inert).toBe(true);

    inner.leave();
    expect(overlay.inert).toBe(true);
    expect(pause.inert).toBe(false);
    outer.leave();
    expect(overlay.inert || hud.inert || pause.inert).toBe(false);
  });

  it('does not refocus an element that has been removed', () => {
    const { doc, overlay, button, close } = setup();
    const scope = new ModalScope();
    scope.enter(overlay as unknown as HTMLElement, close as unknown as HTMLElement);
    button.isConnected = false;
    scope.leave();
    expect(doc.activeElement).toBe(close);
  });
});
