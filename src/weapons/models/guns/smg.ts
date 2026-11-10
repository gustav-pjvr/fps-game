import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportHand, triggerHand } from '../kit/hands.ts';
import { ironSights } from '../kit/sights.ts';

/** Wasp SMG: a compact polymer submachine gun with a boxy upper under a full-length rail, a
 * straight 32 round magazine ahead of the trigger guard, a hand stop and a side-folding skeleton
 * stock. Bore line at y = 0. */
export function buildSmg(b: GunBuilder): void {
  b.tuning = { scale: 1, offset: [-0.06, 0.045, 0.08] };
  const half = 0.02;

  // Upper: one boxy extrusion from the stock hinge to the barrel nut, with the top rail.
  b.plate(BODY, 'metal', [
    [-0.14, -0.018], [-0.14, 0.03, 0.004], [-0.132, 0.037], [0.224, 0.037], [0.23, 0.03], [0.23, -0.004], [0.214, -0.018],
  ], half * 2, { bevel: 0.005 });
  b.rail(BODY, 'metal', -0.134, 0.224, 0.046);
  b.slots(BODY, 0.13, 0.205, 4, [0.016, 0.006], -0.004, half + 0.0002);
  // Raised side panels and the brass deflector.
  b.plates(BODY, 'metal', [[-0.128, -0.012], [-0.128, 0.006], [0.036, 0.006], [0.044, -0.012]], 0.002, half + 0.0004, { bevel: 0.0008, round: 0.003 });
  b.box(BODY, 'metal', [0.007, 0.016, 0.014], [half + 0.002, 0.012, 0.034], { rotate: [0, 0.5, 0], bevel: 0.002 });
  // Ejection port (right side) with the bolt showing; the charging handle in its slot on the left.
  b.box(BODY, 'void', [0.0016, 0.018, 0.05], [half, 0.012, 0.07]);
  b.box(BODY, 'void', [0.0016, 0.005, 0.104], [-half, 0.016, 0.124]);
  const bolt = b.part('bolt', [0, 0.012, 0.07]);
  b.box(bolt, 'metalAlt', [0.003, 0.013, 0.042], [half - 0.0004, 0.012, 0.07]);
  b.box(bolt, 'metalAlt', [0.012, 0.007, 0.012], [-half - 0.005, 0.016, 0.166], { bevel: 0.002 });
  b.box(bolt, 'metalAlt', [0.004, 0.011, 0.016], [-half - 0.011, 0.016, 0.164]);

  // Lower: polymer chassis with the magazine well, grip, squared trigger guard and flat trigger.
  b.plate(BODY, 'polymer', [
    [-0.14, -0.014], [0.1, -0.014], [0.1, -0.078, 0.004], [0.05, -0.082, 0.004], [0.048, -0.046], [-0.05, -0.046], [-0.14, -0.046, 0.012],
  ], 0.036, { bevel: 0.004 });
  b.plate(BODY, 'polymer', [
    [-0.052, -0.044], [-0.104, -0.044, 0.012], [-0.128, -0.15, 0.008], [-0.088, -0.156, 0.008], [-0.064, -0.086, 0.006],
  ], 0.03, { bevel: 0.006 });
  b.plate(BODY, 'polymer', [
    [-0.056, -0.044], [0.05, -0.044], [0.05, -0.06], [0.044, -0.092, 0.006], [-0.046, -0.092, 0.006], [-0.062, -0.072],
  ], 0.012, { bevel: 0.0015, holes: [[[-0.05, -0.051], [0.042, -0.051], [0.038, -0.086, 0.006], [-0.042, -0.086, 0.006]]] });
  b.box(BODY, 'metalAlt', [0.006, 0.026, 0.005], [0, -0.066, -0.004], { rotate: [0.15, 0, 0], bevel: 0.002 });
  // Left side controls: selector with its mark, bolt release, magazine release; takedown pins.
  b.box(BODY, 'metalAlt', [0.003, 0.006, 0.024], [-0.0188, -0.028, -0.07], { rotate: [0.4, 0, 0] });
  b.box(BODY, 'accent', [0.0012, 0.0045, 0.0045], [-0.0182, -0.02, -0.05]);
  b.box(BODY, 'metalAlt', [0.003, 0.018, 0.01], [-0.0188, -0.028, 0.03], { bevel: 0.001 });
  b.pin(BODY, 'metalAlt', 0.036, -0.04, 0.0195, 0.0045);
  b.pin(BODY, 'metalAlt', -0.126, -0.024, 0.0188, 0.0035);
  b.pin(BODY, 'metalAlt', 0.09, -0.024, 0.0188, 0.0035);
  b.ring(BODY, 'metalAlt', [-0.024, -0.004, -0.128], 0.006, 0.0012);

  // Fore-end with vent slots and the angled hand stop; barrel nut, barrel, flash hider.
  b.plate(BODY, 'furniture', [[0.1, -0.014], [0.222, -0.014], [0.216, -0.034, 0.004], [0.1, -0.034]], 0.04, { bevel: 0.005 });
  b.slots(BODY, 0.122, 0.18, 3, [0.018, 0.005], -0.024, 0.0202);
  b.plate(BODY, 'polymer', [[0.186, -0.032], [0.216, -0.032], [0.22, -0.04, 0.003], [0.204, -0.064, 0.004], [0.194, -0.06, 0.004]], 0.022, { bevel: 0.004 });
  b.revolve(BODY, 'metalAlt', [[0.228, 0.013], [0.238, 0.013], [0.238, 0.008], [0.254, 0.008]], { y: 0 });
  b.muzzle = [0, 0, b.muzzleDevice(BODY, 0.254, 0, 0.008, 'flash')];

  // Magazine: straight body with ribs, a base pad, a witness strip on each side.
  const magazine = b.part('magazine', [0, -0.06, 0.075]);
  b.plate(magazine, 'polymer', [[0.057, -0.03], [0.091, -0.03], [0.099, -0.198, 0.003], [0.065, -0.2, 0.003]], 0.024, { bevel: 0.003 });
  b.box(magazine, 'rubber', [0.028, 0.01, 0.042], [0, -0.203, 0.082], { bevel: 0.003 });
  for (const x of [-0.0124, 0.0124]) {
    b.box(magazine, 'glow', [0.0016, 0.086, 0.005], [x, -0.135, 0.068], { rotate: [0.047, 0, 0] });
    for (const y of [-0.1, -0.13, -0.16]) b.box(magazine, 'void', [0.0014, 0.0022, 0.014], [x, y, 0.082 - (y + 0.03) * 0.047]);
  }

  // Side-folding skeleton stock: hinge block and pin, the open frame, a butt pad.
  const stock = b.part('stock', [0, 0, -0.14]);
  b.retractWhenAimed(stock, 0.4);
  b.box(stock, 'metalAlt', [0.03, 0.036, 0.016], [0, 0.008, -0.148], { bevel: 0.003 });
  b.tube(stock, 'metalAlt', [0.015, -0.014, -0.15], [0.015, 0.03, -0.15], 0.004, 0.004, 8);
  b.plate(stock, 'furniture', [
    [-0.156, 0.026], [-0.29, 0.026, 0.006], [-0.3, 0.016], [-0.3, -0.085, 0.006], [-0.28, -0.085], [-0.156, -0.008],
  ], 0.022, { bevel: 0.004, holes: [[[-0.172, 0.014], [-0.282, 0.014, 0.004], [-0.282, -0.062, 0.004], [-0.264, -0.062], [-0.172, -0.002]]] });
  b.box(stock, 'rubber', [0.026, 0.108, 0.01], [0, -0.034, -0.304], { bevel: 0.004 });
  b.wrapBox(stock, -0.27, -0.18, [0, 0.02], [0.022, 0.012]);

  ironSights(b, { lineY: 0.068, rearF: -0.115, rearBaseY: 0.046, frontF: 0.205, frontBaseY: 0.046 });

  // What the skins add.
  b.engraving(BODY, [[-0.12, -0.009], [-0.12, 0.003], [0.03, 0.003], [0.036, -0.009]], half + 0.0012);
  b.medallion(BODY, 0.075, -0.058, 0.018, 0.009);
  b.lightLine(BODY, [[-0.134, 0.027], [0.214, 0.027], [0.228, 0.012]], half);
  b.wrapBox(magazine, 0.06, 0.1, [0, -0.172], [0.024, 0.022]);

  triggerHand(b, { grip: [0, -0.1, -0.093], rake: 0.27, size: [0.03, 0.044] });
  supportHand(b, { at: [0, -0.034, 0.14], width: 0.04 });

  b.animations = {
    fire: {
      duration: 0.055,
      tracks: {
        bolt: [{ t: 0 }, { t: 0.02, p: [0, 0, -0.045], ease: 'out' }, { t: 0.055, p: [0, 0, 0] }],
        gun: [{ t: 0 }, { t: 0.018, p: [0, 0.0015, -0.007], r: [0.007, 0, 0], ease: 'out' }, { t: 0.055, p: [0, 0, 0], r: [0, 0, 0] }],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.12, p: [0.01, -0.02, 0], r: [0.16, 0.08, 0.32] }, { t: 0.64, p: [0.01, -0.02, 0], r: [0.16, 0.08, 0.32] },
          { t: 0.78, p: [0, -0.008, 0], r: [0.05, 0, -0.1] }, { t: 0.9, p: [0, -0.008, 0.005], r: [0.05, 0, -0.1] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        magazine: [
          { t: 0.14 }, { t: 0.25, p: [0, -0.25, 0.012], ease: 'in' }, { t: 0.42, p: [0, -0.25, 0.012] }, { t: 0.6, p: [0, 0, 0], ease: 'out' },
        ],
        'arm-support': [
          { t: 0 }, { t: 0.14, p: [0.02, -0.08, -0.05] }, { t: 0.25, p: [0.02, -0.33, -0.04], ease: 'in' }, { t: 0.42, p: [0.02, -0.33, -0.04] },
          { t: 0.6, p: [0.02, -0.08, -0.05], ease: 'out' }, { t: 0.68, p: [0.02, -0.08, -0.05] }, { t: 0.8, p: [-0.03, 0.075, 0.02] },
          { t: 0.86, p: [-0.03, 0.075, -0.05], ease: 'out' }, { t: 0.9, p: [-0.03, 0.075, 0.01] }, { t: 1, p: [0, 0, 0] },
        ],
        bolt: [{ t: 0.8 }, { t: 0.86, p: [0, 0, -0.07], ease: 'out' }, { t: 0.9, p: [0, 0, 0], ease: 'in' }],
      },
    },
  };
}
