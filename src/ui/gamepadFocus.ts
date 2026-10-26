import { gamepadInput, type GamepadFrame } from '../input/GamepadInput.ts';

export type FocusDirection = 'left' | 'right' | 'up' | 'down';
export interface FocusRect { x: number; y: number; width: number; height: number }

export function nearestFocus(rects: readonly FocusRect[], current: number, direction: FocusDirection): number {
  const origin = rects[current];
  if (!origin) return rects.length ? 0 : -1;
  let nearest = current;
  let distance = Infinity;
  rects.forEach((rect, index) => {
    if (index === current) return;
    const dx = rect.x + rect.width / 2 - origin.x - origin.width / 2;
    const dy = rect.y + rect.height / 2 - origin.y - origin.height / 2;
    const forward = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    const squared = dx * dx + dy * dy;
    if (forward > 1 && squared < distance) { nearest = index; distance = squared; }
  });
  return nearest;
}

function visible(element: HTMLElement): boolean {
  if (!element.getClientRects().length) return false;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || parent.inert) return false;
  }
  return true;
}

function menuRoot(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.zIndex !== 'auto' && (style.position === 'absolute' || style.position === 'fixed')) return parent;
  }
  return document.body;
}

export function menuControls(): HTMLElement[] {
  const all = [...document.querySelectorAll<HTMLElement>('button, select, input, [role="button"][tabindex]')].filter(visible);
  const roots = [...new Set(all.map(menuRoot))];
  roots.sort((a, b) => Number(getComputedStyle(a).zIndex || 0) - Number(getComputedStyle(b).zIndex || 0)
    || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const top = roots.at(-1);
  return all.filter((element) => menuRoot(element) === top && !element.matches(':disabled, [aria-disabled="true"]'));
}

export function changeControl(element: HTMLElement, amount: number): boolean {
  if (element instanceof HTMLSelectElement) {
    let index = element.selectedIndex + amount;
    while (index >= 0 && index < element.options.length && element.options[index]!.disabled) index += amount;
    if (index >= 0 && index < element.options.length) element.selectedIndex = index;
  } else if (element instanceof HTMLInputElement && (element.type === 'range' || element.type === 'number')) {
    if (amount > 0) element.stepUp();
    else element.stepDown();
  } else return false;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

// Text fields need an entry path on desktops without an OS touch keyboard.
function openKeyboard(input: HTMLInputElement): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; z-index:1000; background:#101820; color:white; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px;';
  const value = document.createElement('div');
  value.textContent = input.value || input.placeholder;
  const keys = document.createElement('div');
  keys.style.cssText = 'display:grid; grid-template-columns:repeat(10, 1fr); gap:8px; max-width:90vw;';
  const write = (text: string): void => {
    input.value = input.maxLength < 0 ? text : text.slice(0, input.maxLength);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    value.textContent = input.value || input.placeholder;
  };
  for (const key of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'Space', 'Delete', 'Done']) {
    const button = document.createElement('button');
    button.textContent = key;
    button.style.cssText = 'padding:14px; background:#263842; color:white; border:1px solid #89bcb0;';
    button.addEventListener('click', () => {
      if (key === 'Done') {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        overlay.remove();
        input.focus();
      } else write(key === 'Delete' ? input.value.slice(0, -1) : input.value + (key === 'Space' ? ' ' : key));
    });
    keys.appendChild(button);
  }
  overlay.append(value, keys);
  document.body.appendChild(overlay);
}

/**
 * The control B presses. Only a plain back-out qualifies: B is also interact in play, so a B that
 * lands on the death or match-end screen must never leave a match ("Return to Lobby" is not one).
 */
export function backControl<T extends { textContent: string | null }>(controls: readonly T[]): T | undefined {
  return controls.find((element) => /^(back|cancel|close|done|resume)$/i.test(element.textContent?.trim() ?? ''));
}

export function gamepadBack(): void {
  const controls = menuControls();
  const root = controls[0] && menuRoot(controls[0]);
  if (root && !root.dispatchEvent(new Event('gamepadback', { cancelable: true }))) return;
  const back = backControl(controls);
  if (back) activate(back);
}

function activate(element: HTMLElement): void {
  // A menu action can dispose Game. Let its current update/render finish before clicking.
  queueMicrotask(() => { if (element.isConnected) element.click(); });
}

/** How long a newly shown menu ignores A and B (see GamepadFocus.sinceFocus). */
export const MENU_PRESS_GRACE = 0.3;

export class GamepadFocus {
  private direction: FocusDirection | null = null;
  private repeatIn = 0;
  // Buttons held when a menu took focus. A (jump) or B (interact) still down from play must be
  // released before it can press anything, or it would fire the screen's first button.
  private readonly heldAtFocus = new Set<number>();
  // Seconds since a menu took focus. A and B do nothing for MENU_PRESS_GRACE after it appears: a
  // reflexive jump or interact a frame later would otherwise press its first button (Respawn on the
  // Uplink results, Return to Lobby at a guest's match end).
  private sinceFocus = Number.POSITIVE_INFINITY;

  constructor(private readonly findControls: () => HTMLElement[] = menuControls) {}

  update(frame: GamepadFrame, dt: number): void {
    if (gamepadInput.activeDevice !== 'gamepad') return;
    const controls = this.findControls();
    if (!controls.length) return;
    let focused = controls.indexOf(document.activeElement as HTMLElement);
    if (focused < 0) {
      focused = 0;
      controls[0]!.focus();
      this.sinceFocus = 0;
      this.heldAtFocus.clear();
      for (const button of frame.buttons) this.heldAtFocus.add(button);
    }
    for (const button of this.heldAtFocus) if (!frame.buttons.has(button)) this.heldAtFocus.delete(button);
    const direction = frame.buttons.has(14) ? 'left' : frame.buttons.has(15) ? 'right'
      : frame.buttons.has(12) ? 'up' : frame.buttons.has(13) ? 'down'
      : Math.abs(frame.move.x) > Math.abs(frame.move.y) && Math.abs(frame.move.x) > 0.45
        ? frame.move.x > 0 ? 'right' : 'left'
        : Math.abs(frame.move.y) > 0.45 ? frame.move.y > 0 ? 'down' : 'up' : null;
    this.repeatIn -= dt;
    if (direction && (direction !== this.direction || this.repeatIn <= 0)) {
      const current = controls[focused]!;
      if (!((direction === 'left' || direction === 'right') && changeControl(current, direction === 'left' ? -1 : 1))) {
        const next = nearestFocus(controls.map((element) => element.getBoundingClientRect()), focused, direction);
        controls[next]?.focus();
        controls[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      this.repeatIn = direction !== this.direction ? 0.35 : 0.12;
    }
    this.direction = direction;
    this.sinceFocus += dt;
    if (this.sinceFocus < MENU_PRESS_GRACE) return;
    if (frame.pressed.has(1) && !this.heldAtFocus.has(1)) { gamepadBack(); return; }
    if (frame.pressed.has(0) && !this.heldAtFocus.has(0)) {
      const element = document.activeElement as HTMLElement;
      if (element instanceof HTMLInputElement && ['text', 'search', 'email'].includes(element.type)) openKeyboard(element);
      else if (element instanceof HTMLSelectElement) changeControl(element, 1);
      else activate(element);
    }
  }
}

export const gamepadFocus = new GamepadFocus();

/** Menus exist before and between matches. The match owns polling while its input is alive. */
export function startGamepadMenus(): void {
  const style = document.createElement('style');
  style.textContent = '[data-input-device="gamepad"] :focus { outline:3px solid #a7ffe0 !important; outline-offset:3px !important; }';
  document.head.appendChild(style);
  document.addEventListener('keydown', (event) => { if (event.isTrusted) gamepadInput.setActiveDevice('mouse'); });
  document.addEventListener('mousemove', (event) => {
    if (event.movementX || event.movementY) gamepadInput.setActiveDevice('mouse');
  });
  document.addEventListener('mousedown', (event) => { if (event.isTrusted) gamepadInput.setActiveDevice('mouse'); });
  let last = performance.now();
  const tick = (now: number): void => {
    gamepadInput.beginFrame();
    if (!gamepadInput.managed && !document.hidden) gamepadFocus.update(gamepadInput.poll(), Math.min((now - last) / 1000, 0.1));
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
