import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { EnemyBrain } from './EnemyBrain.ts';
import { CombatCoordinator } from './combatCoordinator.ts';
import { SquadKnowledge } from './squadKnowledge.ts';
import { ENEMY_ARCHETYPES } from './archetypes.ts';
import type { EnemyBody, EnemyPosition } from './EnemyBody.ts';
import type { PlayerVisibility } from './playerVisibility.ts';
import type { Player } from '../Player.ts';
import { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { mulberry32 } from '../../utils/rng.ts';

/** The Ridge Walker: detection 20 m, leash 32 m. */
const ARCHETYPE = ENEMY_ARCHETYPES.find((archetype) => archetype.name === 'Ridge Walker')!;

class StillBody implements EnemyBody {
  readonly id = 1;
  readonly archetype = ARCHETYPE;
  readonly excludeRigidBody: RAPIER.RigidBody;
  position: EnemyPosition = { x: 0, y: 0.85, z: 0 };
  isMoving = false;
  /** Facing +z, toward the player. */
  facingYaw = 0;
  constructor(physics: PhysicsWorld) {
    this.excludeRigidBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(50, 50, 50));
  }
  moveToward(): void {}
  retreatFrom(): EnemyPosition | null {
    return null;
  }
  faceToward(): void {}
}

async function setup() {
  const physics = await PhysicsWorld.create();
  const brain = new EnemyBrain(
    new StillBody(physics), physics, new CombatCoordinator({ shooter: 2 }, mulberry32(1)), new SquadKnowledge(), { emit: () => {} },
    { onRangedShotFired: () => {} }, mulberry32(2), mulberry32(3), new THREE.Vector3(0, 0.85, 0),
  );
  const player = {
    position: new THREE.Vector3(0, 0.85, 6),
    movementBobStrength: 0,
    isDead: false,
    ownCollider: { handle: -5 },
    takeDamage: () => {},
  } as unknown as Player;
  const lightAt = (value: number): PlayerVisibility => ({ value, torchOn: false, eye: player.position, aim: { x: 0, y: 0, z: -1 } });
  const run = (seconds: number, visibility: PlayerVisibility): void => {
    for (let t = 0; t < seconds; t += 0.05) brain.update(0.05, player, visibility);
  };
  return { brain, player, lightAt, run };
}

describe('EnemyBrain sight range in the dark', () => {
  it('a chasing enemy keeps the player in sight past its detection range, in daylight and in the dark', async () => {
    const { brain, player, lightAt, run } = await setup();
    run(3, lightAt(1));
    expect(brain.debug.state).toBe('chase');
    // 25 m: beyond detection (20) and far beyond 20 * 0.25 in a dark room, inside the leash (32).
    player.position.set(0, 0.85, 25);
    for (const value of [1, 0.4, 0.25]) {
      run(1, lightAt(value));
      expect(brain.debug.hasLineOfSight).toBe(true);
      expect(brain.debug.state).toBe('chase');
    }
    // Past the leash it loses the player and stops chasing, as before.
    player.position.set(0, 0.85, ARCHETYPE.leashRange + 1);
    run(0.5, lightAt(1));
    expect(brain.debug.hasLineOfSight).toBe(false);
    expect(brain.debug.state).not.toBe('chase');
  });

  it('an idle enemy only notices the player within detection range scaled by visibility', async () => {
    const { brain, player, lightAt, run } = await setup();
    // 10 m in a dark room: beyond 20 * 0.25 = 5 m, so no sight ray and no awareness.
    player.position.set(0, 0.85, 10);
    run(3, lightAt(0.25));
    expect(brain.debug.hasLineOfSight).toBe(false);
    expect(brain.debug.awareness).toBe(0);
    expect(brain.debug.state).toBe('idle');
    // The same spot in daylight is inside detection range.
    run(3, lightAt(1));
    expect(brain.debug.hasLineOfSight).toBe(true);
    expect(brain.debug.state).not.toBe('idle');
  });
});
