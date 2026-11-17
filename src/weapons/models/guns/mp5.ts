import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportHand, triggerHand } from '../kit/hands.ts';
import { ironSights } from '../kit/sights.ts';

/** S5 Burst SMG: a roller-delayed 9 mm submachine gun with a round-topped stamped receiver, a
 * cocking tube over the barrel, a strongly curved 30 round magazine and a retractable two-rail
 * stock. Bore line at y = 0. */
export function buildMp5(b: GunBuilder): void {
  b.tuning = { scale: 1, offset: [-0.065, 0.045, 0.08] };
  const half = 0.018;

  // Stamped receiver: flat sides under a round top, a pressed rib along each side, the end cap.
  b.plate(BODY, 'metal', [[-0.15, -0.02], [-0.15, 0.026], [0.118, 0.026], [0.118, -0.02]], half * 2, { bevel: 0.002 });
  b.revolve(BODY, 'metal', [[-0.15, 0.018], [0.118, 0.018]], { y: 0.026, segments: 16 });
  b.plates(BODY, 'metal', [[-0.135, 0.016], [-0.135, 0.022], [0.104, 0.022], [0.104, 0.016]], 0.002, half + 0.0005, { bevel: 0.0008, round: 0.003 });
  b.plate(BODY, 'metal', [[-0.164, -0.018, 0.004], [-0.164, 0.038, 0.01], [-0.15, 0.044], [-0.15, -0.02]], 0.038, { bevel: 0.003 });
  b.ring(BODY, 'metalAlt', [-0.023, 0.02, -0.157], 0.006, 0.0012);
  // Cocking tube above the barrel, with the handle's slot down its left side.
  b.revolve(BODY, 'metal', [[0.118, 0.0125], [0.262, 0.0125], [0.267, 0.0105]], { y: 0.03 });
  b.box(BODY, 'void', [0.0016, 0.005, 0.1], [-0.0125, 0.03, 0.174]);
  // Ejection port (right side) with the bolt showing; the cocking handle on the left.
  b.box(BODY, 'void', [0.0016, 0.016, 0.058], [half, 0.012, 0.062]);
  const bolt = b.part('bolt', [0, 0.03, 0.215]);
  b.box(bolt, 'metalAlt', [0.003, 0.012, 0.05], [half - 0.0004, 0.012, 0.062]);
  b.tube(bolt, 'metalAlt', [-0.01, 0.03, 0.215], [-0.032, 0.037, 0.211], 0.004, 0.004, 8);
  b.tube(bolt, 'metalAlt', [-0.028, 0.0355, 0.2115], [-0.044, 0.0405, 0.209], 0.0075, 0.0065, 10);

  // Front sight tower, barrel with its three locking lugs, muzzle device.
  b.plate(BODY, 'metal', [[0.24, -0.012, 0.004], [0.24, 0.043, 0.003], [0.262, 0.043, 0.003], [0.262, -0.012, 0.004]], 0.02, { bevel: 0.003 });
  b.revolve(BODY, 'metalAlt', [[0.118, 0.0085], [0.262, 0.0085], [0.262, 0.0075], [0.287, 0.0075]], { y: 0 });
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * Math.PI * 2) / 3;
    b.box(BODY, 'metalAlt', [0.0045, 0.0045, 0.006], [Math.cos(a) * 0.0082, Math.sin(a) * 0.0082, 0.275]);
  }
  b.muzzle = [0, 0, b.muzzleDevice(BODY, 0.287, 0, 0.0075, 'flash')];

  // Slim handguard with grip grooves and its retaining pin.
  b.plate(BODY, 'furniture', [
    [0.112, -0.024], [0.112, 0.02], [0.238, 0.02], [0.238, -0.016], [0.226, -0.03, 0.008], [0.124, -0.03, 0.006],
  ], 0.038, { bevel: 0.008 });
  b.slots(BODY, 0.14, 0.214, 4, [0.014, 0.005], -0.004, 0.0192);
  b.pin(BODY, 'metalAlt', 0.229, -0.014, 0.0196, 0.003);
  b.pin(BODY, 'metalAlt', 0.104, 0, half + 0.0008, 0.0035);

  // Trigger housing with the pistol grip, trigger guard and trigger.
  b.plate(BODY, 'polymer', [[-0.15, -0.016], [0.052, -0.016], [0.052, -0.05, 0.004], [-0.15, -0.05, 0.01]], 0.034, { bevel: 0.004 });
  b.plate(BODY, 'polymer', [
    [-0.058, -0.046], [-0.112, -0.046, 0.01], [-0.146, -0.15, 0.008], [-0.104, -0.158, 0.008], [-0.074, -0.09, 0.006],
  ], 0.032, { bevel: 0.006 });
  b.plate(BODY, 'polymer', [
    [-0.06, -0.046], [0.05, -0.046], [0.05, -0.056], [0.03, -0.09, 0.008], [-0.05, -0.09, 0.006], [-0.066, -0.07],
  ], 0.012, { bevel: 0.0015, holes: [[[-0.052, -0.053], [0.04, -0.053], [0.024, -0.084, 0.006], [-0.046, -0.084, 0.006]]] });
  b.box(BODY, 'metalAlt', [0.006, 0.026, 0.006], [0, -0.065, -0.006], { rotate: [0.35, 0, 0], bevel: 0.002 });
  // Left side: selector lever on its hub with the three painted positions; housing pins.
  b.box(BODY, 'metalAlt', [0.003, 0.006, 0.028], [-0.0178, -0.03, -0.074], { rotate: [0.4, 0, 0] });
  b.pin(BODY, 'metalAlt', -0.062, -0.034, 0.0182, 0.0048);
  for (const [f, y] of [[-0.092, -0.022], [-0.098, -0.031], [-0.096, -0.041]] as const) b.box(BODY, 'accent', [0.0012, 0.0045, 0.0045], [-0.0172, y, f]);
  b.pin(BODY, 'metalAlt', 0.04, -0.028, 0.0178, 0.003);
  b.pin(BODY, 'metalAlt', -0.14, -0.028, 0.0178, 0.003);

  // Magazine well and the release paddle behind the magazine.
  b.plate(BODY, 'metal', [[0.054, -0.018], [0.108, -0.018], [0.11, -0.046, 0.003], [0.056, -0.054, 0.003]], 0.032, { bevel: 0.003 });
  b.box(BODY, 'metalAlt', [0.014, 0.018, 0.004], [0, -0.064, 0.056], { rotate: [-0.2, 0, 0] });

  // Magazine: strongly curved steel body on one arc, floor plate, witness strips on the sides and spine.
  const magazine = b.part('magazine', [0, -0.04, 0.082]);
  const arc = (radius: number): [number, number][] =>
    [0, 1, 2, 3, 4, 5].map((i) => [0.462 - radius * Math.cos(i * 0.088), -0.026 - radius * Math.sin(i * 0.088)]);
  b.plate(magazine, 'metal', [...arc(0.4), ...arc(0.362).reverse()], 0.022, { bevel: 0.003 });
  b.box(magazine, 'metal', [0.026, 0.006, 0.046], [0, -0.19, 0.116], { rotate: [0.44, 0, 0] });
  for (const x of [-0.0114, 0.0114]) b.box(magazine, 'glow', [0.0016, 0.05, 0.005], [x, -0.104, 0.08], { rotate: [0.2, 0, 0] });
  b.box(magazine, 'glow', [0.008, 0.046, 0.0016], [0, -0.1057, 0.0695], { rotate: [0.2, 0, 0] });

  // Retractable stock: two steel rails in the receiver grooves, a butt plate and its pad.
  const stock = b.part('stock', [0, 0.004, -0.15]);
  b.retractWhenAimed(stock, 0.4);
  for (const x of [-0.0225, 0.0225]) b.tube(stock, 'metalAlt', [x, 0.004, -0.338], [x, 0.004, -0.1], 0.0042, 0.0042, 8);
  b.plate(stock, 'metalAlt', [[-0.336, 0.032], [-0.336, -0.078], [-0.348, -0.078, 0.004], [-0.348, 0.032, 0.004]], 0.052, { bevel: 0.003 });
  b.plate(stock, 'rubber', [[-0.348, 0.03], [-0.348, -0.076], [-0.355, -0.07, 0.004], [-0.355, 0.024, 0.004]], 0.048, { bevel: 0.003 });
  b.wrapBox(stock, -0.32, -0.2, [0, 0.004], [0.05, 0.009]);

  ironSights(b, { lineY: 0.066, rearF: -0.118, rearBaseY: 0.044, frontF: 0.251, frontBaseY: 0.043 });

  // What the skins add.
  b.engraving(BODY, [[-0.13, -0.014], [-0.13, 0.012], [0.02, 0.012], [0.02, -0.014]], half);
  b.medallion(BODY, 0.082, -0.034, 0.016, 0.008);
  b.lightLine(BODY, [[-0.135, 0.019], [0.104, 0.019]], half + 0.0015);
  b.lightLine(BODY, [[0.12, 0.012], [0.232, 0.012]], 0.019);
  b.wrapBox(magazine, 0.088, 0.128, [0, -0.167], [0.022, 0.022]);

  triggerHand(b, { grip: [0, -0.1, -0.105], rake: 0.34, size: [0.032, 0.044] });
  supportHand(b, { at: [0, -0.03, 0.18], width: 0.038 });

  b.animations = {
    fire: {
      duration: 0.07,
      tracks: {
        bolt: [{ t: 0 }, { t: 0.024, p: [0, 0, -0.05], ease: 'out' }, { t: 0.07, p: [0, 0, 0] }],
        gun: [{ t: 0 }, { t: 0.02, p: [0, 0.0015, -0.008], r: [0.008, 0, 0], ease: 'out' }, { t: 0.07, p: [0, 0, 0], r: [0, 0, 0] }],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.1, p: [0.01, -0.015, 0], r: [0.14, 0.08, 0.3] }, { t: 0.7, p: [0.01, -0.015, 0], r: [0.14, 0.08, 0.3] },
          { t: 0.8, p: [0, -0.006, 0], r: [0.05, 0, -0.1] }, { t: 0.88, p: [0, -0.01, 0.008], r: [0.03, 0, -0.1] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        // The handle is hauled back and held, then slapped forward once the new magazine is in.
        bolt: [{ t: 0.08 }, { t: 0.16, p: [0, 0, -0.085], ease: 'out' }, { t: 0.84, p: [0, 0, -0.085] }, { t: 0.87, p: [0, 0, 0], ease: 'in' }],
        magazine: [
          { t: 0.26 }, { t: 0.36, p: [0, -0.24, 0.03], r: [0.25, 0, 0], ease: 'in' }, { t: 0.5, p: [0, -0.24, 0.03], r: [0.25, 0, 0] },
          { t: 0.66, p: [0, 0, 0], r: [0, 0, 0], ease: 'out' },
        ],
        'arm-support': [
          { t: 0 }, { t: 0.08, p: [-0.03, 0.085, 0.02] }, { t: 0.16, p: [-0.03, 0.085, -0.065], ease: 'out' }, { t: 0.26, p: [0.02, -0.08, -0.07] },
          { t: 0.36, p: [0.02, -0.31, -0.04], ease: 'in' }, { t: 0.5, p: [0.02, -0.31, -0.04] }, { t: 0.66, p: [0.02, -0.08, -0.07], ease: 'out' },
          { t: 0.72, p: [0.02, -0.08, -0.07] }, { t: 0.82, p: [-0.03, 0.12, -0.06] }, { t: 0.87, p: [-0.03, 0.07, -0.05], ease: 'in' }, { t: 1, p: [0, 0, 0] },
        ],
      },
    },
  };
}
