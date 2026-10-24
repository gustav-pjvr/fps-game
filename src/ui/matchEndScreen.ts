import { MONO_FONT, LABEL_CSS, INK, SURFACE_RAISED, SURFACE } from './theme.ts';
import { createButton, ACCENT, TEXT, HAIRLINE, DISPLAY_FONT } from './menu/menuStyles.ts';
import {
  DEFAULT_MULTIPLAYER_KILL_LIMIT,
  DEFAULT_MATCH_MAP,
  GOOSE_EXPLOSION_DIFFICULTIES,
  GOOSE_EXPLOSION_DIFFICULTY_LABELS,
  MATCH_WEATHER_LABELS,
  MATCH_WEATHERS,
  MULTIPLAYER_KILL_LIMIT_MAX,
  MULTIPLAYER_KILL_LIMIT_MIN,
  MULTIPLAYER_MAX_PLAYERS,
  type GooseExplosionDifficulty,
  type MatchMap,
  type MatchWeather,
} from '../core/config.ts';
import type { PeerConnection } from '../network/PeerConnection.ts';
import type { MultiplayerRole } from '../network/MultiplayerSession.ts';
import type { PlayerSlot } from '../network/protocol.ts';
import { DEFAULT_GAME_MODE, GAME_MODES, GAME_MODE_LABELS, isModeAllowedOnMap, type GameMode } from '../core/gameModes.ts';
import { attachScanSweep } from './menu/menuStyles.ts';

/** 'hordeCleared'/'hordeWipe' are Goose Horde's own win/loss reasons - previously both reused
 * 'killLimit', which is semantically wrong for a co-op mode with no kill limit at all and would
 * mislabel any reason-specific copy. Fixed in the 2026-07-10 review. */
export type MultiplayerMatchEndReason = 'killLimit' | 'opponentDisconnected' | 'hordeCleared' | 'hordeWipe';

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
  weather: MatchWeather;
  map: MatchMap;
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
  weather: MatchWeather;
  map: MatchMap;
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
  private readonly killLimitInput: HTMLInputElement;
  private readonly gooseDifficultySelect: HTMLSelectElement;
  private readonly gameModeSelect: HTMLSelectElement;
  private readonly weatherSelect: HTMLSelectElement;
  private readonly weatherLabel: HTMLDivElement;
  private map: MatchMap = DEFAULT_MATCH_MAP;
  private readonly newMapCheckbox: HTMLInputElement;
  private readonly rematchButton: HTMLButtonElement;

  constructor(root: HTMLElement, onRematchClick: (settings: RematchSettings) => void, onReturnToLobbyClick: () => void) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'match-end-screen';
    this.element.className = 'menu-surface';
    this.element.style.cssText =
      'position:absolute; inset:0; display:none; align-items:center; justify-content:center;' +
      ` flex-direction:column; gap:18px; background:${SURFACE}; backdrop-filter:blur(10px); color:${INK};` +
      ` font-family:${DISPLAY_FONT}; z-index:25; pointer-events:auto;`;

    this.titleElement = document.createElement('div');
    this.titleElement.className = 'menu-panel-title';
    this.titleElement.style.cssText = 'font-size:2.5rem; font-weight:300; letter-spacing:-0.01em;';

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
      ` background:${SURFACE}; backdrop-filter:blur(10px); border:1px solid ${HAIRLINE}; border-radius:2px;`;

    const settingsRow = document.createElement('div');
    settingsRow.style.cssText = 'display:flex; gap:14px;';

    const killLimitColumn = document.createElement('div');
    killLimitColumn.style.cssText = 'flex:1;';
    const killLimitLabel = document.createElement('div');
    killLimitLabel.textContent = 'Kills to win';
    // min-height reserves 2 lines regardless of actual wrap - see CreateRoomScreen.ts's identical
    // fix for why (this label wraps to 2 lines while gooseDifficultyLabel stays on 1, misaligning
    // the two selects without it).
    killLimitLabel.style.cssText = `${LABEL_CSS} margin-bottom:6px; min-height:2.1em;`;
    // A free-typed number instead of a fixed preset list (per user request) - host isn't limited
    // to 10/15/25 kills anymore, same change as CreateRoomScreen.ts's kill-limit field.
    this.killLimitInput = document.createElement('input');
    this.killLimitInput.type = 'number';
    this.killLimitInput.min = String(MULTIPLAYER_KILL_LIMIT_MIN);
    this.killLimitInput.max = String(MULTIPLAYER_KILL_LIMIT_MAX);
    this.killLimitInput.step = '1';
    this.killLimitInput.value = String(DEFAULT_MULTIPLAYER_KILL_LIMIT);
    this.killLimitInput.style.cssText =
      `width:100%; box-sizing:border-box; padding:10px; font-size:0.95rem; font-weight:600; color:${TEXT};` +
      ` background:${SURFACE_RAISED}; border:1px solid ${HAIRLINE}; border-radius:2px; color-scheme:dark;`;
    killLimitColumn.append(killLimitLabel, this.killLimitInput);

    const gooseDifficultyColumn = document.createElement('div');
    gooseDifficultyColumn.style.cssText = 'flex:1;';
    const gooseDifficultyLabel = document.createElement('div');
    gooseDifficultyLabel.textContent = 'Goose explosions';
    gooseDifficultyLabel.style.cssText = `${LABEL_CSS} margin-bottom:6px; min-height:2.1em;`;
    this.gooseDifficultySelect = document.createElement('select');
    this.gooseDifficultySelect.style.cssText = this.killLimitInput.style.cssText + ' cursor:pointer;';
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
    gameModeLabel.textContent = 'Mode';
    gameModeLabel.style.cssText = `${LABEL_CSS} margin-bottom:6px;`;
    this.gameModeSelect = document.createElement('select');
    this.gameModeSelect.style.cssText = this.killLimitInput.style.cssText + ' cursor:pointer;';
    for (const mode of GAME_MODES) {
      const optionElement = document.createElement('option');
      optionElement.value = mode;
      optionElement.textContent = GAME_MODE_LABELS[mode];
      if (mode === DEFAULT_GAME_MODE) optionElement.selected = true;
      this.gameModeSelect.appendChild(optionElement);
    }

    const weatherLabel = document.createElement('div');
    this.weatherLabel = weatherLabel;
    weatherLabel.textContent = 'Weather';
    weatherLabel.style.cssText = `${LABEL_CSS} margin-bottom:6px;`;
    this.weatherSelect = document.createElement('select');
    this.weatherSelect.style.cssText = this.killLimitInput.style.cssText + ' cursor:pointer;';
    for (const weather of MATCH_WEATHERS) {
      const optionElement = document.createElement('option');
      optionElement.value = weather;
      optionElement.textContent = MATCH_WEATHER_LABELS[weather];
      this.weatherSelect.appendChild(optionElement);
    }

    this.killLimitInput.style.fontFamily = MONO_FONT;

    const newMapLabel = document.createElement('label');
    newMapLabel.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;';
    this.newMapCheckbox = document.createElement('input');
    this.newMapCheckbox.type = 'checkbox';
    this.newMapCheckbox.checked = true;
    const newMapText = document.createElement('span');
    newMapText.textContent = 'New map';
    newMapLabel.append(this.newMapCheckbox, newMapText);

    this.hostSettings.append(settingsRow, gameModeLabel, this.gameModeSelect, weatherLabel, this.weatherSelect, newMapLabel);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex; gap:12px; margin-top:4px;';

    this.rematchButton = createButton('Rematch', 'primary');
    this.rematchButton.addEventListener('click', () => {
      // Same clamping as CreateRoomScreen.ts's kill-limit field - min/max on the <input> only
      // enforces on form submission, not on reading .value directly.
      const parsedKillLimit = Math.round(Number(this.killLimitInput.value));
      const killLimit = Number.isFinite(parsedKillLimit)
        ? Math.min(MULTIPLAYER_KILL_LIMIT_MAX, Math.max(MULTIPLAYER_KILL_LIMIT_MIN, parsedKillLimit))
        : DEFAULT_MULTIPLAYER_KILL_LIMIT;
      onRematchClick({
        killLimit,
        gooseDifficulty: this.gooseDifficultySelect.value as GooseExplosionDifficulty,
        gameMode: this.gameModeSelect.value as GameMode,
        weather: this.weatherSelect.value as MatchWeather,
        map: this.map,
        newMap: this.newMapCheckbox.checked,
      });
    });

    const lobbyButton = createButton('Return to Lobby');
    lobbyButton.addEventListener('click', onReturnToLobbyClick);

    buttonRow.append(this.rematchButton, lobbyButton);
    this.element.append(this.titleElement, this.podium, this.hostSettings, buttonRow);
    root.appendChild(this.element);
  }

  show(result: MultiplayerMatchEndResult): void {
    this.titleElement.textContent =
      result.reason === 'opponentDisconnected'
        ? 'OPPONENT DISCONNECTED'
        : result.reason === 'hordeWipe'
          ? 'THE HORDE WINS'
          : result.won
            ? 'VICTORY'
            : 'DEFEAT';

    const ranked = [...result.placements].sort((a, b) => b.score - a.score);
    ranked.forEach((entry, index) => {
      const row = this.podiumRows[index];
      if (!row) return; // more placements than podium rows shouldn't happen at MULTIPLAYER_MAX_PLAYERS, defensive
      setPodiumRow(row, index + 1, entry);
      row.row.style.display = 'flex';
    });
    for (let i = ranked.length; i < this.podiumRows.length; i++) this.podiumRows[i]!.row.style.display = 'none';

    // A disconnect means the connection this rematch would need is already gone; only the host
    // ever gets to choose, so a guest never sees these regardless of reason.
    const canRematch =
      (result.reason === 'killLimit' || result.reason === 'hordeCleared' || result.reason === 'hordeWipe') && result.role === 'host';
    this.rematchButton.style.display = canRematch ? 'inline-block' : 'none';
    this.hostSettings.style.display = canRematch ? 'flex' : 'none';
    if (canRematch) {
      this.killLimitInput.value = String(result.killLimit);
      if (!this.killLimitInput.value) this.killLimitInput.value = String(DEFAULT_MULTIPLAYER_KILL_LIMIT);
      this.gooseDifficultySelect.value = result.gooseDifficulty;
      this.gameModeSelect.value = result.gameMode;
      this.weatherSelect.value = result.weather;
      this.map = result.map;
      this.weatherSelect.disabled = this.map === 'facility';
      this.weatherLabel.textContent = this.map === 'facility' ? 'Indoor' : 'Weather';
      for (const option of this.gameModeSelect.options) {
        const mode = option.value as GameMode;
        option.disabled = !isModeAllowedOnMap(mode, this.map);
        option.textContent = GAME_MODE_LABELS[mode] + (option.disabled ? ' (Valley only)' : '');
      }
      if (!isModeAllowedOnMap(result.gameMode, this.map)) this.gameModeSelect.value = DEFAULT_GAME_MODE;
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
    'display:flex; align-items:center; gap:14px; padding:12px 18px; border-radius:2px;' +
    ` background:${SURFACE_RAISED}; border:1px solid ${HAIRLINE};`;

  const rankElement = document.createElement('div');
  rankElement.style.cssText = 'font-size:1.4rem; font-weight:300; width:28px; text-align:center;';

  const nameElement = document.createElement('div');
  nameElement.style.cssText = 'flex:1; font-size:1.05rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';

  const scoreElement = document.createElement('div');
  scoreElement.style.cssText = `font-family:${MONO_FONT}; font-size:1.2rem; font-weight:400; font-variant-numeric:tabular-nums;`;

  row.append(rankElement, nameElement, scoreElement);
  return { row, rankElement, nameElement, scoreElement };
}

const RANK_MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function setPodiumRow(row: PodiumRow, rank: number, entry: { username: string; score: number; isYou: boolean }): void {
  row.rankElement.textContent = RANK_MEDALS[rank] ?? `${rank}th`;
  row.nameElement.textContent = entry.isYou ? `${entry.username} (you)` : entry.username;
  row.scoreElement.textContent = String(entry.score);
  row.row.style.borderColor = rank === 1 ? ACCENT : HAIRLINE;
  row.row.style.background = SURFACE_RAISED;
}
