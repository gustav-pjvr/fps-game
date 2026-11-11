/**
 * The pure rules of the spatial sound engine (docs/sound.md): how loud a kind of sound is at a
 * distance, how dull the air makes it, how long it takes to arrive, and where a source sits relative
 * to the listener's head. SoundEngine turns these numbers into Web Audio nodes; nothing here touches
 * audio, so every rule has a unit test.
 */

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** How one kind of sound carries. Gain is 1 inside `refDistance`, then falls as inverse distance. */
export interface Loudness {
  /** Metres within which the sound plays at its full level. */
  readonly refDistance: number;
  /** How fast it falls past the reference distance: 1 is the physical inverse law. */
  readonly rolloff: number;
  /** Metres at which a sound without a floor is gone. A sound with a floor carries on at the floor. */
  readonly maxDistance: number;
  /** The gain it never drops below (0 for sounds that may go silent). A gunshot keeps a floor: a
   * shot that can still hurt must still be heard. */
  readonly floor: number;
  /** Metres over which the air halves the brightest frequency that survives. */
  readonly airHalving: number;
}

export type LoudnessKind = 'gunshot' | 'explosion' | 'footstep' | 'voice' | 'world' | 'impact' | 'small' | 'blade';

export const LOUDNESS: Readonly<Record<LoudnessKind, Loudness>> = {
  gunshot: { refDistance: 8, rolloff: 1, maxDistance: 400, floor: 0.05, airHalving: 30 },
  explosion: { refDistance: 10, rolloff: 1, maxDistance: 500, floor: 0.05, airHalving: 45 },
  footstep: { refDistance: 2, rolloff: 1.1, maxDistance: 32, floor: 0, airHalving: 22 },
  voice: { refDistance: 5, rolloff: 1, maxDistance: 70, floor: 0, airHalving: 40 },
  world: { refDistance: 4, rolloff: 1, maxDistance: 60, floor: 0, airHalving: 35 },
  impact: { refDistance: 2.5, rolloff: 1, maxDistance: 45, floor: 0, airHalving: 30 },
  small: { refDistance: 1.5, rolloff: 1.2, maxDistance: 25, floor: 0, airHalving: 20 },
  blade: { refDistance: 2, rolloff: 1.2, maxDistance: 15, floor: 0, airHalving: 25 },
};

/** The share of `maxDistance` over which a sound without a floor fades from its curve to nothing. */
const FADE_OUT_SHARE = 0.25;

/** Gain for a sound of this kind at `distance` metres: full inside the reference distance, inverse
 * distance beyond it, never under the floor, and (with no floor) eased to silence at the maximum. */
export function distanceGain(loudness: Loudness, distance: number): number {
  const d = Math.max(0, distance);
  if (d <= loudness.refDistance) return 1;
  const inverse = loudness.refDistance / (loudness.refDistance + loudness.rolloff * (d - loudness.refDistance));
  if (loudness.floor > 0) return Math.max(loudness.floor, inverse);
  if (d >= loudness.maxDistance) return 0;
  const fadeStart = loudness.maxDistance * (1 - FADE_OUT_SHARE);
  if (d <= fadeStart) return inverse;
  const t = (loudness.maxDistance - d) / (loudness.maxDistance - fadeStart);
  return inverse * t * t * (3 - 2 * t);
}

/** The highest frequency the air lets through, wide open up close. */
export const OPEN_CUTOFF = 20000;
/** Even the farthest sound keeps this much: below it a crack stops reading as a shot at all. */
export const MIN_AIR_CUTOFF = 650;

/** Low-pass cutoff (Hz) for a sound heard from `distance` metres: highs die first with distance, so
 * a far rifle is a dull crack rather than a quiet copy of the near one. */
export function airCutoff(loudness: Loudness, distance: number): number {
  const beyond = Math.max(0, distance - loudness.refDistance);
  return Math.max(MIN_AIR_CUTOFF, OPEN_CUTOFF * Math.pow(0.5, beyond / loudness.airHalving));
}

/** Metres a second. */
export const SPEED_OF_SOUND = 343;
/** Sounds nearer than this arrive at once: a delay on a close shot only reads as lag. */
export const ARRIVAL_DELAY_FROM = 20;
/** The longest a sound is held back, however far away it started. */
export const ARRIVAL_DELAY_CAP = 0.4;

/** Seconds a loud, far sound (a shot, a blast) takes to reach the listener. */
export function arrivalDelay(distance: number): number {
  if (distance <= ARRIVAL_DELAY_FROM) return 0;
  return Math.min(ARRIVAL_DELAY_CAP, (distance - ARRIVAL_DELAY_FROM) / SPEED_OF_SOUND);
}

/** How much more of a sound goes to the reverb as it gets farther: a distant shot is mostly its
 * ring off the valley, a close one mostly itself. `base` is the send up close; it grows up to four
 * times with distance, so a sound that barely rings up close (a footstep) still barely rings far
 * away and keeps its direction. */
export function reverbSendAt(base: number, gain: number): number {
  return Math.max(0, Math.min(1, base * (1 + 3 * (1 - Math.max(0, Math.min(1, gain))))));
}

export interface ListenerPose {
  readonly position: Vec3Like;
  /** Unit vector the head faces. */
  readonly forward: Vec3Like;
  /** Unit vector out of the top of the head. */
  readonly up: Vec3Like;
}

/** Where a source is from the listener's head, as unit-direction parts and a distance. */
export interface RelativeSource {
  /** -1 fully left to 1 fully right. */
  readonly right: number;
  /** -1 straight below to 1 straight above. */
  readonly up: number;
  /** -1 straight behind to 1 straight ahead. */
  readonly front: number;
  readonly distance: number;
}

const cross = (a: Vec3Like, b: Vec3Like): Vec3Like => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: Vec3Like, b: Vec3Like): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** The source in the listener's own frame. A source on top of the listener is "straight ahead". */
export function relativeToListener(listener: ListenerPose, source: Vec3Like): RelativeSource {
  const offset = { x: source.x - listener.position.x, y: source.y - listener.position.y, z: source.z - listener.position.z };
  const distance = Math.hypot(offset.x, offset.y, offset.z);
  if (distance < 1e-4) return { right: 0, up: 0, front: 1, distance: 0 };
  const rightAxis = cross(listener.forward, listener.up);
  return {
    right: dot(offset, rightAxis) / distance,
    up: dot(offset, listener.up) / distance,
    front: dot(offset, listener.forward) / distance,
    distance,
  };
}

/** A head's forward and up vectors from its orientation quaternion (three's camera convention: it
 * looks down its own -Z with +Y up). */
export function poseFromQuaternion(position: Vec3Like, q: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }): ListenerPose {
  const rotate = (v: Vec3Like): Vec3Like => {
    // v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
    const inner = cross(q, v);
    const t = { x: inner.x + q.w * v.x, y: inner.y + q.w * v.y, z: inner.z + q.w * v.z };
    const outer = cross(q, t);
    return { x: v.x + 2 * outer.x, y: v.y + 2 * outer.y, z: v.z + 2 * outer.z };
  };
  return { position, forward: rotate({ x: 0, y: 0, z: -1 }), up: rotate({ x: 0, y: 1, z: 0 }) };
}

/** The cutoff a sound from straight behind is held to when HRTF is off: plain stereo panning cannot
 * tell front from back, so the rear is made duller, the way the outer ear does it. */
export const REAR_CUTOFF = 3200;
/** With HRTF on the ear model already colours the rear; a lighter shadow backs it up, because a
 * generic ear model alone is often heard front to back. */
export const REAR_CUTOFF_HRTF = 8000;

/** Low-pass cutoff (Hz) standing in for the ear's shadow: open ahead and to the sides, closing to
 * `rear` as the source moves behind the head. */
export function rearShadowCutoff(front: number, rear = REAR_CUTOFF): number {
  if (front >= 0) return OPEN_CUTOFF;
  const behind = Math.min(1, -front);
  return OPEN_CUTOFF * Math.pow(rear / OPEN_CUTOFF, behind);
}
