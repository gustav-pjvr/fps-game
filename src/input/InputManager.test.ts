import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from './InputManager.ts';
import { gamepadInput } from './GamepadInput.ts';
import { gamepadFocus } from '../ui/gamepadFocus.ts';
import { Settings } from '../settings/Settings.ts';
import { MOUSE_SENSITIVITY } from '../core/config.ts';

vi.mock('../ui/gamepadFocus.ts', () => ({
  gamepadFocus: { update: vi.fn() }, gamepadBack: vi.fn(),
  menuControls: () => [{ closest: () => true }],
}));

let input: InputManager;
let doc: EventTarget & { pointerLockElement: unknown; hidden: boolean };
let win: EventTarget;
let controller: Gamepad;
let canvas: HTMLCanvasElement;

function setPad(axes = [0, 0, 0, 0], down: number[] = []): void {
  controller = { index: 0, connected: true, mapping: 'standard', axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })),
  } as unknown as Gamepad;
}

function event(type: string, properties: object = {}): void {
  doc.dispatchEvent(Object.assign(new Event(type), properties));
}

beforeEach(() => {
  doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as unknown, hidden: false,
    documentElement: { dataset: {} }, querySelectorAll: () => [], exitPointerLock: vi.fn(),
  });
  vi.stubGlobal('document', doc);
  win = new EventTarget();
  vi.stubGlobal('window', win);
  setPad();
  vi.stubGlobal('navigator', { getGamepads: () => [controller] });
  gamepadInput.poll([]);
  gamepadInput.setActiveDevice('mouse');
  canvas = { requestPointerLock: vi.fn() } as unknown as HTMLCanvasElement;
  input = new InputManager(canvas);
  vi.spyOn(Settings, 'getMouseSensitivity').mockReturnValue(1);
  vi.spyOn(Settings, 'getControllerSensitivity').mockReturnValue(1);
  vi.spyOn(Settings, 'getControllerAimAssist').mockReturnValue(true);
  vi.spyOn(Settings, 'getControllerInvertY').mockReturnValue(false);
});

afterEach(() => {
  input.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('InputManager controller integration', () => {
  it('plays without pointer lock, pauses and resumes on Start edges', () => {
    gamepadInput.setActiveDevice('gamepad');
    input.resume();
    expect(input.isEngaged).toBe(true);
    expect(input.isLocked).toBe(false);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    setPad([], [9]);
    input.update();
    expect(input.isEngaged).toBe(false);
    input.update();
    expect(input.isEngaged).toBe(false);
    setPad(); input.update();
    setPad([], [9]); input.update();
    expect(input.isEngaged).toBe(true);
  });

  it('pauses when the window loses focus during pad play, and only then', () => {
    gamepadInput.setActiveDevice('gamepad'); input.resume();
    expect(input.isEngaged).toBe(true);
    win.dispatchEvent(new Event('blur'));
    expect(input.isEngaged).toBe(false);
    // Mouse play already pauses through the pointer lock loss; blur alone changes nothing there.
    gamepadInput.setActiveDevice('mouse'); input.resume();
    doc.pointerLockElement = canvas; event('pointerlockchange');
    expect(input.isEngaged).toBe(true);
    win.dispatchEvent(new Event('blur'));
    expect(input.isEngaged).toBe(true);
  });

  it('switches back on mouse movement or a key and preserves ordinary keyboard movement', () => {
    gamepadInput.setActiveDevice('gamepad'); input.resume();
    event('mousemove', { movementX: 4, movementY: 0 });
    expect(input.activeDevice).toBe('mouse');
    expect(input.isEngaged).toBe(false);
    doc.pointerLockElement = canvas; event('pointerlockchange');
    event('keydown', { code: 'KeyW' }); event('keydown', { code: 'KeyD' });
    expect(Math.hypot(input.getMoveVector().x, input.getMoveVector().y)).toBeCloseTo(1);
    gamepadInput.setActiveDevice('gamepad');
    event('keydown', { code: 'KeyR' });
    expect(input.activeDevice).toBe('mouse');
    expect(input.consumeJustPressed('reload')).toBe(true);
    event('keyup', { code: 'KeyW' }); event('keyup', { code: 'KeyD' });
    expect(input.getMoveVector()).toEqual({ x: 0, y: 0 });
    doc.pointerLockElement = null; event('pointerlockchange');
    expect(input.isEngaged).toBe(false);
  });

  it('keeps half stick speed and reports each pad action edge only once', () => {
    gamepadInput.setActiveDevice('gamepad'); input.resume();
    setPad([0.575, 0, 0, 0], [7]); input.update();
    expect(input.getMoveVector().x).toBeCloseTo(0.5);
    expect(input.isActionActive('fire')).toBe(true);
    expect(input.consumeJustPressed('fire')).toBe(true);
    input.update();
    expect(input.consumeJustPressed('fire')).toBe(false);
    setPad(); input.update();
    expect(input.isActionActive('fire')).toBe(false);
  });

  it('does not carry menu buttons into gameplay and polls menus while otherwise frozen', () => {
    gamepadInput.setActiveDevice('gamepad');
    setPad([], [0, 7]); input.update(1 / 60, true);
    expect(gamepadFocus.update).toHaveBeenCalledOnce();
    input.resume(); input.update();
    expect(input.isActionActive('jump')).toBe(false);
    expect(input.isActionActive('fire')).toBe(false);
    expect(input.consumeJustPressed('jump')).toBe(false);
    setPad(); input.update();
    setPad([], [0, 7]); input.update();
    expect(input.isActionActive('jump')).toBe(true);
    expect(input.isActionActive('fire')).toBe(true);
  });

  it('uses degrees per second independently of mouse sensitivity and applies invert Y', () => {
    gamepadInput.setActiveDevice('gamepad'); input.resume();
    vi.spyOn(Settings, 'getMouseSensitivity').mockReturnValue(2);
    setPad([0, 0, 1, 0]); input.update(0.1);
    expect(input.consumeLookDelta().dx * MOUSE_SENSITIVITY * 2).toBeCloseTo(22 * Math.PI / 180);
    vi.spyOn(Settings, 'getControllerInvertY').mockReturnValue(true);
    setPad([0, 0, 0, 1]); input.update(0.1);
    expect(input.consumeLookDelta().dy * MOUSE_SENSITIVITY * 2).toBeCloseTo(-15 * Math.PI / 180);
  });

  it('slows look to 55 percent, checks targets at most every other tick and never checks for mouse', () => {
    gamepadInput.setActiveDevice('gamepad'); input.resume();
    const overEnemy = vi.fn(() => true);
    setPad([0, 0, 1, 0]);
    input.update(0.1, false, overEnemy);
    expect(input.consumeLookDelta().dx * MOUSE_SENSITIVITY).toBeCloseTo(22 * Math.PI / 180 * 0.55);
    input.update(0.1, false, overEnemy);
    expect(overEnemy).toHaveBeenCalledTimes(1);
    input.update(0.1, false, overEnemy);
    expect(overEnemy).toHaveBeenCalledTimes(2);
    vi.spyOn(Settings, 'getControllerAimAssist').mockReturnValue(false);
    input.consumeLookDelta(); input.update(0.1, false, overEnemy);
    expect(input.consumeLookDelta().dx * MOUSE_SENSITIVITY).toBeCloseTo(22 * Math.PI / 180);
    doc.pointerLockElement = canvas; event('pointerlockchange');
    event('keydown', { code: 'KeyR' }); input.update(0.1, false, overEnemy);
    expect(overEnemy).toHaveBeenCalledTimes(2);
  });

  it('clears input on disconnect and pauses when hidden', () => {
    gamepadInput.setActiveDevice('gamepad'); input.resume();
    setPad([0, -1, 0, 0], [7]); input.update();
    controller = { ...controller, connected: false }; input.update();
    expect(input.isEngaged).toBe(false);
    expect(input.isActionActive('fire')).toBe(false);
    gamepadInput.setActiveDevice('gamepad'); input.resume();
    doc.hidden = true; event('visibilitychange');
    expect(input.isEngaged).toBe(false);
  });
});
