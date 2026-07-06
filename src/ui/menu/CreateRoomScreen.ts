import { PeerConnection, generateRoomCode } from '../../network/PeerConnection.ts';
import { generateMultiplayerSeed } from '../../core/worldSeed.ts';
import { pickMultiplayerSpawnPoints } from '../../core/multiplayerSpawn.ts';
import type { MultiplayerMatchStartParams } from '../../network/MultiplayerSession.ts';
import { DEFAULT_MULTIPLAYER_KILL_LIMIT, MULTIPLAYER_KILL_LIMIT_OPTIONS } from '../../core/config.ts';
import { ACCENT, TEXT, HAIRLINE, BG_RAISED, createButton, createOverlay, createPanel, createPanelTitle } from './menuStyles.ts';

/** Host side of the room-code flow (see MULTIPLAYER_PLAN.md §2/§7): generates a code, shows it,
 * waits for a guest to connect, verifies the connection with a `hello` exchange, then offers
 * "Start Match" - clicking it picks the one seed both players will use, this match's two random
 * spawn points, and the host's chosen win condition (§4), sends all of it across, and hands the
 * now-established connection off to whoever's starting the actual match (see onStartMatch). */
export class CreateRoomScreen {
  private readonly overlay: HTMLDivElement;
  private readonly codeDisplay: HTMLDivElement;
  private readonly killLimitSelect: HTMLSelectElement;
  private readonly statusText: HTMLDivElement;
  private readonly startButton: HTMLButtonElement;
  private connection: PeerConnection | null = null;

  constructor(
    root: HTMLElement,
    private readonly onClose: () => void,
    private readonly onStartMatch: (connection: PeerConnection, params: MultiplayerMatchStartParams) => void,
  ) {
    this.overlay = createOverlay();

    const panel = createPanel();
    panel.style.width = '400px';
    panel.appendChild(createPanelTitle('CREATE ROOM'));

    const label = document.createElement('div');
    label.textContent = 'Share this code with the other player:';
    label.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:10px;';
    panel.appendChild(label);

    this.codeDisplay = document.createElement('div');
    this.codeDisplay.style.cssText =
      `font-size:2.2rem; font-weight:700; letter-spacing:0.3em; text-align:center; color:${ACCENT};` +
      ' padding:18px 0; background:rgba(255,255,255,0.05); border-radius:8px; margin-bottom:14px;' +
      ' font-variant-numeric:tabular-nums;';
    panel.appendChild(this.codeDisplay);

    const copyButton = createButton('Copy Code');
    copyButton.style.width = '100%';
    copyButton.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.codeDisplay.textContent ?? '');
    });
    panel.appendChild(copyButton);

    const killLimitLabel = document.createElement('div');
    killLimitLabel.textContent = 'First to how many kills wins?';
    killLimitLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-top:16px; margin-bottom:8px;';
    panel.appendChild(killLimitLabel);

    // Host-only setting (MULTIPLAYER_PLAN.md §4): the guest never picks this, only receives it as
    // part of MatchStartMessage. A plain <select> rather than a dedicated RoomSettingsPanel file -
    // one control doesn't earn its own component yet; promote it if match settings grow past this.
    this.killLimitSelect = document.createElement('select');
    this.killLimitSelect.style.cssText =
      `width:100%; box-sizing:border-box; padding:12px; font-size:1rem; font-weight:600; color:${TEXT};` +
      ` background:${BG_RAISED}; border:1px solid ${HAIRLINE}; border-radius:8px; cursor:pointer;`;
    for (const option of MULTIPLAYER_KILL_LIMIT_OPTIONS) {
      const optionElement = document.createElement('option');
      optionElement.value = String(option);
      optionElement.textContent = `${option} kills`;
      if (option === DEFAULT_MULTIPLAYER_KILL_LIMIT) optionElement.selected = true;
      this.killLimitSelect.appendChild(optionElement);
    }
    panel.appendChild(this.killLimitSelect);

    this.statusText = document.createElement('div');
    this.statusText.style.cssText = `font-size:0.9rem; color:${TEXT}; opacity:0.85; margin-top:18px; text-align:center; min-height:1.4em;`;
    panel.appendChild(this.statusText);

    this.startButton = createButton('Start Match', 'primary');
    this.startButton.style.width = '100%';
    this.startButton.style.marginTop = '14px';
    this.startButton.style.display = 'none';
    this.startButton.addEventListener('click', () => this.startMatch());
    panel.appendChild(this.startButton);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:flex-end; margin-top:20px;';
    const cancelButton = createButton('Cancel');
    cancelButton.addEventListener('click', () => this.close());
    footer.appendChild(cancelButton);
    panel.appendChild(footer);

    this.overlay.appendChild(panel);
    root.appendChild(this.overlay);
  }

  /** Starts a fresh room each time this screen is opened, rather than reusing whatever room a
   * previous visit created - an abandoned "Create Room" attempt shouldn't leave a stale room
   * live on the broker that a stale code might still (confusingly) connect to. */
  show(): void {
    this.overlay.style.display = 'flex';
    this.startButton.style.display = 'none';
    const code = generateRoomCode();
    this.codeDisplay.textContent = code;
    this.setStatus('Waiting for the other player to join…');

    this.connection = PeerConnection.hostRoom(code, {
      onConnected: () => {
        this.setStatus('Connected! Verifying the connection…');
        this.connection?.send({ type: 'hello' });
      },
      onDisconnected: () => this.setStatus('The other player disconnected.'),
      onError: (message) => this.setStatus(message),
      onMessage: (message) => {
        if (message.type === 'hello') {
          this.setStatus('Connection verified both ways. Ready when you are.');
          this.startButton.style.display = 'block';
        }
      },
    });
  }

  private startMatch(): void {
    if (!this.connection) return;
    const seed = generateMultiplayerSeed();
    const killLimit = Number(this.killLimitSelect.value);
    const [spawnA, spawnB] = pickMultiplayerSpawnPoints();
    this.connection.send({
      type: 'matchStart',
      seed,
      killLimit,
      spawnAX: spawnA.x,
      spawnAZ: spawnA.z,
      spawnBX: spawnB.x,
      spawnBZ: spawnB.z,
    });
    const connection = this.connection;
    // Ownership of the connection moves to the match now - `close()` must not dispose it, and this
    // screen shouldn't react to anything on it anymore (Game.create() takes over via setCallbacks).
    this.connection = null;
    this.overlay.style.display = 'none';
    this.onStartMatch(connection, { seed, killLimit, spawnA, spawnB });
  }

  private setStatus(text: string): void {
    this.statusText.textContent = text;
  }

  private close(): void {
    this.connection?.dispose();
    this.connection = null;
    this.overlay.style.display = 'none';
    this.onClose();
  }

  dispose(): void {
    this.connection?.dispose();
    this.overlay.remove();
  }
}
