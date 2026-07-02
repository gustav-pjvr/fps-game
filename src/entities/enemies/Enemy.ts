import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { allocateEntityId, type Entity } from '../Entity.ts';
import type { Player } from '../Player.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import type { Damageable } from '../../combat/damage.ts';
import { sampleHeight } from '../../world/TerrainGenerator.ts';
import {
  ENEMY_ATTACK_DAMAGE,
  ENEMY_ATTACK_INTERVAL,
  ENEMY_ATTACK_RANGE,
  ENEMY_HEALTH,
  ENEMY_HEIGHT,
  ENEMY_RADIUS,
  ENEMY_SPEED,
  ENEMY_STOP_DISTANCE,
  HEADSHOT_MULTIPLIER,
} from '../../core/config.ts';

const HEAD_RADIUS = ENEMY_RADIUS * 0.55;
const HEAD_OFFSET_Y = ENEMY_HEIGHT / 2 - HEAD_RADIUS;

/** Minimal moving enemy: walks toward the player, grounded to terrain height each step. */
export class Enemy implements Entity, Damageable {
  readonly id = allocateEntityId();
  readonly mesh: THREE.Group;

  private health = ENEMY_HEALTH;
  private dead = false;
  private attackCooldown = 0;
  private readonly rigidBody: RAPIER.RigidBody;
  private readonly bodyCollider: RAPIER.Collider;
  private readonly headCollider: RAPIER.Collider;

  constructor(
    private readonly physics: PhysicsWorld,
    position: THREE.Vector3,
  ) {
    const bodyMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(ENEMY_RADIUS, ENEMY_HEIGHT - ENEMY_RADIUS * 2, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x8833cc }),
    );
    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(HEAD_RADIUS, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xffcc88 }),
    );
    headMesh.position.y = HEAD_OFFSET_Y;

    this.mesh = new THREE.Group();
    this.mesh.add(bodyMesh, headMesh);
    this.mesh.position.copy(position);
    this.mesh.castShadow = true;

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      position.x,
      position.y,
      position.z,
    );
    this.rigidBody = physics.world.createRigidBody(bodyDesc);

    const cylinderHalfHeight = ENEMY_HEIGHT / 2 - ENEMY_RADIUS;
    this.bodyCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(cylinderHalfHeight, ENEMY_RADIUS),
      this.rigidBody,
    );
    physics.registerCollider(this.bodyCollider, this);

    this.headCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(HEAD_RADIUS).setTranslation(0, HEAD_OFFSET_Y, 0),
      this.rigidBody,
    );
    physics.registerCollider(this.headCollider, this);
  }

  get isDead(): boolean {
    return this.dead;
  }

  takeDamage(amount: number, hitColliderHandle: number): void {
    if (this.dead) return;
    const isHeadshot = hitColliderHandle === this.headCollider.handle;
    this.health -= isHeadshot ? amount * HEADSHOT_MULTIPLIER : amount;
    if (this.health <= 0) this.dead = true;
  }

  update(dt: number, player: Player): void {
    if (this.dead) return;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const targetPosition = player.position;
    const current = this.rigidBody.translation();
    const toTarget = new THREE.Vector3(targetPosition.x - current.x, 0, targetPosition.z - current.z);
    const distance = toTarget.length();

    let nextX = current.x;
    let nextZ = current.z;
    if (distance > ENEMY_STOP_DISTANCE) {
      toTarget.normalize().multiplyScalar(ENEMY_SPEED * dt);
      nextX += toTarget.x;
      nextZ += toTarget.z;
    } else if (distance <= ENEMY_ATTACK_RANGE && this.attackCooldown <= 0 && !player.isDead) {
      player.takeDamage(ENEMY_ATTACK_DAMAGE);
      this.attackCooldown = ENEMY_ATTACK_INTERVAL;
    }

    const nextY = sampleHeight(nextX, nextZ) + ENEMY_HEIGHT / 2;
    this.rigidBody.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ });
    this.mesh.position.set(nextX, nextY, nextZ);

    if (distance > 0.01) {
      this.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);
    }
  }

  dispose(): void {
    this.physics.unregisterCollider(this.bodyCollider);
    this.physics.unregisterCollider(this.headCollider);
    this.physics.world.removeCollider(this.bodyCollider, true);
    this.physics.world.removeCollider(this.headCollider, true);
    this.physics.world.removeRigidBody(this.rigidBody);
  }
}
