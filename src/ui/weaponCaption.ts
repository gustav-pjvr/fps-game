import { INK, INK_DIM, LABEL_CSS, SANS_FONT, TEXT_SHADOW } from './theme.ts';

const CAPTION_DURATION = 2.8;
const FADE_DURATION = 0.18;

/** Brief name and description shown when a weapon switch lands. */
export class WeaponCaption {
  private readonly nameElement: HTMLDivElement;
  private readonly descriptionElement: HTMLDivElement;
  private readonly container: HTMLDivElement;
  private timeRemaining = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(root: HTMLElement) {
    this.container = document.createElement('div');
    this.container.style.cssText = `position:absolute; bottom:150px; left:50%; transform:translateX(-50%); text-align:center; max-width:560px; font-family:${SANS_FONT}; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums; opacity:0; pointer-events:none;`;
    const label = document.createElement('div');
    label.style.cssText = `${LABEL_CSS} margin-bottom:8px;`;
    label.textContent = 'EQUIPPED';
    this.nameElement = document.createElement('div');
    this.nameElement.style.cssText = `font-size:20px; font-weight:300; color:${INK};`;
    this.descriptionElement = document.createElement('div');
    this.descriptionElement.style.cssText = `font-size:12px; margin-top:4px; color:${INK_DIM};`;
    this.container.append(label, this.nameElement, this.descriptionElement);
    root.appendChild(this.container);
  }

  show(name: string, description: string): void {
    this.nameElement.textContent = name;
    this.descriptionElement.textContent = description;
    this.timeRemaining = CAPTION_DURATION;
    this.container.style.opacity = '1';
  }

  update(dt: number): void {
    this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    this.container.style.opacity = String(this.timeRemaining > 0 ? this.reducedMotion.matches ? 1 : Math.min(1, this.timeRemaining / FADE_DURATION) : 0);
  }

  dispose(): void {
    this.container.remove();
  }
}
