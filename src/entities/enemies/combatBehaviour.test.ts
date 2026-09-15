import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CombatBehaviour, type CoverPhase } from './combatBehaviour.ts';
import { CombatCoordinator } from './combatCoordinator.ts';
import { SquadKnowledge } from './squadKnowledge.ts';
import { ENEMY_ARCHETYPES } from './archetypes.ts';
import { ObstacleRegistry } from './tactics/obstacleRegistry.ts';
import { pointSegmentDistance, type LosProbe } from './tactics/tacticalQuery.ts';
import type { TacticalContext } from './tactics/planner.ts';
import type { EnemyBody, EnemyPosition } from './EnemyBody.ts';
import type { Player } from '../Player.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { perfCounters } from '../../core/perfStats.ts';
import { mulberry32 } from '../../utils/rng.ts';

// The fight-from-a-spot cycle (enemy AI v2 step 3), driven without Rapier: a fake body that walks
// in straight lines, a probe that knows about one trunk, and no sightline to the player so nothing
// ever fires (firing is enemyCombat.ts's job and tested there).

const TRUNK = { x: 2, z: 8, radius: 0.35 };
const trunkProbe: LosProbe = (from, to) => pointSegmentDistance(TRUNK, from, to) > TRUNK.radius;
const DT = 0.1;

class FakeBody implements EnemyBody {
  readonly id = 1;
  readonly archetype = ENEMY_ARCHETYPES[0]!;
  readonly excludeRigidBody = {} as unknown as RAPIER.RigidBody;
  position: EnemyPosition;
  isMoving = false;
  facingYaw = 0;

  constructor(
    x: number,
    z: number,
    private readonly canMove = true,
  ) {
    this.position = { x, y: 0.85, z };
  }

  moveToward(targetX: number, targetZ: number, speed: number, dt: number): void {
    this.isMoving = true;
    if (!this.canMove) return;
    const dx = targetX - this.position.x;
    const dz = targetZ - this.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-6) return;
    const step = Math.min(distance, speed * dt);
    this.position = { x: this.position.x + (dx / distance) * step, y: this.position.y, z: this.position.z + (dz / distance) * step };
  }

  retreatFrom(): EnemyPosition | null {
    return null;
  }

  faceToward(): void {}
}

const player = {
  position: new THREE.Vector3(0, 0.85, 0),
  movementBobStrength: 0,
  isDead: false,
  ownCollider: { handle: 99 },
} as unknown as Player;

function setup(role: 'shooter' | 'reserve', canMove = true) {
  const body = new FakeBody(0, 10, canMove);
  const knowledge = new SquadKnowledge();
  knowledge.reportSeen(2, player.position);
  const coordinator = new CombatCoordinator({ shooter: 2 }, mulberry32(1));
  coordinator.update(
    [{ id: 1, x: 0, z: 10, canShoot: true, rangedRange: 16, hasLineOfSight: role === 'shooter' }],
    { now: 0, threat: { x: 0, z: 0 }, isThreatVisible: true },
  );
  const obstacles = new ObstacleRegistry();
  obstacles.add('c', { kind: 'trunk', ...TRUNK });
  const context = (now: number): TacticalContext => ({
    now,
    threat: { x: 0, z: 0 },
    threatEyeY: 1.6,
    world: { obstacles, towers: [], isBlocked: () => false, heightAt: () => 0 },
    probeFor: () => trunkProbe,
    claimsFor: () => [],
    fireLinesFor: () => [],
  });
  const behaviour = new CombatBehaviour(body, {} as PhysicsWorld, coordinator, knowledge, { onRangedShotFired: () => {} }, mulberry32(2), body.position);
  return { body, behaviour, context };
}

/** Runs `ticks` ticks with no sightline and returns the distinct phases seen, in order. */
function run(setupResult: ReturnType<typeof setup>, ticks: number): (CoverPhase | null)[] {
  const { body, behaviour } = setupResult;
  const phases: (CoverPhase | null)[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    body.isMoving = false;
    const distance = Math.hypot(body.position.x, body.position.z);
    behaviour.update(DT, player, body.position, distance, false, tick * DT);
    const phase = behaviour.pickDebug?.phase ?? null;
    if (phases[phases.length - 1] !== phase) phases.push(phase);
  }
  return phases;
}

describe('CombatBehaviour fighting from a spot', () => {
  it('a shooter walks to the trunk, then alternates hiding behind it and peeking out', () => {
    const s = setup('shooter');
    s.behaviour.refreshPick(s.context(0), 8);
    expect(s.behaviour.pickDebug).toMatchObject({ source: 'trunk', phase: 'moving', covered: true });
    const phases = run(s, 60);
    expect(phases.slice(0, 4)).toEqual(['moving', 'hiding', 'peeking', 'hiding']);
    // After arriving it never walks off again: it only alternates between hiding and peeking.
    for (let i = 2; i < phases.length; i++) {
      expect(phases[i]).toBe(phases[i - 1] === 'hiding' ? 'peeking' : 'hiding');
    }
  });

  it('a reserve walks to cover and stays hidden', () => {
    const s = setup('reserve');
    s.behaviour.refreshPick(s.context(0), 8);
    expect(s.behaviour.pickDebug?.covered).toBe(true);
    expect(run(s, 60)).toEqual(['moving', 'hiding']);
  });

  it('logs a spot it cannot reach as unreachable, drops it, and avoids it next time', () => {
    const s = setup('shooter', false);
    s.behaviour.refreshPick(s.context(0), 8);
    const before = perfCounters.tacticalPicksUnreachable;
    const phases = run(s, 30);
    expect(phases).toEqual(['moving', null]);
    expect(perfCounters.tacticalPicksUnreachable).toBe(before + 1);

    s.behaviour.refreshPick(s.context(3), 8);
    expect(s.behaviour.pickDebug?.source).not.toBe('trunk');
  });

  it('lets a holder fight on without its own sightline only while the squad saw the player recently', () => {
    const s = setup('shooter');
    expect(s.behaviour.canFightBlind()).toBe(false);
    s.behaviour.refreshPick(s.context(0), 8);
    expect(s.behaviour.canFightBlind()).toBe(true);
    s.behaviour.standDown();
    expect(s.behaviour.pickDebug).toBeNull();
  });
});
