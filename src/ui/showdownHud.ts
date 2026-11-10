import { ACCENT, AMBER, HAIRLINE, INK, LABEL_CSS, MONO_FONT, SANS_FONT, SURFACE, TEXT_SHADOW, THREAT } from './theme.ts';
import type { ShowdownView } from '../entities/enemies/director/showdown.ts';

const STATUS: Readonly<Record<ShowdownView['phase'], string>> = { buildUp: 'THEY ARE COMING', peak: 'PEAK', fade: 'HOLD ON', relax: 'BREATHER' };

/** Showdown's panel, top centre under the compass (docs/showdown.md): the act, what the fight is
 * doing, the score with its multiplier, a bar toward the multiplier's next step, and the
 * redeploys left. */
export class ShowdownHud {
  private readonly element: HTMLDivElement;
  private readonly act: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly score: HTMLDivElement;
  private readonly heatBar: HTMLDivElement;
  private readonly foot: HTMLDivElement;
  private shown = '';

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'showdown-hud';
    this.element.style.cssText =
      `position:absolute; top:122px; left:50%; transform:translateX(-50%); width:min(280px, 62vw); text-align:center; color:${INK};` +
      ` font-family:${SANS_FONT}; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums; pointer-events:none;` +
      // A backing like the scoreboard's: bare text was lost against the sky and the towers.
      ` background:${SURFACE}; backdrop-filter:blur(10px); border:1px solid ${HAIRLINE}; border-radius:2px; padding:9px 16px 11px; box-sizing:border-box;`;
    const label = document.createElement('div');
    label.style.cssText = `${LABEL_CSS} margin-bottom:5px;`;
    label.textContent = 'SHOWDOWN';
    this.act = document.createElement('div');
    this.act.style.cssText = 'font-size:15px; font-weight:700; letter-spacing:0.08em;';
    // Spoken as well as shown: the act and what it is doing are the state of the run.
    this.status = document.createElement('div');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.style.cssText = `margin-top:3px; font-family:${MONO_FONT}; font-size:10.5px; font-weight:300; letter-spacing:0.06em;`;
    this.score = document.createElement('div');
    this.score.style.cssText = `margin-top:9px; font-family:${MONO_FONT}; font-size:12px; letter-spacing:0.04em;`;
    const track = document.createElement('div');
    track.setAttribute('aria-hidden', 'true');
    track.style.cssText = 'height:3px; margin:6px auto 4px; width:60%; background:rgba(233, 239, 233, 0.16); border-radius:2px; overflow:hidden;';
    this.heatBar = document.createElement('div');
    this.heatBar.style.cssText = `height:100%; width:100%; transform-origin:left center; border-radius:2px; background:${AMBER};`;
    track.appendChild(this.heatBar);
    this.foot = document.createElement('div');
    this.foot.style.cssText = `font-family:${MONO_FONT}; font-size:10.5px; font-weight:400; letter-spacing:0.06em; color:${INK};`;
    this.element.append(label, this.act, this.status, this.score, track, this.foot);
    root.appendChild(this.element);
  }

  set(view: ShowdownView): void {
    // The bar moves all the time; the text only when something it says changes.
    this.heatBar.style.transform = `scaleX(${Math.max(0, Math.min(1, view.heat)).toFixed(3)})`;
    const finale = view.stage === 'finale';
    const status = view.stage === 'won' ? 'SHOWDOWN WON' : view.stage === 'lost' ? 'OVERRUN' : finale ? 'KILL THE WARDEN' : STATUS[view.phase];
    const key = `${view.act}|${status}|${view.score}|${view.multiplier}|${view.redeploysLeft}`;
    if (key === this.shown) return;
    this.shown = key;
    this.act.textContent = finale || view.stage === 'won' ? 'FINALE' : `ACT ${view.act} / ${view.totalActs}`;
    this.status.textContent = status;
    this.status.style.color = finale || view.phase === 'peak' ? THREAT : view.phase === 'relax' ? ACCENT : '';
    this.score.textContent = `SCORE ${view.score.toLocaleString('en-US')}   x${view.multiplier}`;
    this.foot.textContent = `REDEPLOYS ${view.redeploysLeft}`;
  }

  dispose(): void {
    this.element.remove();
  }
}
