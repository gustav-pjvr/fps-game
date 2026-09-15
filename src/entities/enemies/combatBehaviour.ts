import * as THREE from 'three';
import type { Player } from '../Player.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { perfCounters } from '../../core/perfStats.ts';
import { horizontalDistance } from './enemySteering.ts';
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
import type { CombatCoordinator, CombatRole } from './combatCoordinator.ts';
import type { SquadKnowledge } from './squadKnowledge.ts';
import type { PlanarPoint } from './perception.ts';
import { StuckDetector } from './stuckDetector.ts';
import { findPick, revalidatePick, type PickPlan, type TacticalContext } from './tactics/planner.ts';
import type { CoverSource } from './tactics/coverPoints.ts';
import type { TacticalPick } from './tactics/tacticalQuery.ts';
import {
  ENEMY_ATTACK_INTERVAL,
  ENEMY_ATTACK_RANGE,
  ENEMY_COMBAT_BLIND_GRACE,
  ENEMY_FLANK_ARRIVE_DISTANCE,
  ENEMY_FLANK_RADIUS_FRACTION,
  ENEMY_FLANK_RADIUS_MAX,
  ENEMY_FLANK_RADIUS_MIN,
  ENEMY_PEEK_EXPOSE_TIME,
  ENEMY_PEEK_HIDE_TIME,
  ENEMY_PEEK_STEP_TOLERANCE,
  ENEMY_TACTICAL_ARRIVE_DISTANCE,
  ENEMY_TACTICAL_AVOID_TIME,
  ENEMY_TACTICAL_PICK_TTL,
  ENEMY_TACTICAL_UNREACHABLE_GRACE,
  ENEMY_TACTICAL_UNREACHABLE_TIME_FACTOR,
} from '../../core/config.ts';

export type CoverPhase = 'moving' | 'hiding' | 'peeking';

/** Debug view of an enemy's current spot (window.__gameDebug.getLiveEnemyDebug). */
export interface PickDebug {
  readonly x: number;
  readonly z: number;
  readonly source: CoverSource;
  readonly phase: CoverPhase;
  readonly covered: boolean;
}

interface ActivePick {
  readonly pick: TacticalPick;
  validatedAt: number;
  readonly startedAt: number;
  /** Straight-line walking time to the spot, for the unreachable check. */
  readonly expectedTravel: number;
  phase: CoverPhase;
  phaseTimer: number;
}

/** A spot this enemy could not reach, avoided until `until`. */
interface AvoidedSpot {
  readonly x: number;
  readonly z: number;
  readonly until: number;
}

const MAX_AVOIDED_SPOTS = 4;

function headOf(position: EnemyPosition): THREE.Vector3 {
  return new THREE.Vector3(position.x, position.y + ENEMY_HEAD_OFFSET_Y, position.z);
}

/**
 * What an enemy does in a fight ('chase'), moved out of EnemyBrain in enemy AI v2 step 3 so the
 * brain keeps perception and the state machine while this owns fighting.
 *
 * In order of precedence each tick: melee inside ENEMY_ATTACK_RANGE; a kiter's retreat; the
 * flanker's move (step 2); fighting from a picked spot (step 3); and otherwise the original
 * behaviour - stand and fire when in range with a sightline, or close in.
 *
 * Fighting from a spot: the enemy walks to it, then a shooter alternates between hiding at the
 * cover spot (ENEMY_PEEK_HIDE_TIME) and stepping out to the peek spot to fire
 * (ENEMY_PEEK_EXPOSE_TIME), while a reserve hides and waits for a shooter token. Hiding breaks the
 * sightline, so each peek's first shot is the wide first-shot-grace shot again, like any new
 * engagement. A spot it cannot reach (the walk takes far longer than it should, or it gets stuck)
 * is counted in perfCounters.tacticalPicksUnreachable - the step 7 navmesh trigger - and avoided
 * for ENEMY_TACTICAL_AVOID_TIME.
 */
export class CombatBehaviour {
  private readonly combat: CombatState = createCombatState();
  private attackCooldown = 0;
  /** 'kite' archetypes only - true while backing away from a player that's closed inside
   * kiteTriggerRange; hysteresis (see update) keeps this from flickering at the boundary. */
  private isKiting = false;
  private active: ActivePick | null = null;
  private avoided: AvoidedSpot[] = [];
  private readonly stuck: StuckDetector;

  constructor(
    private readonly body: EnemyBody,
    private readonly physics: PhysicsWorld,
    private readonly coordinator: CombatCoordinator,
    private readonly knowledge: SquadKnowledge,
    private readonly hooks: EnemyCombatHooks,
    private readonly rng: () => number,
    spawnPosition: EnemyPosition,
  ) {
    this.stuck = new StuckDetector(spawnPosition);
  }

  /** The coordinator's role for this enemy. One that has only just entered combat is not on the
   * roster until next tick; it waits as a reserve (or rushes, if melee-only). */
  get role(): CombatRole {
    return this.coordinator.roleOf(this.body.id) ?? (this.body.archetype.rangedRange > 0 ? 'reserve' : 'rusher');
  }

  get canFireFromPosition(): boolean {
    return this.active?.pick.canHit === true;
  }

  get pickDebug(): PickDebug | null {
    const active = this.active;
    if (!active) return null;
    const spot = active.pick.cover ?? active.pick.peek;
    return { x: spot.x, z: spot.z, source: active.pick.source, phase: active.phase, covered: active.pick.cover !== null };
  }

  /** Where this enemy stands and the spot it holds - other enemies keep clear of both. */
  claims(current: EnemyPosition): PlanarPoint[] {
    const points: PlanarPoint[] = [{ x: current.x, z: current.z }];
    if (this.active) {
      if (this.active.pick.cover) points.push(this.active.pick.cover);
      points.push(this.active.pick.peek);
    }
    return points;
  }

  /** Where a shooter's shots start from - other enemies stay out of that line. */
  fireLineStart(current: EnemyPosition): PlanarPoint | null {
    if (this.role !== 'shooter') return null;
    return this.active ? this.active.pick.peek : { x: current.x, z: current.z };
  }

  tickCooldowns(dt: number): void {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
  }

  /** "Flinch" (phase B): a hit while engaged resets the aim-settle timer. */
  onHitWhileEngaged(): void {
    this.combat.aimHoldTimer = 0;
  }

  /** Leaving combat: no token, no retreat, no spot. */
  standDown(): void {
    dropFiringToken(this.combat);
    this.isKiting = false;
    this.active = null;
  }

  dispose(): void {
    dropFiringToken(this.combat);
  }

  /** Stay in the fight without a sightline of its own while flanking or holding a spot, as long as
   * the squad saw the player within ENEMY_COMBAT_BLIND_GRACE. After that everyone searches, so
   * hiding never turns into a stalemate. */
  canFightBlind(): boolean {
    if (this.knowledge.secondsSinceSeen() > ENEMY_COMBAT_BLIND_GRACE) return false;
    return this.role === 'flanker' || this.active !== null;
  }

  wantsPick(): boolean {
    const role = this.role;
    return role === 'shooter' || role === 'reserve';
  }

  /** The scheduler's turn for this enemy: re-check the spot it holds, or find a new one. Returns
   * the rays spent. */
  refreshPick(context: TacticalContext, rayAllowance: number): number {
    const role = this.role;
    if (!context.threat || (role !== 'shooter' && role !== 'reserve')) {
      this.active = null;
      return 0;
    }
    const now = context.now;
    this.avoided = this.avoided.filter((spot) => spot.until > now);
    const current = this.body.position;
    const plan: PickPlan = {
      from: { x: current.x, z: current.z },
      threat: context.threat,
      threatEyeY: context.threatEyeY,
      rangedRange: this.body.archetype.rangedRange,
      role,
      preferHighGround: this.body.archetype.movementStyle === 'kite',
      claimed: [...context.claimsFor(this.body.id), ...this.avoided],
      fireLines: context.fireLinesFor(this.body.id),
    };
    const world = { ...context.world, probe: context.probeFor(this.body.id) };

    let used = 0;
    if (this.active) {
      if (now - this.active.validatedAt <= ENEMY_TACTICAL_PICK_TTL) {
        const check = revalidatePick(this.active.pick, plan, world, rayAllowance);
        used += check.raysUsed;
        if (check.valid) {
          this.active.validatedAt = now;
          return used;
        }
      }
      this.active = null;
    }

    const found = findPick(plan, world, this.rng, rayAllowance - used);
    used += found.raysUsed;
    if (found.pick) {
      const target = found.pick.cover ?? found.pick.peek;
      this.active = {
        pick: found.pick,
        validatedAt: now,
        startedAt: now,
        expectedTravel: horizontalDistance(current, target) / Math.max(0.1, this.body.archetype.moveSpeed),
        phase: 'moving',
        phaseTimer: 0,
      };
      this.stuck.reset(current);
      perfCounters.tacticalPicks += 1;
    }
    return used;
  }

  /** One tick of fighting. `now` is the squad clock. */
  update(dt: number, player: Player, current: EnemyPosition, distanceToPlayer: number, hasLineOfSight: boolean, now: number): void {
    const archetype = this.body.archetype;

    if (distanceToPlayer <= ENEMY_ATTACK_RANGE) {
      // Melee always wins at close range regardless of archetype or role (Phase D's "universal
      // fallback"), so ranged combat, kiting, flanking and cover all stand aside at point-blank.
      this.active = null;
      dropFiringToken(this.combat);
      this.combat.aimHoldTimer = 0;
      this.isKiting = false;
      this.body.faceToward(player.position.x, player.position.z);
      this.updateMelee(player, current, hasLineOfSight);
      return;
    }

    if (archetype.movementStyle === 'kite') {
      if (!this.isKiting && distanceToPlayer < archetype.kiteTriggerRange) {
        this.isKiting = true;
      } else if (this.isKiting && distanceToPlayer >= archetype.kiteStopRange) {
        this.isKiting = false;
      }
      if (this.isKiting && hasLineOfSight) {
        this.active = null;
        this.updateKiteRetreat(dt, player, current, distanceToPlayer, hasLineOfSight);
        return;
      }
    }

    const role = this.role;
    if (role === 'flanker') {
      this.active = null;
      this.updateFlank(dt, player, current);
      return;
    }

    if (this.active && (role === 'shooter' || role === 'reserve')) {
      this.updateFromPick(dt, player, current, distanceToPlayer, hasLineOfSight, role, now);
      return;
    }

    if (distanceToPlayer <= archetype.rangedRange && hasLineOfSight) {
      // No spot yet (or none to be had): shooters fire where they stand, reserves hold their ground
      // facing the player until the coordinator gives them a token.
      this.body.faceToward(player.position.x, player.position.z);
      this.fire(dt, player, current, distanceToPlayer, hasLineOfSight, true);
    } else {
      dropFiringToken(this.combat);
      this.combat.aimHoldTimer = 0;
      // Whisker avoidance during chase too: a head-height LOS ray can clear past a tree trunk or
      // boulder whose collider still blocks the ground path, so a beelining chaser used to clip
      // through trunks.
      this.body.moveToward(player.position.x, player.position.z, archetype.moveSpeed, dt);
    }
  }

  private updateFromPick(
    dt: number,
    player: Player,
    current: EnemyPosition,
    distanceToPlayer: number,
    hasLineOfSight: boolean,
    role: 'shooter' | 'reserve',
    now: number,
  ): void {
    const active = this.active!;
    const home = active.pick.cover ?? active.pick.peek;

    if (active.phase === 'moving') {
      if (horizontalDistance(current, home) > ENEMY_TACTICAL_ARRIVE_DISTANCE) {
        const overdue = now - active.startedAt > ENEMY_TACTICAL_UNREACHABLE_TIME_FACTOR * active.expectedTravel + ENEMY_TACTICAL_UNREACHABLE_GRACE;
        if (overdue) {
          this.abandonUnreachable(home, now);
          return;
        }
        dropFiringToken(this.combat);
        this.combat.aimHoldTimer = 0;
        this.body.moveToward(home.x, home.z, this.body.archetype.moveSpeed, dt);
        if (this.stuck.update(dt, current, this.body.isMoving)) this.abandonUnreachable(home, now);
        return;
      }
      active.phase = active.pick.cover ? 'hiding' : 'peeking';
      active.phaseTimer = active.pick.cover ? ENEMY_PEEK_HIDE_TIME : ENEMY_PEEK_EXPOSE_TIME;
    }

    if (active.phase === 'hiding') {
      dropFiringToken(this.combat);
      this.combat.aimHoldTimer = 0;
      this.holdAt(home, dt, current, player);
      if (role === 'shooter') {
        active.phaseTimer -= dt;
        if (active.phaseTimer <= 0) {
          active.phase = 'peeking';
          active.phaseTimer = ENEMY_PEEK_EXPOSE_TIME;
        }
      }
      return;
    }

    // Peeking: step out to the peek spot and fire from it.
    const peek = active.pick.peek;
    if (horizontalDistance(current, peek) > ENEMY_PEEK_STEP_TOLERANCE) {
      this.body.moveToward(peek.x, peek.z, this.body.archetype.moveSpeed, dt);
      this.fire(dt, player, current, distanceToPlayer, hasLineOfSight, false);
    } else {
      this.body.faceToward(player.position.x, player.position.z);
      this.fire(dt, player, current, distanceToPlayer, hasLineOfSight, true);
    }
    if (active.pick.cover) {
      active.phaseTimer -= dt;
      if (active.phaseTimer <= 0) {
        active.phase = 'hiding';
        active.phaseTimer = ENEMY_PEEK_HIDE_TIME;
      }
    }
  }

  /** Stay on the spot, facing where the squad believes the player is (not the true position - a
   * hidden enemy cannot see the player move). */
  private holdAt(spot: PlanarPoint, dt: number, current: EnemyPosition, player: Player): void {
    if (horizontalDistance(current, spot) > ENEMY_PEEK_STEP_TOLERANCE) {
      this.body.moveToward(spot.x, spot.z, this.body.archetype.moveSpeed, dt);
      return;
    }
    const facing = this.knowledge.belief?.position ?? player.position;
    this.body.faceToward(facing.x, facing.z);
  }

  private abandonUnreachable(spot: PlanarPoint, now: number): void {
    perfCounters.tacticalPicksUnreachable += 1;
    this.avoided.push({ x: spot.x, z: spot.z, until: now + ENEMY_TACTICAL_AVOID_TIME });
    if (this.avoided.length > MAX_AVOIDED_SPOTS) this.avoided.shift();
    this.active = null;
  }

  /** Fires on the shooter token only, with a sightline, inside ranged range. */
  private fire(dt: number, player: Player, current: EnemyPosition, distanceToPlayer: number, hasLineOfSight: boolean, isStationary: boolean): void {
    const archetype = this.body.archetype;
    const canShoot = this.role === 'shooter' && hasLineOfSight && distanceToPlayer <= archetype.rangedRange;
    stepRangedFiring(this.combat, dt, isStationary, archetype, canShoot, () =>
      fireRangedShot(this.combat, this.physics, headOf(current), player, archetype, this.body.excludeRigidBody, this.hooks),
    );
  }

  /** The flanker's move (step 2): to a point ninety degrees round from the squad's front (the
   * coordinator's combat bearing), on the side the coordinator picked, at a distance set by its
   * own ranged range. It does not fire on the way; once there it faces the player and waits for a
   * shooter token. The target is built from the squad's belief, not the player's true position. */
  private updateFlank(dt: number, player: Player, current: EnemyPosition): void {
    dropFiringToken(this.combat);
    this.combat.aimHoldTimer = 0;
    const target = this.flankPoint(player, current);
    if (horizontalDistance(current, target) > ENEMY_FLANK_ARRIVE_DISTANCE) {
      this.body.moveToward(target.x, target.z, this.body.archetype.moveSpeed, dt);
    } else {
      this.body.faceToward(player.position.x, player.position.z);
    }
  }

  private flankPoint(player: Player, current: EnemyPosition): PlanarPoint {
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
   * fire (with a shooter token), instead of just standing and shooting. Gives up the retreat if it
   * gets stuck. Aim error stays wide while moving. Fires from `current` (this tick's pre-move
   * position). */
  private updateKiteRetreat(dt: number, player: Player, current: EnemyPosition, distanceToPlayer: number, hasLineOfSight: boolean): void {
    const next = this.body.retreatFrom(player.position.x, player.position.z, this.body.archetype.moveSpeed, dt);
    if (next && this.stuck.update(dt, next, this.body.isMoving)) this.isKiting = false;
    this.fire(dt, player, current, distanceToPlayer, hasLineOfSight, false);
  }

  /** Requires an actual line of sight rather than the flat auto-hit-if-in-range tick melee used to
   * be; the swing itself lives in enemyCombat.ts. */
  private updateMelee(player: Player, current: EnemyPosition, hasLineOfSight: boolean): void {
    if (this.attackCooldown > 0 || player.isDead || !hasLineOfSight) return;
    this.attackCooldown = ENEMY_ATTACK_INTERVAL;
    swingMelee(this.physics, headOf(current), player, this.body.archetype.meleeDamage, this.body.excludeRigidBody);
  }
}
