import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { HOUSE_DESIGNS } from './houseDesigns.ts';
import { createBoxCollider, createHullCollider } from './structureKit.ts';

/** Every corner of a design's solid parts and gable fills, in its local frame. */
function solidCorners(design: (typeof HOUSE_DESIGNS)[number]): THREE.Vector3[] {
  const corners: THREE.Vector3[] = [];
  for (const { box } of design.solids) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      corners.push(new THREE.Vector3(sx * box.halfExtents.x, sy * box.halfExtents.y, sz * box.halfExtents.z).applyQuaternion(box.rotation).add(box.center));
    }
  }
  for (const points of design.hulls) {
    for (let i = 0; i < points.length; i += 3) corners.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
  }
  return corners;
}

describe('house designs', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('keep the footprints of the Kenney houses they replace, so town layouts stay put', () => {
    expect(HOUSE_DESIGNS.map((d) => [d.footprintWidth, d.footprintDepth])).toEqual([
      [3.83, 7.0],
      [3.58, 7.22],
      [6.56, 7.22],
    ]);
  });

  it('fill their footprint and stay inside it, standing on the ground', () => {
    // A tilted roof slab's thickness carries its corners a few centimetres past the eave line.
    const slack = 0.05;
    for (const design of HOUSE_DESIGNS) {
      const corners = solidCorners(design);
      const bounds = new THREE.Box3().setFromPoints(corners);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(bounds.min.y).toBeLessThan(0.01);
      expect(bounds.max.x).toBeLessThanOrEqual(design.footprintWidth / 2 + slack);
      expect(bounds.min.x).toBeGreaterThanOrEqual(-design.footprintWidth / 2 - slack);
      expect(bounds.max.z).toBeLessThanOrEqual(design.footprintDepth / 2 + slack);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-design.footprintDepth / 2 - slack);
      // The roof reaches the footprint's edge on the long sides (the eaves), within a few cm.
      expect(bounds.max.x).toBeGreaterThan(design.footprintWidth / 2 - 0.05);
      expect(bounds.max.y).toBeGreaterThan(3.5);
    }
  });

  it('stop a shot at chest height from every side and leave no gap under the roof', () => {
    for (const design of HOUSE_DESIGNS) {
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      for (const solid of design.solids) createBoxCollider(world, body, solid.box);
      for (const points of design.hulls) expect(createHullCollider(world, body, points)).not.toBeNull();
      world.step();
      const shoot = (from: THREE.Vector3, dir: THREE.Vector3) => world.castRay(new RAPIER.Ray(from, dir), 50, true);
      for (const y of [1.3, 2.8]) {
        expect(shoot(new THREE.Vector3(-20, y, 0), new THREE.Vector3(1, 0, 0)), `${design.name} from -x at ${y}`).not.toBeNull();
        expect(shoot(new THREE.Vector3(20, y, 0.5), new THREE.Vector3(-1, 0, 0)), `${design.name} from +x at ${y}`).not.toBeNull();
        expect(shoot(new THREE.Vector3(0.3, y, 20), new THREE.Vector3(0, 0, -1)), `${design.name} from +z at ${y}`).not.toBeNull();
      }
      // Straight down through the middle of the roof hits the roof, not the floor.
      const down = shoot(new THREE.Vector3(0.2, 30, 0.2), new THREE.Vector3(0, -1, 0));
      expect(down).not.toBeNull();
      expect(30 - down!.timeOfImpact).toBeGreaterThan(3);
      // Just under the eave and above the wall, a level shot along the long side finds no gap.
      expect(shoot(new THREE.Vector3(0, 3.1, 20), new THREE.Vector3(0, 0, -1)), `${design.name} under the eave`).not.toBeNull();
      world.free();
    }
  });
});
