import { createButton } from './menuStyles.ts';

export interface MainMenuCallbacks {
  onPlay: () => void;
  onSettings: () => void;
  onInventory: () => void;
}

/** Lobby's persistent bottom-right button rail: Play / Settings / Inventory. */
export class MainMenu {
  private readonly element: HTMLDivElement;

  constructor(root: HTMLElement, callbacks: MainMenuCallbacks) {
    this.element = document.createElement('div');
    this.element.style.cssText = 'position:absolute; inset:0; display:none; pointer-events:none; z-index:15;';

    const title = document.createElement('div');
    title.textContent = 'FPS GAME';
    title.style.cssText =
      'position:absolute; top:40px; left:40px; font-size:1.6rem; font-weight:800; letter-spacing:0.15em;' +
      ' color:#fff; text-shadow:0 2px 8px rgba(0,0,0,0.6);';
    this.element.appendChild(title);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText =
      'position:absolute; bottom:40px; right:40px; display:flex; flex-direction:column; gap:10px;' +
      ' align-items:stretch; pointer-events:auto;';

    const playButton = createButton('PLAY', 'primary');
    playButton.style.minWidth = '180px';
    playButton.addEventListener('click', callbacks.onPlay);

    const settingsButton = createButton('SETTINGS');
    settingsButton.style.minWidth = '180px';
    settingsButton.addEventListener('click', callbacks.onSettings);

    const inventoryButton = createButton('INVENTORY');
    inventoryButton.style.minWidth = '180px';
    inventoryButton.addEventListener('click', callbacks.onInventory);

    buttonRow.append(playButton, settingsButton, inventoryButton);
    this.element.appendChild(buttonRow);
    root.appendChild(this.element);
  }

  show(): void {
    this.element.style.display = 'block';
  }

  hide(): void {
    this.element.style.display = 'none';
  }

  dispose(): void {
    this.element.remove();
  }
}
