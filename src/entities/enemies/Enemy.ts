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
import { pickPatrolDestination, steerWithAvoidance } from './enemySteering.ts';
import {
  ENEMY_ATTACK_DAMAGE,
  ENEMY_ATTACK_INTERVAL,
  ENEMY_ATTACK_RANGE,
  ENEMY_DETECTION_RANGE,
  ENEMY_HEALTH,
  ENEMY_HEIGHT,
  ENEMY_LEASH_RANGE,
  ENEMY_PATROL_REPATH_MAX,
  ENEMY_PATROL_REPATH_MIN,
  ENEMY_PATROL_SPEED,
  ENEMY_PATROL_STOP_DISTANCE,
  ENEMY_RADIUS,
  ENEMY_SPEED,
  ENEMY_STOP_DISTANCE,
  ENEMY_STUCK_EPSILON,
  ENEMY_STUCK_WINDOW,
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
 * Idle: patrols real destinations across ENEMY_ROAM_RADIUS of its spawn point (biased toward
 * town/forest content, not a uniformly random shuffle - see enemySteering.ts), with whisker
 * obstacle avoidance and stuck-detection reroute standing in for real pathfinding. Chase: once the
 * player comes within ENEMY_DETECTION_RANGE, beelines for them and attacks in range, until they get
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
  private patrolDestination: THREE.Vector3;
  private patrolRepathTimer = 0;
  private stuckCheckTimer = 0;
  private stuckCheckPos: THREE.Vector3;
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
    this.patrolDestination = position.clone();
    this.stuckCheckPos = position.clone();

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

  /** Debug-only introspection for the e2e suite. */
  get debugState(): EnemyState {
    return this.state;
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
      this.updatePatrol(dt, current);
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

  /** Picks a fresh destination, moves toward it with whisker obstacle avoidance, and reroutes if
   * either the repath timer expires (destination unreached for too long), the destination is
   * reached, or the enemy is stuck (wedged against something avoidance couldn't solve). */
  private updatePatrol(dt: number, current: { x: number; y: number; z: number }): void {
    this.patrolRepathTimer -= dt;
    const distanceToDestination = horizontalDistance(current, this.patrolDestination);

    if (this.patrolRepathTimer <= 0 || distanceToDestination <= ENEMY_PATROL_STOP_DISTANCE) {
      this.repath();
    }

    if (horizontalDistance(current, this.patrolDestination) > ENEMY_PATROL_STOP_DISTANCE) {
      this.moveTowardWithAvoidance(this.patrolDestination.x, this.patrolDestination.z, ENEMY_PATROL_SPEED, dt, current);
    }

    this.updateStuckDetection(dt, current);
  }

  private repath(): void {
    this.patrolDestination = pickPatrolDestination(this.spawnPosition, Math.random);
    this.patrolRepathTimer = ENEMY_PATROL_REPATH_MIN + Math.random() * (ENEMY_PATROL_REPATH_MAX - ENEMY_PATROL_REPATH_MIN);
  }

  /** No navmesh in this codebase - whisker avoidance (see enemySteering.ts) handles convex
   * obstacles, but a concave trap (e.g. a tight gap between buildings) can still wedge an enemy.
   * Rather than freezing indefinitely, an enemy that's tried to move but barely progressed over
   * ENEMY_STUCK_WINDOW gives up on its current destination and picks a new one. */
  private updateStuckDetection(dt: number, current: { x: number; y: number; z: number }): void {
    this.stuckCheckTimer += dt;
    if (this.stuckCheckTimer < ENEMY_STUCK_WINDOW) return;

    const moved = horizontalDistance(current, this.stuckCheckPos);
    if (this.isMoving && moved < ENEMY_STUCK_EPSILON) {
      this.repath();
    }
    this.stuckCheckTimer = 0;
    this.stuckCheckPos.set(current.x, current.y, current.z);
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

  /** Same as moveToward, but steers around nearby obstacles first (see enemySteering.ts) - used
   * for patrol, where destinations are far enough that running straight into a building/rock/tree
   * along the way is common; chase deliberately keeps beelining straight at the player for now. */
  private moveTowardWithAvoidance(
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

    const desiredDir = new THREE.Vector3(dx / distance, 0, dz / distance);
    const chestPos = new THREE.Vector3(current.x, current.y, current.z);
    const steeredDir = steerWithAvoidance(this.physics, chestPos, desiredDir, this.bodyCollider);

    const step = Math.min(distance, speed * dt);
    const nextX = current.x + steeredDir.x * step;
    const nextZ = current.z + steeredDir.z * step;
    this.applyPosition(nextX, nextZ);
    this.mesh.rotation.y = Math.atan2(steeredDir.x, steeredDir.z);
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
