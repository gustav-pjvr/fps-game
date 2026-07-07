import { createButton, ACCENT, TEXT, HAIRLINE, BG_RAISED, DISPLAY_FONT } from './menu/menuStyles.ts';
import { DEFAULT_MULTIPLAYER_KILL_LIMIT, MULTIPLAYER_KILL_LIMIT_OPTIONS, MULTIPLAYER_MAX_PLAYERS } from '../core/config.ts';
import type { PeerConnection } from '../network/PeerConnection.ts';
import type { MultiplayerRole } from '../network/MultiplayerSession.ts';
import type { PlayerSlot } from '../network/protocol.ts';

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
  role: MultiplayerRole;
  connection: PeerConnection;
}

/** What the host actually chose before clicking Rematch - App.handleRematchClick uses this instead
 * of blindly reusing the just-finished match's own settings, per user request ("host rematch/
 * settings options: kill target, new map toggle"). */
export interface RematchSettings {
  killLimit: number;
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
    this.podium.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:360px;';
    this.podiumRows = Array.from({ length: MULTIPLAYER_MAX_PLAYERS }, () => createPodiumRow());
    this.podium.append(...this.podiumRows.map((row) => row.row));

    // Host-only rematch settings (per user request: "kill target, new map toggle") - never shown
    // to a guest, mirroring how only the host ever picks the kill limit in CreateRoomScreen.
    this.hostSettings = document.createElement('div');
    this.hostSettings.style.cssText =
      `display:flex; flex-direction:column; gap:10px; width:360px; padding:16px 18px;` +
      ` background:${BG_RAISED}; border:1px solid ${HAIRLINE}; border-radius:8px;`;

    const killLimitLabel = document.createElement('div');
    killLimitLabel.textContent = 'First to how many kills wins the rematch?';
    killLimitLabel.style.cssText = 'font-size:0.8rem; opacity:0.8;';
    this.killLimitSelect = document.createElement('select');
    this.killLimitSelect.style.cssText =
      `width:100%; box-sizing:border-box; padding:10px; font-size:0.95rem; font-weight:600; color:${TEXT};` +
      ` background:rgba(255,255,255,0.08); border:1px solid ${HAIRLINE}; border-radius:6px; cursor:pointer;`;
    for (const option of MULTIPLAYER_KILL_LIMIT_OPTIONS) {
      const optionElement = document.createElement('option');
      optionElement.value = String(option);
      optionElement.textContent = `${option} kills`;
      this.killLimitSelect.appendChild(optionElement);
    }

    const newMapLabel = document.createElement('label');
    newMapLabel.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;';
    this.newMapCheckbox = document.createElement('input');
    this.newMapCheckbox.type = 'checkbox';
    this.newMapCheckbox.checked = true;
    const newMapText = document.createElement('span');
    newMapText.textContent = 'Generate a new map';
    newMapLabel.append(this.newMapCheckbox, newMapText);

    this.hostSettings.append(killLimitLabel, this.killLimitSelect, newMapLabel);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex; gap:12px; margin-top:4px;';

    this.rematchButton = createButton('Rematch', 'primary');
    this.rematchButton.addEventListener('click', () =>
      onRematchClick({ killLimit: Number(this.killLimitSelect.value), newMap: this.newMapCheckbox.checked }),
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
    const canRematch = result.reason === 'killLimit' && result.role === 'host';
    this.rematchButton.style.display = canRematch ? 'inline-block' : 'none';
    this.hostSettings.style.display = canRematch ? 'flex' : 'none';
    if (canRematch) {
      this.killLimitSelect.value = String(result.killLimit);
      if (!this.killLimitSelect.value) this.killLimitSelect.value = String(DEFAULT_MULTIPLAYER_KILL_LIMIT);
    }

    this.element.style.display = 'flex';
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
