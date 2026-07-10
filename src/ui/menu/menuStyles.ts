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
/**
 * Motion language (UI polish pass, per user request: "flashy design" while keeping the tactical
 * identity). Signature move: a thin accent-green scan-line sweeps down every panel the instant
 * it opens, like a HUD authenticating before it lets you in - reused consistently everywhere a
 * panel appears (see `attachScanSweep`) rather than inventing a different entrance per screen, so
 * it reads as one deliberate system. Everything else stays quiet by comparison (per "spend your
 * boldness in one place") - a couple of targeted moments (match-end title reveal, podium stagger,
 * minimap pulse, hit-flash) get their own small keyframes below, each used exactly once, nowhere
 * else. Inline `style.cssText` can't declare `@keyframes` itself, hence the one-time `<style>`
 * injection here rather than adding a build-time CSS file to a codebase that's never had one.
 */
let motionKeyframesInjected = false;
export function ensureMotionKeyframesInjected(): void {
  if (motionKeyframesInjected) return;
  motionKeyframesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes scanSweep { from { top: -4%; opacity: 1; } 70% { opacity: 0.85; } to { top: 104%; opacity: 0; } }
    @keyframes bracketDraw { from { opacity: 0; transform: scale(0.55); } to { opacity: 1; transform: scale(1); } }
    @keyframes ruleGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    @keyframes titleReveal { from { opacity: 0; transform: scale(0.92); letter-spacing: 0.3em; } to { opacity: 1; transform: scale(1); letter-spacing: 0.12em; } }
    @keyframes rowSlideIn { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes pulseGlow { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
    @keyframes hitFlash { 0% { background: rgba(224, 72, 60, 0.35); } 100% { background: transparent; } }

    /* Accessibility: a player with vestibular motion sensitivity (prefers-reduced-motion) still
     * needs every element to land in its *final* state - just without the sweep/reveal/slide en
     * route there. Collapsing each animation to a near-zero duration (rather than 'animation: none',
     * which would freeze elements at their 0% keyframe - e.g. scanSweep's sweep line stuck fully
     * visible forever, or titleReveal's text stuck at scale(0.92)) keeps every element's genuinely
     * final, intended appearance while skipping the motion itself. Global universal selector rather
     * than a per-component opt-in, since every animation/transition in the app (including the
     * JS-triggered ones like multiplayerHud's hitFlash reflow-restart) is declared with plain CSS
     * animation/transition properties and none of them need to survive at full duration for
     * reduced-motion users - a hitFlash that resolves in ~0ms instead of 0.35s still communicates
     * "you were hit". */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        scroll-behavior: auto !important;
      }
    }

    /* Keyboard focus-visible styling: an accent-colored outline on whatever's keyboard-focused
     * (buttons, inputs, selects) so tabbing through a panel is actually legible - browsers' default
     * focus ring is a thin blue rectangle that reads as broken against this near-black theme.
     * :focus-visible (not :focus) so a mouse click doesn't also draw the ring - only keyboard/
     * programmatic focus does, matching how sighted mouse users already expect these controls to
     * look. */
    button:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid ${ACCENT};
      outline-offset: 2px;
    }
  `;
  document.head.appendChild(style);
}

export const MOTION_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** The signature entrance move (see the class comment above) - call once per `show()`, not just
 * at construction, so it replays every time a panel opens. `container` needs `position:relative`
 * (already true of every panel `createPanel()` returns) for this absolutely-positioned sweep line
 * to anchor correctly. Self-removes once the animation finishes rather than lingering as a dead
 * DOM node. */
export function attachScanSweep(container: HTMLElement): void {
  ensureMotionKeyframesInjected();
  const sweep = document.createElement('div');
  sweep.style.cssText =
    `position:absolute; left:0; width:100%; height:2px; background:${ACCENT};` +
    ` box-shadow:0 0 14px 2px ${ACCENT}; pointer-events:none; z-index:5;` +
    ` animation:scanSweep 0.5s ${MOTION_EASE} both;`;
  container.appendChild(sweep);
  sweep.addEventListener('animationend', () => sweep.remove());
}

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

export function createTextInput(placeholder: string, maxLength: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.maxLength = maxLength;
  input.style.cssText =
    `width:100%; box-sizing:border-box; padding:12px; font-size:1rem; font-weight:600; color:${TEXT};` +
    // Chamfered, not rounded (see the class comment above) - matches every other input-shaped
    // surface in this system (createButton, LoadoutScreen's slot sockets, CreateRoomScreen's
    // manually-styled selects) instead of standing out as the one rounded-rectangle field.
    ` background:${BG_RAISED}; border:1px solid ${HAIRLINE}; clip-path:${chamferClipPath('top-right', 8)};`;
  return input;
}

export function createPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.style.cssText =
    `background:${BG_PANEL}; border:1px solid ${HAIRLINE}; clip-path:${chamferClipPath('top-left', 22)};` +
    ` padding:30px 34px; box-shadow:0 24px 70px rgba(0,0,0,0.55); color:${TEXT}; position:relative;` +
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
  ensureMotionKeyframesInjected();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:22px;';

  const title = document.createElement('div');
  title.textContent = text;
  title.style.cssText = `font-family:${DISPLAY_FONT}; font-size:1.4rem; font-weight:700; letter-spacing:0.12em; color:${TEXT};`;

  const rule = document.createElement('div');
  // Grows in rather than appearing at full width instantly - a small, quiet echo of the
  // scan-sweep entrance rather than a second competing move.
  rule.style.cssText =
    `width:44px; height:3px; background:${ACCENT}; margin-top:10px; transform-origin:left;` +
    ` animation:ruleGrow 0.4s ${MOTION_EASE} 0.15s both;`;

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
/** `delayMs` staggers a set of brackets so they read as a HUD calibrating corner by corner rather
 * than all four popping in at once - see MainMenu's own call sites. */
export function createCornerBracket(corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', delayMs = 0): HTMLDivElement {
  ensureMotionKeyframesInjected();
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
    ` ${borderVertical} ${borderHorizontal} animation:bracketDraw 0.35s ${MOTION_EASE} ${delayMs}ms both;`;
  return bracket;
}

export { BG_VOID, BG_PANEL, BG_RAISED, STEEL, HAIRLINE, TEXT, ACCENT_DIM };
