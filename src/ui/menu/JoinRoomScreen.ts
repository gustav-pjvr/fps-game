import { NETWORK_BLOCKED_MESSAGE, PeerConnection } from '../../network/PeerConnection.ts';
import type { MultiplayerMatchStartParams } from '../../network/MultiplayerSession.ts';
import type { PlayerSlot, RosterEntry } from '../../network/protocol.ts';
import { loadStoredUsername, normalizeUsername, saveUsername } from '../../core/username.ts';
import { getOrCreateRejoinToken } from '../../core/multiplayerRejoin.ts';
import { MULTIPLAYER_MAX_PLAYERS } from '../../core/config.ts';
import { createPlayerRow } from './CreateRoomScreen.ts';
import { ACCENT, TEXT, HAIRLINE, BG_RAISED, attachScanSweep, createButton, createOverlay, createPanel, createPanelTitle, createTextInput } from './menuStyles.ts';

/** How long a join attempt may go without the host's `welcome` before giving up. A healthy join
 * (including one relayed through TURN) completes in a few seconds. */
const JOIN_TIMEOUT_MS = 25_000;
const JOIN_TIMEOUT_MESSAGE =
  "Couldn't reach the host. Check the room is still open on their screen. If it is, one of your " +
  'networks is blocking peer-to-peer play, so try a different network (a phone hotspot usually works).';

/** Guest side of the room-code flow: type in a code someone gave you, connect, verify the
 * connection with a `hello`/`welcome` exchange (see HostRoster.ts), then wait on a live roster for
 * the host to start the match - the guest never picks the seed/kill limit itself, only receives
 * what the host generated (see MatchStartMessage in protocol.ts). A `hello` carrying this guest's
 * own rejoin token (see core/multiplayerRejoin.ts) also doubles as how a dropped player gets back
 * into a match already in progress - see the `welcome.activeMatch` branch below, which skips this
 * lobby-wait view entirely and jumps straight into the running match. */
export class JoinRoomScreen {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly usernameInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly statusText: HTMLDivElement;
  private readonly lobbyView: HTMLDivElement;
  private readonly playerList: HTMLDivElement;
  private readonly readyButton: HTMLButtonElement;
  private connection: PeerConnection | null = null;
  private ownSlot: PlayerSlot | null = null;
  /** This guest's own current readiness, toggled by the lobby's Ready button (see
   * PlayerReadyMessage) - reset false on every fresh attemptJoin(), same as ownSlot. */
  private ownReady = false;
  /** Mirrors the host's own authoritative readySlots (see LobbyReadyUpdateMessage) purely for
   * display - this client has no say over anyone else's readiness, it just renders whatever the
   * host last broadcast. */
  private readySlots = new Set<PlayerSlot>();
  /** The most recent roster this screen has seen (from `welcome` or `rosterUpdate`) - kept around
   * so a `lobbyReadyUpdate` arriving on its own (no roster change involved) can still re-render the
   * player list with fresh ready tags without needing its own copy of the roster bundled in. */
  private lastRoster: RosterEntry[] = [];
  /** Set when a `roomFull` message arrives - the host closes this connection shortly afterward
   * (see PeerConnection.ts's own comment on why that close is delayed, not immediate), which would
   * otherwise fire onPeerDisconnected and stomp the "room is full" status with a misleading "the
   * host disconnected" a moment later. Reset at the start of every fresh attempt. */
  private rejectedAsFull = false;
  /** Bumped by attemptJoin()/close() - PeerConnection.joinRoom is async now (the TURN credential
   * fetch), so a repeat Join click or a Cancel can land while an earlier joinRoom() call is still
   * in flight. Without this, that in-flight call would resolve *after* this screen moved on and
   * incorrectly resurrect `this.connection`, leaking a PeerJS peer this screen no longer owns. */
  private joinGeneration = 0;
  /** Gives up on an attempt that never received a `welcome`. Without it a guest whose network
   * blocked the peer-to-peer path sat on "Connecting…" with no explanation until ICE eventually
   * failed (or forever, if it never reported failure). */
  private joinTimeout: ReturnType<typeof setTimeout> | null = null;
  /** True once this attempt has already shown a specific failure reason, so the connection's own
   * follow-up 'close' doesn't overwrite it with a generic message. Reset per attempt. */
  private joinFailureShown = false;
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(
    root: HTMLElement,
    private readonly onClose: () => void,
    private readonly onStartMatch: (connection: PeerConnection, params: MultiplayerMatchStartParams) => void,
  ) {
    this.overlay = createOverlay();

    const panel = createPanel();
    this.panel = panel;
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

    // Shown once connected, in place of the code-entry step above, until the host starts the
    // match - didn't exist for 1v1 (a guest back then already knew there was exactly one other
    // player, the host, the moment the code worked), but with up to 3 other players a guest needs
    // to actually see who else has joined.
    this.lobbyView = document.createElement('div');
    this.lobbyView.style.cssText = 'display:none; margin-top:14px;';
    const lobbyLabel = document.createElement('div');
    lobbyLabel.textContent = 'Players in this room:';
    lobbyLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:8px;';
    this.playerList = document.createElement('div');
    this.playerList.style.cssText =
      `background:${BG_RAISED}; border:1px solid ${HAIRLINE}; border-radius:8px; padding:10px 14px;`;
    this.lobbyView.append(lobbyLabel, this.playerList);

    // "Start Match" only unlocks once every connected slot (this guest included) has clicked
    // Ready (see PlayerReadyMessage) - the host auto-readies itself, so guests are the only ones
    // who ever need to click this.
    this.readyButton = createButton('Ready', 'primary');
    this.readyButton.style.cssText += 'width:100%; margin-top:14px;';
    this.readyButton.addEventListener('click', () => {
      if (this.ownSlot === null || !this.connection) return;
      this.ownReady = !this.ownReady;
      this.connection.send({ type: 'playerReady', slot: this.ownSlot, ready: this.ownReady });
      this.refreshReadyButton();
    });
    this.lobbyView.appendChild(this.readyButton);
    panel.appendChild(this.lobbyView);

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

    // Escape cancels - the code input already has its own Enter-to-join listener above, so this
    // only adds the Escape half of "Enter/Escape handling on modals".
    this.onKeyDown = (event) => {
      if (this.overlay.style.display === 'none') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    };
    document.addEventListener('keydown', this.onKeyDown);
  }

  show(): void {
    this.overlay.style.display = 'flex';
    attachScanSweep(this.panel);
    this.codeInput.value = '';
    this.codeInput.style.display = 'block';
    this.joinButton.style.display = 'block';
    this.lobbyView.style.display = 'none';
    this.ownReady = false;
    this.readySlots = new Set();
    this.refreshReadyButton();
    this.setStatus('');
    this.codeInput.focus();
  }

  private renderPlayerRows(roster: RosterEntry[]): void {
    this.lastRoster = roster;
    this.playerList.replaceChildren(
      ...roster.map((entry) => {
        const name = entry.slot === this.ownSlot ? `${entry.username} (you)` : entry.username;
        const readyTag = this.readySlots.has(entry.slot) ? ' — ✓ Ready' : ' — Not Ready';
        return createPlayerRow(`${name}${readyTag}`);
      }),
      ...Array.from({ length: Math.max(0, MULTIPLAYER_MAX_PLAYERS - roster.length) }, () => createPlayerRow('Waiting for a player to join…', true)),
    );
  }

  /** Label reflects this guest's own toggled state - 'Ready' (unclicked) vs 'Not Ready' (already
   * clicked, click again to un-ready) - so the button communicates what clicking it again would do. */
  private refreshReadyButton(): void {
    this.readyButton.textContent = this.ownReady ? 'Not Ready' : 'Ready';
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
    this.connection = null;
    this.clearJoinTimeout();
    this.joinButton.disabled = true;
    this.setStatus('Connecting…');
    this.ownSlot = null;
    this.rejectedAsFull = false;
    this.joinFailureShown = false;
    this.ownReady = false;
    this.readySlots = new Set();
    this.refreshReadyButton();

    const username = normalizeUsername(this.usernameInput.value);
    this.usernameInput.value = username;
    saveUsername(username);
    const rejoinToken = getOrCreateRejoinToken(code);

    const generation = ++this.joinGeneration;
    this.joinTimeout = setTimeout(() => {
      this.joinTimeout = null;
      if (generation !== this.joinGeneration || this.ownSlot !== null || this.rejectedAsFull) return;
      // Invalidate this attempt before disposing, so the connection's own close/error events (which
      // the generation guards below now ignore) can't overwrite the explanation.
      this.joinGeneration++;
      this.connection?.dispose();
      this.connection = null;
      this.setStatus(JOIN_TIMEOUT_MESSAGE);
      this.joinButton.disabled = false;
    }, JOIN_TIMEOUT_MS);

    // Every callback is generation-guarded: a superseded attempt's connection still fires close/error
    // events after being disposed, which used to overwrite the current attempt's status text.
    void PeerConnection.joinRoom(code, username, rejoinToken, {
      onConnected: () => {}, // the welcome message itself (below) carries everything worth reacting to
      onPeerDisconnected: () => {
        if (generation !== this.joinGeneration) return;
        this.clearJoinTimeout();
        if (this.rejectedAsFull) return; // already showing the real reason - don't overwrite it
        if (this.ownSlot === null) {
          // Closed before any welcome ever arrived: the host never actually answered, so "the host
          // disconnected" was misleading. This is how a blocked network (ICE failure) ends.
          if (!this.joinFailureShown) this.setStatus(NETWORK_BLOCKED_MESSAGE);
          this.joinButton.disabled = false;
          return;
        }
        this.setStatus('The host disconnected.');
        this.joinButton.disabled = false;
        this.codeInput.style.display = 'block';
        this.joinButton.style.display = 'block';
        this.lobbyView.style.display = 'none';
      },
      onError: (message, kind) => {
        if (generation !== this.joinGeneration) return;
        // Already in the lobby: a dropped broker websocket doesn't affect the open data channel to
        // the host, so there's nothing to tell the player.
        if (kind === 'brokerLost' && this.ownSlot !== null) return;
        this.clearJoinTimeout();
        this.joinFailureShown = true;
        this.setStatus(message);
        this.joinButton.disabled = false;
      },
      onMessage: (message) => {
        if (generation !== this.joinGeneration) return;
        if (message.type === 'welcome') {
          this.clearJoinTimeout();
          this.ownSlot = message.yourSlot;
          if (message.activeMatch) {
            // A rejoin, or a brand new player joining after Start Match was already clicked -
            // either way there's no lobby to wait in, the match is already running.
            this.startMatch({
              seed: message.activeMatch.seed,
              killLimit: message.activeMatch.killLimit,
              gooseDifficulty: message.activeMatch.gooseDifficulty,
              gameMode: message.activeMatch.gameMode,
              weather: message.activeMatch.weather,
              ownSlot: message.yourSlot,
              spawns: [{ slot: message.yourSlot, point: message.activeMatch.spawnPoint }],
              roster: message.roster,
              roomCode: code,
              initialScoreboard: message.activeMatch.scoreboard,
              // A late join/rejoin drops straight into an already-live match - every other player
              // dismissed their own mode briefing long ago, so this client must never show one
              // (which would otherwise require them all to re-click Skip, re-freezing a match
              // that's already in progress for everyone else).
              showModeExplanation: false,
            });
            return;
          }
          this.codeInput.style.display = 'none';
          this.joinButton.style.display = 'none';
          this.lobbyView.style.display = 'block';
          this.renderPlayerRows(message.roster);
          this.setStatus(message.isRejoin ? 'Reconnected. Waiting for the host to start the match…' : 'Connected. Waiting for the host to start the match…');
        }
        if (message.type === 'rosterUpdate') this.renderPlayerRows(message.roster);
        if (message.type === 'lobbyReadyUpdate') {
          this.readySlots = new Set(message.readySlots);
          this.renderPlayerRows(this.lastRoster);
        }
        if (message.type === 'roomFull') {
          this.rejectedAsFull = true;
          this.setStatus('That room is full (4 players max).');
          this.joinButton.disabled = false;
        }
        if (message.type === 'matchStart') {
          this.startMatch({
            seed: message.seed,
            killLimit: message.killLimit,
            gooseDifficulty: message.gooseDifficulty,
            gameMode: message.gameMode,
            weather: message.weather,
            ownSlot: this.ownSlot ?? 0,
            spawns: message.spawns.map((s) => ({ slot: s.slot, point: { x: s.x, z: s.z } })),
            roster: message.roster,
            roomCode: code,
            initialScoreboard: [],
            showModeExplanation: true,
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
    }).catch((error: unknown) => {
      // Without this, any failure in the TURN-credential fetch or Peer construction above left
      // this screen stuck on "Connecting…" forever with no error and no way to retry short of a
      // reload - a real, user-reported symptom. Surfacing it and re-enabling the Join button is a
      // strictly additive safety net regardless of what turns out to actually cause a given failure.
      if (generation !== this.joinGeneration) return;
      this.clearJoinTimeout();
      this.setStatus(error instanceof Error ? error.message : 'Failed to join room - try again.');
      this.joinButton.disabled = false;
    });
  }

  private clearJoinTimeout(): void {
    if (this.joinTimeout === null) return;
    clearTimeout(this.joinTimeout);
    this.joinTimeout = null;
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
    this.clearJoinTimeout();
    this.connection?.dispose();
    this.connection = null;
    this.joinButton.disabled = false;
    this.overlay.style.display = 'none';
    this.onClose();
  }

  dispose(): void {
    this.joinGeneration++;
    this.clearJoinTimeout();
    this.connection?.dispose();
    document.removeEventListener('keydown', this.onKeyDown);
    this.overlay.remove();
  }
}
