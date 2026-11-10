import { ACCENT, AMBER, INK, INK_DIM, LABEL_CSS, MONO_FONT, SANS_FONT, TEXT_SHADOW, THREAT } from './theme.ts';

/** What the wave panel shows (entities/HordeGooseManager.ts's HordeView, plus the boss's name). */
export interface HordeHudState {
  readonly wave: number;
  readonly totalWaves: number;
  readonly phase: 'active' | 'intermission' | 'cleared';
  readonly nextIn: number;
  readonly left: number;
  readonly meter: number;
  readonly need: number;
  readonly boss: { readonly name: string; readonly hp: number; readonly max: number } | null;
  /** Solo: the Second Winds left. Null in co-op, where the squad revives instead. */
  readonly secondWinds: number | null;
}

const TRACK_CSS = 'height:3px; background:rgba(233, 239, 233, 0.16); border-radius:2px; overflow:hidden;';
const FILL_CSS = 'height:100%; width:100%; transform-origin:left center; border-radius:2px;';

/** Goose Horde's panel, top centre under the compass (and under the scoreboard in a room): the
 * wave, what is left of it or how long until the next, the squad's supply meter, and a boss's
 * health while one is alive. */
export class HordeHud {
  private readonly element: HTMLDivElement;
  private readonly wave: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly supplyBar: HTMLDivElement;
  private readonly supplyLabel: HTMLDivElement;
  private readonly bossBlock: HTMLDivElement;
  private readonly bossName: HTMLDivElement;
  private readonly bossBar: HTMLDivElement;
  private shown = '';

  constructor(root: HTMLElement, top: number) {
    this.element = document.createElement('div');
    this.element.dataset.testid = 'horde-hud';
    this.element.style.cssText =
      `position:absolute; top:${top}px; left:50%; transform:translateX(-50%); width:min(280px, 62vw); text-align:center; color:${INK};` +
      ` font-family:${SANS_FONT}; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums; pointer-events:none;`;
    const label = document.createElement('div');
    label.style.cssText = `${LABEL_CSS} margin-bottom:5px;`;
    label.textContent = 'GOOSE HORDE';
    this.wave = document.createElement('div');
    this.wave.style.cssText = 'font-size:15px; font-weight:700; letter-spacing:0.08em;';
    // Spoken as well as shown: the wave's state is the state of the run.
    this.status = document.createElement('div');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.style.cssText = `margin-top:3px; font-family:${MONO_FONT}; font-size:10.5px; font-weight:300; letter-spacing:0.06em;`;

    const supplyTrack = document.createElement('div');
    supplyTrack.setAttribute('aria-hidden', 'true');
    supplyTrack.style.cssText = `${TRACK_CSS} margin:9px auto 4px; width:60%;`;
    this.supplyBar = document.createElement('div');
    this.supplyBar.style.cssText = `${FILL_CSS} background:${ACCENT};`;
    supplyTrack.appendChild(this.supplyBar);
    this.supplyLabel = document.createElement('div');
    this.supplyLabel.style.cssText = `font-family:${MONO_FONT}; font-size:9.5px; font-weight:300; letter-spacing:0.06em; color:${INK_DIM};`;

    this.bossBlock = document.createElement('div');
    this.bossBlock.dataset.testid = 'horde-boss';
    this.bossBlock.style.cssText = 'display:none; margin-top:11px;';
    this.bossName = document.createElement('div');
    this.bossName.style.cssText = `${LABEL_CSS} color:${THREAT}; margin-bottom:5px;`;
    const bossTrack = document.createElement('div');
    bossTrack.setAttribute('aria-hidden', 'true');
    bossTrack.style.cssText = `${TRACK_CSS} height:5px;`;
    this.bossBar = document.createElement('div');
    this.bossBar.style.cssText = `${FILL_CSS} background:${THREAT};`;
    bossTrack.appendChild(this.bossBar);
    this.bossBlock.append(this.bossName, bossTrack);

    this.element.append(label, this.wave, this.status, supplyTrack, this.supplyLabel, this.bossBlock);
    root.appendChild(this.element);
  }

  set(state: HordeHudState): void {
    // The bars move with every kill and hit; the text only when something it says changes.
    this.supplyBar.style.transform = `scaleX(${ratio(state.meter, state.need)})`;
    if (state.boss) this.bossBar.style.transform = `scaleX(${ratio(state.boss.hp, state.boss.max)})`;
    const seconds = Math.ceil(state.nextIn);
    const status = state.phase === 'cleared'
      ? 'THE HORDE IS BROKEN'
      : state.phase === 'intermission'
        ? `NEXT WAVE IN ${seconds}`
        : `${state.left} LEFT`;
    const key = `${state.wave}|${state.totalWaves}|${status}|${state.need - state.meter}|${state.boss?.name ?? ''}|${state.secondWinds}`;
    if (key === this.shown) return;
    this.shown = key;
    this.wave.textContent = `WAVE ${state.wave} / ${state.totalWaves}`;
    this.status.textContent = status;
    this.status.style.color = state.phase === 'intermission' ? AMBER : '';
    const winds = state.secondWinds === null ? '' : `  |  SECOND WIND ${state.secondWinds}`;
    this.supplyLabel.textContent = `SUPPLY DROP IN ${Math.max(0, state.need - state.meter)} KILLS${winds}`;
    this.bossBlock.style.display = state.boss ? 'block' : 'none';
    if (state.boss) this.bossName.textContent = state.boss.name;
  }

  dispose(): void {
    this.element.remove();
  }
}

function ratio(value: number, max: number): string {
  return Math.max(0, Math.min(1, max > 0 ? value / max : 0)).toFixed(3);
}
