import { MONO_FONT, LABEL_CSS, ACCENT_INK, INK, SURFACE_RAISED } from '../theme.ts';
import { Settings } from '../../settings/Settings.ts';
import { REBINDABLE_ACTIONS, ACTION_LABELS, formatKeyCode, type Action } from '../../input/actions.ts';
import { ACCENT, HAIRLINE, TEXT, attachScanSweep, createButton, createOverlay, createPanel, createPanelTitle } from './menuStyles.ts';
import { GRAPHICS_QUALITY_LABELS, GRAPHICS_QUALITY_ORDER, type GraphicsQuality } from '../../settings/graphicsQuality.ts';
import { CAMERA_FOV_MAX, CAMERA_FOV_MIN } from '../../core/config.ts';

let sliderIdCounter = 0;

/** Lobby overlay: master volume, mouse sensitivity, and rebindable key bindings - all persisted via Settings. */
export class SettingsPanel {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private listeningFor: Action | null = null;
  private readonly keyButtons = new Map<Action, HTMLButtonElement>();
  private readonly qualityButtons = new Map<GraphicsQuality, HTMLButtonElement>();
  private onCloseCallback: () => void = () => {};

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Document-level listener, so it hears every keypress for the panel's whole lifetime: nothing
    // below may react while the panel is hidden. The capture branch used to run first, so a
    // capture left armed when the panel closed silently rebound that action to the next gameplay key.
    if (this.overlay.style.display === 'none') return;
    if (this.listeningFor) {
      event.preventDefault();
      // Escape cancels the "Press a key…" capture without binding anything, and returns before the
      // close branch below, so the same keystroke doesn't also close the whole panel.
      if (event.key !== 'Escape') Settings.rebindKey(this.listeningFor, event.code);
      this.listeningFor = null;
      this.refreshKeyLabels();
      return;
    }
    // Escape closes the panel, same as clicking "Close".
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onCloseCallback();
    }
  };

  /** onVolumeChange/onGraphicsQualityChange/onFovChange let the caller push changes into a live
   * match in real time - Settings.setMasterVolume/setGraphicsQuality/setFov alone only persist the
   * value for the *next* SoundEngine/Game/camera to read, they never touch an already-running one
   * on their own. Omit any of them when there's no live match to update (e.g. the lobby, which has
   * no SoundEngine, Game, or camera yet). FOV is additionally re-read live every frame by
   * WeaponManager.updateAim once gameplay resumes (see Settings.getFov's own comment) -
   * onFovChange here only covers the instant preview while this panel itself is still open (and
   * gameplay is therefore frozen behind it, same as every other pause-menu overlay). */
  constructor(
    root: HTMLElement,
    onClose: () => void,
    onVolumeChange?: (value: number) => void,
    onGraphicsQualityChange?: (quality: GraphicsQuality) => void,
    onFovChange?: (value: number) => void,
  ) {
    this.overlay = createOverlay();
    this.onCloseCallback = onClose;

    const panel = createPanel();
    this.panel = panel;
    panel.style.width = '420px';
    panel.appendChild(createPanelTitle('SETTINGS'));
    panel.appendChild(this.buildSliderRow('Master Volume', Settings.getMasterVolume(), 0, 1, 0.01, (value) => {
      Settings.setMasterVolume(value);
      onVolumeChange?.(value);
    }));
    panel.appendChild(this.buildSliderRow('Music Volume', Settings.getMusicVolume(), 0, 1, 0.01, (value) => Settings.setMusicVolume(value)));
    panel.appendChild(this.buildSliderRow('Mouse Sensitivity', Settings.getMouseSensitivity(), 0.1, 3, 0.05, (value) =>
      Settings.setMouseSensitivity(value),
    ));
    panel.appendChild(this.buildSliderRow('Field of View', Settings.getFov(), CAMERA_FOV_MIN, CAMERA_FOV_MAX, 1, (value) => {
      Settings.setFov(value);
      onFovChange?.(value);
    }));
    panel.appendChild(this.buildGraphicsQualitySection(onGraphicsQualityChange));
    panel.appendChild(this.buildKeyBindSection());

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:flex-end; gap:10px; margin-top:24px;';
    const resetButton = createButton('Reset Keys');
    resetButton.addEventListener('click', () => {
      Settings.resetKeyBindings();
      this.refreshKeyLabels();
    });
    const closeButton = createButton('Close', 'primary');
    closeButton.addEventListener('click', onClose);
    footer.append(resetButton, closeButton);
    panel.appendChild(footer);

    this.overlay.appendChild(panel);
    root.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKeyDown);
  }

  private buildSliderRow(
    label: string,
    initialValue: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:18px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = `display:block; ${LABEL_CSS} margin-bottom:6px;`;

    const slider = document.createElement('input');
    // Unique per panel: the lobby and a live match each build their own SettingsPanel.
    slider.id = `settings-slider-${++sliderIdCounter}`;
    labelEl.htmlFor = slider.id;
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(initialValue);
    slider.style.cssText = `width:100%; accent-color:${ACCENT};`;
    slider.addEventListener('input', () => onChange(parseFloat(slider.value)));

    row.append(labelEl, slider);
    return row;
  }

  /** Low/Medium/High shadow quality + resolution scaling (see settings/graphicsQuality.ts) - a
   * segmented button group rather than a slider, since these are named presets, not a continuous
   * range. Applies immediately to a live match via onGraphicsQualityChange (see Game.applyGraphicsQuality);
   * with no live match (the lobby), it simply takes effect on the next one started. */
  private buildGraphicsQualitySection(onGraphicsQualityChange?: (quality: GraphicsQuality) => void): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:18px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = 'Graphics Quality';
    labelEl.style.cssText = `display:block; ${LABEL_CSS} margin-bottom:6px;`;
    row.appendChild(labelEl);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex; gap:8px;';

    for (const quality of GRAPHICS_QUALITY_ORDER) {
      const button = createButton(GRAPHICS_QUALITY_LABELS[quality]);
      button.style.cssText += 'flex:1; padding:12px 0;';
      button.addEventListener('click', () => {
        Settings.setGraphicsQuality(quality);
        onGraphicsQualityChange?.(quality);
        this.refreshGraphicsQualityButtons();
      });
      this.qualityButtons.set(quality, button);
      buttonRow.appendChild(button);
    }

    row.appendChild(buttonRow);

    this.refreshGraphicsQualityButtons();
    return row;
  }

  private refreshGraphicsQualityButtons(): void {
    const active = Settings.getGraphicsQuality();
    for (const [quality, button] of this.qualityButtons) {
      const isActive = quality === active;
      button.style.background = isActive ? ACCENT : SURFACE_RAISED;
      button.style.color = isActive ? ACCENT_INK : TEXT;
      button.style.border = `1px solid ${isActive ? ACCENT : HAIRLINE}`;
      button.style.fontWeight = isActive ? '600' : '400';
    }
  }

  private buildKeyBindSection(): HTMLDivElement {
    const section = document.createElement('div');
    const heading = document.createElement('div');
    heading.textContent = 'Key Bindings';
    heading.style.cssText =
      `${LABEL_CSS} margin-bottom:8px;`;
    section.appendChild(heading);

    for (const action of REBINDABLE_ACTIONS) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex; justify-content:space-between; align-items:center; padding:6px 0;' +
        ` border-bottom:1px solid ${HAIRLINE};`;

      const label = document.createElement('span');
      label.textContent = ACTION_LABELS[action];
      label.style.cssText = 'font-size:0.9rem;';

      const keyButton = createButton('');
      keyButton.style.cssText =
        `min-width:90px; padding:6px 10px; border-radius:2px; border:1px solid ${HAIRLINE};` +
        ` background:${SURFACE_RAISED}; color:${INK}; font-size:0.85rem; cursor:pointer;` +
        ` font-family:${MONO_FONT}; font-weight:400; font-variant-numeric:tabular-nums;`;
      keyButton.addEventListener('click', () => {
        this.listeningFor = action;
        keyButton.textContent = 'Press a key…';
      });

      this.keyButtons.set(action, keyButton);
      row.append(label, keyButton);
      section.appendChild(row);
    }

    this.refreshKeyLabels();
    return section;
  }

  private refreshKeyLabels(): void {
    const codeByAction = new Map<Action, string>();
    for (const [code, action] of Object.entries(Settings.getKeyBindings())) codeByAction.set(action, code);
    for (const [action, button] of this.keyButtons) {
      const code = codeByAction.get(action);
      button.textContent = code ? formatKeyCode(code) : '—';
    }
  }

  show(): void {
    this.overlay.style.display = 'flex';
    attachScanSweep(this.panel);
  }

  hide(): void {
    this.overlay.style.display = 'none';
    // Disarm any "Press a key…" capture still pending, and put its button label back.
    if (this.listeningFor) {
      this.listeningFor = null;
      this.refreshKeyLabels();
    }
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.overlay.remove();
  }
}
