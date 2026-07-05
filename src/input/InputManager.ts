import type { Action } from './actions.ts';
import { Settings } from '../settings/Settings.ts';

const MOUSE_BUTTON_ACTIONS: Record<number, Action> = {
  0: 'fire',
  2: 'aim',
};

export class InputManager {
  private readonly activeActions = new Set<Action>();
  private readonly justPressedActions = new Set<Action>();
  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private locked = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('contextmenu', this.onContextMenu);
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** Re-requests pointer lock - safe to call from a click handler (a valid user gesture) even if
   * already locked, e.g. respawning without forcing a second "click to play" step. */
  requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  /** Releases pointer lock so the OS cursor reappears - used on player death so death-screen
   * buttons are actually clickable instead of aiming blind with a hidden cursor. */
  releasePointerLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  isActionActive(action: Action): boolean {
    return this.activeActions.has(action);
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
    if (!this.locked) {
      this.activeActions.clear();
      this.justPressedActions.clear();
    }
  };

  private readonly onPointerLockError = (): void => {
    this.locked = false;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
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
    if (!this.locked) return;
    this.lookDeltaX += event.movementX;
    this.lookDeltaY += event.movementY;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
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
    if (!this.locked) return;
    this.justPressedActions.add(event.deltaY > 0 ? 'weaponNext' : 'weaponPrev');
  };

  /** Named (not an inline arrow) so dispose() can actually remove it - the old anonymous
   * registration stacked one document-level listener per lobby->match cycle. */
  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  dispose(): void {
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('contextmenu', this.onContextMenu);
  }
}
