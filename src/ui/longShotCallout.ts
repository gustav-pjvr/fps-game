const DISPLAY_DURATION = 1.5;
const FADE_DURATION = 0.4;

/** Quick, unobtrusive callout for a player hit landing at LONG_SHOT_DISTANCE or beyond (see
 * config.ts) - easy to miss amid tracers/hit markers/kill feed otherwise, so it gets its own brief
 * acknowledgment. Same fade-in/out shape as WeaponCaption. */
export class LongShotCallout {
  private readonly element: HTMLDivElement;
  private timeRemaining = 0;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'long-shot-callout';
    this.element.style.cssText =
      'position:absolute; top:32%; left:50%; transform:translateX(-50%); text-align:center;' +
      ' font-size:1rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase;' +
      ' color:#3ecf5f; text-shadow:0 1px 3px #000; opacity:0; pointer-events:none; transition:opacity 0.2s;';
    root.appendChild(this.element);
  }

  show(distance: number): void {
    this.element.textContent = `Long Shot — ${Math.round(distance)}m`;
    this.timeRemaining = DISPLAY_DURATION;
  }

  update(dt: number): void {
    if (this.timeRemaining <= 0) {
      this.element.style.opacity = '0';
      return;
    }
    this.timeRemaining -= dt;
    this.element.style.opacity = this.timeRemaining < FADE_DURATION ? String(Math.max(0, this.timeRemaining) / FADE_DURATION) : '1';
  }

  dispose(): void {
    this.element.remove();
  }
}
