import { loadGLTF } from '../../core/AssetLoader.ts';
import { WEAPON_DEFINITIONS, type WeaponDefinition } from '../../weapons/definitions.ts';
import { WEAPON_MODEL_SPECS, createProceduralMeleeViewModel } from '../../weapons/viewModel.ts';
import { createButton, createEyebrow, chamferClipPath, attachScanSweep, ACCENT, TEXT, STEEL, HAIRLINE, BG_RAISED, BG_VOID, DISPLAY_FONT, BODY_FONT } from './menuStyles.ts';
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

interface WeaponCard {
  readonly element: HTMLDivElement;
  readonly weapon: WeaponDefinition;
}

function buildWeaponCard(weapon: WeaponDefinition, thumbnailDataUrl: string | null, category: WeaponCategory): HTMLDivElement {
  const isSpecial = category === 'special';
  const card = document.createElement('div');
  card.dataset.weaponId = weapon.id;
  card.draggable = !isSpecial;
  card.style.cssText =
    'display:flex; flex-direction:column; gap:10px; padding:14px 16px;' +
    ` background:${BG_RAISED}; border:1px solid ${isSpecial ? REWARD_GOLD : HAIRLINE};` +
    ` clip-path:${chamferClipPath('top-right', 10)}; transition:border-color 0.15s ease-out, transform 0.12s ease-out;` +
    (isSpecial ? ' opacity:0.75;' : ' cursor:grab;') +
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
 * "Inventory" showcase): the player's character rotates inside a slotted rim on the right
 * (Primary/Secondary/Melee - see LoadoutCharacterPreview), guns grouped by category on the left,
 * dragged into the matching slot to equip. The category label is the whole point - it's what stops
 * a player stacking multiple primaries, since a slot only ever accepts a weapon whose own
 * WEAPON_CATEGORIES entry matches it. Persists immediately on every drop (see core/loadout.ts),
 * same "survives a reload" mechanism the saved username already uses. */
export class LoadoutScreen {
  private readonly overlay: HTMLDivElement;
  private readonly characterPreview: LoadoutCharacterPreview;
  private readonly slotValueElements: Record<EquippableCategory, HTMLDivElement>;
  private readonly slotSocketElements: Record<EquippableCategory, HTMLDivElement>;
  private readonly cards: WeaponCard[];
  private loadout: PlayerLoadout;
  private draggedWeaponId: string | null = null;

  private constructor(root: HTMLElement, cards: WeaponCard[], onClose: () => void) {
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
    body.style.cssText = 'flex:1; min-height:0; display:flex; gap:40px;';

    const leftColumn = document.createElement('div');
    leftColumn.style.cssText = 'flex:1.1; min-width:0; overflow-y:auto; display:flex; flex-direction:column; gap:22px; padding-right:8px;';
    for (const category of ['primary', 'secondary', 'melee', 'special'] as const) {
      const section = document.createElement('div');
      section.style.cssText = 'display:flex; flex-direction:column; gap:10px;';
      section.appendChild(createEyebrow(CATEGORY_LABELS[category]));
      const categoryCards = cards.filter((c) => WEAPON_CATEGORIES[c.weapon.id] === category);
      for (const c of categoryCards) section.appendChild(c.element);
      leftColumn.appendChild(section);
    }

    const rightColumn = document.createElement('div');
    rightColumn.style.cssText = 'flex:1; min-width:0; display:flex; align-items:center; justify-content:center; position:relative;';

    const rim = document.createElement('div');
    rim.style.cssText =
      `position:relative; width:min(100%, 420px); aspect-ratio:1; border-radius:50%;` +
      ` border:2px solid ${HAIRLINE}; box-shadow:inset 0 0 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03);` +
      ` display:flex; align-items:center; justify-content:center; overflow:hidden;`;
    const characterHost = document.createElement('div');
    characterHost.style.cssText = 'width:100%; height:100%;';
    rim.appendChild(characterHost);
    this.characterPreview = new LoadoutCharacterPreview(characterHost);

    const sockets = document.createElement('div');
    sockets.style.cssText = 'position:absolute; top:50%; right:-24px; transform:translateY(-50%); display:flex; flex-direction:column; gap:14px;';
    this.slotValueElements = {} as Record<EquippableCategory, HTMLDivElement>;
    this.slotSocketElements = {} as Record<EquippableCategory, HTMLDivElement>;
    for (const category of EQUIPPABLE_CATEGORIES) {
      const { socket, value } = this.buildSlotSocket(category);
      this.slotSocketElements[category] = socket;
      this.slotValueElements[category] = value;
      sockets.appendChild(socket);
    }

    rightColumn.append(rim, sockets);
    body.append(leftColumn, rightColumn);

    this.overlay.append(header, body);
    root.appendChild(this.overlay);

    for (const card of cards) {
      if (!card.element.draggable) continue;
      card.element.addEventListener('dragstart', (e) => {
        this.draggedWeaponId = card.weapon.id;
        e.dataTransfer?.setData('text/plain', card.weapon.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        card.element.style.opacity = '0.5';
      });
      card.element.addEventListener('dragend', () => {
        this.draggedWeaponId = null;
        card.element.style.opacity = '1';
      });
    }

    this.refreshAllSlots();
  }

  private buildSlotSocket(category: EquippableCategory): { socket: HTMLDivElement; value: HTMLDivElement } {
    const socket = document.createElement('div');
    socket.dataset.testid = `loadout-slot-${category}`;
    socket.style.cssText =
      `min-width:170px; padding:12px 16px; background:${BG_RAISED}; border:1px solid ${HAIRLINE};` +
      ` clip-path:${chamferClipPath('top-right', 8)}; transition:border-color 0.15s ease-out;`;

    const label = document.createElement('div');
    label.textContent = CATEGORY_LABELS[category].toUpperCase();
    label.style.cssText = `font-family:${DISPLAY_FONT}; font-size:0.65rem; font-weight:600; letter-spacing:0.18em; color:${STEEL}; margin-bottom:4px;`;

    const value = document.createElement('div');
    value.style.cssText = `font-family:${DISPLAY_FONT}; font-size:0.95rem; font-weight:600; color:${TEXT};`;

    socket.append(label, value);

    socket.addEventListener('dragover', (e) => {
      if (this.draggedWeaponId && WEAPON_CATEGORIES[this.draggedWeaponId] === category) {
        e.preventDefault();
        socket.style.borderColor = ACCENT;
      }
    });
    socket.addEventListener('dragleave', () => {
      socket.style.borderColor = HAIRLINE;
    });
    socket.addEventListener('drop', (e) => {
      e.preventDefault();
      socket.style.borderColor = HAIRLINE;
      const weaponId = this.draggedWeaponId;
      if (!weaponId || WEAPON_CATEGORIES[weaponId] !== category) return; // mismatched category - rejected, no state change
      this.loadout = { ...this.loadout, [category]: weaponId };
      saveLoadout(this.loadout);
      this.refreshAllSlots();
    });

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
