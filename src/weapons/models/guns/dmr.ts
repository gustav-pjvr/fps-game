import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportHand, triggerHand } from '../kit/hands.ts';
import { scope } from '../kit/sights.ts';

/** K14 Marksman Rifle: a gas-operated semi-automatic of the traditional kind. A 50 cm barrel with
 * a flash hider, a one-piece stock with a semi pistol grip and a hand guard, a 12 round box
 * magazine, an operating rod with its handle on the right and a medium telescopic sight on a
 * rail. Bore line at y = 0; the gas cylinder runs under the barrel at y = -0.021. */
export function buildDmr(b: GunBuilder): void {
  b.tuning = { scale: 1, offset: [-0.07, 0.05, 0.14] };
  const half = 0.018, wood = 0.024;

  // Receiver with a rounded heel, the scope rail on top, the ejection port on the right.
  b.plate(BODY, 'metal', [
    [-0.115, -0.012], [-0.115, 0.014, 0.01], [-0.1, 0.028, 0.006], [0.125, 0.028], [0.135, 0.018], [0.135, -0.012],
  ], half * 2, { bevel: 0.003 });
  b.rail(BODY, 'metal', -0.085, 0.105, 0.0375);
  b.box(BODY, 'void', [0.0016, 0.014, 0.07], [half + 0.0002, 0.015, 0.05]);
  // Left side: bolt stop, safety catch with its painted dot, receiver pins.
  b.box(BODY, 'metalAlt', [0.003, 0.012, 0.022], [-half - 0.0005, 0.016, 0.04], { bevel: 0.001 });
  b.box(BODY, 'metalAlt', [0.003, 0.006, 0.022], [-half - 0.0005, 0.014, -0.014], { rotate: [0.4, 0, 0] });
  b.box(BODY, 'accent', [0.0012, 0.0045, 0.0045], [-half - 0.0002, 0.02, 0.006]);
  b.pin(BODY, 'metalAlt', -0.092, 0.012, half + 0.0005, 0.003);
  b.pin(BODY, 'metalAlt', 0.118, 0.012, half + 0.0005, 0.003);
  b.witness(BODY, -0.075, -0.035, 0.018, half - 0.0006, 0.005);

  // Operating rod along the right side, its handle, and the bolt showing in the port.
  const bolt = b.part('bolt', [half, 0.009, 0.035]);
  b.box(bolt, 'metalAlt', [0.003, 0.01, 0.062], [half - 0.0006, 0.015, 0.05]);
  b.box(bolt, 'metalAlt', [0.005, 0.007, 0.27], [half + 0.003, 0.0045, 0.165]);
  b.tube(bolt, 'metalAlt', [half + 0.004, 0.0045, 0.035], [0.04, 0.007, 0.035], 0.004, 0.004, 8);
  b.tube(bolt, 'metalAlt', [0.038, 0.0068, 0.035], [0.049, 0.008, 0.035], 0.0068, 0.006, 10);

  // One-piece stock: wrist and semi pistol grip, the bed under the receiver, the fore-end.
  b.plate(BODY, 'furniture', [
    [0.34, 0.004, 0.004], [-0.108, 0.004], [-0.13, -0.006, 0.012], [-0.194, -0.0135], [-0.194, -0.076], [-0.19, -0.102, 0.012],
    [-0.152, -0.106, 0.012], [-0.12, -0.058, 0.012], [-0.075, -0.047], [0.12, -0.047], [0.22, -0.04], [0.33, -0.03, 0.008], [0.34, -0.02, 0.004],
  ], wood * 2, { bevel: 0.008 });
  b.pin(BODY, 'metalAlt', 0.14, -0.024, wood + 0.0003, 0.0045);
  // Hand guard over the barrel, with vents; the front band and its sling swivel.
  b.revolve(BODY, 'furniture', [[0.137, 0.017], [0.145, 0.0195], [0.3, 0.0195], [0.308, 0.017]], { y: 0.003 });
  b.slots(BODY, 0.165, 0.28, 5, [0.014, 0.006], 0, 0.0226, 'top');
  b.box(BODY, 'metal', [0.051, 0.032, 0.014], [0, -0.009, 0.337], { bevel: 0.004 });
  b.ring(BODY, 'metalAlt', [0, -0.034, 0.326], 0.008, 0.0015);

  // Barrel, gas cylinder with its lock, and the flash hider.
  b.revolve(BODY, 'metalAlt', [[0.135, 0.011], [0.34, 0.011], [0.34, 0.0095], [0.55, 0.0088], [0.632, 0.0088]], { y: 0 });
  b.revolve(BODY, 'metalAlt', [[0.34, 0.0085], [0.46, 0.0085], [0.46, 0.0105], [0.475, 0.0105], [0.479, 0.008]], { y: -0.021, segments: 12 });
  b.box(BODY, 'metal', [0.014, 0.03, 0.016], [0, -0.01, 0.467]);
  b.muzzle = [0, 0, b.muzzleDevice(BODY, 0.632, 0, 0.0088, 'flash')];

  // Trigger guard, trigger, the safety tab inside the guard, the magazine catch.
  b.plate(BODY, 'metal', [
    [-0.07, -0.047], [0.03, -0.047], [0.034, -0.056], [0.02, -0.08, 0.006], [-0.05, -0.08, 0.006], [-0.072, -0.062],
  ], 0.012, { bevel: 0.0015, holes: [[[-0.06, -0.052], [0.024, -0.052], [0.014, -0.074, 0.005], [-0.046, -0.074, 0.005]]] });
  b.box(BODY, 'metalAlt', [0.006, 0.022, 0.006], [0, -0.06, -0.014], { rotate: [0.3, 0, 0], bevel: 0.002 });
  b.box(BODY, 'metalAlt', [0.005, 0.012, 0.005], [0, -0.064, 0.016]);
  b.box(BODY, 'metalAlt', [0.01, 0.016, 0.004], [0, -0.058, 0.037], { rotate: [-0.2, 0, 0] });

  // Twelve round steel magazine with pressed ribs and a floor plate.
  const magazine = b.part('magazine', [0, -0.047, 0.1]);
  b.plate(magazine, 'metal', [[0.042, -0.04], [0.108, -0.04], [0.116, -0.112, 0.004], [0.05, -0.118, 0.004]], 0.026, { bevel: 0.003 });
  for (const f of [0.064, 0.092]) b.box(magazine, 'metal', [0.0276, 0.056, 0.005], [0, -0.079, f], { rotate: [-0.1, 0, 0] });
  b.box(magazine, 'metal', [0.029, 0.005, 0.072], [0, -0.1165, 0.083], { rotate: [0.09, 0, 0] });

  // The butt behind the grip slides out of view when aimed: comb with a cheek rest, pad, swivel.
  const stock = b.part('stock', [0, 0, -0.194]);
  b.retractWhenAimed(stock, 0.4);
  b.plate(stock, 'furniture', [
    [-0.19, -0.014], [-0.3, -0.008], [-0.425, -0.016, 0.006], [-0.432, -0.03], [-0.432, -0.135, 0.006], [-0.405, -0.14], [-0.27, -0.092, 0.02], [-0.19, -0.078],
  ], 0.046, { bevel: 0.008 });
  b.plate(stock, 'rubber', [[-0.272, -0.014], [-0.278, 0.012, 0.008], [-0.388, 0.012, 0.008], [-0.394, -0.016]], 0.04, { bevel: 0.007 });
  b.box(stock, 'rubber', [0.044, 0.118, 0.014], [0, -0.083, -0.438], { bevel: 0.005 });
  b.ring(stock, 'metalAlt', [0, -0.132, -0.36], 0.008, 0.0015);
  b.wrapBox(stock, -0.262, -0.224, [0, -0.046], [0.046, 0.07]);

  scope(b, { y: 0.061, rearF: -0.1, frontF: 0.14, baseY: 0.0375, tubeRadius: 0.013, objectiveRadius: 0.02 });

  // What the skins add.
  b.engraving(BODY, [[-0.06, -0.04], [-0.06, -0.004], [0.11, -0.004], [0.11, -0.04]], wood);
  b.medallion(stock, -0.34, -0.07, 0.023, 0.013);
  b.lightLine(BODY, [[-0.2, -0.022], [-0.11, -0.006], [0.335, -0.006]], wood);
  b.wrap(BODY, 0.5, 0.6, 0, 0.0092);

  triggerHand(b, { grip: [0, -0.066, -0.165], rake: 0.5, size: [0.038, 0.046] });
  supportHand(b, { at: [0, -0.04, 0.24], width: 0.048 });

  b.animations = {
    fire: {
      duration: 0.25,
      tracks: {
        bolt: [{ t: 0 }, { t: 0.05, p: [0, 0, -0.07], ease: 'out' }, { t: 0.14, p: [0, 0, 0], ease: 'in' }],
        gun: [{ t: 0 }, { t: 0.045, p: [0, 0.006, -0.026], r: [0.045, 0, 0], ease: 'out' }, { t: 0.24, p: [0, 0, 0], r: [0, 0, 0] }],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.12, p: [0.01, -0.02, 0], r: [0.18, 0.1, 0.35] }, { t: 0.66, p: [0.01, -0.02, 0], r: [0.18, 0.1, 0.35] },
          { t: 0.78, p: [0, -0.008, 0], r: [0.05, 0, -0.1] }, { t: 0.92, p: [0, -0.008, 0.004], r: [0.05, 0, -0.1] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        // The magazine rocks forward off its rear catch, and the new one hooks in the same way.
        magazine: [
          { t: 0.14 }, { t: 0.2, p: [0, -0.012, 0.004], r: [0.3, 0, 0] }, { t: 0.3, p: [0, -0.24, 0.03], r: [0.3, 0, 0], ease: 'in' },
          { t: 0.42, p: [0, -0.24, 0.03], r: [0.3, 0, 0] }, { t: 0.56, p: [0, -0.012, 0.004], r: [0.3, 0, 0], ease: 'out' }, { t: 0.62, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        'arm-support': [
          { t: 0 }, { t: 0.14, p: [0.02, -0.06, -0.15] }, { t: 0.2, p: [0.02, -0.07, -0.14] }, { t: 0.3, p: [0.02, -0.3, -0.12], ease: 'in' },
          { t: 0.42, p: [0.02, -0.3, -0.12] }, { t: 0.56, p: [0.02, -0.07, -0.14], ease: 'out' }, { t: 0.62, p: [0.02, -0.06, -0.15] },
          { t: 0.72, p: [0.02, -0.06, -0.15] }, { t: 0.84, p: [0, 0, 0] },
        ],
        // The trigger hand comes up to rack the operating rod.
        'arm-trigger': [
          { t: 0.68 }, { t: 0.8, p: [0.035, 0.06, 0.19] }, { t: 0.86, p: [0.035, 0.06, 0.12], ease: 'out' }, { t: 0.9, p: [0.035, 0.06, 0.16] }, { t: 1, p: [0, 0, 0] },
        ],
        bolt: [{ t: 0.8 }, { t: 0.86, p: [0, 0, -0.07], ease: 'out' }, { t: 0.9, p: [0, 0, 0], ease: 'in' }],
      },
    },
  };
}
