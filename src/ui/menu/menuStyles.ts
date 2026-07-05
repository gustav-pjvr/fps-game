/**
 * Shared visual language for every lobby/menu surface (WORLD_PLAN.md follow-up: lobby redesign).
 * Grounded in shipped tactical-shooter lobbies (Valorant, Apex Legends, CS2) rather than a generic
 * web-app overlay: near-black surfaces, a single sharp accent color, chamfered (cut-corner) panels
 * instead of rounded rectangles, and a condensed display face for titles/actions against a plain
 * body face for descriptions/data - see the signature `chamferClipPath` helper below, applied
 * consistently everywhere so it reads as one deliberate system rather than default browser chrome.
 */

export const ACCENT = '#3ecf5f';
const ACCENT_DIM = 'rgba(62, 207, 95, 0.16)';
const BG_VOID = '#0a0c0f';
const BG_PANEL = 'rgba(15, 18, 22, 0.92)';
const BG_RAISED = 'rgba(255, 255, 255, 0.05)';
const STEEL = '#7b8794';
const HAIRLINE = 'rgba(255, 255, 255, 0.09)';
const TEXT = '#eef1f3';

export const DISPLAY_FONT = "'Chakra Petch', system-ui, sans-serif";
export const BODY_FONT = "'Inter', system-ui, sans-serif";

const CHAMFER = 14;

/** The one signature shape of this design: a single cut corner rather than a rounded or square
 * one, echoing the angular viewfinder/HUD panels of tactical-shooter lobbies. `corner` picks which
 * corner is cut so panels can alternate rather than all leaning the same direction. */
export function chamferClipPath(corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' = 'top-right', size = CHAMFER): string {
  const c = `${size}px`;
  switch (corner) {
    case 'top-left':
      return `polygon(${c} 0, 100% 0, 100% 100%, 0 100%, 0 ${c})`;
    case 'top-right':
      return `polygon(0 0, calc(100% - ${c}) 0, 100% ${c}, 100% 100%, 0 100%)`;
    case 'bottom-left':
      return `polygon(0 0, 100% 0, 100% 100%, ${c} 100%, 0 calc(100% - ${c}))`;
    case 'bottom-right':
      return `polygon(0 0, 100% 0, 100% calc(100% - ${c}), calc(100% - ${c}) 100%, 0 100%)`;
  }
}

export function createButton(label: string, variant: 'primary' | 'secondary' = 'secondary'): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  button.style.cssText =
    `font-family:${DISPLAY_FONT}; font-size:0.95rem; font-weight:600; letter-spacing:0.08em; text-transform:uppercase;` +
    ' padding:13px 30px; cursor:pointer; transition:transform 0.12s ease-out, background-color 0.12s ease-out;' +
    ` clip-path:${chamferClipPath('top-right', 10)}; border:1px solid ${variant === 'primary' ? ACCENT : HAIRLINE};` +
    (variant === 'primary'
      ? `background:${ACCENT}; color:#08130a;`
      : `background:${BG_RAISED}; color:${TEXT};`);
  button.addEventListener('mouseenter', () => {
    button.style.transform = 'translateX(2px)';
    if (variant === 'secondary') button.style.borderColor = ACCENT;
  });
  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateX(0)';
    if (variant === 'secondary') button.style.borderColor = HAIRLINE;
  });
  return button;
}

export function createPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.style.cssText =
    `background:${BG_PANEL}; border:1px solid ${HAIRLINE}; clip-path:${chamferClipPath('top-left', 22)};` +
    ` padding:30px 34px; box-shadow:0 24px 70px rgba(0,0,0,0.55); color:${TEXT};` +
    ` font-family:${BODY_FONT}; max-height:80vh; overflow-y:auto; box-sizing:border-box;`;
  return panel;
}

export function createOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:absolute; inset:0; display:none; align-items:center; justify-content:center;' +
    ' background:rgba(4,5,6,0.72); z-index:30; pointer-events:auto;';
  return overlay;
}

export function createPanelTitle(text: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:22px;';

  const title = document.createElement('div');
  title.textContent = text;
  title.style.cssText = `font-family:${DISPLAY_FONT}; font-size:1.4rem; font-weight:700; letter-spacing:0.12em; color:${TEXT};`;

  const rule = document.createElement('div');
  rule.style.cssText = `width:44px; height:3px; background:${ACCENT}; margin-top:10px;`;

  wrap.append(title, rule);
  return wrap;
}

/** Small uppercase label used above a title or beside a data readout - a structural device that
 * marks "this text is a category/status," not decoration. */
export function createEyebrow(text: string): HTMLDivElement {
  const eyebrow = document.createElement('div');
  eyebrow.textContent = text;
  eyebrow.style.cssText =
    `font-family:${DISPLAY_FONT}; font-size:0.72rem; font-weight:600; letter-spacing:0.24em;` +
    ` text-transform:uppercase; color:${STEEL};`;
  return eyebrow;
}

/** A thin L-shaped bracket mark, used in the screen corners to frame the lobby like a viewfinder -
 * cheap, purely decorative, but the kind of small tactical-HUD touch that reads as intentional. */
export function createCornerBracket(corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'): HTMLDivElement {
  const size = 32;
  const thickness = 2;
  const bracketColor = 'rgba(255, 255, 255, 0.22)';
  const bracket = document.createElement('div');
  const vertical = corner.includes('top') ? 'top' : 'bottom';
  const horizontal = corner.includes('left') ? 'left' : 'right';
  const borderVertical = `border-${vertical}: ${thickness}px solid ${bracketColor};`;
  const borderHorizontal = `border-${horizontal}: ${thickness}px solid ${bracketColor};`;
  bracket.style.cssText =
    `position:absolute; ${vertical}:28px; ${horizontal}:28px; width:${size}px; height:${size}px;` +
    ` ${borderVertical} ${borderHorizontal}`;
  return bracket;
}

export { BG_VOID, BG_PANEL, BG_RAISED, STEEL, HAIRLINE, TEXT, ACCENT_DIM };
