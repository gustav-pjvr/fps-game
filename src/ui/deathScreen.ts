import { MONO_FONT, INK_DIM, INK, LABEL_CSS, SURFACE, SANS_FONT } from './theme.ts';
import { attachScanSweep, createButton } from './menu/menuStyles.ts';
import { setDeviceHint } from '../input/GamepadInput.ts';

/** Content sits near the top rather than screen-center (per user request) - clears both the
 * single-player Hud's top-left score text and, in multiplayer, MultiplayerHud's top-left health
 * rows and top-center scoreboard, all of which stay visible and updating underneath this overlay
 * while dead. */
const CONTENT_TOP_OFFSET = 110;

/** How an Uplink mission ended (docs/visual-overhaul.md, "End screen"). */
export interface MissionResult {
  readonly won: boolean;
  readonly seconds: number;
  readonly kills: number;
  readonly damageTaken: number;
  /** Uplinks online when it ended, out of `total`. */
  readonly online: number;
  readonly total: number;
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export class DeathScreen {
  private readonly element: HTMLDivElement;
  private readonly titleElement: HTMLHeadingElement;
  private readonly scoreElement: HTMLDivElement;
  private readonly statsElement: HTMLDListElement;

  constructor(root: HTMLElement, onRespawnClick: () => void, onReturnToLobbyClick: () => void) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'death-screen';
    this.element.className = 'menu-surface';
    this.element.style.cssText =
      'position:absolute; inset:0; display:none; align-items:center; justify-content:flex-start;' +
      ' padding-top:' +
      CONTENT_TOP_OFFSET +
      `px; flex-direction:column; gap:14px; background:${SURFACE}; backdrop-filter:blur(10px); color:${INK};` +
      ` font-family:${SANS_FONT}; z-index:20; pointer-events:auto;`;

    const title = document.createElement('h2');
    this.titleElement = title;
    title.textContent = 'YOU DIED';
    title.className = 'menu-panel-title';
    title.style.cssText = 'margin:0; font-size:2.5rem; font-weight:300; letter-spacing:-0.01em; text-wrap:balance;';

    this.scoreElement = document.createElement('div');
    this.scoreElement.style.cssText = `font-family:${MONO_FONT}; font-size:1.1rem; color:${INK_DIM};`;

    // The mission variant's numbers: label above value, in a row, mono numerals.
    this.statsElement = document.createElement('dl');
    this.statsElement.style.cssText = 'display:none; gap:36px; margin:4px 0 0; font-variant-numeric:tabular-nums;';

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex; gap:12px; margin-top:8px;';

    const respawnButton = createButton('Respawn', 'primary');
    respawnButton.addEventListener('click', onRespawnClick);

    const lobbyButton = createButton('Return to Lobby');
    lobbyButton.addEventListener('click', onReturnToLobbyClick);

    buttonRow.append(respawnButton, lobbyButton);
    this.element.append(title, this.scoreElement, this.statsElement, buttonRow);
    const hint = document.createElement('div');
    hint.style.cssText = `${LABEL_CSS} color:${INK_DIM};`;
    setDeviceHint(hint, 'Click Respawn to play again', 'D-pad: select | A (Cross): activate | B (Circle): lobby');
    this.element.appendChild(hint);
    root.appendChild(this.element);
  }

  show(score: number): void {
    this.titleElement.textContent = 'YOU DIED';
    this.scoreElement.textContent = `Score: ${score}`;
    this.scoreElement.style.display = '';
    this.statsElement.style.display = 'none';
    this.element.style.display = 'flex';
    attachScanSweep(this.element);
  }

  /** The Uplink mission's end screen, for a win or a loss. Respawn restarts the mission. */
  showMission(result: MissionResult): void {
    this.titleElement.textContent = result.won ? 'Uplink complete' : 'Signal lost';
    this.scoreElement.style.display = 'none';
    const stats: [string, string][] = [
      ['TIME', formatClock(result.seconds)],
      ['UPLINKS', `${result.online} / ${result.total}`],
      ['KILLS', String(result.kills)],
      ['DAMAGE TAKEN', String(Math.round(result.damageTaken))],
    ];
    this.statsElement.replaceChildren(
      ...stats.map(([label, value]) => {
        const cell = document.createElement('div');
        const term = document.createElement('dt');
        term.textContent = label;
        term.style.cssText = `${LABEL_CSS} margin-bottom:6px;`;
        const detail = document.createElement('dd');
        detail.textContent = value;
        detail.style.cssText = `margin:0; font-family:${MONO_FONT}; font-size:1.6rem; font-weight:300; color:${INK};`;
        cell.append(term, detail);
        return cell;
      }),
    );
    this.statsElement.style.display = 'flex';
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
