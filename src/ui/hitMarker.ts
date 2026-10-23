import { INK, THREAT } from './theme.ts';

const DURATION = 0.18;

/** Four short diagonal strokes confirm a hit without covering the aim point. */
export class HitMarker {
  private readonly element: HTMLDivElement;
  private timeRemaining = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText = `position:absolute; top:50%; left:50%; width:30px; height:30px; margin:-15px 0 0 -15px; color:${INK}; opacity:0; pointer-events:none;`;
    this.element.innerHTML = '<svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1">' +
      '<path d="M4 4 L9 9 M21 21 L26 26 M26 4 L21 9 M9 21 L4 26"/></svg>';
    root.appendChild(this.element);
  }

  trigger(headshotOrKill = false): void {
    this.timeRemaining = DURATION;
    this.element.style.color = headshotOrKill ? THREAT : INK;
    this.element.style.opacity = '1';
  }

  update(dt: number): void {
    this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    this.element.style.opacity = String(this.timeRemaining > 0 ? this.reducedMotion.matches ? 1 : this.timeRemaining / DURATION : 0);
  }

  dispose(): void {
    this.element.remove();
  }
}
