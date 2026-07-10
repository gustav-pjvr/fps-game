import { ACCENT, DISPLAY_FONT, chamferClipPath } from './menu/menuStyles.ts';

const SLOT_CLIP = `clip-path:${chamferClipPath('top-right', 6)};`;
const SLOT_STYLE =
  `padding:6px 14px; background:rgba(0,0,0,0.45); border:2px solid rgba(255,255,255,0.25); ${SLOT_CLIP}` +
  ` font-family:${DISPLAY_FONT}; font-size:0.8rem; color:#eee; text-shadow:0 1px 2px #000;` +
  ' transition:background 0.1s, border-color 0.1s;';
const SLOT_ACTIVE_STYLE =
  `padding:6px 14px; background:rgba(62,207,95,0.22); border:2px solid ${ACCENT}; ${SLOT_CLIP}` +
  ` font-family:${DISPLAY_FONT}; font-size:0.8rem; color:#fff; font-weight:600; text-shadow:0 1px 2px #000;` +
  ' transition:background 0.1s, border-color 0.1s;';

export class Hotbar {
  private readonly container: HTMLDivElement;
  private slotElements: HTMLDivElement[] = [];

  constructor(root: HTMLElement) {
    this.container = document.createElement('div');
    this.container.style.cssText =
      'position:absolute; bottom:0; left:50%; transform:translateX(-50%); display:flex; gap:8px;';
    root.appendChild(this.container);
  }

  setSlots(names: string[]): void {
    this.container.replaceChildren();
    this.slotElements = names.map((name, index) => {
      const el = document.createElement('div');
      el.style.cssText = SLOT_STYLE;
      el.textContent = `${index + 1}  ${name}`;
      this.container.appendChild(el);
      return el;
    });
  }

  setActive(index: number): void {
    this.slotElements.forEach((el, i) => {
      el.style.cssText = i === index ? SLOT_ACTIVE_STYLE : SLOT_STYLE;
    });
  }

  dispose(): void {
    this.container.remove();
  }
}
