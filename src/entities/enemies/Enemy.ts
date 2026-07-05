import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { allocateEntityId, type Entity } from '../Entity.ts';
import type { Player } from '../Player.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import type { Damageable } from '../../combat/damage.ts';
import { sampleHeight } from '../../world/TerrainGenerator.ts';
import { castHitscan } from '../../combat/hitscan.ts';
import { applySpreadCone } from '../../combat/spread.ts';
import type { EnemyArchetype } from './archetypes.ts';
import { hasLineOfSight, pickPatrolDestination, steerWithAvoidance } from './enemySteering.ts';
import type { EngagementSlots } from './engagementSlots.ts';
import {
  ENEMY_ALERT_REACTION_TIME,
  ENEMY_ATTACK_INTERVAL,
  ENEMY_ATTACK_RANGE,
  ENEMY_HEIGHT,
  ENEMY_LOS_CHECK_INTERVAL,
  ENEMY_MELEE_SWING_COUNT,
  ENEMY_MELEE_SWING_SPREAD_DEG,
  ENEMY_PATROL_REPATH_MAX,
  ENEMY_PATROL_REPATH_MIN,
  ENEMY_PATROL_SPEED,
  ENEMY_PATROL_STOP_DISTANCE,
  ENEMY_RADIUS,
  ENEMY_SEARCH_DURATION,
  ENEMY_SEARCH_STOP_DISTANCE,
  ENEMY_STUCK_EPSILON,
  ENEMY_STUCK_WINDOW,
  EYE_OFFSET,
  HEADSHOT_MULTIPLIER,
} from '../../core/config.ts';

export const ENEMY_MODEL_PATH = '/assets/models/enemies/character-male-a.glb';

/** Fired once per enemy hitscan shot (hit or miss) - the game wires this to Tracers/ImpactMarkers/
 * sound, matching how the player's own WeaponManager reports its shots. */
export interface EnemyCombatHooks {
  onRangedShotFired: (origin: THREE.Vector3, end: THREE.Vector3, hitPlayer: boolean) => void;
}

const HEAD_RADIUS = ENEMY_RADIUS * 0.55;
const HEAD_OFFSET_Y = ENEMY_HEIGHT / 2 - HEAD_RADIUS;

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

type EnemyState = 'idle' | 'alert' | 'chase' | 'search';

/**
 * Idle: patrols real destinations across ENEMY_ROAM_RADIUS of its spawn point (biased toward
 * town/forest content, not a uniformly random shuffle - see enemySteering.ts), with whisker
 * obstacle avoidance and stuck-detection reroute standing in for real pathfinding.
 *
 * Alert/chase/search (Phase B): detection requires both the archetype's detectionRange and a clear
 * line-of-sight raycast, not distance alone - a player behind a wall no longer gets "sensed"
 * through it. Spotting the player enters alert (a short stationary reaction beat, facing the
 * threat) before committing to chase. Losing LOS mid-chase (rather than just leashing out of range)
 * drops to search - beelines the last-seen position for ENEMY_SEARCH_DURATION before giving up back
 * to idle, reading as "I saw you go around that corner" instead of instantly forgetting the player.
 * Getting further than the archetype's leashRange away from any of alert/chase/search always drops straight
 * back to idle (a wider radius than detection, so it doesn't flicker right at the detection boundary).
 *
 * Chase itself (Phase C): beyond ENEMY_ATTACK_RANGE, closes distance until within the archetype's
 * rangedRange with a clear sightline, then stands (or, for a 'kite' archetype, backs away - see
 * updateKiteRetreat) and fires real hitscan shots with a visible tracer and a narrowing angular
 * aim-error cone rather than a hidden hit-chance roll - see updateRangedFiring. Within
 * ENEMY_ATTACK_RANGE, melee always wins regardless of archetype (the "universal fallback" from the
 * design doc) - a real fan-raycast swing (Phase D), not a flat auto-hit tick.
 *
 * Per-archetype loadouts (follow-up to Phases A-E): every enemy is constructed with a real
 * `EnemyArchetype` (see archetypes.ts) carrying its own health/speed/range/damage/aim-error numbers
 * and a movementStyle ('direct' or 'kite') - the state machine and combat mechanics above are
 * shared by every archetype; only the numbers and the one movement branch differ.
 *
 * Visuals are the real character-male-a.glb (Kenney "Mini Characters", CC0), animated with its
 * bundled "idle"/"walk" clips. Hit detection still uses the same invisible capsule+ball
 * colliders as before - the model is cosmetic only.
 */
export class Enemy implements Entity, Damageable {
  readonly id = allocateEntityId();
  readonly isDamageableTarget = true;
  readonly killFeedLabel: string;
  readonly mesh: THREE.Group;

  private health: number;
  private dead = false;
  private attackCooldown = 0;
  private state: EnemyState = 'idle';
  private readonly spawnPosition: THREE.Vector3;
  private patrolDestination: THREE.Vector3;
  private patrolRepathTimer = 0;
  private stuckCheckTimer = 0;
  private stuckCheckPos: THREE.Vector3;
  private alertTimer = 0;
  private searchTimer = 0;
  private readonly searchDestination: THREE.Vector3;
  /** Throttled (ENEMY_LOS_CHECK_INTERVAL), not recomputed every frame - a raycast per enemy per
   * frame adds up once several are chasing at once. Randomized initial offset so many enemies'
   * checks don't all land on the same frame. */
  private losCheckTimer: number;
  private hasLineOfSightToPlayer = false;
  private hasEngagementSlot = false;
  private aimHoldTimer = 0;
  private burstShotsFired = 0;
  private burstCooldown = 0;
  /** 'kite' archetypes only - true while backing away from a player that's closed inside
   * kiteTriggerRange; hysteresis (see updateChase) keeps this from flickering at the boundary. */
  private isKiting = false;
  private readonly rigidBody: RAPIER.RigidBody;
  private readonly bodyCollider: RAPIER.Collider;
  private readonly headCollider: RAPIER.Collider;

  private readonly mixer: THREE.AnimationMixer;
  private readonly idleAction: THREE.AnimationAction | undefined;
  private readonly walkAction: THREE.AnimationAction | undefined;
  private isMoving = false;

  /** `patrolRng` is a seeded per-enemy stream (EntityManager derives it from the world seed and
   * spawn order) - patrol destinations, repath timers, and the LOS-check phase offset all draw
   * from it, so a given world seed reproduces the same pre-aggro AI behavior exactly. Combat
   * spread (aim error, melee swing fan) deliberately stays on Math.random, matching the player's
   * own non-deterministic weapon spread. */
  constructor(
    private readonly physics: PhysicsWorld,
    position: THREE.Vector3,
    gltf: GLTF,
    private readonly archetype: EnemyArchetype,
    private readonly engagementSlots: EngagementSlots,
    private readonly combatHooks: EnemyCombatHooks,
    private readonly patrolRng: () => number,
  ) {
    this.health = archetype.health;
    this.killFeedLabel = `${archetype.name} eliminated`;
    this.spawnPosition = position.clone();
    this.patrolDestination = position.clone();
    this.stuckCheckPos = position.clone();
    this.searchDestination = position.clone();
    this.losCheckTimer = this.patrolRng() * ENEMY_LOS_CHECK_INTERVAL;

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

  /** Debug-only introspection for the e2e suite - which archetype this instance actually got
   * assigned (per-archetype loadouts follow-up). */
  get debugArchetype(): string {
    return this.archetype.name;
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

    this.losCheckTimer -= dt;
    if (this.losCheckTimer <= 0) {
      this.losCheckTimer = ENEMY_LOS_CHECK_INTERVAL;
      // Skip the raycast entirely once the player's already out of leash range - no state this
      // frame could care about LOS at that distance anyway.
      this.hasLineOfSightToPlayer =
        distanceToPlayer <= this.archetype.leashRange && this.computeLineOfSight(current, player);
    }

    this.updateAggroState(dt, distanceToPlayer);

    const wasMoving = this.isMoving;
    this.isMoving = false;

    switch (this.state) {
      case 'chase':
        this.updateChase(dt, player, current, distanceToPlayer);
        break;
      case 'search':
        this.updateSearch(dt, current);
        break;
      case 'alert':
        this.faceToward(player.position.x, player.position.z, current);
        break;
      default:
        this.updatePatrol(dt, current);
    }

    if (this.isMoving !== wasMoving) this.setMovingAnimation(this.isMoving);
    this.mixer.update(dt);
  }

  private computeLineOfSight(current: { x: number; y: number; z: number }, player: Player): boolean {
    const from = new THREE.Vector3(current.x, current.y + HEAD_OFFSET_Y, current.z);
    const to = player.position.clone();
    to.y += EYE_OFFSET;
    return hasLineOfSight(this.physics, from, to, this.rigidBody, player.ownCollider.handle);
  }

  /** Pure state transitions - no movement here, so the switch in update() always sees this frame's
   * already-resolved state (matches the immediate-use pattern the old idle/chase check had). */
  private updateAggroState(dt: number, distanceToPlayer: number): void {
    switch (this.state) {
      case 'idle':
        if (distanceToPlayer <= this.archetype.detectionRange && this.hasLineOfSightToPlayer) {
          this.state = 'alert';
          this.alertTimer = ENEMY_ALERT_REACTION_TIME;
        }
        break;
      case 'alert':
        if (distanceToPlayer > this.archetype.leashRange || !this.hasLineOfSightToPlayer) {
          this.state = 'idle';
          break;
        }
        this.alertTimer -= dt;
        if (this.alertTimer <= 0) this.state = 'chase';
        break;
      case 'chase':
        if (distanceToPlayer > this.archetype.leashRange) {
          this.state = 'idle';
          this.releaseEngagementSlot();
          this.isKiting = false;
        } else if (!this.hasLineOfSightToPlayer) {
          this.state = 'search';
          this.searchTimer = ENEMY_SEARCH_DURATION;
          this.releaseEngagementSlot();
          this.isKiting = false;
        }
        break;
      case 'search':
        if (distanceToPlayer <= this.archetype.detectionRange && this.hasLineOfSightToPlayer) {
          this.state = 'chase';
          break;
        }
        this.searchTimer -= dt;
        if (this.searchTimer <= 0) this.state = 'idle';
        break;
    }
  }

  private updateChase(
    dt: number,
    player: Player,
    current: { x: number; y: number; z: number },
    distanceToPlayer: number,
  ): void {
    // Kept fresh every frame while chasing so search (entered the instant LOS is lost) beelines
    // for where the player actually was, not a stale position from several frames earlier.
    this.searchDestination.copy(player.position);
    const archetype = this.archetype;

    if (distanceToPlayer <= ENEMY_ATTACK_RANGE) {
      // Melee always wins at close range regardless of archetype (Phase D's "universal fallback"),
      // so ranged combat/kiting stand aside entirely here rather than also acting at point-blank.
      this.releaseEngagementSlot();
      this.aimHoldTimer = 0;
      this.isKiting = false;
      this.faceToward(player.position.x, player.position.z, current);
      this.updateMelee(player, current);
      return;
    }

    if (archetype.movementStyle === 'kite') {
      if (!this.isKiting && distanceToPlayer < archetype.kiteTriggerRange) {
        this.isKiting = true;
      } else if (this.isKiting && distanceToPlayer >= archetype.kiteStopRange) {
        this.isKiting = false;
      }
      if (this.isKiting && this.hasLineOfSightToPlayer) {
        this.updateKiteRetreat(dt, player, current);
        return;
      }
    }

    if (distanceToPlayer <= archetype.rangedRange && this.hasLineOfSightToPlayer) {
      this.faceToward(player.position.x, player.position.z, current);
      this.updateRangedFiring(dt, player, current, true);
    } else {
      this.releaseEngagementSlot();
      this.aimHoldTimer = 0;
      // Whisker avoidance during chase too (this used to deliberately beeline): a head-height LOS
      // ray can clear past a tree trunk or boulder whose collider still blocks the ground path, so
      // a beelining chaser visibly clipped through trunks - the most player-visible AI artifact in
      // the codebase. Costs 3 short raycasts per chasing (not yet firing) enemy per frame, same as
      // patrol/search/kite movement already pays.
      this.moveTowardWithAvoidance(player.position.x, player.position.z, archetype.moveSpeed, dt, current);
    }
  }

  /** 'kite' archetypes only (e.g. Ridge Walker) - backs away from the player while continuing to
   * fire, instead of just standing and shooting. Reuses the same whisker avoidance as patrol/search
   * movement so retreating doesn't walk straight into a wall, and reuses the patrol/search
   * stuck-detection pattern (same timer/pos fields, since patrol and chase never run in the same
   * frame) to abandon a wedged retreat rather than freeze - standing and firing in place until
   * distance re-arms kiting is a perfectly fine fallback. Aim-error intentionally stays wide the
   * whole time it's moving (see updateRangedFiring's `isStationary` param) - a sniper on the move
   * shouldn't shoot as accurately as one holding still. */
  private updateKiteRetreat(dt: number, player: Player, current: { x: number; y: number; z: number }): void {
    const dx = current.x - player.position.x;
    const dz = current.z - player.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance > 1e-4) {
      const desiredDir = new THREE.Vector3(dx / distance, 0, dz / distance);
      const chestPos = new THREE.Vector3(current.x, current.y, current.z);
      const steeredDir = steerWithAvoidance(this.physics, chestPos, desiredDir, this.bodyCollider);

      const step = this.archetype.moveSpeed * dt;
      const nextX = current.x + steeredDir.x * step;
      const nextZ = current.z + steeredDir.z * step;
      this.applyPosition(nextX, nextZ);

      // Faces the threat it's backing away from, not the retreat direction - computed from the
      // *new* position, not the stale `current`, since faceToward's own applyPosition call would
      // otherwise snap the enemy right back to where it started.
      const faceDx = player.position.x - nextX;
      const faceDz = player.position.z - nextZ;
      if (faceDx * faceDx + faceDz * faceDz > 1e-4) {
        this.mesh.rotation.y = Math.atan2(faceDx, faceDz);
      }
      this.isMoving = true;
      this.updateStuckDetection(dt, { x: nextX, y: current.y, z: nextZ }, () => {
        this.isKiting = false;
      });
    }

    this.updateRangedFiring(dt, player, current, false);
  }

  /** Stands and fires real hitscan shots once in range with a clear sightline - "fair" ranged
   * combat (Phase C): a visible tracer per shot (hit or miss), an angular aim-error cone that
   * narrows the longer `isStationary` has held true, and a burst-then-pause cadence rather than a
   * continuous stream. Gated by `engagementSlots` (ENEMY_MAX_CONCURRENT_ENGAGERS) so not every
   * enemy that spots the player opens fire simultaneously - one that can't get a slot still
   * tracks/faces the player, it just holds fire until one frees up. Movement/facing is the caller's
   * job (stand-and-fire vs. kite-and-fire look different) - this only ever fires. */
  private updateRangedFiring(
    dt: number,
    player: Player,
    current: { x: number; y: number; z: number },
    isStationary: boolean,
  ): void {
    if (!this.hasEngagementSlot) {
      this.hasEngagementSlot = this.engagementSlots.tryAcquire(this.id);
    }
    if (!this.hasEngagementSlot) {
      this.aimHoldTimer = 0;
      return;
    }

    this.aimHoldTimer = isStationary ? this.aimHoldTimer + dt : 0;
    this.burstCooldown -= dt;
    if (this.burstCooldown > 0) return;

    this.fireRangedShot(player, current);
    this.burstShotsFired += 1;
    if (this.burstShotsFired >= this.archetype.burstCount) {
      this.burstShotsFired = 0;
      this.burstCooldown = this.archetype.burstPause;
    } else {
      this.burstCooldown = this.archetype.fireInterval;
    }
  }

  private fireRangedShot(player: Player, current: { x: number; y: number; z: number }): void {
    const archetype = this.archetype;
    const origin = new THREE.Vector3(current.x, current.y + HEAD_OFFSET_Y, current.z);
    const target = player.position.clone();
    target.y += EYE_OFFSET;

    const direction = target.clone().sub(origin).normalize();

    // A real angular cone, not a fixed linear miss distance - it widens with range "for free"
    // (the same angular error covers more lateral distance the farther the target is) and narrows
    // the longer the sightline has held (see aimSettleTime), same spread-by-two-axis-angle
    // technique WeaponManager already uses for the player's own weapons.
    const holdT = Math.min(1, this.aimHoldTimer / archetype.aimSettleTime);
    const errorDeg = archetype.aimErrorMaxDeg - (archetype.aimErrorMaxDeg - archetype.aimErrorMinDeg) * holdT;
    applySpreadCone(direction, THREE.MathUtils.degToRad(errorDeg));

    const maxRange = archetype.rangedRange + 5;
    const hit = castHitscan(this.physics, origin, direction, maxRange, undefined, this.rigidBody);
    const tracerEnd = hit ? hit.point : origin.clone().add(direction.multiplyScalar(maxRange));

    const hitPlayer = hit?.colliderHandle === player.ownCollider.handle;
    if (hitPlayer && !player.isDead) {
      player.takeDamage(archetype.rangedDamage);
    }

    this.combatHooks.onRangedShotFired(origin, tracerEnd, hitPlayer);
  }

  private releaseEngagementSlot(): void {
    if (!this.hasEngagementSlot) return;
    this.engagementSlots.release(this.id);
    this.hasEngagementSlot = false;
  }

  /** Universal melee fallback (Phase D) - a real fan-raycast swing mirroring the player's own
   * knife (same spread-by-two-axis-angle technique, ENEMY_MELEE_SWING_COUNT rays instead of one),
   * requiring an actual line of sight rather than the flat auto-hit-if-in-range tick this used to
   * be. Can genuinely miss if none of the swing's rays connect - a player hugging the very edge of
   * ENEMY_ATTACK_RANGE isn't guaranteed to get hit just for being in range. Swing mechanics
   * (count/spread/cooldown) stay global across archetypes; only meleeDamage is the identity knob. */
  private updateMelee(player: Player, current: { x: number; y: number; z: number }): void {
    if (this.attackCooldown > 0 || player.isDead || !this.hasLineOfSightToPlayer) return;
    this.attackCooldown = ENEMY_ATTACK_INTERVAL;

    const origin = new THREE.Vector3(current.x, current.y + HEAD_OFFSET_Y, current.z);
    const target = player.position.clone();
    target.y += EYE_OFFSET;
    const baseDirection = target.clone().sub(origin).normalize();
    const spreadRad = THREE.MathUtils.degToRad(ENEMY_MELEE_SWING_SPREAD_DEG);
    const maxRange = ENEMY_ATTACK_RANGE + 1;

    for (let i = 0; i < ENEMY_MELEE_SWING_COUNT; i++) {
      const direction = applySpreadCone(baseDirection.clone(), spreadRad);

      const hit = castHitscan(this.physics, origin, direction, maxRange, undefined, this.rigidBody);
      if (hit?.colliderHandle === player.ownCollider.handle) {
        player.takeDamage(this.archetype.meleeDamage);
        return;
      }
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

  /** Beelines the last-seen player position (with the same whisker avoidance as patrol) until
   * close enough to stop, then just stands there for whatever's left of ENEMY_SEARCH_DURATION -
   * updateAggroState (not here) owns the timer and the fallback back to idle when it runs out. */
  private updateSearch(dt: number, current: { x: number; y: number; z: number }): void {
    if (horizontalDistance(current, this.searchDestination) > ENEMY_SEARCH_STOP_DISTANCE) {
      this.moveTowardWithAvoidance(this.searchDestination.x, this.searchDestination.z, ENEMY_PATROL_SPEED, dt, current);
    }
  }

  private repath(): void {
    this.patrolDestination = pickPatrolDestination(this.spawnPosition, this.patrolRng);
    this.patrolRepathTimer = ENEMY_PATROL_REPATH_MIN + this.patrolRng() * (ENEMY_PATROL_REPATH_MAX - ENEMY_PATROL_REPATH_MIN);
  }

  /** No navmesh in this codebase - whisker avoidance (see enemySteering.ts) handles convex
   * obstacles, but a concave trap (e.g. a tight gap between buildings) can still wedge an enemy.
   * Rather than freezing indefinitely, an enemy that's tried to move but barely progressed over
   * ENEMY_STUCK_WINDOW gives up - by default that means a fresh patrol destination (`repath`), but
   * `onStuck` lets other movement (kite retreat) substitute its own "give up" action instead. */
  private updateStuckDetection(
    dt: number,
    current: { x: number; y: number; z: number },
    onStuck: () => void = () => this.repath(),
  ): void {
    this.stuckCheckTimer += dt;
    if (this.stuckCheckTimer < ENEMY_STUCK_WINDOW) return;

    const moved = horizontalDistance(current, this.stuckCheckPos);
    if (this.isMoving && moved < ENEMY_STUCK_EPSILON) {
      onStuck();
    }
    this.stuckCheckTimer = 0;
    this.stuckCheckPos.set(current.x, current.y, current.z);
  }

  /** Straight-line movement with whisker obstacle steering (see enemySteering.ts) - used by every
   * moving state (patrol, search, and chase - chase used to beeline without avoidance, which let
   * chasers clip through tree trunks/rocks whose colliders block the ground path even when the
   * head-height LOS ray clears past them). */
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

  dispose(): void {
    this.releaseEngagementSlot();
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
