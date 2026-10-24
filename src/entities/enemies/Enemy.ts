import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { allocateEntityId, type Entity } from '../Entity.ts';
import type { Player } from '../Player.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import type { Damageable } from '../../combat/damage.ts';
import { sampleHeight } from '../../world/TerrainGenerator.ts';
import type { EnemyArchetype } from './archetypes.ts';
import { steerWithAvoidance } from './enemySteering.ts';
import { hasEnemyNavigator, resolveMoveTarget } from './enemyNavigator.ts';
import type { CombatCoordinator, CombatRole, RoleCandidate } from './combatCoordinator.ts';
import { EnemyBrain, type EnemyState } from './EnemyBrain.ts';
import type { EnemyBody, EnemyPosition } from './EnemyBody.ts';
import { createHitColliders, ENEMY_HIT_SHAPE, yawRotation } from '../characterHitbox.ts';
import type { EnemyCombatHooks } from './enemyCombat.ts';
import type { SquadKnowledge } from './squadKnowledge.ts';
import type { IntentSink } from './calloutDirector.ts';
import type { PickDebug } from './combatBehaviour.ts';
import type { PlanarPoint } from './perception.ts';
import type { TacticalContext } from './tactics/planner.ts';
import { crossFadeBase, ENEMY_CHARACTER, instantiateCharacter, RUN_SPEED_THRESHOLD, type CharacterClipRole, type CharacterInstance } from '../characterModels.ts';
import { ENEMY_HEIGHT, ENEMY_STAGGER_LURCH_RAD, HEADSHOT_MULTIPLIER } from '../../core/config.ts';

export type { EnemyCombatHooks } from './enemyCombat.ts';
export { setEnemyNavigator, type EnemyNavigator } from './enemyNavigator.ts';

export const ENEMY_MODEL_PATH = ENEMY_CHARACTER.path;

/** Debug-only view of one enemy for the e2e suite and the perf work (window.__gameDebug). */
export interface EnemyDebugRecord {
  readonly archetype: string;
  readonly state: EnemyState;
  readonly awareness: number;
  readonly hasLineOfSight: boolean;
  readonly yaw: number;
  /** The combat coordinator's role while in combat, else null. */
  readonly role: CombatRole | null;
  /** The spot it is fighting from (step 3), else null. */
  readonly pick: PickDebug | null;
  /** The search-grid cell it is heading for while searching (step 4), else null. */
  readonly searchTarget: PlanarPoint | null;
  /** Knocked off balance by a heavy hit right now (step 5). */
  readonly staggered: boolean;
}

/** How far an enemy must move horizontally before its ground height is resampled. sampleHeight is
 * the enemy hot path's dominant cost (4-octave fBm + a 9-cell Worley scan per call, per enemy, per
 * frame - thousands of noise evaluations/sec at a 50-enemy match size) for what is nearly static
 * data: at chase speed 3.4 an enemy covers ~0.057 units/tick, so this caches ~4 frames' worth of
 * samples. 0.25 units of horizontal drift changes terrain height imperceptibly (terrain base
 * frequency 0.015 means a full noise period spans ~67 units) and the physics body glues back to
 * the exact surface on the next resample. */
const HEIGHT_RESAMPLE_DISTANCE_SQ = 0.25 * 0.25;

/** How far ahead of itself a retreating enemy looks for the point it backs toward, so a navigator
 * (see enemyNavigator.ts) can route the retreat through a doorway instead of into a wall. */
const RETREAT_LOOKAHEAD = 3;

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
 * Visuals are the full-size SWAT character (characterModels.ts, phase 7 of the visual overhaul):
 * it stands with its gun up, walks or runs by speed, plays a shot on each round fired and its death
 * clip as it falls. Hit detection uses invisible capsule and ball colliders fitted to that model
 * (characterHitbox.ts); the model itself is cosmetic only.
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
  private readonly actions: CharacterInstance['actions'];
  private baseClip: CharacterClipRole | null = null;
  /** The speed of this tick's move, for choosing walk or run. */
  private moveSpeed = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    position: THREE.Vector3,
    gltf: GLTF,
    readonly archetype: EnemyArchetype,
    coordinator: CombatCoordinator,
    knowledge: SquadKnowledge,
    intents: IntentSink,
    combatHooks: EnemyCombatHooks,
    patrolRng: () => number,
    tacticsRng: () => number,
  ) {
    this.health = archetype.health;
    this.killFeedLabel = `${archetype.name} eliminated`;

    const character = instantiateCharacter(gltf, ENEMY_CHARACTER, ENEMY_HEIGHT);
    const model = character.model;

    this.mesh = new THREE.Group();
    this.mesh.add(model);
    this.mesh.position.copy(position);
    // Yaw first, then pitch about the enemy's own side axis, so the stagger lurch (and the death
    // topple, which reads rotation.x) tips it back whichever way it faces. The default XYZ order
    // pitched about the world X axis: an enemy facing along X tipped sideways (final review).
    this.mesh.rotation.order = 'YXZ';
    this.mixer = character.mixer;
    this.actions = character.actions;
    crossFadeBase(this.actions, null, 'idle', 0);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      position.x,
      position.y,
      position.z,
    );
    this.rigidBody = physics.world.createRigidBody(bodyDesc);

    const colliders = createHitColliders(physics.world, this.rigidBody, ENEMY_HIT_SHAPE);
    this.bodyCollider = colliders.body;
    this.headCollider = colliders.head;
    physics.registerCollider(this.bodyCollider, this);
    physics.registerCollider(this.headCollider, this);

    this.brain = new EnemyBrain(this, physics, coordinator, knowledge, intents, combatHooks, patrolRng, tacticsRng, position);
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
      pick: brain.pick,
      searchTarget: brain.searchTarget,
      staggered: brain.staggered,
    };
  }

  /** The squad search grid (step 4) - see EnemyBrain.searchCandidate / assignSearchTarget. */
  searchCandidate(): { id: number; x: number; z: number; yaw: number } | null {
    return this.dead ? null : this.brain.searchCandidate();
  }

  assignSearchTarget(x: number, z: number): void {
    if (!this.dead) this.brain.assignSearchTarget(x, z);
  }

  /** This enemy's entry on the combat coordinator's roster, or null when it is not fighting. */
  combatCandidate(): RoleCandidate | null {
    return this.dead ? null : this.brain.combatCandidate();
  }

  /** Position picking (step 3) - see EnemyBrain.wantsTacticalPick and friends. */
  wantsTacticalPick(): boolean {
    return !this.dead && this.brain.wantsTacticalPick();
  }

  refreshTacticalPick(context: TacticalContext, rayAllowance: number): number {
    return this.dead ? 0 : this.brain.refreshTacticalPick(context, rayAllowance);
  }

  tacticalClaims(): PlanarPoint[] {
    return this.dead ? [] : this.brain.tacticalClaims();
  }

  fireLineStart(): PlanarPoint | null {
    return this.dead ? null : this.brain.fireLineStart();
  }

  /** Test-only (window.__gameDebug.placeEnemy): moves the enemy instantly, like the player's own
   * debugTeleport, and makes the new spot its patrol home, so a behaviour test can stage a known
   * layout that stays put. Moving only the body let a placed enemy walk back toward where it
   * spawned, near the player: the hearing check's "enemy 36 m away reacted to a pistol" was that
   * enemy walking home and seeing the player (checkpoint E). Never called by gameplay code. */
  debugPlace(x: number, z: number): void {
    this.heightSampleX = Number.NaN;
    this.heightSampleZ = Number.NaN;
    const y = this.groundHeightAt(x, z) + ENEMY_HEIGHT / 2;
    this.rigidBody.setTranslation({ x, y, z }, true);
    this.rigidBody.setNextKinematicTranslation({ x, y, z });
    this.mesh.position.set(x, y, z);
    this.brain.rehome(x, z);
  }

  takeDamage(amount: number, hitColliderHandle: number, sourcePosition?: THREE.Vector3): void {
    if (this.dead) return;
    const isHeadshot = hitColliderHandle === this.headCollider.handle;
    const applied = isHeadshot ? amount * HEADSHOT_MULTIPLIER : amount;
    this.health -= applied;
    if (this.health <= 0) {
      this.dead = true;
      // The death clip takes over from whatever it was doing (see animateDeath).
      this.mixer.stopAllAction();
      this.actions.death?.reset().play();
      return;
    }
    this.brain.onDamaged(sourcePosition, applied);
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

  /** Sent in by the pacing director (see EnemyBrain.dispatchToward). */
  dispatchToward(position: THREE.Vector3): void {
    if (this.dead) return;
    this.brain.dispatchToward(position);
  }

  update(dt: number, player: Player): void {
    if (this.dead) return;
    this.moving = false;
    this.moveSpeed = 0;
    this.brain.update(dt, player);
    this.updateBaseAnimation();
    // The hit shapes sit forward of the centre line where the model carries its head and chest,
    // so the body turns with the model.
    this.rigidBody.setNextKinematicRotation(yawRotation(this.mesh.rotation.y));
    // A heavy hit tips the model back, easing upright as the stagger ends (step 5).
    this.mesh.rotation.x = -this.brain.lurch * ENEMY_STAGGER_LURCH_RAD;
    this.mixer.update(dt);
  }

  /** Straight-line movement with whisker obstacle steering (see enemySteering.ts) - used by every
   * moving state (patrol, search, and chase - chase used to beeline without avoidance, which let
   * chasers clip through tree trunks/rocks whose colliders block the ground path even when the
   * head-height LOS ray clears past them). With a navigator set (a Facility match) it steers at the
   * navigator's next waypoint instead of the raw target. */
  moveToward(targetX: number, targetZ: number, speed: number, dt: number): void {
    const current = this.rigidBody.translation();
    const waypoint = resolveMoveTarget(current.x, current.z, targetX, targetZ);
    const dx = waypoint.x - current.x;
    const dz = waypoint.z - current.z;
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
    this.moveSpeed = speed;
  }

  /** The kiting retreat: the same whisker avoidance as every other move, so retreating doesn't
   * walk straight into a wall, but facing the threat it's backing away from instead of the
   * retreat direction. */
  retreatFrom(threatX: number, threatZ: number, speed: number, dt: number): EnemyPosition | null {
    const current = this.rigidBody.translation();
    const awayX = current.x - threatX;
    const awayZ = current.z - threatZ;
    const awayDistance = Math.sqrt(awayX * awayX + awayZ * awayZ);
    if (awayDistance <= 1e-4) return null;

    // With a navigator set, the point it backs toward is routed through it; without one (the
    // Valley) it backs straight away, exactly as before.
    let dx = awayX;
    let dz = awayZ;
    let distance = awayDistance;
    if (hasEnemyNavigator()) {
      const waypoint = resolveMoveTarget(
        current.x,
        current.z,
        current.x + (awayX / awayDistance) * RETREAT_LOOKAHEAD,
        current.z + (awayZ / awayDistance) * RETREAT_LOOKAHEAD,
      );
      const wx = waypoint.x - current.x;
      const wz = waypoint.z - current.z;
      const waypointDistance = Math.sqrt(wx * wx + wz * wz);
      // A waypoint on top of the enemy (already at the snapped target) keeps the straight retreat.
      if (waypointDistance > 1e-4) {
        dx = wx;
        dz = wz;
        distance = waypointDistance;
      }
    }

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
    // Backing away while aiming is a walk, however fast the archetype kites.
    this.moveSpeed = Math.min(speed, RUN_SPEED_THRESHOLD);
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

  /** A round left the muzzle (EnemyBody.onFired): the shot clip plays over the base pose. */
  onFired(): void {
    if (this.dead) return;
    this.actions.fire?.reset().fadeIn(0.05).play();
  }

  /** Keeps the death clip playing while the corpse falls (EntityManager's dying sequence). */
  animateDeath(dt: number): void {
    this.mixer.update(dt);
  }

  private updateBaseAnimation(): void {
    const next: CharacterClipRole = !this.moving ? 'idle' : this.moveSpeed > RUN_SPEED_THRESHOLD ? 'run' : 'walk';
    crossFadeBase(this.actions, this.baseClip, next);
    this.baseClip = next;
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
