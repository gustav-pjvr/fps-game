import { ACCENT, LABEL_CSS, SANS_FONT, TEXT_SHADOW } from './theme.ts';

const ENTRY_DURATION = 1.5;
const FADE_DURATION = 0.18;

export class LongShotCallout {
  private readonly element: HTMLDivElement;
  private readonly headline: HTMLDivElement;
  private timeRemaining = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'long-shot-callout';
    this.element.style.cssText = `position:absolute; top:50%; left:calc(50% + 160px); transform:translateY(-50%); text-align:left; font-family:${SANS_FONT}; color:${ACCENT}; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums; opacity:0; pointer-events:none;`;
    const label = document.createElement('div');
    label.style.cssText = `${LABEL_CSS} margin-bottom:8px;`;
    label.textContent = 'PRECISION';
    this.headline = document.createElement('div');
    this.headline.style.cssText = 'font-size:20px; font-weight:300;';
    this.element.append(label, this.headline);
    root.appendChild(this.element);
  }

  show(distance: number): void {
    this.headline.textContent = `Long Shot: ${Math.round(distance)}m`;
    this.timeRemaining = ENTRY_DURATION;
    this.element.style.opacity = '1';
  }

  update(dt: number): void {
    this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    this.element.style.opacity = String(this.timeRemaining > 0 ? this.reducedMotion.matches ? 1 : Math.min(1, this.timeRemaining / FADE_DURATION) : 0);
  }

  dispose(): void {
    this.element.remove();
  }
}
