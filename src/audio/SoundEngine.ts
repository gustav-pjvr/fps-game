import { Settings } from '../settings/Settings.ts';

/**
 * Procedural sound effects via Web Audio synthesis - no audio asset files, consistent with the
 * placeholder-visuals approach elsewhere. Swapping in real recorded SFX later (per PLAN.md's
 * free-asset pipeline, e.g. Freesound.org) means replacing these methods' internals; every
 * caller just calls play*() and doesn't know or care how the sound is produced.
 */
export class SoundEngine {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = Settings.getMasterVolume();
    this.master.connect(this.ctx.destination);
  }

  setMasterVolume(value: number): void {
    this.master.gain.value = Math.max(0, Math.min(1, value));
  }

  /** AudioContext starts suspended until a user gesture - call from any click/keydown handler. */
  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  playGunshot(weaponId: string): void {
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

  playFootstep(): void {
    this.noiseBurst(0.06, 300, 'lowpass', 0.12);
  }

  playHitConfirm(): void {
    this.tone(1100, 0.06, 0.22, 'sine');
  }

  playReloadClick(): void {
    this.noiseBurst(0.03, 3000, 'highpass', 0.18);
  }

  playPlayerHurt(): void {
    this.noiseBurst(0.15, 250, 'lowpass', 0.4);
    this.tone(140, 0.15, 0.3, 'sawtooth');
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
