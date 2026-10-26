import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { bodyInDoorway, distanceToDoor, doorPickBox, rayBoxDistance, segmentCrossesDoor, walkMeetsDoor, type DoorPlane } from './doorGeometry.ts';
import { SlidingDoorView, type SlidingDoorLook } from './SlidingDoorView.ts';

const FACILITY_DOOR: DoorPlane = { axis: 'x', side: 1, x: 2, z: -1, width: 2, height: 2.4 };
const RAISED_DOOR: DoorPlane = { axis: 'z', side: -1, x: 5, z: 3, y: 10.5, width: 1.1, height: 2.1 };

describe('shared door geometry', () => {
  it('picks a door at floor level when it has no height of its own, and at its floor otherwise', () => {
    expect(doorPickBox(FACILITY_DOOR)).toEqual({ cx: 2, cy: 1.2, cz: -1, hx: 0.15, hy: 1.2, hz: 1 });
    expect(doorPickBox(RAISED_DOOR)).toEqual({ cx: 5, cy: 11.55, cz: 3, hx: 0.55, hy: 1.05, hz: 0.15 });
    const box = doorPickBox(RAISED_DOOR);
    // A level look from 2 m out at eye height on the raised floor hits; the same look at ground level misses.
    expect(rayBoxDistance(box, 5, 12.1, 1, 0, 0, 1, 3)).toBeCloseTo(1.85, 5);
    expect(rayBoxDistance(box, 5, 1.6, 1, 0, 0, 1, 3)).toBe(Infinity);
    expect(rayBoxDistance(box, 5, 12.1, -2, 0, 0, 1, 3)).toBe(Infinity);
  });

  it('finds a walk across the opening, not one past its edge or alongside it', () => {
    expect(segmentCrossesDoor(RAISED_DOOR, 5, 2, 5.2, 4)).toBe(true);
    expect(segmentCrossesDoor(RAISED_DOOR, 6, 2, 6, 4)).toBe(false);
    expect(segmentCrossesDoor(RAISED_DOOR, 4, 2, 6, 2.5)).toBe(false);
  });

  it('meets a door only before the waypoint and at the height of its opening', () => {
    // 1 m in front of the raised door (plane z = 3), walking at it.
    expect(walkMeetsDoor(RAISED_DOOR, 5, 2, 0, 1)).toBe(true);
    expect(walkMeetsDoor(RAISED_DOOR, 5, 2, 0, 1, 3, 10.5)).toBe(true);
    // A waypoint 0.6 m on (a player standing with their back to the door) never needs it.
    expect(walkMeetsDoor(RAISED_DOOR, 5, 2, 0, 1, 0.6, 10.5)).toBe(false);
    // Feet on the ground just below the floor still count; an upper floor over the door does not.
    expect(walkMeetsDoor(RAISED_DOOR, 5, 2, 0, 1, 3, 9.8)).toBe(true);
    expect(walkMeetsDoor(RAISED_DOOR, 5, 2, 0, 1, 3, 10.5 + 3.05)).toBe(false);
    expect(walkMeetsDoor(RAISED_DOOR, 5, 2, 0, 1, 3, 10.5 + 2.1)).toBe(false);
    expect(walkMeetsDoor(RAISED_DOOR, 5, 2, 0, 1, 3, 8)).toBe(false);
    // Past the lookahead: not yet.
    expect(walkMeetsDoor(RAISED_DOOR, 5, 0, 0, 1, 10, 10.5)).toBe(false);
  });

  it('measures bodies in the doorway and the distance to it', () => {
    expect(bodyInDoorway(RAISED_DOOR, 5.3, 3.2, 0.4)).toBe(true);
    expect(bodyInDoorway(RAISED_DOOR, 5, 3.6, 0.4)).toBe(false);
    expect(distanceToDoor(RAISED_DOOR, 5, 1)).toBeCloseTo(2, 6);
    expect(distanceToDoor(RAISED_DOOR, 7.55, 3)).toBeCloseTo(2, 6);
  });
});

describe('SlidingDoorView', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  const look = (): SlidingDoorLook => {
    const material = new THREE.MeshBasicMaterial();
    return {
      box: (w, h, d) => new THREE.BoxGeometry(w, h, d), statusLamp: () => new THREE.BoxGeometry(0.16, 0.05, 0.02),
      steel: material, hazard: material, green: new THREE.MeshBasicMaterial(), red: new THREE.MeshBasicMaterial(),
    };
  };

  it('blocks a shot only while shut, at its own floor height, and slides its leaves into the wall', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const door = new SlidingDoorView(RAISED_DOOR, look(), world, body, true);
    world.step();
    const shot = () => world.castRay(new RAPIER.Ray({ x: 5, y: 11.6, z: 0 }, { x: 0, y: 0, z: 1 }), 10, true);
    expect(shot()?.timeOfImpact).toBeCloseTo(2.92, 2);
    expect(door.root.position.y).toBe(10.5);
    const leafX = () => door.root.children.slice(0, 2).map((leaf) => leaf.position.x);
    const expectLeaves = (at: number) => leafX().forEach((x, i) => expect(x).toBeCloseTo((i ? 1 : -1) * at, 9));
    expectLeaves(1.1 / 4);

    door.show(false, false);
    world.step();
    expect(shot()).toBeNull();
    // The collider follows at once; the leaves ease open over a full travel.
    door.update(0.5);
    expect(Math.abs(leafX()[0]!)).toBeGreaterThan(1.1 / 4);
    door.update(0.5);
    expectLeaves(0.75 * 1.1);

    door.show(true, true);
    expectLeaves(1.1 / 4);
    door.remove(world);
    world.step();
    expect(shot()).toBeNull();
    world.free();
  });
});
