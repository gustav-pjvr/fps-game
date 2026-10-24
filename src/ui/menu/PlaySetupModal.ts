import { MONO_FONT, LABEL_CSS, INK, SURFACE_RAISED } from '../theme.ts';
import { attachScanSweep, createButton, createOverlay, createPanel, createPanelTitle, TEXT, BG_RAISED, HAIRLINE } from './menuStyles.ts';
import { GOOSE_EXPLOSION_DIFFICULTIES, GOOSE_EXPLOSION_DIFFICULTY_LABELS, MATCH_MAPS, MATCH_MAP_LABELS, MATCH_MAP_DESCRIPTIONS, type GooseExplosionDifficulty, type MatchMap } from '../../core/config.ts';
import { isSinglePlayerModeAllowedOnMap } from '../../core/gameModes.ts';

export interface MatchSetupConfig {
  enemyCount: number;
  targetCount: number;
  gooseDifficulty: GooseExplosionDifficulty;
  map: MatchMap;
  /** Goose Horde wave-survival mode (see core/config.ts's HORDE_WAVE_TABLE) - when true,
   * enemyCount/targetCount are ignored (no regular AI encounters spawn) and a HordeGooseManager
   * runs instead, see Game.ts's create(). */
  hordeMode: boolean;
  /** Enemy AI v2 step 6: the pacing director runs the enemies (see Game.ts's director), so
   * enemyCount/targetCount are ignored here too. Never together with hordeMode. */
  directorMode: boolean;
  /** The Uplink mission (docs/visual-overhaul.md, phase 4): three watch-tower uplinks to bring
   * online under Director pressure, then extraction. Runs the director itself, so the counts above
   * are ignored. Never together with hordeMode or directorMode. */
  missionMode: boolean;
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
  private readonly hordeModeCheckbox: HTMLInputElement;
  private readonly directorModeCheckbox: HTMLInputElement;
  private readonly missionModeCheckbox: HTMLInputElement;
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(
    root: HTMLElement,
    defaults: MatchSetupConfig,
    maxCount: number,
    onStart: (config: MatchSetupConfig) => void,
    onCancel: () => void,
  ) {
    this.overlay = createOverlay();

    const panel = createPanel();
    this.panel = panel;
    panel.style.width = '360px';
    panel.appendChild(createPanelTitle('MATCH SETUP'));

    this.enemyInput = this.buildCountRow(panel, 'Enemies', defaults.enemyCount, maxCount);
    this.targetInput = this.buildCountRow(panel, 'Targets', defaults.targetCount, maxCount);
    this.gooseDifficultySelect = this.buildDifficultyRow(panel, defaults.gooseDifficulty);
    this.mapSelect = this.buildMapRow(panel, defaults.map);

    this.hordeModeCheckbox = this.buildCheckboxRow(panel, 'Goose Horde: survive 10 waves', defaults.hordeMode);
    this.directorModeCheckbox = this.buildCheckboxRow(
      panel,
      'Director: waves paced to the fight',
      defaults.directorMode,
    );
    this.missionModeCheckbox = this.buildCheckboxRow(
      panel,
      'Uplink mission: bring 3 towers online, then extract',
      defaults.missionMode,
    );
    // Three different ways to run the match, so at most one of them.
    const exclusiveModes = [this.hordeModeCheckbox, this.directorModeCheckbox, this.missionModeCheckbox];
    const updateCountInputs = () => {
      const disabled = exclusiveModes.some((checkbox) => checkbox.checked);
      for (const input of [this.enemyInput, this.targetInput]) {
        input.disabled = disabled;
        // A ticked mode sets its own enemies and targets, so the counts grey out instead of saying so.
        if (input.parentElement) input.parentElement.style.opacity = disabled ? '0.4' : '1';
        input.style.cursor = disabled ? 'not-allowed' : '';
      }
    };
    for (const checkbox of exclusiveModes) {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          for (const other of exclusiveModes) if (other !== checkbox) other.checked = false;
        }
        updateCountInputs();
      });
    }
    const valleyOnlyModes = [
      { mode: 'horde', checkbox: this.hordeModeCheckbox },
      { mode: 'mission', checkbox: this.missionModeCheckbox },
    ] as const;
    const valleyOnlyNotes = valleyOnlyModes.map(({ checkbox }) => {
      const note = document.createElement('span');
      note.textContent = 'Valley only';
      note.style.cssText = 'font-size:0.75rem; opacity:0.7;';
      checkbox.parentElement?.appendChild(note);
      return note;
    });
    const updateMapOptions = () => {
      const map = this.mapSelect.value as MatchMap;
      valleyOnlyModes.forEach(({ mode, checkbox }, index) => {
        checkbox.disabled = !isSinglePlayerModeAllowedOnMap(mode, map);
        if (checkbox.disabled) checkbox.checked = false;
        valleyOnlyNotes[index]!.style.display = checkbox.disabled ? '' : 'none';
      });
      updateCountInputs();
    };
    this.mapSelect.addEventListener('change', updateMapOptions);
    updateMapOptions();

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:flex-end; gap:10px; margin-top:24px;';

    const cancelButton = createButton('Cancel');
    cancelButton.addEventListener('click', onCancel);

    const startButton = createButton('Start Match', 'primary');
    startButton.addEventListener('click', () => {
      onStart({
        enemyCount: this.clampInput(this.enemyInput, maxCount),
        targetCount: this.clampInput(this.targetInput, maxCount),
        gooseDifficulty: this.gooseDifficultySelect.value as GooseExplosionDifficulty,
        map: this.mapSelect.value as MatchMap,
        hordeMode: this.hordeModeCheckbox.checked,
        directorMode: this.directorModeCheckbox.checked,
        missionMode: this.missionModeCheckbox.checked,
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
      } else if (event.key === 'Enter') {
        event.preventDefault();
        startButton.click();
      }
    };
    document.addEventListener('keydown', this.onKeyDown);
  }

  private buildCheckboxRow(panel: HTMLDivElement, text: string, checked: boolean): HTMLInputElement {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:0.9rem; cursor:pointer; margin-bottom:8px;';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    const label = document.createElement('span');
    label.textContent = text;
    row.append(checkbox, label);
    panel.appendChild(row);
    return checkbox;
  }

  private buildDifficultyRow(panel: HTMLDivElement, defaultValue: GooseExplosionDifficulty): HTMLSelectElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:16px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = 'Goose explosions';
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

  private buildMapRow(panel: HTMLDivElement, defaultValue: MatchMap): HTMLSelectElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:16px;';
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
    const description = document.createElement('div');
    description.style.cssText = 'font-size:0.8rem; opacity:0.7; margin-top:6px;';
    const updateDescription = () => {
      description.textContent = MATCH_MAP_DESCRIPTIONS[select.value as MatchMap];
    };
    select.addEventListener('change', updateDescription);
    updateDescription();
    row.append(label, select, description);
    panel.appendChild(row);
    return select;
  }

  private buildCountRow(panel: HTMLDivElement, label: string, defaultValue: number, max: number): HTMLInputElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:16px;';

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
    input.value = String(defaultValue);
    input.style.cssText =
      `width:100%; box-sizing:border-box; padding:8px 10px; border-radius:2px; font-family:${MONO_FONT}; font-size:0.95rem;` +
      ` border:1px solid ${HAIRLINE}; background:${SURFACE_RAISED}; color:${INK};`;

    row.append(labelEl, input);
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
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.overlay.remove();
  }
}
