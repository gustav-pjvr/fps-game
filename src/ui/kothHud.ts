import { ACCENT, AMBER, HAIRLINE, INK, LABEL_CSS, MONO_FONT, SANS_FONT, SURFACE, TEXT_SHADOW, THREAT } from './theme.ts';
import type { HillTone } from '../entities/HillView.ts';

const TONE_COLOURS: Readonly<Record<HillTone, string>> = { open: AMBER, ours: ACCENT, theirs: THREAT, contested: INK };

/** What the panel says about the hill right now. */
export interface KothHudState {
  readonly tone: HillTone;
  /** The line under the label: who holds the hill, in this player's terms. */
  readonly status: string;
  /** Seconds until the hill moves, and how long this hill lasts in all. */
  readonly moveIn: number;
  readonly duration: number;
  readonly push: boolean;
}

/** King of the Hill's own panel, top centre under the compass: who holds the hill, a bar that
 * drains as the hill's time runs out, and the Final Push flag. The points themselves are on the
 * scoreboard (ui/multiplayerHud.ts). */
export class KothHud {
  private readonly element: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly clock: HTMLDivElement;
  private shown = '';

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'koth-hud';
    this.element.style.cssText =
      // Under the scoreboard (top 128 px), with the same kind of backing.
      `position:absolute; top:170px; left:50%; transform:translateX(-50%); width:min(300px, 60vw); text-align:center; color:${INK};` +
      ` font-family:${SANS_FONT}; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums; pointer-events:none;` +
      ` background:${SURFACE}; backdrop-filter:blur(10px); border:1px solid ${HAIRLINE}; border-radius:2px; padding:9px 16px 11px; box-sizing:border-box;`;
    this.label = document.createElement('div');
    this.label.style.cssText = `${LABEL_CSS} margin-bottom:5px;`;
    // Spoken as well as shown: who holds the hill is the state of the match.
    this.status = document.createElement('div');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.style.cssText = 'font-size:15px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase;';
    const track = document.createElement('div');
    track.style.cssText = 'height:3px; margin:8px 0 5px; background:rgba(233, 239, 233, 0.16); border-radius:2px; overflow:hidden;';
    this.bar = document.createElement('div');
    this.bar.style.cssText = 'height:100%; width:100%; transform-origin:left center; border-radius:2px;';
    track.appendChild(this.bar);
    this.clock = document.createElement('div');
    this.clock.style.cssText = `font-family:${MONO_FONT}; font-size:10.5px; font-weight:300; letter-spacing:0.06em;`;
    this.element.append(this.label, this.status, track, this.clock);
    root.appendChild(this.element);
  }

  set(state: KothHudState): void {
    const seconds = Math.ceil(state.moveIn);
    const key = `${state.tone}|${state.status}|${seconds}|${state.push}`;
    // The bar moves every tick; the text only when something it says changes.
    this.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, state.moveIn / state.duration)).toFixed(3)})`;
    if (key === this.shown) return;
    this.shown = key;
    const colour = TONE_COLOURS[state.tone];
    this.label.textContent = state.push ? 'KING OF THE HILL | FINAL PUSH' : 'KING OF THE HILL';
    this.label.style.color = state.push ? AMBER : '';
    this.status.textContent = state.status;
    this.status.style.color = colour;
    this.bar.style.background = colour;
    this.clock.textContent = `HILL MOVES IN ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  dispose(): void {
    this.element.remove();
  }
}
