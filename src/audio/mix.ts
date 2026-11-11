/**
 * The mix (docs/sound.md): which buses there are, how loud each sits, which of them a near blast
 * pulls down, and the limiter that keeps a firefight from clipping. Pure numbers; SoundEngine wires
 * them.
 */

/** `blast` is its own bus so an explosion is not ducked by itself. */
export type SoundBus = 'weapons' | 'movement' | 'world' | 'voices' | 'blast' | 'ui';

/** Each bus's level before the effects volume. Weapons lead, the world sits under them, and the
 * interface is clear without being loud. */
export const BUS_LEVELS: Readonly<Record<SoundBus, number>> = {
  weapons: 0.62,
  movement: 0.9,
  world: 0.8,
  voices: 0.8,
  blast: 0.85,
  ui: 0.8,
};

/** A near explosion pulls these down for a moment. The interface (hit ticks, objective cues) and the
 * blast itself stay. */
export const DUCKED_BUSES: ReadonlySet<SoundBus> = new Set<SoundBus>(['weapons', 'movement', 'world', 'voices']);

/** A positioned sound quieter than this is not played at all: no nodes are made for it. */
export const SILENT_BELOW = 0.004;

/** Positioned voices alive at once. Past it only loud sounds get a voice. */
export const MAX_SPATIAL_VOICES = 28;

export type DynamicRange = 'full' | 'night';

export interface Dynamics {
  /** dB. */
  readonly threshold: number;
  /** dB. */
  readonly knee: number;
  readonly ratio: number;
  /** Seconds. */
  readonly attack: number;
  /** Seconds. */
  readonly release: number;
  /** Gain after the compressor. */
  readonly makeup: number;
}

/**
 * The master dynamics. Full range is a limiter: nothing happens until several loud sounds stack
 * up, then the peaks are held under clipping. Night mode is a compressor: quiet sounds (footsteps,
 * a far shot) come up and loud ones come down, for playing at low volume.
 */
export function dynamicsFor(range: DynamicRange): Dynamics {
  return range === 'night'
    ? { threshold: -34, knee: 14, ratio: 5, attack: 0.004, release: 0.22, makeup: 2.6 }
    : { threshold: -5, knee: 4, ratio: 20, attack: 0.002, release: 0.12, makeup: 1 };
}
