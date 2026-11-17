import type { GrenadeTargets } from './GrenadeSystem.ts';

/** Something else a frag can hurt besides the single-player enemies: the horde's geese. */
export interface GrenadeBlastTarget {
  applyBlast: GrenadeTargets['applyBlast'];
}

/** The enemies (EntityManager) plus, in the horde modes, the geese (HordeGooseManager): a frag's
 * blast reaches both; flashes and the noise only concern the enemies. */
export function withBlastTargets(targets: GrenadeTargets, extra: GrenadeBlastTarget | null): GrenadeTargets {
  if (!extra) return targets;
  return {
    applyBlast: (position, damageFor) => {
      targets.applyBlast(position, damageFor);
      extra.applyBlast(position, damageFor);
    },
    applyFlash: (judge) => targets.applyFlash(judge),
    notifyGunshot: (origin, weaponId) => targets.notifyGunshot(origin, weaponId),
  };
}
