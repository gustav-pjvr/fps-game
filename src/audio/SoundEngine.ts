import { Settings } from '../settings/Settings.ts';
import { WEAPON_SOUND_PATHS } from './weaponSounds.ts';
import { heartbeatFor, MUSIC_SILENT, musicMix, reverbSendFor, valleyImpulse, type MusicMix, type PacingPhase } from './ambience.ts';

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

/** The enemy callouts (enemy AI v2 step 5) - see SoundEngine.playCallout. */
export type CalloutSound = 'spotted' | 'flanking' | 'lostThem';

/** Each callout is a radio click then a short chirp whose shape says what it means: rising for
 * "spotted", three quick for "flanking", falling for "lost them". Frequency (Hz) and start offset
 * (s) per note. */
const CALLOUT_PATTERNS: Readonly<Record<CalloutSound, readonly (readonly [number, number])[]>> = {
  spotted: [
    [660, 0],
    [990, 0.09],
  ],
  flanking: [
    [520, 0],
    [520, 0.07],
    [780, 0.14],
  ],
  lostThem: [
    [740, 0],
    [440, 0.11],
  ],
};

/**
 * Weapon shot/reload sounds play real recorded samples (see weaponSounds.ts) with a procedural
 * Web Audio synthesis fallback if a sample fails to load. Footstep/hit-confirm/player-hurt stay
 * fully procedural - no recorded assets for those.
 */
/** Overall level of the music bus before the music volume setting: music sits under the fight. */
const MUSIC_LEVEL = 0.2;
/** Seconds the music mix takes to follow the director (a time constant, about a third of a fade). */
const MUSIC_SMOOTHING = 1.4;
/** Eighth notes at 104 beats a minute for the pulse and the bass. */
const PULSE_STEP = 60 / 104 / 2;
/** The bass ostinato, one note per quarter: A1, A1, C2, G1. */
const BASS_NOTES = [55, 55, 65.41, 49];
/** How far ahead (s) the scheduler books pulse ticks and heartbeats. */
const SCHEDULE_AHEAD = 0.2;

/** What Game reports to the ambience layers each tick. */
export interface AmbienceState {
  /** 0 to 1. */
  readonly healthRatio: number;
  /** The pacing director's state in a Director or Uplink match, null otherwise (no music). */
  readonly director: { readonly phase: PacingPhase; readonly intensity: number } | null;
  /** False while paused, dead or behind an end screen: music and heartbeat fade out. */
  readonly active: boolean;
}

interface MusicNodes {
  readonly oscillators: OscillatorNode[];
  readonly padGain: GainNode;
  readonly padFilter: BiquadFilterNode;
  readonly pulseGain: GainNode;
  /** Bass notes go into this filter; bassGain sets the layer's level after it. */
  readonly bassInput: AudioNode;
  readonly bassGain: GainNode;
}

export class SoundEngine {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly buffers: Map<string, AudioBuffer>;
  private keepAliveOscillator: OscillatorNode | null = null;
  /** The valley reverb (phase 6): sounds send into this, it returns into master. */
  private readonly reverbSend: GainNode;
  private readonly musicBus: GainNode;
  private music: MusicNodes | null = null;
  private mix: MusicMix = MUSIC_SILENT;
  private nextPulseTime = 0;
  private pulseStep = 0;
  private nextBeatTime = 0;

  private constructor(ctx: AudioContext, buffers: Map<string, AudioBuffer>) {
    this.ctx = ctx;
    this.buffers = buffers;
    this.master = ctx.createGain();
    this.master.gain.value = Settings.getMasterVolume();
    this.master.connect(this.ctx.destination);
    this.startKeepAlive();

    this.reverbSend = ctx.createGain();
    const convolver = ctx.createConvolver();
    const [left, right] = valleyImpulse(ctx.sampleRate, 2.4, Math.random);
    const impulse = ctx.createBuffer(2, left.length, ctx.sampleRate);
    impulse.copyToChannel(left, 0);
    impulse.copyToChannel(right, 1);
    convolver.buffer = impulse;
    this.reverbSend.connect(convolver).connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
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
    // Routed through the master gain (not straight to ctx.destination) so the volume setting -
    // including mute - applies to it like every other sound; a gain node at 0 still keeps the
    // audio graph rendering, so the warm-pipeline purpose survives the reroute.
    oscillator.connect(silentGain).connect(this.master);
    oscillator.start();
    this.keepAliveOscillator = oscillator;
  }

  /** Releases the AudioContext (and the permanently running keep-alive oscillator feeding it).
   * Browsers cap concurrent AudioContexts (Chrome historically ~6), so without this each
   * lobby->match cycle leaked one until new contexts silently failed to create and audio died. */
  dispose(): void {
    this.keepAliveOscillator?.stop();
    this.keepAliveOscillator = null;
    for (const oscillator of this.music?.oscillators ?? []) oscillator.stop();
    this.music = null;
    void this.ctx.close();
  }

  setMasterVolume(value: number): void {
    this.master.gain.value = Math.max(0, Math.min(1, value));
  }

  /** AudioContext starts suspended until a user gesture - call from any click/keydown handler. */
  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** `volumeScale` (0..1, default 1) scales this one shot's gain on top of the master volume -
   * enemy/opponent gunshots pass a distance-attenuated value so a shot from 30 units away no
   * longer sounds identical to one at point-blank (the player's own shots always play at full
   * scale). `pan` (-1..1, default 0 i.e. centered) places the shot left/right of center - used for
   * opponent gunshots in multiplayer (per user request: "positional audio") so a shot from off to
   * the player's side is audibly distinguishable from one straight ahead or behind, not just
   * louder/quieter with distance. The player's own shots always pass pan=0 - a shot fired from your
   * own gun has no meaningful direction relative to yourself. */
  playGunshot(weaponId: string, volumeScale = 1, pan = 0): void {
    // Every shot rings off the valley; a distant one is mostly that ring (phase 6).
    const wet = reverbSendFor(volumeScale, 0.22);
    if (this.playBuffer(`${weaponId}_shot`, volumeScale, pan, wet)) return;

    switch (weaponId) {
      case 'pistol':
        this.noiseBurst(0.09, 2200, 'lowpass', 0.5 * volumeScale, pan, wet);
        this.tone(180, 0.05, 0.3 * volumeScale, 'square', pan, 0, wet);
        break;
      case 'rifle':
        this.noiseBurst(0.06, 2600, 'lowpass', 0.4 * volumeScale, pan, wet);
        this.tone(220, 0.04, 0.22 * volumeScale, 'square', pan, 0, wet);
        break;
      case 'shotgun':
        this.noiseBurst(0.18, 700, 'lowpass', 0.7 * volumeScale, pan, wet);
        this.tone(100, 0.12, 0.4 * volumeScale, 'sawtooth', pan, 0, wet);
        break;
      case 'sniper':
        this.noiseBurst(0.22, 900, 'lowpass', 0.8 * volumeScale, pan, wet);
        this.tone(90, 0.18, 0.5 * volumeScale, 'sawtooth', pan, 0, wet);
        break;
      default:
        this.noiseBurst(0.1, 2000, 'lowpass', 0.5 * volumeScale, pan, wet);
    }
  }

  playKnifeSwing(volumeScale = 1, pan = 0): void {
    this.noiseBurst(0.18, 3600, 'bandpass', 0.28 * volumeScale, pan, 0, 650, 0.025);
  }

  playKnifeHit(): void {
    this.tone(95, 0.09, 0.35, 'sine');
    this.noiseBurst(0.025, 2200, 'highpass', 0.16);
  }

  playReloadClick(weaponId: string): void {
    if (this.playBuffer(`${weaponId}_reload`)) return;
    this.noiseBurst(0.03, 3000, 'highpass', 0.18);
  }

  /** `volumeScale`/`pan` follow the same convention as `playGunshot` - used for a multiplayer
   * opponent's footsteps (per user request: "add footsteps... heard by all players"), which need
   * distance attenuation/positioning the player's own footsteps never did (always played at
   * volumeScale=1, pan=0, i.e. these two defaults). */
  playFootstep(volumeScale = 1, pan = 0): void {
    this.noiseBurst(0.06, 300, 'lowpass', 0.12 * volumeScale, pan);
  }

  /** The torch's switch (docs/facility-map.md, section 7): a short mechanical click, a touch higher
   * switching on than off. */
  playTorchClick(on: boolean): void {
    this.noiseBurst(0.018, 4200, 'highpass', 0.14);
    this.tone(on ? 1900 : 1500, 0.025, 0.05, 'square');
  }

  /** A Facility lamp shot out (docs/facility-map.md, section 11): breaking glass (a bright crack and
   * a few falling tinkles) over an electrical fizz and a short mains buzz. `volumeScale`/`pan`
   * follow the same convention as `playGunshot`. */
  playLampBreak(volumeScale = 1, pan = 0): void {
    this.noiseBurst(0.09, 5200, 'highpass', 0.32 * volumeScale, pan);
    for (const [frequency, delay] of [[3400, 0.03], [4700, 0.08], [2900, 0.14], [5600, 0.21]] as const) {
      this.tone(frequency, 0.07, 0.05 * volumeScale, 'sine', pan, delay);
    }
    this.noiseBurst(0.45, 2400, 'bandpass', 0.16 * volumeScale, pan, 0, 700, 0.01);
    this.tone(120, 0.3, 0.06 * volumeScale, 'sawtooth', pan);
  }

  playHitConfirm(): void {
    this.tone(1100, 0.06, 0.22, 'sine');
  }

  /** A pickup taken (docs/pickups.md): a short two-note chime, rising for health, a metal clack for
   * ammo and a heavier double clunk for a grenade crate. */
  playPickup(kind: 'health' | 'ammo' | 'grenade'): void {
    if (kind === 'health') {
      this.tone(660, 0.09, 0.12, 'sine');
      this.tone(990, 0.16, 0.12, 'sine', 0, 0.08);
    } else if (kind === 'ammo') {
      this.noiseBurst(0.03, 3000, 'highpass', 0.14);
      this.tone(420, 0.06, 0.1, 'square', 0, 0.03);
    } else {
      this.noiseBurst(0.05, 1200, 'bandpass', 0.18);
      this.tone(180, 0.1, 0.14, 'triangle');
      this.tone(240, 0.1, 0.12, 'triangle', 0, 0.07);
    }
  }

  playPlayerHurt(): void {
    this.noiseBurst(0.15, 250, 'lowpass', 0.4);
    this.tone(140, 0.15, 0.3, 'sawtooth');
  }

  /** Goose explosion - fully procedural like every other non-weapon sound here (footstep/
   * hit-confirm/player-hurt), no recorded asset. A longer, lower-pitched noise burst than any
   * gunshot (reads as a real detonation, not another shot) plus a low sawtooth thump for body.
   * `volumeScale`/`pan` follow the same convention as playGunshot. */
  playExplosion(volumeScale = 1, pan = 0): void {
    const wet = reverbSendFor(volumeScale, 0.45);
    this.noiseBurst(0.5, 350, 'lowpass', 0.9 * volumeScale, pan, wet);
    this.tone(70, 0.4, 0.6 * volumeScale, 'sawtooth', pan, 0, wet);
  }

  /**
   * The phase 6 layers, called every simulation tick: the combat music follows the pacing
   * director's phase and intensity (ambience.ts musicMix), and a heartbeat comes in at low health.
   * Both fade out while the game is paused, the player is dead or an end screen is up. Ticks and
   * beats are booked slightly ahead on the audio clock, so frame hitches never make them stutter.
   */
  updateAmbience(state: AmbienceState): void {
    const now = this.ctx.currentTime;
    const target = state.active && state.director ? musicMix(state.director.phase, state.director.intensity) : MUSIC_SILENT;
    if (!this.music && target.pad > 0) this.music = this.buildMusic();
    const music = this.music;
    if (music) {
      this.musicBus.gain.setTargetAtTime(MUSIC_LEVEL * Settings.getMusicVolume(), now, 0.3);
      music.padGain.gain.setTargetAtTime(target.pad * 0.5, now, MUSIC_SMOOTHING);
      music.padFilter.frequency.setTargetAtTime(target.padCutoff, now, MUSIC_SMOOTHING);
      music.pulseGain.gain.setTargetAtTime(target.pulse, now, MUSIC_SMOOTHING);
      music.bassGain.gain.setTargetAtTime(target.bass, now, MUSIC_SMOOTHING);
      this.mix = target;
      this.schedulePulse(music, now);
    }

    const beat = state.active ? heartbeatFor(state.healthRatio) : null;
    if (!beat) {
      this.nextBeatTime = 0;
      return;
    }
    if (this.nextBeatTime < now) this.nextBeatTime = now + 0.05;
    while (this.nextBeatTime < now + SCHEDULE_AHEAD) {
      const at = this.nextBeatTime;
      // Lub, then a softer, lower dub.
      this.scheduledTone(58, at, 0.12, 0.55 * beat.gain, 'sine', this.master);
      this.scheduledTone(49, at + 0.17, 0.11, 0.38 * beat.gain, 'sine', this.master);
      this.nextBeatTime += 60 / beat.bpm;
    }
  }

  private buildMusic(): MusicNodes {
    const ctx = this.ctx;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 420;
    padFilter.Q.value = 0.7;
    const padGain = ctx.createGain();
    padGain.gain.value = 0;
    padFilter.connect(padGain).connect(this.musicBus);
    // A, slightly detuned A and E: an open fifth, neither major nor minor, so it reads as tension.
    const oscillators = [110, 110.8, 164.8].map((frequency) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = frequency;
      oscillator.connect(padFilter);
      oscillator.start();
      return oscillator;
    });
    // The pad sends a little into the valley too, so it sits in the same space as the shots.
    const padSend = ctx.createGain();
    padSend.gain.value = 0.35;
    padGain.connect(padSend).connect(this.reverbSend);

    const pulseGain = ctx.createGain();
    pulseGain.gain.value = 0;
    pulseGain.connect(this.musicBus);
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.value = 260;
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0;
    bassFilter.connect(bassGain).connect(this.musicBus);
    this.nextPulseTime = ctx.currentTime + 0.1;
    this.pulseStep = 0;
    return { oscillators, padGain, padFilter, pulseGain, bassInput: bassFilter, bassGain };
  }

  private schedulePulse(music: MusicNodes, now: number): void {
    if (this.mix.pulse <= 0.01 && this.mix.bass <= 0.01) {
      this.nextPulseTime = now + 0.1;
      return;
    }
    if (this.nextPulseTime < now) this.nextPulseTime = now + 0.05;
    while (this.nextPulseTime < now + SCHEDULE_AHEAD) {
      const at = this.nextPulseTime;
      const downbeat = this.pulseStep % 2 === 0;
      this.scheduledNoise(at, 0.035, 5200, downbeat ? 0.32 : 0.18, music.pulseGain);
      if (downbeat) {
        const note = BASS_NOTES[(this.pulseStep / 2) % BASS_NOTES.length]!;
        this.scheduledTone(note, at, PULSE_STEP * 1.8, 0.7, 'square', music.bassInput);
      }
      this.pulseStep++;
      this.nextPulseTime += PULSE_STEP;
    }
  }

  private scheduledTone(frequency: number, start: number, duration: number, gain: number, type: OscillatorType, destination: AudioNode): void {
    const oscillator = this.ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private scheduledNoise(start: number, duration: number, cutoff: number, gain: number, destination: AudioNode): void {
    const length = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter).connect(envelope).connect(destination);
    source.start(start);
    source.stop(start + duration);
  }

  /** An enemy callout (enemy AI v2 step 5) - fully procedural like every non-weapon sound here: a
   * short radio click, then a chirp whose shape carries the meaning (CALLOUT_PATTERNS). Quieter
   * than a gunshot on purpose - it informs, it should not startle. `volumeScale`/`pan` follow the
   * same convention as playGunshot. */
  playCallout(kind: CalloutSound, volumeScale = 1, pan = 0): void {
    this.noiseBurst(0.04, 1800, 'bandpass', 0.1 * volumeScale, pan);
    for (const [frequency, offset] of CALLOUT_PATTERNS[kind]) {
      this.tone(frequency, 0.08, 0.16 * volumeScale, 'square', pan, 0.04 + offset);
    }
  }

  /** The Ridge Walker's scope glint (step 5): a faint, high "ting" to go with the visual flash, so a
   * player looking elsewhere still gets the warning. */
  playGlint(volumeScale = 1, pan = 0): void {
    this.tone(2600, 0.12, 0.07 * volumeScale, 'sine', pan);
    this.tone(3900, 0.08, 0.035 * volumeScale, 'sine', pan, 0.02);
  }

  /** Returns `this.master` unchanged when centered (pan===0) - the common case (player's own
   * shots, every non-positional sound) skips creating a StereoPannerNode it doesn't need. */
  private outputNode(pan: number, wet = 0): AudioNode {
    let dry: AudioNode = this.master;
    if (pan !== 0) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      panner.connect(this.master);
      dry = panner;
    }
    if (wet <= 0) return dry;
    // Splits into the dry path and a send to the valley reverb (unpanned: the valley is all round).
    const split = this.ctx.createGain();
    split.connect(dry);
    const send = this.ctx.createGain();
    send.gain.value = wet;
    split.connect(send).connect(this.reverbSend);
    return split;
  }

  /** Plays a preloaded recorded sample by key - returns false (does nothing) if it never loaded. */
  private playBuffer(key: string, volumeScale = 1, pan = 0, wet = 0): boolean {
    const buffer = this.buffers.get(key);
    if (!buffer) return false;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const output = this.outputNode(pan, wet);
    if (volumeScale !== 1) {
      const gain = this.ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(1, volumeScale));
      source.connect(gain).connect(output);
    } else {
      source.connect(output);
    }
    source.start();
    return true;
  }

  private noiseBurst(duration: number, filterFreq: number, filterType: BiquadFilterType, gain: number, pan = 0, wet = 0, endFilterFreq?: number, attack = 0): void {
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    if (endFilterFreq !== undefined) {
      filter.frequency.setValueAtTime(filterFreq, this.ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(endFilterFreq, this.ctx.currentTime + duration);
    }

    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(attack > 0 ? 0 : gain, this.ctx.currentTime);
    if (attack > 0) envelope.gain.linearRampToValueAtTime(gain, this.ctx.currentTime + attack);
    envelope.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    source.connect(filter).connect(envelope).connect(this.outputNode(pan, wet));
    source.start();
    source.stop(this.ctx.currentTime + duration);
  }

  /** `delay` (seconds) schedules the tone after now - used to string notes into a callout. */
  private tone(frequency: number, duration: number, gain: number, type: OscillatorType, pan = 0, delay = 0, wet = 0): void {
    const oscillator = this.ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;

    const start = this.ctx.currentTime + delay;
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);

    oscillator.connect(envelope).connect(this.outputNode(pan, wet));
    oscillator.start(start);
    oscillator.stop(start + duration);
  }
}
