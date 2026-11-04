import { AMBER, SURFACE, SURFACE_RAISED, INK_FAINT, LABEL_CSS, MONO_FONT } from '../theme.ts';
import { WEAPON_DEFINITIONS, type WeaponDefinition } from '../../weapons/definitions.ts';
import { buildWeaponViewModel } from '../../weapons/models/arsenal.ts';
import {
  createButton,
  createEyebrow,
  attachScanSweep,
  ensureMotionKeyframesInjected,
  ACCENT,
  TEXT,
  STEEL,
  HAIRLINE,
  BG_RAISED,
  BG_VOID,
  DISPLAY_FONT,
  BODY_FONT,
} from './menuStyles.ts';
import { createStatBadge, type StatIconKind } from './statIcons.ts';
import { getCachedWeaponThumbnail, releaseThumbnailRenderer, renderWeaponThumbnail } from './weaponThumbnail.ts';
import { buildGrenadeThumbnailModel } from './grenadeThumbnailModel.ts';
import { FLASH_MAX_RANGE, FLASH_PLAYER_MAX_SECONDS, FRAG_MAX_DAMAGE, FRAG_RADIUS, GRENADE_FUSE } from '../../combat/grenades/grenadeTuning.ts';
import { WEAPON_CATEGORIES, GRENADE_KINDS, type WeaponCategory, type PlayerLoadout, type GrenadeKind } from '../../core/gameModes.ts';
import {
  loadStoredLoadout,
  saveLoadout,
  equipWeapon,
  equipGrenade,
  equippedWeaponId,
  equippedGrenade,
  type LoadoutWeaponSlot,
} from '../../core/loadout.ts';
import { gamepadHint, setDeviceHint } from '../../input/GamepadInput.ts';
import { keyHint } from '../../input/actions.ts';
import { Settings } from '../../settings/Settings.ts';
import { ModalScope } from './modalScope.ts';
import { LoadoutCharacterPreview } from './loadoutCharacterPreview.ts';
import type { Object3D } from 'three';

const REWARD_GOLD = AMBER;

const EQUIPPABLE_CATEGORIES: readonly LoadoutWeaponSlot[] = ['primary', 'secondary', 'melee'];
const CATEGORY_LABELS: Record<WeaponCategory, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  melee: 'Melee',
  special: 'Special',
};
// Explicit per-category ordering (per user request: "Sniper, AK, shotgun all primary... pistol and
// mp5 are secondary") rather than relying on WEAPON_DEFINITIONS' own object-key order, which
// doesn't necessarily match the order players should see them listed in.
const CATEGORY_DISPLAY_ORDER: Record<WeaponCategory, readonly string[]> = {
  primary: ['sniper', 'rifle', 'shotgun'],
  secondary: ['pistol', 'mp5'],
  melee: ['knife'],
  special: ['gooseLauncher'],
};

/** What the Loadout page says about each grenade. The numbers come from the grenades' own tuning
 * table (combat/grenades/grenadeTuning.ts), so the page and the game never disagree. */
interface GrenadeChoice {
  readonly name: string;
  readonly description: string;
  readonly stats: readonly (readonly [StatIconKind, string])[];
}
const GRENADE_CHOICES: Readonly<Record<GrenadeKind, GrenadeChoice>> = {
  frag: {
    name: 'Frag Grenade',
    description: 'A shrapnel burst, deadliest close to the blast.',
    stats: [['damage', `${FRAG_MAX_DAMAGE} near`], ['radius', `${FRAG_RADIUS} m radius`], ['fuse', `${GRENADE_FUSE.frag.toFixed(1)} s fuse`]],
  },
  flash: {
    name: 'Flash Grenade',
    description: 'A blinding burst that whites out anyone facing it.',
    stats: [['blind', `Blinds up to ${FLASH_PLAYER_MAX_SECONDS} s`], ['reach', `${FLASH_MAX_RANGE} m reach`], ['fuse', `${GRENADE_FUSE.flash.toFixed(1)} s fuse`]],
  },
};

/** View-model arm parts (arsenal.ts's hands()): the tiles show the weapon's design alone. */
const ARM_PART_NAMES: ReadonlySet<string> = new Set(['trigger-hand', 'trigger-sleeve', 'support-hand', 'support-sleeve']);

/** One-time injected rules: the tile states (hover, focus, equipped) need pseudo-classes and
 * pseudo-elements that inline `style.cssText` can't declare, and the weapon list hides its
 * scrollbar in WebKit/Blink (paired with the inline `scrollbar-width`/`-ms-overflow-style` below
 * for Firefox/legacy Edge). Mirrors menuStyles.ts's own ensureMotionKeyframesInjected pattern. */
let loadoutStyleInjected = false;
function ensureLoadoutStyleInjected(): void {
  if (loadoutStyleInjected) return;
  loadoutStyleInjected = true;
  const style = document.createElement('style');
  style.textContent =
    '.loadout-scroll-hide::-webkit-scrollbar { display: none; }' +
    // Landscape tiles reserve a caption strip below the rendered design.
    '.loadout-tile {' +
    '  position: relative; flex: 0 0 auto; box-sizing: border-box; margin: 0; padding: 0; overflow: hidden;' +
    '  width: var(--loadout-tile-w); height: calc(var(--loadout-tile-w) * 0.66); display: flex; flex-direction: column;' +
    // A faint pool of light behind the design lifts the dark gunmetal renders off the tile.
    `  background: radial-gradient(circle at 50% 50%, rgba(111, 240, 220, 0.07), transparent 70%), ${SURFACE};` +
    `  border: 1px solid ${HAIRLINE}; border-radius: 2px; color: ${TEXT}; cursor: pointer;` +
    '  transition: border-color 150ms ease-out, background-color 150ms ease-out;' +
    '}' +
    '.loadout-tile-small { width: var(--loadout-grenade-tile); height: calc(var(--loadout-grenade-tile) * 0.66); }' +
    '.loadout-tile img { display: block; flex: 1; min-height: 0; width: 100%; height: 0; object-fit: contain; pointer-events: none; }' +
    `.loadout-tile:hover { border-color: ${INK_FAINT}; }` +
    `.loadout-tile[aria-pressed="true"] { border-color: ${ACCENT}; box-shadow: inset 0 0 0 1px ${ACCENT}; background-color: ${SURFACE_RAISED}; }` +
    // The equipped corner: a solid accent triangle, so equipped reads even while another tile has focus.
    '.loadout-tile[aria-pressed="true"]::after {' +
    "  content: ''; position: absolute; top: 0; right: 0; width: 0; height: 0;" +
    `  border-style: solid; border-width: 0 16px 16px 0; border-color: transparent ${ACCENT} transparent transparent;` +
    '}' +
    `.loadout-tile-reward, .loadout-tile-reward:hover { border-color: ${REWARD_GOLD}; }` +
    '.loadout-tile-caption {' +
    '  flex: 0 0 auto; box-sizing: border-box; width: 100%; margin-top: auto; padding: 5px 8px; pointer-events: none;' +
    `  font-family: ${BODY_FONT}; font-size: 11.5px; font-weight: 600; line-height: 1.2; text-align: left; color: ${TEXT};` +
    `  background: ${BG_VOID}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` +
    '}' +
    '@media (prefers-reduced-motion: reduce) { .loadout-tile { transition: none; } }' +
    // Small-viewport clamp: below 980px the fixed 3-column layout (catalog / details and equipped
    // slots / character rim) has no room left for any of the three to breathe, so it collapses to a
    // single scrollable column instead - the body itself (normally unscrolled, each column
    // scrolls independently) becomes the scroll container, and the character rim shrinks to a
    // fixed height rather than the vh-based sizing that assumes a tall desktop viewport.
    '@media (max-width: 980px) {' +
    '  .loadout-body { flex-direction: column; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; }' +
    // Each column takes its content's height (the body scrolls, not the catalog).
    '  .loadout-body > * { flex: none !important; }' +
    '  .loadout-catalog-wrap { width: 100%; }' +
    '  .loadout-catalog { flex: none !important; width: 100%; overflow-y: visible !important; }' +
    '  .loadout-middle { width: 100% !important; }' +
    '  .loadout-rim { width: 100% !important; height: 340px !important; }' +
    '}';
  document.head.appendChild(style);
}

interface WeaponTile {
  readonly element: HTMLButtonElement;
  readonly weapon: WeaponDefinition;
  readonly category: WeaponCategory;
}

interface GrenadeTile {
  readonly element: HTMLButtonElement;
  readonly kind: GrenadeKind;
}

type DetailsTarget = { readonly kind: 'weapon'; readonly id: string } | { readonly kind: 'grenade'; readonly id: GrenadeKind };

/** A landscape tile with a rendered design and permanent name caption.
 * `name` is also its accessible name; the details panel carries everything else. */
function buildTile(name: string, thumbnailDataUrl: string | null, options: { small?: boolean; reward?: boolean } = {}): HTMLButtonElement {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'loadout-tile' + (options.small ? ' loadout-tile-small' : '') + (options.reward ? ' loadout-tile-reward' : '');
  tile.setAttribute('aria-label', options.reward ? `${name}, reward only` : name);
  if (thumbnailDataUrl) {
    const img = document.createElement('img');
    img.src = thumbnailDataUrl;
    img.alt = '';
    tile.appendChild(img);
  }
  const caption = document.createElement('span');
  caption.className = 'loadout-tile-caption';
  caption.setAttribute('aria-hidden', 'true');
  caption.textContent = name;
  tile.appendChild(caption);
  return tile;
}

function weaponStats(weapon: WeaponDefinition): HTMLSpanElement[] {
  const stats = [
    createStatBadge('damage', `${weapon.damage}`),
    createStatBadge('fireRate', `${weapon.fireRate}/s`),
    createStatBadge('magazine', `${weapon.magazineSize}`),
    createStatBadge('reload', `${weapon.reloadTime}s`),
  ];
  if (weapon.hasScope) stats.push(createStatBadge('scope', 'Scope'));
  if (weapon.burstCount && weapon.burstCount > 1) stats.push(createStatBadge('fireRate', `${weapon.burstCount}-round burst`));
  return stats;
}

/** A tile row: landscape tiles side by side, wrapping when the column is narrow. */
function buildTileRow(label: string, tiles: readonly HTMLButtonElement[]): HTMLDivElement {
  const row = document.createElement('div');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', label);
  row.style.cssText = 'display:flex; flex-wrap:wrap; gap:10px;';
  row.append(...tiles);
  return row;
}

/** Full-page loadout management (per explicit user request - replaces the old read-only
 * "Inventory" showcase): weapons as landscape tiles grouped by category on the left (clicked to
 * equip), with a smaller Grenade section below them; the clicked item's details and the equipped
 * Primary/Secondary/Melee/Grenade readout in the middle; and the player's character spinning inside
 * a tall rim on the right. The category is the whole point - it's what stops a player stacking
 * multiple primaries, since clicking a weapon only ever fills *its own* category's slot. Persists
 * immediately on every click (see core/loadout.ts), same "survives a reload" mechanism the saved
 * username already uses. */
export class LoadoutScreen {
  private readonly overlay: HTMLDivElement;
  private readonly characterPreview: LoadoutCharacterPreview;
  private readonly slotValueElements: Record<LoadoutWeaponSlot | 'grenade', HTMLDivElement>;
  private readonly weaponTiles: WeaponTile[];
  private readonly grenadeTiles: GrenadeTile[];
  private readonly details: {
    readonly category: HTMLDivElement;
    readonly status: HTMLDivElement;
    readonly name: HTMLDivElement;
    readonly description: HTMLDivElement;
    readonly stats: HTMLDivElement;
  };
  private readonly updateScrollHint: () => void;
  private readonly closeButton: HTMLButtonElement;
  private readonly grenadeKeyCap: HTMLSpanElement;
  private readonly scope = new ModalScope();
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private loadout: PlayerLoadout;
  private detailsTarget: DetailsTarget;

  private constructor(root: HTMLElement, weaponTiles: WeaponTile[], grenadeTiles: GrenadeTile[], onClose: () => void) {
    ensureLoadoutStyleInjected();
    ensureMotionKeyframesInjected();
    this.weaponTiles = weaponTiles;
    this.grenadeTiles = grenadeTiles;
    this.loadout = loadStoredLoadout();
    this.detailsTarget = { kind: 'weapon', id: equippedWeaponId(this.loadout, 'primary') };

    this.overlay = document.createElement('div');
    this.overlay.dataset.testid = 'loadout-screen';
    this.overlay.className = 'menu-surface';
    // Tile widths follow the viewport; each category occupies its own full-width band.
    this.overlay.style.cssText =
      `position:absolute; inset:0; display:none; flex-direction:column; background:${BG_VOID};` +
      ` color:${TEXT}; font-family:${BODY_FONT}; z-index:30; pointer-events:auto; padding:36px 48px; box-sizing:border-box;` +
      ' --loadout-tile-w:clamp(124px, 10.5vw, 168px); --loadout-grenade-tile:calc(var(--loadout-tile-w) * 0.62);';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:baseline; justify-content:space-between; margin-bottom:24px; flex-shrink:0;';
    const titleWrap = document.createElement('div');
    titleWrap.append(createEyebrow('Choose your weapons'));
    const title = document.createElement('div');
    title.textContent = 'LOADOUT';
    title.className = 'menu-panel-title';
    title.style.cssText = `font-family:${DISPLAY_FONT}; font-size:2.2rem; font-weight:300; letter-spacing:-0.01em; margin-top:6px;`;
    titleWrap.appendChild(title);
    const closeButton = createButton('Close', 'primary');
    closeButton.addEventListener('click', onClose);
    this.closeButton = closeButton;
    header.append(titleWrap, closeButton);

    const body = document.createElement('div');
    body.className = 'loadout-body loadout-scroll-hide';
    body.style.cssText = 'flex:1; min-height:0; display:flex; gap:32px;';

    // --- Left: the weapon catalog, grouped/ordered by category, scrollbar-free (see below) ---
    const leftColumnWrap = document.createElement('div');
    leftColumnWrap.className = 'loadout-catalog-wrap';
    leftColumnWrap.style.cssText = 'flex:1.3; min-width:0; position:relative; display:flex; min-height:0;';

    const leftColumn = document.createElement('div');
    leftColumn.className = 'loadout-catalog loadout-scroll-hide';
    // It scrolls with its scrollbar hidden, so keyboard users need to be able to focus it.
    leftColumn.tabIndex = 0;
    leftColumn.setAttribute('role', 'region');
    leftColumn.setAttribute('aria-label', 'Weapon catalog');
    // The 5px padding (cancelled by the margin) keeps a focused tile's outline inside the scroll box.
    leftColumn.style.cssText =
      'flex:1; min-width:0; overflow-y:auto; display:flex; flex-direction:column; gap:26px; padding:5px; margin:-5px;' +
      ' scrollbar-width:none; -ms-overflow-style:none;';

    // Category bands stack in order, with a heading above each tile row.
    const weaponSections = document.createElement('div');
    weaponSections.style.cssText = 'display:flex; flex-direction:column; flex-shrink:0; gap:22px;';
    for (const category of ['primary', 'secondary', 'melee', 'special'] as const) {
      const section = document.createElement('div');
      section.style.cssText = 'display:flex; flex-direction:column; width:100%; gap:10px;';
      const heading = document.createElement('div');
      heading.style.cssText = 'display:flex; align-items:baseline; gap:12px;';
      // The Goose Launcher's section says what it is in gold instead of "Special".
      const eyebrow = createEyebrow(category === 'special' ? 'Reward only' : CATEGORY_LABELS[category]);
      if (category === 'special') eyebrow.style.color = REWARD_GOLD;
      heading.appendChild(eyebrow);
      const tiles = weaponTiles.filter((t) => t.category === category).map((t) => t.element);
      section.append(heading, buildTileRow(CATEGORY_LABELS[category], tiles));
      weaponSections.appendChild(section);
    }

    // The grenade: a smaller section below the weapons, with its throw key.
    const grenadeSection = document.createElement('div');
    grenadeSection.dataset.testid = 'loadout-grenades';
    grenadeSection.style.cssText = `display:flex; flex-direction:column; flex-shrink:0; gap:10px; padding-top:18px; border-top:1px solid ${HAIRLINE};`;
    const grenadeHeading = document.createElement('div');
    grenadeHeading.style.cssText = 'display:flex; align-items:center; gap:12px;';
    const throwHint = document.createElement('div');
    throwHint.style.cssText = `display:flex; align-items:center; gap:6px; ${LABEL_CSS}`;
    const keyCap = document.createElement('span');
    keyCap.dataset.testid = 'loadout-grenade-key';
    keyCap.style.cssText =
      `font-family:${MONO_FONT}; font-size:10.5px; font-weight:400; letter-spacing:0; text-transform:none; color:${TEXT};` +
      ` border:1px solid ${HAIRLINE}; border-radius:2px; padding:2px 6px; background:${BG_RAISED};`;
    this.grenadeKeyCap = keyCap;
    this.refreshGrenadeHint();
    const throwLabel = document.createElement('span');
    throwLabel.textContent = 'to throw';
    throwHint.append(keyCap, throwLabel);
    grenadeHeading.append(createEyebrow('Grenade'), throwHint);
    grenadeSection.append(grenadeHeading, buildTileRow('Grenade', grenadeTiles.map((t) => t.element)));

    leftColumn.append(weaponSections, grenadeSection);

    // A soft fade + chevron standing in for a scrollbar - present only while there's more to see
    // below the fold (see updateScrollHint), so it reads as "more below" rather than a permanent
    // decoration once the player has already scrolled to the bottom.
    const scrollHint = document.createElement('div');
    scrollHint.style.cssText =
      'position:absolute; left:0; right:0; bottom:0; height:64px; pointer-events:none;' +
      ` background:linear-gradient(to bottom, transparent, ${BG_VOID}); display:flex;` +
      ' align-items:flex-end; justify-content:center; padding-bottom:6px; opacity:0; transition:opacity 0.2s ease-out;';
    const chevron = document.createElement('div');
    chevron.textContent = '▾';
    chevron.style.cssText = `color:${STEEL}; font-size:1.1rem; animation:pulseGlow 1.6s ease-in-out infinite;`;
    scrollHint.appendChild(chevron);

    this.updateScrollHint = (): void => {
      const hasMoreBelow = leftColumn.scrollTop + leftColumn.clientHeight < leftColumn.scrollHeight - 2;
      scrollHint.style.opacity = hasMoreBelow ? '1' : '0';
    };
    leftColumn.addEventListener('scroll', this.updateScrollHint);

    leftColumnWrap.append(leftColumn, scrollHint);

    // --- Middle: the clicked item's details, then the currently-equipped readout per slot ---
    const middleColumn = document.createElement('div');
    middleColumn.className = 'loadout-middle';
    middleColumn.style.cssText = 'flex:0 0 auto; width:clamp(230px, 19vw, 290px); display:flex; flex-direction:column; justify-content:center; gap:12px;';

    const detailsPanel = document.createElement('div');
    detailsPanel.className = 'loadout-details';
    detailsPanel.dataset.testid = 'loadout-details';
    detailsPanel.setAttribute('aria-live', 'polite');
    detailsPanel.style.cssText =
      `box-sizing:border-box; min-height:178px; padding:16px 18px; background:${BG_RAISED}; border:1px solid ${HAIRLINE};` +
      ' border-radius:2px; display:flex; flex-direction:column; gap:8px; margin-bottom:10px;';
    const detailsTop = document.createElement('div');
    detailsTop.style.cssText = 'display:flex; justify-content:space-between; align-items:baseline; gap:8px;';
    const detailsCategory = document.createElement('div');
    detailsCategory.style.cssText = LABEL_CSS;
    const detailsStatus = document.createElement('div');
    detailsStatus.style.cssText = LABEL_CSS;
    detailsTop.append(detailsCategory, detailsStatus);
    const detailsName = document.createElement('div');
    detailsName.style.cssText = `font-family:${DISPLAY_FONT}; font-size:1.2rem; font-weight:300; color:${TEXT};`;
    const detailsDescription = document.createElement('div');
    detailsDescription.style.cssText = `font-family:${BODY_FONT}; font-size:0.8rem; line-height:1.4; color:${STEEL};`;
    const detailsStats = document.createElement('div');
    detailsStats.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px 12px; margin-top:2px; font-size:0.72rem; opacity:0.8; font-variant-numeric:tabular-nums;';
    detailsPanel.append(detailsTop, detailsName, detailsDescription, detailsStats);
    this.details = { category: detailsCategory, status: detailsStatus, name: detailsName, description: detailsDescription, stats: detailsStats };
    middleColumn.appendChild(detailsPanel);

    this.slotValueElements = {} as Record<LoadoutWeaponSlot | 'grenade', HTMLDivElement>;
    for (const slot of [...EQUIPPABLE_CATEGORIES, 'grenade'] as const) {
      const { socket, value } = this.buildSlotSocket(slot);
      this.slotValueElements[slot] = value;
      middleColumn.appendChild(socket);
    }

    // --- Right: the rotating character, inside a tall rectangle rather than a circle (per
    // explicit user request - "decently sized to have the character spinning inside") ---
    const rightColumn = document.createElement('div');
    rightColumn.style.cssText = 'flex:1; min-width:0; display:flex; align-items:center; justify-content:center;';

    const rim = document.createElement('div');
    rim.className = 'loadout-rim';
    rim.style.cssText =
      `width:min(100%, 420px); height:min(72vh, 620px); border:1px solid ${HAIRLINE};` +
      ` border-radius:2px;` +
      ` background:${SURFACE}; backdrop-filter:blur(10px); overflow:hidden;`;
    const characterHost = document.createElement('div');
    characterHost.style.cssText = 'width:100%; height:100%;';
    rim.appendChild(characterHost);
    this.characterPreview = new LoadoutCharacterPreview(characterHost);
    rightColumn.appendChild(rim);

    body.append(leftColumnWrap, middleColumn, rightColumn);

    this.overlay.append(header, body);
    root.appendChild(this.overlay);

    for (const tile of weaponTiles) {
      tile.element.addEventListener('click', () => {
        // Reward-only weapons (the Goose Launcher) just show their details; equipWeapon ignores them.
        this.loadout = equipWeapon(this.loadout, tile.weapon.id);
        saveLoadout(this.loadout);
        this.detailsTarget = { kind: 'weapon', id: tile.weapon.id };
        this.refresh();
      });
    }
    for (const tile of grenadeTiles) {
      tile.element.addEventListener('click', () => {
        this.loadout = equipGrenade(this.loadout, tile.kind);
        saveLoadout(this.loadout);
        this.detailsTarget = { kind: 'grenade', id: tile.kind };
        this.refresh();
      });
    }

    this.refresh();
    // Escape closes the page, same as Close. Document-level, so it must stay quiet while hidden.
    this.onKeyDown = (event) => {
      if (this.overlay.style.display === 'none' || event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', this.onKeyDown);
    // Run once after layout settles, so the hint's initial visibility matches whether the list
    // actually overflows (a short catalog never shows it at all).
    requestAnimationFrame(this.updateScrollHint);
  }

  /** The throw key as bound now (the player can rebind it in Settings), or "Unbound". */
  private refreshGrenadeHint(): void {
    setDeviceHint(this.grenadeKeyCap, keyHint(Settings.getKeyBindings(), 'grenade'), gamepadHint('grenade') ?? 'RB');
  }

  private buildSlotSocket(slot: LoadoutWeaponSlot | 'grenade'): { socket: HTMLDivElement; value: HTMLDivElement } {
    const socket = document.createElement('div');
    socket.dataset.testid = `loadout-slot-${slot}`;
    socket.style.cssText =
      `padding:10px 16px; background:${BG_RAISED}; border:1px solid ${HAIRLINE};` +
      ` border-radius:2px;`;

    const label = document.createElement('div');
    label.textContent = slot === 'grenade' ? 'GRENADE' : CATEGORY_LABELS[slot].toUpperCase();
    label.style.cssText = `${LABEL_CSS} margin-bottom:4px;`;

    const value = document.createElement('div');
    value.style.cssText = `font-family:${DISPLAY_FONT}; font-size:0.95rem; font-weight:600; color:${TEXT};`;

    socket.append(label, value);
    return { socket, value };
  }

  /** Syncs everything that depends on the loadout or the details target: the slot readout, each
   * tile's equipped state and the details panel. */
  private refresh(): void {
    for (const slot of EQUIPPABLE_CATEGORIES) {
      const equippedId = equippedWeaponId(this.loadout, slot);
      this.slotValueElements[slot].textContent = WEAPON_DEFINITIONS[equippedId]?.name ?? equippedId;
    }
    const grenade = equippedGrenade(this.loadout);
    this.slotValueElements.grenade.textContent = GRENADE_CHOICES[grenade].name;

    for (const tile of this.weaponTiles) {
      if (tile.category === 'special') continue;
      const equipped = equippedWeaponId(this.loadout, tile.category) === tile.weapon.id;
      tile.element.setAttribute('aria-pressed', String(equipped));
    }
    for (const tile of this.grenadeTiles) tile.element.setAttribute('aria-pressed', String(tile.kind === grenade));

    this.renderDetails();
  }

  private renderDetails(): void {
    const target = this.detailsTarget;
    const { category, status, name, description, stats } = this.details;
    if (target.kind === 'grenade') {
      const choice = GRENADE_CHOICES[target.id];
      category.textContent = 'Grenade';
      name.textContent = choice.name;
      name.style.color = TEXT;
      description.textContent = choice.description;
      stats.replaceChildren(...choice.stats.map(([icon, label]) => createStatBadge(icon, label)));
      LoadoutScreen.setDetailsStatus(status, equippedGrenade(this.loadout) === target.id ? 'equipped' : null);
      return;
    }
    const weapon = WEAPON_DEFINITIONS[target.id];
    if (!weapon) return;
    const weaponCategory = WEAPON_CATEGORIES[weapon.id] ?? 'special';
    category.textContent = CATEGORY_LABELS[weaponCategory];
    name.textContent = weapon.name;
    name.style.color = weaponCategory === 'special' ? REWARD_GOLD : TEXT;
    description.textContent = weapon.description;
    stats.replaceChildren(...weaponStats(weapon));
    LoadoutScreen.setDetailsStatus(
      status,
      weaponCategory === 'special' ? 'reward' : equippedWeaponId(this.loadout, weaponCategory) === weapon.id ? 'equipped' : null,
    );
  }

  private static setDetailsStatus(element: HTMLDivElement, state: 'equipped' | 'reward' | null): void {
    element.textContent = state === 'equipped' ? 'Equipped' : state === 'reward' ? 'Reward only' : '';
    element.style.color = state === 'reward' ? REWARD_GOLD : ACCENT;
  }

  static async create(root: HTMLElement, onClose: () => void): Promise<LoadoutScreen> {
    const orderedWeaponIds = [
      ...CATEGORY_DISPLAY_ORDER.primary,
      ...CATEGORY_DISPLAY_ORDER.secondary,
      ...CATEGORY_DISPLAY_ORDER.melee,
      ...CATEGORY_DISPLAY_ORDER.special,
    ];
    // Thumbnails are cached per weapon for the whole session (see weaponThumbnail.ts), so only the
    // first LoadoutScreen actually renders anything - every later one (Game.ts builds one per
    // match) just reuses the cached data URLs and never touches WebGL at all.
    let weaponTiles: WeaponTile[];
    let grenadeTiles: GrenadeTile[];
    try {
      weaponTiles = await Promise.all(
        orderedWeaponIds.map(async (weaponId): Promise<WeaponTile> => {
          const weapon = WEAPON_DEFINITIONS[weaponId]!;
          const category = WEAPON_CATEGORIES[weaponId]!;
          let thumbnailDataUrl = getCachedWeaponThumbnail(weapon.id);
          if (thumbnailDataUrl === null) {
            try {
              const { group } = buildWeaponViewModel(weapon.id);
              const arms: Object3D[] = [];
              group.traverse((object) => { if (ARM_PART_NAMES.has(object.name)) arms.push(object); });
              for (const arm of arms) arm.removeFromParent();
              thumbnailDataUrl = renderWeaponThumbnail(weapon.id, group);
            } catch (error) {
              console.warn(`Failed to render loadout thumbnail for "${weapon.id}"`, error);
            }
          }
          return { element: buildTile(weapon.name, thumbnailDataUrl, { reward: category === 'special' }), weapon, category };
        }),
      );
      grenadeTiles = GRENADE_KINDS.map((kind): GrenadeTile => {
        const cacheKey = `grenade-${kind}`;
        let thumbnailDataUrl = getCachedWeaponThumbnail(cacheKey);
        if (thumbnailDataUrl === null) {
          try {
            thumbnailDataUrl = renderWeaponThumbnail(cacheKey, buildGrenadeThumbnailModel(kind));
          } catch (error) {
            console.warn(`Failed to render loadout thumbnail for the ${kind} grenade`, error);
          }
        }
        const element = buildTile(GRENADE_CHOICES[kind].name, thumbnailDataUrl, { small: true });
        element.dataset.grenadeId = kind;
        return { element, kind };
      });
    } finally {
      // The whole catalog shares one offscreen renderer - release its context as soon as the batch
      // is done rather than holding it for the session.
      releaseThumbnailRenderer();
    }
    for (const tile of weaponTiles) tile.element.dataset.weaponId = tile.weapon.id;

    return new LoadoutScreen(root, weaponTiles, grenadeTiles, onClose);
  }

  show(): void {
    this.overlay.style.display = 'flex';
    this.loadout = loadStoredLoadout();
    this.refresh();
    this.refreshGrenadeHint();
    this.characterPreview.start();
    attachScanSweep(this.overlay);
    requestAnimationFrame(this.updateScrollHint);
    // Keyboard focus belongs in the page: on the equipped primary, else Close. Whatever is behind
    // (the pause menu) goes inert so Tab cannot reach it.
    const equipped = equippedWeaponId(this.loadout, 'primary');
    const tile = this.weaponTiles.find((candidate) => candidate.weapon.id === equipped)?.element;
    this.scope.enter(this.overlay, tile ?? this.closeButton);
  }

  hide(): void {
    this.overlay.style.display = 'none';
    this.characterPreview.stop();
    this.scope.leave();
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.scope.leave();
    this.characterPreview.dispose();
    this.overlay.remove();
  }
}
