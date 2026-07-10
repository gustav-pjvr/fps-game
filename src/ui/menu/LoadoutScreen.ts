import { loadGLTF } from '../../core/AssetLoader.ts';
import { WEAPON_DEFINITIONS, type WeaponDefinition } from '../../weapons/definitions.ts';
import { WEAPON_MODEL_SPECS, createProceduralMeleeViewModel } from '../../weapons/viewModel.ts';
import {
  createButton,
  createEyebrow,
  chamferClipPath,
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
import { createStatBadge } from './statIcons.ts';
import { renderWeaponThumbnail } from './weaponThumbnail.ts';
import { WEAPON_CATEGORIES, LOADOUT_SLOT_DEFAULTS, type WeaponCategory, type PlayerLoadout } from '../../core/gameModes.ts';
import { loadStoredLoadout, saveLoadout } from '../../core/loadout.ts';
import { LoadoutCharacterPreview } from './loadoutCharacterPreview.ts';

const REWARD_GOLD = '#ffd54a';

type EquippableCategory = 'primary' | 'secondary' | 'melee';
const EQUIPPABLE_CATEGORIES: readonly EquippableCategory[] = ['primary', 'secondary', 'melee'];
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

/** One-time injected rule so the weapon list can hide its scrollbar in WebKit/Blink browsers (no
 * inline-style equivalent exists for the `::-webkit-scrollbar` pseudo-element) - paired with the
 * `scrollbar-width`/`-ms-overflow-style` inline properties below, which cover Firefox/legacy Edge.
 * Mirrors menuStyles.ts's own ensureMotionKeyframesInjected pattern for the same reason (inline
 * `style.cssText` can't declare this either). */
let scrollbarHideStyleInjected = false;
function ensureScrollbarHideStyleInjected(): void {
  if (scrollbarHideStyleInjected) return;
  scrollbarHideStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = '.loadout-scroll-hide::-webkit-scrollbar { display: none; }';
  document.head.appendChild(style);
}

interface WeaponCard {
  readonly element: HTMLDivElement;
  readonly weapon: WeaponDefinition;
}

function buildWeaponCard(weapon: WeaponDefinition, thumbnailDataUrl: string | null, category: WeaponCategory): HTMLDivElement {
  const isSpecial = category === 'special';
  const card = document.createElement('div');
  card.dataset.weaponId = weapon.id;
  card.style.cssText =
    'display:flex; flex-direction:column; gap:10px; padding:14px 16px;' +
    ` background:${BG_RAISED}; border:1px solid ${isSpecial ? REWARD_GOLD : HAIRLINE};` +
    ` clip-path:${chamferClipPath('top-right', 10)}; transition:border-color 0.15s ease-out, transform 0.12s ease-out;` +
    (isSpecial ? ' opacity:0.75;' : ' cursor:pointer;') +
    (isSpecial ? ` box-shadow:0 0 14px rgba(255,213,74,0.2);` : '');

  if (isSpecial) {
    const badge = document.createElement('div');
    badge.textContent = 'REWARD ONLY - NOT EQUIPPABLE';
    badge.style.cssText = `font-family:${DISPLAY_FONT}; font-size:0.65rem; font-weight:700; letter-spacing:0.1em; color:${REWARD_GOLD};`;
    card.appendChild(badge);
  }

  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:14px;';

  const thumbnail = document.createElement('div');
  thumbnail.style.cssText =
    'flex-shrink:0; width:92px; height:92px; background:rgba(0,0,0,0.3);' +
    ' display:flex; align-items:center; justify-content:center; overflow:hidden;';
  if (thumbnailDataUrl) {
    const img = document.createElement('img');
    img.src = thumbnailDataUrl;
    img.alt = `${weapon.name} preview`;
    img.style.cssText = 'width:100%; height:100%; object-fit:contain; pointer-events:none;';
    thumbnail.appendChild(img);
  }

  const info = document.createElement('div');
  info.style.cssText = 'flex:1; min-width:0;';

  const name = document.createElement('div');
  name.textContent = weapon.name;
  name.style.cssText = `font-family:${DISPLAY_FONT}; font-size:0.95rem; font-weight:700; margin-bottom:4px; color:${isSpecial ? REWARD_GOLD : TEXT};`;

  const desc = document.createElement('div');
  desc.textContent = weapon.description;
  desc.style.cssText = `font-family:${BODY_FONT}; font-size:0.8rem; opacity:0.75; font-style:italic; margin-bottom:6px;`;

  const stats = document.createElement('div');
  stats.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px 12px; font-size:0.72rem; opacity:0.75; font-variant-numeric:tabular-nums;';
  stats.append(
    createStatBadge('damage', `${weapon.damage}`),
    createStatBadge('fireRate', `${weapon.fireRate}/s`),
    createStatBadge('magazine', `${weapon.magazineSize}`),
    createStatBadge('reload', `${weapon.reloadTime}s`),
  );
  if (weapon.hasScope) stats.appendChild(createStatBadge('scope', 'Scope'));
  if (weapon.burstCount && weapon.burstCount > 1) stats.appendChild(createStatBadge('fireRate', `${weapon.burstCount}-round burst`));

  info.append(name, desc, stats);
  row.append(thumbnail, info);
  card.appendChild(row);
  return card;
}

/** Full-page loadout management (per explicit user request - replaces the old read-only
 * "Inventory" showcase): guns grouped by category on the left (clicked to equip), the currently
 * equipped Primary/Secondary/Melee readout in the middle, and the player's character spinning
 * inside a tall rim on the right. The category label is the whole point - it's what stops a player
 * stacking multiple primaries, since clicking a weapon only ever fills *its own* category's slot.
 * Persists immediately on every click (see core/loadout.ts), same "survives a reload" mechanism
 * the saved username already uses. */
export class LoadoutScreen {
  private readonly overlay: HTMLDivElement;
  private readonly characterPreview: LoadoutCharacterPreview;
  private readonly slotValueElements: Record<EquippableCategory, HTMLDivElement>;
  private readonly cards: WeaponCard[];
  private loadout: PlayerLoadout;

  private constructor(root: HTMLElement, cards: WeaponCard[], onClose: () => void) {
    ensureScrollbarHideStyleInjected();
    ensureMotionKeyframesInjected();
    this.cards = cards;
    this.loadout = loadStoredLoadout();

    this.overlay = document.createElement('div');
    this.overlay.dataset.testid = 'loadout-screen';
    this.overlay.style.cssText =
      `position:absolute; inset:0; display:none; flex-direction:column; background:${BG_VOID};` +
      ` color:${TEXT}; font-family:${BODY_FONT}; z-index:30; pointer-events:auto; padding:36px 48px; box-sizing:border-box;`;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:baseline; justify-content:space-between; margin-bottom:24px; flex-shrink:0;';
    const titleWrap = document.createElement('div');
    titleWrap.append(createEyebrow('Equip your fight'));
    const title = document.createElement('div');
    title.textContent = 'LOADOUT';
    title.style.cssText = `font-family:${DISPLAY_FONT}; font-size:2.2rem; font-weight:700; letter-spacing:0.1em; margin-top:6px;`;
    titleWrap.appendChild(title);
    const closeButton = createButton('Close', 'primary');
    closeButton.addEventListener('click', onClose);
    header.append(titleWrap, closeButton);

    const body = document.createElement('div');
    body.style.cssText = 'flex:1; min-height:0; display:flex; gap:32px;';

    // --- Left: the weapon catalog, grouped/ordered by category, scrollbar-free (see below) ---
    const leftColumnWrap = document.createElement('div');
    leftColumnWrap.style.cssText = 'flex:1.3; min-width:0; position:relative; display:flex; min-height:0;';

    const leftColumn = document.createElement('div');
    leftColumn.className = 'loadout-scroll-hide';
    leftColumn.style.cssText =
      'flex:1; min-width:0; overflow-y:auto; display:flex; flex-direction:column; gap:22px;' +
      ' scrollbar-width:none; -ms-overflow-style:none;';
    for (const category of ['primary', 'secondary', 'melee', 'special'] as const) {
      const section = document.createElement('div');
      section.style.cssText = 'display:flex; flex-direction:column; gap:10px;';
      section.appendChild(createEyebrow(CATEGORY_LABELS[category]));
      const categoryCards = cards.filter((c) => WEAPON_CATEGORIES[c.weapon.id] === category);
      for (const c of categoryCards) section.appendChild(c.element);
      leftColumn.appendChild(section);
    }

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

    const updateScrollHint = (): void => {
      const hasMoreBelow = leftColumn.scrollTop + leftColumn.clientHeight < leftColumn.scrollHeight - 2;
      scrollHint.style.opacity = hasMoreBelow ? '1' : '0';
    };
    leftColumn.addEventListener('scroll', updateScrollHint);

    leftColumnWrap.append(leftColumn, scrollHint);

    // --- Middle: the currently-equipped readout for each slot ---
    const middleColumn = document.createElement('div');
    middleColumn.style.cssText = 'flex:0 0 auto; width:190px; display:flex; flex-direction:column; justify-content:center; gap:14px;';
    this.slotValueElements = {} as Record<EquippableCategory, HTMLDivElement>;
    for (const category of EQUIPPABLE_CATEGORIES) {
      const { socket, value } = this.buildSlotSocket(category);
      this.slotValueElements[category] = value;
      middleColumn.appendChild(socket);
    }

    // --- Right: the rotating character, inside a tall rectangle rather than a circle (per
    // explicit user request - "decently sized to have the character spinning inside") ---
    const rightColumn = document.createElement('div');
    rightColumn.style.cssText = 'flex:1; min-width:0; display:flex; align-items:center; justify-content:center;';

    const rim = document.createElement('div');
    rim.style.cssText =
      `width:min(100%, 420px); height:min(72vh, 620px); border:2px solid ${HAIRLINE};` +
      ` clip-path:${chamferClipPath('top-left', 26)};` +
      ` box-shadow:inset 0 0 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03); overflow:hidden;`;
    const characterHost = document.createElement('div');
    characterHost.style.cssText = 'width:100%; height:100%;';
    rim.appendChild(characterHost);
    this.characterPreview = new LoadoutCharacterPreview(characterHost);
    rightColumn.appendChild(rim);

    body.append(leftColumnWrap, middleColumn, rightColumn);

    this.overlay.append(header, body);
    root.appendChild(this.overlay);

    for (const card of cards) {
      const category = WEAPON_CATEGORIES[card.weapon.id];
      if (!category || category === 'special') continue;
      const equippableCategory: EquippableCategory = category;
      card.element.addEventListener('click', () => {
        this.loadout = { ...this.loadout, [equippableCategory]: card.weapon.id };
        saveLoadout(this.loadout);
        this.refreshAllSlots();
      });
    }

    this.refreshAllSlots();
    // Run once after layout settles, so the hint's initial visibility matches whether the list
    // actually overflows (a short catalog never shows it at all).
    requestAnimationFrame(updateScrollHint);
  }

  private buildSlotSocket(category: EquippableCategory): { socket: HTMLDivElement; value: HTMLDivElement } {
    const socket = document.createElement('div');
    socket.dataset.testid = `loadout-slot-${category}`;
    socket.style.cssText =
      `padding:12px 16px; background:${BG_RAISED}; border:1px solid ${HAIRLINE};` +
      ` clip-path:${chamferClipPath('top-right', 8)};`;

    const label = document.createElement('div');
    label.textContent = CATEGORY_LABELS[category].toUpperCase();
    label.style.cssText = `font-family:${DISPLAY_FONT}; font-size:0.65rem; font-weight:600; letter-spacing:0.18em; color:${STEEL}; margin-bottom:4px;`;

    const value = document.createElement('div');
    value.style.cssText = `font-family:${DISPLAY_FONT}; font-size:0.95rem; font-weight:600; color:${TEXT};`;

    socket.append(label, value);
    return { socket, value };
  }

  private refreshAllSlots(): void {
    for (const category of EQUIPPABLE_CATEGORIES) {
      const equippedId = this.loadout[category] ?? LOADOUT_SLOT_DEFAULTS[category];
      const name = WEAPON_DEFINITIONS[equippedId]?.name ?? equippedId;
      this.slotValueElements[category].textContent = name;
    }
    for (const card of this.cards) {
      const category = WEAPON_CATEGORIES[card.weapon.id];
      if (category === 'special') continue;
      const equippedId = this.loadout[category as EquippableCategory] ?? LOADOUT_SLOT_DEFAULTS[category as EquippableCategory];
      card.element.style.borderColor = equippedId === card.weapon.id ? ACCENT : HAIRLINE;
      card.element.style.boxShadow = equippedId === card.weapon.id ? `0 0 14px rgba(62,207,95,0.25)` : 'none';
    }
  }

  static async create(root: HTMLElement, onClose: () => void): Promise<LoadoutScreen> {
    const orderedWeaponIds = [
      ...CATEGORY_DISPLAY_ORDER.primary,
      ...CATEGORY_DISPLAY_ORDER.secondary,
      ...CATEGORY_DISPLAY_ORDER.melee,
      ...CATEGORY_DISPLAY_ORDER.special,
    ];
    const cards = await Promise.all(
      orderedWeaponIds.map(async (weaponId): Promise<WeaponCard> => {
        const weapon = WEAPON_DEFINITIONS[weaponId]!;
        const category = WEAPON_CATEGORIES[weaponId]!;
        const spec = WEAPON_MODEL_SPECS[weapon.id];
        let thumbnailDataUrl: string | null = null;
        try {
          if (spec) {
            const gltf = await loadGLTF(spec.path);
            thumbnailDataUrl = renderWeaponThumbnail(gltf.scene);
          } else {
            const { group } = createProceduralMeleeViewModel(weapon);
            thumbnailDataUrl = renderWeaponThumbnail(group);
          }
        } catch (error) {
          console.warn(`Failed to render loadout thumbnail for "${weapon.id}"`, error);
        }
        return { element: buildWeaponCard(weapon, thumbnailDataUrl, category), weapon };
      }),
    );

    return new LoadoutScreen(root, cards, onClose);
  }

  show(): void {
    this.overlay.style.display = 'flex';
    this.loadout = loadStoredLoadout();
    this.refreshAllSlots();
    this.characterPreview.start();
    attachScanSweep(this.overlay);
  }

  hide(): void {
    this.overlay.style.display = 'none';
    this.characterPreview.stop();
  }

  dispose(): void {
    this.characterPreview.dispose();
    this.overlay.remove();
  }
}
