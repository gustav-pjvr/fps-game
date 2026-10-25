import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FlashBlindState } from './flashBlind.ts';
import { EnemyBrain } from './EnemyBrain.ts';
import { CombatCoordinator } from './combatCoordinator.ts';
import { SquadKnowledge } from './squadKnowledge.ts';
import { ENEMY_ARCHETYPES } from './archetypes.ts';
import type { EnemyBody, EnemyPosition } from './EnemyBody.ts';
import type { Player } from '../Player.ts';
import { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { ENEMY_FLASH_FIRE_INTERVAL, ENEMY_STAGGER_DURATION } from '../../core/config.ts';
import { mulberry32 } from '../../utils/rng.ts';

describe('FlashBlindState', () => {
  it('lasts the given seconds, a second flash keeping the longer', () => {
    const blind = new FlashBlindState();
    blind.blind(2, false);
    blind.blind(1, false);
    blind.update(1.5, true);
    expect(blind.active).toBe(true);
    blind.update(0.6, true);
    expect(blind.active).toBe(false);
  });

  it('fires every interval only with a target before the flash and while it can fire', () => {
    const withTarget = new FlashBlindState();
    withTarget.blind(4, true);
    let shots = 0;
    for (let t = 0; t < 3; t += 0.05) if (withTarget.update(0.05, true)) shots++;
    expect(shots).toBe(Math.floor(3 / ENEMY_FLASH_FIRE_INTERVAL));

    const noTarget = new FlashBlindState();
    noTarget.blind(4, false);
    for (let t = 0; t < 3; t += 0.05) expect(noTarget.update(0.05, true)).toBe(false);

    const staggered = new FlashBlindState();
    staggered.blind(4, true);
    for (let t = 0; t < 2; t += 0.05) expect(staggered.update(0.05, false)).toBe(false);
  });

  it('ignores a zero or invalid flash', () => {
    const blind = new FlashBlindState();
    blind.blind(0, true);
    blind.blind(Number.NaN, true);
    expect(blind.active).toBe(false);
  });
});

class FakeBody implements EnemyBody {
  readonly id = 1;
  readonly archetype = ENEMY_ARCHETYPES[0]!;
  readonly excludeRigidBody: RAPIER.RigidBody;
  position: EnemyPosition = { x: 0, y: 0.85, z: 10 };
  isMoving = false;
  facingYaw = Math.PI;
  faced: { x: number; z: number } | null = null;
  moves = 0;
  constructor(physics: PhysicsWorld) {
    this.excludeRigidBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(50, 50, 50));
  }
  moveToward(): void {
    this.moves++;
  }
  retreatFrom(): EnemyPosition | null {
    return null;
  }
  faceToward(x: number, z: number): void {
    this.faced = { x, z };
  }
}

describe('EnemyBrain flash blindness', () => {
  it('drops its target and awareness, staggers, then fires wide at the last-seen spot', async () => {
    const physics = await PhysicsWorld.create();
    const body = new FakeBody(physics);
    const knowledge = new SquadKnowledge();
    const shots: THREE.Vector3[] = [];
    const brain = new EnemyBrain(
      body,
      physics,
      new CombatCoordinator({ shooter: 2 }, mulberry32(1)),
      knowledge,
      { emit: () => {} },
      { onRangedShotFired: (_origin, end) => shots.push(end.clone()) },
      mulberry32(2),
      mulberry32(3),
      new THREE.Vector3(0, 0.85, 10),
    );
    // Make it suspicious first (a heard shot), so it had a target when the flash went off.
    brain.onHeardGunshot(new THREE.Vector3(0, 1, 0));
    const player = {
      position: new THREE.Vector3(0, 0.85, 0),
      movementBobStrength: 0,
      isDead: false,
      ownCollider: { handle: -5 },
      takeDamage: () => {},
    } as unknown as Player;

    brain.onFlashed(2);
    expect(brain.debug.awareness).toBe(0);
    expect(brain.debug.staggered).toBe(true);
    expect(brain.debug.blindSeconds).toBeCloseTo(2);
    expect(brain.debug.state).toBe('search');

    for (let t = 0; t < 1.9; t += 0.05) brain.update(0.05, player);
    // Blind the whole time: never looked, never moved, fired only after the stagger.
    expect(brain.debug.awareness).toBe(0);
    expect(brain.debug.hasLineOfSight).toBe(false);
    expect(body.moves).toBe(0);
    expect(shots.length).toBe(Math.floor((1.9 - ENEMY_STAGGER_DURATION) / ENEMY_FLASH_FIRE_INTERVAL));
    expect(body.faced).not.toBeNull();

    for (let t = 0; t < 0.3; t += 0.05) brain.update(0.05, player);
    expect(brain.debug.blindSeconds).toBe(0);
  });
});
