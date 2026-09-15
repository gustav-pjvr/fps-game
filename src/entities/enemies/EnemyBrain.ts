import * as THREE from 'three';
import type { Player } from '../Player.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { hasLineOfSight, horizontalDistance, pickPatrolDestination } from './enemySteering.ts';
import type { EngagementSlots } from './engagementSlots.ts';
import { ENEMY_HEAD_OFFSET_Y, type EnemyBody, type EnemyPosition } from './EnemyBody.ts';
import {
  createCombatState,
  fireRangedShot,
  releaseEngagementSlot,
  stepRangedFiring,
  swingMelee,
  type CombatState,
  type EnemyCombatHooks,
} from './enemyCombat.ts';
import {
  ENEMY_ALERT_REACTION_TIME,
  ENEMY_ATTACK_INTERVAL,
  ENEMY_ATTACK_RANGE,
  ENEMY_DEATH_ALERT_RADIUS,
  ENEMY_HEARING_RANGE,
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

function headOf(position: EnemyPosition): THREE.Vector3 {
  return new THREE.Vector3(position.x, position.y + ENEMY_HEAD_OFFSET_Y, position.z);
}

/**
 * The enemy's decision logic, moved verbatim out of Enemy.ts by the enemy AI v2 split (commit 0 in
 * docs/enemy-ai-v2-design.md). It drives an EnemyBody and never touches colliders, the model or
 * animation directly.
 *
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
 * Getting further than the archetype's leashRange away from any of alert/chase/search always drops
 * straight back to idle (a wider radius than detection, so it doesn't flicker right at the
 * detection boundary).
 *
 * Chase itself (Phase C): beyond ENEMY_ATTACK_RANGE, closes distance until within the archetype's
 * rangedRange with a clear sightline, then stands (or, for a 'kite' archetype, backs away - see
 * updateKiteRetreat) and fires real hitscan shots with a visible tracer and a narrowing angular
 * aim-error cone (enemyCombat.ts). Within ENEMY_ATTACK_RANGE, melee always wins regardless of
 * archetype (the "universal fallback" from the design doc) - a real fan-raycast swing (Phase D).
 */
export class EnemyBrain {
  private state: EnemyState = 'idle';
  private readonly spawnPosition: THREE.Vector3;
  private patrolDestination: THREE.Vector3;
  private patrolRepathTimer = 0;
  private stuckCheckTimer = 0;
  private readonly stuckCheckPos: THREE.Vector3;
  private alertTimer = 0;
  private searchTimer = 0;
  private readonly searchDestination: THREE.Vector3;
  /** Throttled (ENEMY_LOS_CHECK_INTERVAL), not recomputed every frame - a raycast per enemy per
   * frame adds up once several are chasing at once. Randomized initial offset so many enemies'
   * checks don't all land on the same frame. */
  private losCheckTimer: number;
  private hasLineOfSightToPlayer = false;
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
    private readonly engagementSlots: EngagementSlots,
    private readonly combatHooks: EnemyCombatHooks,
    private readonly patrolRng: () => number,
    spawnPosition: THREE.Vector3,
  ) {
    this.spawnPosition = spawnPosition.clone();
    this.patrolDestination = spawnPosition.clone();
    this.stuckCheckPos = spawnPosition.clone();
    this.searchDestination = spawnPosition.clone();
    this.losCheckTimer = this.patrolRng() * ENEMY_LOS_CHECK_INTERVAL;
  }

  get currentState(): EnemyState {
    return this.state;
  }

  /** A non-lethal hit - the shell has already applied the damage.
   *
   * Threat perception (2026-07-10 review, phase A): being shot is unambiguous - no detection range
   * or line-of-sight gate, unlike spotting the player normally. An idle/patrolling enemy
   * immediately searches toward roughly where the shot came from instead of continuing to patrol
   * while taking hits, which used to be the dominant "aimless bot" symptom (the player's weapons
   * out-range every archetype's own detectionRange several times over). Already-aware enemies
   * (alert/chase/search) don't need this - they already know where the player is. */
  onDamaged(sourcePosition?: THREE.Vector3): void {
    if (sourcePosition && (this.state === 'idle' || this.state === 'search')) {
      this.enterSearchToward(sourcePosition, true);
      return;
    }
    // "Flinch" (phase B, light version): a hit while already engaged resets the aim-settle timer,
    // so return fire visibly suppresses instead of a hit-while-firing enemy shrugging it off with
    // undiminished accuracy on its very next shot.
    if (this.state === 'chase') this.combat.aimHoldTimer = 0;
  }

  /** A player gunshot landed within ENEMY_HEARING_RANGE - alerts this enemy toward the shot's
   * origin if it's currently oblivious (idle). No-op for anything already aware (alert/chase/
   * search - hearing another shot tells it nothing new). */
  onHeardGunshot(origin: THREE.Vector3): void {
    if (this.state !== 'idle') return;
    if (horizontalDistance(this.body.position, origin) > ENEMY_HEARING_RANGE) return;
    this.enterSearchToward(origin, true);
  }

  /** A comrade died within ENEMY_DEATH_ALERT_RADIUS and this enemy has line-of-sight to the corpse
   * - the cheapest possible squad-awareness cue. Only fires for a currently-oblivious (idle) enemy,
   * same reasoning as onHeardGunshot. */
  onNearbyDeath(deathPosition: THREE.Vector3, killerPosition: THREE.Vector3): void {
    if (this.state !== 'idle') return;
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
      // Skip the raycast entirely once the player's already out of leash range - no state this
      // frame could care about LOS at that distance anyway.
      this.hasLineOfSightToPlayer =
        distanceToPlayer <= this.body.archetype.leashRange && this.computeLineOfSight(current, player);
    }

    this.updateAggroState(dt, distanceToPlayer);

    switch (this.state) {
      case 'chase':
        this.updateChase(dt, player, current, distanceToPlayer);
        break;
      case 'search':
        this.updateSearch(dt, current);
        break;
      case 'alert':
        this.body.faceToward(player.position.x, player.position.z);
        break;
      default:
        this.updatePatrol(dt, current);
    }
  }

  /** Releases this enemy's firing slot - called from the shell's dispose. */
  dispose(): void {
    this.releaseSlot();
  }

  /** Shared by onDamaged/onHeardGunshot (a fuzzy estimate, `withError=true`) and onNearbyDeath (an
   * exact corpse position, `withError=false`) - beelines the given point for ENEMY_SEARCH_DURATION,
   * same as losing sight of the player mid-chase. */
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

  private computeLineOfSight(current: EnemyPosition, player: Player): boolean {
    const to = player.position.clone();
    to.y += EYE_OFFSET;
    return hasLineOfSight(this.physics, headOf(current), to, this.body.excludeRigidBody, player.ownCollider.handle);
  }

  /** Pure state transitions - no movement here, so the switch in update() always sees this frame's
   * already-resolved state (matches the immediate-use pattern the old idle/chase check had). */
  private updateAggroState(dt: number, distanceToPlayer: number): void {
    const archetype = this.body.archetype;
    switch (this.state) {
      case 'idle':
        if (distanceToPlayer <= archetype.detectionRange && this.hasLineOfSightToPlayer) {
          this.state = 'alert';
          this.alertTimer = ENEMY_ALERT_REACTION_TIME;
        }
        break;
      case 'alert':
        if (distanceToPlayer > archetype.leashRange || !this.hasLineOfSightToPlayer) {
          this.state = 'idle';
          break;
        }
        this.alertTimer -= dt;
        if (this.alertTimer <= 0) this.state = 'chase';
        break;
      case 'chase':
        if (distanceToPlayer > archetype.leashRange) {
          this.state = 'idle';
          this.releaseSlot();
          this.isKiting = false;
        } else if (!this.hasLineOfSightToPlayer) {
          this.state = 'search';
          this.searchTimer = ENEMY_SEARCH_DURATION;
          this.releaseSlot();
          this.isKiting = false;
        }
        break;
      case 'search':
        if (distanceToPlayer <= archetype.detectionRange && this.hasLineOfSightToPlayer) {
          this.state = 'chase';
          break;
        }
        this.searchTimer -= dt;
        if (this.searchTimer <= 0) this.state = 'idle';
        break;
    }
  }

  private updateChase(dt: number, player: Player, current: EnemyPosition, distanceToPlayer: number): void {
    // Kept fresh every frame while chasing so search (entered the instant LOS is lost) beelines
    // for where the player actually was, not a stale position from several frames earlier.
    this.searchDestination.copy(player.position);
    const archetype = this.body.archetype;

    if (distanceToPlayer <= ENEMY_ATTACK_RANGE) {
      // Melee always wins at close range regardless of archetype (Phase D's "universal fallback"),
      // so ranged combat/kiting stand aside entirely here rather than also acting at point-blank.
      this.releaseSlot();
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

    if (distanceToPlayer <= archetype.rangedRange && this.hasLineOfSightToPlayer) {
      this.body.faceToward(player.position.x, player.position.z);
      this.updateRangedFiring(dt, player, current, true);
    } else {
      this.releaseSlot();
      this.combat.aimHoldTimer = 0;
      // Whisker avoidance during chase too (this used to deliberately beeline): a head-height LOS
      // ray can clear past a tree trunk or boulder whose collider still blocks the ground path, so
      // a beelining chaser visibly clipped through trunks - the most player-visible AI artifact in
      // the codebase. Costs 3 short raycasts per chasing (not yet firing) enemy per frame, same as
      // patrol/search/kite movement already pays.
      this.body.moveToward(player.position.x, player.position.z, archetype.moveSpeed, dt);
    }
  }

  /** 'kite' archetypes only (e.g. Ridge Walker) - backs away from the player while continuing to
   * fire, instead of just standing and shooting. Reuses the patrol/search stuck-detection pattern
   * (same timer/pos fields, since patrol and chase never run in the same frame) to abandon a wedged
   * retreat rather than freeze - standing and firing in place until distance re-arms kiting is a
   * perfectly fine fallback. Aim-error intentionally stays wide the whole time it's moving (see
   * stepRangedFiring's `isStationary` param) - a sniper on the move shouldn't shoot as accurately
   * as one holding still. Fires from `current` (this tick's pre-move position), as before the split. */
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
    stepRangedFiring(this.combat, dt, isStationary, archetype, this.engagementSlots, this.body.id, () =>
      fireRangedShot(this.combat, this.physics, headOf(current), player, archetype, this.body.excludeRigidBody, this.combatHooks),
    );
  }

  private releaseSlot(): void {
    releaseEngagementSlot(this.combat, this.engagementSlots, this.body.id);
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

  /** Beelines the last-seen player position (with the same whisker avoidance as patrol) until
   * close enough to stop, then just stands there for whatever's left of ENEMY_SEARCH_DURATION -
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
