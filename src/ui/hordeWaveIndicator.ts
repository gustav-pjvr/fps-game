/** Always-on-screen "Wave X of Y" label for Goose Horde (single-player and multiplayer alike) -
 * per explicit user request ("always show what wave they're on"), distinct from the transient
 * GooseAnnouncement/BigAnnouncement toasts that fade after a few seconds. Top-center, just under
 * where MultiplayerHud's own room-code/scoreboard sit so nothing overlaps. */
export class HordeWaveIndicator {
  private readonly element: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText =
      'position:absolute; top:64px; left:50%; transform:translateX(-50%); padding:4px 14px;' +
      ' background:rgba(10,10,10,0.5); border:1px solid rgba(255,255,255,0.15); border-radius:6px;' +
      ' font-size:0.85rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase;' +
      ' text-shadow:0 1px 3px #000; pointer-events:none;';
    root.appendChild(this.element);
  }

  set(current: number, total: number): void {
    this.element.textContent = `Wave ${current} / ${total}`;
  }

  dispose(): void {
    this.element.remove();
  }
}
