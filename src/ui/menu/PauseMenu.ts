import { attachScanSweep, createButton, createOverlay, createPanel, createPanelTitle, MOTION_EASE } from './menuStyles.ts';

export interface PauseMenuCallbacks {
  onResume: () => void;
  onSettings: () => void;
  onResetPlay: () => void;
  onReturnToLobby: () => void;
  onRespawn: () => void;
  onLoadout: () => void;
}

/** How long the pause menu must stay continuously open before "Respawn" unlocks - see the class
 * comment on that button below for why this exists at all. */
const RESPAWN_UNLOCK_DELAY_MS = 5000;

/** Shown whenever pointer lock isn't engaged mid-match (pressing Escape forces the browser to
 * release pointer lock, which Game treats as "paused") - also doubles as the very first "click to
 * play" gate for a freshly loaded match, since both cases are just "pointer lock is not held". */
export class PauseMenu {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly respawnButton: HTMLButtonElement | null = null;
  /** Set to the timestamp the pause menu most recently opened; cleared on close. Used to gate
   * "Respawn" behind RESPAWN_UNLOCK_DELAY_MS of *continuous* pause time - see that button's own
   * comment below. */
  private pausedSinceMs: number | null = null;

  /** `isMultiplayer` hides the "Restart" button entirely - it's single-player's own
   * practice-reset feature (fresh targets/enemies/ammo/score); Game.resetPlay() is a no-op in
   * multiplayer unless the player happens to already be dead, so showing it there is a button
   * that does nothing for anyone not currently waiting to respawn. In its place, multiplayer gets
   * a "Respawn" button instead (per user request) - an unstuck button for a player who spawned
   * inside geometry (e.g. inside a house), teleporting them to a fresh random point without
   * touching health/score. */
  /** `showLoadoutButton` (per explicit user request): only the three modes that don't already
   * restrict/manage weapons themselves (see core/gameModes.ts's modeUsesCustomLoadout) get a
   * "Loadout" button here - every other mode's loadout is fixed by the mode itself, so there'd be
   * nothing meaningful to change mid-match. */
  constructor(root: HTMLElement, callbacks: PauseMenuCallbacks, isMultiplayer: boolean, showLoadoutButton: boolean) {
    this.overlay = createOverlay();
    this.overlay.dataset.testid = 'pause-menu';

    const panel = createPanel();
    this.panel = panel;
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
    if (isMultiplayer) {
      // Starts locked (faded, unclickable) and only unlocks after RESPAWN_UNLOCK_DELAY_MS of
      // continuously holding the pause menu open (see update() below) - a player can't exploit
      // this as a free instant-escape by spamming Escape/Resume, since closing the menu at all
      // resets the timer back to zero.
      const respawnButton = createButton('Respawn');
      respawnButton.disabled = true;
      respawnButton.style.opacity = '0.35';
      respawnButton.style.pointerEvents = 'none';
      respawnButton.style.transition = `opacity 0.4s ${MOTION_EASE}`;
      respawnButton.addEventListener('click', callbacks.onRespawn);
      this.respawnButton = respawnButton;
      buttonColumn.append(respawnButton);
    } else {
      const resetButton = createButton('Restart');
      resetButton.addEventListener('click', callbacks.onResetPlay);
      buttonColumn.append(resetButton);
    }
    if (showLoadoutButton) {
      const loadoutButton = createButton('Loadout');
      loadoutButton.addEventListener('click', callbacks.onLoadout);
      buttonColumn.append(loadoutButton);
    }
    buttonColumn.append(lobbyButton);
    panel.appendChild(buttonColumn);

    this.overlay.appendChild(panel);
    root.appendChild(this.overlay);
  }

  setVisible(visible: boolean): void {
    const wasVisible = this.overlay.style.display === 'flex';
    this.overlay.style.display = visible ? 'flex' : 'none';

    if (visible && !wasVisible) {
      this.pausedSinceMs = performance.now();
      attachScanSweep(this.panel);
    } else if (!visible) {
      this.pausedSinceMs = null;
      this.setRespawnLocked(true);
    }
  }

  /** Call once per frame while the game loop is running - unlocks "Respawn" once the menu has
   * been open continuously for RESPAWN_UNLOCK_DELAY_MS. A no-op in single-player (no respawn
   * button exists) or once already unlocked. */
  update(): void {
    if (!this.respawnButton || this.respawnButton.disabled === false || this.pausedSinceMs === null) return;
    if (performance.now() - this.pausedSinceMs >= RESPAWN_UNLOCK_DELAY_MS) {
      this.setRespawnLocked(false);
    }
  }

  private setRespawnLocked(locked: boolean): void {
    if (!this.respawnButton) return;
    this.respawnButton.disabled = locked;
    this.respawnButton.style.opacity = locked ? '0.35' : '1';
    this.respawnButton.style.pointerEvents = locked ? 'none' : 'auto';
  }

  dispose(): void {
    this.overlay.remove();
  }
}
