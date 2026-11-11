import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { clampHand } from '../kit/hands.ts';

/** Kiri Tanto: a 20 cm blade with a straight spine and an angular point, a small oval guard, a
 * cord-wrapped handle and a flat steel pommel cap. Held point forward, edge down; the handle runs
 * along f with its centre at f = -0.045. */
export function buildTanto(b: GunBuilder): void {
  b.tuning = { scale: 1.15, offset: [-0.06, 0.02, 0.12], rotation: [0.42, -0.38, 0.3] };
  const half = 0.0022;

  // Blade: the spine runs straight to the tip, the edge turns up to meet it at a hard angle.
  b.plate(BODY, 'edge', [
    [0.026, 0.0145], [0.228, 0.0145], [0.198, -0.0145], [0.032, -0.0145], [0.026, -0.009],
  ], half * 2, { bevel: 0.0016 });
  // The polished line between the flat and the ground edge, and the collar at the guard.
  for (const x of [-half - 0.0002, half + 0.0002]) b.box(BODY, 'metalAlt', [0.0006, 0.0014, 0.166], [x, -0.004, 0.114]);
  b.box(BODY, 'gold', [0.0075, 0.031, 0.012], [0, 0.0, 0.031], { bevel: 0.0015 });
  // Guard: a small oval plate.
  b.box(BODY, 'metalAlt', [0.036, 0.052, 0.0055], [0, 0.0, 0.0215], { bevel: 0.0026 });
  // Handle: a wooden core under a cord wrap with gaps between the turns, and the pommel cap.
  b.plate(BODY, 'furniture', [
    [0.018, 0.0135, 0.003], [-0.106, 0.0125, 0.003], [-0.106, -0.0125, 0.003], [0.018, -0.0135, 0.003],
  ], 0.021, { bevel: 0.006 });
  for (let i = 0; i < 7; i++) {
    b.box(BODY, 'wrap', [0.0238, 0.0296, 0.0105], [0, 0.0, 0.009 - i * 0.0172], { rotate: [0, 0, i % 2 === 0 ? 0.1 : -0.1], bevel: 0.0045 });
  }
  b.box(BODY, 'metalAlt', [0.0235, 0.029, 0.012], [0, 0.0, -0.111], { bevel: 0.004 });
  b.tube(BODY, 'void', [-0.012, 0.0, -0.112], [0.012, 0.0, -0.112], 0.003, 0.003, 8);
  b.muzzle = [0, 0.0145, 0.228];

  b.lightLine(BODY, [[0.04, 0.009], [0.21, 0.009]], half);
  b.engraving(BODY, [[0.042, -0.002], [0.042, 0.007], [0.13, 0.007], [0.13, -0.002]], half);
  b.medallion(BODY, -0.111, 0.0, 0.0118, 0.0078);
  b.wrapBox(BODY, -0.104, -0.094, [0, 0.0], [0.022, 0.027]);

  clampHand(b, { handle: [0, 0.0, -0.045], size: [0.024, 0.03] });
}
