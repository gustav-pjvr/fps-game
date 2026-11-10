import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportHand, triggerHand } from '../kit/hands.ts';
import { ironSights } from '../kit/sights.ts';

/** Kestrel Battle Rifle: a long-stroke 7.62 rifle with a stamped steel receiver under a ribbed
 * dust cover, a gas tube over the barrel, a long curved 25 round magazine, wooden furniture and a
 * slant-cut muzzle brake. Bore line at y = 0; the gas tube runs above it at y = 0.024. */
export function buildBattleRifle(b: GunBuilder): void {
  b.tuning = { scale: 1, offset: [-0.07, 0.05, 0.14] };
  const half = 0.017, gas = 0.024;

  // Stamped receiver with its rivets, the front trunnion block and the rear sight base on it.
  b.plate(BODY, 'metal', [[-0.13, -0.036, 0.004], [-0.13, 0.012], [0.125, 0.012], [0.125, -0.03], [0.11, -0.036]], half * 2, { bevel: 0.002 });
  b.box(BODY, 'metal', [0.038, 0.05, 0.03], [0, 0.012, 0.113], { bevel: 0.003 });
  b.plate(BODY, 'metal', [[0.096, 0.036], [0.1, 0.048, 0.003], [0.128, 0.048, 0.002], [0.134, 0.036]], 0.022, { bevel: 0.002 });
  for (const [f, y] of [[-0.118, -0.024], [-0.118, 0.002], [0.1, -0.024], [0.004, 0.003]] as const) b.pin(BODY, 'metalAlt', f, y, half + 0.0004, 0.0028);
  // Dust cover: rounded at the back, pressed ribs across the top and down the sides.
  b.plate(BODY, 'metal', [[-0.128, 0.012], [-0.128, 0.026, 0.01], [-0.11, 0.036, 0.008], [0.098, 0.036], [0.098, 0.012]], 0.032, { bevel: 0.005 });
  b.slots(BODY, -0.066, 0.078, 7, [0.006, 0.024], 0, 0.0362, 'top', 'metal');
  b.slots(BODY, -0.066, 0.078, 7, [0.006, 0.013], 0.023, 0.0162, 'side', 'metal');
  b.witness(BODY, -0.118, -0.082, 0.022, 0.0158, 0.005);
  // Ejection slot on the right, the bolt carrier in it and the charging handle.
  b.box(BODY, 'void', [0.002, 0.011, 0.084], [0.0163, 0.0185, 0.048]);
  const bolt = b.part('bolt', [half, 0.017, 0.082]);
  b.box(bolt, 'metalAlt', [0.003, 0.008, 0.074], [0.0166, 0.0185, 0.05]);
  b.tube(bolt, 'metalAlt', [0.015, 0.0175, 0.082], [0.034, 0.02, 0.08], 0.0043, 0.0043, 8);
  b.tube(bolt, 'metalAlt', [0.031, 0.0196, 0.0803], [0.039, 0.0207, 0.0795], 0.0058, 0.0052, 8);
  // Left side: selector lever with its two painted marks, the optic rail plate.
  b.box(BODY, 'metalAlt', [0.003, 0.006, 0.032], [-half - 0.001, -0.014, -0.088], { rotate: [0.35, 0, 0] });
  b.pin(BODY, 'metalAlt', -0.074, -0.019, half + 0.0012, 0.0045);
  for (const [f, y] of [[-0.108, -0.002], [-0.106, -0.027]] as const) b.box(BODY, 'accent', [0.0012, 0.0042, 0.0042], [-half - 0.0002, y, f]);
  b.box(BODY, 'metalAlt', [0.003, 0.013, 0.076], [-half - 0.0012, -0.008, 0.07]);
  b.box(BODY, 'metalAlt', [0.004, 0.005, 0.076], [-half - 0.002, -0.0005, 0.07]);

  // Pistol grip, trigger guard strip, trigger, magazine catch paddle.
  b.plate(BODY, 'furniture', [
    [-0.06, -0.036], [-0.106, -0.036, 0.01], [-0.138, -0.136, 0.008], [-0.1, -0.144, 0.008], [-0.07, -0.076, 0.006],
  ], 0.03, { bevel: 0.006 });
  b.plate(BODY, 'metal', [
    [-0.062, -0.036], [0.03, -0.036], [0.03, -0.044], [0.022, -0.076, 0.006], [-0.05, -0.076, 0.006], [-0.064, -0.06],
  ], 0.012, { bevel: 0.0015, holes: [[[-0.054, -0.041], [0.022, -0.041], [0.016, -0.07, 0.005], [-0.046, -0.07, 0.005]]] });
  b.box(BODY, 'metalAlt', [0.006, 0.024, 0.006], [0, -0.053, -0.012], { rotate: [0.35, 0, 0], bevel: 0.002 });
  b.box(BODY, 'metalAlt', [0.012, 0.022, 0.004], [0, -0.054, 0.027], { rotate: [-0.25, 0, 0] });

  // Magazine: a long steel body on one arc with a pressed panel and a floor plate.
  const magazine = b.part('magazine', [0, -0.034, 0.096]);
  const arc = (radius: number, from = 0, to = 7): [number, number][] => {
    const points: [number, number][] = [];
    for (let i = from; i <= to; i++) points.push([0.33 - radius * Math.cos(i * 0.1), -0.03 - radius * Math.sin(i * 0.1)]);
    return points;
  };
  b.plate(magazine, 'metal', [...arc(0.3), ...arc(0.236).reverse()], 0.024, { bevel: 0.003 });
  b.plate(magazine, 'metal', [...arc(0.288, 1, 6), ...arc(0.248, 1, 6).reverse()], 0.0256, { bevel: 0.001 });
  b.box(magazine, 'metal', [0.027, 0.006, 0.072], [0, -0.2045, 0.1235], { rotate: [0.7, 0, 0] });

  // Fixed wooden butt stock with a steel butt plate, the receiver tang and a sling swivel.
  const stock = b.part('stock', [0, 0, -0.13]);
  b.retractWhenAimed(stock, 0.4);
  b.plate(stock, 'furniture', [
    [-0.125, 0.01], [-0.2, 0.004], [-0.345, -0.012, 0.006], [-0.352, -0.024], [-0.352, -0.112, 0.006], [-0.33, -0.116], [-0.2, -0.06, 0.02], [-0.125, -0.034],
  ], 0.04, { bevel: 0.008 });
  b.plate(stock, 'metalAlt', [[-0.35, -0.01], [-0.35, -0.118], [-0.359, -0.114, 0.003], [-0.359, -0.016, 0.003]], 0.042, { bevel: 0.002 });
  b.box(stock, 'metalAlt', [0.018, 0.004, 0.05], [0, 0.0085, -0.152], { rotate: [0.08, 0, 0] });
  b.ring(stock, 'metalAlt', [0, -0.111, -0.3], 0.008, 0.0015);
  b.wrapBox(stock, -0.3, -0.246, [0, -0.046], [0.04, 0.086]);

  // Lower and upper handguards with vents, the retainer band.
  b.plate(BODY, 'furniture', [[0.127, -0.03, 0.006], [0.127, 0.01], [0.315, 0.01], [0.315, -0.02], [0.3, -0.03, 0.006]], 0.042, { bevel: 0.008 });
  b.slots(BODY, 0.172, 0.276, 3, [0.022, 0.006], -0.006, 0.0212);
  b.revolve(BODY, 'furniture', [[0.129, 0.013], [0.137, 0.0155], [0.3, 0.0155], [0.308, 0.013]], { y: gas });
  b.slots(BODY, 0.17, 0.27, 3, [0.02, 0.006], 0, gas + 0.0156, 'top');
  b.box(BODY, 'metal', [0.045, 0.05, 0.009], [0, 0.007, 0.321]);

  // Barrel, gas tube and gas block, cleaning rod, front sight tower.
  b.revolve(BODY, 'metalAlt', [[0.125, 0.01], [0.33, 0.01], [0.33, 0.0085], [0.535, 0.0085]], { y: 0 });
  b.revolve(BODY, 'metalAlt', [[0.12, 0.0065], [0.372, 0.0065]], { y: gas, segments: 10 });
  b.plate(BODY, 'metal', [[0.356, -0.011], [0.346, 0.033, 0.003], [0.386, 0.033, 0.003], [0.386, -0.011]], 0.018, { bevel: 0.003 });
  b.tube(BODY, 'metalAlt', [0, -0.0135, 0.315], [0, -0.0135, 0.524], 0.003, 0.003, 6);
  b.plate(BODY, 'metal', [[0.47, -0.011, 0.003], [0.474, 0.036], [0.48, 0.052, 0.002], [0.498, 0.052, 0.002], [0.502, -0.011, 0.003]], 0.016, { bevel: 0.003 });

  // Slant-cut brake: a collar whose lower lip runs forward. The ember skin fits its own.
  if (b.skin.muzzle === 'ported') {
    b.muzzle = [0, 0, b.muzzleDevice(BODY, 0.535, 0, 0.0085, 'brake')];
  } else {
    b.revolve(BODY, 'metalAlt', [[0.531, 0.0085], [0.536, 0.0115], [0.562, 0.0115]], { y: 0, bore: 0.0062 });
    b.plate(BODY, 'metalAlt', [[0.56, -0.0115], [0.588, -0.0115, 0.002], [0.566, -0.003], [0.56, -0.003]], 0.019, { bevel: 0.004 });
    b.muzzle = [0, 0, b.muzzleDevice(BODY, 0.562, 0, 0.0115, 'crown')];
  }

  ironSights(b, { lineY: 0.078, rearF: 0.114, rearBaseY: 0.048, frontF: 0.489, frontBaseY: 0.052 });

  // What the skins add.
  b.engraving(BODY, [[-0.056, -0.03], [-0.056, 0.008], [0.024, 0.008], [0.024, -0.03]], half);
  b.medallion(stock, -0.27, -0.046, 0.02, 0.012);
  b.lightLine(BODY, [[-0.125, 0.009], [0.096, 0.009]], half);
  b.lightLine(BODY, [[0.135, 0.002], [0.31, 0.002]], 0.021);
  b.wrap(BODY, 0.4, 0.46, 0, 0.0085);

  triggerHand(b, { grip: [0, -0.09, -0.1], rake: 0.3, size: [0.03, 0.045] });
  supportHand(b, { at: [0, -0.03, 0.22], width: 0.042 });

  b.animations = {
    fire: {
      duration: 0.13,
      tracks: {
        bolt: [{ t: 0 }, { t: 0.04, p: [0, 0, -0.068], ease: 'out' }, { t: 0.11, p: [0, 0, 0], ease: 'in' }],
        gun: [{ t: 0 }, { t: 0.03, p: [0, 0.003, -0.016], r: [0.02, 0, 0], ease: 'out' }, { t: 0.13, p: [0, 0, 0], r: [0, 0, 0] }],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.12, p: [0.01, -0.02, 0], r: [0.2, 0.1, 0.35] }, { t: 0.64, p: [0.01, -0.02, 0], r: [0.2, 0.1, 0.35] },
          { t: 0.76, p: [0, -0.01, 0], r: [0.08, 0, 0.5] }, { t: 0.92, p: [0, -0.01, 0.004], r: [0.08, 0, 0.5] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        // The magazine rocks forward about its front lug, drops, and the fresh one rocks back in.
        magazine: [
          { t: 0.14 }, { t: 0.21, r: [0.5, 0, 0], ease: 'in' }, { t: 0.3, p: [0, -0.26, 0.07], r: [0.5, 0, 0], ease: 'in' },
          { t: 0.42, p: [0, -0.26, 0.07], r: [0.5, 0, 0] }, { t: 0.54, p: [0, 0, 0], r: [0.5, 0, 0], ease: 'out' }, { t: 0.62, r: [0, 0, 0], ease: 'in' },
        ],
        'arm-support': [
          { t: 0 }, { t: 0.14, p: [0.02, -0.11, -0.1] }, { t: 0.21, p: [0.02, -0.1, -0.03] }, { t: 0.3, p: [0.02, -0.34, 0.02], ease: 'in' },
          { t: 0.42, p: [0.02, -0.34, 0.02] }, { t: 0.54, p: [0.02, -0.1, -0.03], ease: 'out' }, { t: 0.62, p: [0.02, -0.11, -0.1] },
          { t: 0.7, p: [0.02, -0.11, -0.1] }, { t: 0.8, p: [0.075, -0.012, -0.13] }, { t: 0.87, p: [0.075, -0.012, -0.2], ease: 'out' }, { t: 1, p: [0, 0, 0] },
        ],
        // The gun is rolled over and the charging handle is pulled with the support hand.
        bolt: [{ t: 0.8 }, { t: 0.87, p: [0, 0, -0.068], ease: 'out' }, { t: 0.92, p: [0, 0, 0], ease: 'in' }],
      },
    },
  };
}
