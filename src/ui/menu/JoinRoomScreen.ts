import { PeerConnection } from '../../network/PeerConnection.ts';
import type { MultiplayerMatchStartParams } from '../../network/MultiplayerSession.ts';
import { loadStoredUsername, normalizeUsername, saveUsername } from '../../core/username.ts';
import { ACCENT, TEXT, createButton, createOverlay, createPanel, createPanelTitle, createTextInput } from './menuStyles.ts';

/** Guest side of the room-code flow (see MULTIPLAYER_PLAN.md §2/§7): type in a code someone gave
 * you, connect, verify the connection with a `hello` exchange, then wait for the host to start the
 * match - the guest never picks the seed itself, only receives the one the host generated (see
 * MatchStartMessage in protocol.ts), so there's nothing for the guest to click here. Mirrors
 * CreateRoomScreen. */
export class JoinRoomScreen {
  private readonly overlay: HTMLDivElement;
  private readonly usernameInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly statusText: HTMLDivElement;
  private connection: PeerConnection | null = null;
  /** Bumped by attemptJoin()/close() - PeerConnection.joinRoom is async now (the TURN credential
   * fetch), so a repeat Join click or a Cancel can land while an earlier joinRoom() call is still
   * in flight. Without this, that in-flight call would resolve *after* this screen moved on and
   * incorrectly resurrect `this.connection`, leaking a PeerJS peer this screen no longer owns. */
  private joinGeneration = 0;
  /** The host's own chosen name, learned from their `hello` - null until it arrives. */
  private hostUsername: string | null = null;

  constructor(
    root: HTMLElement,
    private readonly onClose: () => void,
    private readonly onStartMatch: (connection: PeerConnection, params: MultiplayerMatchStartParams) => void,
  ) {
    this.overlay = createOverlay();

    const panel = createPanel();
    panel.style.width = '400px';
    panel.appendChild(createPanelTitle('JOIN ROOM'));

    const usernameLabel = document.createElement('div');
    usernameLabel.textContent = 'Your name:';
    usernameLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:8px;';
    panel.appendChild(usernameLabel);

    this.usernameInput = createTextInput('Player name', 16);
    this.usernameInput.style.marginBottom = '16px';
    this.usernameInput.value = loadStoredUsername();
    panel.appendChild(this.usernameInput);

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
    this.hostUsername = null;

    const generation = ++this.joinGeneration;
    void PeerConnection.joinRoom(code, {
      onConnected: () => {
        this.setStatus('Connected! Verifying the connection…');
        const username = normalizeUsername(this.usernameInput.value);
        this.usernameInput.value = username;
        saveUsername(username);
        this.connection?.send({ type: 'hello', username });
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
        if (message.type === 'hello') {
          this.hostUsername = message.username;
          this.setStatus('Connection verified both ways. Waiting for the host to start the match…');
        }
        if (message.type === 'matchStart') {
          this.startMatch({
            seed: message.seed,
            killLimit: message.killLimit,
            spawnA: { x: message.spawnAX, z: message.spawnAZ },
            spawnB: { x: message.spawnBX, z: message.spawnBZ },
            ownUsername: normalizeUsername(this.usernameInput.value),
            // matchStart can only arrive after the host has already seen this guest's own hello
            // and this guest has, symmetrically, already received the host's - see the comment on
            // CreateRoomScreen's equivalent fallback for why this is never actually reached null.
            opponentUsername: this.hostUsername ?? 'Host',
          });
        }
      },
    }).then((connection) => {
      // This screen moved on (closed, or a repeat Join click superseded this attempt) while the
      // TURN credential fetch was still in flight - dispose the now-orphaned connection rather
      // than assigning it.
      if (generation !== this.joinGeneration) {
        connection.dispose();
        return;
      }
      this.connection = connection;
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
    this.joinGeneration++;
    this.connection?.dispose();
    this.connection = null;
    this.joinButton.disabled = false;
    this.overlay.style.display = 'none';
    this.onClose();
  }

  dispose(): void {
    this.joinGeneration++;
    this.connection?.dispose();
    this.overlay.remove();
  }
}
