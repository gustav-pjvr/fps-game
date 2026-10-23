import { MONO_FONT, INK_DIM, INK, VOID, ACCENT, HAIRLINE, SANS_FONT } from '../theme.ts';
import { attachScanSweep } from './menuStyles.ts';

/** Full-screen progress display shown while a match's chosen enemy/target count is being spawned. */
export class LoadingScreen {
  private readonly element: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private readonly statusLabel: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText =
      'position:absolute; inset:0; display:none; flex-direction:column; align-items:center;' +
      ` justify-content:center; gap:18px; background:${VOID}; color:${INK};` +
      ` font-family:${SANS_FONT}; z-index:40;`;

    const title = document.createElement('div');
    title.textContent = 'DEPLOYING';
    title.className = 'menu-panel-title';
    title.style.cssText = 'font-size:1.9rem; font-weight:300; letter-spacing:-0.01em;';

    const track = document.createElement('div');
    track.style.cssText =
      `width:320px; height:3px; background:${HAIRLINE}; border-radius:2px; overflow:hidden;`;
    this.barFill = document.createElement('div');
    this.barFill.style.cssText = `height:100%; width:0%; background:${ACCENT}; transition:width 0.15s ease-out;`;
    track.appendChild(this.barFill);

    this.statusLabel = document.createElement('div');
    this.statusLabel.style.cssText = `font-family:${MONO_FONT}; font-size:11px; color:${INK_DIM}; letter-spacing:0.05em;`;

    this.element.append(title, track, this.statusLabel);
    root.appendChild(this.element);
  }

  show(): void {
    this.setProgress('Initializing…', 0);
    this.element.style.display = 'flex';
    attachScanSweep(this.element);
  }

  hide(): void {
    this.element.style.display = 'none';
  }

  setProgress(status: string, ratio: number): void {
    this.statusLabel.textContent = status;
    this.barFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }
}
