/**
 * How a flash grenade's white-out sounds (docs/grenades.md): the game muffled through a low-pass on
 * the master bus and a high ringing tone over it, both scaled by the blind level (0 to 1), so they
 * hold and fade with the white-out.
 */

/** The low-pass cutoff with no flash: above hearing, so the filter is transparent. */
export const DEAF_CUTOFF_OPEN = 20000;
/** The cutoff at full blindness: everything sounds as if through a wall. */
export const DEAF_CUTOFF_CLOSED = 380;
export const RING_FREQUENCY = 3300;
/** The ring's gain at full blindness, before the master volume. */
export const RING_PEAK_GAIN = 0.07;

export interface FlashDeafness {
  readonly cutoff: number;
  readonly ringGain: number;
}

export function flashDeafness(level: number): FlashDeafness {
  const l = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  // Exponential in frequency, so the muffle closes evenly to the ear.
  const cutoff = DEAF_CUTOFF_OPEN * Math.pow(DEAF_CUTOFF_CLOSED / DEAF_CUTOFF_OPEN, Math.sqrt(l));
  return { cutoff, ringGain: RING_PEAK_GAIN * l };
}
