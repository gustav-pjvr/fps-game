import { attachScanSweep, createButton, closeOnBackdropClick, createOverlay, createPanel, createPanelTitle } from './menuStyles.ts';

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
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.overlay.remove();
  }
}
