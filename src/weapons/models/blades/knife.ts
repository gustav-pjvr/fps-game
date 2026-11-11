import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { clampHand } from '../kit/hands.ts';

/** Combat Knife: an 18 cm clip-point fighting knife with a fuller, a steel crossguard, a grooved
 * rubber handle and a steel pommel with a lanyard hole. Held point forward, edge down; the handle
 * runs along f with its centre at f = -0.045. */
export function buildKnife(b: GunBuilder): void {
  b.tuning = { scale: 1.15, offset: [-0.06, 0.02, 0.12], rotation: [0.42, -0.38, 0.3] };
  const half = 0.00225;

  // Blade: flat spine, clip point, a long belly; then the ground edge and the fuller.
  b.plate(BODY, 'edge', [
    [0.03, 0.017], [0.148, 0.017, 0.004], [0.214, -0.001], [0.2, -0.012, 0.01], [0.165, -0.0205, 0.02], [0.04, -0.0205], [0.03, -0.014],
  ], half * 2, { bevel: 0.0016 });
  b.plate(BODY, 'metalAlt', [[0.036, 0.0185], [0.146, 0.0185], [0.146, 0.0165], [0.036, 0.0165]], half * 2 + 0.0012, { bevel: 0.0004 });
  for (const x of [-half - 0.0002, half + 0.0002]) b.box(BODY, 'void', [0.0006, 0.0034, 0.094], [x, 0.006, 0.092]);
  // Crossguard, with the ricasso stepping into it.
  b.box(BODY, 'metalAlt', [0.013, 0.072, 0.011], [0, -0.003, 0.0245], { bevel: 0.0035 });
  b.box(BODY, 'metalAlt', [0.016, 0.04, 0.006], [0, -0.002, 0.0165], { bevel: 0.002 });
  // Handle: an oval core with five grip rings, then the pommel and its lanyard hole.
  b.plate(BODY, 'polymer', [
    [0.014, 0.0135, 0.004], [-0.108, 0.0135, 0.004], [-0.108, -0.0145, 0.004], [0.014, -0.0145, 0.004],
  ], 0.022, { bevel: 0.006 });
  for (let i = 0; i < 5; i++) b.box(BODY, 'rubber', [0.0255, 0.0325, 0.0125], [0, -0.0005, -0.0015 - i * 0.0225], { bevel: 0.006 });
  b.box(BODY, 'metalAlt', [0.024, 0.033, 0.017], [0, -0.0005, -0.1165], { bevel: 0.005 });
  b.tube(BODY, 'void', [-0.0125, -0.001, -0.1185], [0.0125, -0.001, -0.1185], 0.0036, 0.0036, 8);
  b.muzzle = [0, -0.001, 0.214];

  // What the skins add: a light line along the spine, an engraved panel on the flat, a medallion in
  // the pommel, a cord wrap behind the fist.
  b.lightLine(BODY, [[0.04, 0.011], [0.146, 0.011]], half);
  b.engraving(BODY, [[0.038, -0.014], [0.038, 0.002], [0.12, 0.002], [0.12, -0.014]], half);
  b.medallion(BODY, -0.1165, -0.0005, 0.012, 0.0085);
  b.wrapBox(BODY, -0.108, -0.094, [0, -0.0005], [0.024, 0.031]);

  clampHand(b, { handle: [0, -0.0005, -0.045], size: [0.0255, 0.0325] });
}
