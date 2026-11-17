import { BODY, type GunBuilder } from '../kit/GunBuilder.ts';
import { supportWrap, triggerHand } from '../kit/hands.ts';
import { ironSights } from '../kit/sights.ts';

/** Rook .44 Revolver: a large double-action revolver with a 15 cm barrel under a vented rib, a
 * full under-lug, a six-chamber fluted cylinder on a swing-out crane and wide grip panels. Bore
 * line at y = 0.036; the cylinder turns about y = 0.022. */
export function buildRevolver(b: GunBuilder): void {
  b.tuning = { scale: 1.1, offset: [-0.07, 0.03, 0.08] };
  const half = 0.0095;
  const bore = 0.036, axis = 0.022, drum = 0.0215;

  // Frame: top strap, recoil shield, the bottom of the cylinder window and the grip tang.
  b.plate(BODY, 'metal', [
    [-0.05, 0.052, 0.006], [0.05, 0.052], [0.05, 0.004], [0.044, -0.004], [0.02, -0.014], [-0.046, -0.014],
    [-0.058, -0.03], [-0.084, -0.026], [-0.084, -0.004, 0.008], [-0.068, 0.03, 0.012],
  ], half * 2, { bevel: 0.003, holes: [[[-0.034, 0.0], [0.04, 0.0], [0.04, 0.046], [-0.034, 0.046]]] });
  // Recoil shield: the round plate behind the cylinder.
  b.revolve(BODY, 'metal', [[-0.044, drum + 0.001], [-0.035, drum + 0.001]], { y: axis, segments: 18 });
  b.box(BODY, 'metalAlt', [0.003, 0.012, 0.014], [-half - 0.0005, 0.016, -0.05], { bevel: 0.001 });
  b.pin(BODY, 'metalAlt', -0.02, -0.006, half, 0.0026);
  b.pin(BODY, 'metalAlt', 0.03, -0.004, half, 0.0026);
  b.witness(BODY, -0.03, 0.03, -0.0075, half - 0.0006, 0.004);

  // Barrel, full under-lug with the ejector rod housing, vented rib.
  b.revolve(BODY, 'metal', [[0.048, 0.0115], [0.196, 0.0115]], { y: bore, bore: 0.0056, segments: 14 });
  b.plate(BODY, 'metal', [[0.05, 0.03], [0.196, 0.03], [0.196, 0.006, 0.006], [0.062, 0.004, 0.004], [0.05, 0.012]], 0.017, { bevel: 0.004 });
  b.box(BODY, 'metal', [0.009, 0.0065, 0.146], [0, 0.0492, 0.123], { bevel: 0.0015 });
  for (let i = 0; i < 5; i++) b.box(BODY, 'void', [0.0096, 0.0026, 0.014], [0, 0.0462, 0.07 + i * 0.026]);
  b.tube(BODY, 'metalAlt', [0, 0.012, 0.052], [0, 0.012, 0.09], 0.0032, 0.0032, 8);
  b.muzzle = [0, bore, b.muzzleDevice(BODY, 0.196, bore, 0.0115, 'crown')];

  // The crane swings the cylinder out to the left for loading.
  const crane = b.part('crane', [-0.004, 0.0, 0.03]);
  b.box(crane, 'metalAlt', [0.006, 0.02, 0.012], [-0.002, 0.008, 0.044], { bevel: 0.0015 });
  const cylinder = b.part('cylinder', [0, axis, 0.002], crane);
  b.revolve(cylinder, 'metalAlt', [[-0.034, drum - 0.002], [-0.031, drum], [0.036, drum], [0.039, drum - 0.002]], { y: axis, segments: 18 });
  for (let k = 0; k < 6; k++) {
    const flute = (k + 0.5) / 6 * Math.PI * 2, chamber = k / 6 * Math.PI * 2;
    const fx = Math.cos(flute) * (drum - 0.0012), fy = axis + Math.sin(flute) * (drum - 0.0012);
    b.tube(cylinder, 'metal', [fx, fy, 0.0], [fx, fy, 0.0385], 0.0034, 0.0034, 6);
    const cx = Math.cos(chamber + Math.PI / 2) * 0.0138, cy = axis + Math.sin(chamber + Math.PI / 2) * 0.0138;
    b.disc(cylinder, 'void', [cx, cy, 0.0392], 0.0056, -1);
    b.disc(cylinder, 'accent', [cx, cy, -0.0342], 0.0058, 1);
  }

  // Hammer and trigger, with the guard.
  const hammer = b.part('hammer', [0, 0.03, -0.062]);
  b.plate(hammer, 'metalAlt', [[-0.058, 0.03], [-0.064, 0.058, 0.002], [-0.082, 0.064, 0.003], [-0.084, 0.058], [-0.07, 0.05], [-0.068, 0.03]], 0.008, { bevel: 0.0015 });
  const trigger = b.part('trigger', [0, -0.012, -0.012]);
  b.box(trigger, 'metalAlt', [0.007, 0.028, 0.006], [0, -0.03, -0.008], { rotate: [0.3, 0, 0], bevel: 0.002 });
  b.plate(BODY, 'metal', [
    [-0.044, -0.014], [0.022, -0.014], [0.026, -0.03, 0.006], [0.012, -0.06, 0.008], [-0.03, -0.06, 0.008], [-0.046, -0.034],
  ], 0.011, { bevel: 0.002, holes: [[[-0.036, -0.019], [0.016, -0.019], [0.016, -0.03, 0.004], [0.006, -0.054, 0.006], [-0.027, -0.054, 0.006]]] });

  // Grip panels over the frame's tang, with a butt cap.
  b.plate(BODY, 'furniture', [
    [-0.05, -0.024], [-0.086, -0.006, 0.014], [-0.1, -0.04, 0.02], [-0.122, -0.108, 0.02], [-0.1, -0.132, 0.016], [-0.07, -0.118, 0.014], [-0.052, -0.058, 0.01],
  ], 0.031, { bevel: 0.009 });
  b.tube(BODY, 'metalAlt', [-0.0165, -0.118, -0.098], [0.0165, -0.118, -0.098], 0.0035, 0.0035, 8);

  ironSights(b, { lineY: 0.072, rearF: -0.06, rearBaseY: 0.052, frontF: 0.184, frontBaseY: 0.0525 });

  b.engraving(BODY, [[0.066, 0.01], [0.066, 0.027], [0.19, 0.027], [0.19, 0.01]], 0.0085);
  b.medallion(BODY, -0.09, -0.066, 0.0155, 0.0085);
  b.lightLine(BODY, [[0.052, 0.036], [0.194, 0.036]], 0.0115);
  b.wrapBox(BODY, 0.1, 0.15, [0, 0.027], [0.021, 0.05]);

  triggerHand(b, { grip: [0, -0.074, -0.09], rake: 0.3, size: [0.031, 0.044] });
  supportWrap(b, { grip: [0, -0.074, -0.09], rake: 0.3, size: [0.031, 0.044] });

  b.animations = {
    fire: {
      duration: 0.38,
      tracks: {
        gun: [{ t: 0 }, { t: 0.05, p: [0, 0.016, -0.03], r: [0.2, 0, 0], ease: 'out' }, { t: 0.3, p: [0, 0, 0], r: [0, 0, 0] }],
        // The next pull: the hammer rocks back as the cylinder brings the next chamber round. One
        // sixth of a turn leaves it looking as it began.
        hammer: [{ t: 0.12 }, { t: 0.3, r: [-0.6, 0, 0] }, { t: 0.38, r: [0, 0, 0], ease: 'in' }],
        cylinder: [{ t: 0.12 }, { t: 0.32, r: [0, 0, Math.PI / 3] }],
        trigger: [{ t: 0, r: [-0.3, 0, 0] }, { t: 0.12, r: [0, 0, 0] }],
      },
    },
    reload: {
      duration: 1,
      tracks: {
        gun: [
          { t: 0 }, { t: 0.12, p: [0.01, 0.02, -0.02], r: [0.45, 0.1, 0.35] }, { t: 0.78, p: [0.01, 0.02, -0.02], r: [0.45, 0.1, 0.35] },
          { t: 0.92, p: [0, 0, 0], r: [0.05, 0, 0] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] },
        ],
        crane: [{ t: 0.12 }, { t: 0.22, r: [0, 0, -1.15], ease: 'out' }, { t: 0.76, r: [0, 0, -1.15] }, { t: 0.86, r: [0, 0, 0], ease: 'in' }],
        cylinder: [{ t: 0.24 }, { t: 0.3, p: [0, 0, -0.012] }, { t: 0.36, p: [0, 0, 0] }, { t: 0.6, r: [0, 0, Math.PI / 3] }],
        'arm-support': [
          { t: 0 }, { t: 0.14, p: [-0.03, 0.03, 0.06] }, { t: 0.3, p: [-0.05, 0.05, 0.02] }, { t: 0.4, p: [-0.02, -0.2, -0.12] },
          { t: 0.5, p: [-0.02, -0.2, -0.12] }, { t: 0.62, p: [-0.05, 0.05, 0.03] }, { t: 0.76, p: [-0.03, 0.03, 0.06] }, { t: 0.92, p: [0, 0, 0] },
        ],
      },
    },
    inspect: {
      duration: 3,
      tracks: {
        // The cylinder is swung out, spun and snapped shut while the gun is turned over.
        crane: [{ t: 0.6 }, { t: 0.8, r: [0, 0, -1.15] }, { t: 1.7, r: [0, 0, -1.15] }, { t: 1.9, r: [0, 0, 0], ease: 'in' }],
        cylinder: [{ t: 0.85 }, { t: 1.6, r: [0, 0, Math.PI * 2], ease: 'out' }],
      },
    },
  };
}
