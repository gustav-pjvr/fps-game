import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Enemy } from './Enemy.ts';
import { CombatCoordinator } from './combatCoordinator.ts';
import { SquadKnowledge } from './squadKnowledge.ts';
import { ENEMY_ARCHETYPES } from './archetypes.ts';
import { setEnemyDoorGate, setEnemyNavigator } from './enemyNavigator.ts';
import { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { setHeightOverride } from '../../world/TerrainGenerator.ts';
import { walkMeetsDoor, type DoorPlane } from '../../world/doors/doorGeometry.ts';
import { ENEMY_HEIGHT } from '../../core/config.ts';
import { mulberry32 } from '../../utils/rng.ts';

/** A closed door across z at z = -1, 2 m wide, on flat ground. */
const DOOR: DoorPlane = { axis: 'z', side: -1, x: 0, z: -1, width: 2, height: 2.1 };

let physics: PhysicsWorld;

beforeAll(async () => {
  physics = await PhysicsWorld.create();
  setHeightOverride(() => 0);
});

afterAll(() => {
  setHeightOverride(null);
  physics.dispose();
});

afterEach(() => {
  setEnemyDoorGate(null);
  setEnemyNavigator(null);
});

function makeEnemy(): Enemy {
  const gltf = { scene: new THREE.Group(), animations: [] } as unknown as GLTF;
  return new Enemy(
    physics, new THREE.Vector3(0, ENEMY_HEIGHT / 2, 0), gltf, ENEMY_ARCHETYPES[0]!, new CombatCoordinator({ shooter: 2 }, mulberry32(1)),
    new SquadKnowledge(), { emit: () => {} }, { onRangedShotFired: () => {} }, mulberry32(2), mulberry32(3),
  );
}

/** A gate that holds any walker whose walk meets the closed door, recording what it was asked. */
function closedDoorGate(): { calls: { reach?: number; feetY?: number }[] } {
  const record = { calls: [] as { reach?: number; feetY?: number }[] };
  setEnemyDoorGate((_id, x, z, dirX, dirZ, _dt, reach, feetY) => {
    record.calls.push({ reach, feetY });
    return walkMeetsDoor(DOOR, x, z, dirX, dirZ, reach, feetY);
  });
  return record;
}

describe('Enemy and closed doors', () => {
  it('a kiting enemy backing toward a closed door stops at it instead of backing through', () => {
    const enemy = makeEnemy();
    physics.step(1 / 60);
    const gate = closedDoorGate();
    // The threat is in front (+z); the retreat backs toward -z, through the door 1 m behind.
    for (let i = 0; i < 30; i++) {
      enemy.retreatFrom(0, 5, 3, 1 / 30);
      physics.step(1 / 30);
    }
    expect(gate.calls.length).toBeGreaterThan(0);
    expect(enemy.mesh.position.z).toBeGreaterThan(DOOR.z);
    expect(enemy.isMoving).toBe(false);
    enemy.dispose();
  });

  it('passes the waypoint distance and its feet height to the gate when walking', () => {
    const enemy = makeEnemy();
    physics.step(1 / 60);
    const gate = closedDoorGate();
    // A target 0.5 m short of the door: the walk never crosses it, so the enemy walks on.
    enemy.moveToward(0, -0.5, 2, 1 / 30);
    expect(gate.calls.at(-1)?.reach).toBeCloseTo(0.5, 5);
    expect(gate.calls.at(-1)?.feetY).toBeCloseTo(0, 5);
    expect(enemy.isMoving).toBe(true);
    // A target beyond the door: held.
    physics.step(1 / 30);
    const before = enemy.mesh.position.z;
    enemy.moveToward(0, -4, 2, 1 / 30);
    expect(enemy.mesh.position.z).toBe(before);
    enemy.dispose();
  });
});
