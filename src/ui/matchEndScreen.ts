import { createButton, ACCENT, TEXT, HAIRLINE, BG_RAISED, DISPLAY_FONT } from './menu/menuStyles.ts';
import { DEFAULT_MULTIPLAYER_KILL_LIMIT, MULTIPLAYER_KILL_LIMIT_OPTIONS } from '../core/config.ts';
import type { PeerConnection } from '../network/PeerConnection.ts';
import type { MultiplayerRole } from '../network/MultiplayerSession.ts';

export type MultiplayerMatchEndReason = 'killLimit' | 'opponentDisconnected';

/** Everything App needs to show the right screen and, if the host chooses to, start a rematch on
 * the same still-open connection (MULTIPLAYER_PLAN.md §7 phase 4). */
export interface MultiplayerMatchEndResult {
  reason: MultiplayerMatchEndReason;
  won: boolean;
  myScore: number;
  opponentScore: number;
  killLimit: number;
  role: MultiplayerRole;
  connection: PeerConnection;
  ownUsername: string;
  opponentUsername: string;
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
 * Only the host ever sees the Rematch button (and the settings next to it) - the guest has no say
 * in whether the match keeps going with the same room, mirroring how only the host clicks "Start
 * Match" in the first place. The guest is instead swept along automatically: the host's Rematch
 * click sends a fresh MatchStartMessage over the same connection, and Game.ts's onMessage handler
 * treats that as the signal to restart on the guest's side too (see onMultiplayerRematchReceived). */
export class MatchEndScreen {
  private readonly element: HTMLDivElement;
  private readonly titleElement: HTMLDivElement;
  private readonly podium: HTMLDivElement;
  private readonly firstPlaceRow: PodiumRow;
  private readonly secondPlaceRow: PodiumRow;
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

    // Two-row podium (1st/2nd) rather than a plain "You N - M Opponent" line, per user request -
    // real usernames plus a clear rank/medal read faster than parsing a score string.
    this.podium = document.createElement('div');
    this.podium.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:360px;';
    this.firstPlaceRow = createPodiumRow();
    this.secondPlaceRow = createPodiumRow();
    this.podium.append(this.firstPlaceRow.row, this.secondPlaceRow.row);

    // Host-only rematch settings (per user request: "kill target, new map toggle") - never shown
    // to the guest, mirroring how only the host ever picks the kill limit in CreateRoomScreen.
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

    const own = { name: result.ownUsername, score: result.myScore, isYou: true };
    const opponent = { name: result.opponentUsername, score: result.opponentScore, isYou: false };
    const [first, second] = own.score >= opponent.score ? [own, opponent] : [opponent, own];
    setPodiumRow(this.firstPlaceRow, 1, first);
    setPodiumRow(this.secondPlaceRow, 2, second);

    // A disconnect means the connection this rematch would need is already gone; only the host
    // ever gets to choose, so the guest never sees these regardless of reason.
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

function setPodiumRow(row: PodiumRow, rank: 1 | 2, entry: { name: string; score: number; isYou: boolean }): void {
  row.rankElement.textContent = rank === 1 ? '🥇' : '🥈';
  row.nameElement.textContent = entry.isYou ? `${entry.name} (you)` : entry.name;
  row.scoreElement.textContent = String(entry.score);
  row.row.style.borderColor = rank === 1 ? ACCENT : 'rgba(255,255,255,0.1)';
  row.row.style.background = rank === 1 ? 'rgba(62,207,95,0.12)' : 'rgba(255,255,255,0.05)';
}
