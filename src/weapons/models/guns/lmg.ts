import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportHand, triggerHand } from '../kit/hands.ts';
import { ironSights } from '../kit/sights.ts';

/** R60 Light Machine Gun: a belt-fed, gas-operated gun. A long receiver under a hinged feed cover,
 * an ammunition box hung below it with the belt running up the left side into the feed tray, a
 * heavy barrel in a perforated heat shield, a carrying handle folded flat, a folded bipod and a
 * skeleton stock with a shoulder rest. Bore line at y = 0; the gas tube runs under it at y = -0.027. */
export function buildLmg(b: GunBuilder): void {
  b.tuning = { scale: 1, offset: [-0.07, 0.05, 0.14] };
  const half = 0.023, gas = -0.027;

  // Receiver: a long riveted box, the feed tray on top, the rear sight base behind the cover.
  b.plate(BODY, 'metal', [[-0.165, -0.04, 0.006], [-0.165, 0.03, 0.008], [0.2, 0.03], [0.2, -0.04]], half * 2, { bevel: 0.003 });
  b.box(BODY, 'metalAlt', [0.04, 0.003, 0.1], [0, 0.0308, 0.1]);
  b.box(BODY, 'metal', [0.026, 0.012, 0.032], [0, 0.036, -0.096], { bevel: 0.002 });
  b.pin(BODY, 'metalAlt', 0.185, 0.035, half + 0.0025, 0.004);
  for (const [f, y] of [[-0.145, -0.022], [0.176, -0.026], [0.176, 0.012], [0.02, 0.014]] as const) b.pin(BODY, 'metalAlt', f, y, half + 0.0004, 0.003);
  // Left side: the feed opening, the cross-bolt safety with its painted ring, the witness light.
  b.box(BODY, 'void', [0.0016, 0.012, 0.062], [-half - 0.0002, 0.021, 0.105]);
  b.pin(BODY, 'metalAlt', -0.112, -0.026, half + 0.002, 0.005);
  b.box(BODY, 'accent', [0.0012, 0.014, 0.014], [-half - 0.0002, -0.026, -0.112]);
  b.witness(BODY, -0.15, -0.1, 0.008, half - 0.0006, 0.006);
  // Right side: the ejection port, the charging slot and its handle.
  b.box(BODY, 'void', [0.0016, 0.014, 0.06], [half + 0.0002, -0.022, 0.075]);
  b.box(BODY, 'void', [0.0016, 0.005, 0.17], [half + 0.0002, 0.008, 0.05]);
  const bolt = b.part('bolt', [half, 0.008, 0.12]);
  b.box(bolt, 'metalAlt', [0.004, 0.012, 0.022], [half + 0.002, 0.008, 0.12]);
  b.tube(bolt, 'metalAlt', [half + 0.003, 0.008, 0.12], [half + 0.02, 0.008, 0.118], 0.0045, 0.0045, 8);
  b.tube(bolt, 'metalAlt', [half + 0.017, 0.008, 0.1183], [half + 0.027, 0.008, 0.1173], 0.007, 0.0062, 8);

  // Feed cover, hinged at its front: ribbed top, latch at the back.
  const cover = b.part('cover', [0, 0.034, 0.185]);
  b.plate(cover, 'metal', [[-0.06, 0.03], [-0.064, 0.042, 0.006], [-0.03, 0.05, 0.006], [0.15, 0.05, 0.004], [0.19, 0.04], [0.19, 0.03]], 0.048, { bevel: 0.004 });
  for (const x of [-0.012, 0.012]) b.box(cover, 'metal', [0.006, 0.003, 0.15], [x, 0.0505, 0.06]);
  b.box(cover, 'metalAlt', [0.03, 0.009, 0.01], [0, 0.038, -0.066]);

  // Trigger housing: pistol grip, guard and trigger.
  b.plate(BODY, 'polymer', [
    [-0.062, -0.04], [-0.112, -0.04, 0.01], [-0.142, -0.14, 0.008], [-0.104, -0.148, 0.008], [-0.074, -0.08, 0.006],
  ], 0.032, { bevel: 0.006 });
  b.plate(BODY, 'polymer', [
    [-0.066, -0.04], [0.036, -0.04], [0.036, -0.05], [0.02, -0.082, 0.006], [-0.05, -0.082, 0.006], [-0.068, -0.066],
  ], 0.012, { bevel: 0.0015, holes: [[[-0.057, -0.046], [0.027, -0.046], [0.014, -0.076, 0.005], [-0.046, -0.076, 0.005]]] });
  b.box(BODY, 'metalAlt', [0.006, 0.024, 0.006], [0, -0.058, -0.012], { rotate: [0.35, 0, 0], bevel: 0.002 });

  // Ammunition box hung under the receiver, and the belt climbing the left side onto the tray.
  const magazine = b.part('magazine', [-0.02, -0.04, 0.11]);
  b.box(magazine, 'polymer', [0.078, 0.105, 0.135], [-0.02, -0.0955, 0.11], { bevel: 0.006 });
  b.box(magazine, 'polymer', [0.08, 0.007, 0.137], [-0.02, -0.052, 0.11]);
  b.box(magazine, 'metalAlt', [0.003, 0.022, 0.022], [-0.0595, -0.062, 0.11]);
  b.box(magazine, 'metalAlt', [0.03, 0.006, 0.05], [0.002, -0.042, 0.11]);
  const belt: [number, number][] = [
    [-0.046, -0.04], [-0.037, -0.034], [-0.0295, -0.026], [-0.0278, -0.016], [-0.0278, -0.006], [-0.0278, 0.004],
    [-0.0278, 0.014], [-0.0272, 0.024], [-0.021, 0.0335], [-0.011, 0.0362], [-0.001, 0.0362],
  ];
  for (const [x, y] of belt) {
    b.tube(magazine, 'accent', [x, y, 0.082], [x, y, 0.122], 0.0043, 0.0043, 6);
    b.tube(magazine, 'accent', [x, y, 0.122], [x, y, 0.138], 0.0034, 0.0014, 6);
  }

  // Skeleton stock: butt pad, hinged shoulder rest on top.
  const stock = b.part('stock', [0, 0, -0.165]);
  b.retractWhenAimed(stock, 0.4);
  b.plate(stock, 'furniture', [
    [-0.16, 0.022], [-0.36, 0.022, 0.006], [-0.372, 0.01], [-0.372, -0.1, 0.006], [-0.35, -0.104], [-0.26, -0.045, 0.015], [-0.16, -0.036],
  ], 0.04, { bevel: 0.006, holes: [[[-0.2, 0.008], [-0.34, 0.008, 0.004], [-0.34, -0.07, 0.004], [-0.27, -0.025, 0.008], [-0.2, -0.02]]] });
  b.box(stock, 'rubber', [0.042, 0.126, 0.012], [0, -0.04, -0.378], { bevel: 0.004 });
  b.box(stock, 'metalAlt', [0.03, 0.003, 0.06], [0, 0.0245, -0.35], { rotate: [-0.04, 0, 0] });
  b.tube(stock, 'metalAlt', [-0.017, 0.024, -0.378], [0.017, 0.024, -0.378], 0.004, 0.004, 8);

  // Heavy barrel in its perforated heat shield; the carrying handle lies folded on the shield.
  b.revolve(BODY, 'metalAlt', [[0.2, 0.014], [0.235, 0.014], [0.235, 0.0118], [0.62, 0.0118], [0.62, 0.0105], [0.66, 0.0105]], { y: 0 });
  b.revolve(BODY, 'metal', [[0.24, 0.0185], [0.47, 0.0185]], { y: 0, bore: 0.0165 });
  b.slots(BODY, 0.262, 0.448, 8, [0.013, 0.008], 0, 0.0186);
  b.slots(BODY, 0.262, 0.448, 8, [0.013, 0.008], 0, 0.0186, 'top');
  b.box(BODY, 'metalAlt', [0.014, 0.012, 0.014], [-0.008, 0.016, 0.222]);
  b.tube(BODY, 'metalAlt', [-0.008, 0.02, 0.222], [-0.016, 0.023, 0.3], 0.0035, 0.0035, 6);
  b.tube(BODY, 'polymer', [-0.0155, 0.0228, 0.29], [-0.017, 0.0232, 0.372], 0.0082, 0.0082, 10);
  b.muzzle = [0, 0, b.muzzleDevice(BODY, 0.66, 0, 0.0105, 'flash')];

  // Gas tube and gas block under the barrel, the handguard, the front sight block.
  b.revolve(BODY, 'metalAlt', [[0.2, 0.008], [0.5, 0.008]], { y: gas, segments: 10 });
  b.plate(BODY, 'metal', [[0.49, -0.038, 0.003], [0.49, 0.013, 0.003], [0.52, 0.013, 0.003], [0.52, -0.038, 0.003]], 0.02, { bevel: 0.003 });
  b.plate(BODY, 'furniture', [[0.2, -0.052, 0.006], [0.2, -0.016], [0.37, -0.016], [0.37, -0.04], [0.355, -0.052, 0.006]], 0.044, { bevel: 0.007 });
  b.slots(BODY, 0.232, 0.34, 5, [0.012, 0.004], -0.034, 0.0222);
  b.plate(BODY, 'metal', [[0.582, -0.012, 0.003], [0.59, 0.046, 0.003], [0.61, 0.046, 0.003], [0.618, -0.012, 0.003]], 0.016, { bevel: 0.003 });

  // Bipod folded forward under the gas tube.
  b.box(BODY, 'metalAlt', [0.034, 0.014, 0.016], [0, -0.041, 0.384]);
  for (const x of [-1, 1]) {
    b.tube(BODY, 'metalAlt', [x * 0.013, -0.045, 0.388], [x * 0.016, -0.041, 0.63], 0.0055, 0.0055, 8);
    b.tube(BODY, 'metalAlt', [x * 0.016, -0.041, 0.626], [x * 0.016, -0.0408, 0.646], 0.0085, 0.0085, 8);
  }

  ironSights(b, { lineY: 0.074, rearF: -0.096, rearBaseY: 0.042, frontF: 0.6, frontBaseY: 0.046 });

  // What the skins add.
  b.engraving(BODY, [[-0.09, -0.034], [-0.09, 0], [0.03, 0], [0.03, -0.034]], half);
  b.medallion(stock, -0.356, -0.03, 0.02, 0.011);
  b.lightLine(BODY, [[-0.16, -0.012], [0.195, -0.012]], half);
  b.lightLine(BODY, [[0.245, 0.006], [0.465, 0.006]], 0.0175);
  b.wrap(BODY, 0.53, 0.578, 0, 0.0118);

  triggerHand(b, { grip: [0, -0.094, -0.104], rake: 0.3, size: [0.032, 0.045] });
  supportHand(b, { at: [0, -0.052, 0.285], width: 0.044 });

  b.animations = {
    fire: {
      duration: 0.1,
      tracks: {
        bolt: [{ t: 0 }, { t: 0.03, p: [0, 0, -0.03], ease: 'out' }, { t: 0.08, p: [0, 0, 0], ease: 'in' }],
        gun: [{ t: 0 }, { t: 0.025, p: [0, 0.002, -0.01], r: [0.01, 0, 0], ease: 'out' }, { t: 0.1, p: [0, 0, 0], r: [0, 0, 0] }],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.08, p: [0.01, -0.03, 0], r: [0.14, 0.12, 0.4] }, { t: 0.74, p: [0.01, -0.03, 0], r: [0.14, 0.12, 0.4] },
          // Upright again, turned a touch to show its right side while the right hand racks it.
          { t: 0.82, p: [0, -0.01, 0], r: [0.05, 0, -0.1] }, { t: 0.95, p: [0, -0.01, 0.004], r: [0.05, 0, -0.1] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        // Cover up, box off, new box on with its belt laid in the tray, cover slapped shut.
        cover: [{ t: 0.1 }, { t: 0.17, r: [-1, 0, 0], ease: 'out' }, { t: 0.66, r: [-1, 0, 0] }, { t: 0.72, r: [0, 0, 0], ease: 'in' }],
        magazine: [
          { t: 0.2 }, { t: 0.3, p: [-0.04, -0.3, -0.02], ease: 'in' }, { t: 0.4, p: [-0.04, -0.3, -0.02] }, { t: 0.52, p: [0, 0, 0], ease: 'out' },
        ],
        'arm-support': [
          { t: 0 }, { t: 0.1, p: [0.02, 0.1, -0.3] }, { t: 0.17, p: [0.02, 0.17, -0.24], ease: 'out' },
          { t: 0.2, p: [-0.02, -0.06, -0.17] }, { t: 0.3, p: [-0.06, -0.36, -0.19], ease: 'in' }, { t: 0.4, p: [-0.06, -0.36, -0.19] },
          { t: 0.52, p: [-0.02, -0.06, -0.17], ease: 'out' }, { t: 0.58, p: [-0.01, 0.07, -0.17] }, { t: 0.63, p: [-0.01, 0.07, -0.17] },
          { t: 0.66, p: [0.02, 0.17, -0.24] }, { t: 0.72, p: [0.02, 0.1, -0.3], ease: 'in' }, { t: 0.75, p: [0.02, 0.1, -0.3] },
          // Back under the handguard to hold the gun: it never reaches across to the right side.
          { t: 0.84, p: [0, 0, 0] },
        ],
        // The charging handle is on the right, so the right hand leaves the grip and runs it back
        // and home.
        'arm-trigger': [
          { t: 0.74 }, { t: 0.84, p: [0.035, 0.087, 0.214] }, { t: 0.9, p: [0.035, 0.087, 0.094], ease: 'out' }, { t: 0.95, p: [0.035, 0.087, 0.2] }, { t: 1, p: [0, 0, 0] },
        ],
        bolt: [{ t: 0.84 }, { t: 0.9, p: [0, 0, -0.12], ease: 'out' }, { t: 0.95, p: [0, 0, 0], ease: 'in' }],
      },
    },
  };
}
