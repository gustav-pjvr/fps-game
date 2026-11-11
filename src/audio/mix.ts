/**
 * The mix (docs/sound.md): which buses there are, how loud each sits, which of them a near blast
 * pulls down, and the limiter that keeps a firefight from clipping. Pure numbers; SoundEngine wires
 * them.
 */

/** `blast` is its own bus so an explosion is not ducked by itself. */
export type SoundBus = 'weapons' | 'movement' | 'world' | 'voices' | 'blast' | 'ui';

/** Each bus's level before the effects volume, set from the offline measurements
 * (scripts/soundRender.mjs) so that at full volume the player's own pistol peaks near 0.3, a sniper
 * and a near frag reach the limiter, a footstep sits near 0.05 and the interface near 0.1 to 0.2.
 * Weapons lead, the world sits under them, and the interface is clear without being loud. */
export const BUS_LEVELS: Readonly<Record<SoundBus, number>> = {
  weapons: 1.6,
  movement: 2.4,
  world: 1.6,
  voices: 0.75,
  blast: 1.3,
  ui: 1.3,
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
 *
 * `makeup` is on top of the browser's own: a DynamicsCompressorNode already raises its output by
 * an amount it derives from its settings. That amount is not what the textbook formula gives, so
 * night mode's makeup was set by measurement (scripts/soundRender.mjs): a footstep ten metres away
 * comes up about 6 dB while a firefight comes down. The soft clipper after it (softClip) holds
 * whatever the compressor's attack lets through.
 */
export function dynamicsFor(range: DynamicRange): Dynamics {
  return range === 'night'
    ? { threshold: -36, knee: 12, ratio: 8, attack: 0.001, release: 0.2, makeup: 1.4 }
    : { threshold: -5, knee: 4, ratio: 20, attack: 0.002, release: 0.12, makeup: 1 };
}

/** Below this the soft clipper leaves a sample alone. */
export const CLIP_KNEE = 0.7;

/** The last stage before the master volume: straight up to CLIP_KNEE, then bending so that no
 * input, however large, leaves above 1. A compressor's attack lets a transient through; this is
 * what makes "never clips" true rather than likely. */
export function softClip(sample: number): number {
  const size = Math.abs(sample);
  if (size <= CLIP_KNEE) return sample;
  return Math.sign(sample) * (CLIP_KNEE + (1 - CLIP_KNEE) * Math.tanh((size - CLIP_KNEE) / (1 - CLIP_KNEE)));
}
