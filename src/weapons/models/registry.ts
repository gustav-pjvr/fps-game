import type { GunBuilder } from './kit/GunBuilder.ts';
import { buildKnife } from './blades/knife.ts';
import { buildKarambit } from './blades/karambit.ts';
import { buildMachete } from './blades/machete.ts';
import { buildTanto } from './blades/tanto.ts';
import { buildHatchet } from './blades/hatchet.ts';
import { buildSpike } from './blades/spike.ts';
import { buildRifle } from './guns/rifle.ts';
import { buildPistol } from './guns/pistol.ts';
import { buildMp5 } from './guns/mp5.ts';
import { buildShotgun } from './guns/shotgun.ts';
import { buildSniper } from './guns/sniper.ts';
import { buildGooseLauncher } from './guns/gooseLauncher.ts';
import { buildSmg } from './guns/smg.ts';
import { buildBattleRifle } from './guns/battleRifle.ts';
import { buildLmg } from './guns/lmg.ts';
import { buildDmr } from './guns/dmr.ts';
import { buildRevolver } from './guns/revolver.ts';
import { buildMachinePistol } from './guns/machinePistol.ts';
import { buildSawnOff } from './guns/sawnOff.ts';

/** Every weapon model, by weapon id (weapons/definitions.ts). One file per weapon: guns/ and blades/. */
export const WEAPON_MODEL_BUILDERS: Readonly<Record<string, (b: GunBuilder) => void>> = {
  pistol: buildPistol,
  mp5: buildMp5,
  revolver: buildRevolver,
  machinePistol: buildMachinePistol,
  sawnOff: buildSawnOff,
  rifle: buildRifle,
  smg: buildSmg,
  battleRifle: buildBattleRifle,
  lmg: buildLmg,
  dmr: buildDmr,
  shotgun: buildShotgun,
  sniper: buildSniper,
  knife: buildKnife,
  karambit: buildKarambit,
  machete: buildMachete,
  tanto: buildTanto,
  hatchet: buildHatchet,
  spike: buildSpike,
  gooseLauncher: buildGooseLauncher,
};
