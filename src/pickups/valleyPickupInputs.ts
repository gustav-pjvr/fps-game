import { ROAD_WIDTH, WORLD_BOUNDARY_RADIUS, WORLD_EDGE_RAMP_START } from '../core/config.ts';
import { getWorldSeed } from '../core/worldSeed.ts';
import type { BuildingManager } from '../world/BuildingManager.ts';
import { computeMinimumSpanningTree } from '../world/RoadManager.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { getWatchTowerPositions, WATCH_TOWER_FOOTPRINT_RADIUS } from '../world/WatchTowerManager.ts';
import { computeTowerLabs, type TowerLab } from '../world/towerUnderground.ts';
import { PICKUP_LAB_KINDS } from './pickupConfig.ts';
import type { PickupSite, RoadSegment, ValleyPlacementInput } from './pickupPlacement.ts';

/** Pickups keep this far inside the start of the world's edge ramp (the mountain rim). */
const EDGE_MARGIN = 10;

/** Interior matrices are in the tower frame; pickup sites need world coordinates and floor y. */
export function gatherLabPickupSites(labs: readonly TowerLab[]): Omit<PickupSite, 'id'>[] {
  return labs.flatMap(lab => {
    const interior = lab.interiors.find(placement => placement.design.kind === lab.kind);
    if (!interior) return [];
    return interior.design.pickupSites.map((site, index) => {
      const position = site.clone().applyMatrix4(interior.matrix);
      return { kind: PICKUP_LAB_KINDS[lab.kind][index]!, x: lab.x + position.x, y: lab.floorY, z: lab.z + position.z };
    });
  });
}

/** Gathers what the Valley placement needs from the live world, once per match: every house in the
 * world, every town road (the minimum spanning tree RoadManager draws, rebuilt here from the same
 * building centres), the watch towers and the terrain height. The world's seed is already set, so
 * every client of a match gets the same input. */
export function gatherValleyPlacementInput(buildings: BuildingManager): ValleyPlacementInput {
  const { footprints, towns } = buildings.getWorldTowns(WORLD_BOUNDARY_RADIUS);
  const roads: RoadSegment[] = [];
  for (const centres of towns) {
    for (const [i, j] of computeMinimumSpanningTree(centres)) {
      const a = centres[i]!;
      const b = centres[j]!;
      roads.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
  }
  return {
    seed: getWorldSeed(),
    footprints,
    roads,
    towers: getWatchTowerPositions(),
    labSites: gatherLabPickupSites(computeTowerLabs()),
    towerRadius: WATCH_TOWER_FOOTPRINT_RADIUS,
    roadHalfWidth: ROAD_WIDTH / 2,
    maxRadius: WORLD_EDGE_RAMP_START - EDGE_MARGIN,
    groundHeight: sampleHeight,
  };
}
