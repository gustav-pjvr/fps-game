import { INK, INK_DIM, LABEL_CSS, SANS_FONT, SURFACE, HAIRLINE, TEXT_SHADOW, THREAT } from './theme.ts';

/** What a fallen co-op player sees (docs/coop.md): a small panel low on the screen, never a
 * full-screen death screen, so they keep watching the fight they are waiting to rejoin. Down: a bar
 * that drains while a teammate can still revive them. Out: back when the mode brings them back. */
export class DownedOverlay {
  private readonly element: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly line: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly bar: HTMLDivElement;

  constructor(root: HTMLElement, private readonly outLine: string) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'downed-overlay';
    // Spoken once per change of state: the bar itself is not announced.
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.element.style.cssText =
      `position:absolute; left:50%; bottom:22%; transform:translateX(-50%); display:none; width:min(320px, 76vw); box-sizing:border-box;` +
      ` padding:14px 18px 16px; text-align:center; color:${INK}; font-family:${SANS_FONT}; background:${SURFACE}; backdrop-filter:blur(10px);` +
      ` border:1px solid ${HAIRLINE}; border-top:2px solid ${THREAT}; border-radius:2px; text-shadow:${TEXT_SHADOW}; pointer-events:none;`;
    this.title = document.createElement('div');
    this.title.style.cssText = `${LABEL_CSS} color:${THREAT}; font-size:12px; letter-spacing:0.14em;`;
    this.line = document.createElement('div');
    this.line.style.cssText = `margin-top:6px; font-size:13px; line-height:1.4; color:${INK_DIM};`;
    this.track = document.createElement('div');
    this.track.setAttribute('aria-hidden', 'true');
    this.track.style.cssText = 'height:3px; margin-top:12px; background:rgba(233, 239, 233, 0.16); border-radius:2px; overflow:hidden;';
    this.bar = document.createElement('div');
    this.bar.style.cssText = `height:100%; width:100%; transform-origin:left center; background:${THREAT}; border-radius:2px;`;
    this.track.appendChild(this.bar);
    this.element.append(this.title, this.line, this.track);
    root.appendChild(this.element);
  }

  showDown(): void {
    this.title.textContent = 'YOU ARE DOWN';
    this.line.textContent = 'A teammate can revive you';
    this.track.style.display = '';
    this.bar.style.transform = 'scaleX(1)';
    this.element.dataset.state = 'down';
    this.element.style.display = 'block';
  }

  /** How much of the time to be revived is left, 0 to 1. */
  setBleed(ratio: number): void {
    this.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio)).toFixed(3)})`;
  }

  showOut(): void {
    this.title.textContent = 'OUT OF THE FIGHT';
    this.line.textContent = this.outLine;
    this.track.style.display = 'none';
    this.element.dataset.state = 'out';
    this.element.style.display = 'block';
  }

  hide(): void {
    this.element.style.display = 'none';
    delete this.element.dataset.state;
  }

  dispose(): void {
    this.element.remove();
  }
}
