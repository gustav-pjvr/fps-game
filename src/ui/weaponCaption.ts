const CAPTION_DURATION = 2.8;
const FADE_DURATION = 0.5;

/** Brief name + flavor-text caption shown when a weapon switch lands. */
export class WeaponCaption {
  private readonly nameElement: HTMLDivElement;
  private readonly descriptionElement: HTMLDivElement;
  private readonly container: HTMLDivElement;
  private timeRemaining = 0;

  constructor(root: HTMLElement) {
    this.container = document.createElement('div');
    this.container.style.cssText =
      'position:absolute; bottom:150px; left:50%; transform:translateX(-50%); text-align:center;' +
      ' opacity:0; pointer-events:none; transition:opacity 0.3s;';

    this.nameElement = document.createElement('div');
    this.nameElement.style.cssText =
      'font-size:1.1rem; font-weight:700; letter-spacing:0.03em; text-shadow:0 1px 3px #000;';

    this.descriptionElement = document.createElement('div');
    this.descriptionElement.style.cssText =
      'font-size:0.8rem; opacity:0.85; margin-top:2px; text-shadow:0 1px 3px #000; font-style:italic;';

    this.container.append(this.nameElement, this.descriptionElement);
    root.appendChild(this.container);
  }

  show(name: string, description: string): void {
    this.nameElement.textContent = name;
    this.descriptionElement.textContent = description;
    this.timeRemaining = CAPTION_DURATION;
  }

  update(dt: number): void {
    if (this.timeRemaining <= 0) {
      this.container.style.opacity = '0';
      return;
    }
    this.timeRemaining -= dt;
    this.container.style.opacity = this.timeRemaining < FADE_DURATION ? String(this.timeRemaining / FADE_DURATION) : '1';
  }

  dispose(): void {
    this.container.remove();
  }
}
