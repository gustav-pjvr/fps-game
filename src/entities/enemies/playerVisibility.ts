import type { MatchMap, MatchWeather } from '../../core/config.ts';

interface Point3 { readonly x: number; readonly y: number; readonly z: number }

export interface PlayerVisibility {
  value: number;
  torchOn: boolean;
  readonly eye: Point3;
  readonly aim: Point3;
}

export interface VisibilityInputs {
  readonly map: MatchMap;
  readonly weather: MatchWeather;
  readonly probeLuma?: number;
  readonly secondsSinceShot: number;
  readonly torchOn: boolean;
  readonly enemyInTorchBeam: boolean;
}

/** Seed 1, probeAt at the atrium (0, 0) and first dark room centre (6.75, 20.25).
 * Probes include emergency lamps, so an unlit room still has some baked light. */
const LIT_LUMA = 0.36812848785519603;
const DARK_LUMA = 0.12890296173673124;

export function visibility(inputs: VisibilityInputs): number {
  if ((inputs.secondsSinceShot >= 0 && inputs.secondsSinceShot < 0.6) ||
      (inputs.torchOn && inputs.enemyInTorchBeam)) return 1;
  if (inputs.map === 'valley') return inputs.weather === 'night' ? 0.4 : inputs.weather === 'fog' ? 0.75 : 1;
  const luma = inputs.probeLuma ?? 0;
  return Math.max(0.2, Math.min(1, 0.25 + 0.75 * (luma - DARK_LUMA) / (LIT_LUMA - DARK_LUMA)));
}

/** Aim is a unit forward vector, as returned by the player's camera. */
export function enemyInTorchBeam(eye: Point3, aim: Point3, enemy: Point3): boolean {
  const dx = enemy.x - eye.x, dy = enemy.y - eye.y, dz = enemy.z - eye.z;
  const distance = Math.hypot(dx, dy, dz);
  return distance <= 28 && (distance < 1e-6 ||
    (dx * aim.x + dy * aim.y + dz * aim.z) / distance >= Math.cos(25 * Math.PI / 180));
}

export function visibilityForEnemy(player: PlayerVisibility, enemy: Point3): number {
  return player.torchOn && enemyInTorchBeam(player.eye, player.aim, enemy) ? 1 : player.value;
}
