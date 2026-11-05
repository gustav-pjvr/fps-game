/**
 * The pure rules behind the phase 6 sound layers (docs/visual-overhaul.md, "Sound depth"):
 * the valley's reverb impulse, the combat music mix the pacing director drives, and the low-health
 * heartbeat. SoundEngine turns these numbers into Web Audio nodes; nothing here touches audio.
 */

/** The director's phases (entities/enemies/director/pacingDirector.ts). */
export type PacingPhase = 'buildUp' | 'peak' | 'fade' | 'relax';

export interface MusicMix {
  /** A low detuned pad: the bed under every director match, a little louder as tension builds. */
  readonly pad: number;
  /** Filtered ticks on the beat: present while the fight is building or peaking. */
  readonly pulse: number;
  /** A bass ostinato: the peak only. */
  readonly bass: number;
  /** The pad's lowpass cutoff in Hz: darker when quiet, opening up with intensity. */
  readonly padCutoff: number;
}

export const MUSIC_SILENT: MusicMix = { pad: 0, pulse: 0, bass: 0, padCutoff: 400 };

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * The combat music's mix for the director's phase and intensity (0 to 1). The quiet phase keeps
 * only a faint pad so the valley breathes; build-up brings the pulse in as intensity rises; the
 * peak adds the bass; fade lets the pulse drain away with the intensity. Gains are relative, the
 * music bus applies the overall level.
 */
export function musicMix(phase: PacingPhase, intensity: number): MusicMix {
  const level = clamp01(intensity);
  const padCutoff = 420 + 1400 * level;
  switch (phase) {
    case 'relax':
      return { pad: 0.35, pulse: 0, bass: 0, padCutoff: 420 };
    case 'buildUp':
      return { pad: 0.45 + 0.3 * level, pulse: 0.25 + 0.55 * level, bass: 0, padCutoff };
    case 'peak':
      return { pad: 0.8, pulse: 0.9, bass: 0.75 + 0.25 * level, padCutoff };
    case 'fade':
      return { pad: 0.5 + 0.2 * level, pulse: 0.6 * level, bass: 0, padCutoff };
  }
}

/** Below this share of health the heartbeat starts. */
export const HEARTBEAT_THRESHOLD = 0.35;

export interface Heartbeat {
  readonly bpm: number;
  /** 0 to 1, relative; the engine scales it. */
  readonly gain: number;
}

/**
 * The low-health heartbeat: none above HEARTBEAT_THRESHOLD, then faster and louder as health
 * falls, 72 to 118 beats a minute. Dead (0) is silent: the death screen takes over.
 */
export function heartbeatFor(healthRatio: number): Heartbeat | null {
  if (healthRatio <= 0 || healthRatio >= HEARTBEAT_THRESHOLD) return null;
  const danger = 1 - healthRatio / HEARTBEAT_THRESHOLD;
  return { bpm: 72 + 46 * danger, gain: 0.45 + 0.55 * danger };
}

/**
 * A stereo impulse response for an open valley at dusk: a short gap, a few early reflections off
 * the slopes, then a diffuse tail that decays over `seconds` and darkens as it goes (high
 * frequencies die first outdoors). `random` makes it deterministic in tests. The two channels use
 * independent noise so the tail spreads across the stereo field.
 */
export function valleyImpulse(sampleRate: number, seconds: number, random: () => number): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(length), new Float32Array(length)];
  const preDelay = Math.floor(sampleRate * 0.018);
  const reflections = [0.031, 0.047, 0.074, 0.112];
  for (const [index, data] of channels.entries()) {
    let smoothed = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / sampleRate;
      const progress = (i - preDelay) / (length - preDelay);
      const envelope = Math.pow(1 - progress, 2.2) * Math.exp(-3.2 * t);
      // A one-pole lowpass whose cutoff falls along the tail.
      const darkening = 0.75 - 0.6 * progress;
      smoothed += darkening * ((random() * 2 - 1) - smoothed);
      data[i] = smoothed * envelope * 0.6;
    }
    // Early reflections, offset a little between the ears.
    reflections.forEach((delay, k) => {
      const at = Math.floor(sampleRate * (delay + index * 0.0035 * (k + 1)));
      if (at < length) data[at] = (data[at] ?? 0) + 0.5 / (k + 1.5);
    });
  }
  return channels;
}

/** The outdoor layers disappear as the listener settles underground. */
export function outdoorAmbienceGain(undergroundAmount: number): number {
  return 1 - clamp01(undergroundAmount);
}

/** More of the existing room return underground, without rebuilding its impulse. */
export function undergroundReverbScale(undergroundAmount: number): number {
  return 1 + 0.6 * clamp01(undergroundAmount);
}

/** Full near a core, then a smooth fade to silence at 22 m. Infinity means no reactor here. */
export function reactorHumGain(reactorDistance: number): number {
  const t = clamp01((reactorDistance - 4) / 18);
  return 1 - t * t * (3 - 2 * t);
}

/** How much of a sound goes to the reverb: distant sounds are mostly room, close ones mostly dry. */
export function reverbSendFor(volumeScale: number, base: number): number {
  return clamp01(base + 0.55 * (1 - clamp01(volumeScale)));
}
