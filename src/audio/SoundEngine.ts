import { Settings } from '../settings/Settings.ts';
import { BLADE_SWINGS, DEFAULT_BLADE_SWING, DEFAULT_GUN_SOUND, GUN_SOUNDS, reloadSteps, type ReloadStep } from './weaponSounds.ts';
import { WEAPON_DEFINITIONS } from '../weapons/definitions.ts';
import { DEAF_CUTOFF_OPEN, flashDeafness, RING_FREQUENCY } from './flashDeafness.ts';
import { heartbeatFor, MUSIC_SILENT, musicMix, outdoorAmbienceGain, reactorHumGain, reverbSendFor, undergroundReverbScale, valleyImpulse, type MusicMix, type PacingPhase } from './ambience.ts';

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
 * Every effect is procedural Web Audio synthesis: weapon shots, reloads and blade swings from the
 * per-weapon profiles in weaponSounds.ts, footsteps, hit confirms and the rest from fixed recipes.
 * The only recorded audio in a match is the indoor music track.
 */
/** Overall level of the music bus before the music volume setting: music sits under the fight. */
const MUSIC_LEVEL = 0.2;
/** The recorded track that loops under an indoor (Facility) match; see startBedMusic. */
export const INDOOR_MATCH_TRACK = '/assets/music/floating-in-the-abyss.mp3';
/** Level of the indoor match track before the music volume setting: softer than the combat mix. */
const BED_LEVEL = 0.22;
/** Seconds (a time constant) the indoor track takes to fade in and out with pausing and death. */
const BED_SMOOTHING = 0.8;
/** Seconds the music mix takes to follow the director (a time constant, about a third of a fade). */
const MUSIC_SMOOTHING = 1.4;
/** Eighth notes at 104 beats a minute for the pulse and the bass. */
const PULSE_STEP = 60 / 104 / 2;
/** The bass ostinato, one note per quarter: A1, A1, C2, G1. */
const BASS_NOTES = [55, 55, 65.41, 49];
/** How far ahead (s) the scheduler books pulse ticks and heartbeats. */
const SCHEDULE_AHEAD = 0.2;

/** What Game reports to the ambience layers each tick. */
export interface AmbienceInputs {
  /** The eased lighting blend, 0 outdoors and 1 underground. */
  readonly undergroundAmount: number;
  /** Metres to the nearest core in this lab, Infinity elsewhere. */
  readonly reactorDistance: number;
  /** Valley only: the Facility has its own indoor bed. */
  readonly outdoor: boolean;
  /** 0 to 1. */
  readonly healthRatio: number;
  /** The pacing director's state in a Director or Uplink match, null otherwise (no music). */
  readonly director: { readonly phase: PacingPhase; readonly intensity: number } | null;
  /** False while paused, dead or behind an end screen: music and heartbeat fade out. */
  readonly active: boolean;
}

interface AmbientNodes {
  readonly sources: (OscillatorNode | AudioBufferSourceNode)[];
  readonly gain: GainNode;
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
  /** A flash grenade's muffle (flashDeafness.ts): a low-pass between the master bus and the output,
   * wide open until a flash closes it. */
  private readonly deafFilter: BiquadFilterNode;
  /** The flash ring, made on the first flash and kept running at zero gain after. */
  private ring: { oscillator: OscillatorNode; gain: GainNode } | null = null;
  private deafLevel = 0;
  private keepAliveOscillator: OscillatorNode | null = null;
  /** The valley reverb (phase 6): sounds send into this, it returns into master. */
  private readonly reverbSend: GainNode;
  private readonly reverbFilter: BiquadFilterNode;
  private reactorHum: AmbientNodes | null = null;
  private readonly musicBus: GainNode;
  private music: MusicNodes | null = null;
  /** The looping recorded track of an indoor match (startBedMusic), null until it has loaded. */
  private bed: { readonly source: AudioBufferSourceNode; readonly gain: GainNode } | null = null;
  private bedLoading = false;
  private mix: MusicMix = MUSIC_SILENT;
  private nextPulseTime = 0;
  private pulseStep = 0;
  private nextBeatTime = 0;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = Settings.getMasterVolume();
    this.deafFilter = ctx.createBiquadFilter();
    this.deafFilter.type = 'lowpass';
    this.deafFilter.frequency.value = DEAF_CUTOFF_OPEN;
    this.master.connect(this.deafFilter).connect(this.ctx.destination);
    this.startKeepAlive();

    this.reverbSend = ctx.createGain();
    const convolver = ctx.createConvolver();
    const [left, right] = valleyImpulse(ctx.sampleRate, 2.4, Math.random);
    const impulse = ctx.createBuffer(2, left.length, ctx.sampleRate);
    impulse.copyToChannel(left, 0);
    impulse.copyToChannel(right, 1);
    convolver.buffer = impulse;
    this.reverbFilter = ctx.createBiquadFilter();
    this.reverbFilter.type = 'lowpass';
    this.reverbFilter.frequency.value = 14000;
    this.reverbSend.connect(this.reverbFilter).connect(convolver).connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
  }

  static async create(): Promise<SoundEngine> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    return new SoundEngine(ctx);
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
    this.ring?.oscillator.stop();
    this.ring = null;
    for (const oscillator of this.music?.oscillators ?? []) oscillator.stop();
    this.music = null;
    for (const source of this.reactorHum?.sources ?? []) source.stop();
    this.reactorHum = null;
    this.bed?.source.stop();
    this.bed = null;
    void this.ctx.close();
  }

  /**
   * Loops a recorded track softly under the match (the Facility's indoor music, docs/music.md). It
   * rides the master bus, so it follows the volume settings and a flash grenade's muffle, and
   * updateAmbience fades it with pausing and death. While it plays the synthesized combat mix stays
   * silent, so two pieces of music never fight. A track that fails to load leaves the match as it was.
   */
  async startBedMusic(path: string): Promise<void> {
    if (this.bed || this.bedLoading) return;
    this.bedLoading = true;
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      if (this.ctx.state === 'closed') return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.master);
      source.start();
      this.bed = { source, gain };
    } catch (error) {
      console.warn(`Failed to load the match music from ${path}`, error);
    } finally {
      this.bedLoading = false;
    }
  }

  setMasterVolume(value: number): void {
    this.master.gain.value = Math.max(0, Math.min(1, value));
  }

  /** A flash grenade's white-out, 0 to 1 (GrenadeSystem.blindLevel), per frame: muffles everything
   * through the master low-pass and rings over it, both following the level (flashDeafness.ts). */
  setFlashDeafness(level: number): void {
    const clamped = Math.max(0, Math.min(1, level));
    if (clamped === this.deafLevel) return;
    this.deafLevel = clamped;
    const { cutoff, ringGain } = flashDeafness(clamped);
    const now = this.ctx.currentTime;
    this.deafFilter.frequency.setTargetAtTime(cutoff, now, 0.03);
    if (!this.ring && ringGain > 0) {
      const oscillator = this.ctx.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = RING_FREQUENCY;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      // After the muffle, so the ring stays clear; scaled by the volume setting by hand instead.
      oscillator.connect(gain).connect(this.ctx.destination);
      oscillator.start();
      this.ring = { oscillator, gain };
    }
    this.ring?.gain.gain.setTargetAtTime(ringGain * this.master.gain.value, now, 0.05);
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
    const sound = GUN_SOUNDS[weaponId] ?? DEFAULT_GUN_SOUND;
    // Every shot rings off the valley; a distant one is mostly that ring (phase 6).
    const wet = reverbSendFor(volumeScale, 0.22);
    // A few percent of pitch drift, so automatic fire is not one sample repeated.
    const drift = 0.96 + Math.random() * 0.08;
    const [crackTime, crackFrom, crackTo, crackGain] = sound.crack;
    this.noiseBurst(crackTime, crackFrom * drift, 'lowpass', crackGain * volumeScale, pan, wet, crackTo * drift);
    const [thumpFrom, thumpTo, thumpTime, thumpGain] = sound.thump;
    this.thump(thumpFrom * drift, thumpTo * drift, thumpTime, thumpGain * volumeScale, pan, wet);
    const [tailTime, tailFilter, tailGain] = sound.tail;
    this.noiseBurst(tailTime, tailFilter, 'lowpass', tailGain * volumeScale, pan, Math.min(1, wet * 1.6), tailFilter * 0.35, 0.012);
    if (sound.action) this.reloadStep('rack', sound.action[1] * volumeScale, pan, sound.action[0]);
  }

  /** A blade through the air. `weaponId` picks the blade's own whoosh (weaponSounds.ts). */
  playKnifeSwing(volumeScale = 1, pan = 0, weaponId = 'knife'): void {
    const [duration, from, to, gain] = BLADE_SWINGS[weaponId] ?? DEFAULT_BLADE_SWING;
    this.noiseBurst(duration, from, 'bandpass', gain * volumeScale, pan, 0, to, 0.025);
  }

  /** A short cue for a change in an objective: `gain` rises (your side took something), `lose`
   * falls (the other side did), `alert` is three even pips (the objective itself changed). */
  /** A teammate's ping (docs/coop.md): one short high note, quieter than an objective's cue. */
  playPing(): void {
    this.tone(988, 0.09, 0.1, 'sine');
    this.tone(1319, 0.12, 0.08, 'sine', 0, 0.07);
  }

  playObjectiveCue(kind: 'gain' | 'lose' | 'alert'): void {
    const notes = kind === 'gain' ? [523, 784] : kind === 'lose' ? [440, 294] : [660, 660, 660];
    notes.forEach((frequency, i) => this.tone(frequency, 0.12, 0.16, 'triangle', 0, i * 0.11));
  }

  playKnifeHit(): void {
    this.tone(95, 0.09, 0.35, 'sine');
    this.noiseBurst(0.025, 2200, 'highpass', 0.16);
  }

  /** The whole reload, scheduled now: each step of the weapon's reload (magazine out, magazine in,
   * the action racked) at its moment in the weapon's reload time. */
  playReloadClick(weaponId: string): void {
    const reloadTime = WEAPON_DEFINITIONS[weaponId]?.reloadTime ?? 1.5;
    for (const [fraction, step] of reloadSteps(weaponId)) this.reloadStep(step, 1, 0, fraction * reloadTime);
  }

  private reloadStep(step: ReloadStep, volumeScale: number, pan: number, delay: number): void {
    switch (step) {
      case 'out':
        this.noiseBurst(0.035, 3400, 'highpass', 0.16 * volumeScale, pan, 0, undefined, 0, delay);
        this.noiseBurst(0.06, 500, 'lowpass', 0.2 * volumeScale, pan, 0, undefined, 0, delay + 0.03);
        break;
      case 'in':
        this.noiseBurst(0.07, 900, 'lowpass', 0.3 * volumeScale, pan, 0, undefined, 0, delay);
        this.noiseBurst(0.025, 3800, 'highpass', 0.18 * volumeScale, pan, 0, undefined, 0, delay + 0.035);
        break;
      case 'shell':
        this.noiseBurst(0.05, 1300, 'bandpass', 0.24 * volumeScale, pan, 0, undefined, 0, delay);
        break;
      case 'rack':
        this.noiseBurst(0.045, 2600, 'bandpass', 0.26 * volumeScale, pan, 0, undefined, 0, delay);
        this.noiseBurst(0.05, 3200, 'bandpass', 0.3 * volumeScale, pan, 0, undefined, 0, delay + 0.09);
        break;
      default:
        this.noiseBurst(0.03, 3000, 'highpass', 0.18 * volumeScale, pan, 0, undefined, 0, delay);
    }
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

  /** A Facility door's two steel leaves sliding (docs/facility-map.md, section 12): a filtered
   * rumble over the 0.6 s travel, a low motor whine, and a thud as the leaves meet or stop.
   * `volumeScale`/`pan` follow the same convention as `playGunshot`. */
  playDoorSlide(closing: boolean, volumeScale = 1, pan = 0): void {
    this.noiseBurst(0.6, 900, 'bandpass', 0.2 * volumeScale, pan, 0, 420, 0.08);
    this.sweep(closing ? 110 : 80, closing ? 80 : 110, 0.55, 0.05 * volumeScale, 'sawtooth', pan);
    this.tone(closing ? 55 : 70, 0.16, 0.22 * volumeScale, 'sine', pan, 0.56);
  }

  /** A breaker lever thrown (section 12): a heavy clunk, then mains hum winding down when the zone
   * loses power or up when it comes back. Same `volumeScale`/`pan` convention. */
  playBreakerSwitch(on: boolean, volumeScale = 1, pan = 0): void {
    this.noiseBurst(0.08, 650, 'lowpass', 0.45 * volumeScale, pan);
    this.tone(90, 0.12, 0.28 * volumeScale, 'square', pan);
    if (on) this.sweep(35, 100, 0.7, 0.07 * volumeScale, 'sawtooth', pan, 0.05);
    else this.sweep(100, 30, 1.4, 0.08 * volumeScale, 'sawtooth', pan, 0.05);
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

  /** Grenades (docs/grenades.md), all synthesized; `volumeScale`/`pan` as playGunshot. The pin
   * coming out as a cook starts: a sharp metallic tick and the ring's ping. */
  playGrenadePin(volumeScale = 1, pan = 0): void {
    this.noiseBurst(0.02, 5200, 'highpass', 0.16 * volumeScale, pan);
    this.tone(2350, 0.06, 0.05 * volumeScale, 'triangle', pan);
    this.tone(3100, 0.05, 0.03 * volumeScale, 'sine', pan, 0.035);
  }

  /** A grenade leaving the hand: a short rising whoosh. */
  playGrenadeThrow(volumeScale = 1, pan = 0): void {
    this.noiseBurst(0.24, 700, 'bandpass', 0.24 * volumeScale, pan, 0, 2400, 0.05);
  }

  /** A grenade hitting something; `volumeScale` already carries the impact's speed. Two bright,
   * slightly random partials, so a run of bounces does not repeat one note. */
  playGrenadeBounce(volumeScale = 1, pan = 0): void {
    const pitch = 1 + (Math.random() - 0.5) * 0.25;
    this.noiseBurst(0.025, 3600, 'highpass', 0.12 * volumeScale, pan);
    this.tone(2700 * pitch, 0.07, 0.09 * volumeScale, 'triangle', pan);
    this.tone(4150 * pitch, 0.05, 0.045 * volumeScale, 'sine', pan, 0.004);
  }

  /** A frag going off: heavier and longer than the launcher's explosion (playExplosion), a crack on
   * top, a deep sub thump, a falling roar and a rattle of debris. */
  playFragExplosion(volumeScale = 1, pan = 0): void {
    const wet = reverbSendFor(volumeScale, 0.55);
    this.noiseBurst(0.07, 2800, 'highpass', 0.55 * volumeScale, pan, wet);
    this.noiseBurst(1.1, 520, 'lowpass', 0.95 * volumeScale, pan, wet, 110);
    this.tone(48, 0.75, 0.75 * volumeScale, 'sine', pan, 0, wet);
    this.tone(74, 0.45, 0.4 * volumeScale, 'sawtooth', pan, 0, wet);
    this.noiseBurst(0.7, 2300, 'bandpass', 0.1 * volumeScale, pan, wet, 900, 0.12);
  }

  /** A flash going off: a sharp, bright crack with little body, and a high ring after it. */
  playFlashBang(volumeScale = 1, pan = 0): void {
    const wet = reverbSendFor(volumeScale, 0.5);
    this.noiseBurst(0.05, 2400, 'highpass', 1.0 * volumeScale, pan, wet);
    this.noiseBurst(0.3, 1500, 'lowpass', 0.45 * volumeScale, pan, wet, 300);
    this.tone(150, 0.12, 0.35 * volumeScale, 'square', pan, 0, wet);
    this.tone(4300, 1.1, 0.07 * volumeScale, 'sine', pan, 0.02, wet);
    this.tone(3650, 0.8, 0.05 * volumeScale, 'sine', pan, 0.02, wet);
  }

  /**
   * The phase 6 layers, called every simulation tick: the combat music follows the pacing
   * director's phase and intensity (ambience.ts musicMix), and a heartbeat comes in at low health.
   * Both fade out while the game is paused, the player is dead or an end screen is up. Ticks and
   * beats are booked slightly ahead on the audio clock, so frame hitches never make them stutter.
   */
  updateAmbience(state: AmbienceInputs): void {
    const now = this.ctx.currentTime;
    this.reverbSend.gain.setTargetAtTime(undergroundReverbScale(state.undergroundAmount), now, 0.1);
    this.reverbFilter.frequency.setTargetAtTime(1800 + 12200 * outdoorAmbienceGain(state.undergroundAmount), now, 0.1);
    const humGain = state.active ? reactorHumGain(state.reactorDistance) * state.undergroundAmount * Settings.getMusicVolume() : 0;
    if (!this.reactorHum && humGain > 0) this.reactorHum = this.buildReactorHum();
    this.reactorHum?.gain.gain.setTargetAtTime(0.065 * humGain, now, 0.15);
    const target = state.active && state.director && !this.bed ? musicMix(state.director.phase, state.director.intensity) : MUSIC_SILENT;
    this.bed?.gain.gain.setTargetAtTime(state.active ? BED_LEVEL * Settings.getMusicVolume() : 0, now, BED_SMOOTHING);
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

  /** A frozen looping noise buffer, allocated once for each persistent ambience layer. */
  private loopingNoise(): AudioBufferSourceNode {
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 3, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  private buildReactorHum(): AmbientNodes {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const sources: AmbientNodes['sources'] = [];
    for (const frequency of [48, 50]) {
      const oscillator = this.ctx.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start();
      sources.push(oscillator);
    }
    const noise = this.loopingNoise();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.12;
    noise.connect(filter).connect(noiseGain).connect(gain);
    noise.start();
    sources.push(noise);
    return { sources, gain };
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
  private noiseBurst(duration: number, filterFreq: number, filterType: BiquadFilterType, gain: number, pan = 0, wet = 0, endFilterFreq?: number, attack = 0, delay = 0): void {
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const start = this.ctx.currentTime + delay;
    if (endFilterFreq !== undefined) {
      filter.frequency.setValueAtTime(filterFreq, start);
      filter.frequency.exponentialRampToValueAtTime(endFilterFreq, start + duration);
    }

    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(attack > 0 || delay > 0 ? 0 : gain, this.ctx.currentTime);
    if (delay > 0 && attack <= 0) envelope.gain.setValueAtTime(gain, start);
    if (attack > 0) {
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(gain, start + attack);
    }
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);

    source.connect(filter).connect(envelope).connect(this.outputNode(pan, wet));
    source.start(start);
    source.stop(start + duration);
  }

  /** The low body of a gunshot: a sine that starts at once and falls in pitch as it dies. */
  private thump(from: number, to: number, duration: number, gain: number, pan = 0, wet = 0): void {
    const oscillator = this.ctx.createOscillator();
    oscillator.type = 'sine';
    const start = this.ctx.currentTime;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(envelope).connect(this.outputNode(pan, wet));
    oscillator.start(start);
    oscillator.stop(start + duration);
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

  /** Like `tone`, with the pitch gliding from `from` to `to` Hz over the duration. */
  private sweep(from: number, to: number, duration: number, gain: number, type: OscillatorType, pan = 0, delay = 0): void {
    const oscillator = this.ctx.createOscillator();
    oscillator.type = type;
    const start = this.ctx.currentTime + delay;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);

    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0.001, start);
    envelope.gain.linearRampToValueAtTime(gain, start + Math.min(0.08, duration / 4));
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);

    oscillator.connect(envelope).connect(this.outputNode(pan));
    oscillator.start(start);
    oscillator.stop(start + duration);
  }
}
