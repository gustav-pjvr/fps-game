import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FacilityInteraction } from './facilityInteraction.ts';
import { ValleyDoors } from '../world/houses/ValleyDoors.ts';
import { houseKey, houseObjectId, towerDoorId } from '../world/houses/valleyHouseIds.ts';

beforeAll(async () => { await RAPIER.init(); });

describe('enemy tower doorway barrier', () => {
  it.each([false, true])('blocks enemies when the tower door is open: %s', (open) => {
    const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    const doors = new ValleyDoors(new THREE.Scene(), world, () => null);
    const id = towerDoorId(0);
    try {
      doors.addDoor(id, { x: 3, z: 0, y: 0, axis: 'x', side: -1, width: 1.2, height: 2.2 });
      doors.set('door', id, open, true);
      const gate = new FacilityInteraction({ objects: doors, multiplayer: null } as unknown as ConstructorParameters<typeof FacilityInteraction>[0]);
      for (let frame = 0; frame < 600; frame++) expect(gate.enemyGate(1, 4, 0, -1, 0, 1 / 60, 2, 0)).toBe(true);
      expect(doors.state.isActive('door', id)).toBe(open);
      expect(doors.debugDoors()[0]!.collider).toBe(!open);
      expect(gate.enemyGate(1, 4, 0, -1, 0, 1 / 60, 2, 3)).toBe(false);
    } finally { doors.dispose(); world.free(); }
  });

  it('still allows enemies through an open house door', () => {
    const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    const doors = new ValleyDoors(new THREE.Scene(), world, () => null);
    try {
      const id = houseObjectId(houseKey({ gx: 0, gz: 0, index: 0 }), 0);
      doors.addDoor(id, { x: 3, z: 0, axis: 'x', side: -1, width: 1.2, height: 2.2 });
      doors.set('door', id, true, true);
      expect(doors.closedDoorAhead(4, 0, -1, 0, 2, 0)).toBe(-1);
    } finally { doors.dispose(); world.free(); }
  });
});
