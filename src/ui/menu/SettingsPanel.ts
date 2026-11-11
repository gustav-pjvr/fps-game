import { MONO_FONT, LABEL_CSS, ACCENT_INK, INK, INK_DIM, INK_FAINT, SURFACE_RAISED } from '../theme.ts';
import { Settings } from '../../settings/Settings.ts';
import { GAMEPAD_MAPPING } from '../../input/GamepadInput.ts';
import { REBINDABLE_ACTIONS, ACTION_LABELS, formatKeyCode, type Action } from '../../input/actions.ts';
import { ACCENT, HAIRLINE, attachScanSweep, closeOnBackdropClick, createButton, createOverlay, createPanel, createPanelTitle } from './menuStyles.ts';
import { GRAPHICS_QUALITY_LABELS, GRAPHICS_QUALITY_ORDER, type GraphicsQuality } from '../../settings/graphicsQuality.ts';
import { CAMERA_FOV_MAX, CAMERA_FOV_MIN } from '../../core/config.ts';
import { ModalScope } from './modalScope.ts';

type TabId = 'general' | 'audio' | 'keyboard' | 'controller';
const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'audio', label: 'Audio' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'controller', label: 'Controller' },
];

/** One line under the segmented buttons, describing what the selected preset turns on (see GRAPHICS_QUALITY_PRESETS). */
const GRAPHICS_QUALITY_HINTS: Record<GraphicsQuality, string> = {
  low: 'No shadows or post effects. Fastest.',
  medium: 'Shadows, bloom and anti-aliasing. Recommended.',
  high: 'Adds ambient occlusion and environment lighting.',
};

let sliderIdCounter = 0;
let panelIdCounter = 0;
/** The tab the last panel was left on. Shared by the lobby's and a match's panel, so reopening Settings
 * from either shows the tab the player was last on. */
let lastOpenTab: TabId = 'general';

/** One-time injected rules: the tab underline, key caps, quality buttons and switches need
 * pseudo-classes and pseudo-elements that inline `style.cssText` can't declare. Every selector is
 * scoped under `.settings-panel` so it outranks menuStyles.ts's `.menu-surface button` font rule. */
let settingsStyleInjected = false;
function ensureSettingsStyleInjected(): void {
  if (settingsStyleInjected) return;
  settingsStyleInjected = true;
  const style = document.createElement('style');
  style.textContent =
    '.settings-panel .settings-tablist { display: flex; gap: 4px; border-bottom: 1px solid ' + HAIRLINE + '; margin-bottom: 20px; flex: none; }' +
    '.settings-panel .settings-tab {' +
    '  margin: 0 0 -1px; padding: 12px 18px; background: transparent; border: 0; border-bottom: 2px solid transparent; border-radius: 0;' +
    `  color: ${INK_DIM}; cursor: pointer; font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;` +
    '  transition: color 150ms ease-out, border-color 150ms ease-out;' +
    '}' +
    // A phone-width panel has no room for four padded tabs: they share the row equally instead.
    '@media (max-width: 560px) { .settings-panel .settings-tab { flex: 1 1 0; min-width: 0; padding: 12px 2px; letter-spacing: 0.04em; font-size: 10px; } }' +
    `.settings-panel .settings-tab:hover { color: ${INK}; }` +
    `.settings-panel .settings-tab[aria-selected="true"] { color: ${INK}; border-bottom-color: ${ACCENT}; }` +
    // menuStyles.ts colours a focused button's border with !important; an unselected tab must not read as selected.
    '.settings-panel .settings-tab:not([aria-selected="true"]):focus-visible { border-bottom-color: transparent !important; }' +
    '.settings-panel .settings-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }' +
    '.settings-panel .settings-tabpanel { display: flex; flex-direction: column; gap: 20px; }' +
    '.settings-panel .settings-tabpanel[hidden] { display: none; }' +
    // Sliders: label left, live value right, the range input full width below.
    '.settings-panel .settings-slider-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }' +
    `.settings-panel .settings-slider-value { font-family: ${MONO_FONT}; font-variant-numeric: tabular-nums; font-size: 0.8rem; color: ${INK}; }` +
    `.settings-panel .settings-slider { display: block; width: 100%; margin: 0; accent-color: ${ACCENT}; }` +
    // Graphics quality: segmented buttons, the selected one drawn like a selected Loadout tile.
    '.settings-panel .settings-seg-row { display: flex; gap: 8px; }' +
    '.settings-panel .settings-seg {' +
    '  flex: 1; padding: 12px 0; cursor: pointer; border-radius: 2px; font-size: 11px; font-weight: 700;' +
    `  letter-spacing: 0.16em; text-transform: uppercase; color: ${INK}; background: ${SURFACE_RAISED}; border: 1px solid ${HAIRLINE};` +
    '  transition: border-color 150ms ease-out;' +
    '}' +
    `.settings-panel .settings-seg:hover { border-color: ${INK_FAINT}; }` +
    `.settings-panel .settings-seg[aria-pressed="true"] { border-color: ${ACCENT}; box-shadow: inset 0 0 0 1px ${ACCENT}; }` +
    `.settings-panel .settings-hint { margin-top: 10px; font-size: 0.85rem; line-height: 1.4; color: ${INK_DIM}; }` +
    // Keyboard: two columns filled top to bottom, so movement keys share a column.
    '.settings-panel .settings-key-grid { display: grid; grid-auto-flow: column; column-gap: 32px; }' +
    `.settings-panel .settings-key-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid ${HAIRLINE}; font-size: 0.9rem; }` +
    '.settings-panel .settings-keycap {' +
    `  min-width: 96px; padding: 6px 10px; border-radius: 2px; border: 1px solid ${HAIRLINE}; background: ${SURFACE_RAISED}; color: ${INK};` +
    `  font-family: ${MONO_FONT}; font-size: 0.8rem; font-weight: 400; font-variant-numeric: tabular-nums; cursor: pointer;` +
    '  transition: border-color 150ms ease-out;' +
    '}' +
    `.settings-panel .settings-keycap:hover { border-color: ${INK_FAINT}; }` +
    `.settings-panel .settings-keycap[data-listening="true"] { border-color: ${ACCENT}; box-shadow: inset 0 0 0 1px ${ACCENT}; }` +
    // Controller: switches and the mapping list.
    '.settings-panel .settings-switch {' +
    '  display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 9px 0; cursor: pointer;' +
    `  background: transparent; border: 0; border-bottom: 1px solid ${HAIRLINE}; border-radius: 0; color: ${INK}; font-size: 0.9rem; font-weight: 400; text-align: left;` +
    '}' +
    '.settings-panel .settings-switch-track {' +
    `  position: relative; flex: none; width: 38px; height: 20px; box-sizing: border-box; border-radius: 10px; border: 1px solid ${HAIRLINE}; background: ${SURFACE_RAISED};` +
    '  transition: background-color 150ms ease-out, border-color 150ms ease-out;' +
    '}' +
    '.settings-panel .settings-switch-track::after {' +
    `  content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: ${INK_DIM};` +
    '  transition: transform 150ms ease-out, background-color 150ms ease-out;' +
    '}' +
    `.settings-panel .settings-switch[aria-checked="true"] .settings-switch-track { background: ${ACCENT}; border-color: ${ACCENT}; }` +
    `.settings-panel .settings-switch[aria-checked="true"] .settings-switch-track::after { transform: translateX(18px); background: ${ACCENT_INK}; }` +
    '.settings-panel .settings-map { display: grid; grid-template-columns: max-content 1fr max-content 1fr; column-gap: 16px; row-gap: 4px; margin-top: 10px; font-size: 0.85rem; line-height: 1.45; }' +
    `.settings-panel .settings-map-key { color: ${INK}; font-weight: 600; }` +
    `.settings-panel .settings-map-desc { color: ${INK_DIM}; }` +
    '@media (prefers-reduced-motion: reduce) {' +
    '  .settings-panel .settings-tab, .settings-panel .settings-seg, .settings-panel .settings-keycap,' +
    '  .settings-panel .settings-switch-track, .settings-panel .settings-switch-track::after { transition: none; }' +
    '}';
  document.head.appendChild(style);
}

/** Lobby overlay: volume, mouse sensitivity, field of view, graphics quality, rebindable key bindings
 * and controller options, in four tabs - all persisted via Settings. */
export class SettingsPanel {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private listeningFor: Action | null = null;
  private readonly keyButtons = new Map<Action, HTMLButtonElement>();
  private readonly qualityButtons = new Map<GraphicsQuality, HTMLButtonElement>();
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private readonly tabPanels = new Map<TabId, HTMLDivElement>();
  /** Keeps Tab inside the panel while it is open and returns focus to the opener on close. */
  private readonly scope = new ModalScope();
  private qualityHint!: HTMLDivElement;
  private readonly instanceId = ++panelIdCounter;
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
    /** The effects volume, night mode or 3D audio changed: a running match re-reads them. */
    onAudioChange?: () => void,
  ) {
    ensureSettingsStyleInjected();
    this.overlay = createOverlay();
    this.overlay.addEventListener('gamepadback', (event) => {
      if (!this.listeningFor) return;
      event.preventDefault();
      this.listeningFor = null;
      this.refreshKeyLabels();
    });
    this.onCloseCallback = onClose;
    closeOnBackdropClick(this.overlay, onClose);

    const panel = createPanel();
    this.panel = panel;
    panel.classList.add('settings-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Settings');
    // Sized to fit a 1280x720 window with no scrolling: the tab bodies are laid out to fit inside it.
    panel.style.cssText += 'width:min(760px, 94vw); height:min(620px, 88vh); max-height:88vh; overflow:hidden;' +
      ' display:flex; flex-direction:column; padding:22px 30px 24px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:14px; flex:none;';
    const title = createPanelTitle('SETTINGS');
    title.style.marginBottom = '0';
    const closeButton = createButton('Close');
    closeButton.style.padding = '11px 20px';
    closeButton.addEventListener('click', onClose);
    header.append(title, closeButton);
    panel.appendChild(header);

    panel.appendChild(this.buildTabList());
    const body = document.createElement('div');
    body.className = 'settings-body';
    // Focusable, so a keyboard can scroll it on a window too short for the Controller tab.
    body.tabIndex = 0;
    body.setAttribute('aria-label', 'Settings options');
    panel.appendChild(body);

    const general = this.addTabPanel(body, 'general');
    general.append(
      this.buildSliderRow('Field of View', Settings.getFov(), CAMERA_FOV_MIN, CAMERA_FOV_MAX, 1, (value) => `${Math.round(value)}°`, (value) => {
        Settings.setFov(value);
        onFovChange?.(value);
      }),
      this.buildSliderRow('Mouse Sensitivity', Settings.getMouseSensitivity(), 0.1, 3, 0.05, formatMultiplier, (value) =>
        Settings.setMouseSensitivity(value),
      ),
      this.buildGraphicsQualitySection(onGraphicsQualityChange),
    );

    const audio = this.addTabPanel(body, 'audio');
    audio.append(
      this.buildSliderRow('Master Volume', Settings.getMasterVolume(), 0, 1, 0.01, formatPercent, (value) => {
        Settings.setMasterVolume(value);
        onVolumeChange?.(value);
      }),
      this.buildSliderRow('Music Volume', Settings.getMusicVolume(), 0, 1, 0.01, formatPercent, (value) => Settings.setMusicVolume(value)),
      this.buildSliderRow('Effects Volume', Settings.getEffectsVolume(), 0, 1, 0.01, formatPercent, (value) => {
        Settings.setEffectsVolume(value);
        onAudioChange?.();
      }),
      this.buildSwitchGroup([
        ['3D Audio (headphones)', Settings.getSpatialAudio(), (value) => { Settings.setSpatialAudio(value); onAudioChange?.(); }],
        ['Night Mode (even out loud and quiet)', Settings.getNightAudio(), (value) => { Settings.setNightAudio(value); onAudioChange?.(); }],
      ]),
      this.buildSoundTestLink(),
    );

    this.addTabPanel(body, 'keyboard').append(this.buildKeyBindSection());

    const controller = this.addTabPanel(body, 'controller');
    controller.append(
      this.buildSliderRow('Controller Sensitivity', Settings.getControllerSensitivity(), 0.3, 3, 0.05, formatMultiplier, (value) =>
        Settings.setControllerSensitivity(value),
      ),
      this.buildSwitchGroup([
        ['Invert Y', Settings.getControllerInvertY(), Settings.setControllerInvertY],
        ['Aim Assist', Settings.getControllerAimAssist(), Settings.setControllerAimAssist],
        ['Vibration', Settings.getControllerVibration(), Settings.setControllerVibration],
      ]),
      this.buildMapping(),
    );

    this.selectTab(lastOpenTab);

    this.overlay.appendChild(panel);
    root.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKeyDown);
  }

  private buildTabList(): HTMLDivElement {
    const list = document.createElement('div');
    list.className = 'settings-tablist';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Settings sections');
    for (const tab of TABS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-tab';
      button.id = this.tabId(tab.id);
      button.textContent = tab.label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', this.tabPanelId(tab.id));
      button.addEventListener('click', () => this.selectTab(tab.id));
      this.tabButtons.set(tab.id, button);
      list.appendChild(button);
    }
    // Left/Right/Home/End move between tabs and select them (automatic activation).
    list.addEventListener('keydown', (event) => {
      if (this.listeningFor) return;
      const index = TABS.findIndex((tab) => tab.id === lastOpenTab);
      let next = -1;
      if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = TABS.length - 1;
      if (next < 0) return;
      event.preventDefault();
      this.selectTab(TABS[next]!.id);
      this.tabButtons.get(TABS[next]!.id)?.focus();
    });
    return list;
  }

  private tabId(id: TabId): string {
    return `settings-${this.instanceId}-tab-${id}`;
  }

  private tabPanelId(id: TabId): string {
    return `settings-${this.instanceId}-tabpanel-${id}`;
  }

  private addTabPanel(body: HTMLElement, id: TabId): HTMLDivElement {
    const tabPanel = document.createElement('div');
    tabPanel.className = 'settings-tabpanel';
    tabPanel.id = this.tabPanelId(id);
    tabPanel.setAttribute('role', 'tabpanel');
    tabPanel.setAttribute('aria-labelledby', this.tabId(id));
    tabPanel.hidden = true;
    this.tabPanels.set(id, tabPanel);
    body.appendChild(tabPanel);
    return tabPanel;
  }

  private selectTab(id: TabId): void {
    // A pending "Press a key…" belongs to the Keyboard tab: leaving it disarms the capture.
    this.cancelCapture();
    lastOpenTab = id;
    for (const [tabId, button] of this.tabButtons) {
      const selected = tabId === id;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const [tabId, tabPanel] of this.tabPanels) tabPanel.hidden = tabId !== id;
  }

  private buildSliderRow(
    label: string,
    initialValue: number,
    min: number,
    max: number,
    step: number,
    format: (value: number) => string,
    onChange: (value: number) => void,
  ): HTMLDivElement {
    const row = document.createElement('div');

    const head = document.createElement('div');
    head.className = 'settings-slider-head';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = LABEL_CSS;

    const valueEl = document.createElement('span');
    valueEl.className = 'settings-slider-value';
    valueEl.setAttribute('aria-hidden', 'true');

    const slider = document.createElement('input');
    // Unique per panel: the lobby and a live match each build their own SettingsPanel.
    slider.id = `settings-slider-${++sliderIdCounter}`;
    labelEl.htmlFor = slider.id;
    slider.className = 'settings-slider';
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(initialValue);
    const showValue = (): void => {
      const text = format(parseFloat(slider.value));
      valueEl.textContent = text;
      slider.setAttribute('aria-valuetext', text);
    };
    showValue();
    slider.addEventListener('input', () => {
      showValue();
      onChange(parseFloat(slider.value));
    });

    head.append(labelEl, valueEl);
    row.append(head, slider);
    return row;
  }

  /** Low/Medium/High shadow quality + resolution scaling (see settings/graphicsQuality.ts) - a
   * segmented button group rather than a slider, since these are named presets, not a continuous
   * range. Applies immediately to a live match via onGraphicsQualityChange (see Game.applyGraphicsQuality);
   * with no live match (the lobby), it simply takes effect on the next one started. */
  private buildGraphicsQualitySection(onGraphicsQualityChange?: (quality: GraphicsQuality) => void): HTMLDivElement {
    const row = document.createElement('div');

    const labelEl = document.createElement('div');
    labelEl.id = `settings-quality-label-${this.instanceId}`;
    labelEl.textContent = 'Graphics Quality';
    labelEl.style.cssText = `${LABEL_CSS} margin-bottom:8px;`;
    row.appendChild(labelEl);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'settings-seg-row';
    buttonRow.setAttribute('role', 'group');
    buttonRow.setAttribute('aria-labelledby', labelEl.id);

    for (const quality of GRAPHICS_QUALITY_ORDER) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-seg';
      button.textContent = GRAPHICS_QUALITY_LABELS[quality];
      button.addEventListener('click', () => {
        Settings.setGraphicsQuality(quality);
        onGraphicsQualityChange?.(quality);
        this.refreshGraphicsQualityButtons();
      });
      this.qualityButtons.set(quality, button);
      buttonRow.appendChild(button);
    }
    row.appendChild(buttonRow);

    this.qualityHint = document.createElement('div');
    this.qualityHint.className = 'settings-hint';
    row.appendChild(this.qualityHint);

    this.refreshGraphicsQualityButtons();
    return row;
  }

  private refreshGraphicsQualityButtons(): void {
    const active = Settings.getGraphicsQuality();
    for (const [quality, button] of this.qualityButtons) button.setAttribute('aria-pressed', String(quality === active));
    this.qualityHint.textContent = GRAPHICS_QUALITY_HINTS[active];
  }

  private buildKeyBindSection(): HTMLDivElement {
    const section = document.createElement('div');

    const grid = document.createElement('div');
    grid.className = 'settings-key-grid';
    grid.style.gridTemplateRows = `repeat(${Math.ceil(REBINDABLE_ACTIONS.length / 2)}, auto)`;
    for (const action of REBINDABLE_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'settings-key-row';

      const label = document.createElement('span');
      label.textContent = ACTION_LABELS[action];

      const keyButton = document.createElement('button');
      keyButton.type = 'button';
      keyButton.className = 'settings-keycap';
      keyButton.addEventListener('click', () => {
        this.cancelCapture();
        this.listeningFor = action;
        keyButton.textContent = 'Press a key…';
        keyButton.setAttribute('aria-label', `${ACTION_LABELS[action]}: press a key`);
        keyButton.dataset.listening = 'true';
      });

      this.keyButtons.set(action, keyButton);
      row.append(label, keyButton);
      grid.appendChild(row);
    }
    section.appendChild(grid);

    const resetRow = document.createElement('div');
    resetRow.style.cssText = 'display:flex; justify-content:flex-end; margin-top:20px;';
    const resetButton = createButton('Reset Keys');
    resetButton.addEventListener('click', () => {
      this.listeningFor = null;
      Settings.resetKeyBindings();
      this.refreshKeyLabels();
    });
    resetRow.appendChild(resetButton);
    section.appendChild(resetRow);

    this.refreshKeyLabels();
    return section;
  }

  /** Switch toggles: a button with role="switch" so it stays a focusable button for the controller
   * menu focus, with a track and knob drawn in CSS. */
  /** Opens the sound test page (docs/sound.md): every sound, near, far, behind and behind a wall. */
  private buildSoundTestLink(): HTMLAnchorElement {
    const link = document.createElement('a');
    link.className = 'settings-link';
    link.href = '/soundlab.html';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open the sound test page';
    return link;
  }

  private buildSwitchGroup(
    switches: readonly (readonly [label: string, checked: boolean, onChange: (value: boolean) => void])[],
  ): HTMLDivElement {
    const group = document.createElement('div');
    for (const [label, initial, onChange] of switches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-switch';
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-checked', String(initial));
      const text = document.createElement('span');
      text.textContent = label;
      const track = document.createElement('span');
      track.className = 'settings-switch-track';
      track.setAttribute('aria-hidden', 'true');
      button.append(text, track);
      button.addEventListener('click', () => {
        const next = button.getAttribute('aria-checked') !== 'true';
        button.setAttribute('aria-checked', String(next));
        onChange(next);
      });
      group.appendChild(button);
    }
    return group;
  }

  /** GAMEPAD_MAPPING lines hold one or two "Control: what it does" entries joined by "; ". Each entry
   * becomes a control and its job, laid out two entries to a row. */
  private buildMapping(): HTMLDivElement {
    const section = document.createElement('div');
    const heading = document.createElement('div');
    heading.textContent = 'Controller Mapping';
    heading.style.cssText = LABEL_CSS;
    const list = document.createElement('div');
    list.className = 'settings-map';
    for (const line of GAMEPAD_MAPPING.flatMap((entry) => entry.split('; '))) {
      const split = line.indexOf(': ');
      const key = document.createElement('div');
      key.className = 'settings-map-key';
      const desc = document.createElement('div');
      desc.className = 'settings-map-desc';
      key.textContent = split < 0 ? line : line.slice(0, split);
      desc.textContent = split < 0 ? '' : line.slice(split + 2);
      list.append(key, desc);
    }
    section.append(heading, list);
    return section;
  }

  private refreshKeyLabels(): void {
    const codeByAction = new Map<Action, string>();
    for (const [code, action] of Object.entries(Settings.getKeyBindings())) codeByAction.set(action, code);
    for (const [action, button] of this.keyButtons) {
      const code = codeByAction.get(action);
      button.textContent = code ? formatKeyCode(code) : 'None';
      button.setAttribute('aria-label', `${ACTION_LABELS[action]}: ${button.textContent}`);
      delete button.dataset.listening;
    }
  }

  /** Disarms a pending "Press a key…" capture and puts its button label back. */
  private cancelCapture(): void {
    if (!this.listeningFor) return;
    this.listeningFor = null;
    this.refreshKeyLabels();
  }

  show(): void {
    this.selectTab(lastOpenTab);
    this.overlay.style.display = 'flex';
    attachScanSweep(this.panel);
    this.scope.enter(this.overlay, this.tabButtons.get(lastOpenTab) ?? null);
  }

  hide(): void {
    this.overlay.style.display = 'none';
    this.scope.leave();
    // Disarm any "Press a key…" capture still pending, and put its button label back.
    this.cancelCapture();
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.scope.leave();
    this.overlay.remove();
  }
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatMultiplier(value: number): string {
  return `${value.toFixed(2)}x`;
}
