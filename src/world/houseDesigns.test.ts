import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { HOUSE_DESIGNS, outsideOpenings } from './houseDesigns.ts';
import { createBoxCollider, createHullCollider } from './structureKit.ts';
import { wallPieces } from './houses/houseLayout.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { GRAVITY, PLAYER_HEIGHT, PLAYER_MOVE_SPEED, PLAYER_RADIUS } from '../core/config.ts';

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
      // The block's stair ramp is a tilted slab whose foot sits a little into the ground floor.
      expect(bounds.min.y).toBeGreaterThanOrEqual(design.layout.stair ? -0.15 : -1e-6);
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

  it('stop shots at their walls, let them through every window and the doorway, and leave no gap under the roof', () => {
    for (const design of HOUSE_DESIGNS) {
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      for (const solid of design.solids) createBoxCollider(world, body, solid.box);
      for (const points of design.hulls) expect(createHullCollider(world, body, points)).not.toBeNull();
      world.step();
      const shoot = (from: THREE.Vector3, dir: THREE.Vector3) => world.castRay(new RAPIER.Ray(from, dir), 50, true);
      for (const wall of design.layout.walls.filter((w) => w.outward !== 0)) {
        // From 3 m outside, straight at the wall: each solid piece stops the shot at the outer face.
        const inward = new THREE.Vector3(wall.run === 'z' ? -wall.outward : 0, 0, wall.run === 'x' ? -wall.outward : 0);
        for (const piece of wallPieces(wall)) {
          const centre = new THREE.Vector3((piece.minX + piece.maxX) / 2, (piece.minY + piece.maxY) / 2, (piece.minZ + piece.maxZ) / 2);
          const hit = shoot(centre.clone().addScaledVector(inward, -(3 + wall.thickness / 2)), inward);
          expect(hit, `${design.name} wall piece`).not.toBeNull();
          expect(hit!.timeOfImpact).toBeLessThanOrEqual(3 + 1e-3);
        }
      }
      for (const { wall, opening } of outsideOpenings(design)) {
        // Through the middle of a window or the doorway, a shot carries on into the house.
        const inward = new THREE.Vector3(wall.run === 'z' ? -wall.outward : 0, 0, wall.run === 'x' ? -wall.outward : 0);
        const y = opening.bottom + opening.height * (opening.kind === 'door' ? 0.6 : 0.5);
        const centre = wall.run === 'x' ? new THREE.Vector3(opening.along, y, wall.at) : new THREE.Vector3(wall.at, y, opening.along);
        const hit = shoot(centre.clone().addScaledVector(inward, -3), inward);
        expect(hit?.timeOfImpact ?? Infinity, `${design.name} ${opening.kind} at ${opening.along}`).toBeGreaterThan(3 + wall.thickness / 2 + 0.3);
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

// Walks into each house the way Player.ts moves (the tower test's walker): the same capsule and
// character controller settings, gravity and walking speed, at 60 Hz, with the door open.
const DT = 1 / 60;

interface Walker { physics: PhysicsWorld; body: RAPIER.RigidBody; collider: RAPIER.Collider; controller: RAPIER.KinematicCharacterController; vy: number }

async function houseWorld(index: number): Promise<PhysicsWorld> {
  const physics = await PhysicsWorld.create();
  const ground = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(40, 1, 40).setTranslation(0, -1, 0), ground);
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const design = HOUSE_DESIGNS[index]!;
  for (const solid of design.solids) createBoxCollider(physics.world, body, solid.box);
  for (const points of design.hulls) createHullCollider(physics.world, body, points);
  physics.step(DT);
  return physics;
}

function spawnWalker(physics: PhysicsWorld, x: number, z: number): Walker {
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, PLAYER_HEIGHT / 2 + 0.05, z));
  const collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS), body);
  const controller = physics.world.createCharacterController(0.05);
  controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
  controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);
  controller.enableAutostep(0.5, 0.2, true);
  controller.enableSnapToGround(0.3);
  physics.step(DT);
  return { physics, body, collider, controller, vy: 0 };
}

/** Walks through the waypoints in order: how many it reached, and its feet's height at the end. */
function walk(walker: Walker, route: [number, number][], seconds: number): { reached: number; feet: number } {
  let reached = 0;
  for (let frame = 0; frame < seconds / DT && reached < route.length; frame++) {
    const at = walker.body.translation();
    const [tx, tz] = route[reached]!;
    const dx = tx - at.x, dz = tz - at.z, distance = Math.hypot(dx, dz);
    if (distance < 0.2) { reached++; continue; }
    const speed = PLAYER_MOVE_SPEED * DT;
    walker.vy += GRAVITY * DT;
    walker.controller.computeColliderMovement(walker.collider, { x: dx / distance * speed, y: walker.vy * DT, z: dz / distance * speed });
    const moved = walker.controller.computedMovement();
    if (walker.controller.computedGrounded() && walker.vy < 0) walker.vy = 0;
    walker.body.setNextKinematicTranslation({ x: at.x + moved.x, y: at.y + moved.y, z: at.z + moved.z });
    walker.physics.step(DT);
  }
  // The controller keeps a small offset (0.05) between the capsule and the ground.
  return { reached, feet: walker.body.translation().y - PLAYER_HEIGHT / 2 - 0.05 };
}

describe('walking into the houses', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  // From the street through the front door into each room (and on the block up the stair).
  const routes: { name: string; index: number; route: [number, number][]; feet: number }[] = [
    { name: 'bunkhouse front room', index: 0, route: [[0.3, 5], [0.3, 2.4], [0.4, 1.6]], feet: 0.05 },
    { name: 'bunkhouse bunk room', index: 0, route: [[0.3, 5], [0.3, 2.4], [-0.5, 0.8], [-0.5, -0.6], [0, -1.6], [0, -2.1]], feet: 0.05 },
    { name: 'block ground floor', index: 1, route: [[-0.3, 5.5], [-0.3, 2.8], [-0.3, -1.0], [-0.6, -2.2]], feet: 0.05 },
    { name: 'block upper floor', index: 1, route: [[-0.3, 5.5], [-0.3, 2.85], [1.0, 2.85], [1.0, -2.5], [1.0, -2.8], [-0.4, -2.8], [-0.4, 1.0], [-0.3, 2.6]], feet: 3.05 },
    { name: 'workshop hall', index: 2, route: [[1.65, 5.5], [1.65, 2.5], [0.6, 0], [-1.5, -1.5]], feet: 0.05 },
    { name: 'workshop office', index: 2, route: [[1.65, 5.5], [1.65, 2.5], [1.75, -0.4], [1.75, -1.6], [1.3, -2.3]], feet: 0.05 },
  ];
  for (const { name, index, route, feet } of routes) {
    it(`a player walks from the street into the ${name}`, async () => {
      const physics = await houseWorld(index);
      const walker = spawnWalker(physics, route[0]![0], route[0]![1]);
      const result = walk(walker, route.slice(1), 25);
      expect(result.reached, name).toBe(route.length - 1);
      expect(result.feet).toBeCloseTo(feet, 1);
    });
  }
});
