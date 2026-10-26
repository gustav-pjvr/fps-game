import { beforeAll, describe, expect, it, vi } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { heldAtDoor, setEnemyDoorGate } from '../entities/enemies/enemyNavigator.ts';
import { houseKey, houseObjectId, type HouseRef } from '../world/houses/valleyHouseIds.ts';
import { FRONT_DOOR_SLOT, ValleyHouses, type HousePlacement } from '../world/houses/ValleyHouses.ts';
import { FACILITY_ENEMY_DOOR_WAIT } from './config.ts';
import { FacilityInteraction } from './facilityInteraction.ts';

const PLACEMENT: HousePlacement = { ref: { gx: 0, gz: 0, index: 0 }, design: 0, x: 10, groundY: 2, z: 20, rotationY: 0 };
const houseAt = (ref: HouseRef): HousePlacement | null =>
  ref.gx === 0 && ref.gz === 0 && ref.index === 0 ? PLACEMENT : null;

/** The Valley branch of Game's wiring: the houses' doors behind a FacilityInteraction, its gate set
 * as the enemy door gate. Only the parts the gate touches are real. */
function setup(others?: { enemies: { x: number; z: number }[]; geese: { x: number; z: number }[] }) {
  const houses = new ValleyHouses(new THREE.Scene(), new RAPIER.World({ x: 0, y: -9.81, z: 0 }), houseAt, false);
  houses.housePlaced('house-0', PLACEMENT, new THREE.Group());
  const sound = { playDoorSlide: vi.fn() };
  const interaction = new FacilityInteraction({
    objects: houses.doors,
    physics: {} as never,
    camera: new THREE.PerspectiveCamera(),
    player: { isDead: false, position: new THREE.Vector3(200, 0, 200), facingYaw: 0 } as never,
    hud: {} as never,
    sound: sound as never,
    multiplayer: null,
    others: others ? () => others : undefined,
  });
  setEnemyDoorGate(interaction.enemyGate);
  return { houses, sound, interaction, id: houseObjectId(houseKey(PLACEMENT.ref), FRONT_DOOR_SLOT) };
}

describe('enemies and Valley house doors', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('hold an enemy walking at a closed house door for the wait, then open it with its sound', () => {
    const { houses, sound, id } = setup();
    const door = houses.doors.debugDoors()[0]!;
    // Bunkhouse unturned: the door plane is across z, the room toward side (-z).
    const x = door.x, z = door.z - door.side * 1;
    const dt = 0.1;
    let ticks = 0;
    while (heldAtDoor(7, x, z, 0, door.side, dt)) {
      ticks++;
      expect(ticks).toBeLessThan(50);
    }
    expect(ticks * dt).toBeGreaterThanOrEqual(FACILITY_ENEMY_DOOR_WAIT - dt - 1e-9);
    expect(houses.doors.state.isActive('door', id)).toBe(true);
    expect(sound.playDoorSlide).not.toHaveBeenCalled(); // the player is out of earshot
    // Open now: the enemy walks on.
    expect(heldAtDoor(7, x, z, 0, door.side, dt)).toBe(false);
    setEnemyDoorGate(null);
  });

  it('let an enemy walking past or away from the door go on at once', () => {
    const { houses } = setup();
    const door = houses.doors.debugDoors()[0]!;
    expect(heldAtDoor(3, door.x, door.z - door.side * 1, 0, -door.side, 0.1)).toBe(false);
    expect(heldAtDoor(3, door.x + 6, door.z - door.side * 1, 0, door.side, 0.1)).toBe(false);
    setEnemyDoorGate(null);
  });

  it('never close on an enemy or a goose standing in the doorway', () => {
    const others = { enemies: [] as { x: number; z: number }[], geese: [] as { x: number; z: number }[] };
    const { houses, interaction, id } = setup(others);
    const door = houses.doors.debugDoors()[0]!;
    houses.doors.set('door', id, true);
    others.enemies.push({ x: door.x, z: door.z + 0.1 });
    expect(interaction.requestState('door', id, false)).toBe(false);
    expect(houses.doors.state.isActive('door', id)).toBe(true);
    others.enemies.length = 0;
    others.geese.push({ x: door.x + 0.3, z: door.z });
    expect(interaction.requestState('door', id, false)).toBe(false);
    expect(houses.doors.state.isActive('door', id)).toBe(true);
    // Clear of the doorway: it closes.
    others.geese[0] = { x: door.x, z: door.z - door.side * 2 };
    expect(interaction.requestState('door', id, false)).toBe(true);
    expect(houses.doors.state.isActive('door', id)).toBe(false);
    setEnemyDoorGate(null);
  });
});
