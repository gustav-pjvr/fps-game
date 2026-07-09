const ENTRY_DURATION = 3;
const FADE_DURATION = 0.5;

/** Large, center-screen banner for genuinely rare/exciting events (currently: the bonus golden
 * goose spawning - per explicit user request for "big text" on that event) - distinct from
 * GooseAnnouncement's small top-center toast, which fires constantly for the routine "a goose
 * appeared" spawn. Reserved for the one thing per match actually worth stopping to notice. */
export class BigAnnouncement {
  private readonly element: HTMLDivElement;
  private timeRemaining = 0;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText =
      'position:absolute; top:28%; left:50%; transform:translate(-50%, -50%); font-size:2.6rem;' +
      ' font-weight:800; letter-spacing:0.04em; color:#ffd54a; text-align:center; opacity:0;' +
      ' pointer-events:none; z-index:30; text-shadow:0 4px 20px rgba(0,0,0,0.8), 0 0 30px rgba(255,213,74,0.5);' +
      ' transition:opacity 0.3s;';
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

  dispose(): void {
    this.element.remove();
  }
}
