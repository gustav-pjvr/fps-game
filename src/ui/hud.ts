export class Hud {
  private readonly ammoElement: HTMLDivElement;

  constructor(root: HTMLElement) {
    const crosshair = document.createElement('div');
    crosshair.style.cssText =
      'position:absolute; top:50%; left:50%; width:6px; height:6px; margin:-3px 0 0 -3px;' +
      ' border-radius:50%; background:#fff; box-shadow:0 0 2px #000;';
    root.appendChild(crosshair);

    this.ammoElement = document.createElement('div');
    this.ammoElement.style.cssText =
      'position:absolute; bottom:24px; right:32px; font-size:1.4rem; font-weight:600;' +
      ' text-shadow:0 1px 3px #000; font-variant-numeric:tabular-nums;';
    root.appendChild(this.ammoElement);
  }

  setAmmo(current: number, max: number, reloading: boolean): void {
    this.ammoElement.textContent = reloading ? 'RELOADING…' : `${current} / ${max}`;
  }
}
