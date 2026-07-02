import { KEY_BINDINGS, type Action } from './actions.ts';

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

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly blocker: HTMLElement,
  ) {
    this.blocker.addEventListener('click', () => this.canvas.requestPointerLock());
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get isLocked(): boolean {
    return this.locked;
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
    this.blocker.style.display = this.locked ? 'none' : 'flex';
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
    const action = KEY_BINDINGS[event.code];
    if (!action) return;
    if (!this.activeActions.has(action)) this.justPressedActions.add(action);
    this.activeActions.add(action);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const action = KEY_BINDINGS[event.code];
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

  dispose(): void {
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
  }
}
