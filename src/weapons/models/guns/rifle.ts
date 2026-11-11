import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportHand, triggerHand } from '../kit/hands.ts';
import { ironSights } from '../kit/sights.ts';

/** VR-4 Assault Rifle: a gas-operated carbine with a flat-top receiver, a free-floated slotted
 * handguard, a curved 30 round magazine and a collapsible stock. Bore line at y = 0. */
export function buildRifle(b: GunBuilder): void {
  b.tuning = { scale: 1, offset: [-0.07, 0.05, 0.14] };
  const half = 0.021;

  // Upper receiver, flat top, with its rail.
  b.plate(BODY, 'metal', [
    [-0.172, -0.012], [-0.172, 0.036, 0.008], [-0.152, 0.05, 0.004], [0.166, 0.05], [0.172, 0.042], [0.172, -0.012],
  ], half * 2, { bevel: 0.004 });
  b.rail(BODY, 'metal', -0.15, 0.166, 0.0595);
  // Lower receiver with the magazine well.
  b.plate(BODY, 'metal', [
    [-0.172, -0.012], [0.114, -0.012], [0.114, -0.076, 0.004], [0.06, -0.082, 0.004], [0.052, -0.052],
    [-0.06, -0.052], [-0.086, -0.044], [-0.172, -0.044, 0.01],
  ], 0.037, { bevel: 0.003 });
  // Ejection port and the bolt carrier showing through it (right side), with the brass deflector.
  b.box(BODY, 'void', [0.002, 0.019, 0.072], [half + 0.0002, 0.019, 0.046]);
  const bolt = b.part('bolt', [half - 0.001, 0.019, 0.046]);
  b.box(bolt, 'metalAlt', [0.003, 0.015, 0.066], [half - 0.0006, 0.019, 0.046]);
  b.box(BODY, 'metal', [0.008, 0.014, 0.016], [half + 0.002, 0.02, -0.004], { rotate: [0, 0.5, 0], bevel: 0.002 });
  b.tube(BODY, 'metalAlt', [half - 0.002, 0.024, -0.075], [half + 0.012, 0.018, -0.098], 0.0058, 0.0058, 8);
  // Charging handle at the back of the rail.
  const charging = b.part('charging', [0, 0.046, -0.168]);
  b.box(charging, 'metalAlt', [0.052, 0.008, 0.018], [0, 0.046, -0.168], { bevel: 0.002 });
  b.box(charging, 'metalAlt', [0.012, 0.007, 0.05], [0, 0.047, -0.14]);
  // Left side controls: selector, bolt catch; pins through both sides.
  b.box(BODY, 'metalAlt', [0.003, 0.006, 0.024], [-half + 0.0018, -0.022, -0.072], { rotate: [0.5, 0, 0] });
  b.box(BODY, 'accent', [0.0012, 0.0045, 0.0045], [-half + 0.0022, -0.01, -0.052]);
  b.box(BODY, 'metalAlt', [0.003, 0.022, 0.012], [-half + 0.0018, -0.004, 0.052], { bevel: 0.001 });
  b.box(BODY, 'metalAlt', [0.003, 0.008, 0.012], [half - 0.0025, -0.03, 0.03], { bevel: 0.001 });
  b.pin(BODY, 'metalAlt', -0.132, -0.03, 0.0192, 0.0036);
  b.pin(BODY, 'metalAlt', 0.1, -0.03, 0.0192, 0.0036);

  // Pistol grip, trigger guard, trigger.
  b.plate(BODY, 'polymer', [
    [-0.062, -0.05], [-0.108, -0.05, 0.012], [-0.138, -0.152, 0.008], [-0.1, -0.16, 0.008], [-0.07, -0.088, 0.006],
  ], 0.03, { bevel: 0.005 });
  b.plate(BODY, 'metal', [
    [-0.066, -0.05], [0.052, -0.05], [0.052, -0.058], [0.026, -0.09, 0.006], [-0.05, -0.09, 0.006], [-0.068, -0.074],
  ], 0.011, { bevel: 0.0015, holes: [[[-0.056, -0.055], [0.04, -0.055], [0.022, -0.084, 0.006], [-0.048, -0.084, 0.006]]] });
  b.box(BODY, 'metalAlt', [0.006, 0.024, 0.006], [0, -0.066, -0.014], { rotate: [0.35, 0, 0], bevel: 0.002 });

  // Magazine: curved body, floor plate, a witness strip on each side.
  const magazine = b.part('magazine', [0, -0.07, 0.085]);
  b.plate(magazine, 'polymer', [
    [0.064, -0.058], [0.108, -0.058], [0.119, -0.13], [0.14, -0.2, 0.004], [0.094, -0.212, 0.004], [0.075, -0.135],
  ], 0.025, { bevel: 0.003 });
  b.box(magazine, 'rubber', [0.029, 0.01, 0.052], [0, -0.209, 0.117], { rotate: [0.25, 0, 0], bevel: 0.003 });
  for (const x of [-0.0128, 0.0128]) {
    b.box(magazine, 'glow', [0.0016, 0.07, 0.006], [x, -0.132, 0.1], { rotate: [0.2, 0, 0] });
    for (const dy of [0, 0.03, 0.06]) b.box(magazine, 'void', [0.0014, 0.0025, 0.034], [x, -0.1 - dy, 0.094 + dy * 0.3], { rotate: [0.2, 0, 0] });
  }

  // Buffer tube, castle nut, collapsible stock with a butt pad: one part, out of view when aimed.
  const stock = b.part('stock', [0, 0.012, -0.172]);
  b.retractWhenAimed(stock, 0.4);
  b.revolve(stock, 'metalAlt', [[-0.362, 0.0145], [-0.172, 0.0145]], { y: 0.012 });
  b.revolve(stock, 'metalAlt', [[-0.186, 0.0195], [-0.174, 0.0195]], { y: 0.012, segments: 10 });
  b.plate(stock, 'furniture', [
    [-0.215, 0.036], [-0.356, 0.036, 0.006], [-0.372, 0.022], [-0.372, -0.086, 0.006], [-0.345, -0.086],
    [-0.292, -0.022], [-0.215, -0.01],
  ], 0.04, { bevel: 0.004, holes: [[[-0.35, -0.066], [-0.35, -0.012], [-0.305, -0.012, 0.004]]] });
  b.box(stock, 'rubber', [0.042, 0.116, 0.012], [0, -0.03, -0.378], { bevel: 0.004 });
  b.box(stock, 'metalAlt', [0.012, 0.008, 0.03], [0, -0.016, -0.25], { bevel: 0.002 });
  b.wrapBox(stock, -0.35, -0.25, [0, 0.008], [0.04, 0.056]);

  // Handguard with vent slots and a full-length top rail; barrel and muzzle device.
  b.plate(BODY, 'furniture', [
    [0.172, -0.03, 0.006], [0.172, 0.05], [0.462, 0.05], [0.462, -0.022], [0.446, -0.03],
  ], 0.046, { bevel: 0.007 });
  b.rail(BODY, 'metal', 0.176, 0.458, 0.0595);
  b.slots(BODY, 0.205, 0.43, 7, [0.026, 0.008], 0.022, 0.0232);
  b.slots(BODY, 0.205, 0.43, 7, [0.026, 0.008], -0.006, 0.0232);
  b.revolve(BODY, 'metalAlt', [[0.17, 0.011], [0.462, 0.011], [0.462, 0.0095], [0.6, 0.0095]], { y: 0 });
  b.muzzle = [0, 0, b.muzzleDevice(BODY, 0.6, 0, 0.0095, 'flash')];

  ironSights(b, { lineY: 0.087, rearF: -0.138, rearBaseY: 0.0595, frontF: 0.436, frontBaseY: 0.0595 });

  // What the skins add.
  b.engraving(BODY, [[-0.145, -0.004], [-0.145, 0.04], [0.15, 0.04], [0.15, -0.004]], half);
  b.medallion(BODY, -0.1, -0.1, 0.015, 0.0095);
  b.lightLine(BODY, [[-0.16, 0.03], [0.165, 0.03], [0.2, 0.04], [0.455, 0.04]], 0.0232);
  b.wrapBox(BODY, 0.36, 0.45, [0, 0.01], [0.046, 0.08]);

  triggerHand(b, { grip: [0, -0.105, -0.1], rake: 0.3, size: [0.03, 0.045] });
  supportHand(b, { at: [0, -0.03, 0.3], width: 0.046 });

  b.animations = {
    fire: {
      duration: 0.09,
      tracks: {
        bolt: [{ t: 0 }, { t: 0.03, p: [0, 0, -0.056], ease: 'out' }, { t: 0.09, p: [0, 0, 0] }],
        gun: [{ t: 0 }, { t: 0.025, p: [0, 0.002, -0.012], r: [0.012, 0, 0], ease: 'out' }, { t: 0.09, p: [0, 0, 0], r: [0, 0, 0] }],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.12, p: [0.01, -0.02, 0], r: [0.18, 0.1, 0.35] }, { t: 0.66, p: [0.01, -0.02, 0], r: [0.18, 0.1, 0.35] },
          // Still rolled a little, its left side to the shooter, for the slap on the bolt catch.
          { t: 0.8, p: [0, -0.008, 0], r: [0.06, 0.03, 0.2] }, { t: 0.87, p: [0.005, -0.008, 0], r: [0.06, 0.03, 0.24] },
          { t: 0.92, p: [0, -0.008, 0.004], r: [0.06, 0.03, 0.2] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        magazine: [
          { t: 0.14 }, { t: 0.26, p: [0, -0.24, 0.01], r: [0.2, 0, 0], ease: 'in' }, { t: 0.42, p: [0, -0.24, 0.01], r: [0.2, 0, 0] },
          { t: 0.6, p: [0, 0, 0], r: [0, 0, 0], ease: 'out' },
        ],
        'arm-support': [
          { t: 0 }, { t: 0.14, p: [0.02, -0.07, -0.2] }, { t: 0.26, p: [0.02, -0.29, -0.19], ease: 'in' }, { t: 0.42, p: [0.02, -0.29, -0.19] },
          { t: 0.6, p: [0.02, -0.07, -0.2], ease: 'out' }, { t: 0.68, p: [0.02, -0.07, -0.2] },
          // The support hand never crosses the gun: it comes out to the left of the receiver and
          // slaps the bolt catch there (the hand used to pass through the rail to reach the
          // charging handle on top).
          { t: 0.8, p: [-0.085, -0.005, -0.25] }, { t: 0.86, p: [-0.05, 0, -0.25], ease: 'in' }, { t: 0.91, p: [-0.075, -0.005, -0.24] },
          { t: 1, p: [0, 0, 0] },
        ],
        // Locked open on the empty magazine; the catch lets it run home on the fresh one.
        bolt: [{ t: 0.04 }, { t: 0.1, p: [0, 0, -0.056], ease: 'out' }, { t: 0.86, p: [0, 0, -0.056] }, { t: 0.9, p: [0, 0, 0], ease: 'in' }],
      },
    },
  };
}
