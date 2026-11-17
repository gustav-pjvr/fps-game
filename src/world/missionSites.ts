import { planOperation, type MissionPoint, type MissionSites } from '../core/mission/missionState.ts';
import { FACILITY_CONSOLE_HEIGHT } from './facility/facilityConsoles.ts';
import { isWalkable, type FacilityLayout } from './facility/facilityLayout.ts';
import { facilityMissionObjectives } from './facility/facilityModes.ts';
import { sampleHeight } from './TerrainGenerator.ts';
import { WATCH_TOWER_FOOTPRINT_RADIUS } from './towerDesign.ts';
import { computeTowerLabs, type TowerLab } from './towerUnderground.ts';
import { getWatchTowerPositions } from './WatchTowerManager.ts';

/** Where Operation Uplink (docs/uplink.md) happens on a map. */
export interface OperationSites {
  readonly sites: MissionSites;
  /** The height the data core hovers at on its site: over the lab floor on the Valley, over a
   * console cap on the Facility. */
  readonly coreY: number;
  /** Every point that gets a console (the Facility); none on the Valley, whose sites are towers. */
  readonly consoles: readonly MissionPoint[];
}

/** Ring radius for standPointNear at a watch tower (clear of its deck) and at a Facility console. */
export const TOWER_STAND_RADIUS = WATCH_TOWER_FOOTPRINT_RADIUS + 2;
export const CONSOLE_STAND_RADIUS = 1.5;
/** The data core hovers this far over the floor it lies on, at its site or where it was dropped. */
export const CORE_HOVER_HEIGHT = 1;

/** The data core's place in a tower's lab: the deepest free floor site of its interior (the same
 * sites the lab's pickups use), in world coordinates; null for a dead-end stair with no lab. */
function labCoreSite(lab: TowerLab): MissionPoint | null {
  const interior = lab.interiors.find((placement) => placement.design.kind === lab.kind);
  const site = interior?.design.pickupSites.at(-1);
  if (!interior || !site) return null;
  const position = site.clone().applyMatrix4(interior.matrix);
  return { x: lab.x + position.x, z: lab.z + position.z };
}

/** The Valley: the four watch towers. The core lies in the lab under the tower planOperation picks
 * among those that have a lab; with no lab anywhere it lies on the ground beside its tower. A pure
 * function of the world seed, like the towers and the labs themselves. */
export function valleyOperationSites(start: MissionPoint): OperationSites {
  const towers = getWatchTowerPositions();
  const labs = computeTowerLabs();
  const coreSites = towers.map((_, index) => (labs[index] ? labCoreSite(labs[index]) : null));
  const plan = planOperation(towers, start, (index) => coreSites[index] != null);
  const tower = towers[plan.core]!;
  const inLab = coreSites[plan.core];
  const core = inLab
    ? { ...inLab, underground: true }
    : { x: tower.x + WATCH_TOWER_FOOTPRINT_RADIUS + 1.5, z: tower.z, underground: false };
  return {
    sites: { breach: towers[plan.breach]!, core, relay: towers[plan.relay]!, extraction: towers[plan.extraction]! },
    coreY: (inLab ? labs[plan.core]!.floorY : sampleHeight(core.x, core.z)) + CORE_HOVER_HEIGHT,
    consoles: [],
  };
}

/** The Facility: its four objective rooms (facilityMissionObjectives), a console in each. The core
 * rests on the console of the room farthest from the terminal. */
export function facilityOperationSites(layout: FacilityLayout, start: MissionPoint): OperationSites {
  const points = facilityMissionObjectives(layout, start);
  const plan = planOperation(points, start);
  return {
    sites: {
      breach: points[plan.breach]!,
      core: { ...points[plan.core]!, underground: false },
      relay: points[plan.relay]!,
      extraction: points[plan.extraction]!,
    },
    coreY: FACILITY_CONSOLE_HEIGHT + 0.45,
    consoles: points.slice(0, 4),
  };
}

/** Where a redeployed player stands at a site: the first clear point on rings around it, nearest
 * ring first, the site itself when every candidate is blocked. A tower's own footprint and a
 * console's cabinet are in the way at the centre. Deterministic. */
export function standPointNear(site: MissionPoint, radius: number, isBlocked: (x: number, z: number) => boolean): MissionPoint {
  for (let ring = 0; ring < 3; ring++) {
    const reach = radius * (1 + ring * 0.5);
    for (let step = 0; step < 8; step++) {
      const angle = (step * Math.PI) / 4;
      const x = site.x + Math.cos(angle) * reach;
      const z = site.z + Math.sin(angle) * reach;
      if (!isBlocked(x, z)) return { x, z };
    }
  }
  return site;
}

/** Whether a redeployed player cannot stand at (x, z) on the Facility. */
export function facilityStandBlocked(layout: FacilityLayout, x: number, z: number): boolean {
  return !isWalkable(layout, x, z, 0.5);
}
