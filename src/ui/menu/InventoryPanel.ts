import { loadGLTF } from '../../core/AssetLoader.ts';
import { WEAPON_DEFINITIONS, type WeaponDefinition } from '../../weapons/definitions.ts';
import { WEAPON_MODEL_SPECS, createProceduralMeleeViewModel } from '../../weapons/viewModel.ts';
import { createButton, createOverlay, createPanel, createPanelTitle } from './menuStyles.ts';
import { createStatBadge } from './statIcons.ts';
import { renderWeaponThumbnail } from './weaponThumbnail.ts';

function createWeaponCard(weapon: WeaponDefinition, thumbnailDataUrl: string | null): HTMLDivElement {
  const card = document.createElement('div');
  card.style.cssText =
    'display:flex; gap:14px; padding:14px 16px; border-radius:8px; background:rgba(255,255,255,0.05);' +
    ' border:1px solid rgba(255,255,255,0.08);';

  const thumbnail = document.createElement('div');
  thumbnail.style.cssText =
    'flex-shrink:0; width:112px; height:112px; border-radius:6px; background:rgba(0,0,0,0.25);' +
    ' display:flex; align-items:center; justify-content:center; overflow:hidden;';
  if (thumbnailDataUrl) {
    const img = document.createElement('img');
    img.src = thumbnailDataUrl;
    img.alt = `${weapon.name} preview`;
    img.style.cssText = 'width:100%; height:100%; object-fit:contain;';
    thumbnail.appendChild(img);
  }

  const info = document.createElement('div');
  info.style.cssText = 'flex:1; min-width:0;';

  const name = document.createElement('div');
  name.textContent = weapon.name;
  name.style.cssText = 'font-size:1rem; font-weight:700; margin-bottom:4px;';

  const desc = document.createElement('div');
  desc.textContent = weapon.description;
  desc.style.cssText = 'font-size:0.85rem; opacity:0.75; font-style:italic; margin-bottom:8px;';

  const stats = document.createElement('div');
  stats.style.cssText =
    'display:flex; flex-wrap:wrap; gap:10px 14px; font-size:0.75rem; opacity:0.75;' +
    ' letter-spacing:0.02em; font-variant-numeric:tabular-nums;';
  stats.append(
    createStatBadge('damage', `${weapon.damage}`),
    createStatBadge('fireRate', `${weapon.fireRate}/s`),
    createStatBadge('magazine', `${weapon.magazineSize}`),
    createStatBadge('reload', `${weapon.reloadTime}s`),
  );
  if (weapon.hasScope) stats.appendChild(createStatBadge('scope', 'Scope'));

  info.append(name, desc, stats);
  card.append(thumbnail, info);
  return card;
}

/** Lobby overlay: read-only showcase of all four currently available weapons, each with a static
 * 3D preview render and icon-labeled stats. */
export class InventoryPanel {
  private readonly overlay: HTMLDivElement;

  private constructor(root: HTMLElement, cards: HTMLDivElement[], onClose: () => void) {
    this.overlay = createOverlay();

    const panel = createPanel();
    panel.style.width = '580px';
    panel.appendChild(createPanelTitle('INVENTORY'));

    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
    for (const card of cards) list.appendChild(card);
    panel.appendChild(list);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:flex-end; margin-top:20px;';
    const closeButton = createButton('Close', 'primary');
    closeButton.addEventListener('click', onClose);
    footer.appendChild(closeButton);
    panel.appendChild(footer);

    this.overlay.appendChild(panel);
    root.appendChild(this.overlay);
  }

  static async create(root: HTMLElement, onClose: () => void): Promise<InventoryPanel> {
    const cards = await Promise.all(
      Object.values(WEAPON_DEFINITIONS).map(async (weapon) => {
        const spec = WEAPON_MODEL_SPECS[weapon.id];
        let thumbnailDataUrl: string | null = null;
        try {
          if (spec) {
            const gltf = await loadGLTF(spec.path);
            thumbnailDataUrl = renderWeaponThumbnail(gltf.scene);
          } else {
            // No sourced .glb for this weapon (the knife - see viewModel.ts's
            // createProceduralMeleeViewModel) - render its actual procedural mesh instead of
            // leaving the card's thumbnail slot blank.
            const { group } = createProceduralMeleeViewModel(weapon);
            thumbnailDataUrl = renderWeaponThumbnail(group);
          }
        } catch (error) {
          // A missing/corrupt model shouldn't block the whole inventory - falls back to no preview.
          console.warn(`Failed to render inventory thumbnail for "${weapon.id}"`, error);
        }
        return createWeaponCard(weapon, thumbnailDataUrl);
      }),
    );

    return new InventoryPanel(root, cards, onClose);
  }

  show(): void {
    this.overlay.style.display = 'flex';
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  dispose(): void {
    this.overlay.remove();
  }
}
