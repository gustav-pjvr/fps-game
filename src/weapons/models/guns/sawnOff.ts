import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportHand, triggerHand } from '../kit/hands.ts';
import { ironSights } from '../kit/sights.ts';

/** Stub 12 Sawn-off: a side-by-side double-barrelled shotgun cut down to 26 cm of barrel and a
 * pistol-grip stub of a stock. The barrels hinge open at the front of the action to load two
 * shells. Bore lines at x = +/-0.0128, y = 0.012. */
export function buildSawnOff(b: GunBuilder): void {
  b.tuning = { scale: 1.05, offset: [-0.07, 0.035, 0.1] };
  const half = 0.026;
  const side = 0.0128, bore = 0.012;

  // Action: a rounded steel box with the top lever, two triggers and their guard.
  b.plate(BODY, 'metal', [
    [-0.075, 0.024, 0.01], [-0.02, 0.032, 0.006], [0.042, 0.032], [0.042, -0.012], [0.052, -0.02], [0.052, -0.03], [-0.03, -0.03], [-0.07, -0.022, 0.008],
  ], half * 2, { bevel: 0.007 });
  b.box(BODY, 'metalAlt', [0.008, 0.005, 0.05], [0.002, 0.0345, -0.03], { rotate: [0, 0.18, 0], bevel: 0.002 });
  b.tube(BODY, 'metalAlt', [0, 0.033, -0.008], [0, 0.038, -0.008], 0.005, 0.005, 10);
  b.pin(BODY, 'metalAlt', 0.046, -0.022, half - 0.001, 0.0042);
  b.pin(BODY, 'metalAlt', -0.03, 0.006, half - 0.001, 0.0026);
  for (const x of [-side, side]) b.box(BODY, 'glow', [0.006, 0.0016, 0.012], [x, 0.0328, 0.022]);
  b.plate(BODY, 'metal', [
    [-0.072, -0.026], [0.02, -0.03], [0.024, -0.042, 0.006], [0.008, -0.068, 0.008], [-0.046, -0.068, 0.008], [-0.074, -0.046],
  ], 0.012, { bevel: 0.002, holes: [[[-0.062, -0.034], [0.014, -0.036], [0.014, -0.042, 0.004], [0.004, -0.062, 0.006], [-0.044, -0.062, 0.006], [-0.064, -0.044]]] });
  b.box(BODY, 'metalAlt', [0.005, 0.024, 0.005], [-0.004, -0.046, -0.012], { rotate: [0.3, 0, 0], bevel: 0.0015 });
  b.box(BODY, 'metalAlt', [0.005, 0.024, 0.005], [0.004, -0.046, -0.034], { rotate: [0.3, 0, 0], bevel: 0.0015 });

  // The cut-down stock: a wooden pistol grip, sawn off square.
  b.plate(BODY, 'furniture', [
    [-0.066, 0.022], [-0.112, 0.012, 0.014], [-0.158, -0.05, 0.02], [-0.178, -0.11, 0.008], [-0.134, -0.124, 0.008], [-0.108, -0.066, 0.016], [-0.074, -0.03],
  ], 0.04, { bevel: 0.01 });

  // The barrels, their rib and the wooden fore-end: one part, hinged at the front of the action.
  const barrels = b.part('barrels', [0, -0.022, 0.046]);
  for (const x of [-side, side]) {
    b.revolve(barrels, 'metalAlt', [[0.042, 0.0128], [0.3, 0.0128]], { x, y: bore, bore: 0.0098, segments: 14 });
    // The brass heads of the two shells, seen when the gun is open.
    b.disc(barrels, 'accent', [x, bore, 0.0415], 0.0105, 1);
    b.disc(barrels, 'void', [x, bore, 0.2995], 0.0098, -1);
  }
  b.box(barrels, 'metalAlt', [0.007, 0.004, 0.256], [0, bore + 0.0128, 0.171]);
  b.box(barrels, 'metalAlt', [0.012, 0.014, 0.258], [0, bore - 0.006, 0.171]);
  b.plate(barrels, 'furniture', [
    [0.05, -0.002], [0.2, -0.002, 0.004], [0.214, -0.014, 0.008], [0.2, -0.03, 0.01], [0.06, -0.034, 0.008], [0.05, -0.024],
  ], 0.046, { bevel: 0.009 });
  b.box(barrels, 'metalAlt', [0.012, 0.004, 0.02], [0, -0.0345, 0.1], { bevel: 0.0015 });
  b.muzzle = [0, bore, 0.3];

  // A bead between the barrels.
  ironSights(b, { lineY: 0.046, rearF: -0.05, rearBaseY: 0.03, frontF: 0.29, frontBaseY: bore + 0.0148, style: 'bead', frontPart: barrels });

  b.engraving(BODY, [[-0.06, -0.02], [-0.06, 0.022], [0.036, 0.022], [0.036, -0.02]], half);
  b.medallion(BODY, -0.13, -0.06, 0.02, 0.011);
  b.lightLine(barrels, [[0.05, bore], [0.296, bore]], side + 0.0128);
  b.wrapBox(barrels, 0.226, 0.276, [0, bore], [0.052, 0.027]);
  // The ember skin ports both muzzles.
  if (b.skin.muzzle === 'ported') {
    for (const x of [-side, side]) b.muzzleDevice(barrels, 0.3, bore, 0.0128, 'crown', x);
    b.muzzle = [0, bore, 0.378];
  }

  triggerHand(b, { grip: [0, -0.07, -0.132], rake: 0.5, size: [0.038, 0.046] });
  supportHand(b, { at: [0, -0.034, 0.125], width: 0.046, parent: barrels });

  b.animations = {
    fire: {
      duration: 0.3,
      tracks: {
        gun: [{ t: 0 }, { t: 0.05, p: [0, 0.02, -0.045], r: [0.22, 0, 0.03], ease: 'out' }, { t: 0.3, p: [0, 0, 0], r: [0, 0, 0] }],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.1, p: [0.01, 0, -0.02], r: [0.3, 0.1, 0.25] }, { t: 0.8, p: [0.01, 0, -0.02], r: [0.3, 0.1, 0.25] },
          { t: 0.92, p: [0, 0.004, 0], r: [0.06, 0, 0] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        // Break it open: the barrels (and the hand on the fore-end) drop about the hinge.
        barrels: [{ t: 0.08 }, { t: 0.18, r: [-0.55, 0, 0], ease: 'out' }, { t: 0.78, r: [-0.55, 0, 0] }, { t: 0.88, r: [0, 0, 0], ease: 'in' }],
        // Two shells into the breech, one after the other.
        'arm-support': [
          { t: 0 }, { t: 0.2, p: [0, 0, 0] }, { t: 0.32, p: [0.03, 0.09, -0.14] }, { t: 0.4, p: [0.02, 0.06, -0.09] },
          { t: 0.48, p: [0.03, 0.1, -0.16] }, { t: 0.58, p: [-0.01, 0.09, -0.14] }, { t: 0.66, p: [-0.01, 0.06, -0.09] },
          { t: 0.76, p: [0, 0, 0] },
        ],
      },
    },
  };
}
