import { PeerConnection } from '../../network/PeerConnection.ts';
import type { MultiplayerMatchStartParams } from '../../network/MultiplayerSession.ts';
import { ACCENT, TEXT, createButton, createOverlay, createPanel, createPanelTitle } from './menuStyles.ts';

/** Guest side of the room-code flow (see MULTIPLAYER_PLAN.md §2/§7): type in a code someone gave
 * you, connect, verify the connection with a `hello` exchange, then wait for the host to start the
 * match - the guest never picks the seed itself, only receives the one the host generated (see
 * MatchStartMessage in protocol.ts), so there's nothing for the guest to click here. Mirrors
 * CreateRoomScreen. */
export class JoinRoomScreen {
  private readonly overlay: HTMLDivElement;
  private readonly codeInput: HTMLInputElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly statusText: HTMLDivElement;
  private connection: PeerConnection | null = null;

  constructor(
    root: HTMLElement,
    private readonly onClose: () => void,
    private readonly onStartMatch: (connection: PeerConnection, params: MultiplayerMatchStartParams) => void,
  ) {
    this.overlay = createOverlay();

    const panel = createPanel();
    panel.style.width = '400px';
    panel.appendChild(createPanelTitle('JOIN ROOM'));

    const label = document.createElement('div');
    label.textContent = 'Enter the room code the other player gave you:';
    label.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:10px;';
    panel.appendChild(label);

    this.codeInput = document.createElement('input');
    this.codeInput.type = 'text';
    this.codeInput.maxLength = 6;
    this.codeInput.placeholder = 'ABCDEF';
    this.codeInput.style.cssText =
      `width:100%; box-sizing:border-box; padding:14px; font-size:1.6rem; font-weight:700;` +
      ` letter-spacing:0.3em; text-align:center; text-transform:uppercase; color:${ACCENT};` +
      ' border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.05);' +
      ' margin-bottom:14px;';
    // Codes are generated uppercase-only (see generateRoomCode) - normalizing keystrokes as they
    // land means a pasted or shift-less lowercase code still works without the player noticing.
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase();
    });
    this.codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.attemptJoin();
    });
    panel.appendChild(this.codeInput);

    this.joinButton = createButton('Join', 'primary');
    this.joinButton.style.width = '100%';
    this.joinButton.addEventListener('click', () => this.attemptJoin());
    panel.appendChild(this.joinButton);

    this.statusText = document.createElement('div');
    this.statusText.style.cssText = `font-size:0.9rem; color:${TEXT}; opacity:0.85; margin-top:18px; text-align:center; min-height:1.4em;`;
    panel.appendChild(this.statusText);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:flex-end; margin-top:20px;';
    const cancelButton = createButton('Cancel');
    cancelButton.addEventListener('click', () => this.close());
    footer.appendChild(cancelButton);
    panel.appendChild(footer);

    this.overlay.appendChild(panel);
    root.appendChild(this.overlay);
  }

  show(): void {
    this.overlay.style.display = 'flex';
    this.codeInput.value = '';
    this.setStatus('');
    this.codeInput.focus();
  }

  private attemptJoin(): void {
    const code = this.codeInput.value.trim();
    if (code.length === 0) {
      this.setStatus('Enter a room code first.');
      return;
    }

    // A stale in-flight attempt (e.g. the player edited the code and hit Join again before the
    // first attempt resolved) shouldn't leave two connections racing to attach.
    this.connection?.dispose();
    this.joinButton.disabled = true;
    this.setStatus('Connecting…');

    this.connection = PeerConnection.joinRoom(code, {
      onConnected: () => {
        this.setStatus('Connected! Verifying the connection…');
        this.connection?.send({ type: 'hello' });
      },
      onDisconnected: () => {
        this.setStatus('The other player disconnected.');
        this.joinButton.disabled = false;
      },
      onError: (message) => {
        this.setStatus(message);
        this.joinButton.disabled = false;
      },
      onMessage: (message) => {
        if (message.type === 'hello') this.setStatus('Connection verified both ways. Waiting for the host to start the match…');
        if (message.type === 'matchStart') {
          this.startMatch({
            seed: message.seed,
            killLimit: message.killLimit,
            spawnA: { x: message.spawnAX, z: message.spawnAZ },
            spawnB: { x: message.spawnBX, z: message.spawnBZ },
          });
        }
      },
    });
  }

  private startMatch(params: MultiplayerMatchStartParams): void {
    if (!this.connection) return;
    const connection = this.connection;
    // Same handoff as CreateRoomScreen.startMatch - the match owns this connection from here on.
    this.connection = null;
    this.overlay.style.display = 'none';
    this.onStartMatch(connection, params);
  }

  private setStatus(text: string): void {
    this.statusText.textContent = text;
  }

  private close(): void {
    this.connection?.dispose();
    this.connection = null;
    this.joinButton.disabled = false;
    this.overlay.style.display = 'none';
    this.onClose();
  }

  dispose(): void {
    this.connection?.dispose();
    this.overlay.remove();
  }
}
