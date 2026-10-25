import { Compass, bearingDeg } from './compass.ts';
import { setDeviceHint } from '../input/GamepadInput.ts';
import { ACCENT, AMBER, HAIRLINE, INK, INK_DIM, INK_FAINT, LABEL_CSS, MONO_FONT, SANS_FONT, TEXT_SHADOW, THREAT } from './theme.ts';

export class Hud {
  private readonly container: HTMLDivElement;
  readonly compass: Compass;
  private readonly objectivePanel: HTMLDivElement;
  private readonly objectiveLabel: HTMLDivElement;
  private readonly objectiveText: HTMLDivElement;
  private readonly progress: HTMLDivElement;
  private readonly scoreElement: HTMLDivElement;
  private readonly vitals: HTMLDivElement;
  private readonly healthFillElement: HTMLDivElement;
  private readonly healthTextElement: HTMLSpanElement;
  private readonly healthStatus: HTMLDivElement;
  private readonly lightMeter: HTMLSpanElement;
  private readonly weaponNameElement: HTMLDivElement;
  private readonly magazine: HTMLSpanElement;
  private readonly capacity: HTMLSpanElement;
  private readonly reserve: HTMLSpanElement;
  private readonly grenades: HTMLDivElement;
  private readonly grenadeCounts: Record<'frag' | 'flash', HTMLSpanElement>;
  private grenadesShown = '';
  private readonly prompt: HTMLDivElement;
  private readonly promptKey: HTMLElement;
  private readonly promptText: HTMLSpanElement;
  private progressShown = '';

  constructor(root: HTMLElement) {
    this.container = document.createElement('div');
    this.container.style.cssText = `position:absolute; inset:0; pointer-events:none; color:${INK}; font-family:${SANS_FONT}; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums;`;
    root.appendChild(this.container);
    this.compass = new Compass(this.container);

    const crosshair = document.createElement('div');
    crosshair.style.cssText = `position:absolute; top:50%; left:50%; width:0; height:0; color:${INK}; opacity:0.8;`;
    for (const style of [
      'left:-13px; top:-0.5px; width:6px; height:1px;',
      'left:7px; top:-0.5px; width:6px; height:1px;',
      'left:-0.5px; top:-13px; width:1px; height:6px;',
      'left:-0.5px; top:7px; width:1px; height:6px;',
      'left:-1px; top:-1px; width:2px; height:2px; border-radius:50%;',
    ]) {
      const line = document.createElement('i');
      line.style.cssText = `position:absolute; background:currentColor; ${style}`;
      crosshair.appendChild(line);
    }
    this.container.appendChild(crosshair);

    this.objectivePanel = document.createElement('div');
    this.objectivePanel.style.cssText = 'position:absolute; top:32px; left:32px; max-width:calc(50% - 208px);';
    this.objectiveLabel = document.createElement('div');
    this.objectiveLabel.style.cssText = LABEL_CSS;
    this.objectiveText = document.createElement('div');
    this.objectiveText.style.cssText = 'font-size:16px; font-weight:400; margin:9px 0 15px;';
    this.progress = document.createElement('div');
    this.progress.style.cssText = 'display:none; gap:6px; flex-wrap:wrap;';
    this.scoreElement = document.createElement('div');
    this.scoreElement.style.cssText = `font-family:${MONO_FONT}; font-size:11px; color:${INK_DIM};`;
    this.objectivePanel.append(this.objectiveLabel, this.objectiveText, this.progress, this.scoreElement);
    this.container.appendChild(this.objectivePanel);
    this.setObjective('ELIMINATION', 'Clear the valley');
    this.setScore(0);

    this.vitals = document.createElement('div');
    this.vitals.style.cssText = 'position:absolute; bottom:32px; left:32px; width:180px;';
    const healthLabel = document.createElement('div');
    healthLabel.style.cssText = LABEL_CSS;
    healthLabel.textContent = 'HEALTH';
    const healthReading = document.createElement('div');
    healthReading.style.cssText = 'margin:5px 0 9px;';
    this.healthTextElement = document.createElement('span');
    this.healthTextElement.style.cssText = 'font-size:44px; font-weight:300; line-height:1;';
    const percent = document.createElement('span');
    percent.style.cssText = `font-family:${MONO_FONT}; font-size:11px; color:${INK_DIM}; margin-left:7px;`;
    percent.textContent = '%';
    this.lightMeter = document.createElement('span');
    this.lightMeter.style.cssText = `display:none; margin-left:18px; color:${ACCENT}; vertical-align:middle;`;
    this.lightMeter.title = 'Visibility to enemies';
    this.lightMeter.setAttribute('role', 'img');
    this.lightMeter.innerHTML = '<svg width="22" height="16" viewBox="0 0 22 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1 8 Q11 -4 21 8 Q11 20 1 8Z"/><circle cx="11" cy="8" r="3"/></svg>';
    healthReading.append(this.healthTextElement, percent, this.lightMeter);
    const track = document.createElement('div');
    track.style.cssText = `height:3px; background:${HAIRLINE};`;
    this.healthFillElement = document.createElement('div');
    this.healthFillElement.style.cssText = `height:100%; background:${ACCENT};`;
    track.appendChild(this.healthFillElement);
    this.healthStatus = document.createElement('div');
    this.healthStatus.style.cssText = `${LABEL_CSS} font-size:10px; margin-top:9px;`;
    this.vitals.append(healthLabel, healthReading, track, this.healthStatus);
    this.container.appendChild(this.vitals);
    this.setHealth(100, 100);

    const weapon = document.createElement('div');
    weapon.style.cssText = 'position:absolute; bottom:32px; right:32px; text-align:right; max-width:280px;';
    this.weaponNameElement = document.createElement('div');
    this.weaponNameElement.style.cssText = LABEL_CSS;
    const ammo = document.createElement('div');
    ammo.style.cssText = 'margin-top:9px; white-space:nowrap;';
    this.magazine = document.createElement('span');
    this.capacity = document.createElement('span');
    this.reserve = document.createElement('span');
    for (const element of [this.capacity, this.reserve]) {
      element.style.cssText = `font-family:${MONO_FONT}; font-size:14px; color:${INK_DIM};`;
    }
    ammo.append(this.magazine, this.capacity, this.reserve);
    // Frag and flash counts under the ammo, hidden in modes without grenades.
    this.grenades = document.createElement('div');
    this.grenades.style.cssText = 'display:none; justify-content:flex-end; gap:16px; margin-top:10px;';
    const grenadeCount = (label: string): HTMLSpanElement => {
      const item = document.createElement('span');
      item.style.cssText = 'display:inline-flex; align-items:baseline; gap:7px;';
      const name = document.createElement('span');
      name.style.cssText = `${LABEL_CSS} font-size:10px;`;
      name.textContent = label;
      const count = document.createElement('span');
      count.style.cssText = `font-family:${MONO_FONT}; font-size:14px;`;
      item.append(name, count);
      this.grenades.appendChild(item);
      return count;
    };
    this.grenadeCounts = { frag: grenadeCount('FRAG'), flash: grenadeCount('FLASH') };
    weapon.append(this.weaponNameElement, ammo, this.grenades);
    this.container.appendChild(weapon);

    // An interaction prompt under the crosshair, e.g. the Uplink mission's `E  START UPLINK`.
    this.prompt = document.createElement('div');
    this.prompt.setAttribute('aria-live', 'polite');
    this.prompt.style.cssText = `position:absolute; top:calc(50% + 46px); left:50%; transform:translateX(-50%); display:none; align-items:center; gap:10px; ${LABEL_CSS} color:${INK};`;
    this.promptKey = document.createElement('kbd');
    this.promptKey.style.cssText = `font-family:${MONO_FONT}; font-size:11px; color:${ACCENT}; border:1px solid ${ACCENT}; border-radius:2px; padding:3px 7px;`;
    this.promptText = document.createElement('span');
    this.prompt.append(this.promptKey, this.promptText);
    this.container.appendChild(this.prompt);
  }

  setObjective(label: string, text: string): void {
    this.objectiveLabel.textContent = label;
    this.objectiveText.textContent = text;
  }

  setObjectiveProgress(done: number, total: number): void {
    this.progress.style.display = 'flex';
    this.scoreElement.style.display = 'none';
    // Called every tick by the mission; only rebuild the pips when they change.
    const shown = `${done}/${total}`;
    if (shown === this.progressShown) return;
    this.progressShown = shown;
    this.progress.replaceChildren();
    for (let i = 0; i < total; i++) {
      const pip = document.createElement('span');
      pip.style.cssText = `width:26px; height:4px; background:${i < done ? ACCENT : INK_FAINT};`;
      this.progress.appendChild(pip);
    }
  }

  setScoreLine(text: string | null): void {
    this.scoreElement.textContent = text;
    this.scoreElement.style.display = text === null ? 'none' : 'block';
    if (text !== null) this.progress.style.display = 'none';
  }

  setAmmo(current: number, max: number, reloading: boolean, reserve?: number | null): void {
    const numeric = Number.isFinite(max) && !reloading;
    this.magazine.style.cssText = `font-family:${numeric ? SANS_FONT : MONO_FONT}; font-size:${numeric ? 44 : 14}px; font-weight:300; line-height:1; color:${numeric && current / max < 0.25 ? AMBER : INK};`;
    this.magazine.textContent = reloading ? 'RELOADING' : numeric ? String(current) : 'MELEE';
    this.capacity.textContent = numeric ? ` / ${max}` : '';
    this.reserve.textContent = reserve != null && Number.isFinite(reserve) ? ` +${reserve}` : '';
  }

  /** The frag and flash counts beside the ammo, or null to hide them (grenades off in this mode). */
  setGrenades(counts: { frag: number; flash: number } | null): void {
    const shown = counts ? `${counts.frag}/${counts.flash}` : '';
    if (shown === this.grenadesShown) return;
    this.grenadesShown = shown;
    this.grenades.style.display = counts ? 'flex' : 'none';
    if (!counts) return;
    for (const kind of ['frag', 'flash'] as const) {
      const element = this.grenadeCounts[kind];
      element.textContent = String(counts[kind]);
      element.style.color = counts[kind] > 0 ? INK : INK_FAINT;
    }
  }

  /** Shows `key` and `text` under the crosshair, or hides the prompt with null. */
  setPrompt(key: string, text: string | null): void {
    if (text === null) {
      this.prompt.style.display = 'none';
      return;
    }
    setDeviceHint(this.promptKey, key, key === 'E' ? 'B (Circle)' : key === 'F' ? 'D-pad up' : key);
    this.promptText.textContent = text;
    this.prompt.style.display = 'flex';
  }

  setWeaponName(name: string): void {
    this.weaponNameElement.textContent = name;
  }

  setScore(score: number): void {
    this.setScoreLine(`SCORE ${score}`);
  }

  setHealth(current: number, max: number): void {
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    this.healthFillElement.style.width = `${ratio * 100}%`;
    this.healthFillElement.style.background = ratio < 0.25 ? THREAT : ratio < 0.5 ? AMBER : ACCENT;
    this.healthTextElement.textContent = String(Math.ceil(ratio * 100));
    this.healthStatus.textContent = ratio < 0.25 ? 'CRITICAL' : ratio < 0.5 ? 'WOUNDED' : 'STABLE';
  }

  setVisibility(value: number | null): void {
    this.lightMeter.style.display = value === null ? 'none' : 'inline-block';
    if (value === null) return;
    this.lightMeter.style.opacity = String(value);
    this.lightMeter.setAttribute('aria-label', `Visibility to enemies: ${Math.round(value * 100)}%`);
  }

  setScoreVisible(visible: boolean): void {
    this.objectivePanel.style.display = visible ? 'block' : 'none';
  }

  setHealthVisible(visible: boolean): void {
    this.vitals.style.display = visible ? 'block' : 'none';
  }

  /** Camera yaw is in radians, with forward along local -Z. */
  update(dt: number, cameraYaw: number): void {
    this.compass.update(dt, bearingDeg(-Math.sin(cameraYaw), -Math.cos(cameraYaw)));
  }

  dispose(): void {
    this.compass.dispose();
    this.container.remove();
  }
}
