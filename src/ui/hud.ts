export class Hud {
  private readonly ammoElement: HTMLDivElement;
  private readonly weaponNameElement: HTMLDivElement;
  private readonly scoreElement: HTMLDivElement;
  private readonly healthFillElement: HTMLDivElement;
  private readonly healthTextElement: HTMLDivElement;

  constructor(root: HTMLElement) {
    const crosshair = document.createElement('div');
    crosshair.style.cssText =
      'position:absolute; top:50%; left:50%; width:6px; height:6px; margin:-3px 0 0 -3px;' +
      ' border-radius:50%; background:#fff; box-shadow:0 0 2px #000;';
    root.appendChild(crosshair);

    this.scoreElement = document.createElement('div');
    this.scoreElement.style.cssText =
      'position:absolute; top:24px; left:32px; font-size:1.1rem; font-weight:600;' +
      ' text-shadow:0 1px 3px #000; font-variant-numeric:tabular-nums;';
    this.scoreElement.textContent = 'Score: 0';
    root.appendChild(this.scoreElement);

    const healthTrack = document.createElement('div');
    healthTrack.style.cssText =
      'position:absolute; bottom:24px; left:32px; width:180px; height:14px;' +
      ' background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.3); border-radius:3px; overflow:hidden;';
    this.healthFillElement = document.createElement('div');
    this.healthFillElement.style.cssText =
      'height:100%; width:100%; background:#3ecf5f; transition:width 0.15s, background 0.15s;';
    healthTrack.appendChild(this.healthFillElement);
    root.appendChild(healthTrack);

    this.healthTextElement = document.createElement('div');
    this.healthTextElement.style.cssText =
      'position:absolute; bottom:42px; left:32px; font-size:0.8rem; text-shadow:0 1px 3px #000;' +
      ' font-variant-numeric:tabular-nums;';
    root.appendChild(this.healthTextElement);

    this.weaponNameElement = document.createElement('div');
    this.weaponNameElement.style.cssText =
      'position:absolute; bottom:24px; right:32px; font-size:0.85rem; letter-spacing:0.05em;' +
      ' text-transform:uppercase; opacity:0.8; text-shadow:0 1px 3px #000;';
    root.appendChild(this.weaponNameElement);

    this.ammoElement = document.createElement('div');
    this.ammoElement.style.cssText =
      'position:absolute; bottom:44px; right:32px; font-size:1.4rem; font-weight:600;' +
      ' text-shadow:0 1px 3px #000; font-variant-numeric:tabular-nums;';
    root.appendChild(this.ammoElement);
  }

  setAmmo(current: number, max: number, reloading: boolean): void {
    this.ammoElement.textContent = reloading ? 'RELOADING…' : `${current} / ${max}`;
  }

  setWeaponName(name: string): void {
    this.weaponNameElement.textContent = name;
  }

  setScore(score: number): void {
    this.scoreElement.textContent = `Score: ${score}`;
  }

  setHealth(current: number, max: number): void {
    const ratio = Math.max(0, Math.min(1, current / max));
    this.healthFillElement.style.width = `${ratio * 100}%`;
    this.healthFillElement.style.background = ratio > 0.5 ? '#3ecf5f' : ratio > 0.25 ? '#e0a930' : '#e03b30';
    this.healthTextElement.textContent = `${Math.ceil(current)} HP`;
  }
}
