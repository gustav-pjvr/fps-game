import { Settings } from '../../settings/Settings.ts';
import { REBINDABLE_ACTIONS, ACTION_LABELS, formatKeyCode, type Action } from '../../input/actions.ts';
import { ACCENT, HAIRLINE, TEXT, attachScanSweep, createButton, createOverlay, createPanel, createPanelTitle } from './menuStyles.ts';
import { GRAPHICS_QUALITY_LABELS, GRAPHICS_QUALITY_ORDER, type GraphicsQuality } from '../../settings/graphicsQuality.ts';
import { CAMERA_FOV_MAX, CAMERA_FOV_MIN } from '../../core/config.ts';

/** Lobby overlay: master volume, mouse sensitivity, and rebindable key bindings - all persisted via Settings. */
export class SettingsPanel {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private listeningFor: Action | null = null;
  private readonly keyButtons = new Map<Action, HTMLButtonElement>();
  private readonly qualityButtons = new Map<GraphicsQuality, HTMLButtonElement>();
  private onCloseCallback: () => void = () => {};

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.listeningFor) {
      event.preventDefault();
      Settings.rebindKey(this.listeningFor, event.code);
      this.listeningFor = null;
      this.refreshKeyLabels();
      return;
    }
    // Escape closes the panel, same as clicking "Close" - only reacts while actually visible, and
    // only once no key-rebind capture (above) is in progress, so pressing Escape to *cancel* a
    // "Press a key…" capture doesn't also close the whole panel in the same keystroke.
    if (event.key === 'Escape' && this.overlay.style.display !== 'none') {
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
    labelEl.style.cssText = 'display:block; font-size:0.85rem; opacity:0.8; margin-bottom:6px;';

    const slider = document.createElement('input');
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
    labelEl.style.cssText = 'display:block; font-size:0.85rem; opacity:0.8; margin-bottom:6px;';
    row.appendChild(labelEl);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex; gap:8px;';

    for (const quality of GRAPHICS_QUALITY_ORDER) {
      const button = document.createElement('button');
      button.textContent = GRAPHICS_QUALITY_LABELS[quality];
      button.style.cssText = 'flex:1; padding:8px 0; font-size:0.85rem; cursor:pointer; border-radius:4px;';
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
      button.style.background = isActive ? ACCENT : 'rgba(255,255,255,0.06)';
      button.style.color = isActive ? '#08130a' : TEXT;
      button.style.border = `1px solid ${isActive ? ACCENT : HAIRLINE}`;
      button.style.fontWeight = isActive ? '600' : '400';
    }
  }

  private buildKeyBindSection(): HTMLDivElement {
    const section = document.createElement('div');
    const heading = document.createElement('div');
    heading.textContent = 'Key Bindings';
    heading.style.cssText =
      'font-size:0.85rem; opacity:0.8; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.05em;';
    section.appendChild(heading);

    for (const action of REBINDABLE_ACTIONS) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex; justify-content:space-between; align-items:center; padding:6px 0;' +
        ' border-bottom:1px solid rgba(255,255,255,0.06);';

      const label = document.createElement('span');
      label.textContent = ACTION_LABELS[action];
      label.style.cssText = 'font-size:0.9rem;';

      const keyButton = document.createElement('button');
      keyButton.style.cssText =
        'min-width:90px; padding:6px 10px; border-radius:4px; border:1px solid rgba(255,255,255,0.15);' +
        ' background:rgba(255,255,255,0.06); color:#eee; font-size:0.85rem; cursor:pointer;' +
        ' font-variant-numeric:tabular-nums;';
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
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.overlay.remove();
  }
}
