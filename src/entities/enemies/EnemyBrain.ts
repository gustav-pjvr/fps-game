import * as THREE from 'three';
import type { Player } from '../Player.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { hasLineOfSight, horizontalDistance, pickPatrolDestination } from './enemySteering.ts';
import { ENEMY_HEAD_OFFSET_Y, type EnemyBody, type EnemyPosition } from './EnemyBody.ts';
import {
  createCombatState,
  dropFiringToken,
  fireRangedShot,
  stepRangedFiring,
  swingMelee,
  type CombatState,
  type EnemyCombatHooks,
} from './enemyCombat.ts';
import type { CombatCoordinator, CombatRole, RoleCandidate } from './combatCoordinator.ts';
import { awarenessLevel, hearingRangeFor, isInViewCone, stepAwareness, visibilityFactor } from './perception.ts';
import type { SquadKnowledge } from './squadKnowledge.ts';
import {
  ENEMY_ATTACK_INTERVAL,
  ENEMY_ATTACK_RANGE,
  ENEMY_AWARENESS_SUSPICIOUS,
  ENEMY_DEATH_ALERT_RADIUS,
  ENEMY_FLANK_ARRIVE_DISTANCE,
  ENEMY_FLANK_RADIUS_FRACTION,
  ENEMY_FLANK_RADIUS_MAX,
  ENEMY_FLANK_RADIUS_MIN,
  ENEMY_KNOWLEDGE_SHARE_MAX_AGE,
  ENEMY_KNOWLEDGE_SHARE_RADIUS,
  ENEMY_LOS_CHECK_INTERVAL,
  ENEMY_PATROL_REPATH_MAX,
  ENEMY_PATROL_REPATH_MIN,
  ENEMY_PATROL_SPEED,
  ENEMY_PATROL_STOP_DISTANCE,
  ENEMY_SEARCH_DURATION,
  ENEMY_SEARCH_STOP_DISTANCE,
  ENEMY_STUCK_EPSILON,
  ENEMY_STUCK_WINDOW,
  ENEMY_THREAT_SEARCH_ERROR_MAX,
  ENEMY_THREAT_SEARCH_ERROR_MIN,
  EYE_OFFSET,
} from '../../core/config.ts';

export type EnemyState = 'idle' | 'alert' | 'chase' | 'search';

export interface EnemyBrainDebug {
  readonly state: EnemyState;
  readonly awareness: number;
  readonly hasLineOfSight: boolean;
  /** The coordinator's role while in combat ('chase'), else null. */
  readonly role: CombatRole | null;
}

function headOf(position: EnemyPosition): THREE.Vector3 {
  return new THREE.Vector3(position.x, position.y + ENEMY_HEAD_OFFSET_Y, position.z);
}

/**
 * The enemy's decision logic (split out of Enemy.ts by enemy AI v2 commit 0). It drives an
 * EnemyBody and never touches colliders, the model or animation directly.
 *
 * Idle: patrols real destinations across ENEMY_ROAM_RADIUS of its spawn point (biased toward
 * town/forest content - see enemySteering.ts), with whisker obstacle avoidance and
 * stuck-detection reroute standing in for real pathfinding.
 *
 * Spotting (enemy AI v2 step 1, perception.ts): an awareness meter fills while the enemy has a
 * clear sightline to a player inside its view cone and detection range (faster up close and for a
 * moving player) and drains otherwise. Suspicious (ENEMY_AWARENESS_SUSPICIOUS) is the 'alert'
 * state - stop and face where the player was last seen; a full meter is 'chase'. Sight lines are
 * throttled to one ray per ENEMY_LOS_CHECK_INTERVAL, and an oblivious enemy that is not facing the
 * player skips the ray.
 *
 * Squad knowledge (step 1, squadKnowledge.ts): a chasing enemy reports what it sees to the whole
 * squad. An idle enemy within ENEMY_KNOWLEDGE_SHARE_RADIUS of a fresh sighting goes to search
 * there, and a searching one keeps following the latest sighting.
 *
 * Roles (step 2, combatCoordinator.ts): in combat ('chase') the coordinator decides what each
 * enemy does. Only a shooter fires (at most ENEMY_MAX_CONCURRENT_ENGAGERS at once, best-placed
 * first). A flanker works round to a point ninety degrees from the squad's front and keeps going
 * even without its own sightline while a comrade still sees the player; once there it waits,
 * facing the player, for the coordinator to hand it a shooter token (arriving earns a crossfire
 * bonus). Rushers (melee-only archetypes) close in; reserves track the player and wait. Melee
 * inside ENEMY_ATTACK_RANGE and the kiter's retreat still come first, whatever the role.
 *
 * Losing sight mid-chase (without a flank to finish) drops to search - beelines the last-seen
 * position for ENEMY_SEARCH_DURATION before giving up back to idle. Getting further than the
 * archetype's leashRange away from any of alert/chase always drops straight back to idle.
 */
export class EnemyBrain {
  private state: EnemyState = 'idle';
  private readonly spawnPosition: THREE.Vector3;
  private patrolDestination: THREE.Vector3;
  private patrolRepathTimer = 0;
  private stuckCheckTimer = 0;
  private readonly stuckCheckPos: THREE.Vector3;
  private searchTimer = 0;
  private readonly searchDestination: THREE.Vector3;
  /** Where this enemy itself last had the player in sight - what an 'alert' enemy stares at. */
  private readonly lastSeenPosition: THREE.Vector3;
  /** Throttled (ENEMY_LOS_CHECK_INTERVAL), not recomputed every frame - a raycast per enemy per
   * frame adds up once several are chasing at once. Randomized initial offset so many enemies'
   * checks don't all land on the same frame. */
  private losCheckTimer: number;
  private hasLineOfSightToPlayer = false;
  /** 0 (oblivious) to 1 (detected) - see perception.ts. */
  private awareness = 0;
  private attackCooldown = 0;
  /** 'kite' archetypes only - true while backing away from a player that's closed inside
   * kiteTriggerRange; hysteresis (see updateChase) keeps this from flickering at the boundary. */
  private isKiting = false;
  private readonly combat: CombatState = createCombatState();

  /** `patrolRng` is a seeded per-enemy stream (EntityManager derives it from the world seed and
   * spawn order) - patrol destinations, repath timers, and the LOS-check phase offset all draw
   * from it, so a given world seed reproduces the same pre-aggro AI behavior exactly. Combat
   * spread (aim error, melee swing fan) deliberately stays on Math.random, matching the player's
   * own non-deterministic weapon spread. */
  constructor(
    private readonly body: EnemyBody,
    private readonly physics: PhysicsWorld,
    private readonly coordinator: CombatCoordinator,
    private readonly knowledge: SquadKnowledge,
    private readonly combatHooks: EnemyCombatHooks,
    private readonly patrolRng: () => number,
    spawnPosition: THREE.Vector3,
  ) {
    this.spawnPosition = spawnPosition.clone();
    this.patrolDestination = spawnPosition.clone();
    this.stuckCheckPos = spawnPosition.clone();
    this.searchDestination = spawnPosition.clone();
    this.lastSeenPosition = spawnPosition.clone();
    this.losCheckTimer = this.patrolRng() * ENEMY_LOS_CHECK_INTERVAL;
  }

  get currentState(): EnemyState {
    return this.state;
  }

  get debug(): EnemyBrainDebug {
    return {
      state: this.state,
      awareness: this.awareness,
      hasLineOfSight: this.hasLineOfSightToPlayer,
      role: this.state === 'chase' ? this.role : null,
    };
  }

  /** What the coordinator needs to know about this enemy, or null when it is not in combat. Read
   * once per tick, before any enemy moves, so the roster reflects last tick's positions. */
  combatCandidate(): RoleCandidate | null {
    if (this.state !== 'chase') return null;
    const position = this.body.position;
    const rangedRange = this.body.archetype.rangedRange;
    return {
      id: this.body.id,
      x: position.x,
      z: position.z,
      canShoot: rangedRange > 0,
      rangedRange,
      hasLineOfSight: this.hasLineOfSightToPlayer,
    };
  }

  /** A non-lethal hit - the shell has already applied the damage.
   *
   * Threat perception (2026-07-10 review, phase A): being shot is unambiguous - no detection range
   * or line-of-sight gate, unlike spotting the player normally. An idle, suspicious ('alert') or
   * searching enemy immediately searches toward roughly where the shot came from, and that rough
   * guess becomes squad knowledge - a suspicious enemy that gets shot stops staring and goes after
   * the shooter (since step 1 'alert' can last seconds, not the old fixed 0.4 s). A chasing enemy
   * already knows where the player is. */
  onDamaged(sourcePosition?: THREE.Vector3): void {
    if (sourcePosition && this.state !== 'chase') {
      this.enterSearchToward(sourcePosition, true);
      this.awareness = Math.max(this.awareness, ENEMY_AWARENESS_SUSPICIOUS);
      this.knowledge.reportDamage(this.searchDestination);
      return;
    }
    // "Flinch" (phase B, light version): a hit while already engaged resets the aim-settle timer,
    // so return fire visibly suppresses instead of a hit-while-firing enemy shrugging it off with
    // undiminished accuracy on its very next shot.
    if (this.state === 'chase') this.combat.aimHoldTimer = 0;
  }

  /** A player gunshot. Heard only within that weapon's loudness range (perception.ts's
   * hearingRangeFor - a pistol carries less far than a sniper). An idle enemy searches toward
   * roughly where it came from; a searching one takes the fresh evidence too (before enemy AI v2 a
   * searching enemy ignored new shots). Engaged enemies (alert/chase) learn nothing new from it. */
  onHeardGunshot(origin: THREE.Vector3, weaponId?: string): void {
    if (this.state !== 'idle' && this.state !== 'search') return;
    if (horizontalDistance(this.body.position, origin) > hearingRangeFor(weaponId)) return;
    this.enterSearchToward(origin, true);
    this.awareness = Math.max(this.awareness, ENEMY_AWARENESS_SUSPICIOUS);
  }

  /** A comrade died within ENEMY_DEATH_ALERT_RADIUS and this enemy has line-of-sight to the corpse
   * - it searches toward the killer. Idle or searching enemies only, same reasoning as
   * onHeardGunshot. (EntityManager reports the death to squad knowledge once, not per enemy.) */
  onNearbyDeath(deathPosition: THREE.Vector3, killerPosition: THREE.Vector3): void {
    if (this.state !== 'idle' && this.state !== 'search') return;
    const current = this.body.position;
    if (horizontalDistance(current, deathPosition) > ENEMY_DEATH_ALERT_RADIUS) return;
    if (!hasLineOfSight(this.physics, headOf(current), deathPosition, this.body.excludeRigidBody, -1)) return;
    this.enterSearchToward(killerPosition, false);
  }

  update(dt: number, player: Player): void {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const current = this.body.position;
    const distanceToPlayer = horizontalDistance(current, player.position);

    this.losCheckTimer -= dt;
    if (this.losCheckTimer <= 0) {
      this.losCheckTimer = ENEMY_LOS_CHECK_INTERVAL;
      // No ray once the player's beyond leash range (no state cares about LOS there), nor for an
      // oblivious enemy facing the other way - it could not start noticing the player anyway.
      this.hasLineOfSightToPlayer =
        distanceToPlayer <= this.body.archetype.leashRange &&
        this.isWorthLooking(current, player) &&
        this.computeLineOfSight(current, player);
      if (this.hasLineOfSightToPlayer) this.lastSeenPosition.copy(player.position);
      if (this.state === 'chase') this.reportSighting(player);
    }

    this.updateAggroState(dt, current, player, distanceToPlayer);

    switch (this.state) {
      case 'chase':
        this.updateChase(dt, player, current, distanceToPlayer);
        break;
      case 'search':
        this.updateSearch(dt, current);
        break;
      case 'alert':
        this.body.faceToward(this.lastSeenPosition.x, this.lastSeenPosition.z);
        break;
      default:
        this.updatePatrol(dt, current);
    }
  }

  /** Gives up this enemy's role and its place among the squad's watchers - called from the shell's
   * dispose. */
  dispose(): void {
    this.dropToken();
    this.coordinator.release(this.body.id);
    this.knowledge.forget(this.body.id);
  }

  /** This enemy's role from the combat coordinator. An enemy that has only just entered combat is
   * not on the roster until next tick; it waits as a reserve (or rushes, if melee-only). */
  private get role(): CombatRole {
    return this.coordinator.roleOf(this.body.id) ?? (this.body.archetype.rangedRange > 0 ? 'reserve' : 'rusher');
  }

  /** Shared by onDamaged/onHeardGunshot (a fuzzy estimate, `withError=true`) and onNearbyDeath or a
   * comrade's sighting (an exact position, `withError=false`) - beelines the given point for
   * ENEMY_SEARCH_DURATION, same as losing sight of the player mid-chase. */
  private enterSearchToward(position: THREE.Vector3, withError: boolean): void {
    if (withError) {
      const errorRadius =
        ENEMY_THREAT_SEARCH_ERROR_MIN + Math.random() * (ENEMY_THREAT_SEARCH_ERROR_MAX - ENEMY_THREAT_SEARCH_ERROR_MIN);
      const angle = Math.random() * Math.PI * 2;
      this.searchDestination.set(position.x + Math.cos(angle) * errorRadius, position.y, position.z + Math.sin(angle) * errorRadius);
    } else {
      this.searchDestination.copy(position);
    }
    this.state = 'search';
    this.searchTimer = ENEMY_SEARCH_DURATION;
  }

  /** An oblivious enemy only spends a sight ray on a player inside its view cone; once it is
   * suspicious or engaged it keeps looking wherever the player is. */
  private isWorthLooking(current: EnemyPosition, player: Player): boolean {
    if (this.state !== 'idle' || this.awareness > 0) return true;
    return isInViewCone(current, this.body.facingYaw, player.position, this.body.archetype.detectionRange);
  }

  private computeLineOfSight(current: EnemyPosition, player: Player): boolean {
    const to = player.position.clone();
    to.y += EYE_OFFSET;
    return hasLineOfSight(this.physics, headOf(current), to, this.body.excludeRigidBody, player.ownCollider.handle);
  }

  /** How strongly this tick's view of the player fills the meter - 0 without a sightline, outside
   * the view cone or beyond detection range. */
  private sightFactor(current: EnemyPosition, player: Player, distanceToPlayer: number): number {
    if (!this.hasLineOfSightToPlayer) return 0;
    const detectionRange = this.body.archetype.detectionRange;
    if (!isInViewCone(current, this.body.facingYaw, player.position, detectionRange)) return 0;
    return visibilityFactor(distanceToPlayer, detectionRange, player.movementBobStrength);
  }

  /** A chasing enemy's view of the player is the squad's. */
  private reportSighting(player: Player): void {
    if (this.hasLineOfSightToPlayer) this.knowledge.reportSeen(this.body.id, player.position);
    else this.knowledge.reportLost(this.body.id);
  }

  /** A flanker keeps flanking without its own sightline while a comrade still sees the player -
   * working round a house is the whole point of a flank. */
  private isFlankingBlind(): boolean {
    return this.role === 'flanker' && this.knowledge.isThreatVisible;
  }

  /** State transitions - no movement here, so the switch in update() always sees this frame's
   * already-resolved state. */
  private updateAggroState(dt: number, current: EnemyPosition, player: Player, distanceToPlayer: number): void {
    const archetype = this.body.archetype;
    switch (this.state) {
      case 'idle':
        this.awareness = stepAwareness(this.awareness, this.sightFactor(current, player, distanceToPlayer), dt);
        if (awarenessLevel(this.awareness) !== 'oblivious') {
          this.state = 'alert';
          break;
        }
        this.joinFreshSighting(current);
        break;
      case 'alert': {
        if (distanceToPlayer > archetype.leashRange) {
          this.giveUp();
          break;
        }
        this.awareness = stepAwareness(this.awareness, this.sightFactor(current, player, distanceToPlayer), dt);
        const level = awarenessLevel(this.awareness);
        if (level === 'detected') {
          this.state = 'chase';
          this.reportSighting(player);
        } else if (level === 'oblivious') {
          this.state = 'idle';
        }
        break;
      }
      case 'chase':
        if (distanceToPlayer > archetype.leashRange) {
          this.giveUp();
        } else if (!this.hasLineOfSightToPlayer && !this.isFlankingBlind()) {
          this.state = 'search';
          this.searchTimer = ENEMY_SEARCH_DURATION;
          this.dropToken();
          this.isKiting = false;
          this.knowledge.reportLost(this.body.id);
        }
        break;
      case 'search':
        if (distanceToPlayer <= archetype.detectionRange && this.hasLineOfSightToPlayer) {
          this.state = 'chase';
          this.awareness = 1;
          this.reportSighting(player);
          break;
        }
        this.awareness = stepAwareness(this.awareness, 0, dt);
        this.followFreshSighting(current);
        this.searchTimer -= dt;
        if (this.searchTimer <= 0) this.state = 'idle';
        break;
    }
  }

  /** Leashed out of range: forget the player entirely and go back to patrolling. Awareness resets
   * too, so a still-full meter cannot bounce the enemy straight back into 'alert'. */
  private giveUp(): void {
    this.state = 'idle';
    this.awareness = 0;
    this.dropToken();
    this.isKiting = false;
    this.knowledge.reportLost(this.body.id);
  }

  /** An idle enemy near a comrade's fresh sighting goes to search there, already suspicious, so it
   * locks on faster once it has its own view. */
  private joinFreshSighting(current: EnemyPosition): void {
    const sighting = this.knowledge.freshSighting(ENEMY_KNOWLEDGE_SHARE_MAX_AGE);
    if (!sighting || horizontalDistance(current, sighting.position) > ENEMY_KNOWLEDGE_SHARE_RADIUS) return;
    this.enterSearchToward(sighting.position, false);
    this.awareness = Math.max(this.awareness, ENEMY_AWARENESS_SUSPICIOUS);
  }

  /** A searching enemy keeps heading for the latest sighting while any comrade still has eyes on
   * the player, and keeps searching for as long as that lasts. */
  private followFreshSighting(current: EnemyPosition): void {
    const sighting = this.knowledge.freshSighting(ENEMY_KNOWLEDGE_SHARE_MAX_AGE);
    if (!sighting || horizontalDistance(current, sighting.position) > ENEMY_KNOWLEDGE_SHARE_RADIUS) return;
    this.searchDestination.copy(sighting.position);
    this.searchTimer = ENEMY_SEARCH_DURATION;
  }

  private updateChase(dt: number, player: Player, current: EnemyPosition, distanceToPlayer: number): void {
    // Kept fresh every frame while chasing so search (entered the instant LOS is lost) beelines
    // for where the player actually was, not a stale position from several frames earlier.
    this.searchDestination.copy(player.position);
    const archetype = this.body.archetype;

    if (distanceToPlayer <= ENEMY_ATTACK_RANGE) {
      // Melee always wins at close range regardless of archetype or role (Phase D's "universal
      // fallback"), so ranged combat/kiting/flanking stand aside entirely at point-blank.
      this.dropToken();
      this.combat.aimHoldTimer = 0;
      this.isKiting = false;
      this.body.faceToward(player.position.x, player.position.z);
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

    if (this.role === 'flanker') {
      this.updateFlank(dt, player, current);
      return;
    }

    if (distanceToPlayer <= archetype.rangedRange && this.hasLineOfSightToPlayer) {
      // Shooters fire; reserves in range hold their ground facing the player until the
      // coordinator gives them a token.
      this.body.faceToward(player.position.x, player.position.z);
      this.updateRangedFiring(dt, player, current, true);
    } else {
      this.dropToken();
      this.combat.aimHoldTimer = 0;
      // Whisker avoidance during chase too (this used to deliberately beeline): a head-height LOS
      // ray can clear past a tree trunk or boulder whose collider still blocks the ground path, so
      // a beelining chaser visibly clipped through trunks.
      this.body.moveToward(player.position.x, player.position.z, archetype.moveSpeed, dt);
    }
  }

  /** The flanker's move: to a point ninety degrees round from the squad's front (the coordinator's
   * combat bearing), on the side the coordinator picked, at a distance set by its own ranged range.
   * It does not fire on the way; once there it faces the player and waits for a shooter token. The
   * target is built from the squad's belief, not the player's true position. */
  private updateFlank(dt: number, player: Player, current: EnemyPosition): void {
    this.dropToken();
    this.combat.aimHoldTimer = 0;
    const target = this.flankPoint(player, current);
    if (horizontalDistance(current, target) > ENEMY_FLANK_ARRIVE_DISTANCE) {
      this.body.moveToward(target.x, target.z, this.body.archetype.moveSpeed, dt);
    } else {
      this.body.faceToward(player.position.x, player.position.z);
    }
  }

  private flankPoint(player: Player, current: EnemyPosition): { x: number; z: number } {
    const threat = this.knowledge.belief?.position ?? player.position;
    const front = this.coordinator.combatBearing ?? Math.atan2(current.x - threat.x, current.z - threat.z);
    const angle = front + (this.coordinator.flankSideOf(this.body.id) * Math.PI) / 2;
    const radius = Math.min(
      ENEMY_FLANK_RADIUS_MAX,
      Math.max(ENEMY_FLANK_RADIUS_MIN, this.body.archetype.rangedRange * ENEMY_FLANK_RADIUS_FRACTION),
    );
    return { x: threat.x + Math.sin(angle) * radius, z: threat.z + Math.cos(angle) * radius };
  }

  /** 'kite' archetypes only (e.g. Ridge Walker) - backs away from the player while continuing to
   * fire (if it holds a shooter token), instead of just standing and shooting. Reuses the
   * patrol/search stuck-detection pattern to abandon a wedged retreat rather than freeze. Aim-error
   * intentionally stays wide the whole time it's moving (see stepRangedFiring's `isStationary`
   * param). Fires from `current` (this tick's pre-move position). */
  private updateKiteRetreat(dt: number, player: Player, current: EnemyPosition): void {
    const next = this.body.retreatFrom(player.position.x, player.position.z, this.body.archetype.moveSpeed, dt);
    if (next) {
      this.updateStuckDetection(dt, next, () => {
        this.isKiting = false;
      });
    }
    this.updateRangedFiring(dt, player, current, false);
  }

  private updateRangedFiring(dt: number, player: Player, current: EnemyPosition, isStationary: boolean): void {
    const archetype = this.body.archetype;
    stepRangedFiring(this.combat, dt, isStationary, archetype, this.role === 'shooter', () =>
      fireRangedShot(this.combat, this.physics, headOf(current), player, archetype, this.body.excludeRigidBody, this.combatHooks),
    );
  }

  private dropToken(): void {
    dropFiringToken(this.combat);
  }

  /** Requires an actual line of sight rather than the flat auto-hit-if-in-range tick melee used to
   * be; the swing itself lives in enemyCombat.ts. */
  private updateMelee(player: Player, current: EnemyPosition): void {
    if (this.attackCooldown > 0 || player.isDead || !this.hasLineOfSightToPlayer) return;
    this.attackCooldown = ENEMY_ATTACK_INTERVAL;
    swingMelee(this.physics, headOf(current), player, this.body.archetype.meleeDamage, this.body.excludeRigidBody);
  }

  /** Picks a fresh destination, moves toward it with whisker obstacle avoidance, and reroutes if
   * either the repath timer expires (destination unreached for too long), the destination is
   * reached, or the enemy is stuck (wedged against something avoidance couldn't solve). */
  private updatePatrol(dt: number, current: EnemyPosition): void {
    this.patrolRepathTimer -= dt;
    const distanceToDestination = horizontalDistance(current, this.patrolDestination);

    if (this.patrolRepathTimer <= 0 || distanceToDestination <= ENEMY_PATROL_STOP_DISTANCE) {
      this.repath();
    }

    if (horizontalDistance(current, this.patrolDestination) > ENEMY_PATROL_STOP_DISTANCE) {
      this.body.moveToward(this.patrolDestination.x, this.patrolDestination.z, ENEMY_PATROL_SPEED, dt);
    }

    this.updateStuckDetection(dt, current);
  }

  /** Beelines the search destination (with the same whisker avoidance as patrol) until close
   * enough to stop, then stands there for whatever's left of ENEMY_SEARCH_DURATION -
   * updateAggroState (not here) owns the timer and the fallback back to idle when it runs out. */
  private updateSearch(dt: number, current: EnemyPosition): void {
    if (horizontalDistance(current, this.searchDestination) > ENEMY_SEARCH_STOP_DISTANCE) {
      this.body.moveToward(this.searchDestination.x, this.searchDestination.z, ENEMY_PATROL_SPEED, dt);
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
  private updateStuckDetection(dt: number, current: EnemyPosition, onStuck: () => void = () => this.repath()): void {
    this.stuckCheckTimer += dt;
    if (this.stuckCheckTimer < ENEMY_STUCK_WINDOW) return;

    const moved = horizontalDistance(current, this.stuckCheckPos);
    if (this.body.isMoving && moved < ENEMY_STUCK_EPSILON) {
      onStuck();
    }
    this.stuckCheckTimer = 0;
    this.stuckCheckPos.set(current.x, current.y, current.z);
  }
}
