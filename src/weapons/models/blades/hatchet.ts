import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { clampHand } from '../kit/hands.ts';

/** Trail Hatchet: a short-hafted axe carried head forward, bit down: a steel head with a flat
 * poll and a bearded bit on a curved haft with a flared knob and a lanyard. The haft runs along f;
 * the fist closes round it at f = -0.07. */
export function buildHatchet(b: GunBuilder): void {
  b.tuning = { scale: 1.05, offset: [-0.05, 0.02, 0.12], rotation: [0.66, -0.36, 0.22] };

  // Haft: a gentle curve, swelling to a knob at the butt.
  b.plate(BODY, 'furniture', [
    [-0.142, 0.02, 0.008], [-0.118, 0.014, 0.01], [-0.02, 0.012, 0.02], [0.16, 0.016], [0.214, 0.018], [0.214, -0.012], [0.16, -0.01],
    [-0.02, -0.014, 0.02], [-0.118, -0.016, 0.01], [-0.146, -0.026, 0.008],
  ], 0.023, { bevel: 0.007 });
  b.tube(BODY, 'void', [-0.012, -0.002, -0.13], [0.012, -0.002, -0.13], 0.0034, 0.0034, 8);
  b.tube(BODY, 'wrap', [-0.004, -0.004, -0.132], [-0.012, -0.05, -0.15], 0.0022, 0.0022, 6);
  b.tube(BODY, 'wrap', [0.004, -0.004, -0.132], [0.01, -0.052, -0.146], 0.0022, 0.0022, 6);
  // Head: the eye round the haft with the poll on top, then the bit fanning down to the edge.
  b.plate(BODY, 'metal', [
    [0.152, 0.034, 0.004], [0.212, 0.034, 0.004], [0.214, -0.02], [0.226, -0.06], [0.136, -0.064], [0.15, -0.02],
  ], 0.027, { bevel: 0.004 });
  b.plate(BODY, 'edge', [
    [0.222, -0.052], [0.236, -0.094, 0.006], [0.122, -0.1, 0.006], [0.138, -0.056],
  ], 0.008, { bevel: 0.0034 });
  // The wedge in the top of the eye, and the cheek's forge line.
  b.box(BODY, 'accent', [0.0036, 0.0016, 0.03], [0, 0.0345, 0.182]);
  for (const x of [-0.0138, 0.0138]) b.box(BODY, 'void', [0.0006, 0.0022, 0.07], [x, -0.046, 0.181]);
  b.muzzle = [0, -0.1, 0.18];

  b.lightLine(BODY, [[0.154, 0.024], [0.21, 0.024], [0.222, -0.05]], 0.0135);
  b.engraving(BODY, [[0.158, -0.012], [0.158, 0.02], [0.206, 0.02], [0.214, -0.04], [0.15, -0.042]], 0.0135);
  b.medallion(BODY, -0.128, 0.012, 0.0116, 0.0062);
  b.wrapBox(BODY, 0.03, 0.13, [0, 0.002], [0.023, 0.027]);

  clampHand(b, { handle: [0, -0.001, -0.07], size: [0.024, 0.03] });
}
