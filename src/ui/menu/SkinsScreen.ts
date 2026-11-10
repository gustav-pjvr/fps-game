import { AMBER, INK_FAINT, LABEL_CSS, MONO_FONT, SURFACE, SURFACE_RAISED } from '../theme.ts';
import {
  ACCENT, BG_VOID, BODY_FONT, createButton, createEyebrow, DISPLAY_FONT, ensureMotionKeyframesInjected, HAIRLINE, STEEL, TEXT,
} from './menuStyles.ts';
import { ModalScope } from './modalScope.ts';
import { WeaponPreview, type PreviewView } from './WeaponPreview.ts';
import { equipSkin, equippedSkin, loadStoredSkins, saveSkins, type EquippedSkins } from '../../core/skins.ts';
import { WEAPON_DEFINITIONS, weaponIdsIn, type WeaponCategory } from '../../weapons/definitions.ts';
import { SKIN_IDS, SKINS, type SkinDefinition, type SkinId } from '../../weapons/models/skins.ts';

const CATEGORY_LABELS: Record<WeaponCategory, string> = { primary: 'Primary', secondary: 'Secondary', melee: 'Blades', special: 'Reward' };
const CATEGORIES: readonly WeaponCategory[] = ['primary', 'secondary', 'melee', 'special'];

const VIEWS: readonly { view: PreviewView; label: string; hint: string }[] = [
  { view: 'display', label: 'On the rack', hint: 'The weapon alone, turning.' },
  { view: 'hip', label: 'In hand', hint: 'As you carry it.' },
  { view: 'aim', label: 'Down the sights', hint: 'As you aim it: the crosshair sits on the sight.' },
];

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

let skinsStyleInjected = false;
function ensureSkinsStyleInjected(): void {
  if (skinsStyleInjected) return;
  skinsStyleInjected = true;
  const style = document.createElement('style');
  style.textContent =
    '.skins-scroll { scrollbar-width: thin; scrollbar-color: ' + HAIRLINE + ' transparent; }' +
    '.skins-weapon {' +
    '  display: flex; align-items: baseline; justify-content: space-between; gap: 10px; width: 100%; box-sizing: border-box;' +
    `  padding: 9px 12px; min-height: 40px; background: transparent; border: 1px solid transparent; border-radius: 2px; color: ${TEXT};` +
    `  font-family: ${BODY_FONT}; font-size: 13px; font-weight: 500; text-align: left; cursor: pointer;` +
    '  transition: border-color 150ms ease-out, background-color 150ms ease-out;' +
    '}' +
    `.skins-weapon:hover { border-color: ${INK_FAINT}; }` +
    `.skins-weapon[aria-current="true"] { background: ${SURFACE_RAISED}; border-color: ${ACCENT}; font-weight: 700; }` +
    `.skins-weapon small { font-family: ${MONO_FONT}; font-size: 10px; font-weight: 400; color: ${STEEL}; white-space: nowrap; }` +
    '.skins-card {' +
    '  position: relative; display: flex; flex-direction: column; gap: 7px; width: 100%; box-sizing: border-box; padding: 12px 14px;' +
    `  background: ${SURFACE}; border: 1px solid ${HAIRLINE}; border-radius: 2px; color: ${TEXT}; text-align: left; cursor: pointer;` +
    '  transition: border-color 150ms ease-out, background-color 150ms ease-out;' +
    '}' +
    `.skins-card:hover { border-color: ${INK_FAINT}; }` +
    `.skins-card[aria-pressed="true"] { border-color: ${ACCENT}; box-shadow: inset 0 0 0 1px ${ACCENT}; background: ${SURFACE_RAISED}; }` +
    // The equipped corner, the same mark the Loadout tiles carry.
    '.skins-card[aria-pressed="true"]::after {' +
    "  content: ''; position: absolute; top: 0; right: 0; width: 0; height: 0;" +
    `  border-style: solid; border-width: 0 16px 16px 0; border-color: transparent ${ACCENT} transparent transparent;` +
    '}' +
    '.skins-swatches { display: flex; height: 8px; border-radius: 1px; overflow: hidden; }' +
    '.skins-swatches span { flex: 1; }' +
    `.skins-chip { ${LABEL_CSS} font-size: 9.5px; letter-spacing: 0.1em; padding: 3px 6px; border: 1px solid ${HAIRLINE}; border-radius: 2px; }` +
    '.skins-view {' +
    `  flex: 1 1 0; min-height: 40px; padding: 9px 10px; background: ${SURFACE_RAISED}; border: 1px solid ${HAIRLINE}; border-radius: 2px;` +
    `  color: ${STEEL}; font-family: ${BODY_FONT}; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer;` +
    '  transition: border-color 150ms ease-out, color 150ms ease-out;' +
    '}' +
    `.skins-view[aria-checked="true"] { color: ${TEXT}; border-color: ${ACCENT}; box-shadow: inset 0 -2px 0 ${ACCENT}; }` +
    '.skins-view:disabled { opacity: 0.4; cursor: default; }' +
    '.skins-cross { position: absolute; left: 50%; top: 50%; width: 21px; height: 21px; margin: -10.5px 0 0 -10.5px; pointer-events: none; }' +
    ".skins-cross::before, .skins-cross::after { content: ''; position: absolute; background: rgba(233, 239, 233, 0.9); }" +
    '.skins-cross::before { left: 10px; top: 0; width: 1px; height: 21px; }' +
    '.skins-cross::after { top: 10px; left: 0; height: 1px; width: 21px; }' +
    // Phone and narrow windows: one column, the preview first, then every weapon as a chip (all
    // in view, wrapped under their category: a strip to swipe hid most of them), then the skins.
    '@media (max-width: 980px) {' +
    '  .skins-screen { padding: 20px 16px !important; }' +
    '  .skins-body { flex-direction: column; overflow-y: auto; gap: 18px !important; }' +
    '  .skins-body > * { flex: none !important; width: 100% !important; max-height: none !important; }' +
    '  .skins-stage { order: 1; }' +
    '  .skins-weapons { order: 2; overflow: visible !important; }' +
    '  .skins-weapons-list { gap: 12px !important; }' +
    '  .skins-weapons-group { flex-direction: row !important; flex-wrap: wrap; align-items: center; gap: 6px !important; }' +
    '  .skins-weapons-group > :first-child { flex-basis: 100%; padding-left: 2px !important; }' +
    '  .skins-weapon { width: auto; min-height: 40px; white-space: nowrap; border-color: ' + HAIRLINE + '; }' +
    '  .skins-weapon small { display: none; }' +
    '  .skins-list { order: 3; overflow: visible !important; }' +
    '  .skins-cards { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }' +
    '}' +
    '@media (prefers-reduced-motion: reduce) { .skins-weapon, .skins-card, .skins-view { transition: none; } }';
  document.head.appendChild(style);
}

/** The Skins screen (docs/skins.md): pick a weapon on the left, see it in the middle, dress it on
 * the right. A skin is equipped per weapon and saved at once (core/skins.ts). The preview draws
 * the real model three ways: on the rack, in hand, and down the sights, which is where a skin that
 * changes the sights has to prove the crosshair still sits on them. */
export class SkinsScreen {
  private readonly overlay: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly cross: HTMLDivElement;
  private readonly stageName: HTMLDivElement;
  private readonly stageNote: HTMLDivElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly inspectButton: HTMLButtonElement;
  private readonly weaponButtons = new Map<string, { button: HTMLButtonElement; skin: HTMLElement }>();
  private readonly skinCards = new Map<SkinId, HTMLButtonElement>();
  private readonly viewButtons = new Map<PreviewView, HTMLButtonElement>();
  private readonly scope = new ModalScope();
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly onResize = (): void => this.preview?.resize();
  /** Built on show and dropped on hide: it holds a WebGL context, and a page may only keep a few. */
  private preview: WeaponPreview | null = null;
  private skins: EquippedSkins = {};
  private weaponId: string;
  private view: PreviewView = 'display';

  constructor(root: HTMLElement, onClose: () => void) {
    ensureMotionKeyframesInjected();
    ensureSkinsStyleInjected();
    this.weaponId = weaponIdsIn('primary')[0]!;

    this.overlay = document.createElement('div');
    this.overlay.dataset.testid = 'skins-screen';
    this.overlay.className = 'menu-surface skins-screen';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', 'Skins');
    this.overlay.style.cssText =
      `position:absolute; inset:0; display:none; flex-direction:column; background:${BG_VOID}; color:${TEXT};` +
      ` font-family:${BODY_FONT}; z-index:31; pointer-events:auto; padding:36px 48px; box-sizing:border-box;`;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:22px; flex-shrink:0;';
    const titleWrap = document.createElement('div');
    titleWrap.append(createEyebrow('One look per weapon'));
    const title = document.createElement('h2');
    title.textContent = 'SKINS';
    title.className = 'menu-panel-title';
    title.style.cssText = `margin:6px 0 0; font-family:${DISPLAY_FONT}; font-size:2.2rem; font-weight:300; letter-spacing:-0.01em;`;
    titleWrap.appendChild(title);
    this.closeButton = createButton('Close', 'primary');
    this.closeButton.addEventListener('click', onClose);
    header.append(titleWrap, this.closeButton);

    const body = document.createElement('div');
    body.className = 'skins-body';
    body.style.cssText = 'flex:1; min-height:0; display:flex; gap:28px;';

    // --- Left: every weapon, by category, with the skin it wears now ---
    const weapons = document.createElement('nav');
    weapons.className = 'skins-weapons skins-scroll';
    weapons.setAttribute('aria-label', 'Weapons');
    weapons.style.cssText = 'flex:0 0 auto; width:clamp(210px, 18vw, 260px); overflow-y:auto; padding:4px; margin:-4px;';
    const weaponList = document.createElement('div');
    weaponList.className = 'skins-weapons-list';
    weaponList.style.cssText = 'display:flex; flex-direction:column; gap:16px;';
    for (const category of CATEGORIES) {
      const group = document.createElement('div');
      group.className = 'skins-weapons-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', CATEGORY_LABELS[category]);
      group.style.cssText = 'display:flex; flex-direction:column; gap:3px;';
      const eyebrow = createEyebrow(CATEGORY_LABELS[category]);
      eyebrow.style.cssText += ' padding:0 12px 4px; white-space:nowrap;';
      if (category === 'special') eyebrow.style.color = AMBER;
      group.appendChild(eyebrow);
      for (const id of weaponIdsIn(category)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'skins-weapon';
        button.dataset.testid = `skins-weapon-${id}`;
        const name = document.createElement('span');
        name.textContent = WEAPON_DEFINITIONS[id]!.name;
        const skin = document.createElement('small');
        button.append(name, skin);
        button.addEventListener('click', () => this.selectWeapon(id));
        this.weaponButtons.set(id, { button, skin });
        group.appendChild(button);
      }
      weaponList.appendChild(group);
    }
    weapons.appendChild(weaponList);

    // --- Middle: the weapon itself, three ways ---
    const stage = document.createElement('section');
    stage.className = 'skins-stage';
    stage.setAttribute('aria-label', 'Preview');
    stage.style.cssText = 'flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:12px;';
    const frame = document.createElement('div');
    frame.style.cssText =
      `position:relative; width:100%; aspect-ratio:16 / 9; max-height:66vh; border:1px solid ${HAIRLINE}; border-radius:2px; overflow:hidden;` +
      ` background:radial-gradient(ellipse at 50% 55%, rgba(111, 240, 220, 0.08), transparent 68%), ${SURFACE};`;
    this.canvas = document.createElement('canvas');
    this.canvas.dataset.testid = 'skins-preview';
    this.canvas.setAttribute('role', 'img');
    this.canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block;';
    this.cross = document.createElement('div');
    this.cross.className = 'skins-cross';
    this.cross.setAttribute('aria-hidden', 'true');
    frame.append(this.canvas, this.cross);

    const caption = document.createElement('div');
    caption.style.cssText = 'display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap;';
    this.stageName = document.createElement('div');
    this.stageName.setAttribute('aria-live', 'polite');
    this.stageName.style.cssText = `font-family:${DISPLAY_FONT}; font-size:1.15rem; font-weight:300; color:${TEXT};`;
    this.stageNote = document.createElement('div');
    this.stageNote.style.cssText = `font-size:0.78rem; line-height:1.4; color:${STEEL};`;
    caption.append(this.stageName, this.stageNote);

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap;';
    const viewGroup = document.createElement('div');
    viewGroup.setAttribute('role', 'radiogroup');
    viewGroup.setAttribute('aria-label', 'How to show it');
    viewGroup.style.cssText = 'display:flex; gap:8px; flex:1 1 320px;';
    for (const { view, label } of VIEWS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'skins-view';
      button.dataset.testid = `skins-view-${view}`;
      button.setAttribute('role', 'radio');
      button.textContent = label;
      button.addEventListener('click', () => this.selectView(view));
      this.viewButtons.set(view, button);
      viewGroup.appendChild(button);
    }
    this.inspectButton = createButton('Inspect');
    this.inspectButton.dataset.testid = 'skins-inspect';
    this.inspectButton.style.padding = '9px 18px';
    this.inspectButton.addEventListener('click', () => {
      if (this.view !== 'hip') this.selectView('hip');
      this.preview?.inspect();
    });
    controls.append(viewGroup, this.inspectButton);
    stage.append(frame, caption, controls);

    // --- Right: the six looks ---
    const list = document.createElement('section');
    list.className = 'skins-list skins-scroll';
    list.setAttribute('aria-label', 'Skins');
    list.style.cssText = 'flex:0 0 auto; width:clamp(250px, 23vw, 330px); overflow-y:auto; padding:4px; margin:-4px;';
    const cards = document.createElement('div');
    cards.className = 'skins-cards';
    cards.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
    for (const skinId of SKIN_IDS) {
      const skin = SKINS[skinId];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'skins-card';
      card.dataset.testid = `skins-skin-${skinId}`;
      const swatches = document.createElement('span');
      swatches.className = 'skins-swatches';
      swatches.setAttribute('aria-hidden', 'true');
      for (const colour of skin.swatches) {
        const chip = document.createElement('span');
        chip.style.background = colour;
        swatches.appendChild(chip);
      }
      const name = document.createElement('span');
      name.textContent = skin.name;
      name.style.cssText = `font-family:${DISPLAY_FONT}; font-size:1rem; font-weight:600;`;
      const description = document.createElement('span');
      description.textContent = skin.description;
      description.style.cssText = `font-size:0.76rem; line-height:1.4; color:${STEEL};`;
      const chips = document.createElement('span');
      chips.style.cssText = 'display:flex; flex-wrap:wrap; gap:5px; margin-top:2px;';
      for (const label of featureLabels(skin)) {
        const chip = document.createElement('span');
        chip.className = 'skins-chip';
        chip.textContent = label;
        chips.appendChild(chip);
      }
      card.append(swatches, name, description, chips);
      card.addEventListener('click', () => this.equip(skinId));
      this.skinCards.set(skinId, card);
      cards.appendChild(card);
    }
    list.appendChild(cards);

    body.append(weapons, stage, list);
    this.overlay.append(header, body);
    root.appendChild(this.overlay);

    // Escape closes the page, same as Close. Document-level, so it must stay quiet while hidden.
    this.onKeyDown = (event) => {
      if (this.overlay.style.display === 'none' || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean {
    return this.overlay.style.display !== 'none';
  }

  /** Opens the page, on `weaponId` when given (the Loadout page opens it on the weapon in view). */
  show(weaponId?: string): void {
    this.skins = loadStoredSkins();
    if (weaponId && this.weaponButtons.has(weaponId)) this.weaponId = weaponId;
    this.overlay.style.display = 'flex';
    this.preview = new WeaponPreview(this.canvas);
    window.addEventListener('resize', this.onResize);
    this.preview.resize();
    this.refresh();
    this.preview.start();
    this.scope.enter(this.overlay, this.weaponButtons.get(this.weaponId)?.button ?? this.closeButton);
  }

  hide(): void {
    if (!this.isOpen) return;
    this.overlay.style.display = 'none';
    window.removeEventListener('resize', this.onResize);
    this.preview?.dispose();
    this.preview = null;
    this.scope.leave();
  }

  dispose(): void {
    this.hide();
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.overlay.remove();
  }

  private selectWeapon(weaponId: string): void {
    this.weaponId = weaponId;
    this.refresh();
  }

  private selectView(view: PreviewView): void {
    this.view = view;
    this.refresh();
  }

  private equip(skinId: SkinId): void {
    this.skins = equipSkin(this.skins, this.weaponId, skinId);
    saveSkins(this.skins);
    this.refresh();
  }

  /** Syncs every control and the preview with the chosen weapon, its skin and the view. */
  private refresh(): void {
    const definition = WEAPON_DEFINITIONS[this.weaponId]!;
    const skinId = equippedSkin(this.skins, this.weaponId);
    // A blade is never aimed, so it has no sights view.
    const canAim = definition.kind === 'ranged';
    const view = this.view === 'aim' && !canAim ? 'hip' : this.view;

    for (const [id, { button, skin }] of this.weaponButtons) {
      button.setAttribute('aria-current', String(id === this.weaponId));
      skin.textContent = SKINS[equippedSkin(this.skins, id)].name;
    }
    for (const [id, card] of this.skinCards) card.setAttribute('aria-pressed', String(id === skinId));
    for (const [id, button] of this.viewButtons) {
      button.setAttribute('aria-checked', String(id === view));
      button.disabled = id === 'aim' && !canAim;
    }
    this.cross.style.display = view === 'display' ? 'none' : 'block';
    this.stageName.textContent = `${definition.name}, ${SKINS[skinId].name}`;
    this.stageNote.textContent = view === 'aim' && definition.hasScope
      ? 'In a match the scope picture takes over at full aim.'
      : VIEWS.find((entry) => entry.view === view)!.hint;
    this.canvas.setAttribute('aria-label', `${definition.name} in the ${SKINS[skinId].name} skin, ${VIEWS.find((entry) => entry.view === view)!.label.toLowerCase()}`);

    if (this.preview) {
      this.preview.show(this.weaponId, skinId, view);
      // What is drawn right now, and how far its sight tip sits from the middle of the picture,
      // for the aim-point screenshots (e2e/skins.spec.ts).
      const offset = this.preview.sightOffsetPixels();
      this.canvas.dataset.sightOffset = offset === null ? '' : offset.toFixed(2);
      this.canvas.dataset.shown = `${this.weaponId}:${skinId}:${view}`;
    }
  }
}
