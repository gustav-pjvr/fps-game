import { loadAccessCode, relayUrl, saveAccessCode } from '../../network/relaySettings.ts';
import { ACCESS_CODE_MAX_LENGTH } from '../../network/serverEnvelope.ts';
import { attachScanSweep, createButton, closeOnBackdropClick, createOverlay, createPanel, createPanelTitle, createTextInput } from './menuStyles.ts';
import { ModalScope } from './modalScope.ts';

export interface MultiplayerMenuCallbacks {
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onClose: () => void;
}

/** Shown from the main menu's "Multiplayer" button - the fork between hosting a room (get a code,
 * wait for someone to join) and joining one (type in a code someone gave you). See
 * MULTIPLAYER_PLAN.md §2 for the room-code design this leads into. */
export class MultiplayerMenu {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly scope = new ModalScope();

  constructor(root: HTMLElement, callbacks: MultiplayerMenuCallbacks) {
    this.overlay = createOverlay();
    closeOnBackdropClick(this.overlay, callbacks.onClose);

    const panel = createPanel();
    this.panel = panel;
    panel.style.width = '360px';
    panel.appendChild(createPanelTitle('MULTIPLAYER'));

    const description = document.createElement('div');
    description.textContent = 'Online matches for up to 4 players.';
    description.style.cssText = 'font-size:0.9rem; opacity:0.75; margin-bottom:22px; line-height:1.5;';
    panel.appendChild(description);

    if (relayUrl()) {
      const accessLabel = document.createElement('label');
      accessLabel.textContent = 'Access code';
      accessLabel.htmlFor = 'multiplayer-access-code';
      accessLabel.style.cssText = 'display:block; font-size:0.9rem; margin-bottom:8px;';
      const accessInput = createTextInput('Access code', ACCESS_CODE_MAX_LENGTH);
      accessInput.id = 'multiplayer-access-code';
      accessInput.type = 'password';
      accessInput.autocomplete = 'off';
      accessInput.value = loadAccessCode();
      accessInput.addEventListener('change', () => saveAccessCode(accessInput.value));
      const accessHint = document.createElement('div');
      accessHint.textContent = 'Only needed for the game server.';
      accessHint.style.cssText = 'font-size:0.8rem; opacity:0.7; margin-top:6px; margin-bottom:22px;';
      panel.append(accessLabel, accessInput, accessHint);
    }

    const buttonColumn = document.createElement('div');
    buttonColumn.style.cssText = 'display:flex; flex-direction:column; gap:10px;';

    const createButtonEl = createButton('Create Room', 'primary');
    createButtonEl.addEventListener('click', callbacks.onCreateRoom);

    const joinButtonEl = createButton('Join Room');
    joinButtonEl.addEventListener('click', callbacks.onJoinRoom);

    buttonColumn.append(createButtonEl, joinButtonEl);
    panel.appendChild(buttonColumn);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:flex-end; margin-top:24px;';
    const closeButton = createButton('Close');
    closeButton.addEventListener('click', callbacks.onClose);
    footer.appendChild(closeButton);
    panel.appendChild(footer);

    this.overlay.appendChild(panel);
    root.appendChild(this.overlay);

    // Escape closes - no single "Enter" default here (Create Room vs Join Room are equally
    // weighted choices, not a primary/secondary pair), so Enter is deliberately left to native
    // per-button activation only.
    this.onKeyDown = (event) => {
      if (this.overlay.style.display === 'none') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        callbacks.onClose();
      }
    };
    document.addEventListener('keydown', this.onKeyDown);
  }

  show(): void {
    this.overlay.style.display = 'flex';
    attachScanSweep(this.panel);
    this.scope.enter(this.overlay, this.panel.querySelector<HTMLButtonElement>('button'));
  }

  hide(): void {
    this.overlay.style.display = 'none';
    this.scope.leave();
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.scope.leave();
    this.overlay.remove();
  }
}
