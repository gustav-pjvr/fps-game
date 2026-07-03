import { WEAPON_DEFINITIONS } from '../../weapons/definitions.ts';
import { createButton, createOverlay, createPanel, createPanelTitle } from './menuStyles.ts';

/** Lobby overlay: read-only showcase of all four currently available weapons. */
export class InventoryPanel {
  private readonly overlay: HTMLDivElement;

  constructor(root: HTMLElement, onClose: () => void) {
    this.overlay = createOverlay();

    const panel = createPanel();
    panel.style.width = '460px';
    panel.appendChild(createPanelTitle('INVENTORY'));

    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
    for (const weapon of Object.values(WEAPON_DEFINITIONS)) {
      const card = document.createElement('div');
      card.style.cssText =
        'padding:14px 16px; border-radius:8px; background:rgba(255,255,255,0.05);' +
        ' border:1px solid rgba(255,255,255,0.08);';

      const name = document.createElement('div');
      name.textContent = weapon.name;
      name.style.cssText = 'font-size:1rem; font-weight:700; margin-bottom:4px;';

      const desc = document.createElement('div');
      desc.textContent = weapon.description;
      desc.style.cssText = 'font-size:0.85rem; opacity:0.75; font-style:italic; margin-bottom:8px;';

      const stats = document.createElement('div');
      stats.textContent =
        `DMG ${weapon.damage} · MAG ${weapon.magazineSize} · RATE ${weapon.fireRate}/s` +
        (weapon.hasScope ? ' · SCOPE' : '');
      stats.style.cssText =
        'font-size:0.75rem; opacity:0.6; letter-spacing:0.03em; font-variant-numeric:tabular-nums;';

      card.append(name, desc, stats);
      list.appendChild(card);
    }
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
