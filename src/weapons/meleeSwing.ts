export type MeleeVariant = 'slashRight' | 'slashLeft' | 'stab' | 'draw';

export interface MeleePose {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
}

const WINDUP_END = 0.15;
const SWEEP_END = 0.5;
const ZERO_POSE: MeleePose = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
const SLASH_WINDUP: MeleePose = { px: 0.12, py: 0.04, pz: 0.08, rx: -0.25, ry: -0.35, rz: -0.5 };
const SLASH_SWEEP: MeleePose = { px: -0.32, py: -0.06, pz: -0.12, rx: 0.3, ry: 0.65, rz: 1.1 };
const STAB_WINDUP: MeleePose = { px: 0, py: -0.03, pz: 0.12, rx: -0.2, ry: 0, rz: 0 };
const STAB_THRUST: MeleePose = { px: -0.06, py: 0.02, pz: -0.3, rx: 0.15, ry: 0, rz: 0 };
const DRAW_START: MeleePose = { px: 0, py: -0.08, pz: 0, rx: -1.6, ry: 0, rz: 0 };

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

/** Additive view-model offsets in metres and radians. */
export function meleePose(t: number, variant: MeleeVariant): MeleePose {
  const progress = Math.max(0, Math.min(1, t));
  if (progress === 1) return { ...ZERO_POSE };
  if (variant === 'draw') return blend(DRAW_START, ZERO_POSE, progress);

  const windup = variant === 'stab' ? STAB_WINDUP : SLASH_WINDUP;
  const peak = variant === 'stab' ? STAB_THRUST : SLASH_SWEEP;
  const pose = progress < WINDUP_END
    ? blend(ZERO_POSE, windup, progress / WINDUP_END)
    : progress < SWEEP_END
      ? blend(windup, peak, (progress - WINDUP_END) / (SWEEP_END - WINDUP_END))
      : blend(peak, ZERO_POSE, (progress - SWEEP_END) / (1 - SWEEP_END));
  if (variant === 'slashLeft') {
    pose.px = -pose.px;
    pose.ry = -pose.ry;
    pose.rz = -pose.rz;
  }
  return pose;
}
