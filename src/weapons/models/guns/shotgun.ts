import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportHand, triggerHand } from '../kit/hands.ts';
import { ironSights } from '../kit/sights.ts';

/** H12 Shotgun: a pump-action 12 gauge with a 50 cm barrel under a ventilated rib, a tube magazine,
 * a ribbed sliding fore-end and a synthetic stock with a semi pistol grip. Bore line at y = 0.008;
 * the magazine tube runs under it at y = -0.02. */
export function buildShotgun(b: GunBuilder): void {
  b.tuning = { scale: 1, offset: [-0.07, 0.045, 0.14] };
  const half = 0.02;
  const bore = 0.008, tube = -0.02;

  // Receiver: a steel box with a rounded rear, the ejection port on the right, the loading port below.
  b.plate(BODY, 'metal', [
    [-0.115, -0.03, 0.006], [-0.118, 0.012, 0.01], [-0.1, 0.03, 0.008], [0.102, 0.03], [0.108, 0.02], [0.108, -0.036], [-0.02, -0.036], [-0.06, -0.03],
  ], half * 2, { bevel: 0.004 });
  b.box(BODY, 'void', [0.002, 0.02, 0.07], [half + 0.0002, 0.008, 0.03]);
  const bolt = b.part('bolt', [half - 0.001, 0.008, 0.03]);
  b.box(bolt, 'metalAlt', [0.003, 0.016, 0.064], [half - 0.0006, 0.008, 0.03]);
  b.box(BODY, 'void', [0.026, 0.002, 0.07], [0, -0.0362, 0.05]);
  b.box(BODY, 'metalAlt', [0.003, 0.008, 0.014], [-half - 0.0005, -0.02, -0.03], { bevel: 0.001 });
  b.tube(BODY, 'metalAlt', [-half - 0.0015, -0.012, -0.075], [half + 0.0015, -0.012, -0.075], 0.0045, 0.0045, 8);
  b.pin(BODY, 'metalAlt', 0.06, -0.022, half - 0.0005, 0.003);
  b.pin(BODY, 'metalAlt', -0.03, -0.006, half - 0.0005, 0.003);
  b.witness(BODY, -0.07, 0.01, 0.019, half - 0.0006, 0.005);

  // Trigger guard and trigger.
  b.plate(BODY, 'polymer', [
    [-0.075, -0.03], [0.012, -0.034], [0.016, -0.046, 0.006], [0.0, -0.07, 0.008], [-0.05, -0.07, 0.008], [-0.078, -0.05],
  ], 0.012, { bevel: 0.002, holes: [[[-0.064, -0.037], [0.006, -0.039], [0.006, -0.046, 0.004], [-0.004, -0.064, 0.006], [-0.048, -0.064, 0.006], [-0.066, -0.048]]] });
  b.box(BODY, 'metalAlt', [0.007, 0.024, 0.006], [0, -0.05, -0.03], { rotate: [0.3, 0, 0], bevel: 0.002 });

  // The grip of the stock stays with the gun; the butt behind it slides out of view when aimed.
  b.plate(BODY, 'furniture', [
    [-0.1, 0.028], [-0.205, 0.014], [-0.205, -0.052], [-0.19, -0.088, 0.012], [-0.15, -0.094, 0.012], [-0.118, -0.04, 0.01], [-0.108, -0.03],
  ], 0.038, { bevel: 0.008 });
  const stock = b.part('stock', [0, 0, -0.205]);
  b.retractWhenAimed(stock, 0.4);
  b.plate(stock, 'furniture', [
    [-0.2, 0.016], [-0.39, 0.03, 0.006], [-0.402, 0.016], [-0.402, -0.094, 0.006], [-0.372, -0.1], [-0.26, -0.058, 0.02], [-0.2, -0.054],
  ], 0.04, { bevel: 0.007 });
  b.box(stock, 'rubber', [0.042, 0.128, 0.016], [0, -0.034, -0.408], { bevel: 0.005 });
  b.tube(stock, 'metalAlt', [-0.021, -0.07, -0.37], [0.021, -0.07, -0.37], 0.004, 0.004, 8);
  b.wrapBox(stock, -0.36, -0.27, [0, -0.02], [0.04, 0.09]);

  // Barrel with its ventilated rib, the magazine tube under it and the clamp that joins them.
  b.revolve(BODY, 'metalAlt', [[0.1, 0.014], [0.14, 0.0128], [0.6, 0.0128]], { y: bore, bore: 0.0096, segments: 14 });
  b.box(BODY, 'metalAlt', [0.008, 0.0035, 0.49], [0, bore + 0.0178, 0.352]);
  for (let i = 0; i < 9; i++) b.box(BODY, 'metalAlt', [0.004, 0.006, 0.006], [0, bore + 0.0142, 0.13 + i * 0.056]);
  b.revolve(BODY, 'metalAlt', [[0.1, 0.0128], [0.512, 0.0128], [0.512, 0.0145], [0.532, 0.0145], [0.536, 0.011]], { y: tube, segments: 14 });
  b.box(BODY, 'metal', [0.03, 0.05, 0.014], [0, -0.006, 0.5], { bevel: 0.004 });
  b.muzzle = [0, bore, b.muzzleDevice(BODY, 0.6, bore, 0.0128, 'crown')];

  // The fore-end slides on the magazine tube; its action bars reach back into the receiver.
  const pump = b.part('pump', [0, tube, 0.3]);
  b.revolve(pump, 'furniture', [[0.22, 0.019], [0.228, 0.0225], [0.372, 0.0225], [0.38, 0.019]], { y: tube, segments: 14 });
  for (let i = 0; i < 6; i++) b.revolve(pump, 'void', [[0.24 + i * 0.023, 0.0229], [0.246 + i * 0.023, 0.0229]], { y: tube, bore: 0.0224, segments: 14 });
  for (const x of [-0.0145, 0.0145]) b.box(pump, 'metalAlt', [0.003, 0.008, 0.13], [x, tube + 0.004, 0.165]);

  // A bead on the rib: the eye runs along the rib to it.
  ironSights(b, { lineY: 0.04, rearF: -0.09, rearBaseY: 0.03, frontF: 0.586, frontBaseY: bore + 0.0195, style: 'bead' });

  b.engraving(BODY, [[-0.09, -0.024], [-0.09, 0.024], [0.0, 0.024], [0.0, -0.024]], half);
  b.medallion(stock, -0.32, -0.03, 0.02, 0.012);
  b.lightLine(BODY, [[-0.1, 0.0], [0.1, 0.0], [0.14, bore], [0.59, bore]], 0.0205);
  b.wrap(BODY, 0.42, 0.49, bore, 0.0128);

  triggerHand(b, { grip: [0, -0.064, -0.162], rake: 0.5, size: [0.036, 0.046] });
  supportHand(b, { at: [0, tube - 0.0225, 0.3], width: 0.045, parent: pump });

  b.animations = {
    fire: {
      duration: 0.75,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.06, p: [0, 0.012, -0.04], r: [0.1, 0, 0], ease: 'out' }, { t: 0.26, p: [0, 0, 0], r: [0, 0, 0] },
          { t: 0.4, p: [0, -0.004, -0.008], r: [0.02, 0, 0.04] }, { t: 0.62, p: [0, 0, 0.004], r: [0, 0, 0] }, { t: 0.75, p: [0, 0, 0] },
        ],
        // Rack it: back, then forward. The support hand is a child of the pump and goes with it.
        pump: [{ t: 0.24 }, { t: 0.4, p: [0, 0, -0.09], ease: 'in' }, { t: 0.46, p: [0, 0, -0.09] }, { t: 0.62, p: [0, 0, 0], ease: 'in' }],
        bolt: [{ t: 0.24 }, { t: 0.4, p: [0, 0, -0.06], ease: 'in' }, { t: 0.46, p: [0, 0, -0.06] }, { t: 0.62, p: [0, 0, 0], ease: 'in' }],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.1, p: [0.02, -0.02, 0], r: [0.25, 0.12, 0.5] }, { t: 0.74, p: [0.02, -0.02, 0], r: [0.25, 0.12, 0.5] },
          { t: 0.82, p: [0, 0, 0], r: [0.03, 0, 0] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        // Three shells thumbed into the loading port, then back to the fore-end for a last rack.
        'arm-support': [
          { t: 0 }, { t: 0.1, p: [0.02, -0.03, -0.26] },
          { t: 0.18, p: [0.02, 0.0, -0.24] }, { t: 0.26, p: [0.02, -0.05, -0.28] },
          { t: 0.38, p: [0.02, 0.0, -0.24] }, { t: 0.46, p: [0.02, -0.05, -0.28] },
          { t: 0.58, p: [0.02, 0.0, -0.24] }, { t: 0.66, p: [0.02, -0.04, -0.27] },
          { t: 0.78, p: [0, 0, 0] },
        ],
        pump: [{ t: 0.82 }, { t: 0.88, p: [0, 0, -0.09], ease: 'in' }, { t: 0.9, p: [0, 0, -0.09] }, { t: 0.96, p: [0, 0, 0], ease: 'in' }],
        bolt: [{ t: 0.82 }, { t: 0.88, p: [0, 0, -0.06], ease: 'in' }, { t: 0.9, p: [0, 0, -0.06] }, { t: 0.96, p: [0, 0, 0], ease: 'in' }],
      },
    },
  };
}
