import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { HOUSE_LIGHT_POOL } from './HouseLights.ts';
import { HOUSE_LAYOUTS } from './houseLayout.ts';
import { HOUSE_CELL_REACH, houseKey, houseObjectId, isHouseInWorld, type HouseRef } from './valleyHouseIds.ts';
import { FRONT_DOOR_SLOT, ValleyHouses, type HousePlacement } from './ValleyHouses.ts';

// Two towns' worth of houses the fake layout knows about; anything else is not a house.
const PLACEMENTS: HousePlacement[] = [
  { ref: { gx: 0, gz: 0, index: 0 }, design: 0, x: 10, groundY: 2, z: 20, rotationY: 0 },
  { ref: { gx: 0, gz: 0, index: 1 }, design: 1, x: 30, groundY: 2, z: 20, rotationY: Math.PI / 2 },
  { ref: { gx: -1, gz: 3, index: 4 }, design: 2, x: -60, groundY: 5, z: 160, rotationY: Math.PI },
];
const houseAt = (ref: HouseRef): HousePlacement | null =>
  PLACEMENTS.find((p) => p.ref.gx === ref.gx && p.ref.gz === ref.gz && p.ref.index === ref.index) ?? null;
const cameraAt = (x: number, y: number, z: number): THREE.Camera => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  camera.updateMatrixWorld();
  return camera;
};
const doorId = (p: HousePlacement) => houseObjectId(houseKey(p.ref), FRONT_DOOR_SLOT);

function setup(lampsOn = true) {
  const scene = new THREE.Scene();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const houses = new ValleyHouses(scene, world, houseAt, lampsOn);
  const interiors = PLACEMENTS.map(() => new THREE.Group());
  const place = (i: number) => houses.housePlaced(`house-${i}`, PLACEMENTS[i]!, interiors[i]!);
  return { scene, world, houses, interiors, place };
}

describe('Valley house doors', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('know every house door in the world, streamed in or not, and nothing else', () => {
    const { houses } = setup();
    for (const p of PLACEMENTS) expect(houses.doors.state.has('door', doorId(p))).toBe(true);
    expect(houses.doors.state.has('door', houseObjectId(houseKey(PLACEMENTS[0]!.ref), 1))).toBe(false);
    expect(houses.doors.state.has('door', houseObjectId(houseKey({ gx: 5, gz: 5, index: 0 }), 0))).toBe(false);
    expect(houses.doors.state.has('breaker', doorId(PLACEMENTS[0]!))).toBe(false);
    expect(houses.doors.state.has('door', -4)).toBe(false);
  });

  it('start closed, open and close with their collider, and keep their state while streamed out', () => {
    const { houses, world, place } = setup();
    place(0);
    const id = doorId(PLACEMENTS[0]!), door = houses.doors.debugDoors()[0]!;
    // Bunkhouse at (10, 2, 20), unturned: the door is in the front wall, the room toward -z.
    expect(door).toMatchObject({ id, axis: 'z', side: -1, open: false, collider: true });
    expect(door.x).toBeCloseTo(10.3, 6);
    expect(door.z).toBeCloseTo(20 + HOUSE_LAYOUTS[0]!.door.z, 6);
    world.step();
    const shot = () => world.castRay(new RAPIER.Ray({ x: 10.3, y: 3.2, z: 25 }, { x: 0, y: 0, z: -1 }), 10, true);
    expect(shot()).not.toBeNull();
    expect(houses.doors.set('door', id, true)).toBe(true);
    expect(houses.doors.set('door', id, true)).toBe(false);
    world.step();
    expect(shot()).toBeNull();
    // Streamed out and back in, it is still open.
    houses.houseRemoved('house-0');
    expect(houses.doors.debugDoors()).toHaveLength(0);
    expect(houses.doors.state.isActive('door', id)).toBe(true);
    place(0);
    expect(houses.doors.debugDoors()[0]).toMatchObject({ open: true, collider: false });
    // A door streamed out can still be set (the host deciding for a guest far away).
    const far = doorId(PLACEMENTS[2]!);
    expect(houses.doors.set('door', far, true)).toBe(true);
    expect(houses.doors.distanceTo('door', far, -60, 160)).toBeGreaterThan(2.5);
  });

  it('send and adopt the open doors as a list, refusing lists that name anything but real doors', () => {
    const host = setup(), guest = setup();
    host.place(0); guest.place(0); guest.place(1);
    const a = doorId(PLACEMENTS[0]!), b = doorId(PLACEMENTS[2]!);
    host.houses.doors.set('door', b, true);
    host.houses.doors.set('door', a, true);
    const wire = host.houses.doors.wire();
    expect(wire).toEqual({ doors: '', breakers: '', valleyDoors: [a, b].sort((x, y) => x - y) });
    const parsed = guest.houses.doors.parseWire(JSON.parse(JSON.stringify(wire)));
    expect(parsed).not.toBeNull();
    expect(guest.houses.doors.applyWire(parsed!, true).doors.sort()).toEqual([a, b].sort());
    expect(guest.houses.doors.debugDoors().find((d) => d.id === a)).toMatchObject({ open: true, collider: false });
    // Closing one on the host closes it on the guest.
    host.houses.doors.set('door', a, false);
    expect(guest.houses.doors.applyWire(guest.houses.doors.parseWire(host.houses.doors.wire())!).doors).toEqual([a]);
    expect(guest.houses.doors.state.isActive('door', a)).toBe(false);
    for (const bad of [null, {}, { doors: '01', breakers: '', valleyDoors: [] }, { doors: '', breakers: '', valleyDoors: [a, 99] },
      { doors: '', breakers: '', valleyDoors: 'x' }, { doors: '', breakers: '', valleyDoors: [a + 1] }]) {
      expect(guest.houses.doors.parseWire(bad)).toBeNull();
    }
    expect(guest.houses.doors.reset().doors).toEqual([b]);
  });

  it('pick the door a look ray crosses, find bodies in its way and closed doors ahead of a walk', () => {
    const { houses, place } = setup();
    place(1);
    const id = doorId(PLACEMENTS[1]!), door = houses.doors.debugDoors()[0]!;
    // The block turned a quarter: its front faces +x, so the door's plane is across x.
    expect(door.axis).toBe('x');
    const eye = new THREE.Vector3(door.x - door.side * 1.5, door.y + 1.6, door.z);
    const look = new THREE.Vector3(door.side, 0, 0);
    expect(houses.doors.pick(eye, look, 2.2)).toMatchObject({ kind: 'door', id });
    expect(houses.doors.pick(eye, look.clone().negate(), 2.2)).toBeNull();
    expect(houses.doors.doorwayOccupied(id, [{ x: door.x, z: door.z + 0.2 }], 0.4)).toBe(true);
    expect(houses.doors.doorwayOccupied(id, [{ x: door.x - door.side * 1.2, z: door.z }], 0.4)).toBe(false);
    expect(houses.doors.closedDoorAhead(door.x - door.side * 1, door.z, door.side, 0)).toBe(id);
    houses.doors.set('door', id, true);
    expect(houses.doors.closedDoorAhead(door.x - door.side * 1, door.z, door.side, 0)).toBe(-1);
  });
});

describe('Valley house lamps', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('light one lamp per room at night, none by day, and move the light pool to the nearest', () => {
    const night = setup(true);
    PLACEMENTS.forEach((_, i) => night.place(i));
    const rooms = PLACEMENTS.reduce((sum, p) => sum + HOUSE_LAYOUTS[p.design]!.rooms.length, 0);
    expect(night.houses.lights.debug()).toMatchObject({ lamps: rooms, lit: rooms, dead: 0 });
    expect(night.scene.children.filter((c) => c instanceof THREE.PointLight)).toHaveLength(HOUSE_LIGHT_POOL);
    night.houses.update(0.016, cameraAt(10, 3, 20));
    const lights = night.houses.lights.debug().lights;
    expect(lights.filter((l) => l.on)).toHaveLength(HOUSE_LIGHT_POOL);
    // The far workshop (at -60, 160) gets none of them.
    expect(lights.every((l) => l.z < 100)).toBe(true);

    const day = setup(false);
    day.place(0);
    expect(day.houses.lights.debug()).toMatchObject({ lit: 0, lights: [] });
    expect(day.scene.children.some((c) => c instanceof THREE.PointLight)).toBe(false);
  });

  it('break a lamp a pellet reaches first, keep it dead through streaming, and hide far interiors', () => {
    const { houses, place, interiors } = setup(true);
    place(0);
    const lamp = HOUSE_LAYOUTS[0]!.rooms[0]!.lamp;
    const under = new THREE.Vector3(10 + lamp.x, 2 + 1.6, 20 + lamp.z), up = new THREE.Vector3(0, 1, 0);
    // A wall nearer than the lamp keeps it whole.
    expect(houses.shootRay(under, up, 0.5)).toBeNull();
    const hit = houses.shootRay(under, up, 10);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeCloseTo(2 + lamp.y, 6);
    expect(houses.shootRay(under, up, 10)).toBeNull();
    houses.houseRemoved('house-0');
    place(0);
    expect(houses.lights.isLit(hit!.id)).toBe(false);
    expect(houses.lights.deadLampIds()).toEqual([hit!.id]);

    place(2);
    houses.update(0.016, cameraAt(10, 2, 25));
    expect(interiors[0]!.visible).toBe(true);
    expect(interiors[2]!.visible).toBe(false);
  });

  it('grow the lamp mesh past its first capacity without losing a lamp', () => {
    const { houses } = setup(true);
    for (let i = 0; i < 150; i++) houses.lights.addLamp(i, i, 3, 0);
    expect(houses.lights.debug().lamps).toBe(150);
    for (let i = 0; i < 150; i += 2) houses.lights.removeLamp(i);
    for (let i = 200; i < 260; i++) houses.lights.addLamp(i, i, 3, 5);
    expect(houses.lights.debug()).toMatchObject({ lamps: 135, lit: 135 });
    expect(houses.lights.rayHitLamp(new THREE.Vector3(249, 0, 5), new THREE.Vector3(0, 1, 0), 10)).toBe(249);
  });

  it('take lamp ids from the network only for real lamps of real houses, and kill them quietly', () => {
    const { houses, place } = setup(true);
    place(0);
    const bunkhouse = houseKey(PLACEMENTS[0]!.ref), block = houseKey(PLACEMENTS[1]!.ref);
    // The bunkhouse has two rooms, so lamps 0 and 1; the block (not streamed in) two as well.
    expect(houses.isLampId(houseObjectId(bunkhouse, 0))).toBe(true);
    expect(houses.isLampId(houseObjectId(bunkhouse, 1))).toBe(true);
    expect(houses.isLampId(houseObjectId(bunkhouse, 2))).toBe(false);
    expect(houses.isLampId(houseObjectId(block, 1))).toBe(true);
    expect(houses.isLampId(houseObjectId(houseKey({ gx: 9, gz: 9, index: 0 }), 0))).toBe(false);
    expect(houses.isLampId(-1)).toBe(false);
    // The wire is plain JSON numbers: a late joiner's welcome or a lampSync, with junk mixed in.
    const wire = JSON.parse(JSON.stringify([houseObjectId(bunkhouse, 1), 'x', -3, 2.5, houseObjectId(bunkhouse, 3), houseObjectId(block, 0), houseObjectId(bunkhouse, 1)]));
    houses.killLampsQuietly(wire);
    expect(houses.lights.deadLampIds()).toEqual([houseObjectId(block, 0), houseObjectId(bunkhouse, 1)].sort((a, b) => a - b));
    expect(houses.lights.isLit(houseObjectId(bunkhouse, 1))).toBe(false);
    expect(houses.lights.isLit(houseObjectId(bunkhouse, 0))).toBe(true);
    // The block streams in later with its lamp already dark.
    place(1);
    expect(houses.lights.isLit(houseObjectId(block, 0))).toBe(false);
    expect(houses.lights.isLit(houseObjectId(block, 1))).toBe(true);
    houses.killLampsQuietly('not a list');
    expect(houses.lights.deadLampIds()).toHaveLength(2);
  });

  it('never look up a house whose town lies outside the world, for a door or a lamp id from the network', () => {
    const lookups: HouseRef[] = [];
    const counting = (ref: HouseRef) => {
      lookups.push(ref);
      return houseAt(ref);
    };
    const houses = new ValleyHouses(new THREE.Scene(), new RAPIER.World({ x: 0, y: -9.81, z: 0 }), counting, true);
    // A peer's lampSync or worldInteract full of well-formed ids for towns up to 2048 cells away.
    const far: number[] = [];
    for (let gx = -2048; gx < 2048; gx += 37) far.push(houseObjectId(houseKey({ gx, gz: 2047 - Math.abs(gx), index: 0 }), 0));
    expect(far.length).toBeGreaterThan(100);
    houses.killLampsQuietly(far);
    for (const id of far) {
      expect(houses.isLampId(id)).toBe(false);
      expect(houses.doors.state.has('door', id)).toBe(false);
    }
    expect(lookups).toEqual([]);
    expect(houses.lights.deadLampIds()).toEqual([]);
    // The edge of the world is still asked; one cell past it is not.
    expect(isHouseInWorld({ gx: HOUSE_CELL_REACH, gz: -HOUSE_CELL_REACH, index: 0 })).toBe(true);
    expect(isHouseInWorld({ gx: HOUSE_CELL_REACH + 1, gz: 0, index: 0 })).toBe(false);
    expect(houses.isLampId(houseObjectId(houseKey(PLACEMENTS[2]!.ref), 0))).toBe(true);
    expect(lookups).toHaveLength(1);
  });
});
