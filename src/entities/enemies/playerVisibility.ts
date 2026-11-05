import type { MatchMap, MatchWeather } from '../../core/config.ts';
import { FLASH_LIGHT_RANGE, FLASH_LIGHT_SECONDS } from '../../combat/grenades/grenadeTuning.ts';

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
  /** Valley: whether the house room the player stands in has its lamp lit (ValleyHouses.roomLampLitAt);
   * null or left out outside every house. */
  readonly houseRoomLit?: boolean | null;
  readonly underground?: boolean;
  /** A flash grenade's light is on the player this instant (flashLightsPlayer). */
  readonly flashLit?: boolean;
}

/** Seed 1, probeAt at the atrium (0, 0) and first dark room centre (6.75, 20.25).
 * Probes include emergency lamps, so an unlit room still has some baked light. */
const LIT_LUMA = 0.36812848785519603;
const DARK_LUMA = 0.12890296173673124;

/** Inside a Valley house at night or in fog with the room's lamp off (or shot out). */
const DARK_HOUSE_ROOM = 0.3;

export function visibility(inputs: VisibilityInputs): number {
  if ((inputs.secondsSinceShot >= 0 && inputs.secondsSinceShot < 0.6) ||
      (inputs.torchOn && inputs.enemyInTorchBeam) || inputs.flashLit === true) return 1;
  if (inputs.map === 'valley') {
    if (inputs.weather !== 'day' && (inputs.houseRoomLit === false || inputs.underground === true)) return DARK_HOUSE_ROOM;
    return inputs.weather === 'night' ? 0.4 : inputs.weather === 'fog' ? 0.75 : 1;
  }
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

/** Whether a flash grenade's light is on a player at `at` this instant: one went off within its
 * light's FLASH_LIGHT_SECONDS (on the detonations' clock, `now`) and within its light's range. */
export function flashLightsPlayer(
  detonations: readonly { readonly kind: string; readonly position: Point3; readonly at: number }[], now: number, at: Point3,
): boolean {
  return detonations.some((d) => d.kind === 'flash' && now - d.at >= 0 && now - d.at < FLASH_LIGHT_SECONDS &&
    Math.hypot(d.position.x - at.x, d.position.y - at.y, d.position.z - at.z) <= FLASH_LIGHT_RANGE);
}
