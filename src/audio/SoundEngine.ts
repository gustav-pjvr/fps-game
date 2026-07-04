import { Settings } from '../settings/Settings.ts';
import { WEAPON_SOUND_PATHS } from './weaponSounds.ts';

async function loadWeaponSoundBuffers(ctx: AudioContext): Promise<Map<string, AudioBuffer>> {
  const buffers = new Map<string, AudioBuffer>();
  const entries = Object.entries(WEAPON_SOUND_PATHS).flatMap(([weaponId, paths]) => [
    [`${weaponId}_shot`, paths.shot],
    [`${weaponId}_reload`, paths.reload],
  ]);

  await Promise.all(
    entries.map(async ([key, path]) => {
      if (!key || !path) return;
      try {
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        buffers.set(key, audioBuffer);
      } catch (error) {
        // Missing/corrupt sample for one weapon shouldn't break the rest - playGunshot/
        // playReloadClick fall back to procedural synthesis when a key has no buffer.
        console.warn(`Failed to load weapon sound "${key}" from ${path}`, error);
      }
    }),
  );

  return buffers;
}

/**
 * Weapon shot/reload sounds play real recorded samples (see weaponSounds.ts) with a procedural
 * Web Audio synthesis fallback if a sample fails to load. Footstep/hit-confirm/player-hurt stay
 * fully procedural - no recorded assets for those.
 */
export class SoundEngine {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly buffers: Map<string, AudioBuffer>;

  private constructor(ctx: AudioContext, buffers: Map<string, AudioBuffer>) {
    this.ctx = ctx;
    this.buffers = buffers;
    this.master = ctx.createGain();
    this.master.gain.value = Settings.getMasterVolume();
    this.master.connect(this.ctx.destination);
    this.startKeepAlive();
  }

  static async create(): Promise<SoundEngine> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const buffers = await loadWeaponSoundBuffers(ctx);
    return new SoundEngine(ctx, buffers);
  }

  /** Chrome (and some other browsers) can idle-throttle an AudioContext's render thread during
   * silent gaps between one-shot sounds, adding a perceptible "wake-up" delay to the next sound
   * scheduled after a pause - exactly the semi-auto gunshot cadence this game has. A near-silent,
   * permanently running oscillator keeps the audio graph continuously active so gunshots always
   * play on a warm pipeline instead of periodically re-waking it. */
  private startKeepAlive(): void {
    const oscillator = this.ctx.createOscillator();
    oscillator.frequency.value = 20;
    const silentGain = this.ctx.createGain();
    silentGain.gain.value = 0.0001;
    oscillator.connect(silentGain).connect(this.ctx.destination);
    oscillator.start();
  }

  setMasterVolume(value: number): void {
    this.master.gain.value = Math.max(0, Math.min(1, value));
  }

  /** AudioContext starts suspended until a user gesture - call from any click/keydown handler. */
  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  playGunshot(weaponId: string): void {
    if (this.playBuffer(`${weaponId}_shot`)) return;

    switch (weaponId) {
      case 'pistol':
        this.noiseBurst(0.09, 2200, 'lowpass', 0.5);
        this.tone(180, 0.05, 0.3, 'square');
        break;
      case 'rifle':
        this.noiseBurst(0.06, 2600, 'lowpass', 0.4);
        this.tone(220, 0.04, 0.22, 'square');
        break;
      case 'shotgun':
        this.noiseBurst(0.18, 700, 'lowpass', 0.7);
        this.tone(100, 0.12, 0.4, 'sawtooth');
        break;
      case 'sniper':
        this.noiseBurst(0.22, 900, 'lowpass', 0.8);
        this.tone(90, 0.18, 0.5, 'sawtooth');
        break;
      default:
        this.noiseBurst(0.1, 2000, 'lowpass', 0.5);
    }
  }

  playReloadClick(weaponId: string): void {
    if (this.playBuffer(`${weaponId}_reload`)) return;
    this.noiseBurst(0.03, 3000, 'highpass', 0.18);
  }

  playFootstep(): void {
    this.noiseBurst(0.06, 300, 'lowpass', 0.12);
  }

  playHitConfirm(): void {
    this.tone(1100, 0.06, 0.22, 'sine');
  }

  playPlayerHurt(): void {
    this.noiseBurst(0.15, 250, 'lowpass', 0.4);
    this.tone(140, 0.15, 0.3, 'sawtooth');
  }

  /** Plays a preloaded recorded sample by key - returns false (does nothing) if it never loaded. */
  private playBuffer(key: string): boolean {
    const buffer = this.buffers.get(key);
    if (!buffer) return false;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    source.start();
    return true;
  }

  private noiseBurst(duration: number, filterFreq: number, filterType: BiquadFilterType, gain: number): void {
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;

    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, this.ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    source.connect(filter).connect(envelope).connect(this.master);
    source.start();
    source.stop(this.ctx.currentTime + duration);
  }

  private tone(frequency: number, duration: number, gain: number, type: OscillatorType): void {
    const oscillator = this.ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;

    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, this.ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    oscillator.connect(envelope).connect(this.master);
    oscillator.start();
    oscillator.stop(this.ctx.currentTime + duration);
  }
}
