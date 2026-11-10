import { BODY, type GunBuilder } from './GunBuilder.ts';

export type SightStyle = 'notch' | 'aperture' | 'bead' | 'reflex';

export interface IronSightSpec {
  /** Height of the line of aim. The whole gun must stay below it. */
  lineY: number;
  /** Rear sight: forward position and the surface it stands on. */
  rearF: number;
  rearBaseY: number;
  /** Front sight: forward position and the surface it stands on. */
  frontF: number;
  frontBaseY: number;
  /** The weapon's own style. A skin may replace it (ranger: aperture, pulse: reflex) unless `fixed`. */
  style?: SightStyle;
  fixed?: boolean;
  /** Parts the rear and front sights ride on (a pistol's are both on the slide). */
  rearPart?: string;
  frontPart?: string;
}

/** The smallest angular gap (as a tangent) between the screen centre and any sight frame. The
 * aim-point test (models/arsenal.test.ts) enforces it for every weapon and skin. */
export const SIGHT_CLEAR_TANGENT = 0.019;

/** Iron sights on the line of aim `lineY`. Whatever the style, the rule from v4.6.0 holds:
 * nothing but the glowing sight tip, and an optic's thin frame outside a clear window, rises to
 * the line, and the builder's `aimPoint` is what the aim pose puts on the screen centre. */
export function ironSights(b: GunBuilder, spec: IronSightSpec): void {
  const style: SightStyle = spec.fixed ? spec.style ?? 'notch' : b.skin.sight ?? spec.style ?? 'notch';
  const rear = spec.rearPart ?? BODY, front = spec.frontPart ?? BODY;
  const { lineY, rearF, rearBaseY, frontF, frontBaseY } = spec;

  if (style === 'reflex') {
    reflexSight(b, rear, rearF, rearBaseY, lineY);
    return;
  }

  // Front: a pedestal, then a thin post (or a bead) whose glowing tip is the one thing on the line.
  const tip = style === 'bead' ? 0.009 : 0.0055;
  const postTop = lineY - tip / 2;
  const frontStand = Math.max(frontBaseY, Math.min(lineY - 0.013, postTop));
  if (frontStand - frontBaseY > 0.001) {
    b.box(front, 'metal', [0.016, frontStand - frontBaseY, 0.02], [0, (frontStand + frontBaseY) / 2, frontF], { bevel: 0.0015 });
  }
  if (postTop - frontStand > 0.001) {
    b.box(front, 'metal', [style === 'bead' ? 0.0035 : 0.0038, postTop - frontStand, 0.006], [0, (postTop + frontStand) / 2, frontF]);
  }
  if (style !== 'bead') {
    // Protective wings either side of the post, stopping short of the line.
    const wingTop = lineY - 0.0035;
    if (wingTop - frontStand > 0.003) {
      for (const x of [-0.0085, 0.0085]) {
        b.box(front, 'metal', [0.0026, wingTop - frontStand, 0.011], [x, (wingTop + frontStand) / 2, frontF], { rotate: [0, 0, x > 0 ? 0.16 : -0.16] });
      }
    }
  }
  b.box(front, 'sight', [tip, tip, tip], [0, lineY, frontF]);
  nameLast(b, 'sight-dot');

  // Rear: the same pedestal, so the sight itself stays small whatever it stands on.
  const rearStand = Math.max(rearBaseY, lineY - (style === 'aperture' ? 0.02 : 0.0125));
  if (style !== 'bead' && rearStand - rearBaseY > 0.001) {
    b.box(rear, 'metal', [0.022, rearStand - rearBaseY, 0.018], [0, (rearStand + rearBaseY) / 2, rearF], { bevel: 0.0015 });
  }
  if (style === 'aperture') {
    // A peep sight: the eye looks through the ring, so the ring is frame, not body.
    const radius = 0.0115, thickness = 0.0019;
    const stemTop = lineY - radius - thickness;
    if (stemTop - rearStand > 0.001) b.box(rear, 'metal', [0.012, stemTop - rearStand, 0.008], [0, (stemTop + rearStand) / 2, rearF]);
    b.ring(rear, 'metal', [0, lineY, rearF], radius, thickness);
    markFrame(b);
  } else if (style === 'notch') {
    const earTop = lineY - 0.003;
    const height = earTop - rearStand;
    if (height > 0.002) {
      for (const x of [-0.0092, 0.0092]) {
        b.box(rear, 'metal', [0.0056, height, 0.007], [x, rearStand + height / 2, rearF]);
        b.box(rear, 'sight', [0.0026, 0.0026, 0.0012], [x, earTop - 0.003, rearF - 0.004]);
      }
      b.box(rear, 'metal', [0.024, Math.min(height * 0.45, 0.004), 0.007], [0, rearStand + Math.min(height * 0.45, 0.004) / 2, rearF]);
    }
  }
  // Bead: no rear sight at all, the eye runs along the rib.
  b.aimPoint = [0, lineY, rearF];
}

/** A reflex sight: a low housing, a thin window frame and a glowing dot. The dot is the aim point. */
function reflexSight(b: GunBuilder, part: string, f: number, baseY: number, ironLineY: number): void {
  const lineY = Math.max(ironLineY, baseY + 0.026);
  const halfWidth = 0.0175, top = lineY + 0.0155, windowF = f + 0.012;
  // Housing: below the line, with the emitter hump at the back.
  b.box(part, 'metal', [halfWidth * 2 + 0.004, 0.011, 0.05], [0, baseY + 0.0055, f + 0.004], { bevel: 0.002 });
  b.box(part, 'metalAlt', [0.012, 0.006, 0.012], [0, baseY + 0.013, f - 0.014], { bevel: 0.0015 });
  for (const x of [-halfWidth - 0.0024, halfWidth + 0.0024]) b.box(part, 'accent', [0.0012, 0.004, 0.02], [x, baseY + 0.006, f + 0.004]);
  // Window frame: two posts and a top bar, all outside the clear window.
  for (const x of [-halfWidth, halfWidth]) {
    b.box(part, 'metal', [0.003, top - (baseY + 0.011), 0.008], [x, (top + baseY + 0.011) / 2, windowF]);
    markFrame(b);
  }
  b.box(part, 'metal', [halfWidth * 2 + 0.003, 0.003, 0.008], [0, top, windowF], { bevel: 0.001 });
  markFrame(b);
  b.box(part, 'glass', [halfWidth * 2 - 0.003, top - baseY - 0.0125, 0.0012], [0, (top + baseY + 0.011) / 2 - 0.0008, windowF]);
  b.box(part, 'sight', [0.0032, 0.0032, 0.0008], [0, lineY, windowF - 0.001]);
  nameLast(b, 'sight-dot');
  b.aimPoint = [0, lineY, windowF - 0.001];
}

export interface ScopeSpec {
  /** Centre line of the scope. */
  y: number;
  /** Rear (eyepiece) and front (objective) ends. */
  rearF: number;
  frontF: number;
  /** Top of the rail or receiver the rings stand on. */
  baseY: number;
  tubeRadius?: number;
  objectiveRadius?: number;
}

/** A telescopic sight. The scope overlay replaces the whole model at full aim (ui/scope.ts), so
 * the aim point is simply the eyepiece centre. */
export function scope(b: GunBuilder, spec: ScopeSpec, part: string = BODY): void {
  const { y, rearF, frontF, baseY } = spec;
  const tubeR = spec.tubeRadius ?? 0.015, objectiveR = spec.objectiveRadius ?? 0.024;
  const length = frontF - rearF;
  const eyeEnd = rearF + length * 0.24, bellStart = frontF - length * 0.26;
  b.revolve(part, 'metal', [
    [rearF, tubeR * 1.42], [rearF + 0.012, tubeR * 1.5], [eyeEnd - 0.012, tubeR * 1.42], [eyeEnd, tubeR],
    [bellStart, tubeR], [bellStart + 0.03, objectiveR], [frontF, objectiveR * 1.04],
  ], { y, bore: tubeR * 0.78, segments: 16 });
  b.revolve(part, 'rubber', [[rearF - 0.01, tubeR * 1.5], [rearF + 0.004, tubeR * 1.56]], { y, bore: tubeR * 1.1, segments: 16 });
  // Turret block with elevation and windage drums.
  const turretF = (eyeEnd + bellStart) / 2;
  b.revolve(part, 'metal', [[turretF - 0.016, tubeR * 1.25], [turretF + 0.016, tubeR * 1.25]], { y, segments: 12 });
  b.tube(part, 'metalAlt', [0, y + tubeR, turretF], [0, y + tubeR + 0.022, turretF], 0.0105, 0.0105, 12);
  b.tube(part, 'metalAlt', [tubeR, y, turretF], [tubeR + 0.02, y, turretF], 0.0105, 0.0105, 12);
  b.tube(part, 'accent', [0, y + tubeR + 0.022, turretF], [0, y + tubeR + 0.0245, turretF], 0.009, 0.009, 12);
  // Two rings clamp it to the rail.
  for (const ringF of [eyeEnd + 0.022, bellStart - 0.022]) {
    b.revolve(part, 'metalAlt', [[ringF - 0.008, tubeR + 0.0045], [ringF + 0.008, tubeR + 0.0045]], { y, segments: 12 });
    b.box(part, 'metalAlt', [0.02, Math.max(0.004, y - tubeR - baseY), 0.016], [0, (y - tubeR + baseY) / 2, ringF]);
    b.box(part, 'metalAlt', [0.03, 0.007, 0.016], [0, baseY + 0.0035, ringF], { bevel: 0.0015 });
  }
  b.disc(part, 'glass', [0, y, frontF - 0.006], objectiveR * 0.9, -1);
  b.disc(part, 'glass', [0, y, rearF + 0.004], tubeR * 1.08, 1);
  b.box(part, 'sight', [0.004, 0.004, 0.0008], [0, y, rearF + 0.0035]);
  nameLast(b, 'sight-dot');
  b.aimPoint = [0, y, rearF + 0.0035];
  b.scoped = true;
}

/** Gives the piece just added its own named mesh (the tests and the aim code find it by name). */
function nameLast(b: GunBuilder, name: string): void {
  b.relabelLast({ name });
}

function markFrame(b: GunBuilder): void {
  b.relabelLast({ opticFrame: true });
}
