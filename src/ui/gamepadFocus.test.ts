import { afterEach, describe, expect, it, vi } from 'vitest';
import { backControl, GamepadFocus, MENU_PRESS_GRACE, nearestFocus, type FocusRect } from './gamepadFocus.ts';
import { gamepadInput, type GamepadFrame } from '../input/GamepadInput.ts';

const rect = (x: number, y: number, width = 20, height = 20): FocusRect => ({ x, y, width, height });

describe('spatial controller focus', () => {
  it('selects the nearest control in each direction', () => {
    const rects = [rect(100, 100), rect(40, 100), rect(140, 100), rect(100, 20), rect(100, 140), rect(200, 100)];
    expect(nearestFocus(rects, 0, 'left')).toBe(1);
    expect(nearestFocus(rects, 0, 'right')).toBe(2);
    expect(nearestFocus(rects, 0, 'up')).toBe(3);
    expect(nearestFocus(rects, 0, 'down')).toBe(4);
  });

  it('uses rectangle centers, handles offset layouts and never wraps off an edge', () => {
    const rects = [rect(0, 0, 100, 40), rect(20, 70), rect(300, 50)];
    expect(nearestFocus(rects, 0, 'down')).toBe(1);
    expect(nearestFocus(rects, 0, 'up')).toBe(0);
    expect(nearestFocus(rects, 2, 'right')).toBe(2);
  });

  it('starts on the first control and safely handles an empty screen', () => {
    expect(nearestFocus([rect(10, 10)], -1, 'down')).toBe(0);
    expect(nearestFocus([], -1, 'down')).toBe(-1);
  });
});

class FakeControl {
  isConnected = true;
  clicks = 0;
  constructor(readonly textContent: string, private readonly doc: { activeElement: unknown }) {}
  focus(): void { this.doc.activeElement = this; }
  click(): void { this.clicks++; }
  getBoundingClientRect(): FocusRect { return { x: 0, y: 0, width: 10, height: 10 }; }
}

const frame = (down: number[], pressed: number[]): GamepadFrame => ({
  move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, buttons: new Set(down), pressed: new Set(pressed),
  actions: new Set(), justPressed: new Set(),
});

describe('controller menu button gate', () => {
  afterEach(() => { vi.unstubAllGlobals(); gamepadInput.setActiveDevice('mouse'); });

  function setup(): { menu: GamepadFocus; respawn: FakeControl; doc: { activeElement: unknown } } {
    gamepadInput.setActiveDevice('gamepad');
    const doc: { activeElement: unknown } = { activeElement: null };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLSelectElement', class {});
    const respawn = new FakeControl('Respawn', doc);
    const menu = new GamepadFocus(() => [respawn as unknown as HTMLElement]);
    return { menu, respawn, doc };
  }
  const flush = (): Promise<void> => Promise.resolve();

  it('ignores an A that was already down when the menu took focus, until it is released', async () => {
    const { menu, respawn } = setup();
    menu.update(frame([0], [0]), 0.016);   // jump pressed as the results screen appears
    menu.update(frame([0], []), 0.016);    // still held
    await flush();
    expect(respawn.clicks).toBe(0);
    menu.update(frame([], []), MENU_PRESS_GRACE); // released, after the grace
    menu.update(frame([0], [0]), 0.016);   // a new press
    await flush();
    expect(respawn.clicks).toBe(1);
  });

  it('ignores a held A in the very frame the menu gets focus even when it reads as a fresh edge', async () => {
    const { menu, respawn } = setup();
    menu.update(frame([0], [0]), 0.016);
    await flush();
    expect(respawn.clicks).toBe(0);
  });

  it('ignores a fresh A a few frames after the menu appears (a reflexive jump), then accepts one', async () => {
    const { menu, respawn } = setup();
    menu.update(frame([], []), 0.016);
    menu.update(frame([0], [0]), 0.05);
    await flush();
    expect(respawn.clicks).toBe(0);
    menu.update(frame([], []), MENU_PRESS_GRACE);
    menu.update(frame([0], [0]), 0.016);
    await flush();
    expect(respawn.clicks).toBe(1);
  });
});

describe('B back control', () => {
  const labelled = (...labels: string[]) => labels.map((textContent) => ({ textContent }));

  it('picks Back, Cancel, Close, Done or Resume', () => {
    for (const label of ['Back', 'cancel', 'Close', 'Done', 'Resume']) {
      const controls = labelled('Respawn', label);
      expect(backControl(controls)).toBe(controls[1]);
    }
  });

  it('never picks Return to Lobby, so B cannot leave a match from the death or match-end screen', () => {
    expect(backControl(labelled('Respawn', 'Return to Lobby'))).toBeUndefined();
    expect(backControl(labelled('Return to Lobby'))).toBeUndefined();
  });
});
