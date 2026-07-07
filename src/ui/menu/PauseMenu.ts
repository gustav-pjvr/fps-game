import { createButton, createOverlay, createPanel, createPanelTitle } from './menuStyles.ts';

export interface PauseMenuCallbacks {
  onResume: () => void;
  onSettings: () => void;
  onResetPlay: () => void;
  onReturnToLobby: () => void;
}

/** Shown whenever pointer lock isn't engaged mid-match (pressing Escape forces the browser to
 * release pointer lock, which Game treats as "paused") - also doubles as the very first "click to
 * play" gate for a freshly loaded match, since both cases are just "pointer lock is not held". */
export class PauseMenu {
  private readonly overlay: HTMLDivElement;

  /** `isMultiplayer` hides the "Reset Play" button entirely - it's single-player's own
   * practice-reset feature (fresh targets/enemies/ammo/score); Game.resetPlay() is a no-op in
   * multiplayer unless the player happens to already be dead, so showing it there is a button
   * that does nothing for anyone not currently waiting to respawn. */
  constructor(root: HTMLElement, callbacks: PauseMenuCallbacks, isMultiplayer: boolean) {
    this.overlay = createOverlay();
    this.overlay.dataset.testid = 'pause-menu';

    const panel = createPanel();
    panel.style.width = '320px';
    panel.style.textAlign = 'center';
    panel.appendChild(createPanelTitle('PAUSED'));

    const buttonColumn = document.createElement('div');
    buttonColumn.style.cssText = 'display:flex; flex-direction:column; gap:10px;';

    const resumeButton = createButton('Resume', 'primary');
    resumeButton.addEventListener('click', callbacks.onResume);

    const settingsButton = createButton('Settings');
    settingsButton.addEventListener('click', callbacks.onSettings);

    const lobbyButton = createButton('Return to Lobby');
    lobbyButton.addEventListener('click', callbacks.onReturnToLobby);

    buttonColumn.append(resumeButton, settingsButton);
    if (!isMultiplayer) {
      const resetButton = createButton('Reset Play');
      resetButton.addEventListener('click', callbacks.onResetPlay);
      buttonColumn.append(resetButton);
    }
    buttonColumn.append(lobbyButton);
    panel.appendChild(buttonColumn);

    this.overlay.appendChild(panel);
    root.appendChild(this.overlay);
  }

  setVisible(visible: boolean): void {
    this.overlay.style.display = visible ? 'flex' : 'none';
  }

  dispose(): void {
    this.overlay.remove();
  }
}
