import { AMBER, LABEL_CSS, SANS_FONT, TEXT_SHADOW } from './theme.ts';

const ENTRY_DURATION = 3;
const FADE_DURATION = 0.18;

export class BigAnnouncement {
  private readonly element: HTMLDivElement;
  private readonly headline: HTMLDivElement;
  private timeRemaining = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText = `position:absolute; top:max(250px, 33%); left:50%; transform:translate(-50%, -50%); text-align:center; width:70%; z-index:30; font-family:${SANS_FONT}; color:${AMBER}; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums; opacity:0; pointer-events:none;`;
    const label = document.createElement('div');
    label.style.cssText = `${LABEL_CSS} margin-bottom:8px;`;
    label.textContent = 'FIELD UPDATE';
    this.headline = document.createElement('div');
    this.headline.style.cssText = 'font-size:clamp(24px, 2.4vw, 40px); font-weight:300;';
    this.element.append(label, this.headline);
    root.appendChild(this.element);
  }

  show(label: string): void {
    this.headline.textContent = label;
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
