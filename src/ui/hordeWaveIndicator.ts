import { INK, LABEL_CSS, MONO_FONT, TEXT_SHADOW } from './theme.ts';

/** Always-visible wave count, below the compass and multiplayer scoreboard. */
export class HordeWaveIndicator {
  private readonly element: HTMLDivElement;
  private readonly count: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText = `position:absolute; top:170px; left:50%; transform:translateX(-50%); text-align:center; color:${INK}; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums; pointer-events:none;`;
    const label = document.createElement('div');
    label.style.cssText = `${LABEL_CSS} margin-bottom:6px;`;
    label.textContent = 'GOOSE HORDE';
    this.count = document.createElement('div');
    this.count.style.cssText = `font-family:${MONO_FONT}; font-size:12px; font-weight:300;`;
    this.element.append(label, this.count);
    root.appendChild(this.element);
  }

  set(current: number, total: number): void {
    this.count.textContent = `Wave ${current} / ${total}`;
  }

  dispose(): void {
    this.element.remove();
  }
}
