import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { allocateEntityId, type Entity } from '../Entity.ts';
import type { Player } from '../Player.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import type { Damageable } from '../../combat/damage.ts';
import { sampleHeight } from '../../world/TerrainGenerator.ts';
import type { EnemyArchetype } from './archetypes.ts';
import { steerWithAvoidance } from './enemySteering.ts';
import type { CombatCoordinator, CombatRole, RoleCandidate } from './combatCoordinator.ts';
import { EnemyBrain, type EnemyState } from './EnemyBrain.ts';
import { ENEMY_HEAD_OFFSET_Y, ENEMY_HEAD_RADIUS, type EnemyBody, type EnemyPosition } from './EnemyBody.ts';
import type { EnemyCombatHooks } from './enemyCombat.ts';
import type { SquadKnowledge } from './squadKnowledge.ts';
import { ENEMY_HEIGHT, ENEMY_RADIUS, HEADSHOT_MULTIPLIER } from '../../core/config.ts';

export type { EnemyCombatHooks } from './enemyCombat.ts';

export const ENEMY_MODEL_PATH = '/assets/models/enemies/character-male-a.glb';

/** Debug-only view of one enemy for the e2e suite and the perf work (window.__gameDebug). */
export interface EnemyDebugRecord {
  readonly archetype: string;
  readonly state: EnemyState;
  readonly awareness: number;
  readonly hasLineOfSight: boolean;
  readonly yaw: number;
  /** The combat coordinator's role while in combat, else null. */
  readonly role: CombatRole | null;
}

/** How far an enemy must move horizontally before its ground height is resampled. sampleHeight is
 * the enemy hot path's dominant cost (4-octave fBm + a 9-cell Worley scan per call, per enemy, per
 * frame - thousands of noise evaluations/sec at a 50-enemy match size) for what is nearly static
 * data: at chase speed 3.4 an enemy covers ~0.057 units/tick, so this caches ~4 frames' worth of
 * samples. 0.25 units of horizontal drift changes terrain height imperceptibly (terrain base
 * frequency 0.015 means a full noise period spans ~67 units) and the physics body glues back to
 * the exact surface on the next resample. */
const HEIGHT_RESAMPLE_DISTANCE_SQ = 0.25 * 0.25;

/** Kenney's "Mini Characters" bind pose measures ~0.671 units tall, feet at local Y=0. */
const MODEL_BIND_HEIGHT = 0.671;
const MODEL_SCALE = ENEMY_HEIGHT / MODEL_BIND_HEIGHT;

/**
 * The enemy's body: Rapier kinematic body with capsule + head colliders, the animated model,
 * health, and the movement primitives its brain drives through the EnemyBody interface. All
 * decision logic (patrol, aggro/LOS, chase, kiting, search, firing cadence) lives in
 * EnemyBrain.ts since the enemy AI v2 split (docs/enemy-ai-v2-design.md, commit 0); the history of
 * how that logic was built is in docs/enemy-ai.md.
 *
 * Per-archetype loadouts: every enemy is constructed with a real `EnemyArchetype` (see
 * archetypes.ts) carrying its own health/speed/range/damage/aim-error numbers and a movementStyle
 * ('direct' or 'kite').
 *
 * Visuals are the real character-male-a.glb (Kenney "Mini Characters", CC0), animated with its
 * bundled "idle"/"walk" clips. Hit detection still uses the same invisible capsule+ball
 * colliders as before - the model is cosmetic only.
 */
export class Enemy implements Entity, Damageable, EnemyBody {
  readonly id = allocateEntityId();
  readonly isDamageableTarget = true;
  readonly killFeedLabel: string;
  readonly mesh: THREE.Group;

  private health: number;
  private dead = false;
  private disposed = false;
  private moving = false;
  private readonly brain: EnemyBrain;
  private readonly rigidBody: RAPIER.RigidBody;
  private readonly bodyCollider: RAPIER.Collider;
  private readonly headCollider: RAPIER.Collider;

  private readonly mixer: THREE.AnimationMixer;
  private readonly idleAction: THREE.AnimationAction | undefined;
  private readonly walkAction: THREE.AnimationAction | undefined;

  constructor(
    private readonly physics: PhysicsWorld,
    position: THREE.Vector3,
    gltf: GLTF,
    readonly archetype: EnemyArchetype,
    coordinator: CombatCoordinator,
    knowledge: SquadKnowledge,
    combatHooks: EnemyCombatHooks,
    patrolRng: () => number,
  ) {
    this.health = archetype.health;
    this.killFeedLabel = `${archetype.name} eliminated`;

    // SkeletonUtils.clone (not Object3D.clone) is required for skinned meshes - a plain clone
    // duplicates the mesh but not the skeleton bindings, leaving bones pointing at the shared
    // original skeleton and breaking every clone but the first.
    const model = cloneSkeleton(gltf.scene) as THREE.Group;
    model.scale.setScalar(MODEL_SCALE);
    model.position.y = -ENEMY_HEIGHT / 2; // model origin is at its feet; group origin is capsule-center

    this.mesh = new THREE.Group();
    this.mesh.add(model);
    this.mesh.position.copy(position);
    // castShadow on a Group doesn't propagate to its children (three.js only reads it on Mesh
    // instances during the shadow pass), so it has to be set per-mesh via traverse.
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

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
      RAPIER.ColliderDesc.ball(ENEMY_HEAD_RADIUS).setTranslation(0, ENEMY_HEAD_OFFSET_Y, 0),
      this.rigidBody,
    );
    physics.registerCollider(this.headCollider, this);

    this.brain = new EnemyBrain(this, physics, coordinator, knowledge, combatHooks, patrolRng, position);
  }

  get isDead(): boolean {
    return this.dead;
  }

  /** Debug-only introspection for the e2e suite. */
  get debugState(): EnemyState {
    return this.brain.currentState;
  }

  /** Debug-only introspection for the e2e suite - which archetype this instance actually got
   * assigned (per-archetype loadouts follow-up). */
  get debugArchetype(): string {
    return this.archetype.name;
  }

  get position(): EnemyPosition {
    return this.rigidBody.translation();
  }

  get excludeRigidBody(): RAPIER.RigidBody {
    return this.rigidBody;
  }

  get isMoving(): boolean {
    return this.moving;
  }

  get facingYaw(): number {
    return this.mesh.rotation.y;
  }

  /** Debug-only (enemy AI v2 e2e checks): state, awareness, sightline and facing. */
  debugRecord(): EnemyDebugRecord {
    const brain = this.brain.debug;
    return {
      archetype: this.archetype.name,
      state: brain.state,
      awareness: brain.awareness,
      hasLineOfSight: brain.hasLineOfSight,
      yaw: this.mesh.rotation.y,
      role: brain.role,
    };
  }

  /** This enemy's entry on the combat coordinator's roster, or null when it is not fighting. */
  combatCandidate(): RoleCandidate | null {
    return this.dead ? null : this.brain.combatCandidate();
  }

  /** Test-only (window.__gameDebug.placeEnemy): moves the enemy instantly, like the player's own
   * debugTeleport, so a behaviour test can stage a known layout. Never called by gameplay code. */
  debugPlace(x: number, z: number): void {
    this.heightSampleX = Number.NaN;
    this.heightSampleZ = Number.NaN;
    const y = this.groundHeightAt(x, z) + ENEMY_HEIGHT / 2;
    this.rigidBody.setTranslation({ x, y, z }, true);
    this.rigidBody.setNextKinematicTranslation({ x, y, z });
    this.mesh.position.set(x, y, z);
  }

  takeDamage(amount: number, hitColliderHandle: number, sourcePosition?: THREE.Vector3): void {
    if (this.dead) return;
    const isHeadshot = hitColliderHandle === this.headCollider.handle;
    this.health -= isHeadshot ? amount * HEADSHOT_MULTIPLIER : amount;
    if (this.health <= 0) {
      this.dead = true;
      return;
    }
    this.brain.onDamaged(sourcePosition);
  }

  /** A player gunshot - heard only within that weapon's range (see EnemyBrain.onHeardGunshot). */
  onHeardGunshot(origin: THREE.Vector3, weaponId?: string): void {
    if (this.dead) return;
    this.brain.onHeardGunshot(origin, weaponId);
  }

  /** A comrade died nearby (see EnemyBrain.onNearbyDeath). */
  onNearbyDeath(deathPosition: THREE.Vector3, killerPosition: THREE.Vector3): void {
    if (this.dead) return;
    this.brain.onNearbyDeath(deathPosition, killerPosition);
  }

  update(dt: number, player: Player): void {
    if (this.dead) return;
    const wasMoving = this.moving;
    this.moving = false;
    this.brain.update(dt, player);
    if (this.moving !== wasMoving) this.setMovingAnimation(this.moving);
    this.mixer.update(dt);
  }

  /** Straight-line movement with whisker obstacle steering (see enemySteering.ts) - used by every
   * moving state (patrol, search, and chase - chase used to beeline without avoidance, which let
   * chasers clip through tree trunks/rocks whose colliders block the ground path even when the
   * head-height LOS ray clears past them). */
  moveToward(targetX: number, targetZ: number, speed: number, dt: number): void {
    const current = this.rigidBody.translation();
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
    this.moving = true;
  }

  /** The kiting retreat: the same whisker avoidance as every other move, so retreating doesn't
   * walk straight into a wall, but facing the threat it's backing away from instead of the
   * retreat direction. */
  retreatFrom(threatX: number, threatZ: number, speed: number, dt: number): EnemyPosition | null {
    const current = this.rigidBody.translation();
    const dx = current.x - threatX;
    const dz = current.z - threatZ;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance <= 1e-4) return null;

    const desiredDir = new THREE.Vector3(dx / distance, 0, dz / distance);
    const chestPos = new THREE.Vector3(current.x, current.y, current.z);
    const steeredDir = steerWithAvoidance(this.physics, chestPos, desiredDir, this.bodyCollider);

    const step = speed * dt;
    const nextX = current.x + steeredDir.x * step;
    const nextZ = current.z + steeredDir.z * step;
    this.applyPosition(nextX, nextZ);

    // Faces the threat from the *new* position, not the stale current one - faceToward's own
    // applyPosition call would otherwise snap the enemy right back to where it started.
    const faceDx = threatX - nextX;
    const faceDz = threatZ - nextZ;
    if (faceDx * faceDx + faceDz * faceDz > 1e-4) {
      this.mesh.rotation.y = Math.atan2(faceDx, faceDz);
    }
    this.moving = true;
    return { x: nextX, y: current.y, z: nextZ };
  }

  faceToward(x: number, z: number): void {
    const current = this.rigidBody.translation();
    const dx = x - current.x;
    const dz = z - current.z;
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

  /** Initialized to NaN so the first groundHeightAt call always resamples (NaN distance compares
   * false against the threshold). */
  private heightSampleX = Number.NaN;
  private heightSampleZ = Number.NaN;
  private cachedGroundHeight = 0;

  /** Cached terrain height - resampled only after HEIGHT_RESAMPLE_DISTANCE of horizontal movement,
   * not every frame (see the constant's comment for the cost/accuracy reasoning). */
  private groundHeightAt(x: number, z: number): number {
    const dx = x - this.heightSampleX;
    const dz = z - this.heightSampleZ;
    if (!(dx * dx + dz * dz < HEIGHT_RESAMPLE_DISTANCE_SQ)) {
      this.cachedGroundHeight = sampleHeight(x, z);
      this.heightSampleX = x;
      this.heightSampleZ = z;
    }
    return this.cachedGroundHeight;
  }

  private applyPosition(x: number, z: number): void {
    const y = this.groundHeightAt(x, z) + ENEMY_HEIGHT / 2;
    this.rigidBody.setNextKinematicTranslation({ x, y, z });
    this.mesh.position.set(x, y, z);
  }

  /** Guarded against a second call - see RemotePlayer.ts's identical guard for why: re-entering
   * Rapier's removal path for an already-removed collider/rigid body isn't guaranteed safe (a
   * live 2-browser repro caught this exact class of bug producing a WASM-level crash). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.brain.dispose();
    this.physics.unregisterCollider(this.bodyCollider);
    this.physics.unregisterCollider(this.headCollider);
    this.physics.world.removeCollider(this.bodyCollider, true);
    this.physics.world.removeCollider(this.headCollider, true);
    this.physics.world.removeRigidBody(this.rigidBody);
  }
}
