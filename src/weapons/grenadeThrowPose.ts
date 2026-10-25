import type { MeleePose } from './meleeSwing.ts';

/**
 * The grenade arm's camera-space pose (GrenadeViewModel), keyframed like the knife's swing
 * (meleeSwing.ts) with the same smoothstep blend. While a grenade cooks the arm rises from below
 * the frame into the cocked hold as WeaponManager.throwPose lowers the gun; on release it swings
 * forward and drops out of view over the throw (GRENADE_THROW_ANIMATION_SECONDS) while the gun
 * comes back up.
 */

export const GRENADE_ARM_HIDDEN: MeleePose = { px: 0.28, py: -0.58, pz: -0.3, rx: 0.5, ry: 0, rz: 0 };
/** Cocked beside the head, the grenade up where the player can see which one it is. */
export const GRENADE_ARM_HOLD: MeleePose = { px: 0.19, py: -0.1, pz: -0.32, rx: 0.4, ry: -0.25, rz: 0.2 };
const GRENADE_ARM_RELEASE: MeleePose = { px: 0.03, py: -0.15, pz: -0.6, rx: -0.85, ry: 0.3, rz: -0.1 };
const GRENADE_ARM_FOLLOW: MeleePose = { px: -0.06, py: -0.62, pz: -0.45, rx: -1.4, ry: 0.4, rz: -0.2 };
/** Throw progress at which the arm is fully forward. */
const RELEASE_AT = 0.3;
/** The grenade shows in the hand this far into the throw: by then the world copy has left it. */
export const GRENADE_LEAVES_HAND_AT = 0.1;

function blend(from: MeleePose, to: MeleePose, t: number): MeleePose {
  const amount = t * t * (3 - 2 * t);
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
  /** The arm is on screen at all. */
  readonly visible: boolean;
  /** The grenade is still in the hand. */
  readonly holding: boolean;
}

/** `throwPose`: WeaponManager.throwPose (0 to 1, how far the gun is lowered). `throwProgress`: 0 to
 * 1 through the throw, or null when no throw is playing (cooking, a dropped cook, or nothing). */
export function grenadeArmPose(throwPose: number, throwProgress: number | null): GrenadeArmPose {
  if (throwProgress !== null) {
    const t = Math.max(0, Math.min(1, throwProgress));
    const pose = t < RELEASE_AT
      ? blend(GRENADE_ARM_HOLD, GRENADE_ARM_RELEASE, t / RELEASE_AT)
      : blend(GRENADE_ARM_RELEASE, GRENADE_ARM_FOLLOW, (t - RELEASE_AT) / (1 - RELEASE_AT));
    return { pose, visible: t < 1, holding: t < GRENADE_LEAVES_HAND_AT };
  }
  const raise = Math.max(0, Math.min(1, throwPose));
  return { pose: blend(GRENADE_ARM_HIDDEN, GRENADE_ARM_HOLD, raise), visible: raise > 0.01, holding: true };
}
