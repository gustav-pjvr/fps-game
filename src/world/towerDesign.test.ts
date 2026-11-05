import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { createBoxCollider } from './structureKit.ts';
import { TOWER_DECK_HALF, TOWER_LANDINGS, towerParts, WATCH_TOWER_FOOTPRINT_RADIUS } from './towerDesign.ts';
import { GRAVITY, PLAYER_HEIGHT, PLAYER_MOVE_SPEED, PLAYER_RADIUS, SPRINT_MULTIPLIER, WATCH_TOWER_HEIGHT } from '../core/config.ts';

// Climbs a tower the way Player.ts moves: the same capsule, the same character controller settings
// (45 degree climb, 35 degree slide, 0.5 m autostep, 0.3 m snap), gravity, sprint speed, 60 Hz. The
// stairs are where the first towers failed (a flight merging into the deck, a player flung off a
// seam, a last flight running into the deck's underside), so they are walked, not just measured.

const DT = 1 / 60;
const DECK_STANDING_Y = WATCH_TOWER_HEIGHT + 0.15 + PLAYER_HEIGHT / 2;

interface Walker {
  physics: PhysicsWorld;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  verticalVelocity: number;
}

async function towerWorld(): Promise<PhysicsWorld> {
  const physics = await PhysicsWorld.create();
  const ground = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(60, 1, 60).setTranslation(0, -1, 0), ground);
  const tower = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const part of towerParts()) createBoxCollider(physics.world, tower, part.box);
  physics.step(DT);
  return physics;
}

function spawnWalker(physics: PhysicsWorld, x: number, y: number, z: number): Walker {
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
  const collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS), body);
  const controller = physics.world.createCharacterController(0.05);
  controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
  controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);
  controller.enableAutostep(0.5, 0.2, true);
  controller.enableSnapToGround(0.3);
  physics.step(DT);
  return { physics, body, collider, controller, verticalVelocity: 0 };
}

/** One frame of Player.update's movement: horizontal intent at sprint speed, gravity, collide. */
function stepToward(walker: Walker, dirX: number, dirZ: number): void {
  const speed = PLAYER_MOVE_SPEED * SPRINT_MULTIPLIER * DT;
  walker.verticalVelocity += GRAVITY * DT;
  walker.controller.computeColliderMovement(walker.collider, { x: dirX * speed, y: walker.verticalVelocity * DT, z: dirZ * speed });
  const moved = walker.controller.computedMovement();
  if (walker.controller.computedGrounded() && walker.verticalVelocity < 0) walker.verticalVelocity = 0;
  const at = walker.body.translation();
  walker.body.setNextKinematicTranslation({ x: at.x + moved.x, y: at.y + moved.y, z: at.z + moved.z });
  walker.physics.step(DT);
}

/** Walks through the waypoints in order; returns the lowest height reached after the highest so
 * far (how far it ever fell) and whether every waypoint was reached in time. */
function walkRoute(walker: Walker, route: [number, number][], seconds: number): { reached: number; worstDrop: number } {
  let reached = 0;
  let highest = -Infinity;
  let worstDrop = 0;
  for (let frame = 0; frame < seconds / DT && reached < route.length; frame++) {
    const at = walker.body.translation();
    const [tx, tz] = route[reached]!;
    const dx = tx - at.x;
    const dz = tz - at.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.25) {
      reached++;
      continue;
    }
    stepToward(walker, dx / distance, dz / distance);
    const y = walker.body.translation().y;
    highest = Math.max(highest, y);
    worstDrop = Math.max(worstDrop, highest - y);
  }
  return { reached, worstDrop };
}

/** Holds one direction for a while: a player sprinting without turning. */
function sprint(walker: Walker, dirX: number, dirZ: number, seconds: number): void {
  for (let frame = 0; frame < seconds / DT; frame++) stepToward(walker, dirX, dirZ);
}

const landing = (k: number): [number, number] => [TOWER_LANDINGS[k]!.x, TOWER_LANDINGS[k]!.z];
const UP_ROUTE: [number, number][] = [[-9, landing(0)[1]], landing(0), landing(1), landing(2), landing(3), landing(4), landing(5), [landing(5)[0], 0], [0, 0]];

describe('watch tower stairs', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it.each(['south', 'west', 'north'] as const)('has a hollow room, east opening, ceiling and D1 floor hole facing %s', async (orientation) => {
    const physics = await PhysicsWorld.create();
    try {
      const tower = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      for (const part of towerParts(orientation)) createBoxCollider(physics.world, tower, part.box);
      physics.step(DT);
      const ray = (x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number) =>
        physics.world.castRay(new RAPIER.Ray({ x, y, z }, { x: dx, y: dy, z: dz }), length, true);
      expect(ray(0, 1, 0, 1, 0, 0, 3.5)).toBeNull();
      expect(ray(0, 1, 0, -1, 0, 0, 3)?.timeOfImpact).toBeCloseTo(2.7);
      expect(ray(0, 1, 0, 0, 1, 0, 3)?.timeOfImpact).toBeCloseTo(2);
      expect(ray(0, 0.8, 0, 0, -1, 0, 1)?.timeOfImpact).toBeCloseTo(0.75);
      const hole = orientation === 'west' ? { x: 0, z: 1.65 } : { x: -1.65, z: 0 };
      expect(ray(hole.x, 0.8, hole.z, 0, -1, 0, 3)).toBeNull();
    } finally { physics.dispose(); }
  });

  it('a sprinting player climbs all five flights onto the deck without falling', async () => {
    const physics = await towerWorld();
    const walker = spawnWalker(physics, -9, PLAYER_HEIGHT / 2 + 0.05, landing(0)[1]);
    const { reached, worstDrop } = walkRoute(walker, UP_ROUTE, 40);
    expect(reached).toBe(UP_ROUTE.length);
    expect(walker.body.translation().y).toBeCloseTo(DECK_STANDING_Y, 0);
    expect(Math.abs(walker.body.translation().y - DECK_STANDING_Y)).toBeLessThan(0.15);
    expect(worstDrop).toBeLessThan(0.6);
  });

  it('walks back down from the deck to the ground', async () => {
    const physics = await towerWorld();
    const walker = spawnWalker(physics, 0, DECK_STANDING_Y + 0.05, 0);
    const down = [...UP_ROUTE].reverse().slice(1);
    const { reached } = walkRoute(walker, down, 40);
    expect(reached).toBe(down.length);
    expect(walker.body.translation().y).toBeLessThan(PLAYER_HEIGHT / 2 + 0.3);
  });

  it('a player who runs straight past a turn stays on the landing', async () => {
    const physics = await towerWorld();
    for (const corner of [1, 2, 3, 4]) {
      const c = TOWER_LANDINGS[corner]!;
      const outward = { x: Math.sign(c.x), z: Math.sign(c.z) };
      for (const [dx, dz] of [[outward.x, 0], [0, outward.z]]) {
        const walker = spawnWalker(physics, c.x, c.y + PLAYER_HEIGHT / 2 + 0.05, c.z);
        sprint(walker, dx!, dz!, 1.5);
        const at = walker.body.translation();
        expect(at.y).toBeGreaterThan(c.y);
        expect(Math.max(Math.abs(at.x), Math.abs(at.z))).toBeLessThan(TOWER_DECK_HALF);
        physics.world.removeRigidBody(walker.body);
      }
    }
  });

  it('every guard rail runs along local X so it is drawn at full length', () => {
    for (const part of towerParts()) {
      if (part.rail === true) expect(part.box.halfExtents.x).toBeGreaterThan(part.box.halfExtents.z);
    }
  });

  it('the guard rails keep a player on the deck in every direction', async () => {
    const physics = await towerWorld();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]]) {
      const walker = spawnWalker(physics, 1.5, DECK_STANDING_Y + 0.05, 0);
      sprint(walker, dx!, dz!, 2);
      const at = walker.body.translation();
      expect(at.y).toBeGreaterThan(WATCH_TOWER_HEIGHT);
      expect(Math.max(Math.abs(at.x), Math.abs(at.z))).toBeLessThan(TOWER_DECK_HALF);
      physics.world.removeRigidBody(walker.body);
    }
  });

  it('no solid part reaches past the footprint radius the placement and terrain clearing use', () => {
    for (const part of towerParts()) {
      const h = part.box.halfExtents;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const corner = { x: sx * h.x, y: sy * h.y, z: sz * h.z };
        const q = part.box.rotation;
        // Rotate the corner by the part's quaternion, then offset by its centre.
        const ix = q.w * corner.x + q.y * corner.z - q.z * corner.y;
        const iy = q.w * corner.y + q.z * corner.x - q.x * corner.z;
        const iz = q.w * corner.z + q.x * corner.y - q.y * corner.x;
        const iw = -q.x * corner.x - q.y * corner.y - q.z * corner.z;
        const x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y + part.box.center.x;
        const z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x + part.box.center.z;
        // The roof's eaves overhang the deck by 0.3 m; everything that stands on the ground stays inside.
        expect(Math.hypot(x, z)).toBeLessThan(WATCH_TOWER_FOOTPRINT_RADIUS + 0.5);
      }
    }
  });
});
