/** Full-screen progress display shown while a match's chosen enemy/target count is being spawned. */
export class LoadingScreen {
  private readonly element: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private readonly statusLabel: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText =
      'position:absolute; inset:0; display:none; flex-direction:column; align-items:center;' +
      ' justify-content:center; gap:18px; background:#0b0d10; color:#eee;' +
      ' font-family:system-ui, sans-serif; z-index:40;';

    const title = document.createElement('div');
    title.textContent = 'DEPLOYING';
    title.style.cssText = 'font-size:1.6rem; font-weight:800; letter-spacing:0.25em;';

    const track = document.createElement('div');
    track.style.cssText =
      'width:320px; height:10px; background:rgba(255,255,255,0.1); border-radius:5px; overflow:hidden;';
    this.barFill = document.createElement('div');
    this.barFill.style.cssText = 'height:100%; width:0%; background:#3ecf5f; transition:width 0.15s ease-out;';
    track.appendChild(this.barFill);

    this.statusLabel = document.createElement('div');
    this.statusLabel.style.cssText = 'font-size:0.85rem; opacity:0.7; letter-spacing:0.05em;';

    this.element.append(title, track, this.statusLabel);
    root.appendChild(this.element);
  }

  show(): void {
    this.setProgress('Initializing…', 0);
    this.element.style.display = 'flex';
  }

  hide(): void {
    this.element.style.display = 'none';
  }

  setProgress(status: string, ratio: number): void {
    this.statusLabel.textContent = status;
    this.barFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }
}
