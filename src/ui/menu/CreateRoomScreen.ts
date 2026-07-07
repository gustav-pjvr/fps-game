import { PeerConnection, generateRoomCode } from '../../network/PeerConnection.ts';
import { HostRoster } from '../../network/HostRoster.ts';
import { generateMultiplayerSeed } from '../../core/worldSeed.ts';
import { pickMultiplayerSpawnPoints } from '../../core/multiplayerSpawn.ts';
import type { MultiplayerMatchStartParams } from '../../network/MultiplayerSession.ts';
import { HOST_SLOT, type RosterEntry } from '../../network/protocol.ts';
import {
  DEFAULT_GOOSE_EXPLOSION_DIFFICULTY,
  DEFAULT_MULTIPLAYER_KILL_LIMIT,
  GOOSE_EXPLOSION_DIFFICULTIES,
  GOOSE_EXPLOSION_DIFFICULTY_LABELS,
  MULTIPLAYER_KILL_LIMIT_OPTIONS,
  MULTIPLAYER_MAX_PLAYERS,
  type GooseExplosionDifficulty,
} from '../../core/config.ts';
import { DEFAULT_GAME_MODE, GAME_MODES, GAME_MODE_LABELS, type GameMode } from '../../core/gameModes.ts';
import { loadStoredUsername, normalizeUsername, saveUsername } from '../../core/username.ts';
import { ACCENT, TEXT, HAIRLINE, BG_RAISED, MOTION_EASE, attachScanSweep, createButton, createOverlay, createPanel, createPanelTitle, createTextInput } from './menuStyles.ts';

/** One row of the host's live player list - `dimmed` marks an empty/placeholder slot not yet
 * taken by a real player. Exported for JoinRoomScreen's own lobby-wait roster, which renders the
 * exact same shape. */
export function createPlayerRow(text: string, dimmed = false): HTMLDivElement {
  const row = document.createElement('div');
  row.textContent = text;
  row.style.cssText = `font-size:0.95rem; padding:4px 0; ${dimmed ? 'opacity:0.55; font-style:italic;' : ''}`;
  return row;
}

/** Host side of the room-code flow: generates a code, shows it, waits for up to
 * MULTIPLAYER_MAX_PLAYERS - 1 guests to connect (each verified with a `hello`/`welcome`
 * exchange - see HostRoster.ts), then offers "Start Match" - clicking it picks the seed/kill
 * limit/one spawn point per connected player and hands the now-established connections off to
 * whoever's starting the actual match (see onStartMatch). The same HostRoster instance carries
 * forward into the match itself (see MultiplayerMatchStartParams.hostRoster) so mid-match
 * join/rejoin hello resolution keeps using the one roster/rejoin-token state machine for this
 * room's whole lifetime. */
export class CreateRoomScreen {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly usernameInput: HTMLInputElement;
  private readonly codeDisplay: HTMLDivElement;
  private readonly killLimitSelect: HTMLSelectElement;
  private readonly gooseDifficultySelect: HTMLSelectElement;
  private readonly gameModeSelect: HTMLSelectElement;
  private readonly statusText: HTMLDivElement;
  private readonly playerList: HTMLDivElement;
  private readonly startButton: HTMLButtonElement;
  private connection: PeerConnection | null = null;
  private hostRoster: HostRoster | null = null;
  private roomCode = '';
  /** Bumped by show()/close() - PeerConnection.hostRoom is async now (the TURN credential fetch),
   * so a Cancel click can land while a hostRoom() call is still in flight. Without this, that
   * in-flight call would resolve *after* close() and incorrectly resurrect `this.connection`,
   * leaking a PeerJS peer this screen no longer thinks it owns. */
  private showGeneration = 0;

  constructor(
    root: HTMLElement,
    private readonly onClose: () => void,
    private readonly onStartMatch: (connection: PeerConnection, params: MultiplayerMatchStartParams) => void,
  ) {
    this.overlay = createOverlay();

    const panel = createPanel();
    this.panel = panel;
    // Widened (not lengthened) from 400px per user request, so the goose-difficulty selector below
    // can sit side by side with the kill-limit selector instead of stacking and pushing the panel
    // taller (which would force scrolling on this already-tall room screen).
    panel.style.width = '480px';
    panel.appendChild(createPanelTitle('CREATE ROOM'));

    const usernameLabel = document.createElement('div');
    usernameLabel.textContent = 'Your name:';
    usernameLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:8px;';
    panel.appendChild(usernameLabel);

    this.usernameInput = createTextInput('Player name', 16);
    this.usernameInput.style.marginBottom = '16px';
    this.usernameInput.value = loadStoredUsername();
    // The room's own creation (show(), below) can't wait for the user to finish typing here - this
    // field is only ever visible for the first time as the room is created, so show() has to seed
    // HostRoster with whatever's in the box at that instant. Without this listener, typing a
    // different name right after clicking "Create Room" (the only time there's ever a reason to)
    // would silently have no effect - a real bug caught by an actual 4-player playtest, not a
    // hypothetical. Only touches the roster's *display* here; the normalized/saved value used for
    // future rooms is still resolved properly in show()/startMatch().
    this.usernameInput.addEventListener('input', () => {
      if (!this.hostRoster) return;
      this.hostRoster.updateHostUsername(this.usernameInput.value.trim() || 'Player');
      const roster = this.hostRoster.currentRoster();
      this.renderPlayerRows(roster);
      this.connection?.send({ type: 'rosterUpdate', roster });
    });
    panel.appendChild(this.usernameInput);

    const label = document.createElement('div');
    label.textContent = 'Share this code - up to 3 other players can join:';
    label.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:10px;';
    panel.appendChild(label);

    this.codeDisplay = document.createElement('div');
    this.codeDisplay.style.cssText =
      `font-size:2.2rem; font-weight:700; letter-spacing:0.3em; text-align:center; color:${ACCENT};` +
      ' padding:18px 0; background:rgba(255,255,255,0.05); border-radius:8px; margin-bottom:14px;' +
      ` font-variant-numeric:tabular-nums; box-shadow:0 0 0 rgba(62,207,95,0); transition:box-shadow 0.5s ${MOTION_EASE};`;
    panel.appendChild(this.codeDisplay);

    const copyButton = createButton('Copy Code');
    copyButton.style.width = '100%';
    copyButton.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.codeDisplay.textContent ?? '');
      // A quick glow confirms the copy actually happened - clicking a button that gives no
      // feedback at all reads as broken, especially for an action with no other visible result.
      this.codeDisplay.style.boxShadow = `0 0 24px 4px ${ACCENT}66`;
      setTimeout(() => {
        this.codeDisplay.style.boxShadow = '0 0 0 rgba(62,207,95,0)';
      }, 350);
    });
    panel.appendChild(copyButton);

    // Host-only settings: the guest never picks these, only receives them as part of
    // MatchStartMessage. Side by side (per user request: widen the panel to fit new settings
    // rather than stacking them and making the screen taller) - plain <select>s rather than a
    // dedicated RoomSettingsPanel file; promote it if match settings grow past these two.
    const settingsRow = document.createElement('div');
    settingsRow.style.cssText = 'display:flex; gap:14px; margin-top:16px;';

    const killLimitColumn = document.createElement('div');
    killLimitColumn.style.cssText = 'flex:1;';
    const killLimitLabel = document.createElement('div');
    killLimitLabel.textContent = 'First to how many kills wins?';
    killLimitLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:8px;';
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
    killLimitColumn.append(killLimitLabel, this.killLimitSelect);

    const gooseDifficultyColumn = document.createElement('div');
    gooseDifficultyColumn.style.cssText = 'flex:1;';
    const gooseDifficultyLabel = document.createElement('div');
    gooseDifficultyLabel.textContent = 'Goose explosions:';
    gooseDifficultyLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:8px;';
    this.gooseDifficultySelect = document.createElement('select');
    this.gooseDifficultySelect.style.cssText = this.killLimitSelect.style.cssText;
    for (const difficulty of GOOSE_EXPLOSION_DIFFICULTIES) {
      const optionElement = document.createElement('option');
      optionElement.value = difficulty;
      optionElement.textContent = GOOSE_EXPLOSION_DIFFICULTY_LABELS[difficulty];
      if (difficulty === DEFAULT_GOOSE_EXPLOSION_DIFFICULTY) optionElement.selected = true;
      this.gooseDifficultySelect.appendChild(optionElement);
    }
    gooseDifficultyColumn.append(gooseDifficultyLabel, this.gooseDifficultySelect);

    settingsRow.append(killLimitColumn, gooseDifficultyColumn);
    panel.appendChild(settingsRow);

    // Full-width row, not a third column - "1 Shot 1 Kill"/"Sniper Duel" labels are long enough
    // that cramming a third select into the same row as kill-limit/goose-explosions would read
    // cluttered at this panel width. Multiplayer-only, host-picked pre-match (per user request -
    // single-player never has a mode).
    const gameModeLabel = document.createElement('div');
    gameModeLabel.textContent = 'Game mode:';
    gameModeLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-top:16px; margin-bottom:8px;';
    panel.appendChild(gameModeLabel);
    this.gameModeSelect = document.createElement('select');
    this.gameModeSelect.style.cssText = this.killLimitSelect.style.cssText;
    for (const mode of GAME_MODES) {
      const optionElement = document.createElement('option');
      optionElement.value = mode;
      optionElement.textContent = GAME_MODE_LABELS[mode];
      if (mode === DEFAULT_GAME_MODE) optionElement.selected = true;
      this.gameModeSelect.appendChild(optionElement);
    }
    panel.appendChild(this.gameModeSelect);

    // Live player list (per user request): a real render loop over the current roster now, not
    // two fixed DOM rows - up to MULTIPLAYER_MAX_PLAYERS entries, re-rendered on every join/leave.
    const playerListLabel = document.createElement('div');
    playerListLabel.textContent = 'Players in this room:';
    playerListLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-top:16px; margin-bottom:8px;';
    panel.appendChild(playerListLabel);

    this.playerList = document.createElement('div');
    this.playerList.style.cssText =
      `background:${BG_RAISED}; border:1px solid ${HAIRLINE}; border-radius:8px; padding:10px 14px;`;
    panel.appendChild(this.playerList);

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
    attachScanSweep(this.panel);
    this.startButton.style.display = 'none';
    const hostUsername = normalizeUsername(this.usernameInput.value);
    this.usernameInput.value = hostUsername;
    saveUsername(hostUsername);
    this.hostRoster = new HostRoster(hostUsername);
    this.renderPlayerRows(this.hostRoster.currentRoster());

    this.roomCode = generateRoomCode();
    this.codeDisplay.textContent = this.roomCode;
    this.setStatus('Waiting for other players to join…');

    const generation = ++this.showGeneration;
    void PeerConnection.hostRoom(this.roomCode, {
      onConnected: () => {
        this.setStatus('Connection verified. Ready when you are.');
        this.startButton.style.display = 'block';
      },
      onPeerDisconnected: () => {
        if (!this.hostRoster) return;
        this.renderPlayerRows(this.hostRoster.currentRoster());
        this.connection?.send({ type: 'rosterUpdate', roster: this.hostRoster.currentRoster() });
      },
      onError: (message) => this.setStatus(message),
      onMessage: () => {}, // nothing else to react to before a match starts
      onHostHello: (username, rejoinToken) => {
        if (!this.hostRoster) return 'full';
        const outcome = this.hostRoster.handleHello(username, rejoinToken, performance.now());
        if (outcome.outcome === 'full') return 'full';

        const roster = this.hostRoster.currentRoster();
        this.renderPlayerRows(roster);
        // Broadcasts to whoever's already connected - this new guest isn't in the connection map
        // yet (added right after this callback returns), so it never receives its own join here.
        this.connection?.send({ type: 'rosterUpdate', roster });
        return { type: 'welcome', yourSlot: outcome.slot, isRejoin: outcome.outcome === 'rejoined', hostUsername, roster };
      },
    }).then((connection) => {
      // This screen moved on (closed, or reopened as a fresh attempt) while the TURN credential
      // fetch was still in flight - the just-created connection is now an orphan, not this
      // attempt's connection, and must be disposed rather than assigned.
      if (generation !== this.showGeneration) {
        connection.dispose();
        return;
      }
      this.connection = connection;
    }).catch((error: unknown) => {
      // Without this, any failure in the TURN-credential fetch or Peer construction above left
      // this screen stuck on "Waiting for other players to join…" forever with no error and no
      // way to retry short of a reload - a real, user-reported symptom. Surfacing it and
      // re-arming the flow (a fresh Create Room click just calls show() again) is a strictly
      // additive safety net regardless of what turns out to actually cause a given failure.
      if (generation !== this.showGeneration) return;
      this.setStatus(error instanceof Error ? error.message : 'Failed to create room - try again.');
    });
  }

  private renderPlayerRows(roster: RosterEntry[]): void {
    this.playerList.replaceChildren(
      ...roster.map((entry) => createPlayerRow(entry.slot === HOST_SLOT ? `${entry.username} (you, host)` : entry.username)),
      ...Array.from({ length: Math.max(0, MULTIPLAYER_MAX_PLAYERS - roster.length) }, () => createPlayerRow('Waiting for a player to join…', true)),
    );
  }

  private startMatch(): void {
    if (!this.connection || !this.hostRoster) return;
    this.hostRoster.startMatch();
    const roster = this.hostRoster.currentRoster();
    const seed = generateMultiplayerSeed();
    const killLimit = Number(this.killLimitSelect.value);
    const gooseDifficulty = this.gooseDifficultySelect.value as GooseExplosionDifficulty;
    const gameMode = this.gameModeSelect.value as GameMode;
    const points = pickMultiplayerSpawnPoints(roster.length);
    const spawns = roster.map((entry, i) => ({ slot: entry.slot, x: points[i]!.x, z: points[i]!.z }));
    this.connection.send({ type: 'matchStart', seed, killLimit, gooseDifficulty, gameMode, spawns, roster });

    const connection = this.connection;
    const hostRoster = this.hostRoster;
    // Ownership of the connection (and the HostRoster driving its hello resolution) moves to the
    // match now - `close()` must not dispose the connection, and this screen shouldn't react to
    // anything on it anymore (Game.create() takes over via setCallbacks).
    this.connection = null;
    this.hostRoster = null;
    this.overlay.style.display = 'none';
    this.onStartMatch(connection, {
      seed,
      killLimit,
      gooseDifficulty,
      gameMode,
      ownSlot: HOST_SLOT,
      spawns: spawns.map((s) => ({ slot: s.slot, point: { x: s.x, z: s.z } })),
      roster,
      roomCode: this.roomCode,
      initialScoreboard: [],
      hostRoster,
    });
  }

  private setStatus(text: string): void {
    this.statusText.textContent = text;
  }

  private close(): void {
    this.showGeneration++;
    this.connection?.dispose();
    this.connection = null;
    this.hostRoster = null;
    this.overlay.style.display = 'none';
    this.onClose();
  }

  dispose(): void {
    this.showGeneration++;
    this.connection?.dispose();
    this.overlay.remove();
  }
}
