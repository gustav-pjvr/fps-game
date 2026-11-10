/** The swing poses a blade's attacks are made of (definitions.ts MeleeAttack.poses). */
export type MeleePoseId =
  | 'slashRight' | 'slashLeft' | 'stab' | 'chop' | 'chopRight' | 'chopLeft'
  | 'hookRight' | 'hookLeft' | 'uppercut' | 'backhand' | 'lunge' | 'jab' | 'flurry';
export type MeleeVariant = MeleePoseId | 'draw';

/** Additive view-model offsets in camera space: metres (z negative is forward) and radians. */
export interface MeleePose {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
}

interface Swing {
  /** Where the blade is drawn back to, and where the strike ends. */
  readonly windup: MeleePose;
  readonly strike: MeleePose;
  /** Fractions of the swing at which the wind-up and the strike end; the rest is recovery. */
  readonly windupEnd: number;
  readonly strikeEnd: number;
}

const ZERO_POSE: MeleePose = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
const DRAW_START: MeleePose = { px: 0, py: -0.08, pz: 0, rx: -1.6, ry: 0, rz: 0 };

function pose(px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0): MeleePose {
  return { px, py, pz, rx, ry, rz };
}

function mirrored(swing: Swing): Swing {
  const flip = (p: MeleePose): MeleePose => ({ px: -p.px, py: p.py, pz: p.pz, rx: p.rx, ry: -p.ry, rz: -p.rz });
  return { ...swing, windup: flip(swing.windup), strike: flip(swing.strike) };
}

const SLASH: Swing = { windup: pose(0.12, 0.04, 0.08, -0.25, -0.35, -0.5), strike: pose(-0.32, -0.06, -0.12, 0.3, 0.65, 1.1), windupEnd: 0.15, strikeEnd: 0.5 };
const DIAGONAL_CHOP: Swing = { windup: pose(0.1, 0.15, 0.08, 0.7, -0.1, -0.4), strike: pose(-0.22, -0.15, -0.16, -0.6, 0.3, 0.55), windupEnd: 0.32, strikeEnd: 0.58 };
const HOOK: Swing = { windup: pose(0.08, 0.02, 0.04, 0, -0.3, -0.3), strike: pose(-0.2, -0.02, -0.14, 0.1, 0.7, 0.6), windupEnd: 0.18, strikeEnd: 0.5 };
const JAB: Swing = { windup: pose(0, 0, 0.08), strike: pose(-0.05, 0.02, -0.3, 0.06), windupEnd: 0.2, strikeEnd: 0.48 };

const SWINGS: Readonly<Record<Exclude<MeleePoseId, 'flurry'>, Swing>> = {
  slashRight: SLASH,
  slashLeft: mirrored(SLASH),
  stab: { windup: pose(0, -0.03, 0.12, -0.2), strike: pose(-0.06, 0.02, -0.3, 0.15), windupEnd: 0.15, strikeEnd: 0.5 },
  /** The overhead blow: up and back, then straight down through the target. */
  chop: { windup: pose(-0.04, 0.17, 0.1, 0.95), strike: pose(-0.1, -0.16, -0.2, -0.8), windupEnd: 0.34, strikeEnd: 0.56 },
  chopRight: DIAGONAL_CHOP,
  chopLeft: mirrored(DIAGONAL_CHOP),
  hookRight: HOOK,
  hookLeft: mirrored(HOOK),
  uppercut: { windup: pose(-0.04, -0.1, 0.06, -0.5), strike: pose(-0.08, 0.13, -0.16, 0.7), windupEnd: 0.2, strikeEnd: 0.52 },
  backhand: { windup: pose(-0.18, 0.02, 0.02, 0, 0.6, 0.5), strike: pose(0.2, 0, -0.14, 0, -0.7, -0.7), windupEnd: 0.3, strikeEnd: 0.6 },
  lunge: { windup: pose(0, -0.02, 0.16, -0.15), strike: pose(-0.08, 0.03, -0.42, 0.1), windupEnd: 0.25, strikeEnd: 0.5 },
  jab: JAB,
};

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

function swingPose(swing: Swing, progress: number): MeleePose {
  if (progress < swing.windupEnd) return blend(ZERO_POSE, swing.windup, progress / swing.windupEnd);
  if (progress < swing.strikeEnd) return blend(swing.windup, swing.strike, (progress - swing.windupEnd) / (swing.strikeEnd - swing.windupEnd));
  return blend(swing.strike, ZERO_POSE, (progress - swing.strikeEnd) / (1 - swing.strikeEnd));
}

/** Additive view-model offsets at `t` (0 to 1) through a swing, or through the draw. */
export function meleePose(t: number, variant: MeleeVariant): MeleePose {
  const progress = Math.max(0, Math.min(1, t));
  if (progress === 1) return { ...ZERO_POSE };
  if (variant === 'draw') return blend(DRAW_START, ZERO_POSE, progress);
  // Three jabs back to back, each a little further across.
  if (variant === 'flurry') {
    const index = Math.min(2, Math.floor(progress * 3));
    const jab = swingPose(JAB, progress * 3 - index);
    jab.px += (index - 1) * 0.05;
    return jab;
  }
  return swingPose(SWINGS[variant], progress);
}
