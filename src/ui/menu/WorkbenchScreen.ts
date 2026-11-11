import { AMBER, INK_FAINT, LABEL_CSS, MONO_FONT, SURFACE, SURFACE_RAISED } from '../theme.ts';
import {
  ACCENT, BG_VOID, BODY_FONT, createButton, createEyebrow, DISPLAY_FONT, ensureMotionKeyframesInjected, HAIRLINE, STEEL, TEXT,
} from './menuStyles.ts';
import { ModalScope } from './modalScope.ts';
import { WeaponPreview, type PreviewView } from './WeaponPreview.ts';
import { fittedAttachments, loadStoredAttachments, saveAttachments, toggleFitted, type FittedAttachments } from '../../core/attachments.ts';
import { equipSkin, equippedSkin, loadStoredSkins, saveSkins, type EquippedSkins } from '../../core/skins.ts';
import { WEAPON_DEFINITIONS, weaponIdsIn, type WeaponCategory } from '../../weapons/definitions.ts';
import { allowedAttachments, ATTACHMENTS, WEAPON_MOUNTS, type AttachmentId } from '../../weapons/models/attachments.ts';
import { SKIN_IDS, SKINS, type SkinDefinition, type SkinId } from '../../weapons/models/skins.ts';

const CATEGORY_LABELS: Record<WeaponCategory, string> = { primary: 'Primary', secondary: 'Secondary', melee: 'Blades', special: 'Reward' };
const CATEGORIES: readonly WeaponCategory[] = ['primary', 'secondary', 'melee', 'special'];
const WEAPON_ORDER: readonly string[] = CATEGORIES.flatMap((category) => weaponIdsIn(category));

const VIEWS: readonly { view: PreviewView; label: string; hint: string }[] = [
  { view: 'display', label: 'Rack', hint: 'Drag to turn it. Scroll to zoom. Double-click to reset.' },
  { view: 'hip', label: 'In hand', hint: 'As you carry it.' },
  { view: 'aim', label: 'Sights', hint: 'As you aim it: the crosshair sits on the sight.' },
];

type Section = 'skins' | 'attachments';

/** The angle the rack turns to when a unit is fitted, so the player sees it go on: every mount is
 * under the barrel or on the left, toward the muzzle. */
const SHOW_UNIT = { yaw: 2.35, pitch: 0.3 };

/** What a skin changes besides paint, in the player's words. */
function featureLabels(skin: SkinDefinition): string[] {
  const labels: string[] = [];
  const { features } = skin;
  if (features.sight === 'aperture') labels.push('Peep sight');
  if (features.sight === 'reflex') labels.push('Reflex sight');
  if (features.muzzle === 'ported') labels.push('Ported brake');
  if (features.wraps) labels.push('Wraps');
  if (features.engraving) labels.push('Engraving');
  if (features.medallion) labels.push('Goose medallion');
  if (features.lightLines) labels.push('Light lines');
  if (skin.inspect === 'showcase') labels.push('Showcase inspect');
  if (skin.inspect === 'flick') labels.push('Flick inspect');
  return labels.length > 0 ? labels : ['As issued'];
}

const SVG = 'viewBox="0 0 48 32" width="48" height="32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"';
const ATTACHMENT_ICONS: Record<AttachmentId, string> = {
  // A boxed module with its emitter and the beam leaving it.
  laser: `<svg ${SVG}><rect x="5" y="10" width="20" height="13" rx="2"/><path d="M9 10V7h10v3"/><circle cx="25" cy="16.5" r="2.4"/><path d="M29 16.5h14" stroke-dasharray="1 3.4"/><path d="M12 23v3M17 14h3"/></svg>`,
  // A torch: tail cap, knurled body, flared head and the light it throws.
  torch: `<svg ${SVG}><path d="M4 13h3v6H4zM7 12.5h14v7H7zM21 12.5l5-3h4v13h-4l-5-3"/><path d="M11 12.5v7M14.5 12.5v7"/><path d="M34 10l6-3M35 16h8M34 22l6 3"/></svg>`,
};
const CHEVRON = (direction: 'left' | 'right'): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${direction === 'left' ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'}"/></svg>`;

let workbenchStyleInjected = false;
function ensureWorkbenchStyleInjected(): void {
  if (workbenchStyleInjected) return;
  workbenchStyleInjected = true;
  const style = document.createElement('style');
  style.textContent =
    // Everything that scrolls here does so without a bar: the edges fade and the arrows step.
    '.wb-scroll { scrollbar-width: none; -ms-overflow-style: none; }' +
    '.wb-scroll::-webkit-scrollbar { display: none; }' +
    `.wb-screen { position: absolute; inset: 0; display: none; flex-direction: column; gap: 18px; background: ${BG_VOID}; color: ${TEXT};` +
    `  font-family: ${BODY_FONT}; z-index: 31; pointer-events: auto; padding: 28px 40px 30px; box-sizing: border-box; }` +
    '.wb-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-shrink: 0; }' +
    '.wb-title-row { display: flex; align-items: center; gap: 12px; margin-top: 6px; }' +
    `.wb-title { margin: 0; font-family: ${DISPLAY_FONT}; font-size: clamp(1.5rem, 2.6vw, 2.3rem); font-weight: 300; letter-spacing: -0.01em; line-height: 1.1; }` +
    `.wb-meta { margin-top: 8px; font-family: ${MONO_FONT}; font-size: 11px; color: ${STEEL}; min-height: 1.3em; }` +
    `.wb-meta b { color: ${TEXT}; font-weight: 500; }` +
    '.wb-icon {' +
    `  display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; flex: none; padding: 0; background: ${SURFACE_RAISED};` +
    `  border: 1px solid ${HAIRLINE}; border-radius: 2px; color: ${TEXT}; cursor: pointer; transition: border-color 150ms ease-out, opacity 150ms ease-out; }` +
    `.wb-icon:hover { border-color: ${ACCENT}; }` +
    '.wb-icon:disabled { opacity: 0.3; cursor: default; }' +
    `.wb-icon:disabled:hover { border-color: ${HAIRLINE}; }` +
    '.wb-actions { display: flex; gap: 10px; flex: none; }' +
    // The stage: the weapon, with its controls laid over the corners.
    '.wb-main { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; position: relative; }' +
    `.wb-stage { position: relative; flex: 1; min-height: 220px; border: 1px solid ${HAIRLINE}; border-radius: 2px; overflow: hidden;` +
    `  background: radial-gradient(ellipse at 50% 62%, rgba(111, 240, 220, 0.1), transparent 62%), linear-gradient(180deg, rgba(7, 24, 27, 0.2), rgba(7, 24, 27, 0.85)); }` +
    '.wb-canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; outline-offset: -3px; }' +
    '.wb-canvas[data-view="display"] { cursor: grab; touch-action: pan-y; }' +
    '.wb-canvas[data-view="display"][data-held="true"] { cursor: grabbing; }' +
    '.wb-views { position: absolute; left: 14px; top: 14px; display: flex; gap: 6px; flex-wrap: wrap; max-width: calc(100% - 28px); }' +
    '.wb-seg {' +
    `  min-height: 40px; padding: 9px 14px; background: rgba(7, 21, 24, 0.82); border: 1px solid ${HAIRLINE}; border-radius: 2px; color: ${STEEL};` +
    `  font-family: ${BODY_FONT}; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer;` +
    '  transition: border-color 150ms ease-out, color 150ms ease-out; backdrop-filter: blur(6px); }' +
    `.wb-seg:hover { color: ${TEXT}; }` +
    `.wb-seg[aria-checked="true"], .wb-seg[aria-selected="true"] { color: ${TEXT}; border-color: ${ACCENT}; box-shadow: inset 0 -2px 0 ${ACCENT}; }` +
    '.wb-seg:disabled { opacity: 0.4; cursor: default; }' +
    `.wb-seg small { margin-left: 8px; font-family: ${MONO_FONT}; font-weight: 400; letter-spacing: 0; color: ${STEEL}; }` +
    `.wb-hint { position: absolute; left: 14px; bottom: 12px; max-width: calc(100% - 170px); box-sizing: border-box; padding: 6px 10px; border-radius: 2px; background: rgba(7, 21, 24, 0.82); font-size: 0.76rem; line-height: 1.4; color: ${TEXT}; pointer-events: none; }` +
    '.wb-reset { position: absolute; right: 14px; bottom: 12px; }' +
    '.wb-cross { position: absolute; left: 50%; top: 50%; width: 21px; height: 21px; margin: -10.5px 0 0 -10.5px; pointer-events: none; }' +
    ".wb-cross::before, .wb-cross::after { content: ''; position: absolute; background: rgba(233, 239, 233, 0.9); }" +
    '.wb-cross::before { left: 10px; top: 0; width: 1px; height: 21px; }' +
    '.wb-cross::after { top: 10px; left: 0; height: 1px; width: 21px; }' +
    // The dock: two sections, one row of cards.
    '.wb-dock { flex: none; display: flex; flex-direction: column; gap: 12px; min-width: 0; }' +
    '.wb-dock-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }' +
    '.wb-tabs { display: flex; gap: 6px; }' +
    '.wb-steps { display: flex; gap: 6px; }' +
    '.wb-rail-wrap { position: relative; min-width: 0; }' +
    '.wb-rail { display: flex; gap: 10px; min-height: 206px; overflow-x: auto; scroll-snap-type: x proximity; scroll-behavior: smooth; padding: 2px; margin: -2px; }' +
    // The fade that says there is more, only on the side that has more.
    ".wb-rail-wrap::before, .wb-rail-wrap::after { content: ''; position: absolute; top: 0; bottom: 0; width: 44px; pointer-events: none; opacity: 0; transition: opacity 150ms ease-out; z-index: 1; }" +
    `.wb-rail-wrap::before { left: -2px; background: linear-gradient(90deg, ${BG_VOID}, transparent); }` +
    `.wb-rail-wrap::after { right: -2px; background: linear-gradient(270deg, ${BG_VOID}, transparent); }` +
    '.wb-rail-wrap[data-more-left="true"]::before, .wb-rail-wrap[data-more-right="true"]::after { opacity: 1; }' +
    '.wb-card {' +
    '  position: relative; flex: 1 0 200px; max-width: 320px; scroll-snap-align: start; display: flex; flex-direction: column; gap: 7px; box-sizing: border-box;' +
    `  padding: 12px 14px; min-height: 132px; background: ${SURFACE}; border: 1px solid ${HAIRLINE}; border-radius: 2px; color: ${TEXT}; text-align: left; cursor: pointer;` +
    '  transition: border-color 150ms ease-out, background-color 150ms ease-out; }' +
    `.wb-card:hover { border-color: ${INK_FAINT}; }` +
    `.wb-card[aria-pressed="true"] { border-color: ${ACCENT}; box-shadow: inset 0 0 0 1px ${ACCENT}; background: ${SURFACE_RAISED}; }` +
    // The fitted corner, the same mark the Loadout tiles carry.
    '.wb-card[aria-pressed="true"]::after {' +
    "  content: ''; position: absolute; top: 0; right: 0; width: 0; height: 0;" +
    `  border-style: solid; border-width: 0 16px 16px 0; border-color: transparent ${ACCENT} transparent transparent; }` +
    `.wb-card-name { font-family: ${DISPLAY_FONT}; font-size: 1rem; font-weight: 600; }` +
    `.wb-card-text { font-size: 0.76rem; line-height: 1.4; color: ${STEEL}; }` +
    '.wb-swatches { display: flex; height: 8px; border-radius: 1px; overflow: hidden; }' +
    '.wb-swatches span { flex: 1; }' +
    '.wb-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }' +
    `.wb-chip { ${LABEL_CSS} font-size: 9.5px; letter-spacing: 0.1em; padding: 3px 6px; border: 1px solid ${HAIRLINE}; border-radius: 2px; }` +
    `.wb-card[aria-pressed="true"] .wb-chip-state { color: ${ACCENT}; border-color: ${ACCENT}; }` +
    '.wb-unit { flex: 1 0 260px; max-width: 420px; flex-direction: row; gap: 14px; align-items: flex-start; }' +
    `.wb-unit-icon { flex: none; display: flex; align-items: center; justify-content: center; width: 64px; height: 48px; border: 1px solid ${HAIRLINE}; border-radius: 2px; color: ${STEEL}; }` +
    `.wb-card[aria-pressed="true"] .wb-unit-icon { color: ${ACCENT}; border-color: ${ACCENT}; }` +
    '.wb-unit-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; align-self: stretch; }' +
    `.wb-empty { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 6px; min-height: 132px; box-sizing: border-box; padding: 12px 16px; border: 1px dashed ${HAIRLINE}; border-radius: 2px; }` +
    // The weapon list: a sheet over the stage, opened from the header.
    '.wb-sheet {' +
    `  position: absolute; top: 0; right: 0; bottom: 0; width: min(560px, 100%); z-index: 4; display: none; flex-direction: column; gap: 16px; box-sizing: border-box;` +
    `  padding: 18px 20px; overflow-y: auto; background: rgba(6, 20, 23, 0.96); border: 1px solid ${HAIRLINE}; border-radius: 2px; backdrop-filter: blur(10px); }` +
    '.wb-sheet[data-open="true"] { display: flex; }' +
    '.wb-scrim { position: absolute; inset: 0; z-index: 3; display: none; background: rgba(3, 10, 12, 0.62); }' +
    '.wb-scrim[data-open="true"] { display: block; }' +
    `.wb-note { font-size: 0.76rem; line-height: 1.4; color: ${STEEL}; min-height: 1.1em; }` +
    `.wb-sheet-head { position: sticky; top: -18px; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: -18px -20px 0; padding: 14px 20px 10px; background: #061417; }` +
    '.wb-sheet-group { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 4px; }' +
    '.wb-sheet-group > :first-child { grid-column: 1 / -1; padding: 0 12px 4px; }' +
    '.wb-weapon {' +
    '  display: flex; align-items: baseline; justify-content: space-between; gap: 10px; width: 100%; box-sizing: border-box;' +
    `  padding: 9px 12px; min-height: 40px; background: transparent; border: 1px solid transparent; border-radius: 2px; color: ${TEXT};` +
    `  font-family: ${BODY_FONT}; font-size: 13px; font-weight: 500; text-align: left; cursor: pointer;` +
    '  transition: border-color 150ms ease-out, background-color 150ms ease-out; }' +
    `.wb-weapon:hover { border-color: ${INK_FAINT}; }` +
    `.wb-weapon[aria-current="true"] { background: ${SURFACE_RAISED}; border-color: ${ACCENT}; font-weight: 700; }` +
    `.wb-weapon small { font-family: ${MONO_FONT}; font-size: 10px; font-weight: 400; color: ${STEEL}; white-space: nowrap; }` +
    // Phone and narrow windows: the page scrolls as one column and the weapon stays in view.
    '@media (max-width: 760px) {' +
    '  .wb-screen { padding: 16px 16px 20px; gap: 12px; overflow-y: auto; }' +
    '  .wb-head { align-items: flex-start; flex-wrap: wrap; gap: 10px; }' +
    '  .wb-actions { width: 100%; }' +
    '  .wb-actions > * { flex: 1; text-align: center !important; padding: 12px 10px !important; }' +
    '  .wb-main { flex: none; }' +
    '  .wb-stage { flex: none; height: 46vh; min-height: 250px; }' +
    '  .wb-views { left: 8px; top: 8px; gap: 4px; max-width: calc(100% - 16px); }' +
    '  .wb-seg { padding: 9px 9px; letter-spacing: 0.06em; }' +
    '  .wb-hint { left: 8px; bottom: 8px; max-width: calc(100% - 16px); }' +
    '  .wb-hint[data-with-reset="true"] { max-width: calc(100% - 130px); }' +
    '  .wb-reset { right: 8px; bottom: 8px; }' +
    '  .wb-seg, .wb-weapon { min-height: 44px; }' +
    '  .wb-icon { width: 44px; height: 44px; }' +
    '  .wb-rail { min-height: 0; }' +
    '  .wb-card { flex: 0 0 78%; }' +
    '  .wb-unit { flex: 0 0 88%; }' +
    '  .wb-sheet { position: fixed; inset: 0; width: auto; border: none; border-radius: 0; z-index: 40; }' +
    '}' +
    '@media (prefers-reduced-motion: reduce) { .wb-rail { scroll-behavior: auto; } .wb-card, .wb-seg, .wb-icon, .wb-weapon { transition: none; } }';
  document.head.appendChild(style);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(html: string, label: string): HTMLButtonElement {
  const button = element('button', 'wb-icon');
  button.type = 'button';
  button.innerHTML = html;
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
}

/** The Workbench (docs/attachments.md, docs/skins.md): one page per weapon. The weapon fills the
 * stage and turns under the mouse; below it the player dresses it (skins) and fits it
 * (attachments, only those the gun can take); over it the views show it on the rack, in hand and
 * down the sights, where a skin that changes the sights has to prove the crosshair still sits on
 * them. Every choice is saved at once (core/skins.ts, core/attachments.ts). */
export class WorkbenchScreen {
  private readonly overlay: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  /** Whether a preview has already drawn to the canvas (see show). */
  private canvasUsed = false;
  private readonly cross: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly meta: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly weaponsButton: HTMLButtonElement;
  private readonly inspectButton: HTMLButtonElement;
  private readonly sheet: HTMLElement;
  private readonly rail: HTMLDivElement;
  private readonly railWrap: HTMLDivElement;
  private readonly stepButtons: { back: HTMLButtonElement; on: HTMLButtonElement };
  private readonly weaponButtons = new Map<string, { button: HTMLButtonElement; skin: HTMLElement }>();
  private readonly skinCards = new Map<SkinId, HTMLButtonElement>();
  private readonly viewButtons = new Map<PreviewView, HTMLButtonElement>();
  private readonly tabs = new Map<Section, { button: HTMLButtonElement; count: HTMLElement }>();
  private readonly scope = new ModalScope();
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly onResize = (): void => {
    this.layoutCanvas();
    this.preview?.resize();
    this.updateRailEdges();
  };
  private readonly stage: HTMLElement;
  private readonly scrim: HTMLDivElement;
  private readonly note: HTMLDivElement;
  /** Built on show and dropped on hide: it holds a WebGL context, and a page may only keep a few. */
  private preview: WeaponPreview | null = null;
  private skins: EquippedSkins = {};
  private attachments: FittedAttachments = {};
  private weaponId: string;
  private view: PreviewView = 'display';
  private section: Section = 'skins';
  /** The section and weapon the rail's cards were last built for. */
  private railKey = '';
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(root: HTMLElement, onClose: () => void) {
    ensureMotionKeyframesInjected();
    ensureWorkbenchStyleInjected();
    this.weaponId = WEAPON_ORDER[0]!;

    this.overlay = element('div', 'menu-surface wb-screen wb-scroll');
    this.overlay.dataset.testid = 'skins-screen';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', 'Workbench');

    // --- Header: which weapon, and the way to the others ---
    const head = element('header', 'wb-head');
    const titleWrap = element('div');
    titleWrap.style.minWidth = '0';
    titleWrap.append(createEyebrow('Workbench'));
    const titleRow = element('div', 'wb-title-row');
    const previous = iconButton(CHEVRON('left'), 'Previous weapon');
    previous.dataset.testid = 'workbench-previous';
    previous.addEventListener('click', () => this.stepWeapon(-1));
    this.title = element('h2', 'wb-title menu-panel-title');
    this.title.setAttribute('aria-live', 'polite');
    const next = iconButton(CHEVRON('right'), 'Next weapon');
    next.dataset.testid = 'workbench-next';
    next.addEventListener('click', () => this.stepWeapon(1));
    titleRow.append(previous, this.title, next);
    this.meta = element('div', 'wb-meta');
    this.meta.dataset.testid = 'workbench-meta';
    titleWrap.append(titleRow, this.meta);

    const actions = element('div', 'wb-actions');
    this.weaponsButton = createButton('All weapons');
    this.weaponsButton.dataset.testid = 'workbench-weapons';
    this.weaponsButton.setAttribute('aria-expanded', 'false');
    this.weaponsButton.setAttribute('aria-controls', 'workbench-sheet');
    this.weaponsButton.addEventListener('click', () => this.setSheetOpen(this.sheet.dataset.open !== 'true'));
    this.closeButton = createButton('Close', 'primary');
    this.closeButton.addEventListener('click', onClose);
    actions.append(this.weaponsButton, this.closeButton);
    head.append(titleWrap, actions);

    // --- Stage: the weapon, the views over one corner, the hint and the reset under it ---
    const main = element('div', 'wb-main');
    const stage = element('section', 'wb-stage');
    this.stage = stage;
    stage.setAttribute('aria-label', 'Preview');
    this.canvas = element('canvas', 'wb-canvas');
    this.canvas.dataset.testid = 'skins-preview';
    this.canvas.setAttribute('role', 'img');
    this.canvas.tabIndex = 0;
    this.cross = element('div', 'wb-cross');
    this.cross.setAttribute('aria-hidden', 'true');

    const views = element('div', 'wb-views');
    const viewGroup = element('div');
    viewGroup.setAttribute('role', 'radiogroup');
    viewGroup.setAttribute('aria-label', 'How to show it');
    viewGroup.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap;';
    for (const { view, label } of VIEWS) {
      const button = element('button', 'wb-seg', label);
      button.type = 'button';
      button.dataset.testid = `skins-view-${view}`;
      button.setAttribute('role', 'radio');
      button.addEventListener('click', () => this.selectView(view));
      this.viewButtons.set(view, button);
      viewGroup.appendChild(button);
    }
    this.inspectButton = element('button', 'wb-seg', 'Inspect');
    this.inspectButton.type = 'button';
    this.inspectButton.dataset.testid = 'skins-inspect';
    this.inspectButton.addEventListener('click', () => {
      if (this.view !== 'hip') this.selectView('hip');
      this.preview?.inspect();
    });
    views.append(viewGroup, this.inspectButton);

    this.hint = element('div', 'wb-hint');
    this.resetButton = element('button', 'wb-seg wb-reset', 'Reset view');
    this.resetButton.type = 'button';
    this.resetButton.dataset.testid = 'workbench-reset';
    this.resetButton.addEventListener('click', () => this.preview?.resetOrbit());
    stage.append(this.canvas, this.cross, views, this.hint, this.resetButton);
    this.bindCanvas(this.canvas);

    // --- Dock: skins or attachments, one row of cards ---
    const dock = element('section', 'wb-dock');
    const dockHead = element('div', 'wb-dock-head');
    const tabList = element('div', 'wb-tabs');
    tabList.setAttribute('role', 'tablist');
    tabList.setAttribute('aria-label', 'What to change');
    for (const [section, label] of [['skins', 'Skins'], ['attachments', 'Attachments']] as const) {
      const button = element('button', 'wb-seg', label);
      button.type = 'button';
      button.id = `workbench-tab-${section}`;
      button.dataset.testid = `workbench-tab-${section}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'workbench-panel');
      const count = element('small');
      button.appendChild(count);
      button.addEventListener('click', () => this.selectSection(section));
      // Left and Right move between the two tabs, as a tab list should.
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const other: Section = section === 'skins' ? 'attachments' : 'skins';
        this.selectSection(other);
        this.tabs.get(other)!.button.focus();
      });
      this.tabs.set(section, { button, count });
      tabList.appendChild(button);
    }
    const steps = element('div', 'wb-steps');
    this.stepButtons = { back: iconButton(CHEVRON('left'), 'Scroll back'), on: iconButton(CHEVRON('right'), 'Scroll on') };
    this.stepButtons.back.addEventListener('click', () => this.stepRail(-1));
    this.stepButtons.on.addEventListener('click', () => this.stepRail(1));
    steps.append(this.stepButtons.back, this.stepButtons.on);
    dockHead.append(tabList, steps);

    this.railWrap = element('div', 'wb-rail-wrap');
    this.rail = element('div', 'wb-rail wb-scroll');
    this.rail.id = 'workbench-panel';
    this.rail.setAttribute('role', 'tabpanel');
    this.rail.addEventListener('scroll', () => this.updateRailEdges(), { passive: true });
    // A wheel over the row moves it sideways: there is no bar to drag.
    this.rail.addEventListener('wheel', (event) => {
      if (this.rail.scrollWidth <= this.rail.clientWidth + 1 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      this.rail.scrollBy({ left: event.deltaY, behavior: 'auto' });
    }, { passive: false });
    this.railWrap.appendChild(this.rail);
    this.note = element('div', 'wb-note');
    this.note.dataset.testid = 'workbench-note';
    dock.append(dockHead, this.railWrap, this.note);

    for (const skinId of SKIN_IDS) this.skinCards.set(skinId, this.buildSkinCard(skinId));

    // --- The other weapons, by category, with the skin each wears now ---
    this.sheet = element('nav', 'wb-sheet wb-scroll');
    this.sheet.id = 'workbench-sheet';
    this.sheet.setAttribute('aria-label', 'Weapons');
    // Its own way out, always in view: on a phone the sheet covers the whole page.
    const sheetHead = element('div', 'wb-sheet-head');
    const sheetClose = element('button', 'wb-seg', 'Close list');
    sheetClose.type = 'button';
    sheetClose.dataset.testid = 'workbench-weapons-close';
    sheetClose.addEventListener('click', () => {
      this.setSheetOpen(false);
      this.weaponsButton.focus();
    });
    sheetHead.append(createEyebrow('All weapons'), sheetClose);
    this.sheet.appendChild(sheetHead);
    for (const category of CATEGORIES) {
      const group = element('div', 'wb-sheet-group');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', CATEGORY_LABELS[category]);
      const eyebrow = createEyebrow(CATEGORY_LABELS[category]);
      if (category === 'special') eyebrow.style.color = AMBER;
      group.appendChild(eyebrow);
      for (const id of weaponIdsIn(category)) {
        const button = element('button', 'wb-weapon');
        button.type = 'button';
        button.dataset.testid = `skins-weapon-${id}`;
        const skin = element('small');
        button.append(element('span', undefined, WEAPON_DEFINITIONS[id]!.name), skin);
        button.addEventListener('click', () => {
          this.selectWeapon(id);
          this.setSheetOpen(false);
          this.weaponsButton.focus();
        });
        this.weaponButtons.set(id, { button, skin });
        group.appendChild(button);
      }
      this.sheet.appendChild(group);
    }

    // Behind the sheet: dims the page and closes the list on a click.
    this.scrim = element('div', 'wb-scrim');
    this.scrim.addEventListener('click', () => this.setSheetOpen(false));
    main.append(stage, dock, this.scrim, this.sheet);
    this.overlay.append(head, main);
    root.appendChild(this.overlay);

    // Escape closes the weapon list first, then the page. Document-level, so quiet while hidden.
    this.onKeyDown = (event) => {
      if (this.overlay.style.display !== 'flex' || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (this.sheet.dataset.open === 'true') {
        this.setSheetOpen(false);
        this.weaponsButton.focus();
      } else {
        onClose();
      }
    };
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean {
    return this.overlay.style.display === 'flex';
  }

  /** Opens the page, on `weaponId` when given (the Loadout page opens it on the weapon in view). */
  show(weaponId?: string): void {
    this.skins = loadStoredSkins();
    this.attachments = loadStoredAttachments();
    if (weaponId && this.weaponButtons.has(weaponId)) this.weaponId = weaponId;
    this.overlay.style.display = 'flex';
    this.setSheetOpen(false);
    // First, so the page can be used and closed even if the preview could not be built.
    this.scope.enter(this.overlay, this.weaponsButton);
    // A preview frees its WebGL context when the page closes, and a canvas whose context was lost
    // cannot be given a new one: every opening after the first gets a fresh canvas. Reusing the old
    // one threw here, and the page opened dead the second time.
    if (this.canvasUsed) {
      const fresh = this.canvas.cloneNode(false) as HTMLCanvasElement;
      this.canvas.replaceWith(fresh);
      this.canvas = fresh;
      this.bindCanvas(fresh);
    }
    this.canvasUsed = true;
    this.preview = new WeaponPreview(this.canvas);
    window.addEventListener('resize', this.onResize);
    this.preview.resize();
    this.refresh();
    this.preview.start();
  }

  hide(): void {
    if (!this.isOpen) return;
    this.overlay.style.display = 'none';
    window.removeEventListener('resize', this.onResize);
    this.preview?.dispose();
    this.preview = null;
    this.drag = null;
    this.scope.leave();
  }

  dispose(): void {
    this.hide();
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.overlay.remove();
  }

  /** The rack view under the hand: drag to turn, wheel or pinch keys to zoom, double-click to
   * reset, and the arrow keys for anyone without a mouse. */
  private bindCanvas(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (event) => {
      if (this.view !== 'display' || (event.pointerType === 'mouse' && event.button !== 0)) return;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.held = 'true';
      this.preview?.setHeld(true);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      this.preview?.orbit(event.clientX - this.drag.x, event.clientY - this.drag.y);
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
    });
    const release = (event: PointerEvent): void => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      this.drag = null;
      canvas.dataset.held = 'false';
      this.preview?.setHeld(false);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', (event) => {
      if (this.view !== 'display') return;
      event.preventDefault();
      this.preview?.zoomBy(Math.exp(-event.deltaY * 0.0015));
    }, { passive: false });
    canvas.addEventListener('dblclick', () => this.preview?.resetOrbit());
    canvas.addEventListener('keydown', (event) => {
      if (this.view !== 'display' || !this.preview) return;
      const turn: Record<string, [number, number]> = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -18], ArrowDown: [0, 18] };
      const step = turn[event.key];
      if (step) this.preview.orbit(step[0], step[1], false);
      else if (event.key === '+' || event.key === '=') this.preview.zoomBy(1.15);
      else if (event.key === '-') this.preview.zoomBy(1 / 1.15);
      else if (event.key === 'Home') this.preview.resetOrbit();
      else return;
      event.preventDefault();
    });
  }

  /** The rack view fills the stage. The first-person views are at most the match's 16:9 picture, centred:
   * on a stage wider than that the gun would otherwise shrink to a speck in the middle of a
   * panorama no player ever sees. */
  private layoutCanvas(): void {
    const style = this.canvas.style;
    const width = this.stage.clientWidth, height = this.stage.clientHeight;
    if (this.canvas.dataset.view === 'display' || width === 0 || height === 0) {
      style.left = style.top = '0';
      style.width = style.height = '100%';
      return;
    }
    // Never wider than 16:9; a stage narrower than that (a phone) is used whole.
    const w = Math.min(width, (height * 16) / 9);
    style.width = `${w}px`;
    style.height = '100%';
    style.left = `${(width - w) / 2}px`;
    style.top = '0';
  }

  private buildSkinCard(skinId: SkinId): HTMLButtonElement {
    const skin = SKINS[skinId];
    const card = element('button', 'wb-card');
    card.type = 'button';
    card.dataset.testid = `skins-skin-${skinId}`;
    const swatches = element('span', 'wb-swatches');
    swatches.setAttribute('aria-hidden', 'true');
    for (const colour of skin.swatches) {
      const chip = element('span');
      chip.style.background = colour;
      swatches.appendChild(chip);
    }
    const chips = element('span', 'wb-chips');
    for (const label of featureLabels(skin)) chips.appendChild(element('span', 'wb-chip', label));
    card.append(swatches, element('span', 'wb-card-name', skin.name), element('span', 'wb-card-text', skin.description), chips);
    card.addEventListener('click', () => this.equip(skinId));
    return card;
  }

  private buildAttachmentCard(id: AttachmentId): HTMLButtonElement {
    const definition = ATTACHMENTS[id];
    const card = element('button', 'wb-card wb-unit');
    card.type = 'button';
    card.dataset.testid = `workbench-attachment-${id}`;
    const icon = element('span', 'wb-unit-icon');
    icon.innerHTML = ATTACHMENT_ICONS[id];
    const body = element('span', 'wb-unit-body');
    const chips = element('span', 'wb-chips');
    const state = element('span', 'wb-chip wb-chip-state');
    state.dataset.role = 'state';
    chips.appendChild(state);
    body.append(element('span', 'wb-card-name', definition.name), element('span', 'wb-card-text', definition.effect), element('span', 'wb-card-text', definition.description), chips);
    card.append(icon, body);
    card.addEventListener('click', () => this.toggle(id));
    return card;
  }

  private setSheetOpen(open: boolean): void {
    this.sheet.dataset.open = String(open);
    this.scrim.dataset.open = String(open);
    this.weaponsButton.setAttribute('aria-expanded', String(open));
    if (open) this.weaponButtons.get(this.weaponId)?.button.focus();
  }

  private stepWeapon(by: number): void {
    const index = WEAPON_ORDER.indexOf(this.weaponId);
    this.selectWeapon(WEAPON_ORDER[(index + by + WEAPON_ORDER.length) % WEAPON_ORDER.length]!);
  }

  private stepRail(direction: number): void {
    const card = this.rail.firstElementChild as HTMLElement | null;
    const step = card ? card.getBoundingClientRect().width + 10 : this.rail.clientWidth * 0.8;
    this.rail.scrollBy({ left: direction * Math.max(step, this.rail.clientWidth * 0.6) });
  }

  /** Shows the fades and enables the arrows only on the sides that have more to see. */
  private updateRailEdges(): void {
    const { scrollLeft, scrollWidth, clientWidth } = this.rail;
    const left = scrollLeft > 2, right = scrollLeft + clientWidth < scrollWidth - 2;
    this.railWrap.dataset.moreLeft = String(left);
    this.railWrap.dataset.moreRight = String(right);
    this.stepButtons.back.disabled = !left;
    this.stepButtons.on.disabled = !right;
    const scrolls = scrollWidth > clientWidth + 2;
    this.stepButtons.back.style.visibility = this.stepButtons.on.style.visibility = scrolls ? 'visible' : 'hidden';
  }

  private selectWeapon(weaponId: string): void {
    this.weaponId = weaponId;
    this.refresh();
  }

  private selectView(view: PreviewView): void {
    this.view = view;
    this.refresh();
  }

  private selectSection(section: Section): void {
    this.section = section;
    this.refresh();
  }

  private equip(skinId: SkinId): void {
    this.skins = equipSkin(this.skins, this.weaponId, skinId);
    saveSkins(this.skins);
    this.refresh();
  }

  private toggle(id: AttachmentId): void {
    const before = fittedAttachments(this.attachments, this.weaponId).includes(id);
    this.attachments = toggleFitted(this.attachments, this.weaponId, id);
    saveAttachments(this.attachments);
    this.refresh();
    // Turn the weapon so the unit is seen going on.
    if (!before && this.view === 'display') this.preview?.turnTo(SHOW_UNIT.yaw, SHOW_UNIT.pitch);
  }

  /** Fills the row with the open section's cards, only when the section or the weapon changed. */
  private buildRail(): void {
    const key = `${this.section}:${this.weaponId}`;
    if (key === this.railKey) return;
    this.railKey = key;
    this.rail.replaceChildren();
    this.rail.setAttribute('aria-labelledby', `workbench-tab-${this.section}`);
    if (this.section === 'skins') {
      for (const skinId of SKIN_IDS) this.rail.appendChild(this.skinCards.get(skinId)!);
    } else {
      const allowed = allowedAttachments(this.weaponId);
      for (const id of allowed) this.rail.appendChild(this.buildAttachmentCard(id));
      if (allowed.length === 0) {
        const empty = element('div', 'wb-empty');
        empty.dataset.testid = 'workbench-no-attachments';
        const name = WEAPON_DEFINITIONS[this.weaponId]!.name;
        empty.append(
          element('span', 'wb-card-name', 'Nothing fits this one'),
          element('span', 'wb-card-text', `The ${name} has no rail or bare barrel for a laser or a torch.`),
        );
        this.rail.appendChild(empty);
      }
    }
    this.note.textContent = this.section === 'attachments' && WEAPON_MOUNTS[this.weaponId]?.exclusive
      ? 'One rail: it carries one unit at a time, so fitting one takes the other off.'
      : '';
    this.rail.scrollLeft = 0;
  }

  /** Syncs every control and the preview with the chosen weapon, its skin, its fit and the view. */
  private refresh(): void {
    const definition = WEAPON_DEFINITIONS[this.weaponId]!;
    const skinId = equippedSkin(this.skins, this.weaponId);
    const fitted = fittedAttachments(this.attachments, this.weaponId);
    const allowed = allowedAttachments(this.weaponId);
    // A blade is never aimed, so it has no sights view.
    const canAim = definition.kind === 'ranged';
    const view = this.view === 'aim' && !canAim ? 'hip' : this.view;
    const viewEntry = VIEWS.find((entry) => entry.view === view)!;

    this.title.textContent = definition.name;
    const fit = fitted.length > 0 ? fitted.map((id) => ATTACHMENTS[id].name).join(', ') : allowed.length > 0 ? 'No attachments' : 'Takes no attachments';
    this.meta.replaceChildren(
      document.createTextNode(`${CATEGORY_LABELS[definition.category ?? 'special']} / `),
      element('b', undefined, SKINS[skinId].name),
      document.createTextNode(` / ${fit}`),
    );

    for (const [id, { button, skin }] of this.weaponButtons) {
      button.setAttribute('aria-current', String(id === this.weaponId));
      skin.textContent = SKINS[equippedSkin(this.skins, id)].name;
    }
    for (const [id, button] of this.viewButtons) {
      button.setAttribute('aria-checked', String(id === view));
      button.disabled = id === 'aim' && !canAim;
    }
    for (const [section, { button, count }] of this.tabs) {
      button.setAttribute('aria-selected', String(section === this.section));
      button.tabIndex = section === this.section ? 0 : -1;
      count.textContent = section === 'skins' ? String(SKIN_IDS.length) : allowed.length > 0 ? `${fitted.length}/${allowed.length}` : 'none';
    }

    this.buildRail();
    for (const [id, card] of this.skinCards) card.setAttribute('aria-pressed', String(id === skinId));
    for (const card of this.rail.querySelectorAll<HTMLElement>('[data-testid^="workbench-attachment-"]')) {
      const on = fitted.includes(card.dataset.testid!.replace('workbench-attachment-', '') as AttachmentId);
      card.setAttribute('aria-pressed', String(on));
      card.querySelector<HTMLElement>('[data-role="state"]')!.textContent = on ? 'Fitted' : 'Fit';
    }
    this.updateRailEdges();

    this.cross.style.display = view === 'display' ? 'none' : 'block';
    this.resetButton.style.display = view === 'display' ? '' : 'none';
    this.hint.dataset.withReset = String(view === 'display');
    this.hint.textContent = view === 'aim' && definition.hasScope ? 'In a match the scope picture takes over at full aim.'
      : view === 'display' && window.matchMedia('(pointer: coarse)').matches ? 'Drag sideways to turn it.' : viewEntry.hint;
    this.canvas.dataset.view = view;
    this.layoutCanvas();
    this.preview?.resize();
    this.canvas.setAttribute('aria-label',
      `${definition.name} in the ${SKINS[skinId].name} skin${fitted.length > 0 ? ` with ${fit.toLowerCase()}` : ''}, ${viewEntry.label.toLowerCase()}`);

    if (this.preview) {
      this.preview.show(this.weaponId, skinId, view, fitted);
      // What is drawn right now, and how far its sight tip sits from the middle of the picture,
      // for the aim-point screenshots (e2e/skins.spec.ts).
      const offset = this.preview.sightOffsetPixels();
      this.canvas.dataset.sightOffset = offset === null ? '' : offset.toFixed(2);
      this.canvas.dataset.shown = `${this.weaponId}:${skinId}:${view}`;
      this.canvas.dataset.fitted = fitted.join('+');
    }
  }
}
