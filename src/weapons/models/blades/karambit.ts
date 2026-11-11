import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { clampHand } from '../kit/hands.ts';

/** Talon Karambit: a short claw of a blade that curves forward and down from a contoured handle,
 * with a steel finger ring at the pommel. Held point forward, edge down; the handle runs along f
 * with its centre at f = -0.042. */
export function buildKarambit(b: GunBuilder): void {
  b.tuning = { scale: 1.2, offset: [-0.06, 0.03, 0.14], rotation: [0.5, -0.36, 0.28] };
  const half = 0.002;

  // Blade: the outer curve is the spine, the hollow inside it the edge, ending in a downward point.
  b.plate(BODY, 'edge', [
    [0.018, 0.015], [0.058, 0.019, 0.02], [0.098, 0.008, 0.02], [0.122, -0.026, 0.016], [0.126, -0.062],
    [0.112, -0.036, 0.012], [0.094, -0.014, 0.014], [0.062, -0.004, 0.012], [0.018, -0.012],
  ], half * 2, { bevel: 0.0015 });
  for (const x of [-half - 0.0002, half + 0.0002]) b.box(BODY, 'void', [0.0006, 0.003, 0.03], [x, 0.008, 0.05], { rotate: [0.08, 0, 0] });
  // Bolster where the blade meets the handle.
  b.box(BODY, 'metalAlt', [0.014, 0.034, 0.01], [0, 0.001, 0.016], { bevel: 0.003 });
  // Handle: a steel tang with contoured scales and finger grooves along the belly.
  b.plate(BODY, 'metalAlt', [
    [0.014, 0.014, 0.004], [-0.05, 0.016, 0.01], [-0.094, 0.01, 0.006], [-0.094, -0.012, 0.006], [-0.05, -0.018, 0.01], [0.014, -0.014, 0.004],
  ], 0.006, { bevel: 0.001 });
  b.plates(BODY, 'polymer', [
    [0.01, 0.012, 0.004], [-0.05, 0.014, 0.01], [-0.09, 0.008, 0.005], [-0.09, -0.01, 0.005], [-0.05, -0.016, 0.01], [0.01, -0.012, 0.004],
  ], 0.008, 0.007, { bevel: 0.003 });
  for (let i = 0; i < 3; i++) b.box(BODY, 'rubber', [0.0226, 0.004, 0.012], [0, -0.0155, -0.012 - i * 0.026], { bevel: 0.0015 });
  b.pin(BODY, 'metalAlt', -0.012, 0.0, 0.0112, 0.0026);
  b.pin(BODY, 'metalAlt', -0.07, -0.002, 0.0112, 0.0026);
  // The finger ring.
  b.plate(BODY, 'metalAlt', [
    [-0.092, 0.012, 0.004], [-0.108, 0.02, 0.01], [-0.126, 0.016, 0.012], [-0.134, -0.001, 0.012], [-0.126, -0.018, 0.012], [-0.108, -0.022, 0.01], [-0.092, -0.014, 0.004],
  ], 0.007, {
    bevel: 0.0015,
    holes: [[[-0.101, 0.008, 0.006], [-0.112, 0.012, 0.007], [-0.123, 0.008, 0.007], [-0.127, -0.001, 0.007], [-0.123, -0.01, 0.007], [-0.112, -0.014, 0.007], [-0.101, -0.01, 0.006]]],
  });
  b.muzzle = [0, -0.062, 0.126];

  b.lightLine(BODY, [[0.02, 0.012], [0.058, 0.015], [0.096, 0.005], [0.118, -0.026]], half);
  b.engraving(BODY, [[0.024, -0.006], [0.024, 0.009], [0.06, 0.012], [0.086, 0.002], [0.062, -0.002]], half);
  b.medallion(BODY, -0.05, -0.001, 0.0112, 0.0062);
  b.wrapBox(BODY, -0.094, -0.082, [0, -0.001], [0.022, 0.026]);

  clampHand(b, { handle: [0, -0.001, -0.042], size: [0.022, 0.032] });
}
