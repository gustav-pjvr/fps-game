import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportWrap, triggerHand } from '../kit/hands.ts';
import { ironSights } from '../kit/sights.ts';

/** Hornet Machine Pistol: a full-auto service pistol with a long lightened slide, a ported
 * compensator on the barrel, a fire selector on the slide and an extended 20 round magazine that
 * stands well below the grip. Bore line at y = 0.03. */
export function buildMachinePistol(b: GunBuilder): void {
  b.tuning = { scale: 1.1, offset: [-0.07, 0.03, 0.08] };
  const half = 0.014;

  // Frame: full-length dust cover with an accessory rail, squared trigger guard, raked grip.
  b.plate(BODY, 'polymer', [
    [-0.092, 0.012], [0.112, 0.012], [0.112, -0.006, 0.003], [0.104, -0.014], [0.044, -0.014],
    [0.04, -0.02], [-0.03, -0.02], [-0.03, -0.012], [-0.092, -0.012, 0.01],
  ], half * 2 - 0.002, { bevel: 0.003 });
  for (const f of [0.056, 0.07, 0.084, 0.098]) b.box(BODY, 'void', [half * 2, 0.003, 0.004], [0, -0.0145, f]);
  b.plate(BODY, 'polymer', [
    [-0.03, -0.016], [0.044, -0.016], [0.05, -0.03, 0.004], [0.046, -0.058, 0.006], [-0.022, -0.058, 0.008], [-0.034, -0.04],
  ], 0.012, { bevel: 0.002, holes: [[[-0.022, -0.021], [0.038, -0.021], [0.04, -0.03, 0.004], [0.038, -0.052, 0.005], [-0.018, -0.052, 0.006]]] });
  b.plate(BODY, 'polymer', [
    [-0.03, -0.01], [-0.092, -0.01, 0.012], [-0.1, -0.03], [-0.13, -0.128, 0.006], [-0.08, -0.134, 0.006], [-0.052, -0.05], [-0.034, -0.03],
  ], 0.031, { bevel: 0.006 });
  // Flared magazine well and the long beavertail.
  b.plate(BODY, 'polymer', [[-0.076, -0.122], [-0.134, -0.115, 0.004], [-0.138, -0.13, 0.004], [-0.078, -0.14, 0.004]], 0.037, { bevel: 0.004 });
  b.box(BODY, 'polymer', [0.022, 0.008, 0.03], [0, 0.006, -0.1], { rotate: [-0.3, 0, 0], bevel: 0.003 });
  // Controls on the near (left) side: slide stop, takedown lever, magazine release.
  b.box(BODY, 'metalAlt', [0.003, 0.005, 0.032], [-half - 0.0005, 0.008, -0.022], { bevel: 0.001 });
  b.box(BODY, 'metalAlt', [0.003, 0.006, 0.008], [-half - 0.0005, 0.004, 0.024], { bevel: 0.001 });
  b.tube(BODY, 'metalAlt', [-half - 0.002, -0.026, -0.036], [half + 0.002, -0.026, -0.036], 0.0042, 0.0042, 8);
  b.pin(BODY, 'metalAlt', -0.006, -0.006, half - 0.0005, 0.002);

  // Trigger.
  const trigger = b.part('trigger', [0, -0.014, 0.004]);
  b.box(trigger, 'metalAlt', [0.006, 0.026, 0.006], [0, -0.03, 0.006], { rotate: [0.3, 0, 0], bevel: 0.002 });

  // Slide: rear serrations, ejection port, lightening cuts near the muzzle, striker plate.
  const slide = b.part('slide', [0, 0.03, 0]);
  b.plate(slide, 'metal', [
    [-0.094, 0.013], [-0.094, 0.04, 0.004], [-0.088, 0.047, 0.003], [0.112, 0.047, 0.004], [0.118, 0.04], [0.118, 0.013],
  ], half * 2, { bevel: 0.0035 });
  b.slots(slide, -0.086, -0.056, 6, [0.0028, 0.022], 0.031, half + 0.0002);
  b.box(slide, 'void', [0.014, 0.002, 0.036], [0.004, 0.0472, 0.006]);
  b.box(slide, 'void', [0.002, 0.014, 0.036], [half + 0.0002, 0.037, 0.006]);
  b.box(slide, 'metalAlt', [0.012, 0.004, 0.03], [0.002, 0.046, 0.006]);
  b.slots(slide, 0.058, 0.098, 3, [0.014, 0.009], 0.034, half + 0.0002);
  b.box(slide, 'void', [0.012, 0.002, 0.046], [0, 0.0472, 0.07]);
  b.box(slide, 'metalAlt', [0.008, 0.003, 0.042], [0, 0.0462, 0.07]);
  b.box(slide, 'metalAlt', [0.016, 0.02, 0.002], [0, 0.03, -0.0945]);
  // Fire selector on the left of the slide, with its two painted positions.
  b.tube(slide, 'metalAlt', [-half - 0.0022, 0.036, -0.044], [-half + 0.001, 0.036, -0.044], 0.0042, 0.0042, 8);
  b.box(slide, 'metalAlt', [0.003, 0.005, 0.02], [-half - 0.0012, 0.0385, -0.035], { rotate: [0.3, 0, 0] });
  for (const f of [-0.026, -0.02]) b.box(slide, 'accent', [0.0012, 0.003, 0.003], [-half - 0.0002, 0.0435 - (f + 0.026) * 0.8, f]);

  // Barrel through to the compensator, its top ports, and the recoil spring guide.
  b.revolve(BODY, 'metalAlt', [[0.06, 0.0072], [0.128, 0.0072]], { y: 0.03, segments: 12 });
  b.revolve(BODY, 'metalAlt', [[0.094, 0.004], [0.1185, 0.004]], { y: 0.0185, segments: 8 });
  b.muzzle = [0, 0.03, b.muzzleDevice(BODY, 0.122, 0.03, 0.0088, 'brake')];
  for (const f of [0.136, 0.158]) b.box(BODY, 'void', [0.012, 0.0016, 0.008], [0, 0.0402, f]);

  // Extended magazine: the body runs on below the grip to its base pad, with a witness strip.
  const magazine = b.part('magazine', [0, -0.11, -0.095]);
  b.plate(magazine, 'metalAlt', [[-0.05, -0.02], [-0.086, -0.02], [-0.1414, -0.2], [-0.1067, -0.204]], 0.02, { bevel: 0.002 });
  b.plate(magazine, 'polymer', [[-0.103, -0.2], [-0.145, -0.194, 0.004], [-0.149, -0.208, 0.004], [-0.105, -0.216, 0.004]], 0.031, { bevel: 0.003 });
  for (const x of [-0.0104, 0.0104]) b.box(magazine, 'glow', [0.0016, 0.042, 0.004], [x, -0.168, -0.114], { rotate: [-0.3, 0, 0] });
  b.box(magazine, 'glow', [0.008, 0.042, 0.0016], [0, -0.168, -0.1316], { rotate: [-0.3, 0, 0] });

  ironSights(b, { lineY: 0.067, rearF: -0.082, rearBaseY: 0.047, frontF: 0.104, frontBaseY: 0.047, rearPart: slide, frontPart: slide });

  // What the skins add.
  b.engraving(slide, [[-0.028, 0.018], [-0.028, 0.042], [0.046, 0.042], [0.046, 0.018]], half);
  b.medallion(BODY, 0.076, -0.001, half - 0.001, 0.006);
  b.lightLine(slide, [[-0.09, 0.02], [0.114, 0.02]], half);
  b.wrapBox(magazine, -0.15, -0.1, [0, -0.205], [0.031, 0.014]);

  triggerHand(b, { grip: [0, -0.07, -0.082], rake: 0.3, size: [0.031, 0.048] });
  supportWrap(b, { grip: [0, -0.07, -0.082], rake: 0.3, size: [0.031, 0.048] });

  b.animations = {
    fire: {
      duration: 0.055,
      tracks: {
        slide: [{ t: 0 }, { t: 0.018, p: [0, 0, -0.04], ease: 'out' }, { t: 0.055, p: [0, 0, 0] }],
        trigger: [{ t: 0, r: [-0.25, 0, 0] }, { t: 0.05, r: [-0.2, 0, 0] }, { t: 0.055, r: [0, 0, 0] }],
        gun: [{ t: 0 }, { t: 0.016, p: [0, 0.004, -0.009], r: [0.04, 0, 0], ease: 'out' }, { t: 0.055, p: [0, 0, 0], r: [0, 0, 0] }],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.14, p: [0.01, 0.02, -0.02], r: [0.38, 0.05, 0.4] }, { t: 0.64, p: [0.01, 0.02, -0.02], r: [0.38, 0.05, 0.4] },
          { t: 0.8, p: [0, 0, 0], r: [0.04, 0, 0] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        magazine: [
          { t: 0.12 }, { t: 0.25, p: [0, -0.27, -0.085], ease: 'in' }, { t: 0.42, p: [0, -0.27, -0.085] }, { t: 0.58, p: [0, 0, 0], ease: 'out' },
        ],
        'arm-support': [
          { t: 0 }, { t: 0.12, p: [0.02, -0.12, -0.04] }, { t: 0.25, p: [0.02, -0.36, -0.115], ease: 'in' }, { t: 0.42, p: [0.02, -0.36, -0.115] },
          { t: 0.58, p: [0.02, -0.12, -0.04], ease: 'out' }, { t: 0.72, p: [0, 0, 0] },
        ],
        slide: [{ t: 0.78 }, { t: 0.84, p: [0, 0, -0.03], ease: 'out' }, { t: 0.9, p: [0, 0, 0], ease: 'in' }],
      },
    },
    inspect: {
      duration: 3,
      tracks: {
        // A press check while the gun is turned over.
        slide: [{ t: 0.7 }, { t: 0.95, p: [0, 0, -0.018] }, { t: 1.35, p: [0, 0, -0.018] }, { t: 1.5, p: [0, 0, 0] }],
      },
    },
  };
}
