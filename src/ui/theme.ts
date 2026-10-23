/** Design tokens for every HUD and menu surface (docs/visual-overhaul-ui.md, "Tokens"). The
 * stylised-dusk palette from render/look.ts carried into the interface: deep teal surfaces instead
 * of black, one mint accent, amber for objectives and warnings, red only for threat. */

export const INK = '#e9efe9';
export const INK_DIM = '#93a8a0';
export const INK_FAINT = 'rgba(201, 226, 216, 0.38)';
export const HAIRLINE = 'rgba(202, 231, 219, 0.2)';
export const SURFACE = 'rgba(7, 24, 27, 0.78)';
export const SURFACE_RAISED = 'rgba(16, 48, 52, 0.62)';
export const VOID = '#071518';
export const ACCENT = '#6ff0dc';
export const ACCENT_INK = '#0d2a28';
export const AMBER = '#e8a64a';
export const THREAT = '#ff5a3c';
export const TEXT_SHADOW = '0 2px 8px rgba(4, 23, 22, 0.55)';

/** Everything readable. Big numerals use weight 300. */
export const SANS_FONT = "'Manrope', system-ui, sans-serif";
/** Numbers that update and instrument labels: bearings, ranges, ammo, timers, room codes. */
export const MONO_FONT = "'Martian Mono', ui-monospace, monospace";

/** The small uppercase label style used across the HUD and menus. */
export const LABEL_CSS = `font-family:${SANS_FONT}; font-size:10.5px; font-weight:600; letter-spacing:0.2em; text-transform:uppercase; color:${INK_DIM};`;
