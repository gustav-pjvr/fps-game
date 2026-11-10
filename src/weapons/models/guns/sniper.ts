import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportHand, triggerHand } from '../kit/hands.ts';
import { scope } from '../kit/sights.ts';

/** L7 Sniper Rifle: a bolt-action precision rifle in a chassis, with a 62 cm fluted barrel under a
 * large muzzle brake, a five round box magazine, a folded bipod, an adjustable skeleton stock and
 * a big telescopic sight. Bore line at y = 0. */
export function buildSniper(b: GunBuilder): void {
  b.tuning = { scale: 1, offset: [-0.07, 0.05, 0.14] };
  const half = 0.023;

  // Round action with its scope rail; the ejection port on the right.
  b.revolve(BODY, 'metal', [[-0.097, 0.0165], [-0.09, 0.0178], [0.13, 0.0178], [0.14, 0.0165]], { y: 0, segments: 16 });
  b.rail(BODY, 'metal', -0.09, 0.172, 0.0275);
  b.box(BODY, 'void', [0.0022, 0.013, 0.078], [0.0172, 0.004, 0.055]);
  // Left side: safety lever with its painted dot, bolt release, action screws.
  b.box(BODY, 'metalAlt', [0.003, 0.007, 0.024], [-0.0182, 0.004, -0.066], { rotate: [0.4, 0, 0] });
  b.box(BODY, 'accent', [0.0012, 0.0045, 0.0045], [-0.0186, 0.002, -0.044]);
  b.box(BODY, 'metalAlt', [0.003, 0.008, 0.016], [-0.0182, 0.003, 0.02]);
  b.pin(BODY, 'metalAlt', -0.1, -0.03, half - 0.0004, 0.0036);
  b.pin(BODY, 'metalAlt', 0.125, -0.03, half - 0.0004, 0.0036);
  b.witness(BODY, -0.03, 0.02, -0.01, half - 0.0006, 0.005);

  // Chassis: the bed under the action running forward into a slotted fore-end; the barrel floats
  // in its channel.
  b.plate(BODY, 'furniture', [
    [-0.125, -0.05, 0.008], [-0.125, -0.002, 0.004], [0.455, -0.002, 0.004], [0.462, -0.012], [0.462, -0.03, 0.008],
    [0.42, -0.046, 0.01], [0.125, -0.052], [-0.06, -0.052],
  ], half * 2, { bevel: 0.004 });
  b.box(BODY, 'void', [0.034, 0.0016, 0.3], [0, -0.0014, 0.305]);
  b.plate(BODY, 'metal', [[0.034, -0.026], [0.126, -0.026], [0.126, -0.058, 0.004], [0.034, -0.058, 0.004]], half * 2 + 0.003, { bevel: 0.002 });
  b.slots(BODY, 0.2, 0.42, 6, [0.026, 0.009], -0.022, half + 0.0002);
  b.pin(BODY, 'metalAlt', 0.445, -0.018, half + 0.0004, 0.0055);

  // Heavy barrel, fluted along its middle, and the brake.
  b.revolve(BODY, 'metalAlt', [[0.13, 0.0155], [0.2, 0.0155], [0.215, 0.0125], [0.7, 0.0125], [0.71, 0.0115], [0.74, 0.0115]], { y: 0 });
  for (let k = 0; k < 6; k++) {
    const a = (k + 0.5) / 6 * Math.PI * 2;
    b.box(BODY, 'void', [0.0034, 0.0012, 0.44], [Math.sin(a) * 0.0122, Math.cos(a) * 0.0122, 0.46], { rotate: [0, 0, a] });
  }
  b.muzzle = [0, 0, b.muzzleDevice(BODY, 0.74, 0, 0.0125, 'brake')];

  // Bipod folded forward under the barrel.
  b.box(BODY, 'metal', [0.036, 0.014, 0.026], [0, -0.052, 0.4], { bevel: 0.003 });
  for (const x of [-1, 1]) {
    b.tube(BODY, 'metalAlt', [x * 0.013, -0.056, 0.4], [x * 0.016, -0.046, 0.63], 0.0055, 0.0055, 8);
    b.tube(BODY, 'rubber', [x * 0.016, -0.046, 0.626], [x * 0.016, -0.0455, 0.648], 0.0082, 0.0082, 8);
  }

  // Bolt: body, shroud and the handle on the right. It turns about the bore.
  const bolt = b.part('bolt', [0, 0, -0.1]);
  b.revolve(bolt, 'metalAlt', [[-0.14, 0.009], [-0.134, 0.0122], [-0.1, 0.0122], [-0.1, 0.0098], [0.1, 0.0098]], { y: 0, segments: 12 });
  b.box(bolt, 'metalAlt', [0.003, 0.009, 0.07], [0.0168, 0.004, 0.055]);
  b.tube(bolt, 'metalAlt', [0.008, -0.004, -0.104], [0.05, -0.022, -0.109], 0.0046, 0.0042, 8);
  b.tube(bolt, 'metalAlt', [0.046, -0.02, -0.1085], [0.064, -0.029, -0.111], 0.0095, 0.008, 10);

  // Pistol grip, trigger guard, trigger, magazine catch.
  b.plate(BODY, 'polymer', [
    [-0.066, -0.05], [-0.118, -0.05, 0.01], [-0.142, -0.152, 0.008], [-0.102, -0.16, 0.008], [-0.078, -0.09, 0.008],
  ], 0.032, { bevel: 0.006 });
  b.plate(BODY, 'metal', [
    [-0.07, -0.05], [0.035, -0.05], [0.035, -0.06], [0.02, -0.088, 0.006], [-0.05, -0.088, 0.006], [-0.07, -0.07],
  ], 0.012, { bevel: 0.0015, holes: [[[-0.06, -0.055], [0.026, -0.055], [0.014, -0.082, 0.005], [-0.046, -0.082, 0.005]]] });
  b.box(BODY, 'metalAlt', [0.006, 0.024, 0.006], [0, -0.066, -0.012], { rotate: [0.3, 0, 0], bevel: 0.002 });
  b.box(BODY, 'metalAlt', [0.01, 0.016, 0.004], [0, -0.064, 0.039], { rotate: [-0.2, 0, 0] });

  // Five round box magazine with its floor plate.
  const magazine = b.part('magazine', [0, -0.05, 0.08]);
  b.plate(magazine, 'polymer', [[0.045, -0.045], [0.115, -0.045], [0.118, -0.1, 0.004], [0.05, -0.104, 0.004]], 0.03, { bevel: 0.003 });
  b.box(magazine, 'polymer', [0.032, 0.006, 0.074], [0, -0.104, 0.084], { rotate: [0.06, 0, 0] });

  // Skeleton stock behind the grip: strut, cheek riser on its adjuster, spacer, butt pad, monopod.
  const stock = b.part('stock', [0, 0, -0.125]);
  b.retractWhenAimed(stock, 0.4);
  b.plate(stock, 'furniture', [
    [-0.12, -0.006], [-0.4, -0.006, 0.004], [-0.4, -0.12, 0.006], [-0.375, -0.12], [-0.3, -0.062, 0.02], [-0.16, -0.054], [-0.12, -0.048],
  ], 0.036, { bevel: 0.004, holes: [[[-0.2, -0.02], [-0.36, -0.02, 0.004], [-0.36, -0.085, 0.004], [-0.31, -0.045, 0.01], [-0.2, -0.04]]] });
  b.plate(stock, 'polymer', [[-0.238, -0.004], [-0.242, 0.018, 0.008], [-0.35, 0.018, 0.008], [-0.354, -0.004]], 0.04, { bevel: 0.007 });
  b.pin(stock, 'metalAlt', -0.296, -0.012, 0.0205, 0.0065);
  b.box(stock, 'metalAlt', [0.03, 0.104, 0.008], [0, -0.062, -0.404]);
  b.box(stock, 'rubber', [0.04, 0.126, 0.016], [0, -0.062, -0.416], { bevel: 0.005 });
  b.tube(stock, 'metalAlt', [0, -0.118, -0.386], [0, -0.142, -0.386], 0.0065, 0.0065, 8);
  b.ring(stock, 'metalAlt', [-0.0195, -0.03, -0.38], 0.006, 0.0012);

  scope(b, { y: 0.06, rearF: -0.085, frontF: 0.275, baseY: 0.0275, tubeRadius: 0.015, objectiveRadius: 0.027 });

  // What the skins add.
  b.engraving(BODY, [[-0.11, -0.046], [-0.11, -0.018], [0.03, -0.018], [0.03, -0.046]], half);
  b.medallion(stock, -0.381, -0.05, 0.018, 0.011);
  b.lightLine(BODY, [[-0.12, -0.006], [0.455, -0.006]], half);
  b.wrap(BODY, 0.5, 0.62, 0, 0.0125);
  b.wrap(BODY, 0.111, 0.148, 0.06, 0.015);

  triggerHand(b, { grip: [0, -0.104, -0.108], rake: 0.24, size: [0.032, 0.042] });
  supportHand(b, { at: [0, -0.05, 0.27], width: 0.046 });

  b.animations = {
    fire: {
      duration: 1.1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.07, p: [0, 0.014, -0.05], r: [0.1, 0, 0], ease: 'out' }, { t: 0.3, p: [0, 0, 0], r: [0, 0, 0] },
          { t: 0.48, p: [0, -0.004, -0.004], r: [0.02, 0, 0.07] }, { t: 0.86, p: [0, -0.004, 0], r: [0.02, 0, 0.07] }, { t: 1.08, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        // Handle up, bolt back, bolt forward, handle down.
        bolt: [
          { t: 0.34 }, { t: 0.46, r: [0, 0, -1], ease: 'out' }, { t: 0.6, p: [0, 0, -0.09], ease: 'in' }, { t: 0.66, p: [0, 0, -0.09] },
          { t: 0.82, p: [0, 0, 0], ease: 'in' }, { t: 0.94, r: [0, 0, 0], ease: 'in' },
        ],
        // The trigger hand leaves the grip to work it.
        'arm-trigger': [
          { t: 0.2 }, { t: 0.34, p: [0.04, 0.06, 0] }, { t: 0.46, p: [0.04, 0.112, 0], ease: 'out' }, { t: 0.6, p: [0.04, 0.112, -0.09], ease: 'in' },
          { t: 0.66, p: [0.04, 0.112, -0.09] }, { t: 0.82, p: [0.04, 0.112, 0], ease: 'in' }, { t: 0.94, p: [0.04, 0.06, 0], ease: 'in' }, { t: 1.08, p: [0, 0, 0] },
        ],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.1, p: [0.01, -0.02, 0], r: [0.16, 0.08, 0.3] }, { t: 0.7, p: [0.01, -0.02, 0], r: [0.16, 0.08, 0.3] },
          { t: 0.8, p: [0, -0.006, 0], r: [0.04, 0, 0.08] }, { t: 0.94, p: [0, -0.006, 0], r: [0.04, 0, 0.08] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        // Bolt opened first, closed on the fresh magazine.
        bolt: [
          { t: 0.04 }, { t: 0.1, r: [0, 0, -1], ease: 'out' }, { t: 0.17, p: [0, 0, -0.09], ease: 'in' },
          { t: 0.78, p: [0, 0, -0.09] }, { t: 0.87, p: [0, 0, 0], ease: 'in' }, { t: 0.93, r: [0, 0, 0], ease: 'in' },
        ],
        'arm-trigger': [
          { t: 0 }, { t: 0.04, p: [0.04, 0.06, 0] }, { t: 0.1, p: [0.04, 0.112, 0] }, { t: 0.17, p: [0.04, 0.112, -0.09] }, { t: 0.26, p: [0, 0, 0] },
          { t: 0.7 }, { t: 0.78, p: [0.04, 0.112, -0.09] }, { t: 0.87, p: [0.04, 0.112, 0], ease: 'in' }, { t: 0.93, p: [0.04, 0.06, 0], ease: 'in' }, { t: 1, p: [0, 0, 0] },
        ],
        magazine: [
          { t: 0.22 }, { t: 0.32, p: [0, -0.2, -0.01], r: [-0.15, 0, 0], ease: 'in' }, { t: 0.46, p: [0, -0.2, -0.01], r: [-0.15, 0, 0] },
          { t: 0.62, p: [0, 0, 0], r: [0, 0, 0], ease: 'out' },
        ],
        'arm-support': [
          { t: 0.1 }, { t: 0.22, p: [0.02, -0.06, -0.2] }, { t: 0.32, p: [0.02, -0.26, -0.21], ease: 'in' }, { t: 0.46, p: [0.02, -0.26, -0.21] },
          { t: 0.62, p: [0.02, -0.06, -0.2], ease: 'out' }, { t: 0.68, p: [0.02, -0.06, -0.2] }, { t: 0.8, p: [0, 0, 0] },
        ],
      },
    },
  };
}
