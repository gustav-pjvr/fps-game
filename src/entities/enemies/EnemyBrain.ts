import * as THREE from 'three';
import type { Player } from '../Player.ts';
import { visibilityForEnemy, type PlayerVisibility } from './playerVisibility.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { hasLineOfSight, horizontalDistance, pickPatrolDestination } from './enemySteering.ts';
import { ENEMY_HEAD_OFFSET_Y, type EnemyBody, type EnemyPosition } from './EnemyBody.ts';
import { fireWideShot, type EnemyCombatHooks } from './enemyCombat.ts';
import { FlashBlindState } from './flashBlind.ts';
import type { CombatCoordinator, CombatRole, RoleCandidate } from './combatCoordinator.ts';
import { CombatBehaviour, type PickDebug } from './combatBehaviour.ts';
import { awarenessLevel, hearingRangeFor, isInViewCone, sightRayRange, stepAwareness, visibilityFactor, type PlanarPoint } from './perception.ts';
import type { SquadKnowledge } from './squadKnowledge.ts';
import type { IntentKind, IntentSink } from './calloutDirector.ts';
import { StuckDetector } from './stuckDetector.ts';
import type { TacticalContext } from './tactics/planner.ts';
import {
  ENEMY_AWARENESS_SUSPICIOUS,
  ENEMY_COMBAT_BLIND_GRACE,
  ENEMY_DEATH_ALERT_RADIUS,
  ENEMY_FLASH_FIRE_SPREAD_DEG,
  ENEMY_KNOWLEDGE_SHARE_MAX_AGE,
  ENEMY_KNOWLEDGE_SHARE_RADIUS,
  ENEMY_LOS_CHECK_INTERVAL,
  ENEMY_PATROL_REPATH_MAX,
  ENEMY_PATROL_REPATH_MIN,
  ENEMY_PATROL_SPEED,
  ENEMY_PATROL_STOP_DISTANCE,
  ENEMY_SEARCH_DURATION,
  ENEMY_SEARCH_STOP_DISTANCE,
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
  /** The spot it is fighting from, if any (step 3). */
  readonly pick: PickDebug | null;
  /** The search-grid cell it has been sent to, while searching (step 4). */
  readonly searchTarget: PlanarPoint | null;
  /** Knocked off balance by a heavy hit right now (step 5). */
  readonly staggered: boolean;
  /** Seconds of flash-grenade blindness left (0 when it can see). */
  readonly blindSeconds: number;
}

function headOf(position: EnemyPosition): THREE.Vector3 {
  return new THREE.Vector3(position.x, position.y + ENEMY_HEAD_OFFSET_Y, position.z);
}

/**
 * The enemy's decision logic (split out of Enemy.ts by enemy AI v2 commit 0): perception, the
 * state machine, patrol and search. Fighting itself ('chase') is CombatBehaviour's (step 3). It
 * drives an EnemyBody and never touches colliders, the model or animation directly.
 *
 * Idle: patrols real destinations across ENEMY_ROAM_RADIUS of its spawn point (biased toward
 * town/forest content - see enemySteering.ts), with whisker obstacle avoidance and
 * stuck-detection reroute standing in for real pathfinding.
 *
 * Spotting (step 1, perception.ts): an awareness meter fills while the enemy has a clear sightline
 * to a player inside its view cone and detection range (faster up close and for a moving player)
 * and drains otherwise. Suspicious (ENEMY_AWARENESS_SUSPICIOUS) is the 'alert' state - stop and
 * face where the player was last seen; a full meter is 'chase'. Sight lines are throttled to one
 * ray per ENEMY_LOS_CHECK_INTERVAL, and an oblivious enemy that is not facing the player skips the
 * ray.
 *
 * Squad knowledge (step 1, squadKnowledge.ts): a chasing enemy reports what it sees to the whole
 * squad. An idle enemy within ENEMY_KNOWLEDGE_SHARE_RADIUS of a fresh sighting goes to search
 * there, and a searching one keeps following the latest sighting.
 *
 * Losing sight mid-chase drops to search - unless the enemy is flanking or holding a picked spot
 * and the squad saw the player within ENEMY_COMBAT_BLIND_GRACE (CombatBehaviour.canFightBlind).
 * Search beelines the last known position for ENEMY_SEARCH_DURATION before giving up back to idle.
 * Getting further than the archetype's leashRange away from any of alert/chase always drops
 * straight back to idle.
 */
export class EnemyBrain {
  private state: EnemyState = 'idle';
  private readonly spawnPosition: THREE.Vector3;
  private patrolDestination: THREE.Vector3;
  private patrolRepathTimer = 0;
  private readonly patrolStuck: StuckDetector;
  private searchTimer = 0;
  private readonly searchDestination: THREE.Vector3;
  /** The squad search grid's latest cell for this enemy (step 4), or null for a plain search. */
  private searchTarget: PlanarPoint | null = null;
  /** Where this enemy itself last had the player in sight - what an 'alert' enemy stares at. */
  private readonly lastSeenPosition: THREE.Vector3;
  /** Throttled (ENEMY_LOS_CHECK_INTERVAL), not recomputed every frame - a raycast per enemy per
   * frame adds up once several are chasing at once. Randomized initial offset so many enemies'
   * checks don't all land on the same frame. */
  private losCheckTimer: number;
  private hasLineOfSightToPlayer = false;
  /** 0 (oblivious) to 1 (detected) - see perception.ts. */
  private awareness = 0;
  private playerVisibility = 1;
  private readonly combat: CombatBehaviour;
  /** Grenades: blinded by a flash (flashBlind.ts). */
  private readonly flashBlind = new FlashBlindState();
  private readonly combatHooks: EnemyCombatHooks;

  /** `patrolRng` is a seeded per-enemy stream (EntityManager derives it from the world seed and
   * spawn order) - patrol destinations, repath timers, and the LOS-check phase offset all draw
   * from it, so a given world seed reproduces the same pre-aggro AI behavior exactly. `tacticsRng`
   * is a second seeded stream for position picking. Combat spread (aim error, melee swing fan)
   * deliberately stays on Math.random, matching the player's own non-deterministic weapon spread. */
  constructor(
    private readonly body: EnemyBody,
    private readonly physics: PhysicsWorld,
    private readonly coordinator: CombatCoordinator,
    private readonly knowledge: SquadKnowledge,
    private readonly intents: IntentSink,
    combatHooks: EnemyCombatHooks,
    private readonly patrolRng: () => number,
    tacticsRng: () => number,
    spawnPosition: THREE.Vector3,
  ) {
    this.spawnPosition = spawnPosition.clone();
    this.patrolDestination = spawnPosition.clone();
    this.searchDestination = spawnPosition.clone();
    this.lastSeenPosition = spawnPosition.clone();
    this.patrolStuck = new StuckDetector(spawnPosition);
    this.combat = new CombatBehaviour(body, physics, coordinator, knowledge, intents, combatHooks, tacticsRng, spawnPosition);
    this.combatHooks = combatHooks;
    this.losCheckTimer = this.patrolRng() * ENEMY_LOS_CHECK_INTERVAL;
  }

  get currentState(): EnemyState {
    return this.state;
  }

  get debug(): EnemyBrainDebug {
    const inCombat = this.state === 'chase';
    return {
      state: this.state,
      awareness: this.awareness,
      hasLineOfSight: this.hasLineOfSightToPlayer,
      role: inCombat ? this.combat.role : null,
      pick: inCombat ? this.combat.pickDebug : null,
      searchTarget: this.state === 'search' ? this.searchTarget : null,
      staggered: this.combat.isStaggered,
      blindSeconds: this.flashBlind.secondsLeft,
    };
  }

  /** 0 to 1, how far a heavy hit has knocked it off balance (the shell tips the model back). */
  get lurch(): number {
    return this.combat.staggerLurch;
  }

  /** For the squad's search grid (step 4): this enemy, if it is searching. */
  searchCandidate(): { id: number; x: number; z: number; yaw: number } | null {
    if (this.state !== 'search') return null;
    const position = this.body.position;
    return { id: this.body.id, x: position.x, z: position.z, yaw: this.body.facingYaw };
  }

  /** The squad's search grid sends this searcher to a cell. It keeps searching for as long as it
   * keeps getting cells, instead of giving up after ENEMY_SEARCH_DURATION at one spot. */
  assignSearchTarget(x: number, z: number): void {
    if (this.state !== 'search') return;
    this.searchDestination.set(x, this.searchDestination.y, z);
    this.searchTarget = { x, z };
    this.searchTimer = ENEMY_SEARCH_DURATION;
  }

  /** What the coordinator needs to know about this enemy, or null when it is not in combat. Read
   * once per tick, before any enemy moves, so the roster reflects last tick's positions. An enemy
   * hiding at a spot whose peek can hit still counts as having a sightline while the squad saw the
   * player recently, so it keeps its shooter token between peeks. */
  combatCandidate(): RoleCandidate | null {
    if (this.state !== 'chase') return null;
    const position = this.body.position;
    const rangedRange = this.body.archetype.rangedRange;
    const canFireFromSpot = this.combat.canFireFromPosition && this.knowledge.secondsSinceSeen() <= ENEMY_COMBAT_BLIND_GRACE;
    return {
      id: this.body.id,
      x: position.x,
      z: position.z,
      canShoot: rangedRange > 0,
      rangedRange,
      hasLineOfSight: this.hasLineOfSightToPlayer || canFireFromSpot,
    };
  }

  /** Whether this enemy wants a position pick this tick (step 3): in combat as a shooter or
   * reserve. */
  wantsTacticalPick(): boolean {
    return this.state === 'chase' && this.combat.wantsPick();
  }

  /** The tactical scheduler's turn for this enemy; returns rays spent. */
  refreshTacticalPick(context: TacticalContext, rayAllowance: number): number {
    return this.state === 'chase' ? this.combat.refreshPick(context, rayAllowance) : 0;
  }

  /** Where this enemy stands and the spot it holds, so others keep clear. */
  tacticalClaims(): PlanarPoint[] {
    return this.combat.claims(this.body.position);
  }

  /** Where this enemy's shots start from, if it is a shooter in combat. */
  fireLineStart(): PlanarPoint | null {
    return this.state === 'chase' ? this.combat.fireLineStart(this.body.position) : null;
  }

  /** A non-lethal hit - the shell has already applied the damage.
   *
   * Threat perception (2026-07-10 review, phase A): being shot is unambiguous - no detection range
   * or line-of-sight gate, unlike spotting the player normally. An idle, suspicious ('alert') or
   * searching enemy immediately searches toward roughly where the shot came from, and that rough
   * guess becomes squad knowledge. A chasing enemy already knows where the player is; the hit
   * resets its aim instead ("flinch"). */
  onDamaged(sourcePosition?: THREE.Vector3, amount = 0): void {
    this.combat.onHeavyHit(amount);
    if (sourcePosition && this.state !== 'chase') {
      this.enterSearchToward(sourcePosition, true);
      this.awareness = Math.max(this.awareness, ENEMY_AWARENESS_SUSPICIOUS);
      this.knowledge.reportDamage(this.searchDestination);
      return;
    }
    if (this.state === 'chase') this.combat.onHitWhileEngaged();
  }

  /** A player gunshot. Heard only within that weapon's loudness range (perception.ts's
   * hearingRangeFor - a pistol carries less far than a sniper). An idle enemy searches toward
   * roughly where it came from; a searching one takes the fresh evidence too. Engaged enemies
   * (alert/chase) learn nothing new from it, and neither does a flash-blinded one (the blindness
   * decides what it does next; a flash's own bang reaches it after onFlashed). */
  onHeardGunshot(origin: THREE.Vector3, weaponId?: string): void {
    if (this.flashBlind.active) return;
    if (this.state !== 'idle' && this.state !== 'search') return;
    if (horizontalDistance(this.body.position, origin) > hearingRangeFor(weaponId)) return;
    this.enterSearchToward(origin, true);
    this.awareness = Math.max(this.awareness, ENEMY_AWARENESS_SUSPICIOUS);
  }

  /** Blinded by a flash grenade for `seconds` (grenades): it loses its target and its awareness
   * and staggers; then, if it had a target, it stands firing wide at where it last saw the player
   * until it can see again (updateBlind), and searches there after. One that never had a target
   * (idle: nothing seen, nothing heard, last-seen is still its spawn point) only stands blind, then
   * goes back to its patrol. */
  onFlashed(seconds: number): void {
    if (!(seconds > 0)) return;
    const hadTarget = this.state !== 'idle';
    if (this.state === 'chase') {
      this.combat.standDown();
      this.knowledge.reportLost(this.body.id);
    }
    this.combat.onHeavyHit(Number.POSITIVE_INFINITY);
    this.awareness = 0;
    this.hasLineOfSightToPlayer = false;
    this.flashBlind.blind(seconds, hadTarget);
    if (hadTarget) this.enterSearchToward(this.lastSeenPosition, false);
  }

  /** Sent in by the pacing director (step 6): a reinforcement comes looking for the player, roughly
   * toward where they are and already suspicious, instead of patrolling where it arrived. */
  dispatchToward(position: THREE.Vector3): void {
    if (this.state !== 'idle' && this.state !== 'search') return;
    this.enterSearchToward(position, true);
    this.awareness = Math.max(this.awareness, ENEMY_AWARENESS_SUSPICIOUS);
  }

  /** A comrade died within ENEMY_DEATH_ALERT_RADIUS and this enemy has line-of-sight to the corpse
   * - it searches toward the killer. Idle or searching enemies only. (EntityManager reports the
   * death to squad knowledge once, not per enemy.) */
  onNearbyDeath(deathPosition: THREE.Vector3, killerPosition: THREE.Vector3): void {
    if (this.state !== 'idle' && this.state !== 'search') return;
    const current = this.body.position;
    if (horizontalDistance(current, deathPosition) > ENEMY_DEATH_ALERT_RADIUS) return;
    if (!hasLineOfSight(this.physics, headOf(current), deathPosition, this.body.excludeRigidBody, -1)) return;
    this.enterSearchToward(killerPosition, false);
  }

  update(dt: number, player: Player, visibility?: PlayerVisibility): void {
    this.combat.tickCooldowns(dt);
    if (this.flashBlind.active) {
      this.updateBlind(dt, player);
      return;
    }

    const current = this.body.position;
    this.playerVisibility = visibility ? visibilityForEnemy(visibility, headOf(current)) : 1;
    const distanceToPlayer = horizontalDistance(current, player.position);

    this.losCheckTimer -= dt;
    if (this.losCheckTimer <= 0) {
      this.losCheckTimer = ENEMY_LOS_CHECK_INTERVAL;
      // No ray beyond the visible detection range while acquiring (leash range once engaged), nor
      // for an oblivious enemy facing the other way - it could not start noticing the player anyway.
      const archetype = this.body.archetype;
      const engaged = this.state === 'alert' || this.state === 'chase';
      this.hasLineOfSightToPlayer =
        distanceToPlayer <= sightRayRange(engaged, archetype.detectionRange, archetype.leashRange, this.playerVisibility) &&
        this.isWorthLooking(current, player) &&
        this.computeLineOfSight(current, player);
      if (this.hasLineOfSightToPlayer) this.lastSeenPosition.copy(player.position);
      if (this.state === 'chase') this.reportSighting(player);
    }

    this.updateAggroState(dt, current, player, distanceToPlayer);

    // A staggered enemy stays where it is until it recovers (step 5); perception carries on.
    if (this.combat.isStaggered) return;

    switch (this.state) {
      case 'chase':
        // Kept fresh while chasing so search (entered the instant the fight is lost) heads for
        // where the player was last known: seen directly, or through the squad while blind.
        this.searchDestination.copy(this.hasLineOfSightToPlayer ? player.position : (this.knowledge.belief?.position ?? player.position));
        this.combat.update(dt, player, current, distanceToPlayer, this.hasLineOfSightToPlayer, this.knowledge.now);
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

  /** Flash-blinded: no perception and no moving. Once the stagger ends it faces where it last saw
   * the player and, with a gun and a target before the flash, fires wide there. The search toward
   * that spot starts in full when it can see again. */
  private updateBlind(dt: number, player: Player): void {
    const archetype = this.body.archetype;
    const fire = this.flashBlind.update(dt, archetype.rangedRange > 0 && !this.combat.isStaggered);
    this.awareness = 0;
    this.hasLineOfSightToPlayer = false;
    this.searchTimer = ENEMY_SEARCH_DURATION;
    if (this.combat.isStaggered) return;
    if (!this.flashBlind.firingBack) return;
    this.body.faceToward(this.lastSeenPosition.x, this.lastSeenPosition.z);
    if (!fire) return;
    const target = this.lastSeenPosition.clone();
    target.y += EYE_OFFSET;
    fireWideShot(this.physics, headOf(this.body.position), target, ENEMY_FLASH_FIRE_SPREAD_DEG, player, archetype, this.body.excludeRigidBody, this.combatHooks);
    this.body.onFired?.();
  }

  /** Gives up this enemy's role and its place among the squad's watchers - called from the shell's
   * dispose. */
  dispose(): void {
    this.combat.dispose();
    this.coordinator.release(this.body.id);
    this.knowledge.forget(this.body.id);
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
    this.searchTarget = null;
  }

  /** An oblivious enemy only spends a sight ray on a player inside its view cone; once it is
   * suspicious or engaged it keeps looking wherever the player is. */
  private isWorthLooking(current: EnemyPosition, player: Player): boolean {
    if (this.state !== 'idle' || this.awareness > 0) return true;
    return isInViewCone(current, this.body.facingYaw, player.position, this.body.archetype.detectionRange * this.playerVisibility);
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
    const detectionRange = this.body.archetype.detectionRange * this.playerVisibility;
    if (!isInViewCone(current, this.body.facingYaw, player.position, detectionRange)) return 0;
    return visibilityFactor(distanceToPlayer, detectionRange, player.movementBobStrength) * this.playerVisibility;
  }

  /** Tells the squad's callout director what this enemy just did (step 5). */
  private announce(kind: IntentKind): void {
    const position = this.body.position;
    this.intents.emit({ kind, enemyId: this.body.id, x: position.x, y: position.y + ENEMY_HEAD_OFFSET_Y, z: position.z });
  }

  /** A chasing enemy's view of the player is the squad's. */
  private reportSighting(player: Player): void {
    if (this.hasLineOfSightToPlayer) this.knowledge.reportSeen(this.body.id, player.position);
    else this.knowledge.reportLost(this.body.id);
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
          this.announce('spotted');
        } else if (level === 'oblivious') {
          this.state = 'idle';
        }
        break;
      }
      case 'chase':
        if (distanceToPlayer > archetype.leashRange) {
          this.giveUp();
        } else if (!this.hasLineOfSightToPlayer && !this.combat.canFightBlind()) {
          this.state = 'search';
          this.searchTimer = ENEMY_SEARCH_DURATION;
          this.combat.standDown();
          this.knowledge.reportLost(this.body.id);
        }
        break;
      case 'search':
        if (distanceToPlayer <= archetype.detectionRange * this.playerVisibility && this.hasLineOfSightToPlayer) {
          this.state = 'chase';
          this.awareness = 1;
          this.reportSighting(player);
          this.announce('spotted');
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
    this.combat.standDown();
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

    if (this.patrolStuck.update(dt, current, this.body.isMoving)) this.repath();
  }

  /** Beelines the search destination (with the same whisker avoidance as patrol) until close
   * enough to stop, then stands there for whatever's left of ENEMY_SEARCH_DURATION -
   * updateAggroState (not here) owns the timer and the fallback back to idle when it runs out. */
  private updateSearch(dt: number, current: EnemyPosition): void {
    if (horizontalDistance(current, this.searchDestination) > ENEMY_SEARCH_STOP_DISTANCE) {
      this.body.moveToward(this.searchDestination.x, this.searchDestination.z, ENEMY_PATROL_SPEED, dt);
    }
  }

  /** Test-only (via Enemy.debugPlace): makes (x, z) this enemy's patrol home, as if it had spawned
   * there, so a staged layout stays staged instead of the enemy walking back to where it spawned. */
  rehome(x: number, z: number): void {
    this.spawnPosition.set(x, this.spawnPosition.y, z);
    this.patrolStuck.reset(this.body.position);
    this.repath();
  }

  private repath(): void {
    this.patrolDestination = pickPatrolDestination(this.spawnPosition, this.patrolRng);
    this.patrolRepathTimer = ENEMY_PATROL_REPATH_MIN + this.patrolRng() * (ENEMY_PATROL_REPATH_MAX - ENEMY_PATROL_REPATH_MIN);
  }
}
