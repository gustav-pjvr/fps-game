import { createButton, createOverlay, createPanel, createPanelTitle } from './menuStyles.ts';

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

  constructor(root: HTMLElement, callbacks: MultiplayerMenuCallbacks) {
    this.overlay = createOverlay();

    const panel = createPanel();
    panel.style.width = '360px';
    panel.appendChild(createPanelTitle('MULTIPLAYER'));

    const description = document.createElement('div');
    description.textContent = 'Play a free-for-all match with up to 4 players over the internet.';
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
  }

  show(): void {
    this.overlay.style.display = 'flex';
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  dispose(): void {
    this.overlay.remove();
  }
}
