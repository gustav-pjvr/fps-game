import { HIT_MARKER_DURATION } from '../core/config.ts';

/** Brief X-shaped flash over the crosshair confirming a shot landed on a damageable entity. */
export class HitMarker {
  private readonly element: HTMLDivElement;
  private timeRemaining = 0;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText =
      'position:absolute; top:50%; left:50%; width:18px; height:18px; margin:-9px 0 0 -9px;' +
      ' opacity:0; pointer-events:none;';
    this.element.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 18 18">' +
      '<line x1="2" y1="2" x2="16" y2="16" stroke="#ff3b30" stroke-width="2.5"/>' +
      '<line x1="16" y1="2" x2="2" y2="16" stroke="#ff3b30" stroke-width="2.5"/>' +
      '</svg>';
    root.appendChild(this.element);
  }

  trigger(): void {
    this.timeRemaining = HIT_MARKER_DURATION;
  }

  update(dt: number): void {
    if (this.timeRemaining <= 0) return;
    this.timeRemaining -= dt;
    this.element.style.opacity = this.timeRemaining > 0 ? '1' : '0';
  }
}
