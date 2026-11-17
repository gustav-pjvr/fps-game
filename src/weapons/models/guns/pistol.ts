import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportWrap, triggerHand } from '../kit/hands.ts';
import { ironSights } from '../kit/sights.ts';

/** P9 Pistol: a striker-fired service pistol with a polymer frame, a steel slide that cycles on
 * every shot and a 15 round magazine in the grip. Bore line at y = 0.03. */
export function buildPistol(b: GunBuilder): void {
  b.tuning = { scale: 1.1, offset: [-0.07, 0.03, 0.08] };
  const half = 0.0135;

  // Frame: dust cover with a short accessory rail, trigger guard, raked grip.
  b.plate(BODY, 'polymer', [
    [-0.088, 0.012], [0.1, 0.012], [0.1, -0.004, 0.003], [0.092, -0.012], [0.04, -0.012],
    [0.036, -0.02], [-0.03, -0.02], [-0.03, -0.012], [-0.088, -0.012, 0.01],
  ], half * 2 - 0.002, { bevel: 0.003 });
  for (const f of [0.052, 0.066, 0.08]) b.box(BODY, 'void', [half * 2, 0.003, 0.004], [0, -0.0125, f]);
  b.plate(BODY, 'polymer', [
    [-0.03, -0.016], [0.04, -0.016], [0.044, -0.03, 0.006], [0.03, -0.055, 0.008], [-0.022, -0.055, 0.008], [-0.034, -0.04],
  ], 0.012, { bevel: 0.002, holes: [[[-0.022, -0.021], [0.034, -0.021], [0.034, -0.03, 0.004], [0.024, -0.049, 0.006], [-0.018, -0.049, 0.006]]] });
  b.plate(BODY, 'polymer', [
    [-0.03, -0.01], [-0.09, -0.01, 0.012], [-0.098, -0.03], [-0.128, -0.128, 0.006], [-0.078, -0.134, 0.006], [-0.05, -0.05], [-0.034, -0.03],
  ], 0.03, { bevel: 0.006 });
  // Grip texture panels and the beavertail.
  b.plates(BODY, 'rubber', [[-0.058, -0.04], [-0.094, -0.04], [-0.118, -0.118], [-0.084, -0.122]], 0.002, 0.0152, { bevel: 0.0006, round: 0.004 });
  b.box(BODY, 'polymer', [0.022, 0.008, 0.02], [0, 0.006, -0.096], { rotate: [-0.3, 0, 0], bevel: 0.003 });
  // Controls on the near (left) side: slide stop, takedown lever, magazine release.
  b.box(BODY, 'metalAlt', [0.003, 0.005, 0.03], [-half - 0.0005, 0.008, -0.024], { bevel: 0.001 });
  b.box(BODY, 'metalAlt', [0.003, 0.006, 0.008], [-half - 0.0005, 0.004, 0.02], { bevel: 0.001 });
  b.tube(BODY, 'metalAlt', [-half - 0.002, -0.026, -0.036], [half + 0.002, -0.026, -0.036], 0.0042, 0.0042, 8);
  b.pin(BODY, 'metalAlt', -0.006, -0.006, half - 0.0005, 0.002);
  b.witness(BODY, -0.07, -0.04, 0.0045, half - 0.0006, 0.0035);

  // Trigger.
  const trigger = b.part('trigger', [0, -0.014, 0.004]);
  b.box(trigger, 'metalAlt', [0.006, 0.026, 0.006], [0, -0.03, 0.006], { rotate: [0.3, 0, 0], bevel: 0.002 });

  // Slide: the part that moves. Serrations front and rear, ejection port, barrel hood, striker plate.
  const slide = b.part('slide', [0, 0.03, 0]);
  b.plate(slide, 'metal', [
    [-0.09, 0.013], [-0.09, 0.04, 0.004], [-0.084, 0.047, 0.003], [0.1, 0.047, 0.004], [0.106, 0.04], [0.106, 0.013],
  ], half * 2, { bevel: 0.0035 });
  b.slots(slide, -0.082, -0.05, 6, [0.0028, 0.022], 0.031, half + 0.0002);
  b.slots(slide, 0.07, 0.094, 5, [0.0028, 0.018], 0.031, half + 0.0002);
  b.box(slide, 'void', [0.014, 0.002, 0.036], [0.004, 0.0472, 0.012]);
  b.box(slide, 'void', [0.002, 0.014, 0.036], [half + 0.0002, 0.037, 0.012]);
  b.box(slide, 'metalAlt', [0.012, 0.004, 0.03], [0.002, 0.046, 0.012]);
  b.box(slide, 'metalAlt', [0.016, 0.02, 0.002], [0, 0.03, -0.0905]);
  // Barrel and recoil spring guide showing at the muzzle.
  b.revolve(BODY, 'metalAlt', [[0.06, 0.0072], [0.109, 0.0072]], { y: 0.03, bore: 0.0045, segments: 12 });
  b.disc(BODY, 'void', [0, 0.03, 0.104], 0.0045, -1);
  b.revolve(BODY, 'metalAlt', [[0.09, 0.004], [0.1065, 0.004]], { y: 0.0185, segments: 8 });
  b.muzzle = [0, 0.03, 0.109];

  // Magazine: the body is inside the grip, the base pad shows.
  const magazine = b.part('magazine', [0, -0.11, -0.095]);
  b.plate(magazine, 'metalAlt', [[-0.05, -0.02], [-0.086, -0.02], [-0.118, -0.124], [-0.084, -0.128]], 0.02, { bevel: 0.002 });
  b.plate(magazine, 'polymer', [[-0.08, -0.126], [-0.124, -0.12, 0.004], [-0.128, -0.134, 0.004], [-0.082, -0.142, 0.004]], 0.031, { bevel: 0.003 });

  ironSights(b, { lineY: 0.056, rearF: -0.078, rearBaseY: 0.047, frontF: 0.094, frontBaseY: 0.047, rearPart: slide, frontPart: slide });

  b.engraving(slide, [[-0.04, 0.018], [-0.04, 0.042], [0.062, 0.042], [0.062, 0.018]], half);
  b.medallion(BODY, -0.086, -0.075, 0.015, 0.008);
  b.lightLine(slide, [[-0.086, 0.02], [0.1, 0.02]], half);
  // Tape round the magazine base pad, below the hand.
  b.wrapBox(magazine, -0.128, -0.08, [0, -0.132], [0.031, 0.014]);

  triggerHand(b, { grip: [0, -0.07, -0.082], rake: 0.3, size: [0.03, 0.048] });
  supportWrap(b, { grip: [0, -0.07, -0.082], rake: 0.3, size: [0.03, 0.048] });

  b.animations = {
    fire: {
      duration: 0.12,
      tracks: {
        slide: [{ t: 0 }, { t: 0.035, p: [0, 0, -0.042], ease: 'out' }, { t: 0.12, p: [0, 0, 0] }],
        trigger: [{ t: 0, r: [-0.25, 0, 0] }, { t: 0.1, r: [0, 0, 0] }],
        gun: [{ t: 0 }, { t: 0.03, p: [0, 0.006, -0.014], r: [0.07, 0, 0], ease: 'out' }, { t: 0.12, p: [0, 0, 0], r: [0, 0, 0] }],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.14, p: [0.01, 0.01, -0.02], r: [0.35, 0.05, 0.4] }, { t: 0.62, p: [0.01, 0.01, -0.02], r: [0.35, 0.05, 0.4] },
          { t: 0.8, p: [0, 0, 0], r: [0.04, 0, 0] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        magazine: [
          { t: 0.12 }, { t: 0.24, p: [0, -0.2, -0.06], ease: 'in' }, { t: 0.4, p: [0, -0.2, -0.06] }, { t: 0.56, p: [0, 0, 0], ease: 'out' },
        ],
        'arm-support': [
          { t: 0 }, { t: 0.12, p: [0.02, -0.06, -0.02] }, { t: 0.24, p: [0.02, -0.24, -0.08], ease: 'in' }, { t: 0.4, p: [0.02, -0.24, -0.08] },
          { t: 0.56, p: [0.02, -0.06, -0.02], ease: 'out' }, { t: 0.7, p: [0, 0, 0] },
        ],
        slide: [{ t: 0.78 }, { t: 0.84, p: [0, 0, -0.03], ease: 'out' }, { t: 0.9, p: [0, 0, 0], ease: 'in' }],
      },
    },
    inspect: {
      duration: 3,
      tracks: {
        // A press check while the gun is turned over.
        slide: [{ t: 0.7 }, { t: 0.95, p: [0, 0, -0.016] }, { t: 1.35, p: [0, 0, -0.016] }, { t: 1.5, p: [0, 0, 0] }],
      },
    },
  };
}
