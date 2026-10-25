import type { Action } from './actions.ts';
import { Settings } from '../settings/Settings.ts';

export type ActiveDevice = 'mouse' | 'gamepad';
export interface StickVector { x: number; y: number }

// Standard mapping. Bumpers stay unbound until grenade actions exist.
export const GAMEPAD_ACTIONS: Readonly<Partial<Record<number, Action>>> = {
  0: 'jump', 1: 'interact', 2: 'reload', 3: 'weaponNext',
  6: 'aim', 7: 'fire', 8: 'resetPlay', 9: 'pause',
  12: 'flashlight', 14: 'weaponPrev', 15: 'weaponNext',
};

export const GAMEPAD_MAPPING = [
  'Left stick: move; L3: sprint while moving forward',
  'Right stick: look; RT (R2): fire; LT (L2): aim',
  'A (Cross): jump / activate; B (Circle): interact / back',
  'X (Square): reload; Y (Triangle): next weapon',
  'D-pad left / right: previous / next weapon; up: torch',
  'Start (Options): pause; View (Share): reset match',
  'RB (R1) / LB (L1): unbound',
  'Menus: D-pad / left stick: focus; left / right: change value',
];

export function radialDeadZone(x: number, y: number, deadZone: number): StickVector {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= deadZone) return { x: 0, y: 0 };
  const scale = (Math.min(length, 1) - deadZone) / (1 - deadZone) / length;
  return { x: x * scale, y: y * scale };
}

export function lookResponse(value: number): number {
  return value * Math.abs(value);
}

export function mergeMoveVectors(keys: StickVector, stick: StickVector): StickVector {
  const x = keys.x + stick.x;
  const y = keys.y + stick.y;
  const length = Math.max(1, Math.hypot(x, y));
  return { x: x / length, y: y / length };
}

export interface GamepadFrame {
  move: StickVector;
  look: StickVector;
  buttons: Set<number>;
  pressed: Set<number>;
  actions: Set<Action>;
  justPressed: Set<Action>;
}

function connectedGamepads(): readonly (Gamepad | null)[] {
  try { return typeof navigator === 'undefined' ? [] : navigator.getGamepads?.() ?? []; }
  catch { return []; }
}

export class GamepadInput {
  activeDevice: ActiveDevice = 'mouse';
  managed = false;
  private pad: Gamepad | null = null;
  private previousButtons = new Set<number>();
  private previousAxes: number[] = [];
  private sprinting = false;
  private frameManaged = false;
  private cachedFrame: GamepadFrame | null = null;
  private sampleNumber = 0;

  get sampleId(): number { return this.sampleNumber; }

  beginFrame(): void {
    this.frameManaged = true;
    this.cachedFrame = null;
  }

  setActiveDevice(device: ActiveDevice): void {
    if (this.activeDevice === device) return;
    this.activeDevice = device;
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.inputDevice = device;
      for (const el of document.querySelectorAll<HTMLElement>('[data-mouse-hint]')) {
        el.textContent = (device === 'gamepad' ? el.dataset.gamepadHint : el.dataset.mouseHint) ?? '';
      }
    }
  }

  poll(pads?: readonly (Gamepad | null)[]): GamepadFrame {
    // The fixed-step loop can update several times per display frame. Sample once and deliver
    // button edges only to its first update, while held actions remain available to every step.
    if (!pads && this.cachedFrame) return { ...this.cachedFrame, pressed: new Set(), justPressed: new Set() };
    this.sampleNumber++;
    const available = (pads ?? connectedGamepads()).filter((pad): pad is Gamepad => !!pad && pad.connected && pad.mapping === 'standard');
    const pad = available.find((candidate) => candidate.index === this.pad?.index) ?? available[0] ?? null;
    if (pad?.index !== this.pad?.index) {
      this.previousButtons.clear();
      this.previousAxes = [];
      this.sprinting = false;
    }
    this.pad = pad;
    const buttons = new Set<number>();
    pad?.buttons.forEach((button, index) => {
      if (button.pressed || button.value > 0.5) buttons.add(index);
    });
    const pressed = new Set([...buttons].filter((index) => !this.previousButtons.has(index)));
    const move = radialDeadZone(pad?.axes[0] ?? 0, pad?.axes[1] ?? 0, 0.15);
    const look = radialDeadZone(pad?.axes[2] ?? 0, pad?.axes[3] ?? 0, 0.12);
    const axes = [move.x, move.y, look.x, look.y];
    if (pressed.size || axes.some((v, i) => Math.abs(v) > 0.02 && Math.abs(v - (this.previousAxes[i] ?? 0)) > 0.02)) {
      this.setActiveDevice('gamepad');
    }
    if (!pad && this.activeDevice === 'gamepad') this.setActiveDevice('mouse');
    if (move.y >= 0) this.sprinting = false;
    else if (pressed.has(10)) this.sprinting = true;
    const actions = new Set<Action>();
    const justPressed = new Set<Action>();
    for (const index of buttons) {
      const action = GAMEPAD_ACTIONS[index];
      if (action) {
        actions.add(action);
        if (pressed.has(index)) justPressed.add(action);
      }
    }
    if (this.sprinting) actions.add('sprint');
    if (move.x < 0) actions.add('moveLeft');
    if (move.x > 0) actions.add('moveRight');
    if (move.y < 0) actions.add('moveForward');
    if (move.y > 0) actions.add('moveBackward');
    this.previousButtons = buttons;
    this.previousAxes = axes;
    const frame = { move, look, buttons, pressed, actions, justPressed };
    if (!pads && this.frameManaged) this.cachedFrame = frame;
    return frame;
  }

  vibrate(kind: 'fire' | 'automatic' | 'damage' | 'explosion'): void {
    if (this.activeDevice !== 'gamepad' || !Settings.getControllerVibration()) return;
    const actuator = this.pad?.vibrationActuator;
    if (!actuator) return;
    const strength = kind === 'automatic' ? 0.2 : kind === 'fire' ? 0.4 : 0.85;
    try {
      void actuator.playEffect('dual-rumble', {
        duration: kind === 'fire' || kind === 'automatic' ? 55 : 160,
        startDelay: 0, weakMagnitude: strength, strongMagnitude: strength,
      }).catch(() => {});
    } catch { /* Some browsers expose an actuator without effect support. */ }
  }
}

export const gamepadInput = new GamepadInput();

export function setDeviceHint(element: HTMLElement, mouse: string, gamepad: string): void {
  element.dataset.mouseHint = mouse;
  element.dataset.gamepadHint = gamepad;
  element.textContent = gamepadInput.activeDevice === 'gamepad' ? gamepad : mouse;
}
