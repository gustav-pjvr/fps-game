import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamepadInput, GAMEPAD_ACTIONS, lookResponse, mergeMoveVectors, radialDeadZone } from './GamepadInput.ts';
import { Settings } from '../settings/Settings.ts';

function pad(axes = [0, 0, 0, 0], down: number[] = []): Gamepad {
  return { index: 0, connected: true, mapping: 'standard', axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0, touched: false })),
  } as unknown as Gamepad;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('controller analog input', () => {
  it('removes radial drift and rescales the remaining travel', () => {
    expect(radialDeadZone(0.1, 0.1, 0.15)).toEqual({ x: 0, y: 0 });
    expect(radialDeadZone(0.575, 0, 0.15).x).toBeCloseTo(0.5);
    expect(radialDeadZone(0, -1, 0.15)).toEqual({ x: 0, y: -1 });
    const diagonal = radialDeadZone(1, 1, 0.15);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
    expect(radialDeadZone(NaN, 0, 0.15)).toEqual({ x: 0, y: 0 });
  });

  it('squares the look response with its sign preserved', () => {
    expect(lookResponse(-0.5)).toBe(-0.25);
    expect(lookResponse(0.5)).toBe(0.25);
    expect(lookResponse(0)).toBe(0);
  });

  it('merges keys and stick, preserving partial travel and clamping diagonals', () => {
    expect(mergeMoveVectors({ x: 0, y: 0 }, { x: 0.5, y: 0 })).toEqual({ x: 0.5, y: 0 });
    expect(mergeMoveVectors({ x: 1, y: 0 }, { x: -1, y: 0 })).toEqual({ x: 0, y: 0 });
    const diagonal = mergeMoveVectors({ x: 1, y: -1 }, { x: 1, y: -1 });
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
  });
});

describe('standard mapping and lifecycle', () => {
  it('polls once per display frame even when the simulation catches up multiple steps', () => {
    const input = new GamepadInput();
    const getGamepads = vi.fn(() => [pad([], [7])]);
    vi.stubGlobal('navigator', { getGamepads });
    input.beginFrame();
    expect(input.poll().justPressed.has('fire')).toBe(true);
    expect(input.poll().justPressed.has('fire')).toBe(false);
    expect(input.poll().actions.has('fire')).toBe(true);
    expect(getGamepads).toHaveBeenCalledOnce();
    input.beginFrame(); input.poll();
    expect(getGamepads).toHaveBeenCalledTimes(2);
  });
  it('maps buttons with one edge per press, RB to the grenade throw and LB to nothing', () => {
    const input = new GamepadInput();
    const controller = pad([], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 14, 15]);
    expect(input.poll([controller]).justPressed).toEqual(new Set(Object.values(GAMEPAD_ACTIONS)));
    expect(input.poll([controller]).justPressed.size).toBe(0);
    expect(input.poll([pad([], [4])]).actions.size).toBe(0);
    expect(input.poll([pad([], [5])]).actions).toEqual(new Set(['grenade']));
    input.poll([pad()]);
    expect(input.poll([pad([], [7])]).justPressed.has('fire')).toBe(true);
  });

  it('latches sprint until forward movement stops', () => {
    const input = new GamepadInput();
    expect(input.poll([pad([0, -1], [10])]).actions.has('sprint')).toBe(true);
    expect(input.poll([pad([0, -0.5])]).actions.has('sprint')).toBe(true);
    expect(input.poll([pad([0, 0])]).actions.has('sprint')).toBe(false);
    expect(input.poll([pad([0, -1])]).actions.has('sprint')).toBe(false);
  });

  it('switches only on intentional input, clears disconnects and ignores nonstandard pads', () => {
    const input = new GamepadInput();
    input.poll([pad([0.1, 0, 0, 0])]);
    expect(input.activeDevice).toBe('mouse');
    input.poll([pad([1, 0, 0, 0])]);
    expect(input.activeDevice).toBe('gamepad');
    input.setActiveDevice('mouse');
    input.poll([pad([1, 0, 0, 0])]);
    expect(input.activeDevice).toBe('mouse');
    input.poll([pad([1, 0, 0, 0], [7])]);
    expect(input.activeDevice).toBe('gamepad');
    expect(input.poll([]).actions.size).toBe(0);
    expect(input.activeDevice).toBe('mouse');
    expect(input.poll([{ ...pad([], [7]), mapping: '' }]).actions.size).toBe(0);
  });

  it('uses weaker automatic pulses and respects the vibration setting and device', () => {
    const input = new GamepadInput();
    const playEffect = vi.fn().mockResolvedValue('complete');
    input.poll([{ ...pad([], [7]), vibrationActuator: { playEffect } } as unknown as Gamepad]);
    vi.spyOn(Settings, 'getControllerVibration').mockReturnValue(true);
    input.vibrate('automatic');
    input.vibrate('damage');
    expect(playEffect.mock.calls[0]![1].strongMagnitude).toBeLessThan(playEffect.mock.calls[1]![1].strongMagnitude);
    vi.spyOn(Settings, 'getControllerVibration').mockReturnValue(false);
    input.vibrate('explosion');
    input.setActiveDevice('mouse');
    input.vibrate('fire');
    expect(playEffect).toHaveBeenCalledTimes(2);
  });
});
