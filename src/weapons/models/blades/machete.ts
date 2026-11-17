import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { clampHand } from '../kit/hands.ts';

/** Bushline Machete: a 42 cm blade that widens toward a rounded tip, on a full tang with riveted
 * handle scales, a beaked pommel and a lanyard hole. Held point forward, edge down; the handle
 * runs along f with its centre at f = -0.045. */
export function buildMachete(b: GunBuilder): void {
  b.tuning = { scale: 1, offset: [-0.03, -0.03, 0.1], rotation: [0.52, -0.3, 0.26] };
  const half = 0.0018;

  // Blade and tang in one piece of steel: a straight spine, a deep belly near the tip.
  b.plate(BODY, 'edge', [
    [-0.118, 0.012], [0.03, 0.016], [0.3, 0.024], [0.425, 0.022, 0.03], [0.452, -0.004, 0.02], [0.43, -0.034, 0.03],
    [0.35, -0.046, 0.06], [0.2, -0.034, 0.06], [0.04, -0.02], [0.03, -0.014], [-0.118, -0.014],
  ], half * 2, { bevel: 0.0013 });
  // A blackened flat above the ground edge, so the edge itself catches the light.
  b.plates(BODY, 'metal', [
    [0.04, 0.0145], [0.3, 0.022], [0.42, 0.02, 0.03], [0.44, 0.0, 0.016], [0.42, -0.016, 0.03], [0.34, -0.026, 0.06], [0.2, -0.016, 0.06], [0.04, -0.004],
  ], 0.0008, half + 0.0003, { bevel: 0.0002 });
  // Front guard hook under the blade's heel.
  b.box(BODY, 'metalAlt', [0.012, 0.014, 0.012], [0, -0.02, 0.028], { bevel: 0.003 });
  // Handle scales with three rivets, the beaked pommel and the lanyard hole.
  b.plates(BODY, 'furniture', [
    [0.024, 0.0165, 0.004], [-0.1, 0.0175, 0.008], [-0.124, 0.008, 0.008], [-0.132, -0.024, 0.006], [-0.108, -0.022, 0.008], [-0.094, -0.0165, 0.006], [0.024, -0.0165, 0.004],
  ], 0.0095, 0.0066, { bevel: 0.004 });
  for (const f of [-0.004, -0.045, -0.086]) b.pin(BODY, 'metalAlt', f, 0.0, 0.0116, 0.0034);
  b.tube(BODY, 'void', [-0.012, -0.012, -0.116], [0.012, -0.012, -0.116], 0.0036, 0.0036, 8);
  b.muzzle = [0, -0.004, 0.452];

  b.lightLine(BODY, [[0.04, 0.012], [0.3, 0.019], [0.418, 0.017]], half + 0.0008);
  b.engraving(BODY, [[0.05, -0.002], [0.05, 0.011], [0.19, 0.015], [0.19, -0.008]], half + 0.0008);
  b.medallion(BODY, -0.112, -0.004, 0.0116, 0.0075);
  b.wrapBox(BODY, -0.112, -0.096, [0, 0.0], [0.023, 0.034]);

  clampHand(b, { handle: [0, 0.0, -0.045], size: [0.023, 0.034] });
}
