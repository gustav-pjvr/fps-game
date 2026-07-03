import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { allocateEntityId, type Entity } from '../Entity.ts';
import type { Player } from '../Player.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import type { Damageable } from '../../combat/damage.ts';
import { sampleHeight } from '../../world/TerrainGenerator.ts';
import { ACTIVE_ENEMY_ARCHETYPE } from './archetypes.ts';
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

export const ENEMY_MODEL_PATH = '/assets/models/enemies/character-male-a.glb';

const HEAD_RADIUS = ENEMY_RADIUS * 0.55;
const HEAD_OFFSET_Y = ENEMY_HEIGHT / 2 - HEAD_RADIUS;

/** Kenney's "Mini Characters" bind pose measures ~0.671 units tall, feet at local Y=0. */
const MODEL_BIND_HEIGHT = 0.671;
const MODEL_SCALE = ENEMY_HEIGHT / MODEL_BIND_HEIGHT;

type EnemyState = 'idle' | 'chase';

/**
 * Idle: wanders slowly within ENEMY_WANDER_RADIUS of its spawn point. Chase: once the player
 * comes within ENEMY_DETECTION_RANGE, beelines for them and attacks in range, until they get
 * further than ENEMY_LEASH_RANGE away (a wider radius than detection, so it doesn't flicker
 * between states right at the detection boundary).
 *
 * Visuals are the real character-male-a.glb (Kenney "Mini Characters", CC0), animated with its
 * bundled "idle"/"walk" clips. Hit detection still uses the same invisible capsule+ball
 * colliders as before - the model is cosmetic only.
 */
export class Enemy implements Entity, Damageable {
  readonly id = allocateEntityId();
  readonly isDamageableTarget = true;
  readonly killFeedLabel = `${ACTIVE_ENEMY_ARCHETYPE.name} eliminated`;
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

  private readonly mixer: THREE.AnimationMixer;
  private readonly idleAction: THREE.AnimationAction | undefined;
  private readonly walkAction: THREE.AnimationAction | undefined;
  private isMoving = false;

  constructor(
    private readonly physics: PhysicsWorld,
    position: THREE.Vector3,
    gltf: GLTF,
  ) {
    this.spawnPosition = position.clone();
    this.wanderTarget = position.clone();

    // SkeletonUtils.clone (not Object3D.clone) is required for skinned meshes - a plain clone
    // duplicates the mesh but not the skeleton bindings, leaving bones pointing at the shared
    // original skeleton and breaking every clone but the first.
    const model = cloneSkeleton(gltf.scene) as THREE.Group;
    model.scale.setScalar(MODEL_SCALE);
    model.position.y = -ENEMY_HEIGHT / 2; // model origin is at its feet; group origin is capsule-center

    this.mesh = new THREE.Group();
    this.mesh.add(model);
    this.mesh.position.copy(position);
    this.mesh.castShadow = true;

    this.mixer = new THREE.AnimationMixer(model);
    const idleClip = gltf.animations.find((clip) => clip.name === 'idle');
    const walkClip = gltf.animations.find((clip) => clip.name === 'walk');
    this.idleAction = idleClip ? this.mixer.clipAction(idleClip) : undefined;
    this.walkAction = walkClip ? this.mixer.clipAction(walkClip) : undefined;
    this.idleAction?.play();

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

    const wasMoving = this.isMoving;
    this.isMoving = false;

    if (this.state === 'chase') {
      this.updateChase(dt, player, current, distanceToPlayer);
    } else {
      this.updateWander(dt, current);
    }

    if (this.isMoving !== wasMoving) this.setMovingAnimation(this.isMoving);
    this.mixer.update(dt);
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
    this.isMoving = true;
  }

  private faceToward(targetX: number, targetZ: number, current: { x: number; y: number; z: number }): void {
    const dx = targetX - current.x;
    const dz = targetZ - current.z;
    if (dx * dx + dz * dz > 1e-4) {
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }
    this.applyPosition(current.x, current.z);
  }

  private setMovingAnimation(moving: boolean): void {
    const next = moving ? this.walkAction : this.idleAction;
    const previous = moving ? this.idleAction : this.walkAction;
    previous?.fadeOut(0.2);
    next?.reset().fadeIn(0.2).play();
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
