/** Part animation for weapon models: small keyframe tracks that offset a part from its rest pose.
 * Pure data and pure sampling, so a weapon's moves are written next to its geometry and tested
 * without a renderer. */

/** One key on a track. `p` is a position offset in gun space (x right, y up, f forward), `r` a
 * rotation offset in radians: pitch (front up), yaw (front right), roll (top right). Missing
 * values hold the previous key's. */
export interface PartKey {
  /** Time, in the clip's own unit (seconds, or 0 to 1 for a reload). */
  readonly t: number;
  readonly p?: readonly [x: number, y: number, f: number];
  readonly r?: readonly [pitch: number, yaw: number, roll: number];
  /** How the value arrives at this key from the one before: eased (default) or straight. */
  readonly ease?: 'smooth' | 'linear' | 'in' | 'out';
}

/** Tracks by part name. The name `gun` moves the whole view model (a reload's tilt, an inspect). */
export type ClipTracks = Readonly<Record<string, readonly PartKey[]>>;

export interface Clip {
  /** Length in seconds. A reload clip is stretched over the weapon's reload time instead, with
   * key times running 0 to 1. */
  readonly duration: number;
  readonly tracks: ClipTracks;
}

export interface WeaponAnimations {
  /** Plays from each shot: the slide, bolt or pump cycling. Must end before the next shot. */
  readonly fire?: Clip;
  /** Key times 0 to 1 across the reload. */
  readonly reload?: Clip;
  /** The weapon's own part moves during an inspect (a press check, a cylinder swing). The skin
   * adds the whole-gun turn. */
  readonly inspect?: Clip;
  /** Played once when the weapon is drawn. */
  readonly draw?: Clip;
}

export const GUN_TRACK = 'gun';

export interface PartOffset {
  px: number; py: number; pf: number;
  pitch: number; yaw: number; roll: number;
}

export function zeroOffset(): PartOffset {
  return { px: 0, py: 0, pf: 0, pitch: 0, yaw: 0, roll: 0 };
}

function eased(t: number, ease: PartKey['ease']): number {
  if (ease === 'linear') return t;
  if (ease === 'in') return t * t;
  if (ease === 'out') return 1 - (1 - t) * (1 - t);
  return t * t * (3 - 2 * t);
}

/** The offset a track gives at time `t`. Before the first key and after the last it holds them. */
export function sampleTrack(keys: readonly PartKey[], t: number, out: PartOffset = zeroOffset()): PartOffset {
  let px = 0, py = 0, pf = 0, pitch = 0, yaw = 0, roll = 0;
  let fromT = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const tx = key.p ? key.p[0] : px, ty = key.p ? key.p[1] : py, tf = key.p ? key.p[2] : pf;
    const tp = key.r ? key.r[0] : pitch, tw = key.r ? key.r[1] : yaw, tr = key.r ? key.r[2] : roll;
    if (t >= key.t || i === 0) {
      if (t >= key.t) {
        px = tx; py = ty; pf = tf; pitch = tp; yaw = tw; roll = tr;
        fromT = key.t;
        continue;
      }
      // Before the first key: hold it.
      px = tx; py = ty; pf = tf; pitch = tp; yaw = tw; roll = tr;
      break;
    }
    const span = key.t - fromT;
    const k = span > 1e-9 ? eased((t - fromT) / span, key.ease) : 1;
    px += (tx - px) * k; py += (ty - py) * k; pf += (tf - pf) * k;
    pitch += (tp - pitch) * k; yaw += (tw - yaw) * k; roll += (tr - roll) * k;
    break;
  }
  out.px = px; out.py = py; out.pf = pf; out.pitch = pitch; out.yaw = yaw; out.roll = roll;
  return out;
}

/** Adds a clip's offsets at time `t` into `into` (one entry per part, created on demand). */
export function addClip(into: Map<string, PartOffset>, clip: Clip | undefined, t: number, weight = 1): void {
  if (!clip || weight <= 0) return;
  const scratch = zeroOffset();
  for (const name of Object.keys(clip.tracks)) {
    sampleTrack(clip.tracks[name]!, t, scratch);
    let total = into.get(name);
    if (!total) {
      total = zeroOffset();
      into.set(name, total);
    }
    total.px += scratch.px * weight; total.py += scratch.py * weight; total.pf += scratch.pf * weight;
    total.pitch += scratch.pitch * weight; total.yaw += scratch.yaw * weight; total.roll += scratch.roll * weight;
  }
}

/** A magazine reload for a weapon that defines none: the magazine drops out and comes back. */
export function defaultMagazineReload(): Clip {
  return {
    duration: 1,
    tracks: {
      [GUN_TRACK]: [
        { t: 0 }, { t: 0.2, p: [0, -0.03, 0], r: [0.22, 0, 0.3] }, { t: 0.75, p: [0, -0.03, 0], r: [0.22, 0, 0.3] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
      ],
      magazine: [
        { t: 0.15 }, { t: 0.32, p: [0, -0.2, -0.02], ease: 'in' }, { t: 0.5, p: [0, -0.2, -0.02] }, { t: 0.7, p: [0, 0, 0], ease: 'out' },
      ],
    },
  };
}

/** The skin's whole-gun turn during an inspect: the standard look-over, the gilded slow showcase,
 * and the pulse flick (models/skins.ts picks one). Times in seconds.
 *
 * Both hands stay on the weapon and turn with it, so every pose here keeps the forearms coming up
 * from below the frame: the gun rolls to the left (its side to the eye), then tips muzzle-up with
 * a little of that roll left. It never rolls the other way and never spins: either swings a forearm
 * across the screen, cut end and all (judged from frame captures, scripts/viewShots.mjs). */
export type InspectStyle = 'standard' | 'showcase' | 'flick';

/** The gun on its side, close to the eye; and tipped up to look along its top. */
const INSPECT_SIDE = { p: [-0.09, 0.045, -0.05], r: [0.12, -0.55, -0.8] } as const;
const INSPECT_SIDE_CLOSE = { p: [-0.09, 0.05, -0.06], r: [0.16, -0.62, -0.92] } as const;
const INSPECT_TOP = { p: [-0.05, 0.02, -0.05], r: [0.42, -0.12, -0.3] } as const;
const INSPECT_TOP_CLOSE = { p: [-0.05, 0.03, -0.06], r: [0.5, -0.16, -0.36] } as const;

export function inspectTurn(style: InspectStyle): Clip {
  if (style === 'showcase') {
    return {
      duration: 4.2,
      tracks: {
        [GUN_TRACK]: [
          { t: 0 },
          { t: 0.8, ...INSPECT_SIDE },
          { t: 2.0, ...INSPECT_SIDE_CLOSE },
          { t: 2.7, ...INSPECT_TOP },
          { t: 3.6, ...INSPECT_TOP_CLOSE },
          { t: 4.2, p: [0, 0, 0], r: [0, 0, 0] },
        ],
      },
    };
  }
  if (style === 'flick') {
    return {
      duration: 2.4,
      tracks: {
        [GUN_TRACK]: [
          { t: 0 },
          // A quick snap up, then over onto its side and held: two beats where the others take three.
          { t: 0.22, ...INSPECT_TOP, ease: 'out' },
          { t: 0.5, ...INSPECT_TOP_CLOSE },
          { t: 0.8, ...INSPECT_SIDE, ease: 'smooth' },
          { t: 1.8, ...INSPECT_SIDE_CLOSE },
          { t: 2.4, p: [0, 0, 0], r: [0, 0, 0] },
        ],
      },
    };
  }
  return {
    duration: 3,
    tracks: {
      [GUN_TRACK]: [
        { t: 0 },
        { t: 0.55, ...INSPECT_SIDE },
        { t: 1.4, ...INSPECT_SIDE_CLOSE },
        { t: 1.95, ...INSPECT_TOP },
        { t: 2.5, ...INSPECT_TOP_CLOSE },
        { t: 3, p: [0, 0, 0], r: [0, 0, 0] },
      ],
    },
  };
}
