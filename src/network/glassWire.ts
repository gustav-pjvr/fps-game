/** The glass numbers a network message is checked against (docs/glass.md), apart from the world code
 * in world/glass/glassPane.ts, which re-exports them: protocol.ts is shared with the Node relay and
 * may import nothing that pulls in the world (server/importGraph.test.ts). */

/** A pane takes this many points of damage before it breaks. */
export const PANE_STRENGTH = 6;
/** At most this many entries of a received list are read. */
export const GLASS_SYNC_MAX_ENTRIES = 2048;
/** No real pane is larger than this from its centre, in metres. */
export const MAX_PANE_REACH = 4;

/** Whether a received glassHit's numbers are sane (the pane itself is checked against the world). */
export function isValidGlassHit(u: unknown, v: unknown, power: unknown, side: unknown): boolean {
  return typeof u === 'number' && Number.isFinite(u) && Math.abs(u) <= MAX_PANE_REACH
    && typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_PANE_REACH
    && Number.isInteger(power) && (power as number) >= 1 && (power as number) <= PANE_STRENGTH
    && (side === 1 || side === -1);
}
