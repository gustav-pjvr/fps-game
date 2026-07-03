const ENTRY_DURATION = 2.5;
const FADE_DURATION = 0.4;

/** Brief top-center toast naming what was just killed. */
export class KillFeed {
  private readonly element: HTMLDivElement;
  private timeRemaining = 0;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText =
      'position:absolute; top:64px; left:50%; transform:translateX(-50%); font-size:0.95rem;' +
      ' font-weight:600; text-shadow:0 1px 3px #000; opacity:0; pointer-events:none;';
    root.appendChild(this.element);
  }

  show(label: string): void {
    this.element.textContent = label;
    this.timeRemaining = ENTRY_DURATION;
  }

  update(dt: number): void {
    if (this.timeRemaining <= 0) {
      this.element.style.opacity = '0';
      return;
    }
    this.timeRemaining -= dt;
    this.element.style.opacity = this.timeRemaining < FADE_DURATION ? String(this.timeRemaining / FADE_DURATION) : '1';
  }
}
