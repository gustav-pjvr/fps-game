import { MONO_FONT, LABEL_CSS, INK, SURFACE_RAISED } from '../theme.ts';
import { ModalScope } from './modalScope.ts';
import { ACCENT, attachScanSweep, closeOnBackdropClick, createButton, createOverlay, createPanel, createPanelTitle, TEXT, BG_RAISED, HAIRLINE } from './menuStyles.ts';
import { GOOSE_EXPLOSION_DIFFICULTIES, GOOSE_EXPLOSION_DIFFICULTY_LABELS, MATCH_MAPS, MATCH_MAP_LABELS, MATCH_MAP_DESCRIPTIONS, MATCH_WEATHERS, MATCH_WEATHER_LABELS, type GooseExplosionDifficulty, type MatchMap, type MatchWeather } from '../../core/config.ts';

export interface MatchSetupConfig {
  enemyCount: number;
  targetCount: number;
  gooseDifficulty: GooseExplosionDifficulty;
  map: MatchMap;
  /** The Valley's weather (Dusk, Night or Fog), the same choice a Create Room host has. Ignored on
   * the Facility, which is indoors and has its own look. */
  weather: MatchWeather;
  /** Goose Horde wave-survival mode (see core/config.ts's HORDE_WAVE_TABLE) - when true,
   * enemyCount/targetCount are ignored (no regular AI encounters spawn) and a HordeGooseManager
   * runs instead, see Game.ts's create(). */
  hordeMode: boolean;
  /** Enemy AI v2 step 6: the pacing director runs the enemies (see Game.ts's director), so
   * enemyCount/targetCount are ignored here too. Never together with hordeMode. */
  directorMode: boolean;
  /** Operation Uplink (docs/uplink.md): breach, fetch, defend and extract under Director pressure.
   * Runs the director itself, so the counts above are ignored. Never together with hordeMode or
   * directorMode. */
  missionMode: boolean;
}

let setupStyleInjected = false;
function ensureSetupStyleInjected(): void {
  if (setupStyleInjected) return;
  setupStyleInjected = true;
  const style = document.createElement('style');
  style.textContent =
    `.play-setup-mode-card { border:1px solid ${HAIRLINE}; }` +
    // The invisible radio covers its card and sits above the card's text, so a click lands on it.
    '.play-setup-mode-input { position:absolute; inset:0; z-index:1; width:100%; height:100%; padding:0; margin:0; opacity:0; cursor:pointer; }' +
    `.play-setup-mode-input:checked + .play-setup-mode-card { border-color:${ACCENT}; box-shadow:inset 0 0 0 1px ${ACCENT}; }` +
    `.play-setup-mode-input:focus-visible + .play-setup-mode-card { outline:2px solid ${ACCENT}; outline-offset:3px; }` +
    '@media (max-width: 480px) { .play-setup-counts { flex-direction:column; gap:0 !important; } }';
  document.head.appendChild(style);
}

/** Shown after clicking Play: lets the player choose how many enemies/targets spawn this match,
 * plus how big a goose's explosion is (single-player has no host to pick this for it - see the
 * same selector in CreateRoomScreen/matchEndScreen). */
export class PlaySetupModal {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly enemyInput: HTMLInputElement;
  private readonly targetInput: HTMLInputElement;
  private readonly gooseDifficultySelect: HTMLSelectElement;
  private readonly mapSelect: HTMLSelectElement;
  private readonly weatherSelect: HTMLSelectElement;
  private readonly mapDescription = document.createElement('div');
  private readonly hordeModeRadio: HTMLInputElement;
  private readonly directorModeRadio: HTMLInputElement;
  private readonly missionModeRadio: HTMLInputElement;
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly scope = new ModalScope();

  constructor(
    root: HTMLElement,
    defaults: MatchSetupConfig,
    maxCount: number,
    onStart: (config: MatchSetupConfig) => void,
    onCancel: () => void,
  ) {
    ensureSetupStyleInjected();
    this.overlay = createOverlay();
    closeOnBackdropClick(this.overlay, onCancel);

    const panel = createPanel();
    this.panel = panel;
    panel.style.width = '520px';
    // Taller than the shared 80vh cap, so the footer buttons show at 1280 by 720 without scrolling.
    panel.style.maxHeight = '94vh';
    panel.style.padding = '24px 30px';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Match setup');
    panel.appendChild(createPanelTitle('MATCH SETUP'));

    const modeGroup = document.createElement('fieldset');
    modeGroup.setAttribute('role', 'radiogroup');
    modeGroup.style.cssText = 'border:0; padding:0; margin:0 0 14px; min-width:0;';
    const modeLabel = document.createElement('legend');
    modeLabel.textContent = 'Mode';
    modeLabel.style.cssText = `${LABEL_CSS} margin-bottom:8px;`;
    const modeGrid = document.createElement('div');
    modeGrid.style.cssText = 'display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px;';
    const selectedMode = defaults.hordeMode ? 'horde' : defaults.directorMode ? 'director' : defaults.missionMode ? 'mission' : 'elimination';
    const eliminationRadio = this.buildModeCard(modeGrid, 'elimination', 'Elimination', 'Clear the hostiles and targets', selectedMode);
    this.hordeModeRadio = this.buildModeCard(modeGrid, 'horde', 'Goose Horde', 'Survive 12 waves, bosses on 6 and 12', selectedMode);
    this.directorModeRadio = this.buildModeCard(modeGrid, 'director', 'Showdown', 'Five acts and a finale, paced by the Director', selectedMode);
    this.missionModeRadio = this.buildModeCard(modeGrid, 'mission', 'Operation Uplink', 'Breach, fetch the core, defend, extract', selectedMode);
    modeGroup.append(modeLabel, modeGrid);
    panel.appendChild(modeGroup);

    const counts = document.createElement('div');
    counts.className = 'play-setup-counts';
    counts.style.cssText = 'display:flex; gap:12px;';
    const countLimit = Math.min(50, maxCount);
    this.enemyInput = this.buildCountRow(counts, 'Enemies', defaults.enemyCount, countLimit);
    this.targetInput = this.buildCountRow(counts, 'Targets', defaults.targetCount, countLimit);
    panel.appendChild(counts);
    this.gooseDifficultySelect = this.buildDifficultyRow(panel, defaults.gooseDifficulty);
    // Map and Weather share a line so the panel stays short enough to show its buttons.
    const mapWeatherRow = document.createElement('div');
    mapWeatherRow.style.cssText = 'display:flex; gap:12px; align-items:flex-start;';
    this.mapSelect = this.buildMapRow(mapWeatherRow, defaults.map);
    this.weatherSelect = this.buildWeatherRow(mapWeatherRow, defaults.weather, this.mapSelect);
    panel.appendChild(mapWeatherRow);
    panel.appendChild(this.mapDescription);

    const updateCountInputs = () => {
      const disabled = !eliminationRadio.checked;
      for (const input of [this.enemyInput, this.targetInput]) {
        const row = input.closest('fieldset')!;
        row.disabled = disabled;
        row.style.opacity = disabled ? '0.4' : '1';
        input.style.cursor = disabled ? 'not-allowed' : '';
      }
    };
    modeGroup.addEventListener('change', updateCountInputs);
    updateCountInputs();

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:flex-end; align-items:stretch; gap:10px; margin-top:16px;';

    const cancelButton = createButton('Cancel');
    cancelButton.style.cssText += 'height:50px; flex:1; min-width:0; padding:12px;';
    cancelButton.addEventListener('click', onCancel);

    const startButton = createButton('Start Match', 'primary');
    startButton.style.cssText += 'height:50px; flex:1; min-width:0; padding:12px;';
    startButton.addEventListener('click', () => {
      onStart({
        enemyCount: this.clampInput(this.enemyInput, countLimit),
        targetCount: this.clampInput(this.targetInput, countLimit),
        gooseDifficulty: this.gooseDifficultySelect.value as GooseExplosionDifficulty,
        map: this.mapSelect.value as MatchMap,
        weather: this.weatherSelect.value as MatchWeather,
        hordeMode: this.hordeModeRadio.checked,
        directorMode: this.directorModeRadio.checked,
        missionMode: this.missionModeRadio.checked,
      });
    });

    footer.append(cancelButton, startButton);
    panel.appendChild(footer);

    this.overlay.appendChild(panel);
    root.appendChild(this.overlay);

    // Escape cancels, Enter starts the match - only while this modal is actually visible, so it
    // doesn't steal keystrokes meant for whatever's behind it.
    this.onKeyDown = (event) => {
      if (this.overlay.style.display === 'none') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        startButton.click();
      }
    };
    document.addEventListener('keydown', this.onKeyDown);
  }

  private buildModeCard(grid: HTMLDivElement, value: string, name: string, description: string, selectedMode: string): HTMLInputElement {
    const label = document.createElement('label');
    label.style.cssText = 'position:relative; display:flex; min-width:0; cursor:pointer;';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'match-setup-mode';
    radio.value = value;
    radio.checked = value === selectedMode;
    radio.className = 'play-setup-mode-input';
    radio.setAttribute('aria-label', `${name}: ${description}`);
    const card = document.createElement('span');
    card.className = 'play-setup-mode-card';
    card.style.cssText =
      `display:flex; flex:1; min-width:0; flex-direction:column; gap:6px; padding:12px;` +
      ` background:${BG_RAISED}; border-radius:2px; color:${TEXT};`;
    const title = document.createElement('span');
    title.textContent = name;
    title.style.cssText = 'font-size:0.9rem; font-weight:600; white-space:nowrap;';
    const detail = document.createElement('span');
    detail.textContent = description;
    detail.style.cssText = 'font-size:0.8rem; line-height:1.4; opacity:0.75;';
    card.append(title, detail);
    label.append(radio, card);
    grid.appendChild(label);
    return radio;
  }

  private buildDifficultyRow(panel: HTMLDivElement, defaultValue: GooseExplosionDifficulty): HTMLSelectElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:16px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = 'Goose Explosions';
    labelEl.htmlFor = 'match-setup-goose-difficulty';
    labelEl.style.cssText = `display:block; ${LABEL_CSS} margin-bottom:6px;`;

    const select = document.createElement('select');
    select.id = 'match-setup-goose-difficulty';
    select.name = 'gooseDifficulty';
    select.style.cssText =
      `width:100%; box-sizing:border-box; padding:8px 10px; font-size:0.95rem; font-weight:600; color:${TEXT};` +
      ` background:${BG_RAISED}; border:1px solid ${HAIRLINE}; border-radius:2px; cursor:pointer;` +
      // See CreateRoomScreen.ts's identical select styling for why this is needed - without it the
      // native dropdown popup ignores the dark theme above and renders illegible light-on-light text.
      ' color-scheme:dark;';
    for (const difficulty of GOOSE_EXPLOSION_DIFFICULTIES) {
      const option = document.createElement('option');
      option.value = difficulty;
      option.textContent = GOOSE_EXPLOSION_DIFFICULTY_LABELS[difficulty];
      if (difficulty === defaultValue) option.selected = true;
      select.appendChild(option);
    }

    row.append(labelEl, select);
    panel.appendChild(row);
    return select;
  }

  private buildMapRow(panel: HTMLElement, defaultValue: MatchMap): HTMLSelectElement {
    const row = document.createElement('div');
    row.style.cssText = 'flex:1; min-width:0;';
    const label = document.createElement('label');
    label.textContent = 'Map';
    label.htmlFor = 'match-setup-map';
    label.style.cssText = `display:block; ${LABEL_CSS} margin-bottom:6px;`;
    const select = document.createElement('select');
    select.id = 'match-setup-map';
    select.name = 'map';
    select.style.cssText = this.gooseDifficultySelect.style.cssText;
    for (const map of MATCH_MAPS) {
      const option = document.createElement('option');
      option.value = map;
      option.textContent = MATCH_MAP_LABELS[map];
      if (map === defaultValue) option.selected = true;
      select.appendChild(option);
    }
    const description = this.mapDescription;
    description.style.cssText = 'font-size:0.8rem; opacity:0.7; margin:6px 0 16px;';
    const updateDescription = () => {
      description.textContent = MATCH_MAP_DESCRIPTIONS[select.value as MatchMap];
    };
    select.addEventListener('change', updateDescription);
    updateDescription();
    row.append(label, select);
    panel.appendChild(row);
    return select;
  }

  /** Same look as the Map select. Weather only applies to the Valley, so on the Facility the row
   * greys out and reads "Indoor", as Create Room's does. */
  private buildWeatherRow(panel: HTMLElement, defaultValue: MatchWeather, mapSelect: HTMLSelectElement): HTMLSelectElement {
    const row = document.createElement('div');
    row.style.cssText = 'flex:1; min-width:0;';
    const label = document.createElement('label');
    label.textContent = 'Weather';
    label.htmlFor = 'match-setup-weather';
    label.style.cssText = `display:block; ${LABEL_CSS} margin-bottom:6px;`;
    const select = document.createElement('select');
    select.id = 'match-setup-weather';
    select.name = 'weather';
    select.style.cssText = this.gooseDifficultySelect.style.cssText;
    for (const weather of MATCH_WEATHERS) {
      const option = document.createElement('option');
      option.value = weather;
      option.textContent = MATCH_WEATHER_LABELS[weather];
      if (weather === defaultValue) option.selected = true;
      select.appendChild(option);
    }
    const updateForMap = () => {
      const indoor = (mapSelect.value as MatchMap) === 'facility';
      select.disabled = indoor;
      label.textContent = indoor ? 'Indoor' : 'Weather';
      row.style.opacity = indoor ? '0.4' : '1';
      select.style.cursor = indoor ? 'not-allowed' : 'pointer';
    };
    mapSelect.addEventListener('change', updateForMap);
    updateForMap();
    row.append(label, select);
    panel.appendChild(row);
    return select;
  }

  private buildCountRow(panel: HTMLDivElement, label: string, defaultValue: number, max: number): HTMLInputElement {
    const row = document.createElement('fieldset');
    row.style.cssText = 'flex:1; min-width:0; border:0; padding:0; margin:0 0 16px;';

    const labelEl = document.createElement('label');
    const id = `match-setup-${label.toLowerCase()}`;
    labelEl.textContent = `${label} (0 to ${max})`;
    labelEl.htmlFor = id;
    labelEl.style.cssText = `display:block; ${LABEL_CSS} margin-bottom:6px;`;

    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.name = label.toLowerCase();
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.min = '0';
    input.max = String(max);
    input.value = String(Math.max(0, Math.min(max, defaultValue)));
    input.style.cssText =
      `flex:1; min-width:0; width:100%; box-sizing:border-box; padding:8px 10px; border-radius:2px; font-family:${MONO_FONT}; font-size:0.95rem;` +
      ` border:1px solid ${HAIRLINE}; background:${SURFACE_RAISED}; color:${INK};`;

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex; align-items:stretch; gap:6px;';
    const fewer = createButton('−');
    const more = createButton('+');
    for (const [button, amount, action] of [[fewer, -1, 'Fewer'], [more, 1, 'More']] as const) {
      button.type = 'button';
      button.setAttribute('aria-label', `${action} ${label.toLowerCase()}`);
      button.style.cssText += 'padding:8px; flex:0 0 32px; letter-spacing:0;';
      button.addEventListener('click', () => {
        input.value = String(Math.max(0, Math.min(max, this.clampInput(input, max) + amount)));
      });
    }
    controls.append(fewer, input, more);
    row.append(labelEl, controls);
    panel.appendChild(row);
    return input;
  }

  private clampInput(input: HTMLInputElement, max: number): number {
    const raw = Math.round(parseFloat(input.value));
    if (Number.isNaN(raw)) return 0;
    return Math.max(0, Math.min(max, raw));
  }

  show(): void {
    this.overlay.style.display = 'flex';
    attachScanSweep(this.panel);
    this.scope.enter(this.overlay, this.panel.querySelector<HTMLInputElement>('input[type="radio"]:checked'));
  }

  hide(): void {
    this.overlay.style.display = 'none';
    this.scope.leave();
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.scope.leave();
    this.overlay.remove();
  }
}
