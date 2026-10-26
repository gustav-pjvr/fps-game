import type { MeleePose } from './meleeSwing.ts';

/**
 * The grenade arm's camera-space pose (GrenadeViewModel), keyframed like the knife's swing
 * (meleeSwing.ts) with the same smoothstep blend. While a grenade cooks the arm rises from below
 * the frame into the hold, up at the right, as WeaponManager.throwPose lowers the gun. The throw is
 * a lob: a short wind back up and to the right, a swing forward over the shoulder with the wrist
 * flicking through that lets go of the grenade, then a follow-through down and out of view while
 * the gun comes back up.
 *
 * The forearm hangs down out of the hand in every keyframe (the hand turns at the wrist, the elbow
 * is never brought up into view), so the sleeve stays a narrow band running off the bottom of the
 * frame.
 */

export const GRENADE_ARM_HIDDEN: MeleePose = { px: 0.34, py: -0.62, pz: -0.46, rx: 0.2, ry: 0.5, rz: 0.1 };
/** Up at the right, about as far out as the gun, the grenade where the player can see which one
 * it is. */
export const GRENADE_ARM_HOLD: MeleePose = { px: 0.25, py: 0.03, pz: -0.5, rx: 0.05, ry: 1.0, rz: 0.1 };
/** Wound back: further up, right and toward the shoulder, the hand tipped back. */
export const GRENADE_ARM_WINDUP: MeleePose = { px: 0.28, py: 0.07, pz: -0.45, rx: -0.25, ry: 1.15, rz: 0.2 };
/** Over the shoulder and out: higher, nearer the middle, the forearm upright. */
const GRENADE_ARM_RELEASE: MeleePose = { px: 0.11, py: 0.02, pz: -0.7, rx: 0.36, ry: 0.35, rz: -0.05 };
/** Down and out, below the frame. */
const GRENADE_ARM_FOLLOW: MeleePose = { px: -0.02, py: -0.66, pz: -0.62, rx: 1.0, ry: -0.05, rz: -0.35 };
/** The wrist's bend at each keyframe (radians; positive cocks the hand back, negative flicks it
 * forward and down). */
const WRIST_HOLD = 0;
const WRIST_WINDUP = 0.3;
const WRIST_RELEASE = -0.75;
const WRIST_FOLLOW = -1.25;
/** Throw progress at which the wind back peaks and the arm is fully forward. */
const WINDUP_AT = 0.1;
const RELEASE_AT = 0.3;
/** The grenade leaves the hand this far into the throw, just before the arm is fully forward.
 * GrenadeSystem keeps the world copy of an own throw hidden until then, so there is never two. */
export const GRENADE_LEAVES_HAND_AT = 0.26;
/** The fingers open over this much of the throw after letting go. */
const HAND_OPEN_SPAN = 0.12;

function ease(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function blend(from: MeleePose, to: MeleePose, t: number): MeleePose {
  const amount = ease(t);
  return {
    px: from.px + (to.px - from.px) * amount,
    py: from.py + (to.py - from.py) * amount,
    pz: from.pz + (to.pz - from.pz) * amount,
    rx: from.rx + (to.rx - from.rx) * amount,
    ry: from.ry + (to.ry - from.ry) * amount,
    rz: from.rz + (to.rz - from.rz) * amount,
  };
}

export interface GrenadeArmPose {
  readonly pose: MeleePose;
  /** The wrist's bend (radians, about the hand's own across axis): positive back, negative forward. */
  readonly wrist: number;
  /** The arm is on screen at all. */
  readonly visible: boolean;
  /** The grenade is still in the hand. */
  readonly holding: boolean;
  /** 0 to 1: how far the fingers have opened after letting go. */
  readonly open: number;
}

/** `throwPose`: WeaponManager.throwPose (0 to 1, how far the gun is lowered). `throwProgress`: 0 to
 * 1 through the throw, or null when no throw is playing (cooking, a dropped cook, or nothing). */
export function grenadeArmPose(throwPose: number, throwProgress: number | null): GrenadeArmPose {
  if (throwProgress !== null) {
    const t = Math.max(0, Math.min(1, throwProgress));
    let pose: MeleePose;
    let wrist: number;
    if (t < WINDUP_AT) {
      const k = t / WINDUP_AT;
      pose = blend(GRENADE_ARM_HOLD, GRENADE_ARM_WINDUP, k);
      wrist = WRIST_HOLD + (WRIST_WINDUP - WRIST_HOLD) * ease(k);
    } else if (t < RELEASE_AT) {
      const k = (t - WINDUP_AT) / (RELEASE_AT - WINDUP_AT);
      pose = blend(GRENADE_ARM_WINDUP, GRENADE_ARM_RELEASE, k);
      wrist = WRIST_WINDUP + (WRIST_RELEASE - WRIST_WINDUP) * ease(k);
    } else {
      const k = (t - RELEASE_AT) / (1 - RELEASE_AT);
      pose = blend(GRENADE_ARM_RELEASE, GRENADE_ARM_FOLLOW, k);
      wrist = WRIST_RELEASE + (WRIST_FOLLOW - WRIST_RELEASE) * ease(k);
    }
    const open = ease((t - GRENADE_LEAVES_HAND_AT) / HAND_OPEN_SPAN);
    return { pose, wrist, visible: t < 1, holding: t < GRENADE_LEAVES_HAND_AT, open };
  }
  const raise = Math.max(0, Math.min(1, throwPose));
  return { pose: blend(GRENADE_ARM_HIDDEN, GRENADE_ARM_HOLD, raise), wrist: WRIST_HOLD, visible: raise > 0.01, holding: true, open: 0 };
}
