import { MONO_FONT, INK_DIM, INK, SURFACE, SANS_FONT } from './theme.ts';
import { attachScanSweep, createButton } from './menu/menuStyles.ts';

/** Content sits near the top rather than screen-center (per user request) - clears both the
 * single-player Hud's top-left score text and, in multiplayer, MultiplayerHud's top-left health
 * rows and top-center scoreboard, all of which stay visible and updating underneath this overlay
 * while dead. */
const CONTENT_TOP_OFFSET = 110;

export class DeathScreen {
  private readonly element: HTMLDivElement;
  private readonly scoreElement: HTMLDivElement;

  constructor(root: HTMLElement, onRespawnClick: () => void, onReturnToLobbyClick: () => void) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'death-screen';
    this.element.className = 'menu-surface';
    this.element.style.cssText =
      'position:absolute; inset:0; display:none; align-items:center; justify-content:flex-start;' +
      ' padding-top:' +
      CONTENT_TOP_OFFSET +
      `px; flex-direction:column; gap:14px; background:${SURFACE}; backdrop-filter:blur(10px); color:${INK};` +
      ` font-family:${SANS_FONT}; z-index:20; pointer-events:auto;`;

    const title = document.createElement('div');
    title.textContent = 'YOU DIED';
    title.className = 'menu-panel-title';
    title.style.cssText = 'font-size:2.5rem; font-weight:300; letter-spacing:-0.01em;';

    this.scoreElement = document.createElement('div');
    this.scoreElement.style.cssText = `font-family:${MONO_FONT}; font-size:1.1rem; color:${INK_DIM};`;

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex; gap:12px; margin-top:8px;';

    const respawnButton = createButton('Respawn', 'primary');
    respawnButton.addEventListener('click', onRespawnClick);

    const lobbyButton = createButton('Return to Lobby');
    lobbyButton.addEventListener('click', onReturnToLobbyClick);

    buttonRow.append(respawnButton, lobbyButton);
    this.element.append(title, this.scoreElement, buttonRow);
    root.appendChild(this.element);
  }

  show(score: number): void {
    this.scoreElement.textContent = `Score: ${score}`;
    this.element.style.display = 'flex';
    attachScanSweep(this.element);
  }

  hide(): void {
    this.element.style.display = 'none';
  }

  dispose(): void {
    this.element.remove();
  }
}
