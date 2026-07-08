import { createButton, ACCENT, TEXT, HAIRLINE, BG_RAISED, DISPLAY_FONT } from './menu/menuStyles.ts';
import {
  DEFAULT_MULTIPLAYER_KILL_LIMIT,
  GOOSE_EXPLOSION_DIFFICULTIES,
  GOOSE_EXPLOSION_DIFFICULTY_LABELS,
  MULTIPLAYER_KILL_LIMIT_OPTIONS,
  MULTIPLAYER_MAX_PLAYERS,
  type GooseExplosionDifficulty,
} from '../core/config.ts';
import type { PeerConnection } from '../network/PeerConnection.ts';
import type { MultiplayerRole } from '../network/MultiplayerSession.ts';
import type { PlayerSlot } from '../network/protocol.ts';
import { DEFAULT_GAME_MODE, GAME_MODES, GAME_MODE_LABELS, type GameMode } from '../core/gameModes.ts';
import { MOTION_EASE, attachScanSweep } from './menu/menuStyles.ts';

export type MultiplayerMatchEndReason = 'killLimit' | 'opponentDisconnected';

export interface MultiplayerPlacement {
  slot: PlayerSlot;
  username: string;
  score: number;
  isYou: boolean;
}

/** Everything App needs to show the right screen and, if the host chooses to, start a rematch on
 * the same still-open connections. `placements` is the full ranked scoreboard (up to
 * MULTIPLAYER_MAX_PLAYERS entries, sorted descending by score) rather than a fixed my/opponent
 * pair, since a 3-4 player FFA has no single "opponent." */
export interface MultiplayerMatchEndResult {
  reason: MultiplayerMatchEndReason;
  won: boolean;
  placements: MultiplayerPlacement[];
  killLimit: number;
  gooseDifficulty: GooseExplosionDifficulty;
  gameMode: GameMode;
  role: MultiplayerRole;
  connection: PeerConnection;
}

/** What the host actually chose before clicking Rematch - App.handleRematchClick uses this instead
 * of blindly reusing the just-finished match's own settings, per user request ("host rematch/
 * settings options: kill target, new map toggle"). Per a later request, the goose explosion
 * difficulty (see CreateRoomScreen's own selector) is editable here too, not just at initial room
 * creation. */
export interface RematchSettings {
  killLimit: number;
  gooseDifficulty: GooseExplosionDifficulty;
  gameMode: GameMode;
  /** true generates a fresh world seed (same as the original "always randomize" behavior); false
   * reuses the map both players just fought on, for a direct rematch on the same terrain. */
  newMap: boolean;
}

/** Shown by App (not Game) once a multiplayer match ends, so it survives the Game teardown/
 * recreate cycle a rematch needs (see App.restartMultiplayerMatch) - unlike DeathScreen, which is
 * per-match HUD chrome that's fine to dispose along with the rest of Game.
 *
 * Only the host ever sees the Rematch button (and the settings next to it) - every guest waits on
 * this same screen for the host to either rematch, change settings, or leave (per user request),
 * mirroring how only the host clicks "Start Match" in the first place. Guests are instead swept
 * along automatically: the host's Rematch click sends a fresh MatchStartMessage over the same
 * connections, and Game.ts's onMessage handler treats that as the signal to restart on the
 * guest's side too (see onMultiplayerRematchReceived). */
export class MatchEndScreen {
  private readonly element: HTMLDivElement;
  private readonly titleElement: HTMLDivElement;
  private readonly podium: HTMLDivElement;
  private readonly podiumRows: PodiumRow[];
  private readonly hostSettings: HTMLDivElement;
  private readonly killLimitSelect: HTMLSelectElement;
  private readonly gooseDifficultySelect: HTMLSelectElement;
  private readonly gameModeSelect: HTMLSelectElement;
  private readonly newMapCheckbox: HTMLInputElement;
  private readonly rematchButton: HTMLButtonElement;

  constructor(root: HTMLElement, onRematchClick: (settings: RematchSettings) => void, onReturnToLobbyClick: () => void) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'match-end-screen';
    this.element.style.cssText =
      'position:absolute; inset:0; display:none; align-items:center; justify-content:center;' +
      ' flex-direction:column; gap:18px; background:rgba(6,7,9,0.82); color:#fff;' +
      ` font-family:${DISPLAY_FONT}, system-ui, sans-serif; z-index:25; pointer-events:auto;`;

    this.titleElement = document.createElement('div');
    this.titleElement.style.cssText = 'font-size:2.5rem; font-weight:700; letter-spacing:0.12em; text-shadow:0 4px 20px rgba(0,0,0,0.6);';

    // Ranked podium (up to MULTIPLAYER_MAX_PLAYERS rows) rather than a plain "You N - M Opponent"
    // line, per user request - real usernames plus a clear rank/medal read faster than parsing a
    // score string. Pre-created and shown/hidden by row count each time, rather than built fresh
    // per match end - matches the "toggle display on fixed DOM" pattern already used elsewhere in
    // this file (see the host settings panel below).
    this.podium = document.createElement('div');
    this.podium.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:420px;';
    this.podiumRows = Array.from({ length: MULTIPLAYER_MAX_PLAYERS }, () => createPodiumRow());
    this.podium.append(...this.podiumRows.map((row) => row.row));

    // Host-only rematch settings (per user request: "kill target, new map toggle", later extended
    // to also cover goose explosion difficulty) - never shown to a guest, mirroring how only the
    // host ever picks these in CreateRoomScreen. Kill limit and goose difficulty sit side by side
    // (per user request: widen this panel to fit new settings rather than making it taller).
    this.hostSettings = document.createElement('div');
    this.hostSettings.style.cssText =
      `display:flex; flex-direction:column; gap:10px; width:420px; padding:16px 18px;` +
      ` background:${BG_RAISED}; border:1px solid ${HAIRLINE}; border-radius:8px;`;

    const settingsRow = document.createElement('div');
    settingsRow.style.cssText = 'display:flex; gap:14px;';

    const killLimitColumn = document.createElement('div');
    killLimitColumn.style.cssText = 'flex:1;';
    const killLimitLabel = document.createElement('div');
    killLimitLabel.textContent = 'First to how many kills wins?';
    // min-height reserves 2 lines regardless of actual wrap - see CreateRoomScreen.ts's identical
    // fix for why (this label wraps to 2 lines while gooseDifficultyLabel stays on 1, misaligning
    // the two selects without it).
    killLimitLabel.style.cssText = 'font-size:0.8rem; opacity:0.8; margin-bottom:6px; min-height:2.1em;';
    this.killLimitSelect = document.createElement('select');
    this.killLimitSelect.style.cssText =
      `width:100%; box-sizing:border-box; padding:10px; font-size:0.95rem; font-weight:600; color:${TEXT};` +
      ` background:rgba(255,255,255,0.08); border:1px solid ${HAIRLINE}; border-radius:6px; cursor:pointer;` +
      // See CreateRoomScreen.ts's identical select styling for why this is needed - without it the
      // native dropdown popup ignores the dark theme above and renders illegible light-on-light text.
      ' color-scheme:dark;';
    for (const option of MULTIPLAYER_KILL_LIMIT_OPTIONS) {
      const optionElement = document.createElement('option');
      optionElement.value = String(option);
      optionElement.textContent = `${option} kills`;
      this.killLimitSelect.appendChild(optionElement);
    }
    killLimitColumn.append(killLimitLabel, this.killLimitSelect);

    const gooseDifficultyColumn = document.createElement('div');
    gooseDifficultyColumn.style.cssText = 'flex:1;';
    const gooseDifficultyLabel = document.createElement('div');
    gooseDifficultyLabel.textContent = 'Goose explosions:';
    gooseDifficultyLabel.style.cssText = 'font-size:0.8rem; opacity:0.8; margin-bottom:6px; min-height:2.1em;';
    this.gooseDifficultySelect = document.createElement('select');
    this.gooseDifficultySelect.style.cssText = this.killLimitSelect.style.cssText;
    for (const difficulty of GOOSE_EXPLOSION_DIFFICULTIES) {
      const optionElement = document.createElement('option');
      optionElement.value = difficulty;
      optionElement.textContent = GOOSE_EXPLOSION_DIFFICULTY_LABELS[difficulty];
      this.gooseDifficultySelect.appendChild(optionElement);
    }
    gooseDifficultyColumn.append(gooseDifficultyLabel, this.gooseDifficultySelect);

    settingsRow.append(killLimitColumn, gooseDifficultyColumn);

    // Full-width, not a third column in settingsRow - see CreateRoomScreen's identical choice for
    // why (the mode labels are long enough to read cluttered crammed into a third column here).
    const gameModeLabel = document.createElement('div');
    gameModeLabel.textContent = 'Game mode:';
    gameModeLabel.style.cssText = 'font-size:0.8rem; opacity:0.8; margin-bottom:6px;';
    this.gameModeSelect = document.createElement('select');
    this.gameModeSelect.style.cssText = this.killLimitSelect.style.cssText;
    for (const mode of GAME_MODES) {
      const optionElement = document.createElement('option');
      optionElement.value = mode;
      optionElement.textContent = GAME_MODE_LABELS[mode];
      if (mode === DEFAULT_GAME_MODE) optionElement.selected = true;
      this.gameModeSelect.appendChild(optionElement);
    }

    const newMapLabel = document.createElement('label');
    newMapLabel.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;';
    this.newMapCheckbox = document.createElement('input');
    this.newMapCheckbox.type = 'checkbox';
    this.newMapCheckbox.checked = true;
    const newMapText = document.createElement('span');
    newMapText.textContent = 'Generate a new map';
    newMapLabel.append(this.newMapCheckbox, newMapText);

    this.hostSettings.append(settingsRow, gameModeLabel, this.gameModeSelect, newMapLabel);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex; gap:12px; margin-top:4px;';

    this.rematchButton = createButton('Rematch', 'primary');
    this.rematchButton.addEventListener('click', () =>
      onRematchClick({
        killLimit: Number(this.killLimitSelect.value),
        gooseDifficulty: this.gooseDifficultySelect.value as GooseExplosionDifficulty,
        gameMode: this.gameModeSelect.value as GameMode,
        newMap: this.newMapCheckbox.checked,
      }),
    );

    const lobbyButton = createButton('Return to Lobby');
    lobbyButton.addEventListener('click', onReturnToLobbyClick);

    buttonRow.append(this.rematchButton, lobbyButton);
    this.element.append(this.titleElement, this.podium, this.hostSettings, buttonRow);
    root.appendChild(this.element);
  }

  show(result: MultiplayerMatchEndResult): void {
    this.titleElement.textContent =
      result.reason === 'opponentDisconnected' ? 'OPPONENT DISCONNECTED' : result.won ? 'VICTORY' : 'DEFEAT';
    // Re-triggers every show(), not just the first - this is the one moment in the whole app
    // that most deserves an emphasized entrance (the match's actual outcome), so it gets its own
    // small extra beat beyond the shared scan-sweep below. Reflow trick (see multiplayerHud's hit
    // flash) so a second match-end while an earlier animation is still technically "the same"
    // restarts it instead of no-opping.
    this.titleElement.style.animation = 'none';
    void this.titleElement.offsetWidth;
    this.titleElement.style.animation = `titleReveal 0.6s ${MOTION_EASE} both`;

    const ranked = [...result.placements].sort((a, b) => b.score - a.score);
    ranked.forEach((entry, index) => {
      const row = this.podiumRows[index];
      if (!row) return; // more placements than podium rows shouldn't happen at MULTIPLAYER_MAX_PLAYERS, defensive
      setPodiumRow(row, index + 1, entry);
      row.row.style.display = 'flex';
      // Staggered, not simultaneous - reads as the podium filling in rank by rank rather than the
      // whole list appearing at once.
      row.row.style.animation = 'none';
      void row.row.offsetWidth;
      row.row.style.animation = `rowSlideIn 0.3s ${MOTION_EASE} ${150 + index * 90}ms both`;
    });
    for (let i = ranked.length; i < this.podiumRows.length; i++) this.podiumRows[i]!.row.style.display = 'none';

    // A disconnect means the connection this rematch would need is already gone; only the host
    // ever gets to choose, so a guest never sees these regardless of reason.
    const canRematch = result.reason === 'killLimit' && result.role === 'host';
    this.rematchButton.style.display = canRematch ? 'inline-block' : 'none';
    this.hostSettings.style.display = canRematch ? 'flex' : 'none';
    if (canRematch) {
      this.killLimitSelect.value = String(result.killLimit);
      if (!this.killLimitSelect.value) this.killLimitSelect.value = String(DEFAULT_MULTIPLAYER_KILL_LIMIT);
      this.gooseDifficultySelect.value = result.gooseDifficulty;
      this.gameModeSelect.value = result.gameMode;
    }

    this.element.style.display = 'flex';
    attachScanSweep(this.element);
  }

  hide(): void {
    this.element.style.display = 'none';
  }

  dispose(): void {
    this.element.remove();
  }
}

interface PodiumRow {
  readonly row: HTMLDivElement;
  readonly rankElement: HTMLDivElement;
  readonly nameElement: HTMLDivElement;
  readonly scoreElement: HTMLDivElement;
}

function createPodiumRow(): PodiumRow {
  const row = document.createElement('div');
  row.style.cssText =
    'display:flex; align-items:center; gap:14px; padding:12px 18px; border-radius:8px;' +
    ' background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);';

  const rankElement = document.createElement('div');
  rankElement.style.cssText = 'font-size:1.4rem; font-weight:700; width:28px; text-align:center;';

  const nameElement = document.createElement('div');
  nameElement.style.cssText = 'flex:1; font-size:1.05rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';

  const scoreElement = document.createElement('div');
  scoreElement.style.cssText = 'font-size:1.2rem; font-weight:700; font-variant-numeric:tabular-nums;';

  row.append(rankElement, nameElement, scoreElement);
  return { row, rankElement, nameElement, scoreElement };
}

const RANK_MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function setPodiumRow(row: PodiumRow, rank: number, entry: { username: string; score: number; isYou: boolean }): void {
  row.rankElement.textContent = RANK_MEDALS[rank] ?? `${rank}th`;
  row.nameElement.textContent = entry.isYou ? `${entry.username} (you)` : entry.username;
  row.scoreElement.textContent = String(entry.score);
  row.row.style.borderColor = rank === 1 ? ACCENT : 'rgba(255,255,255,0.1)';
  row.row.style.background = rank === 1 ? 'rgba(62,207,95,0.12)' : 'rgba(255,255,255,0.05)';
}
