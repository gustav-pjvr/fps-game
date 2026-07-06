import { createButton } from './menu/menuStyles.ts';
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
}

/** Shown by App (not Game) once a multiplayer match ends, so it survives the Game teardown/
 * recreate cycle a rematch needs (see App.restartMultiplayerMatch) - unlike DeathScreen, which is
 * per-match HUD chrome that's fine to dispose along with the rest of Game.
 *
 * Only the host ever sees the Rematch button - the guest has no say in whether the match keeps
 * going with the same room, mirroring how only the host clicks "Start Match" in the first place.
 * The guest is instead swept along automatically: the host's Rematch click sends a fresh
 * MatchStartMessage over the same connection, and Game.ts's onMessage handler treats that as the
 * signal to restart on the guest's side too (see onMultiplayerRematchReceived). */
export class MatchEndScreen {
  private readonly element: HTMLDivElement;
  private readonly titleElement: HTMLDivElement;
  private readonly scoreElement: HTMLDivElement;
  private readonly rematchButton: HTMLButtonElement;

  constructor(root: HTMLElement, onRematchClick: () => void, onReturnToLobbyClick: () => void) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'match-end-screen';
    this.element.style.cssText =
      'position:absolute; inset:0; display:none; align-items:center; justify-content:center;' +
      ' flex-direction:column; gap:14px; background:rgba(10,10,10,0.72); color:#fff;' +
      ' font-family:system-ui, sans-serif; z-index:25; pointer-events:auto;';

    this.titleElement = document.createElement('div');
    this.titleElement.style.cssText = 'font-size:2.5rem; font-weight:700; letter-spacing:0.1em;';

    this.scoreElement = document.createElement('div');
    this.scoreElement.style.cssText = 'font-size:1.1rem; opacity:0.85;';

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex; gap:12px; margin-top:8px;';

    this.rematchButton = createButton('Rematch', 'primary');
    this.rematchButton.addEventListener('click', onRematchClick);

    const lobbyButton = createButton('Return to Lobby');
    lobbyButton.addEventListener('click', onReturnToLobbyClick);

    buttonRow.append(this.rematchButton, lobbyButton);
    this.element.append(this.titleElement, this.scoreElement, buttonRow);
    root.appendChild(this.element);
  }

  show(result: MultiplayerMatchEndResult): void {
    this.titleElement.textContent =
      result.reason === 'opponentDisconnected' ? 'OPPONENT DISCONNECTED' : result.won ? 'VICTORY' : 'DEFEAT';
    this.scoreElement.textContent = `You ${result.myScore} — ${result.opponentScore} Opponent (first to ${result.killLimit})`;
    // A disconnect means the connection this rematch would need is already gone; only the host
    // ever gets to choose, so the guest never sees this button regardless of reason.
    this.rematchButton.style.display = result.reason === 'killLimit' && result.role === 'host' ? 'inline-block' : 'none';
    this.element.style.display = 'flex';
  }

  hide(): void {
    this.element.style.display = 'none';
  }

  dispose(): void {
    this.element.remove();
  }
}
