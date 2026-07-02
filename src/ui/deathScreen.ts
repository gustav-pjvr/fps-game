export class DeathScreen {
  private readonly element: HTMLDivElement;
  private readonly scoreElement: HTMLDivElement;

  constructor(root: HTMLElement, onRespawnClick: () => void) {
    this.element = document.createElement('div');
    this.element.style.cssText =
      'position:absolute; inset:0; display:none; align-items:center; justify-content:center;' +
      ' flex-direction:column; gap:12px; background:rgba(40,0,0,0.55); color:#fff;' +
      ' font-family:system-ui, sans-serif; cursor:pointer; z-index:20; pointer-events:auto;';

    const title = document.createElement('div');
    title.textContent = 'YOU DIED';
    title.style.cssText = 'font-size:2.5rem; font-weight:700; letter-spacing:0.1em;';

    this.scoreElement = document.createElement('div');
    this.scoreElement.style.cssText = 'font-size:1.1rem; opacity:0.85;';

    const prompt = document.createElement('div');
    prompt.textContent = 'Click to respawn';
    prompt.style.cssText = 'font-size:0.95rem; opacity:0.7; margin-top:8px;';

    this.element.append(title, this.scoreElement, prompt);
    this.element.addEventListener('click', onRespawnClick);
    root.appendChild(this.element);
  }

  show(score: number): void {
    this.scoreElement.textContent = `Score: ${score}`;
    this.element.style.display = 'flex';
  }

  hide(): void {
    this.element.style.display = 'none';
  }
}
