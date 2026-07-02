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
  ENEMY_DETECTION_RANGE,
  ENEMY_HEALTH,
  ENEMY_HEIGHT,
  ENEMY_LEASH_RANGE,
  ENEMY_RADIUS,
  ENEMY_SPEED,
  ENEMY_STOP_DISTANCE,
  ENEMY_WANDER_INTERVAL,
  ENEMY_WANDER_RADIUS,
  ENEMY_WANDER_SPEED,
  ENEMY_WANDER_STOP_DISTANCE,
  HEADSHOT_MULTIPLIER,
} from '../../core/config.ts';

const HEAD_RADIUS = ENEMY_RADIUS * 0.55;
const HEAD_OFFSET_Y = ENEMY_HEIGHT / 2 - HEAD_RADIUS;

type EnemyState = 'idle' | 'chase';

/**
 * Idle: wanders slowly within ENEMY_WANDER_RADIUS of its spawn point. Chase: once the player
 * comes within ENEMY_DETECTION_RANGE, beelines for them and attacks in range, until they get
 * further than ENEMY_LEASH_RANGE away (a wider radius than detection, so it doesn't flicker
 * between states right at the detection boundary).
 */
export class Enemy implements Entity, Damageable {
  readonly id = allocateEntityId();
  readonly isDamageableTarget = true;
  readonly mesh: THREE.Group;

  private health = ENEMY_HEALTH;
  private dead = false;
  private attackCooldown = 0;
  private state: EnemyState = 'idle';
  private readonly spawnPosition: THREE.Vector3;
  private wanderTarget: THREE.Vector3;
  private wanderTimer = 0;
  private readonly rigidBody: RAPIER.RigidBody;
  private readonly bodyCollider: RAPIER.Collider;
  private readonly headCollider: RAPIER.Collider;

  constructor(
    private readonly physics: PhysicsWorld,
    position: THREE.Vector3,
  ) {
    this.spawnPosition = position.clone();
    this.wanderTarget = position.clone();

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

    const current = this.rigidBody.translation();
    const distanceToPlayer = horizontalDistance(current, player.position);

    if (this.state === 'idle' && distanceToPlayer <= ENEMY_DETECTION_RANGE) {
      this.state = 'chase';
    } else if (this.state === 'chase' && distanceToPlayer > ENEMY_LEASH_RANGE) {
      this.state = 'idle';
    }

    if (this.state === 'chase') {
      this.updateChase(dt, player, current, distanceToPlayer);
    } else {
      this.updateWander(dt, current);
    }
  }

  private updateChase(
    dt: number,
    player: Player,
    current: { x: number; y: number; z: number },
    distanceToPlayer: number,
  ): void {
    if (distanceToPlayer > ENEMY_STOP_DISTANCE) {
      this.moveToward(player.position.x, player.position.z, ENEMY_SPEED, dt, current);
    } else {
      if (distanceToPlayer <= ENEMY_ATTACK_RANGE && this.attackCooldown <= 0 && !player.isDead) {
        player.takeDamage(ENEMY_ATTACK_DAMAGE);
        this.attackCooldown = ENEMY_ATTACK_INTERVAL;
      }
      this.faceToward(player.position.x, player.position.z, current);
    }
  }

  private updateWander(dt: number, current: { x: number; y: number; z: number }): void {
    this.wanderTimer -= dt;
    const distanceToWanderTarget = horizontalDistance(current, this.wanderTarget);

    if (this.wanderTimer <= 0 || distanceToWanderTarget <= ENEMY_WANDER_STOP_DISTANCE) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * ENEMY_WANDER_RADIUS;
      this.wanderTarget = new THREE.Vector3(
        this.spawnPosition.x + Math.cos(angle) * radius,
        0,
        this.spawnPosition.z + Math.sin(angle) * radius,
      );
      this.wanderTimer = ENEMY_WANDER_INTERVAL + Math.random() * ENEMY_WANDER_INTERVAL;
    }

    if (distanceToWanderTarget > ENEMY_WANDER_STOP_DISTANCE) {
      this.moveToward(this.wanderTarget.x, this.wanderTarget.z, ENEMY_WANDER_SPEED, dt, current);
    }
  }

  private moveToward(
    targetX: number,
    targetZ: number,
    speed: number,
    dt: number,
    current: { x: number; y: number; z: number },
  ): void {
    const dx = targetX - current.x;
    const dz = targetZ - current.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance < 1e-4) return;

    const step = Math.min(distance, speed * dt);
    const nextX = current.x + (dx / distance) * step;
    const nextZ = current.z + (dz / distance) * step;
    this.applyPosition(nextX, nextZ);
    this.mesh.rotation.y = Math.atan2(dx, dz);
  }

  private faceToward(targetX: number, targetZ: number, current: { x: number; y: number; z: number }): void {
    const dx = targetX - current.x;
    const dz = targetZ - current.z;
    if (dx * dx + dz * dz > 1e-4) {
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }
    this.applyPosition(current.x, current.z);
  }

  private applyPosition(x: number, z: number): void {
    const y = sampleHeight(x, z) + ENEMY_HEIGHT / 2;
    this.rigidBody.setNextKinematicTranslation({ x, y, z });
    this.mesh.position.set(x, y, z);
  }

  dispose(): void {
    this.physics.unregisterCollider(this.bodyCollider);
    this.physics.unregisterCollider(this.headCollider);
    this.physics.world.removeCollider(this.bodyCollider, true);
    this.physics.world.removeCollider(this.headCollider, true);
    this.physics.world.removeRigidBody(this.rigidBody);
  }
}

function horizontalDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}
