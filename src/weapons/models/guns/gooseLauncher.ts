import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportHand, triggerHand } from '../kit/hands.ts';
import { ironSights } from '../kit/sights.ts';

/** Goose Launcher: the reward weapon, a four-shot rotary launcher that throws explosive geese. A
 * fat four-chamber drum between two frame blocks, a short wide barrel with a flared lip, a pistol
 * grip and a folding stock. It carries gold bands and a gold wing on each side in every skin.
 * Bore line at y = 0.015; the drum turns about y = -0.012. */
export function buildGooseLauncher(b: GunBuilder): void {
  b.tuning = { scale: 0.95, offset: [-0.06, 0.045, 0.12] };
  const half = 0.024;
  const bore = 0.015, axis = -0.012, drumRadius = 0.052;

  // Frame: a block behind the drum, a block ahead of it holding the barrel, a strap over the top
  // with a rail, and a spine underneath.
  b.plate(BODY, 'metal', [
    [-0.118, -0.03, 0.008], [-0.118, 0.03, 0.012], [-0.096, 0.06, 0.008], [0.112, 0.06], [0.118, 0.05], [0.118, -0.04, 0.006],
    [0.082, -0.04], [0.082, 0.046], [-0.05, 0.046], [-0.05, -0.03],
  ], half * 2, { bevel: 0.005 });
  b.box(BODY, 'metal', [0.016, 0.01, 0.14], [0, -0.07, 0.014], { bevel: 0.003 });
  b.box(BODY, 'metal', [0.02, 0.036, 0.014], [0, -0.052, -0.052], { bevel: 0.003 });
  b.box(BODY, 'metal', [0.02, 0.036, 0.014], [0, -0.052, 0.086], { bevel: 0.003 });
  b.rail(BODY, 'metal', -0.09, 0.108, 0.0695);
  b.pin(BODY, 'metalAlt', -0.084, 0.0, half - 0.0005, 0.004);
  b.pin(BODY, 'metalAlt', 0.1, -0.02, half - 0.0005, 0.004);
  // One witness bar per chamber, on the side the player sees.
  for (let i = 0; i < 4; i++) {
    for (const x of [-half - 0.0004, half + 0.0004]) b.box(BODY, 'glow', [0.0016, 0.007, 0.006], [x, 0.03, -0.106 + i * 0.012]);
  }
  // The gold wing on each side of the rear block: three swept feathers.
  for (let i = 0; i < 3; i++) {
    b.plates(BODY, 'gold', [
      [-0.058, 0.02 - i * 0.014], [-0.11, 0.008 - i * 0.012, 0.004], [-0.112, 0.0 - i * 0.012, 0.004], [-0.06, 0.006 - i * 0.014],
    ], 0.0022, half + 0.0006, { bevel: 0.0008 });
  }

  // The drum: four chambers, gold bands at each end. A quarter turn leaves it looking the same.
  const drum = b.part('drum', [0, axis, 0.016]);
  b.revolve(drum, 'metalAlt', [[-0.046, drumRadius - 0.004], [-0.042, drumRadius], [0.074, drumRadius], [0.078, drumRadius - 0.004]], { y: axis, segments: 20 });
  for (const f of [-0.04, 0.066]) b.revolve(drum, 'gold', [[f, drumRadius + 0.0012], [f + 0.006, drumRadius + 0.0012]], { y: axis, bore: drumRadius, segments: 20 });
  for (let k = 0; k < 4; k++) {
    const groove = (k + 0.5) / 4 * Math.PI * 2, chamber = k / 4 * Math.PI * 2 + Math.PI / 2;
    const gx = Math.cos(groove) * (drumRadius - 0.002), gy = axis + Math.sin(groove) * (drumRadius - 0.002);
    b.tube(drum, 'metal', [gx, gy, -0.03], [gx, gy, 0.062], 0.007, 0.007, 6);
    const cx = Math.cos(chamber) * 0.027, cy = axis + Math.sin(chamber) * 0.027;
    b.disc(drum, 'void', [cx, cy, 0.0782], 0.021, -1);
  }

  // Barrel: short, wide, rifled bands and a flared gold lip.
  b.revolve(BODY, 'metalAlt', [[0.116, 0.036], [0.3, 0.034], [0.316, 0.036]], { y: bore, bore: 0.028, segments: 18 });
  for (const f of [0.14, 0.27]) b.revolve(BODY, 'gold', [[f, 0.0366], [f + 0.012, 0.0366]], { y: bore, bore: 0.034, segments: 18 });
  b.revolve(BODY, 'gold', [[0.314, 0.036], [0.34, 0.044], [0.346, 0.044]], { y: bore, bore: 0.028, segments: 18 });
  b.disc(BODY, 'void', [0, bore, 0.3], 0.028, -1);
  b.muzzle = [0, bore, 0.346];

  // Pistol grip, trigger and guard.
  b.plate(BODY, 'polymer', [
    [-0.062, -0.028], [-0.108, -0.028, 0.012], [-0.14, -0.134, 0.008], [-0.1, -0.142, 0.008], [-0.07, -0.07, 0.006],
  ], 0.032, { bevel: 0.006 });
  b.plate(BODY, 'metal', [
    [-0.066, -0.03], [-0.004, -0.03], [-0.004, -0.04], [-0.02, -0.072, 0.006], [-0.056, -0.072, 0.006], [-0.07, -0.056],
  ], 0.012, { bevel: 0.002, holes: [[[-0.058, -0.036], [-0.012, -0.036], [-0.024, -0.066, 0.005], [-0.054, -0.066, 0.005]]] });
  b.box(BODY, 'metalAlt', [0.007, 0.024, 0.006], [0, -0.05, -0.034], { rotate: [0.3, 0, 0], bevel: 0.002 });

  // Folding stock: two rails and a shoulder pad, out of view when aimed.
  const stock = b.part('stock', [0, 0.02, -0.118]);
  b.retractWhenAimed(stock, 0.4);
  for (const x of [-0.016, 0.016]) b.tube(stock, 'metalAlt', [x, 0.02, -0.118], [x, 0.02, -0.33], 0.0055, 0.0055, 8);
  b.box(stock, 'metalAlt', [0.046, 0.02, 0.02], [0, 0.02, -0.126], { bevel: 0.004 });
  b.plate(stock, 'polymer', [[-0.322, 0.046, 0.006], [-0.344, 0.046, 0.006], [-0.344, -0.07, 0.006], [-0.322, -0.07, 0.006]], 0.046, { bevel: 0.006 });
  b.box(stock, 'rubber', [0.048, 0.118, 0.012], [0, -0.012, -0.35], { bevel: 0.005 });
  b.box(stock, 'gold', [0.05, 0.012, 0.024], [0, 0.03, -0.333], { bevel: 0.003 });

  // The barrel is fat, so the line of aim sits high.
  ironSights(b, { lineY: 0.094, rearF: -0.07, rearBaseY: 0.0695, frontF: 0.29, frontBaseY: bore + 0.0345 });

  b.engraving(BODY, [[0.086, -0.03], [0.086, 0.04], [0.114, 0.04], [0.114, -0.03]], half);
  b.medallion(BODY, -0.104, -0.09, 0.016, 0.01);
  b.lightLine(BODY, [[0.12, bore], [0.31, bore]], 0.0362);
  b.wrap(BODY, 0.165, 0.245, bore, 0.035);

  triggerHand(b, { grip: [0, -0.086, -0.102], rake: 0.3, size: [0.032, 0.046] });
  supportHand(b, { at: [0, bore - 0.036, 0.2], width: 0.07 });

  b.animations = {
    fire: {
      duration: 0.6,
      tracks: {
        gun: [{ t: 0 }, { t: 0.06, p: [0, 0.014, -0.05], r: [0.16, 0, 0], ease: 'out' }, { t: 0.34, p: [0, 0, 0], r: [0, 0, 0] }],
        drum: [{ t: 0.18 }, { t: 0.5, r: [0, 0, Math.PI / 2] }],
      },
    },
    inspect: {
      duration: 3,
      tracks: { drum: [{ t: 0.7 }, { t: 1.7, r: [0, 0, Math.PI * 2], ease: 'out' }] },
    },
  };
}
