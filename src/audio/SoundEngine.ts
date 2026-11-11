import { Settings } from '../settings/Settings.ts';
import { BLADE_SWINGS, DEFAULT_BLADE_SWING, DEFAULT_GUN_SOUND, GUN_SOUNDS, reloadSteps, type ReloadStep } from './weaponSounds.ts';
import { WEAPON_DEFINITIONS } from '../weapons/definitions.ts';
import { DEAF_CUTOFF_OPEN, flashDeafness, RING_FREQUENCY } from './flashDeafness.ts';
import { heartbeatFor, MUSIC_SILENT, musicMix, reactorHumGain, roomImpulse, valleyImpulse, windLevel, type MusicMix, type PacingPhase } from './ambience.ts';
import { CLEAR, type ListenerSpace, type Occlusion } from './occlusion.ts';
import {
  airCutoff, arrivalDelay, distanceGain, LOUDNESS, OPEN_CUTOFF, rearShadowCutoff, relativeToListener, reverbSendAt,
  type ListenerPose, type LoudnessKind, type Vec3Like,
} from './spatial.ts';
import { BUS_LEVELS, DUCKED_BUSES, dynamicsFor, MAX_SPATIAL_VOICES, SILENT_BELOW, type SoundBus } from './mix.ts';
import type { Surface } from './surfaces.ts';

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
/** Seconds of white noise every noise layer reads from, made once: nothing is allocated per shot. */
const NOISE_SECONDS = 2;
/** The wind bed's level at full, before the effects volume. */
const WIND_LEVEL = 0.05;
/** The least time between two casings' tinkles: automatic fire must not become a wind chime. */
const CASING_GAP = 0.11;

/** What Game reports to the ambience layers each tick. */
export interface AmbienceInputs {
  /** The eased lighting blend, 0 outdoors and 1 underground. */
  readonly undergroundAmount: number;
  /** Metres to the nearest core in this lab, Infinity elsewhere. */
  readonly reactorDistance: number;
  /** Valley only (it has weather to hear): the Facility has its own indoor bed. */
  readonly outdoor: boolean;
  /** Where the listener stands: picks the reverb every sound rings in, and dulls the wind indoors. */
  readonly space: ListenerSpace;
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

interface WindNodes extends AmbientNodes {
  readonly filter: BiquadFilterNode;
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

/** One sound event's path to the mix: every layer of the sound plays into `input`. */
interface Voice {
  readonly input: AudioNode;
  /** The audio-clock time the sound starts (after any travel time). */
  readonly at: number;
}

interface VoiceSpec {
  readonly bus: SoundBus;
  /** How this kind of sound carries; unused for the listener's own sounds. */
  readonly kind: LoudnessKind;
  /** World position of the source. Absent: the listener's own sound, in the middle of the head. */
  readonly source?: Vec3Like | null;
  /** Share sent to the reverb up close (it grows with distance). */
  readonly wet?: number;
  /** Extra gain on this event (an impact's speed, a quieter variant). */
  readonly gain?: number;
  /** Seconds the whole sound lasts, so its nodes can be released after. */
  readonly life: number;
  /** A far shot or blast arrives late (spatial.ts arrivalDelay). */
  readonly travels?: boolean;
  /** 0 to 1: how hard this sound pulls the rest of the mix down while it is loud (a blast). */
  readonly duck?: number;
}

interface NoiseLayer {
  readonly seconds: number;
  readonly filter: BiquadFilterType;
  readonly from: number;
  /** The filter glides here over the layer's length. */
  readonly to?: number;
  readonly q?: number;
  readonly gain: number;
  readonly attack?: number;
  readonly delay?: number;
}

interface ToneLayer {
  readonly from: number;
  /** The pitch glides here over the layer's length. */
  readonly to?: number;
  readonly seconds: number;
  readonly gain: number;
  readonly wave?: OscillatorType;
  readonly attack?: number;
  readonly delay?: number;
}

/** A source ahead of the listener at the origin: where a context with no listener updates hears from. */
const ORIGIN_POSE: ListenerPose = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };

/** The texture of a footstep and a bullet strike on each surface: [thud cutoff Hz, thud gain,
 * texture centre Hz, texture gain, texture seconds]. */
const STEP_SURFACES: Readonly<Record<Surface, readonly [number, number, number, number, number]>> = {
  earth: [260, 1, 1700, 0.35, 0.05],
  wood: [430, 0.9, 900, 0.3, 0.03],
  concrete: [520, 0.8, 2600, 0.42, 0.018],
  metal: [640, 0.7, 3200, 0.3, 0.02],
  glass: [480, 0.6, 5200, 0.9, 0.05],
  flesh: [300, 1, 800, 0.2, 0.03],
};

/**
 * The game's sound (docs/sound.md). Every effect is procedural Web Audio synthesis; the only
 * recorded audio in a match is the indoor music track.
 *
 * A sound is one event: its layers play into one voice, and the voice carries it to the mix. A
 * positioned voice is a gain (distance and walls), a low-pass (air and walls), a PannerNode at the
 * source's world position and a send to the reverb of the space the listener stands in. Callers
 * pass a world position, never a volume or a pan: the engine knows the listener (setListener), asks
 * the world what lies between (setWorldProbe) and applies the loudness model of that kind of sound
 * (spatial.ts). The listener's own sounds pass no position and play in the middle of the head.
 *
 * The mix: buses for weapons, movement, world, voices and UI, an effects level over them, then a
 * limiter so a firefight never clips; a near blast ducks the rest for a moment. Music joins after
 * the limiter so gunfire does not pump it.
 */
export class SoundEngine {
  private readonly ctx: BaseAudioContext;
  private readonly master: GainNode;
  /** A flash grenade's muffle (flashDeafness.ts): a low-pass between the master bus and the output,
   * wide open until a flash closes it. */
  private readonly deafFilter: BiquadFilterNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly makeup: GainNode;
  private readonly effects: GainNode;
  /** Pulled down for a moment by a near blast; the blast itself bypasses it. */
  private readonly duck: GainNode;
  private readonly buses: Record<SoundBus, GainNode>;
  /** One reverb per kind of space; a voice sends to the one the listener stands in. */
  private readonly reverbs: Record<'outdoor' | 'room' | 'hall', { readonly input: GainNode; readonly back: GainNode; readonly filter: BiquadFilterNode }>;
  private readonly noise: AudioBuffer;
  /** The flash ring, made on the first flash and kept running at zero gain after. */
  private ring: { oscillator: OscillatorNode; gain: GainNode } | null = null;
  private deafLevel = 0;
  private keepAliveOscillator: OscillatorNode | null = null;
  private reactorHum: AmbientNodes | null = null;
  private wind: WindNodes | null = null;
  private readonly musicBus: GainNode;
  private music: MusicNodes | null = null;
  /** The looping recorded track of an indoor match (startBedMusic), null until it has loaded. */
  private bed: { readonly source: AudioBufferSourceNode; readonly gain: GainNode } | null = null;
  private bedLoading = false;
  private mix: MusicMix = MUSIC_SILENT;
  private nextPulseTime = 0;
  private pulseStep = 0;
  private nextBeatTime = 0;
  private lastCasingAt = -1;

  private pose: ListenerPose = ORIGIN_POSE;
  private space: ListenerSpace = 'outdoor';
  private hrtf = true;
  private probe: ((listener: Vec3Like, source: Vec3Like) => Occlusion) | null = null;
  /** The sound test page forces what lies between ("behind a wall") instead of asking a world. */
  occlusionOverride: Occlusion | null = null;
  /** Positioned voices still sounding: their nodes, and the audio-clock time they can be released. */
  private readonly live: { readonly nodes: AudioNode[]; readonly until: number }[] = [];
  /** Counters for the performance report (docs/sound.md): voices opened, dropped as inaudible or
   * over the cap, and the most alive at once. */
  readonly stats = { opened: 0, inaudible: 0, overCap: 0, peakLive: 0 };

  /** `ctx` may be an OfflineAudioContext: the sound test page renders every sound through this
   * same engine to measure it. */
  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = Settings.getMasterVolume();
    this.deafFilter = ctx.createBiquadFilter();
    this.deafFilter.type = 'lowpass';
    this.deafFilter.frequency.value = DEAF_CUTOFF_OPEN;
    this.limiter = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();
    this.effects = ctx.createGain();
    this.effects.connect(this.limiter).connect(this.makeup).connect(this.master).connect(this.deafFilter).connect(ctx.destination);
    this.duck = ctx.createGain();
    this.duck.connect(this.effects);
    const bus = (name: SoundBus): GainNode => {
      const gain = ctx.createGain();
      gain.gain.value = BUS_LEVELS[name];
      gain.connect(DUCKED_BUSES.has(name) ? this.duck : this.effects);
      return gain;
    };
    this.buses = { weapons: bus('weapons'), movement: bus('movement'), world: bus('world'), voices: bus('voices'), blast: bus('blast'), ui: bus('ui') };

    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

    const reverb = (impulse: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>], level: number): SoundEngine['reverbs']['room'] => {
      const input = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 14000;
      const convolver = ctx.createConvolver();
      const buffer = ctx.createBuffer(2, impulse[0].length, ctx.sampleRate);
      buffer.copyToChannel(impulse[0], 0);
      buffer.copyToChannel(impulse[1], 1);
      convolver.buffer = buffer;
      const back = ctx.createGain();
      back.gain.value = level;
      input.connect(filter).connect(convolver).connect(back).connect(this.effects);
      return { input, back, filter };
    };
    this.reverbs = {
      outdoor: reverb(valleyImpulse(ctx.sampleRate, 2.4, Math.random), 1),
      room: reverb(roomImpulse(ctx.sampleRate, 0.5, 0.75, Math.random), 0.9),
      hall: reverb(roomImpulse(ctx.sampleRate, 1.5, 0.35, Math.random), 1),
    };

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
    this.applySettings();
    this.startKeepAlive();
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
    for (const source of this.wind?.sources ?? []) source.stop();
    this.wind = null;
    this.bed?.source.stop();
    this.bed = null;
    if (this.ctx instanceof AudioContext) void this.ctx.close();
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

  /** Reads the audio settings (effects volume, night mode, 3D audio) and applies them; the Settings
   * panel calls it after each change, so a running match follows at once. */
  applySettings(): void {
    this.effects.gain.value = Settings.getEffectsVolume();
    this.hrtf = Settings.getSpatialAudio();
    const dynamics = dynamicsFor(Settings.getNightAudio() ? 'night' : 'full');
    this.limiter.threshold.value = dynamics.threshold;
    this.limiter.knee.value = dynamics.knee;
    this.limiter.ratio.value = dynamics.ratio;
    this.limiter.attack.value = dynamics.attack;
    this.limiter.release.value = dynamics.release;
    this.makeup.gain.value = dynamics.makeup;
  }

  /** Where the player's head is and how it is turned, every rendered frame. Also releases the nodes
   * of voices that have finished. */
  setListener(pose: ListenerPose): void {
    this.pose = pose;
    const listener = this.ctx.listener;
    const { position: p, forward: f, up: u } = pose;
    if (listener.positionX) {
      listener.positionX.value = p.x;
      listener.positionY.value = p.y;
      listener.positionZ.value = p.z;
      listener.forwardX.value = f.x;
      listener.forwardY.value = f.y;
      listener.forwardZ.value = f.z;
      listener.upX.value = u.x;
      listener.upY.value = u.y;
      listener.upZ.value = u.z;
    } else {
      // Firefox has only the older methods.
      listener.setPosition(p.x, p.y, p.z);
      listener.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
    this.releaseFinished();
  }

  /** The world's answer to "what lies between these two points" (world/soundProbe.ts), asked once
   * for each positioned sound as it starts. */
  setWorldProbe(probe: ((listener: Vec3Like, source: Vec3Like) => Occlusion) | null): void {
    this.probe = probe;
  }

  /** Where the listener stands; the sound test page sets it directly, a match through updateAmbience. */
  setListenerSpace(space: ListenerSpace): void {
    this.space = space;
  }

  private releaseFinished(): void {
    const now = this.ctx.currentTime;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const voice = this.live[i]!;
      if (voice.until > now) continue;
      for (const node of voice.nodes) node.disconnect();
      this.live.splice(i, 1);
    }
  }

  /** The reverb a sound rings in: the space the listener stands in, except that a sound buried
   * behind a house's walls rings in its own space outside, not in the listener's room. */
  private reverbFor(blocked: number): GainNode {
    if (this.space === 'outdoor' || (this.space === 'room' && blocked >= 1)) return this.reverbs.outdoor.input;
    return this.space === 'room' ? this.reverbs.room.input : this.reverbs.hall.input;
  }

  /** Opens the path one sound event plays through, or null when it would not be heard at all (too
   * far, too buried, or too many voices already): the caller then builds nothing. */
  private open(spec: VoiceSpec): Voice | null {
    const now = this.ctx.currentTime;
    const bus = this.buses[spec.bus];
    const input = this.ctx.createGain();
    const source = spec.source;
    if (!source) {
      input.gain.value = spec.gain ?? 1;
      input.connect(bus);
      if (spec.wet) {
        const send = this.ctx.createGain();
        send.gain.value = spec.wet;
        input.connect(send).connect(this.reverbFor(0));
      }
      if (spec.duck) this.duckBy(spec.duck);
      return { input, at: now };
    }

    const relative = relativeToListener(this.pose, source);
    const loudness = LOUDNESS[spec.kind];
    const carried = distanceGain(loudness, relative.distance);
    const occlusion = this.occlusionOverride ?? (carried > SILENT_BELOW && this.probe ? this.probe(this.pose.position, source) : CLEAR);
    const gain = carried * occlusion.gain * (spec.gain ?? 1);
    if (gain < SILENT_BELOW) {
      this.stats.inaudible++;
      return null;
    }
    // Over the cap only the loud survive: a far footstep must not cost a near shot its voice.
    if (this.live.length >= MAX_SPATIAL_VOICES && gain < 0.2) {
      this.stats.overCap++;
      return null;
    }
    input.gain.value = gain;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    filter.frequency.value = Math.min(airCutoff(loudness, relative.distance), occlusion.cutoff, this.hrtf ? OPEN_CUTOFF : rearShadowCutoff(relative.front));
    const panner = this.ctx.createPanner();
    panner.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    // The loudness model is the engine's own (spatial.ts), so the panner only places the sound.
    panner.distanceModel = 'inverse';
    panner.rolloffFactor = 0;
    if (panner.positionX) {
      panner.positionX.value = source.x;
      panner.positionY.value = source.y;
      panner.positionZ.value = source.z;
    } else {
      panner.setPosition(source.x, source.y, source.z);
    }
    input.connect(filter).connect(panner).connect(bus);
    const nodes: AudioNode[] = [input, filter, panner];
    if (spec.wet) {
      const send = this.ctx.createGain();
      send.gain.value = reverbSendAt(spec.wet, carried);
      filter.connect(send).connect(this.reverbFor(occlusion.blocked));
      nodes.push(send);
    }
    const delay = spec.travels ? arrivalDelay(relative.distance) : 0;
    this.live.push({ nodes, until: now + delay + spec.life + 0.25 });
    this.stats.opened++;
    this.stats.peakLive = Math.max(this.stats.peakLive, this.live.length);
    if (spec.duck) this.duckBy(spec.duck * Math.min(1, gain * 1.5));
    return { input, at: now + delay };
  }

  /** A near blast pulls the rest of the mix down, then lets it back over about a second. */
  private duckBy(amount: number): void {
    if (amount <= 0.02) return;
    const now = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(now);
    this.duck.gain.setTargetAtTime(1 - 0.65 * Math.min(1, amount), now, 0.015);
    this.duck.gain.setTargetAtTime(1, now + 0.3, 0.45);
  }

  /** A burst of filtered noise from the shared buffer. */
  private noiseLayer(voice: Voice, layer: NoiseLayer): void {
    const start = voice.at + (layer.delay ?? 0);
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = layer.filter;
    filter.frequency.value = layer.from;
    if (layer.q !== undefined) filter.Q.value = layer.q;
    if (layer.to !== undefined) {
      filter.frequency.setValueAtTime(layer.from, start);
      filter.frequency.exponentialRampToValueAtTime(layer.to, start + layer.seconds);
    }
    source.connect(filter).connect(this.envelope(start, layer.seconds, layer.gain, layer.attack ?? 0)).connect(voice.input);
    source.start(start, Math.random() * (NOISE_SECONDS - 0.1));
    source.stop(start + layer.seconds + 0.01);
  }

  /** An oscillator, steady or gliding in pitch. */
  private toneLayer(voice: Voice, layer: ToneLayer): void {
    const start = voice.at + (layer.delay ?? 0);
    const oscillator = this.ctx.createOscillator();
    oscillator.type = layer.wave ?? 'sine';
    oscillator.frequency.setValueAtTime(layer.from, start);
    if (layer.to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(layer.to, start + layer.seconds);
    oscillator.connect(this.envelope(start, layer.seconds, layer.gain, layer.attack ?? 0)).connect(voice.input);
    oscillator.start(start);
    oscillator.stop(start + layer.seconds + 0.01);
  }

  /** Silent until `start`, up to `gain` at once (or over `attack`), then an exponential fall. */
  private envelope(start: number, seconds: number, gain: number, attack: number): GainNode {
    const envelope = this.ctx.createGain();
    envelope.gain.value = 0;
    if (attack > 0) {
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.linearRampToValueAtTime(gain, start + Math.min(attack, seconds * 0.5));
    } else {
      envelope.gain.setValueAtTime(gain, start);
    }
    envelope.gain.exponentialRampToValueAtTime(0.0008, start + seconds);
    return envelope;
  }

  // ---------------------------------------------------------------------------------------------
  // Weapons

  /**
   * A gunshot. Five layers make the report: the snap (the first millisecond), the crack (bright
   * noise whose filter closes), the bark (the band that tells one gun from another), the thump (the
   * weight of the cartridge) and the tail (the shot ringing off the world, mostly sent to the
   * reverb). `source` is where it was fired; absent for the player's own gun. From far away the
   * voice's filter leaves a dull crack and the reverb send carries most of what is left.
   */
  playGunshot(weaponId: string, source?: Vec3Like | null): void {
    const sound = GUN_SOUNDS[weaponId] ?? DEFAULT_GUN_SOUND;
    const [tailTime, tailFilter, tailGain] = sound.tail;
    const voice = this.open({ bus: 'weapons', kind: 'gunshot', source, wet: 0.24, life: Math.max(tailTime, 0.5), travels: true });
    if (!voice) return;
    // A few percent of pitch drift, so automatic fire is not one sample repeated.
    const drift = 0.95 + Math.random() * 0.1;
    const [crackTime, crackFrom, crackTo, crackGain] = sound.crack;
    const [thumpFrom, thumpTo, thumpTime, thumpGain] = sound.thump;
    const [barkHz, barkTime, barkGain] = sound.bark;
    this.noiseLayer(voice, { seconds: 0.006, filter: 'highpass', from: 5500, gain: crackGain * 0.7 });
    this.noiseLayer(voice, { seconds: crackTime, filter: 'lowpass', from: crackFrom * drift, to: crackTo * drift, gain: crackGain });
    this.noiseLayer(voice, { seconds: barkTime, filter: 'bandpass', from: barkHz * drift, to: barkHz * drift * 0.6, q: 1.4, gain: barkGain * 1.6 });
    this.toneLayer(voice, { from: thumpFrom * drift, to: thumpTo * drift, seconds: thumpTime, gain: thumpGain });
    // The heavy cartridges push air you feel: a sub under the thump.
    if (thumpGain >= 0.7) this.toneLayer(voice, { from: 62, to: 34, seconds: thumpTime * 1.4, gain: thumpGain * 0.45 });
    this.noiseLayer(voice, { seconds: tailTime, filter: 'lowpass', from: tailFilter, to: tailFilter * 0.3, gain: tailGain * 1.2, attack: 0.012 });
    if (sound.action) this.reloadStep(voice, 'rack', sound.action[1], sound.action[0]);
  }

  /** A blade through the air. `weaponId` picks the blade's own whoosh (weaponSounds.ts). */
  playKnifeSwing(weaponId = 'knife', source?: Vec3Like | null): void {
    const [seconds, from, to, gain] = BLADE_SWINGS[weaponId] ?? DEFAULT_BLADE_SWING;
    const voice = this.open({ bus: 'weapons', kind: 'blade', source, life: seconds });
    if (!voice) return;
    this.noiseLayer(voice, { seconds, filter: 'bandpass', from, to, q: 1.1, gain: gain * 1.3, attack: 0.025 });
    this.noiseLayer(voice, { seconds: seconds * 0.7, filter: 'highpass', from: 6000, gain: gain * 0.25, attack: seconds * 0.3 });
  }

  /** A blade landing on a body: a dull thud and the wet tick over it. */
  playKnifeHit(): void {
    const voice = this.open({ bus: 'weapons', kind: 'blade', life: 0.15 });
    if (!voice) return;
    this.toneLayer(voice, { from: 120, to: 70, seconds: 0.1, gain: 0.4 });
    this.noiseLayer(voice, { seconds: 0.03, filter: 'bandpass', from: 2400, q: 0.8, gain: 0.28 });
    this.noiseLayer(voice, { seconds: 0.07, filter: 'lowpass', from: 700, gain: 0.25 });
  }

  /** An enemy's melee swing: heavier and lower than a knife, so it reads as a body moving. */
  playMeleeSwing(source: Vec3Like): void {
    const voice = this.open({ bus: 'weapons', kind: 'blade', source, life: 0.32 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.28, filter: 'bandpass', from: 1500, to: 320, q: 0.9, gain: 0.5, attack: 0.04 });
    this.noiseLayer(voice, { seconds: 0.09, filter: 'lowpass', from: 420, gain: 0.3, delay: 0.16 });
  }

  /** The whole reload, scheduled now: each step of the weapon's reload (magazine out, magazine in,
   * the action racked) at its moment in the weapon's reload time. */
  playReloadClick(weaponId: string): void {
    const reloadTime = WEAPON_DEFINITIONS[weaponId]?.reloadTime ?? 1.5;
    const voice = this.open({ bus: 'weapons', kind: 'small', wet: 0.06, life: reloadTime + 0.3 });
    if (!voice) return;
    for (const [fraction, step] of reloadSteps(weaponId)) this.reloadStep(voice, step, 1, fraction * reloadTime);
  }

  /** One mechanical sound of a reload. Metal has a pitch: each step is a noise transient with a
   * short ring under it, lower for the heavier part. */
  private reloadStep(voice: Voice, step: ReloadStep, scale: number, delay: number): void {
    const noise = (seconds: number, filter: BiquadFilterType, from: number, gain: number, after = 0): void =>
      this.noiseLayer(voice, { seconds, filter, from, q: 1.2, gain: gain * scale, delay: delay + after });
    const ring = (from: number, seconds: number, gain: number, after = 0): void =>
      this.toneLayer(voice, { from, seconds, gain: gain * scale, wave: 'triangle', delay: delay + after });
    switch (step) {
      case 'out':
        noise(0.03, 'highpass', 3400, 0.16);
        noise(0.07, 'bandpass', 620, 0.2, 0.03);
        ring(1250, 0.04, 0.03, 0.005);
        break;
      case 'in':
        noise(0.07, 'lowpass', 900, 0.3);
        noise(0.022, 'highpass', 3800, 0.2, 0.035);
        ring(820, 0.05, 0.04, 0.035);
        break;
      case 'shell':
        noise(0.05, 'bandpass', 1300, 0.24);
        ring(540, 0.05, 0.035);
        break;
      case 'rack':
        noise(0.045, 'bandpass', 2600, 0.26);
        noise(0.05, 'bandpass', 3200, 0.3, 0.09);
        ring(1900, 0.06, 0.035, 0.09);
        ring(2850, 0.04, 0.02, 0.092);
        break;
      default:
        noise(0.028, 'highpass', 3000, 0.18);
        ring(2300, 0.03, 0.025);
    }
  }

  /** A spent case landing by the shooter's feet: two or three small brass notes. Silent on earth
   * (grass swallows it) and never more often than CASING_GAP. */
  playCasing(surface: Surface): void {
    const now = this.ctx.currentTime;
    if (surface === 'earth' || surface === 'flesh' || now - this.lastCasingAt < CASING_GAP) return;
    this.lastCasingAt = now;
    const voice = this.open({ bus: 'weapons', kind: 'small', wet: 0.08, life: 0.9 });
    if (!voice) return;
    const pitch = (surface === 'metal' ? 1.15 : 1) * (0.9 + Math.random() * 0.2);
    let delay = 0.34 + Math.random() * 0.14;
    for (let bounce = 0; bounce < 3; bounce++) {
      const gain = 0.035 / (bounce + 1);
      this.toneLayer(voice, { from: 4300 * pitch, seconds: 0.035, gain, wave: 'triangle', delay });
      this.toneLayer(voice, { from: 6150 * pitch, seconds: 0.025, gain: gain * 0.6, delay });
      delay += 0.07 + Math.random() * 0.05 - bounce * 0.015;
    }
  }

  /** A bullet passing close: a short tearing hiss that falls in pitch as it goes by, placed at the
   * point of the bullet's path nearest the listener. */
  playBulletWhizz(source: Vec3Like): void {
    const voice = this.open({ bus: 'weapons', kind: 'impact', source, life: 0.2 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.16, filter: 'bandpass', from: 4200, to: 900, q: 3.5, gain: 0.9, attack: 0.012 });
    this.noiseLayer(voice, { seconds: 0.03, filter: 'highpass', from: 6500, gain: 0.3 });
  }

  /**
   * A bullet striking a surface (docs/sound.md): earth thuds and hisses, wood knocks and splinters,
   * metal pings, concrete cracks and scatters grit, glass ticks, a body thuds.
   */
  playImpact(surface: Surface, source: Vec3Like): void {
    const voice = this.open({ bus: 'world', kind: 'impact', source, wet: 0.08, life: 0.4 });
    if (!voice) return;
    const pitch = 0.88 + Math.random() * 0.24;
    switch (surface) {
      case 'earth':
        this.toneLayer(voice, { from: 150 * pitch, to: 60, seconds: 0.07, gain: 0.4 });
        this.noiseLayer(voice, { seconds: 0.14, filter: 'bandpass', from: 1400 * pitch, to: 500, q: 0.7, gain: 0.3, attack: 0.004 });
        break;
      case 'wood':
        this.toneLayer(voice, { from: 330 * pitch, to: 150, seconds: 0.06, gain: 0.45, wave: 'triangle' });
        this.noiseLayer(voice, { seconds: 0.035, filter: 'bandpass', from: 2100 * pitch, q: 1.5, gain: 0.4 });
        this.noiseLayer(voice, { seconds: 0.08, filter: 'highpass', from: 3500, gain: 0.08, delay: 0.02 });
        break;
      case 'metal':
        this.noiseLayer(voice, { seconds: 0.012, filter: 'highpass', from: 4000, gain: 0.5 });
        this.toneLayer(voice, { from: 2300 * pitch, seconds: 0.22, gain: 0.16, wave: 'triangle' });
        this.toneLayer(voice, { from: 3740 * pitch, seconds: 0.16, gain: 0.1 });
        this.toneLayer(voice, { from: 5480 * pitch, seconds: 0.1, gain: 0.06 });
        break;
      case 'concrete':
        this.noiseLayer(voice, { seconds: 0.03, filter: 'highpass', from: 2800 * pitch, gain: 0.5 });
        this.toneLayer(voice, { from: 210 * pitch, to: 110, seconds: 0.04, gain: 0.25 });
        this.noiseLayer(voice, { seconds: 0.16, filter: 'bandpass', from: 1700 * pitch, to: 900, q: 0.8, gain: 0.16, delay: 0.015 });
        break;
      case 'glass':
        this.noiseLayer(voice, { seconds: 0.01, filter: 'highpass', from: 6000, gain: 0.4 });
        this.toneLayer(voice, { from: 5200 * pitch, seconds: 0.06, gain: 0.12 });
        this.toneLayer(voice, { from: 7300 * pitch, seconds: 0.04, gain: 0.07 });
        break;
      default:
        this.toneLayer(voice, { from: 130 * pitch, to: 70, seconds: 0.08, gain: 0.4 });
        this.noiseLayer(voice, { seconds: 0.04, filter: 'lowpass', from: 900, gain: 0.25 });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Movement

  /**
   * A footstep on `surface` (docs/sound.md): a heel thud whose weight follows the ground, and that
   * ground's own texture over it (earth crunches, wood knocks, concrete ticks, metal rings, broken
   * glass grinds). `pace` makes a run harder and shorter than a walk; `heavy` is an enemy's boot.
   * `source` is absent for the player's own feet.
   */
  playFootstep(surface: Surface = 'earth', pace: 'walk' | 'run' = 'run', source?: Vec3Like | null, heavy = false): void {
    const voice = this.open({ bus: 'movement', kind: 'footstep', source, wet: 0.05, life: 0.25 });
    if (!voice) return;
    const [thudHz, thudGain, textureHz, textureGain, textureTime] = STEP_SURFACES[surface];
    const force = (pace === 'run' ? 1 : 0.62) * (heavy ? 1.25 : 1);
    const pitch = (0.9 + Math.random() * 0.2) * (heavy ? 0.82 : 1);
    this.noiseLayer(voice, { seconds: pace === 'run' ? 0.055 : 0.075, filter: 'lowpass', from: thudHz * pitch, gain: 0.34 * thudGain * force });
    this.toneLayer(voice, { from: 95 * pitch, to: 55, seconds: 0.05, gain: 0.12 * thudGain * force });
    this.noiseLayer(voice, { seconds: textureTime, filter: 'bandpass', from: textureHz * pitch, q: surface === 'earth' ? 0.6 : 1.6, gain: 0.2 * textureGain * force, delay: 0.006 });
    if (surface === 'wood') this.toneLayer(voice, { from: 165 * pitch, seconds: 0.07, gain: 0.07 * force, wave: 'triangle' });
    if (surface === 'metal') {
      this.toneLayer(voice, { from: 410 * pitch, seconds: 0.14, gain: 0.035 * force, wave: 'triangle' });
      this.toneLayer(voice, { from: 1130 * pitch, seconds: 0.09, gain: 0.02 * force });
    }
    if (surface === 'glass') {
      for (let grain = 0; grain < 3; grain++) {
        this.noiseLayer(voice, { seconds: 0.02, filter: 'highpass', from: 5000 + Math.random() * 2500, gain: 0.12 * force, delay: 0.02 + Math.random() * 0.07 });
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Interface and the player's own body

  /** A teammate's ping (docs/coop.md): one short high note, quieter than an objective's cue. */
  playPing(): void {
    const voice = this.open({ bus: 'ui', kind: 'small', life: 0.25 });
    if (!voice) return;
    this.toneLayer(voice, { from: 988, seconds: 0.09, gain: 0.1 });
    this.toneLayer(voice, { from: 1319, seconds: 0.12, gain: 0.08, delay: 0.07 });
  }

  /** A short cue for a change in an objective: `gain` rises (your side took something), `lose`
   * falls (the other side did), `alert` is three even pips (the objective itself changed). */
  playObjectiveCue(kind: 'gain' | 'lose' | 'alert'): void {
    const voice = this.open({ bus: 'ui', kind: 'small', life: 0.5 });
    if (!voice) return;
    const notes = kind === 'gain' ? [523, 784] : kind === 'lose' ? [440, 294] : [660, 660, 660];
    notes.forEach((frequency, i) => this.toneLayer(voice, { from: frequency, seconds: 0.12, gain: 0.16, wave: 'triangle', delay: i * 0.11 }));
  }

  /** The torch's switch (docs/facility-map.md, section 7): a short mechanical click, a touch higher
   * switching on than off. */
  playTorchClick(on: boolean): void {
    const voice = this.open({ bus: 'ui', kind: 'small', life: 0.06 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.018, filter: 'highpass', from: 4200, gain: 0.14 });
    this.toneLayer(voice, { from: on ? 1900 : 1500, seconds: 0.025, gain: 0.05, wave: 'square' });
  }

  /** The shot landed on someone: a short bright tick, kept apart from every world sound on purpose. */
  playHitConfirm(): void {
    const voice = this.open({ bus: 'ui', kind: 'small', life: 0.08 });
    if (!voice) return;
    this.toneLayer(voice, { from: 1100, seconds: 0.055, gain: 0.2 });
    this.toneLayer(voice, { from: 1650, seconds: 0.03, gain: 0.07 });
  }

  /** A pickup taken (docs/pickups.md): a short two-note chime, rising for health, a metal clack for
   * ammo and a heavier double clunk for a grenade crate. */
  playPickup(kind: 'health' | 'ammo' | 'grenade'): void {
    const voice = this.open({ bus: 'ui', kind: 'small', life: 0.3 });
    if (!voice) return;
    if (kind === 'health') {
      this.toneLayer(voice, { from: 660, seconds: 0.09, gain: 0.12 });
      this.toneLayer(voice, { from: 990, seconds: 0.16, gain: 0.12, delay: 0.08 });
    } else if (kind === 'ammo') {
      this.noiseLayer(voice, { seconds: 0.03, filter: 'highpass', from: 3000, gain: 0.14 });
      this.toneLayer(voice, { from: 420, seconds: 0.06, gain: 0.1, wave: 'square', delay: 0.03 });
    } else {
      this.noiseLayer(voice, { seconds: 0.05, filter: 'bandpass', from: 1200, gain: 0.18 });
      this.toneLayer(voice, { from: 180, seconds: 0.1, gain: 0.14, wave: 'triangle' });
      this.toneLayer(voice, { from: 240, seconds: 0.1, gain: 0.12, wave: 'triangle', delay: 0.07 });
    }
  }

  /** The player is hit: a body thud and a low growl, in the middle of the head. */
  playPlayerHurt(): void {
    const voice = this.open({ bus: 'ui', kind: 'small', life: 0.2 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.15, filter: 'lowpass', from: 260, gain: 0.4 });
    this.toneLayer(voice, { from: 150, to: 90, seconds: 0.15, gain: 0.3, wave: 'sawtooth' });
    this.noiseLayer(voice, { seconds: 0.02, filter: 'bandpass', from: 1800, gain: 0.12 });
  }

  // ---------------------------------------------------------------------------------------------
  // The world

  /** A Facility lamp shot out (docs/facility-map.md, section 11): breaking glass (a bright crack and
   * a few falling tinkles) over an electrical fizz and a short mains buzz. */
  playLampBreak(source: Vec3Like): void {
    const voice = this.open({ bus: 'world', kind: 'world', source, wet: 0.12, life: 0.5 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.09, filter: 'highpass', from: 5200, gain: 0.32 });
    for (const [frequency, delay] of [[3400, 0.03], [4700, 0.08], [2900, 0.14], [5600, 0.21]] as const) {
      this.toneLayer(voice, { from: frequency, seconds: 0.07, gain: 0.05, delay });
    }
    this.noiseLayer(voice, { seconds: 0.45, filter: 'bandpass', from: 2400, to: 700, gain: 0.16, attack: 0.01 });
    this.toneLayer(voice, { from: 120, seconds: 0.3, gain: 0.06, wave: 'sawtooth' });
  }

  /** A round through a pane (docs/glass.md): the tick of the hole and the creak of cracks running. */
  playGlassHit(source: Vec3Like): void {
    const voice = this.open({ bus: 'world', kind: 'impact', source, wet: 0.08, life: 0.3 });
    if (!voice) return;
    const pitch = 0.9 + Math.random() * 0.25;
    this.noiseLayer(voice, { seconds: 0.012, filter: 'highpass', from: 5500, gain: 0.6 });
    this.toneLayer(voice, { from: 4800 * pitch, seconds: 0.07, gain: 0.14 });
    this.toneLayer(voice, { from: 6900 * pitch, seconds: 0.05, gain: 0.08 });
    for (let crack = 0; crack < 3; crack++) {
      this.noiseLayer(voice, { seconds: 0.014, filter: 'bandpass', from: 3600 + Math.random() * 2600, q: 4, gain: 0.3, delay: 0.03 + Math.random() * 0.14 });
    }
  }

  /** A pane giving way (docs/glass.md): the crash, the body of the sheet going, then shards landing
   * and settling over the next second. */
  playGlassBreak(source: Vec3Like): void {
    const voice = this.open({ bus: 'world', kind: 'world', source, wet: 0.16, life: 1.5 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.2, filter: 'highpass', from: 3600, gain: 0.75 });
    this.noiseLayer(voice, { seconds: 0.32, filter: 'bandpass', from: 2200, to: 900, q: 0.8, gain: 0.4, attack: 0.004 });
    this.toneLayer(voice, { from: 190, to: 90, seconds: 0.08, gain: 0.22 });
    for (let shard = 0; shard < 14; shard++) {
      const delay = 0.04 + Math.pow(Math.random(), 1.6) * 1.1;
      const frequency = 2600 + Math.random() * 4800;
      const gain = 0.11 * (1 - delay * 0.55);
      this.toneLayer(voice, { from: frequency, seconds: 0.05 + Math.random() * 0.05, gain, wave: shard % 3 === 0 ? 'triangle' : 'sine', delay });
      if (shard % 2 === 0) this.noiseLayer(voice, { seconds: 0.012, filter: 'highpass', from: 6000, gain: gain * 1.6, delay });
    }
  }

  /** A Facility door's two steel leaves sliding (docs/facility-map.md, section 12): a filtered
   * rumble over the 0.6 s travel, a low motor whine, and a thud as the leaves meet or stop. */
  playDoorSlide(closing: boolean, source: Vec3Like): void {
    const voice = this.open({ bus: 'world', kind: 'world', source, wet: 0.1, life: 0.8 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.6, filter: 'bandpass', from: 900, to: 420, gain: 0.2, attack: 0.08 });
    this.toneLayer(voice, { from: closing ? 110 : 80, to: closing ? 80 : 110, seconds: 0.55, gain: 0.05, wave: 'sawtooth', attack: 0.08 });
    this.toneLayer(voice, { from: closing ? 55 : 70, seconds: 0.16, gain: 0.22, delay: 0.56 });
    this.noiseLayer(voice, { seconds: 0.03, filter: 'bandpass', from: 1400, gain: 0.12, delay: 0.56 });
  }

  /** A breaker lever thrown (section 12): a heavy clunk, then mains hum winding down when the zone
   * loses power or up when it comes back. */
  playBreakerSwitch(on: boolean, source: Vec3Like): void {
    const voice = this.open({ bus: 'world', kind: 'world', source, wet: 0.1, life: 1.6 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.08, filter: 'lowpass', from: 650, gain: 0.45 });
    this.toneLayer(voice, { from: 90, seconds: 0.12, gain: 0.28, wave: 'square' });
    if (on) this.toneLayer(voice, { from: 35, to: 100, seconds: 0.7, gain: 0.07, wave: 'sawtooth', attack: 0.08, delay: 0.05 });
    else this.toneLayer(voice, { from: 100, to: 30, seconds: 1.4, gain: 0.08, wave: 'sawtooth', attack: 0.08, delay: 0.05 });
  }

  // ---------------------------------------------------------------------------------------------
  // Explosions and grenades

  /** A goose going off: a crack, a low roar and a sub thump. Lighter than a frag (playFragExplosion). */
  playExplosion(source?: Vec3Like | null): void {
    const voice = this.open({ bus: 'blast', kind: 'explosion', source, wet: 0.45, life: 0.9, travels: true, duck: 0.6 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.04, filter: 'highpass', from: 2400, gain: 0.4 });
    this.noiseLayer(voice, { seconds: 0.55, filter: 'lowpass', from: 900, to: 160, gain: 0.9 });
    this.toneLayer(voice, { from: 85, to: 40, seconds: 0.4, gain: 0.6 });
    this.toneLayer(voice, { from: 70, seconds: 0.3, gain: 0.25, wave: 'sawtooth' });
  }

  /** The pin coming out as a cook starts (docs/grenades.md): a sharp metallic tick and the ring's ping. */
  playGrenadePin(): void {
    const voice = this.open({ bus: 'weapons', kind: 'small', life: 0.12 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.02, filter: 'highpass', from: 5200, gain: 0.16 });
    this.toneLayer(voice, { from: 2350, seconds: 0.06, gain: 0.05, wave: 'triangle' });
    this.toneLayer(voice, { from: 3100, seconds: 0.05, gain: 0.03, delay: 0.035 });
  }

  /** A grenade leaving the hand: a short rising whoosh. */
  playGrenadeThrow(source?: Vec3Like | null): void {
    const voice = this.open({ bus: 'weapons', kind: 'blade', source, life: 0.3 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.24, filter: 'bandpass', from: 700, to: 2400, gain: 0.3, attack: 0.05 });
  }

  /** A grenade hitting something; `strength` (0 to 1) is how hard. Two bright, slightly random
   * partials, so a run of bounces does not repeat one note; off glass it rings higher and thinner. */
  playGrenadeBounce(strength: number, source: Vec3Like, onGlass = false): void {
    const voice = this.open({ bus: 'world', kind: 'small', source, gain: Math.max(0, Math.min(1, strength)), wet: 0.06, life: 0.12 });
    if (!voice) return;
    const pitch = (1 + (Math.random() - 0.5) * 0.25) * (onGlass ? 1.5 : 1);
    this.noiseLayer(voice, { seconds: 0.025, filter: 'highpass', from: 3600, gain: 0.3 });
    this.toneLayer(voice, { from: 2700 * pitch, seconds: 0.07, gain: 0.22, wave: 'triangle' });
    this.toneLayer(voice, { from: 4150 * pitch, seconds: 0.05, gain: 0.11, delay: 0.004 });
    if (!onGlass) this.toneLayer(voice, { from: 240, to: 120, seconds: 0.04, gain: 0.2 });
  }

  /** A frag going off: heavier and longer than a goose (playExplosion), a crack on top, a deep sub
   * thump, a falling roar and debris landing after. */
  playFragExplosion(source: Vec3Like): void {
    const voice = this.open({ bus: 'blast', kind: 'explosion', source, wet: 0.55, life: 1.6, travels: true, duck: 1 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.07, filter: 'highpass', from: 2800, gain: 0.55 });
    this.noiseLayer(voice, { seconds: 1.1, filter: 'lowpass', from: 1100, to: 110, gain: 0.95 });
    this.toneLayer(voice, { from: 60, to: 32, seconds: 0.75, gain: 0.75 });
    this.toneLayer(voice, { from: 74, seconds: 0.45, gain: 0.4, wave: 'sawtooth' });
    this.noiseLayer(voice, { seconds: 0.7, filter: 'bandpass', from: 2300, to: 900, gain: 0.1, attack: 0.012, delay: 0.12 });
    for (let debris = 0; debris < 7; debris++) {
      this.noiseLayer(voice, { seconds: 0.03, filter: 'bandpass', from: 900 + Math.random() * 2400, q: 2, gain: 0.07, delay: 0.35 + Math.random() * 0.9 });
    }
  }

  /** A flash going off: a sharp, bright crack with little body, and a high ring after it. */
  playFlashBang(source: Vec3Like): void {
    const voice = this.open({ bus: 'blast', kind: 'explosion', source, wet: 0.5, life: 1.2, travels: true, duck: 0.8 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.05, filter: 'highpass', from: 2400, gain: 1 });
    this.noiseLayer(voice, { seconds: 0.3, filter: 'lowpass', from: 1500, to: 300, gain: 0.45 });
    this.toneLayer(voice, { from: 150, seconds: 0.12, gain: 0.35, wave: 'square' });
    this.toneLayer(voice, { from: 4300, seconds: 1.1, gain: 0.07, delay: 0.02 });
    this.toneLayer(voice, { from: 3650, seconds: 0.8, gain: 0.05, delay: 0.02 });
  }

  // ---------------------------------------------------------------------------------------------
  // Voices

  /** An enemy callout (enemy AI v2 step 5): a short radio click, then a chirp whose shape carries
   * the meaning (CALLOUT_PATTERNS). Quieter than a gunshot on purpose: it informs, it should not
   * startle. */
  playCallout(kind: CalloutSound, source: Vec3Like): void {
    const voice = this.open({ bus: 'voices', kind: 'voice', source, wet: 0.1, life: 0.35 });
    if (!voice) return;
    this.noiseLayer(voice, { seconds: 0.04, filter: 'bandpass', from: 1800, gain: 0.14 });
    for (const [frequency, offset] of CALLOUT_PATTERNS[kind]) {
      this.toneLayer(voice, { from: frequency, seconds: 0.08, gain: 0.2, wave: 'square', delay: 0.04 + offset });
    }
  }

  /** The Ridge Walker's scope glint (step 5): a faint, high "ting" to go with the visual flash, so a
   * player looking elsewhere still gets the warning. It is a warning, so it keeps a gunshot's reach. */
  playGlint(source: Vec3Like): void {
    const voice = this.open({ bus: 'voices', kind: 'gunshot', source, life: 0.15 });
    if (!voice) return;
    this.toneLayer(voice, { from: 2600, seconds: 0.12, gain: 0.12 });
    this.toneLayer(voice, { from: 3900, seconds: 0.08, gain: 0.06, delay: 0.02 });
  }

  // ---------------------------------------------------------------------------------------------
  // Flash deafness, ambience and music

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
    if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /**
   * The standing layers, called every simulation tick: the reverb follows the space the listener
   * stands in, the wind follows it too (docs/sound.md), the combat music follows the pacing
   * director's phase and intensity (ambience.ts musicMix), and a heartbeat comes in at low health.
   * Music and heartbeat fade out while the game is paused, the player is dead or an end screen is
   * up. Ticks and beats are booked slightly ahead on the audio clock, so frame hitches never make
   * them stutter.
   */
  updateAmbience(state: AmbienceInputs): void {
    const now = this.ctx.currentTime;
    this.space = state.space;
    // Underground the hall's return is longer on the ear and darker: the lab's own feel.
    const buried = Math.max(0, Math.min(1, state.undergroundAmount));
    this.reverbs.hall.back.gain.setTargetAtTime(1 + 0.6 * buried, now, 0.1);
    this.reverbs.hall.filter.frequency.setTargetAtTime(9000 - 6500 * buried, now, 0.1);

    const wind = windLevel(state.outdoor, state.space);
    const windGain = state.active ? wind.gain * (1 - buried) : 0;
    if (!this.wind && windGain > 0) this.wind = this.buildWind();
    if (this.wind) {
      this.wind.gain.gain.setTargetAtTime(WIND_LEVEL * windGain, now, 0.35);
      this.wind.filter.frequency.setTargetAtTime(wind.cutoff, now, 0.35);
    }

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
      this.scheduledTone(58, at, 0.12, 0.55 * beat.gain, 'sine', this.buses.ui);
      this.scheduledTone(49, at + 0.17, 0.11, 0.38 * beat.gain, 'sine', this.buses.ui);
      this.nextBeatTime += 60 / beat.bpm;
    }
  }

  private loopingNoise(): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    return source;
  }

  /** The wind over the valley: low filtered noise whose level and colour drift slowly, so it is
   * never a steady hiss. Its filter is what closes when the listener walks indoors. */
  private buildWind(): WindNodes {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.buses.world);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.4;
    const gust = this.ctx.createGain();
    gust.gain.value = 0.7;
    const noise = this.loopingNoise();
    noise.connect(filter).connect(gust).connect(gain);
    noise.start();
    const sources: WindNodes['sources'] = [noise];
    // Two slow, unrelated drifts: one on the level (gusts), one on the colour.
    for (const [rate, depth, target] of [[0.07, 0.3, gust.gain], [0.031, 180, filter.detune]] as const) {
      const drift = this.ctx.createOscillator();
      drift.frequency.value = rate;
      const amount = this.ctx.createGain();
      amount.gain.value = depth;
      drift.connect(amount).connect(target);
      drift.start();
      sources.push(drift);
    }
    return { sources, gain, filter };
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
    padSend.gain.value = 0.35 * MUSIC_LEVEL;
    padGain.connect(padSend).connect(this.reverbs.outdoor.input);

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
    const source = this.loopingNoise();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter).connect(envelope).connect(destination);
    source.start(start, Math.random() * (NOISE_SECONDS - 0.1));
    source.stop(start + duration);
  }
}
