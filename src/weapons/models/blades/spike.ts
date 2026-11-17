import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { clampHand } from '../kit/hands.ts';

/** Trench Spike: a trench knife with a 21 cm four-sided spike for a blade and a steel knuckle bow
 * under the handle, studded along its outside, ending in a pointed pommel nut. Held point
 * forward; the handle runs along f with its centre at f = -0.045. */
export function buildSpike(b: GunBuilder): void {
  b.tuning = { scale: 1.15, offset: [-0.06, 0.03, 0.12], rotation: [0.4, -0.38, 0.28] };

  // Spike: a tapering four-sided bar with a narrow fin above and below, and a collar at its root.
  b.tube(BODY, 'edge', [0, 0.0, 0.024], [0, 0.0, 0.238], 0.0074, 0.0006, 4);
  b.plate(BODY, 'edge', [[0.03, 0.0098], [0.2, 0.0034], [0.2, -0.0034], [0.03, -0.0098]], 0.0018, { bevel: 0.0006 });
  b.revolve(BODY, 'metalAlt', [[0.012, 0.0115], [0.03, 0.0098], [0.034, 0.0078]], { y: 0, segments: 10 });
  // Guard disc.
  b.revolve(BODY, 'metalAlt', [[0.006, 0.019], [0.012, 0.019]], { y: 0, segments: 14 });
  // Handle: turned wood with three grooves, and the pommel nut drawn to a point.
  b.revolve(BODY, 'furniture', [[-0.1, 0.0125], [-0.086, 0.0145], [-0.02, 0.015], [0.006, 0.0125]], { y: 0, segments: 12 });
  for (const f of [-0.074, -0.046, -0.018]) b.revolve(BODY, 'void', [[f, 0.0153], [f + 0.003, 0.0153]], { y: 0, bore: 0.0148, segments: 12 });
  b.revolve(BODY, 'metalAlt', [[-0.128, 0.0015], [-0.114, 0.0105], [-0.1, 0.0125]], { y: 0, segments: 8 });
  // Knuckle bow: a D of steel under the handle, guard to pommel, with four studs on its outside.
  b.plate(BODY, 'metalAlt', [
    [0.012, -0.004], [0.012, -0.05, 0.016], [-0.004, -0.064, 0.012], [-0.09, -0.064, 0.012], [-0.106, -0.05, 0.016], [-0.106, -0.004],
  ], 0.013, {
    bevel: 0.0024,
    holes: [[[0.002, -0.012], [0.002, -0.046, 0.012], [-0.008, -0.054, 0.008], [-0.086, -0.054, 0.008], [-0.096, -0.046, 0.012], [-0.096, -0.012]]],
  });
  for (let i = 0; i < 4; i++) b.tube(BODY, 'metalAlt', [0, -0.063, -0.012 - i * 0.0235], [0, -0.076, -0.012 - i * 0.0235], 0.0062, 0.0012, 6);
  b.muzzle = [0, 0, 0.238];

  b.lightLine(BODY, [[0.036, 0.0], [0.2, 0.0]], 0.0052);
  b.engraving(BODY, [[-0.002, -0.056], [-0.002, -0.062], [-0.088, -0.062], [-0.088, -0.056]], 0.0065);
  b.medallion(BODY, 0.006, -0.03, 0.0065, 0.0046);
  b.wrap(BODY, -0.1, -0.084, 0, 0.0135);

  clampHand(b, { handle: [0, 0.0, -0.045], size: [0.028, 0.03] });
}
