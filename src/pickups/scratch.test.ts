import { it } from 'vitest';
import { Scene } from 'three';
import { setWorldSeedForTesting } from '../core/worldSeed.ts';
import { BuildingManager } from '../world/BuildingManager.ts';
import { gatherValleyPlacementInput } from './valleyPickupInputs.ts';
import { placeValleyPickups, placeFacilityPickups } from './pickupPlacement.ts';
import { generateFacilityLayout } from '../world/facility/facilityLayout.ts';

it('explore', async () => {
  const bm = await BuildingManager.create(new Scene(), null as never);
  const counts: number[] = [];
  const t0 = performance.now();
  for (let seed = 1; seed <= 40; seed++) {
    setWorldSeedForTesting(seed);
    const input = gatherValleyPlacementInput(bm);
    const sites = placeValleyPickups(input, ['health', 'ammo', 'grenade']);
    counts.push(sites.length);
    if (seed <= 3) console.log(seed, input.footprints.length, input.roads.length, sites.length, JSON.stringify(sites.slice(0, 3)));
  }
  console.log('valley counts', counts.join(','), 'ms', performance.now() - t0);
  const fc: number[] = [];
  const t1 = performance.now();
  for (let seed = 1; seed <= 40; seed++) {
    const layout = generateFacilityLayout(seed);
    fc.push(placeFacilityPickups(layout, ['health', 'ammo', 'grenade']).length / layout.rooms.length);
  }
  console.log('facility per room', fc.map((x) => x.toFixed(2)).join(','), performance.now() - t1);
}, 120000);
