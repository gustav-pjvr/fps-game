import { ACCENT, HAIRLINE, INK, INK_DIM, MONO_FONT, SANS_FONT, TEXT_SHADOW } from './theme.ts';

const SLOT_STYLE = `display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:2px solid transparent; font-family:${SANS_FONT}; font-size:11px; text-transform:uppercase; color:${INK_DIM};`;

export class Hotbar {
  private readonly container: HTMLDivElement;
  private slotElements: HTMLDivElement[] = [];

  constructor(root: HTMLElement) {
    this.container = document.createElement('div');
    this.container.style.cssText = `position:absolute; bottom:32px; left:50%; transform:translateX(-50%); display:flex; gap:8px; max-width:calc(100% - 600px); pointer-events:none; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums;`;
    root.appendChild(this.container);
  }

  setSlots(names: string[]): void {
    this.container.replaceChildren();
    this.slotElements = names.map((name, index) => {
      const el = document.createElement('div');
      el.style.cssText = SLOT_STYLE;
      const key = document.createElement('span');
      key.style.cssText = `font-family:${MONO_FONT}; font-size:10px; border:1px solid ${HAIRLINE}; padding:3px 5px;`;
      key.textContent = String(index + 1);
      const label = document.createElement('span');
      label.textContent = name;
      el.append(key, label);
      this.container.appendChild(el);
      return el;
    });
  }

  setActive(index: number): void {
    this.slotElements.forEach((el, i) => {
      el.style.color = i === index ? INK : INK_DIM;
      el.style.borderBottomColor = i === index ? ACCENT : 'transparent';
    });
  }

  dispose(): void {
    this.container.remove();
  }
}
