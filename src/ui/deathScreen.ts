import { MONO_FONT, INK_DIM, INK, LABEL_CSS, SURFACE, SANS_FONT } from './theme.ts';
import { attachScanSweep, createButton } from './menu/menuStyles.ts';
import { setDeviceHint } from '../input/GamepadInput.ts';

/** Content sits near the top rather than screen-center (per user request) - clears both the
 * single-player Hud's top-left score text and, in multiplayer, MultiplayerHud's top-left health
 * rows and top-center scoreboard, all of which stay visible and updating underneath this overlay
 * while dead. */
const CONTENT_TOP_OFFSET = 110;

/** How an Operation Uplink run ended (docs/uplink.md, "End screen"). */
export interface MissionResult {
  readonly won: boolean;
  /** S, A, B or C for a win; a loss is not graded. */
  readonly grade: string | null;
  /** Why it was lost: the last redeploy spent, or the extraction countdown run out. */
  readonly loss: 'signalLost' | 'extractionMissed' | null;
  readonly seconds: number;
  readonly kills: number;
  readonly damageTaken: number;
  /** The stage it ended in, 1 to 4. */
  readonly stage: number;
  readonly redeploysUsed: number;
  /** Redeploys an operation starts with. */
  readonly redeploys: number;
  /** The alert level it ended at, 1 to 5. */
  readonly alert: number;
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
  private readonly respawnButton: HTMLButtonElement;
  private readonly hint: HTMLDivElement;

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
    this.respawnButton = respawnButton;
    respawnButton.addEventListener('click', onRespawnClick);

    const lobbyButton = createButton('Return to Lobby');
    lobbyButton.addEventListener('click', onReturnToLobbyClick);

    buttonRow.append(respawnButton, lobbyButton);
    this.element.append(title, this.scoreElement, this.statsElement, buttonRow);
    const hint = document.createElement('div');
    this.hint = hint;
    hint.style.cssText = `${LABEL_CSS} color:${INK_DIM};`;
    setDeviceHint(hint, 'Click Respawn to play again', 'D-pad: select | A (Cross): activate');
    this.element.appendChild(hint);
    root.appendChild(this.element);
  }

  show(score: number): void {
    this.titleElement.textContent = 'YOU DIED';
    this.setAction('Respawn', 'Click Respawn to play again');
    this.scoreElement.textContent = `Score: ${score}`;
    this.scoreElement.style.display = '';
    this.statsElement.style.display = 'none';
    this.element.style.display = 'flex';
    attachScanSweep(this.element);
  }

  /** Operation Uplink's end screen: the grade for a win, the stage reached for a loss, then what
   * the grade is made of (time, damage taken, redeploys used). Respawn starts a new operation. */
  showMission(result: MissionResult): void {
    const line = result.won
      ? 'Uplink secured'
      : result.loss === 'extractionMissed' ? 'The extraction window closed' : 'No redeploys left';
    this.showResult(result.won ? 'Operation complete' : 'Signal lost', line, [
      result.won ? ['GRADE', result.grade ?? '-'] : ['STAGE', `${result.stage} / 4`],
      ['TIME', formatClock(result.seconds)],
      ['DAMAGE TAKEN', String(Math.round(result.damageTaken))],
      ['REDEPLOYS', `${result.redeploysUsed} / ${result.redeploys}`],
      ['KILLS', String(result.kills)],
      ['ALERT', String(result.alert)],
    ]);
    // Six numbers do not fit a narrow window in one row.
    this.statsElement.style.flexWrap = 'wrap';
    this.statsElement.style.justifyContent = 'center';
    this.statsElement.style.rowGap = '18px';
    this.statsElement.style.padding = '0 16px';
    this.scoreElement.style.textAlign = 'center';
  }

  /** The main button's label and the hint under it: a finished run offers "Play again", a death
   * mid-run "Redeploy", an ordinary death "Respawn". */
  private setAction(label: string, hint: string): void {
    this.respawnButton.textContent = label;
    setDeviceHint(this.hint, hint, 'D-pad: select | A (Cross): activate');
  }

  /** A run's end screen (a mission, a solo Goose Horde run, Showdown): a title, an optional line
   * under it, and its numbers. `action` names what the main button does: "Play again" starts the
   * run over, "Redeploy" goes back into a running one. */
  showResult(title: string, line: string | null, stats: readonly (readonly [string, string])[], action: 'Play again' | 'Redeploy' = 'Play again'): void {
    this.setAction(action, action === 'Redeploy' ? 'Click Redeploy to go back in' : 'Click Play again to start over');
    this.titleElement.textContent = title;
    this.scoreElement.textContent = line ?? '';
    this.scoreElement.style.display = line ? '' : 'none';
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
