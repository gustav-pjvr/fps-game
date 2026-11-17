import type { Action } from './actions.ts';
import { Settings } from '../settings/Settings.ts';
import { MOUSE_SENSITIVITY } from '../core/config.ts';
import { gamepadInput, lookResponse, mergeMoveVectors, type ActiveDevice, type StickVector } from './GamepadInput.ts';
import { gamepadBack, gamepadFocus, menuControls } from '../ui/gamepadFocus.ts';

const MOUSE_BUTTON_ACTIONS: Record<number, Action> = {
  0: 'fire',
  1: 'ping',
  2: 'aim',
};

export class InputManager {
  private readonly activeActions = new Set<Action>();
  private readonly justPressedActions = new Set<Action>();
  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private locked = false;
  private paused = true;
  private readonly padActions = new Set<Action>();
  private readonly blockedPadActions = new Set<Action>();
  private padMove: StickVector = { x: 0, y: 0 };
  private assistFrame = 0;
  private lastAssistSample = -1;
  private aimSlowdown = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    gamepadInput.managed = true;
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    if (typeof window !== 'undefined') window.addEventListener('blur', this.onWindowBlur);
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get activeDevice(): ActiveDevice { return gamepadInput.activeDevice; }

  get isEngaged(): boolean {
    return !this.paused && (this.locked || this.activeDevice === 'gamepad');
  }

  resume(): void {
    this.paused = false;
    if (this.activeDevice !== 'gamepad') this.requestPointerLock();
  }

  private pause(): void {
    this.paused = true;
    this.clearActions();
    this.releasePointerLock();
  }

  private clearActions(): void {
    this.activeActions.clear();
    this.justPressedActions.clear();
    this.padActions.clear();
    this.padMove = { x: 0, y: 0 };
    this.lookDeltaX = this.lookDeltaY = 0;
  }

  update(dt: number = 1 / 60, menuOnly = false, overEnemy: () => boolean = () => false): void {
    if (document.hidden) return;
    const frame = gamepadInput.poll();
    this.padActions.clear();
    this.padMove = { x: 0, y: 0 };
    if (frame.pressed.has(9) && !menuOnly) {
      if (this.isEngaged) this.pause();
      else {
        const controls = menuControls();
        if (controls.some((el) => el.closest('[data-testid="pause-menu"]'))) this.resume();
        else gamepadBack();
      }
      for (const action of frame.actions) this.blockedPadActions.add(action);
      return;
    }
    for (const action of this.blockedPadActions) {
      if (!frame.actions.has(action)) this.blockedPadActions.delete(action);
    }
    if (menuOnly || !this.isEngaged) {
      if (!this.isEngaged) this.paused = true;
      this.justPressedActions.clear();
      for (const action of frame.actions) this.blockedPadActions.add(action);
      gamepadFocus.update(frame, dt);
      if (menuOnly && frame.justPressed.has('resetPlay')) this.justPressedActions.add('resetPlay');
      return;
    }
    if (this.activeDevice !== 'gamepad') { this.aimSlowdown = false; return; }
    for (const action of frame.actions) {
      if (!this.blockedPadActions.has(action)) this.padActions.add(action);
    }
    for (const action of frame.justPressed) {
      if (!this.blockedPadActions.has(action)) this.justPressedActions.add(action);
    }
    this.padMove = frame.move;
    if (!Settings.getControllerAimAssist()) this.aimSlowdown = false;
    else if (this.lastAssistSample !== gamepadInput.sampleId) {
      this.lastAssistSample = gamepadInput.sampleId;
      if (this.assistFrame++ % 2 === 0) this.aimSlowdown = overEnemy();
    }
    // Convert rates to mouse units so Player's existing zoom scaling stays shared.
    const rate = Math.PI / 180 * dt * Settings.getControllerSensitivity()
      * (this.aimSlowdown ? 0.55 : 1) / (MOUSE_SENSITIVITY * Settings.getMouseSensitivity());
    this.lookDeltaX += lookResponse(frame.look.x) * 220 * rate;
    this.lookDeltaY += lookResponse(frame.look.y) * 150 * rate * (Settings.getControllerInvertY() ? -1 : 1);
  }

  getMoveVector(): StickVector {
    if (!this.isEngaged) return { x: 0, y: 0 };
    return mergeMoveVectors({
      x: Number(this.activeActions.has('moveRight')) - Number(this.activeActions.has('moveLeft')),
      y: Number(this.activeActions.has('moveBackward')) - Number(this.activeActions.has('moveForward')),
    }, this.padMove);
  }

  vibrate(kind: 'fire' | 'automatic' | 'damage' | 'explosion'): void { gamepadInput.vibrate(kind); }

  /** Re-requests pointer lock - safe to call from a click handler (a valid user gesture) even if
   * already locked, e.g. respawning without forcing a second "click to play" step. */
  requestPointerLock(): void {
    // Chrome refuses by rejecting this promise (a re-lock within ~1s of the player pressing Escape,
    // or a request without a user gesture). Left unhandled, every refusal surfaced as an
    // "Uncaught (in promise)" error. The refusal itself needs nothing here: onPointerLockError
    // already keeps `locked` false, so the pause menu stays up as the fallback, same as before.
    // Older browsers return undefined instead of a promise, hence the widened type and the `?.`.
    const pending: Promise<void> | undefined = this.canvas.requestPointerLock();
    pending?.catch(() => {});
  }

  /** Releases pointer lock so the OS cursor reappears - used on player death so death-screen
   * buttons are actually clickable instead of aiming blind with a hidden cursor. */
  releasePointerLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  isActionActive(action: Action): boolean {
    return this.isEngaged && (this.activeActions.has(action) || this.padActions.has(action));
  }

  /** True at most once per key/button press — for semi-auto fire, reload, jump-once, etc. */
  consumeJustPressed(action: Action): boolean {
    const wasPressed = this.justPressedActions.has(action);
    this.justPressedActions.delete(action);
    return wasPressed;
  }

  consumeLookDelta(): { dx: number; dy: number } {
    const delta = { dx: this.lookDeltaX, dy: this.lookDeltaY };
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return delta;
  }

  private readonly onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    if (this.locked) this.paused = false;
    else if (this.activeDevice !== 'gamepad') this.paused = true;
    this.clearActions();
  };

  private readonly onPointerLockError = (): void => {
    this.locked = false;
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.pause();
  };

  /** A pad keeps playing without pointer lock, so the lock loss that pauses the mouse never comes
   * when the window loses focus (alt-tab, a notification): pause here. */
  private readonly onWindowBlur = (): void => {
    if (this.activeDevice === 'gamepad' && !this.paused) this.pause();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.useMouse();
    if (!this.locked) return;
    const action = Settings.getKeyBindings()[event.code];
    if (!action) return;
    if (!this.activeActions.has(action)) this.justPressedActions.add(action);
    this.activeActions.add(action);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const action = Settings.getKeyBindings()[event.code];
    if (action) this.activeActions.delete(action);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (event.movementX || event.movementY) this.useMouse();
    if (!this.locked) return;
    this.lookDeltaX += event.movementX;
    this.lookDeltaY += event.movementY;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    this.useMouse();
    if (!this.locked) return;
    const action = MOUSE_BUTTON_ACTIONS[event.button];
    if (!action) return;
    if (!this.activeActions.has(action)) this.justPressedActions.add(action);
    this.activeActions.add(action);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    const action = MOUSE_BUTTON_ACTIONS[event.button];
    if (action) this.activeActions.delete(action);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    this.useMouse();
    if (!this.locked) return;
    this.justPressedActions.add(event.deltaY > 0 ? 'weaponNext' : 'weaponPrev');
  };

  /** Named (not an inline arrow) so dispose() can actually remove it - the old anonymous
   * registration stacked one document-level listener per lobby->match cycle. */
  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  dispose(): void {
    gamepadInput.managed = false;
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (typeof window !== 'undefined') window.removeEventListener('blur', this.onWindowBlur);
  }

  private useMouse(): void {
    if (this.padActions.size) this.justPressedActions.clear();
    gamepadInput.setActiveDevice('mouse');
    this.padActions.clear();
    this.padMove = { x: 0, y: 0 };
    if (!this.locked) this.pause();
  }
}
