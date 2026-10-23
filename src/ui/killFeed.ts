import { INK, INK_DIM, SANS_FONT, TEXT_SHADOW } from './theme.ts';

const ENTRY_DURATION = 4;
const FADE_DURATION = 0.18;

/** Recent eliminations, aligned to the right below the multiplayer radar. */
export class KillFeed {
  private readonly element: HTMLDivElement;
  private readonly entries: { element: HTMLDivElement; remaining: number }[] = [];
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText = `position:absolute; top:220px; right:32px; text-align:right; font-family:${SANS_FONT}; font-size:12px; color:${INK}; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums; pointer-events:none;`;
    root.appendChild(this.element);
  }

  show(label: string): void {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:8px;';
    const elimination = /^(.*) eliminated by (.*)$/.exec(label);
    const arrow = document.createElement('span');
    arrow.style.cssText = `color:${INK_DIM}; padding:0 8px;`;
    arrow.textContent = '\u2192';
    if (elimination) row.append(elimination[2]!, arrow, elimination[1]!);
    else if (/has been eliminated from the horde!$/.test(label) || / eliminated$/.test(label)) row.append(label);
    else row.append('You', arrow, label.replace(/ destroyed$/, ''));
    this.element.appendChild(row);
    this.entries.push({ element: row, remaining: ENTRY_DURATION });
    if (this.entries.length > 5) this.entries.shift()!.element.remove();
  }

  update(dt: number): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      entry.remaining -= dt;
      if (entry.remaining <= 0) {
        entry.element.remove();
        this.entries.splice(i, 1);
      } else {
        entry.element.style.opacity = this.reducedMotion.matches ? '1' : String(Math.min(1, entry.remaining / FADE_DURATION));
      }
    }
  }

  dispose(): void {
    this.entries.length = 0;
    this.element.remove();
  }
}
