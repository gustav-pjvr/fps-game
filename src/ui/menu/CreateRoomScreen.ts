import { PeerConnection, generateRoomCode } from '../../network/PeerConnection.ts';
import { HostRoster } from '../../network/HostRoster.ts';
import { generateMultiplayerSeed } from '../../core/worldSeed.ts';
import { pickMultiplayerSpawnPoints } from '../../core/multiplayerSpawn.ts';
import type { MultiplayerMatchStartParams } from '../../network/MultiplayerSession.ts';
import { HOST_SLOT, type PlayerSlot, type RosterEntry } from '../../network/protocol.ts';
import {
  DEFAULT_GOOSE_EXPLOSION_DIFFICULTY,
  DEFAULT_MATCH_WEATHER,
  DEFAULT_MULTIPLAYER_KILL_LIMIT,
  GOOSE_EXPLOSION_DIFFICULTIES,
  GOOSE_EXPLOSION_DIFFICULTY_LABELS,
  MATCH_WEATHER_LABELS,
  MATCH_WEATHERS,
  MULTIPLAYER_KILL_LIMIT_MAX,
  MULTIPLAYER_KILL_LIMIT_MIN,
  MULTIPLAYER_MAX_PLAYERS,
  type GooseExplosionDifficulty,
  type MatchWeather,
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
  private readonly killLimitInput: HTMLInputElement;
  private readonly gooseDifficultySelect: HTMLSelectElement;
  private readonly gameModeSelect: HTMLSelectElement;
  private readonly weatherSelect: HTMLSelectElement;
  private readonly statusText: HTMLDivElement;
  private readonly playerList: HTMLDivElement;
  private readonly startButton: HTMLButtonElement;
  private connection: PeerConnection | null = null;
  private hostRoster: HostRoster | null = null;
  private roomCode = '';
  /** Every slot the pre-match lobby currently considers ready (see PlayerReadyMessage/
   * LobbyReadyUpdateMessage in protocol.ts) - host-side authoritative, same "one owning side
   * aggregates and rebroadcasts" shape HostRoster's own roster already uses. The host's own slot is
   * always a member (see show()'s reset) - it auto-readies rather than needing its own click, since
   * the host is already the one who clicks Start Match. Reset fresh on every show() (a new room),
   * pruned on disconnect/reservation-expiry, and consulted by updateStartButtonState/
   * renderPlayerRows. */
  private readySlots = new Set<PlayerSlot>();
  /** Pre-match equivalent of Game.ts's own mid-match sweep - a disconnected guest's slot reservation
   * only actually frees up via `sweepExpiredReservations`, and nothing polled it while still in
   * this lobby (Game.ts's sweep doesn't start until a match exists), so a departed guest's grace
   * period could never expire and their slot stayed reserved (room permanently "full") until a
   * match was actually started. Cleared on close()/startMatch() - ownership of sweeping moves to
   * Game.ts's own loop from match start onward. */
  private reservationSweepInterval: ReturnType<typeof setInterval> | null = null;
  /** Bumped by show()/close() - PeerConnection.hostRoom is async now (the TURN credential fetch),
   * so a Cancel click can land while a hostRoom() call is still in flight. Without this, that
   * in-flight call would resolve *after* close() and incorrectly resurrect `this.connection`,
   * leaking a PeerJS peer this screen no longer thinks it owns. */
  private showGeneration = 0;
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(
    root: HTMLElement,
    private readonly onClose: () => void,
    private readonly onStartMatch: (connection: PeerConnection, params: MultiplayerMatchStartParams) => void,
  ) {
    this.overlay = createOverlay();

    const panel = createPanel();
    this.panel = panel;
    // Widened further (760px, was 480px) and split into two columns below (per user request: the
    // screen required scrolling to see everything, which they explicitly don't want) - settings on
    // the left, the live player list on the right, rather than stacking the player list underneath
    // everything else and pushing the panel past createPanel's 80vh scroll threshold.
    // `min(760px, 94vw)` (not a bare 760px) so this doesn't overflow the viewport horizontally on a
    // narrow window/small laptop screen - createPanel's own max-height:80vh + overflow-y:auto
    // already handles the vertical case, this is the matching horizontal clamp.
    panel.style.width = 'min(760px, 94vw)';
    panel.appendChild(createPanelTitle('CREATE ROOM'));

    const mainRow = document.createElement('div');
    // Wraps to a single stacked column below ~640px of actual panel width (see the 94vw clamp
    // above) rather than staying a fixed two-column row that would squeeze both columns into
    // unreadably narrow strips - min-width:280px on each column (below) is what triggers the wrap.
    mainRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:24px;';
    const leftColumn = document.createElement('div');
    leftColumn.style.cssText = 'flex:1.15; min-width:280px;';
    const rightColumn = document.createElement('div');
    // A flex column so the player list below can flex:1 and stretch to match the left column's
    // height (the row's default align-items:stretch already makes both columns equally tall).
    rightColumn.style.cssText = 'flex:1; min-width:280px; display:flex; flex-direction:column;';

    const usernameLabel = document.createElement('div');
    usernameLabel.textContent = 'Your name:';
    usernameLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:8px;';
    leftColumn.appendChild(usernameLabel);

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
    leftColumn.appendChild(this.usernameInput);

    const label = document.createElement('div');
    label.textContent = 'Share this code - up to 3 other players can join:';
    label.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:10px;';
    leftColumn.appendChild(label);

    this.codeDisplay = document.createElement('div');
    this.codeDisplay.style.cssText =
      `font-size:2.2rem; font-weight:700; letter-spacing:0.3em; text-align:center; color:${ACCENT};` +
      ' padding:18px 0; background:rgba(255,255,255,0.05); border-radius:8px; margin-bottom:14px;' +
      ` font-variant-numeric:tabular-nums; box-shadow:0 0 0 rgba(62,207,95,0); transition:box-shadow 0.5s ${MOTION_EASE};`;
    leftColumn.appendChild(this.codeDisplay);

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
    leftColumn.appendChild(copyButton);

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
    // min-height reserves 2 lines' worth of space regardless of actual wrap, so this label and
    // gooseDifficultyLabel below (1 line) both push their selects down by the same amount - without
    // it, this longer label wraps to 2 lines while the goose one stays on 1, leaving the two selects
    // misaligned.
    killLimitLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:8px; min-height:2.2em;';
    // A free-typed number instead of a fixed preset list (per user request) - host isn't limited
    // to 10/15/25 kills anymore.
    this.killLimitInput = document.createElement('input');
    this.killLimitInput.type = 'number';
    this.killLimitInput.min = String(MULTIPLAYER_KILL_LIMIT_MIN);
    this.killLimitInput.max = String(MULTIPLAYER_KILL_LIMIT_MAX);
    this.killLimitInput.step = '1';
    this.killLimitInput.value = String(DEFAULT_MULTIPLAYER_KILL_LIMIT);
    this.killLimitInput.style.cssText =
      `width:100%; box-sizing:border-box; padding:12px; font-size:1rem; font-weight:600; color:${TEXT};` +
      ` background:${BG_RAISED}; border:1px solid ${HAIRLINE}; border-radius:8px; color-scheme:dark;`;
    killLimitColumn.append(killLimitLabel, this.killLimitInput);

    const gooseDifficultyColumn = document.createElement('div');
    gooseDifficultyColumn.style.cssText = 'flex:1;';
    const gooseDifficultyLabel = document.createElement('div');
    gooseDifficultyLabel.textContent = 'Goose explosions:';
    gooseDifficultyLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:8px; min-height:2.2em;';
    this.gooseDifficultySelect = document.createElement('select');
    this.gooseDifficultySelect.style.cssText = this.killLimitInput.style.cssText + ' cursor:pointer;';
    for (const difficulty of GOOSE_EXPLOSION_DIFFICULTIES) {
      const optionElement = document.createElement('option');
      optionElement.value = difficulty;
      optionElement.textContent = GOOSE_EXPLOSION_DIFFICULTY_LABELS[difficulty];
      if (difficulty === DEFAULT_GOOSE_EXPLOSION_DIFFICULTY) optionElement.selected = true;
      this.gooseDifficultySelect.appendChild(optionElement);
    }
    gooseDifficultyColumn.append(gooseDifficultyLabel, this.gooseDifficultySelect);

    settingsRow.append(killLimitColumn, gooseDifficultyColumn);
    leftColumn.appendChild(settingsRow);

    // Full-width (within leftColumn), not a third column - "1 Shot 1 Kill"/"Sniper Duel" labels
    // are long enough that cramming a third select into the same row as kill-limit/goose-explosions
    // would read cluttered. Multiplayer-only, host-picked pre-match (per user request - single-
    // player never has a mode).
    const gameModeLabel = document.createElement('div');
    gameModeLabel.textContent = 'Game mode:';
    gameModeLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-top:16px; margin-bottom:8px;';
    leftColumn.appendChild(gameModeLabel);
    this.gameModeSelect = document.createElement('select');
    this.gameModeSelect.style.cssText = this.killLimitInput.style.cssText + ' cursor:pointer;';
    for (const mode of GAME_MODES) {
      const optionElement = document.createElement('option');
      optionElement.value = mode;
      optionElement.textContent = GAME_MODE_LABELS[mode];
      if (mode === DEFAULT_GAME_MODE) optionElement.selected = true;
      this.gameModeSelect.appendChild(optionElement);
    }
    leftColumn.appendChild(this.gameModeSelect);

    // Purely cosmetic/atmospheric - mirrors gameModeSelect's own full-width layout above it.
    const weatherLabel = document.createElement('div');
    weatherLabel.textContent = 'Match weather:';
    weatherLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-top:16px; margin-bottom:8px;';
    leftColumn.appendChild(weatherLabel);
    this.weatherSelect = document.createElement('select');
    this.weatherSelect.style.cssText = this.killLimitInput.style.cssText + ' cursor:pointer;';
    for (const weather of MATCH_WEATHERS) {
      const optionElement = document.createElement('option');
      optionElement.value = weather;
      optionElement.textContent = MATCH_WEATHER_LABELS[weather];
      if (weather === DEFAULT_MATCH_WEATHER) optionElement.selected = true;
      this.weatherSelect.appendChild(optionElement);
    }
    leftColumn.appendChild(this.weatherSelect);

    // Live player list (per user request): a real render loop over the current roster now, not
    // two fixed DOM rows - up to MULTIPLAYER_MAX_PLAYERS entries, re-rendered on every join/leave.
    // Lives in rightColumn, beside the settings rather than stacked beneath them (per user request:
    // the panel required scrolling to see everything - widening it and placing the player list to
    // the side keeps the whole screen visible without scrolling).
    const playerListLabel = document.createElement('div');
    playerListLabel.textContent = 'Players in this room:';
    playerListLabel.style.cssText = 'font-size:0.85rem; opacity:0.8; margin-bottom:8px;';
    rightColumn.appendChild(playerListLabel);

    this.playerList = document.createElement('div');
    this.playerList.style.cssText =
      `background:${BG_RAISED}; border:1px solid ${HAIRLINE}; border-radius:8px; padding:10px 14px; flex:1;`;
    rightColumn.appendChild(this.playerList);

    mainRow.append(leftColumn, rightColumn);
    panel.appendChild(mainRow);

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

    // Escape cancels - no single "Enter" default here (several text/number/select fields share the
    // form, none of them an obvious single submit target), so Enter is deliberately left to native
    // per-control activation only, same call as MultiplayerMenu.
    this.onKeyDown = (event) => {
      if (this.overlay.style.display === 'none') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    };
    document.addEventListener('keydown', this.onKeyDown);
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
    // The host auto-readies (see readySlots's own comment) - fresh for every new room, same as
    // hostRoster itself.
    this.readySlots = new Set([HOST_SLOT]);
    this.renderPlayerRows(this.hostRoster.currentRoster());
    this.updateStartButtonState();

    if (this.reservationSweepInterval !== null) clearInterval(this.reservationSweepInterval);
    this.reservationSweepInterval = setInterval(() => {
      if (!this.hostRoster || !this.connection) return;
      const expired = this.hostRoster.sweepExpiredReservations(performance.now());
      if (expired.length === 0) return;
      // A swept-away reservation's slot no longer exists in the roster at all - prune it from
      // readySlots too so the two stay in lockstep (harmless either way given
      // updateStartButtonState only ever checks readiness for slots still in the current roster,
      // but there's no reason to let a stale entry linger).
      for (const slot of expired) this.readySlots.delete(slot);
      this.renderPlayerRows(this.hostRoster.currentRoster());
      this.connection.send({ type: 'rosterUpdate', roster: this.hostRoster.currentRoster() });
      this.broadcastReadyState();
    }, 2000);

    this.roomCode = generateRoomCode();
    this.codeDisplay.textContent = this.roomCode;
    this.setStatus('Waiting for other players to join…');

    const generation = ++this.showGeneration;
    void PeerConnection.hostRoom(this.roomCode, {
      onConnected: () => {
        this.setStatus('Connection verified. Ready when you are.');
        this.startButton.style.display = 'block';
        this.updateStartButtonState();
        // The just-connected guest's own connection was only added to PeerConnection's map
        // immediately before this fires (see PeerConnection.attachIncomingGuestConnection), so a
        // broadcast here (unlike the one inside onHostHello below) actually reaches it - this is
        // how a newly joined guest learns who's already ready, including the host's own auto-ready.
        this.broadcastReadyState();
      },
      onPeerDisconnected: (slot) => {
        if (!this.hostRoster) return;
        // Without this, a guest who leaves the pre-match lobby was never actually marked
        // disconnected - `currentRoster()` kept listing them as `connected: true` forever, their
        // slot counted against MULTIPLAYER_MAX_PLAYERS permanently (never entering the grace-period
        // reservation path handleDisconnect starts), and enough join/leave cycles made the room
        // permanently report full. Confirmed bug, fixed in the 2026-07-10 review.
        this.hostRoster.handleDisconnect(slot, performance.now());
        // A departed guest's old readiness no longer means anything - without pruning this, a
        // guest who readied up and then disconnected would still count as ready while merely
        // reserved (grace period), and a rejoin must re-ready rather than silently inherit the old
        // state.
        this.readySlots.delete(slot);
        this.renderPlayerRows(this.hostRoster.currentRoster());
        this.connection?.send({ type: 'rosterUpdate', roster: this.hostRoster.currentRoster() });
        this.updateStartButtonState();
        this.broadcastReadyState();
      },
      onError: (message, kind) => {
        if (generation !== this.showGeneration) return;
        if (kind === 'brokerLost') {
          this.setStatus('Lost contact with the matchmaking server. Reconnecting so new players can still join…');
          return;
        }
        if (kind === 'networkBlocked') {
          // A guest's connection attempt failed its ICE negotiation. The room itself is fine, but the
          // raw PeerJS text ("Negotiation of connection to <uuid> failed.") told the host nothing.
          this.setStatus(
            "A player tried to join but couldn't connect through the network. Strict work, school or mobile networks can block peer-to-peer play; try a different network.",
          );
          return;
        }
        this.setStatus(message);
      },
      onBrokerReconnected: () => {
        if (generation !== this.showGeneration || !this.hostRoster) return;
        this.setStatus(this.hostRoster.currentRoster().length > 1 ? 'Connection verified. Ready when you are.' : 'Waiting for other players to join…');
      },
      onMessage: (message) => {
        if (message.type !== 'playerReady' || !this.hostRoster) return;
        // Self-reported - the sender's own message.slot, not a transport-level identity (the lobby
        // has no senderSlot concept like MatchMessageRouter's mid-match one, since every guest
        // connection is already keyed by slot at the PeerConnection layer - see onHostHello). No
        // adjudication needed, same trust model as everywhere else in this protocol: a guest can
        // only ever toggle its own readiness.
        if (message.ready) this.readySlots.add(message.slot);
        else this.readySlots.delete(message.slot);
        this.renderPlayerRows(this.hostRoster.currentRoster());
        this.updateStartButtonState();
        this.broadcastReadyState();
      },
      onHostHello: (username, rejoinToken) => {
        if (!this.hostRoster) return 'full';
        const outcome = this.hostRoster.handleHello(username, rejoinToken, performance.now());
        if (outcome.outcome === 'full') return 'full';
        // A rejoin may take over a slot whose stale connection was still marked ready. The player on
        // the new connection hasn't readied, so they must click Ready again.
        this.readySlots.delete(outcome.slot);

        const roster = this.hostRoster.currentRoster();
        this.renderPlayerRows(roster);
        // Broadcasts to whoever's already connected - this new guest isn't in the connection map
        // yet (added right after this callback returns), so it never receives its own join here
        // (same as the ready-state broadcast, deferred to onConnected above for the same reason).
        this.connection?.send({ type: 'rosterUpdate', roster });
        this.updateStartButtonState();
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
      ...roster.map((entry) => {
        const name = entry.slot === HOST_SLOT ? `${entry.username} (you, host)` : entry.username;
        const readyTag = this.readySlots.has(entry.slot) ? ' — ✓ Ready' : ' — Not Ready';
        return createPlayerRow(`${name}${readyTag}`);
      }),
      ...Array.from({ length: Math.max(0, MULTIPLAYER_MAX_PLAYERS - roster.length) }, () => createPlayerRow('Waiting for a player to join…', true)),
    );
  }

  /** Broadcasts the full current readySlots set to every already-connected guest - mirrors the
   * existing rosterUpdate broadcast shape exactly (host-authoritative, whole picture every time,
   * not a delta). Safe to call with no connection yet (a no-op via PeerConnection.send's own empty
   * loop over zero connections). */
  private broadcastReadyState(): void {
    this.connection?.send({ type: 'lobbyReadyUpdate', readySlots: Array.from(this.readySlots) });
  }

  /** Start Match only becomes clickable once every currently-connected slot (host included, via
   * its permanent auto-ready membership in readySlots) has readied up - per the Phase 8 roadmap's
   * own "every connected player" requirement. `roster.length > 0` guards the vacuous-truth case
   * (Array.prototype.every on an empty array is always true) - shouldn't be reachable in practice
   * since the host's own slot always exists, but this stays correct even if hostRoster's shape ever
   * changes. */
  private updateStartButtonState(): void {
    if (!this.hostRoster) return;
    // Connected slots only: a guest who left sits in a 90s rejoin reservation and can never click
    // Ready, which used to lock Start Match for that whole grace period.
    const roster = this.hostRoster.connectedRoster();
    const allReady = roster.length > 0 && roster.every((entry) => this.readySlots.has(entry.slot));
    this.startButton.disabled = !allReady;
  }

  private startMatch(): void {
    if (!this.connection || !this.hostRoster) return;
    // Defense in depth - the button itself is already disabled until every slot is ready (see
    // updateStartButtonState), so a disabled button's own click event never fires in a browser;
    // this just guards against any other future call path to this method.
    if (this.startButton.disabled) return;
    if (this.reservationSweepInterval !== null) {
      clearInterval(this.reservationSweepInterval);
      this.reservationSweepInterval = null;
    }
    this.hostRoster.startMatch();
    // Connected slots only (see HostRoster.connectedRoster): a reserved slot would otherwise get a
    // spawn point and a frozen ghost RemotePlayer on every client.
    const roster = this.hostRoster.connectedRoster();
    const seed = generateMultiplayerSeed();
    // min/max on the <input> only enforces on form submission, not on reading .value directly - a
    // cleared field, pasted text, or an out-of-range number all need clamping here too.
    const parsedKillLimit = Math.round(Number(this.killLimitInput.value));
    const killLimit = Number.isFinite(parsedKillLimit)
      ? Math.min(MULTIPLAYER_KILL_LIMIT_MAX, Math.max(MULTIPLAYER_KILL_LIMIT_MIN, parsedKillLimit))
      : DEFAULT_MULTIPLAYER_KILL_LIMIT;
    const gooseDifficulty = this.gooseDifficultySelect.value as GooseExplosionDifficulty;
    const gameMode = this.gameModeSelect.value as GameMode;
    const weather = this.weatherSelect.value as MatchWeather;
    const points = pickMultiplayerSpawnPoints(roster.length);
    const spawns = roster.map((entry, i) => ({ slot: entry.slot, x: points[i]!.x, z: points[i]!.z }));
    this.connection.send({ type: 'matchStart', seed, killLimit, gooseDifficulty, gameMode, weather, spawns, roster });

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
      weather,
      ownSlot: HOST_SLOT,
      spawns: spawns.map((s) => ({ slot: s.slot, point: { x: s.x, z: s.z } })),
      roster,
      roomCode: this.roomCode,
      initialScoreboard: [],
      hostRoster,
      showModeExplanation: true,
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
    if (this.reservationSweepInterval !== null) {
      clearInterval(this.reservationSweepInterval);
      this.reservationSweepInterval = null;
    }
    this.overlay.style.display = 'none';
    this.onClose();
  }

  dispose(): void {
    this.showGeneration++;
    this.connection?.dispose();
    if (this.reservationSweepInterval !== null) clearInterval(this.reservationSweepInterval);
    document.removeEventListener('keydown', this.onKeyDown);
    this.overlay.remove();
  }
}
