/** Shared stylised-dusk menu components, backed by the UI theme tokens. */
import { ACCENT, ACCENT_INK, HAIRLINE, INK, INK_DIM, SURFACE, SURFACE_RAISED, VOID, SANS_FONT, LABEL_CSS, THREAT } from '../theme.ts';

export { ACCENT, HAIRLINE };
export { VOID as BG_VOID, SURFACE as BG_PANEL, SURFACE_RAISED as BG_RAISED, SURFACE_RAISED as ACCENT_DIM, INK_DIM as STEEL, INK as TEXT, SANS_FONT as DISPLAY_FONT, SANS_FONT as BODY_FONT } from '../theme.ts';

export const MOTION_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

let motionKeyframesInjected = false;
export function ensureMotionKeyframesInjected(): void {
  if (motionKeyframesInjected) return;
  motionKeyframesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes panelEnter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes titleReveal { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ruleGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    @keyframes rowSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulseGlow { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
    @keyframes hitFlash { 0% { background: color-mix(in srgb, ${THREAT} 35%, transparent); } 100% { background: transparent; } }

    .menu-surface button, .menu-surface input, .menu-surface select { font-family: ${SANS_FONT}; }
    .menu-surface input { accent-color: ${ACCENT}; }
    .menu-surface input::placeholder { color: ${INK_DIM}; }
    .menu-surface select option { background: ${VOID}; color: ${INK}; }
    .menu-button:hover:not(:disabled) { transform: translateY(-2px); }
    .menu-button-secondary:hover:not(:disabled), .menu-button-secondary:focus-visible,
    .menu-surface button:focus-visible { border-color: ${ACCENT} !important; }
    /* Empty alternative text keeps the decorative arrow out of accessible button names. */
    .menu-button-primary::after {
      content: '→' / '';
      float: right;
      margin-left: 18px;
      font-size: 18px;
      font-weight: 300;
      line-height: 1;
      letter-spacing: 0;
    }
    .menu-panel-title::after {
      content: '';
      display: block;
      width: 32px;
      height: 1px;
      background: ${ACCENT};
      margin-top: 10px;
    }
    button:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid ${ACCENT};
      outline-offset: 3px;
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        scroll-behavior: auto !important;
      }
    }
  `;
  document.head.appendChild(style);
}

/** Compatibility name: panels now enter with a short fade and rise. */
export function attachScanSweep(container: HTMLElement): void {
  ensureMotionKeyframesInjected();
  container.style.animation = 'none';
  void container.offsetWidth;
  container.style.animation = `panelEnter 180ms ${MOTION_EASE} both`;
}

/** Compatibility export for callers outside the menu reskin. */
export function chamferClipPath(_corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' = 'top-right', _size = 14): string {
  return 'none';
}

export function createButton(label: string, variant: 'primary' | 'secondary' = 'secondary'): HTMLButtonElement {
  ensureMotionKeyframesInjected();
  const button = document.createElement('button');
  button.textContent = label;
  button.className = `menu-button menu-button-${variant}`;
  button.style.cssText =
    `font-family:${SANS_FONT}; font-size:11px; font-weight:700; letter-spacing:0.16em; text-transform:uppercase;` +
    ` padding:16px 22px; cursor:pointer; border-radius:2px; transition:transform 180ms ${MOTION_EASE}, border-color 180ms ${MOTION_EASE};` +
    ` border:1px solid ${variant === 'primary' ? ACCENT : HAIRLINE};` +
    (variant === 'primary'
      ? `background:${ACCENT}; color:${ACCENT_INK}; text-align:left;`
      : `background:${SURFACE_RAISED}; color:${INK};`);
  return button;
}

export function createTextInput(placeholder: string, maxLength: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.maxLength = maxLength;
  input.style.cssText =
    `width:100%; box-sizing:border-box; padding:12px; font-family:${SANS_FONT}; font-size:1rem; font-weight:400; color:${INK};` +
    ` background:${SURFACE_RAISED}; border:1px solid ${HAIRLINE}; border-radius:2px;`;
  return input;
}

export function createPanel(): HTMLDivElement {
  ensureMotionKeyframesInjected();
  const panel = document.createElement('div');
  panel.className = 'menu-surface';
  panel.style.cssText =
    `background:${SURFACE}; backdrop-filter:blur(10px); border:1px solid ${HAIRLINE}; border-radius:2px;` +
    ` padding:30px 34px; color:${INK}; position:relative;` +
    ` font-family:${SANS_FONT}; max-width:94vw; max-height:80vh; overflow-y:auto; box-sizing:border-box;`;
  return panel;
}

export function createOverlay(): HTMLDivElement {
  ensureMotionKeyframesInjected();
  const overlay = document.createElement('div');
  overlay.className = 'menu-surface';
  overlay.style.cssText =
    'position:absolute; inset:0; display:none; align-items:center; justify-content:center;' +
    ` background:${SURFACE}; color:${INK}; font-family:${SANS_FONT}; z-index:30; pointer-events:auto;`;
  return overlay;
}

/** A click on the dimmed backdrop around a popup (the overlay itself, not anything inside its
 * panel) calls `onClose`, the same as its Close or Cancel button. Both the press and the release
 * must land on the backdrop, so a drag that starts inside the panel (a slider, a text selection)
 * and ends outside it never closes anything. */
export function closeOnBackdropClick(overlay: HTMLElement, onClose: () => void): void {
  // A press on the backdrop released inside the panel still fires `click` on the overlay (their
  // common ancestor), so the release target is checked on its own.
  let pressedOnBackdrop = false;
  let releasedOnBackdrop = false;
  overlay.addEventListener('pointerdown', (event) => {
    pressedOnBackdrop = event.target === overlay;
  });
  overlay.addEventListener('pointerup', (event) => {
    releasedOnBackdrop = event.target === overlay;
  });
  overlay.addEventListener('click', (event) => {
    const outside = pressedOnBackdrop && releasedOnBackdrop && event.target === overlay;
    pressedOnBackdrop = false;
    releasedOnBackdrop = false;
    if (outside) onClose();
  });
}

export function createPanelTitle(text: string): HTMLDivElement {
  ensureMotionKeyframesInjected();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:22px;';
  const title = document.createElement('h2');
  title.textContent = text;
  title.className = 'menu-panel-title';
  title.style.cssText = `margin:0; font-family:${SANS_FONT}; font-size:1.9rem; font-weight:300; letter-spacing:-0.01em; color:${INK};`;
  wrap.appendChild(title);
  return wrap;
}

export function createEyebrow(text: string): HTMLDivElement {
  const eyebrow = document.createElement('div');
  eyebrow.textContent = text;
  eyebrow.style.cssText = LABEL_CSS;
  return eyebrow;
}

/** Compatibility placeholder: the title rule replaces decorative corner brackets. */
export function createCornerBracket(_corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', _delayMs = 0): HTMLDivElement {
  const bracket = document.createElement('div');
  bracket.style.display = 'none';
  return bracket;
}
