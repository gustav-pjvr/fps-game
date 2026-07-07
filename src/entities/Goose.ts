import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { allocateEntityId, type Entity } from './Entity.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { Damageable } from '../combat/damage.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { steerWithAvoidance } from './enemies/enemySteering.ts';
import {
  GOOSE_HEIGHT,
  GOOSE_HITS_TO_KILL,
  GOOSE_PATROL_REPATH_MAX,
  GOOSE_PATROL_REPATH_MIN,
  GOOSE_PATROL_STOP_DISTANCE,
  GOOSE_RADIUS,
  GOOSE_ROAM_RADIUS,
  GOOSE_WANDER_SPEED,
} from '../core/config.ts';

/** Amplitude/speed of the code-driven waddle (vertical bob + side-to-side rock) that stands in for
 * a walk-cycle animation - there's no rig here, just THREE primitives, so movement itself has to
 * carry the "alive" read. */
const WADDLE_BOB_HEIGHT = 0.05;
const WADDLE_BOB_SPEED = 9;
const WADDLE_ROCK_ANGLE = 0.18;

/** How far a goose must move horizontally before its ground height is resampled - same value and
 * reasoning as Enemy.ts's identical constant (a goose is even slower than an enemy, so this caches
 * more frames' worth of samples per resample, not fewer). */
const HEIGHT_RESAMPLE_DISTANCE_SQ = 0.25 * 0.25;

/**
 * Wandering NPC built entirely from THREE primitives (no asset - see GOOSE_* config comment).
 * Takes exactly GOOSE_HITS_TO_KILL hits regardless of weapon damage (deliberately ignores the
 * `amount` argument `Damageable.takeDamage` normally uses - see below), then the owning
 * GooseManager triggers an explosion at its position. Physics/teardown mirror Enemy.ts/Target.ts
 * exactly (kinematic body since it moves itself every tick, one capsule collider, manual mesh
 * sync) - no head collider, since a goose has no headshot mechanic.
 *
 * Multiplayer: single-player and the host run every goose in "authoritative" mode (local wander
 * AI, local hit counting) - a guest instead gets a "follower" mirror of the exact same goose (real
 * collider, so its own local hitscan still registers a hit) driven externally by the host's
 * broadcasts: position comes from `snapTo` (see GooseManager's gooseSnapshot handling), and a hit
 * just reports itself via `onRemoteHitReport` instead of self-adjudicating, since only the host's
 * copy decides when a goose actually dies. Passing `onRemoteHitReport` is what selects follower
 * mode - see `update`/`takeDamage` below.
 */
export class Goose implements Entity, Damageable {
  readonly id = allocateEntityId();
  readonly isDamageableTarget = true;
  readonly mesh: THREE.Group;

  private hitsTaken = 0;
  private dead = false;
  private readonly rigidBody: RAPIER.RigidBody;
  private readonly bodyCollider: RAPIER.Collider;

  private readonly spawnPosition: THREE.Vector3;
  private destination: THREE.Vector3;
  private repathTimer = 0;
  private isMoving = false;
  private waddlePhase = Math.random() * Math.PI * 2;

  constructor(
    private readonly physics: PhysicsWorld,
    position: THREE.Vector3,
    /** Stable id shared across every client's copy of this same goose - assigned by whichever
     * client is authoritative for it (GooseManager), carried on every gooseSpawned/gooseSnapshot/
     * gooseExploded message so a follower copy knows which local Goose a message is about. */
    public readonly networkId: string,
    private readonly patrolRng: () => number = Math.random,
    private readonly onRemoteHitReport?: () => void,
  ) {
    this.spawnPosition = position.clone();
    this.destination = position.clone();

    this.mesh = buildGooseMesh();
    this.mesh.position.copy(position);

    // A ball, not a capsule - GOOSE_HEIGHT is too small relative to GOOSE_RADIUS for a capsule's
    // half-height to stay positive (unlike Enemy's much taller proportions), and a goose-sized
    // creature doesn't need anything more precise than a single sphere for hit detection anyway.
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z);
    this.rigidBody = physics.world.createRigidBody(bodyDesc);
    this.bodyCollider = physics.world.createCollider(RAPIER.ColliderDesc.ball(GOOSE_RADIUS), this.rigidBody);
    physics.registerCollider(this.bodyCollider, this);
  }

  get isDead(): boolean {
    return this.dead;
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  /** Ignores `amount` - a goose always dies on the GOOSE_HITS_TO_KILL'th hit regardless of which
   * weapon landed it, unlike Enemy/Target's amount-based health. Deliberate divergence from the
   * generic Damageable contract; see the class comment. Follower mode (onRemoteHitReport present)
   * never sets `dead` itself - only the host's authoritative copy decides that, via GooseManager's
   * gooseExploded broadcast. */
  takeDamage(_amount: number, _hitColliderHandle: number): void {
    if (this.dead) return;
    if (this.onRemoteHitReport) {
      this.onRemoteHitReport();
      return;
    }
    this.hitsTaken++;
    if (this.hitsTaken >= GOOSE_HITS_TO_KILL) this.dead = true;
  }

  /** Follower mode is a no-op here - its position comes from `snapTo` instead (see class comment). */
  update(dt: number): void {
    if (this.dead || this.onRemoteHitReport) return;

    const current = this.rigidBody.translation();
    this.repathTimer -= dt;
    const distanceToDestination = horizontalDistance(current, this.destination);
    if (this.repathTimer <= 0 || distanceToDestination <= GOOSE_PATROL_STOP_DISTANCE) {
      this.repath();
    }

    if (horizontalDistance(current, this.destination) > GOOSE_PATROL_STOP_DISTANCE) {
      this.moveToward(this.destination.x, this.destination.z, dt, current);
      this.isMoving = true;
    } else {
      this.applyPosition(current.x, current.z);
      this.isMoving = false;
    }

    this.waddlePhase += dt * WADDLE_BOB_SPEED * (this.isMoving ? 1 : 0.35);
  }

  private repath(): void {
    const angle = this.patrolRng() * Math.PI * 2;
    const radius = this.patrolRng() * GOOSE_ROAM_RADIUS;
    this.destination = new THREE.Vector3(this.spawnPosition.x + Math.cos(angle) * radius, 0, this.spawnPosition.z + Math.sin(angle) * radius);
    this.repathTimer = GOOSE_PATROL_REPATH_MIN + this.patrolRng() * (GOOSE_PATROL_REPATH_MAX - GOOSE_PATROL_REPATH_MIN);
  }

  private moveToward(targetX: number, targetZ: number, dt: number, current: { x: number; y: number; z: number }): void {
    const dx = targetX - current.x;
    const dz = targetZ - current.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance < 1e-4) return;

    const desiredDir = new THREE.Vector3(dx / distance, 0, dz / distance);
    const chestPos = new THREE.Vector3(current.x, current.y, current.z);
    const steeredDir = steerWithAvoidance(this.physics, chestPos, desiredDir, this.bodyCollider);

    const step = Math.min(distance, GOOSE_WANDER_SPEED * dt);
    this.applyPosition(current.x + steeredDir.x * step, current.z + steeredDir.z * step);
    this.mesh.rotation.y = Math.atan2(steeredDir.x, steeredDir.z);
  }

  /** Follower mode only: snaps directly to a host-reported position (see class comment) - the
   * waddle bob still applies locally on top of it, purely cosmetic and cheap enough not to need
   * network sync of its own. */
  snapTo(x: number, z: number): void {
    this.applyPosition(x, z);
  }

  /** Initialized to NaN so the first groundHeightAt call always resamples (NaN distance compares
   * false against the threshold) - mirrors Enemy.ts's identical caching pattern exactly. */
  private heightSampleX = Number.NaN;
  private heightSampleZ = Number.NaN;
  private cachedGroundHeight = 0;

  /** Cached terrain height, resampled only after HEIGHT_RESAMPLE_DISTANCE_SQ of horizontal
   * movement rather than every frame - `sampleHeight` is expensive (4-octave fBm + a 9-cell Worley
   * scan per call, see Enemy.ts's own comment on this exact cost) and this was called uncached on
   * every single frame for every live goose before this fix, which is the real explanation for the
   * multiplayer lag reported once several geese/players were active at once: up to
   * GOOSE_MAX_CONCURRENT geese x 60fps x that noise cost, on top of everything else already
   * competing for the same frame budget, especially on the host (also serving as the relay). */
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
    const groundY = this.groundHeightAt(x, z) + GOOSE_HEIGHT / 2;
    this.rigidBody.setNextKinematicTranslation({ x, y: groundY, z });
    this.mesh.position.set(x, groundY + Math.sin(this.waddlePhase) * WADDLE_BOB_HEIGHT, z);
    this.mesh.rotation.z = Math.sin(this.waddlePhase) * WADDLE_ROCK_ANGLE;
  }

  dispose(): void {
    this.physics.unregisterCollider(this.bodyCollider);
    this.physics.world.removeCollider(this.bodyCollider, true);
    this.physics.world.removeRigidBody(this.rigidBody);
  }
}

function horizontalDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Built from plain THREE primitives - no GLTF, per the "build it procedurally" decision (see
 * GOOSE_* config comment). White body/neck/head, orange beak/legs, grey wingtips. */
function buildGooseMesh(): THREE.Group {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.7 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe08424, roughness: 0.6 });
  const grey = new THREE.MeshStandardMaterial({ color: 0xc9c9c2, roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(GOOSE_RADIUS, 12, 10), white);
  body.scale.set(1, 0.85, 1.3);
  body.position.y = 0;
  group.add(body);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(GOOSE_RADIUS * 0.28, GOOSE_RADIUS * 0.32, GOOSE_HEIGHT * 0.55, 8), white);
  neck.position.set(0, GOOSE_HEIGHT * 0.28, GOOSE_RADIUS * 0.9);
  neck.rotation.x = -0.5;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(GOOSE_RADIUS * 0.42, 10, 8), white);
  head.position.set(0, GOOSE_HEIGHT * 0.5, GOOSE_RADIUS * 1.5);
  group.add(head);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(GOOSE_RADIUS * 0.16, GOOSE_RADIUS * 0.4, 6), orange);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, GOOSE_HEIGHT * 0.5, GOOSE_RADIUS * 1.9);
  group.add(beak);

  const wingGeometry = new THREE.BoxGeometry(GOOSE_RADIUS * 0.15, GOOSE_RADIUS * 0.7, GOOSE_RADIUS * 1.1);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeometry, grey);
    wing.position.set(side * GOOSE_RADIUS * 0.95, GOOSE_RADIUS * 0.1, 0);
    group.add(wing);
  }

  const legGeometry = new THREE.CylinderGeometry(GOOSE_RADIUS * 0.08, GOOSE_RADIUS * 0.08, GOOSE_HEIGHT * 0.4, 6);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeometry, orange);
    leg.position.set(side * GOOSE_RADIUS * 0.35, -GOOSE_HEIGHT * 0.35, 0);
    group.add(leg);
  }

  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}
