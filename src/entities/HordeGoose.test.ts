import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HordeGoose, hordeGooseReaches } from './HordeGoose.ts';
import { setEnemyDoorGate, setEnemyEntrance, setEnemyFloor, setEnemyNavigator } from './enemies/enemyNavigator.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { setHeightOverride } from '../world/TerrainGenerator.ts';
import { walkMeetsDoor, type DoorPlane } from '../world/doors/doorGeometry.ts';
import { HOUSE_LAYOUTS, houseToWorld } from '../world/houses/houseLayout.ts';
import { houseKey, houseObjectId } from '../world/houses/valleyHouseIds.ts';
import { FRONT_DOOR_SLOT, ValleyHouses, type HousePlacement } from '../world/houses/ValleyHouses.ts';
import { EnemyDoorWaits } from '../world/facility/facilityDoors.ts';
import { FacilityInteraction } from '../core/facilityInteraction.ts';
import { GOOSE_HEIGHT, PLAYER_HEIGHT } from '../core/config.ts';

const GROUND = 2;
const DT = 1 / 30;
/** A closed door across z at z = -1, 2 m wide and 3 m high, at floor level (a Facility door). */
const DOOR: DoorPlane = { axis: 'z', side: -1, x: 0, z: -1, width: 2, height: 3 };

let physics: PhysicsWorld;

beforeAll(async () => {
  physics = await PhysicsWorld.create();
  setHeightOverride(() => GROUND);
});

afterAll(() => {
  setHeightOverride(null);
  physics.dispose();
});

afterEach(() => {
  setEnemyDoorGate(null);
  setEnemyNavigator(null);
  setEnemyFloor(null);
  setEnemyEntrance(null);
});

/** A player standing with feet at `feet`: the body centre goose targets are given. */
const playerAt = (x: number, feet: number, z: number) => new THREE.Vector3(x, feet + PLAYER_HEIGHT / 2, z);

function run(goose: HordeGoose, target: THREE.Vector3, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds && !goose.isDead; t += DT) {
    goose.update(DT, target);
    physics.step(DT);
    each?.();
  }
}

/** The Valley's wiring for one bunkhouse: its navigator, floor, entrance and door gate. */
function valleyHouse(design: number) {
  const placement: HousePlacement = { ref: { gx: 0, gz: 0, index: 0 }, design, x: 10, groundY: GROUND, z: 20, rotationY: 0 };
  const houses = new ValleyHouses(new THREE.Scene(), physics.world, (ref) => (ref.index === 0 && ref.gx === 0 && ref.gz === 0 ? placement : null), false);
  houses.housePlaced('house-0', placement, new THREE.Group());
  const interaction = new FacilityInteraction({
    objects: houses.doors,
    physics,
    camera: new THREE.PerspectiveCamera(),
    player: { isDead: false, position: new THREE.Vector3(500, 0, 500), facingYaw: 0 } as never,
    hud: {} as never,
    sound: { playDoorSlide: vi.fn() } as never,
    multiplayer: null,
  });
  setEnemyNavigator(houses.nav.navigate);
  setEnemyFloor(houses.nav.floorAt);
  setEnemyEntrance(houses.nav.entranceAt);
  setEnemyDoorGate(interaction.enemyGate);
  const door = houses.doors.debugDoors()[0]!;
  const room = (index: number) => {
    const b = HOUSE_LAYOUTS[design]!.rooms[index]!.bounds;
    const at = houseToWorld((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2, placement.x, placement.groundY, placement.z, 0);
    return { x: at.x, feet: at.y, z: at.z };
  };
  return { houses, placement, door, id: houseObjectId(houseKey(placement.ref), FRONT_DOOR_SLOT), room };
}

describe('horde goose contact', () => {
  it('reaches a player beside it outdoors, wherever the player stands high above the ground', () => {
    const goose = new THREE.Vector3(0, GROUND + GOOSE_HEIGHT / 2, 0);
    expect(hordeGooseReaches(goose, playerAt(1, GROUND, 0))).toBe(true);
    expect(hordeGooseReaches(goose, playerAt(1.5, GROUND, 0))).toBe(false);
    // On a watch tower 8 m up, geese gathered below still reach them (no house about).
    expect(hordeGooseReaches(goose, playerAt(0.3, GROUND + 8, 0))).toBe(true);
  });

  it('in a Valley house it is vertical too: not a player upstairs, but one on the roof', () => {
    const { houses, placement, room } = valleyHouse(1);
    const upper = room(1);
    const ground = room(0);
    expect(upper.feet).toBeCloseTo(GROUND + 3.05, 6);
    const below = new THREE.Vector3(upper.x, GROUND + GOOSE_HEIGHT / 2, upper.z);
    // Upstairs, straight overhead of a goose on the ground floor.
    expect(hordeGooseReaches(below, playerAt(upper.x, upper.feet, upper.z))).toBe(false);
    expect(hordeGooseReaches(new THREE.Vector3(upper.x, upper.feet + GOOSE_HEIGHT / 2, upper.z), playerAt(upper.x, upper.feet, upper.z))).toBe(true);
    // Beside a player on the ground floor.
    expect(hordeGooseReaches(new THREE.Vector3(ground.x, GROUND + GOOSE_HEIGHT / 2, ground.z), playerAt(ground.x + 0.5, ground.feet, ground.z))).toBe(true);
    // On the roof, high above the top floor: the geese below are the ones that reach them.
    expect(placement.groundY).toBe(GROUND);
    expect(hordeGooseReaches(below, playerAt(upper.x, upper.feet + 6, upper.z))).toBe(true);
    houses.dispose();
  });
});

describe('horde geese and closed doors', () => {
  it('a walker stops at a closed door instead of walking through it', () => {
    setEnemyDoorGate((_id, x, z, dirX, dirZ, _dt, reach, feetY) => walkMeetsDoor({ ...DOOR, y: GROUND }, x, z, dirX, dirZ, reach, feetY));
    const goose = new HordeGoose(physics, new THREE.Vector3(0, GROUND + GOOSE_HEIGHT / 2, 0), 'walker', 3);
    run(goose, playerAt(0, GROUND, -6), 2);
    expect(goose.isDead).toBe(false);
    expect(goose.position.z).toBeGreaterThan(DOOR.z);
    goose.dispose();
  });

  it('a walker that dies waiting at a closed door leaves no wait behind', () => {
    const waits = new EnemyDoorWaits();
    setEnemyDoorGate(
      (id, x, z, dirX, dirZ, dt, reach, feetY) => waits.step(id, walkMeetsDoor({ ...DOOR, y: GROUND }, x, z, dirX, dirZ, reach, feetY) ? 0 : -1, dt) !== 'walk',
      (id) => waits.forget(id),
    );
    const goose = new HordeGoose(physics, new THREE.Vector3(0, GROUND + GOOSE_HEIGHT / 2, 0), 'walker', 3);
    run(goose, playerAt(0, GROUND, -6), 1);
    expect(waits.size).toBe(1);
    goose.dispose();
    expect(waits.size).toBe(0);
  });

  it('an indoor flyer stops at a closed door under its header', () => {
    setEnemyDoorGate((_id, x, z, dirX, dirZ, _dt, reach, feetY) => walkMeetsDoor(DOOR, x, z, dirX, dirZ, reach, feetY));
    setHeightOverride(() => 0);
    const goose = new HordeGoose(physics, new THREE.Vector3(0, 0, 0), 'flyer', 3, '', undefined, () => 2.4);
    run(goose, playerAt(0, 0, -12), 2);
    expect(goose.isDead).toBe(false);
    expect(goose.position.z).toBeGreaterThan(DOOR.z);
    setHeightOverride(() => GROUND);
    goose.dispose();
  });

  it('a Valley walker goes in by the door, waits for it to open, and walks on the house floor', () => {
    const { houses, door, id, room } = valleyHouse(0);
    const inside = room(1);
    const goose = new HordeGoose(physics, new THREE.Vector3(door.x, GROUND + GOOSE_HEIGHT / 2, door.z + 8), 'walker', 3);
    const target = playerAt(inside.x, inside.feet, inside.z);
    let crossedClosed = false;
    run(goose, target, 30, () => {
      const p = goose.position;
      if (!houses.doors.state.isActive('door', id) && Math.sign(p.z - door.z) === door.side) crossedClosed = true;
    });
    expect(crossedClosed).toBe(false);
    expect(houses.doors.state.isActive('door', id)).toBe(true);
    expect(goose.hasReachedTarget).toBe(true);
    houses.dispose();
  });

  it('a Valley walker climbs the block stair to a player upstairs instead of exploding under them', () => {
    const { houses, room } = valleyHouse(1);
    const upper = room(1);
    expect(upper.feet).toBeCloseTo(GROUND + 3.05, 6);
    const goose = new HordeGoose(physics, new THREE.Vector3(10, GROUND + GOOSE_HEIGHT / 2, 30), 'walker', 3);
    const target = playerAt(upper.x - 0.8, upper.feet, upper.z);
    run(goose, target, 40);
    expect(goose.hasReachedTarget).toBe(true);
    // It got there on the upper floor, not from the ground floor below.
    expect(goose.position.y).toBeGreaterThan(GROUND + 2.5);
    houses.dispose();
  });

  it('a Valley flyer whose target is indoors lands outside the door, not on the roof', () => {
    const { houses, room } = valleyHouse(0);
    const inside = room(1);
    const goose = new HordeGoose(physics, new THREE.Vector3(inside.x + 20, GROUND, inside.z + 20), 'flyer', 3);
    const target = playerAt(inside.x, inside.feet, inside.z);
    let overHouse = false;
    // The descent (1.5 s) and a little walking.
    run(goose, target, 1.6, () => {
      if (houses.nav.isInside(goose.position.x, goose.position.z)) overHouse = true;
    });
    expect(overHouse).toBe(false);
    expect(goose.isDead).toBe(false);
    houses.dispose();
  });
});
