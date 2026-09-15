import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Player } from '../Player.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { castHitscan } from '../../combat/hitscan.ts';
import { applySpreadCone } from '../../combat/spread.ts';
import type { EnemyArchetype } from './archetypes.ts';
import type { EngagementSlots } from './engagementSlots.ts';
import {
  ENEMY_ATTACK_RANGE,
  ENEMY_MELEE_SWING_COUNT,
  ENEMY_MELEE_SWING_SPREAD_DEG,
  ENEMY_VELOCITY_AIM_PENALTY_MAX_DEG,
  EYE_OFFSET,
} from '../../core/config.ts';

/** Fired once per enemy hitscan shot (hit or miss) - the game wires this to Tracers/ImpactMarkers/
 * sound, matching how the player's own WeaponManager reports its shots. */
export interface EnemyCombatHooks {
  onRangedShotFired: (origin: THREE.Vector3, end: THREE.Vector3, hitPlayer: boolean) => void;
}

/** Per-enemy firing state, moved out of Enemy.ts by the enemy AI v2 split (commit 0). */
export interface CombatState {
  hasEngagementSlot: boolean;
  aimHoldTimer: number;
  burstShotsFired: number;
  burstCooldown: number;
  /** See stepRangedFiring - forces the next shot to use aimErrorMaxDeg regardless of aimHoldTimer. */
  nextShotIsFirstSinceAcquiring: boolean;
}

export function createCombatState(): CombatState {
  return {
    hasEngagementSlot: false,
    aimHoldTimer: 0,
    burstShotsFired: 0,
    burstCooldown: 0,
    nextShotIsFirstSinceAcquiring: false,
  };
}

/**
 * The aim-error cone's half-angle, in degrees, for the next shot. A real angular cone, not a fixed
 * linear miss distance - it widens with range "for free" (the same angular error covers more
 * lateral distance the farther the target is) and narrows the longer the sightline has held (see
 * aimSettleTime).
 *
 * Fair accuracy model (phase D): a moving player is genuinely harder to hit, not just cosmetically
 * - `playerMovement` is Player.movementBobStrength, the same 0..1 "how much horizontal speed right
 * now" signal WeaponManager already uses for the player's own view-model bob, so a sprinting player
 * gets rewarded for movement and a stationary one doesn't. The first shot after acquiring an
 * engagement slot always uses the archetype's widest error, overriding the settle curve (and the
 * movement term) entirely - getting spotted should never one-tap the player before they've had a
 * chance to react to the tracer warning.
 */
export function aimErrorDeg(
  archetype: EnemyArchetype,
  aimHoldTimer: number,
  isFirstShotSinceAcquiring: boolean,
  playerMovement: number,
): number {
  if (isFirstShotSinceAcquiring) return archetype.aimErrorMaxDeg;
  const holdT = Math.min(1, aimHoldTimer / archetype.aimSettleTime);
  return (
    archetype.aimErrorMaxDeg -
    (archetype.aimErrorMaxDeg - archetype.aimErrorMinDeg) * holdT +
    ENEMY_VELOCITY_AIM_PENALTY_MAX_DEG * playerMovement
  );
}

/**
 * Burst-then-pause firing cadence, gated by `engagementSlots` (ENEMY_MAX_CONCURRENT_ENGAGERS) so
 * not every enemy that spots the player opens fire simultaneously - one that can't get a slot
 * still tracks/faces the player, it just holds fire until one frees up. `fire` is called once per
 * shot this tick decides to take. Movement/facing is the caller's job (stand-and-fire vs.
 * kite-and-fire look different) - this only ever decides when to fire.
 */
export function stepRangedFiring(
  state: CombatState,
  dt: number,
  isStationary: boolean,
  archetype: EnemyArchetype,
  engagementSlots: EngagementSlots,
  enemyId: number,
  fire: () => void,
): void {
  if (!state.hasEngagementSlot) {
    state.hasEngagementSlot = engagementSlots.tryAcquire(enemyId);
    // First-shot grace (phase D): just went from "couldn't fire" to "can fire" - the very next
    // shot always uses the archetype's widest aim error regardless of how long it's actually held
    // the sightline, so getting spotted never one-taps the player before the tracer's own warning
    // has had a chance to register. Cleared the instant that shot actually fires.
    if (state.hasEngagementSlot) state.nextShotIsFirstSinceAcquiring = true;
  }
  if (!state.hasEngagementSlot) {
    state.aimHoldTimer = 0;
    return;
  }

  state.aimHoldTimer = isStationary ? state.aimHoldTimer + dt : 0;
  state.burstCooldown -= dt;
  if (state.burstCooldown > 0) return;

  fire();
  state.burstShotsFired += 1;
  if (state.burstShotsFired >= archetype.burstCount) {
    state.burstShotsFired = 0;
    state.burstCooldown = archetype.burstPause;
  } else {
    state.burstCooldown = archetype.fireInterval;
  }
}

export function releaseEngagementSlot(state: CombatState, engagementSlots: EngagementSlots, enemyId: number): void {
  if (!state.hasEngagementSlot) return;
  engagementSlots.release(enemyId);
  state.hasEngagementSlot = false;
}

/** One real hitscan shot from `origin` (the enemy's head) at the player's eye, through the aim-error
 * cone - a visible tracer per shot (hit or miss) rather than a hidden hit-chance roll (Phase C). */
export function fireRangedShot(
  state: CombatState,
  physics: PhysicsWorld,
  origin: THREE.Vector3,
  player: Player,
  archetype: EnemyArchetype,
  excludeRigidBody: RAPIER.RigidBody,
  hooks: EnemyCombatHooks,
): void {
  const target = player.position.clone();
  target.y += EYE_OFFSET;
  const direction = target.clone().sub(origin).normalize();

  const errorDeg = aimErrorDeg(archetype, state.aimHoldTimer, state.nextShotIsFirstSinceAcquiring, player.movementBobStrength);
  state.nextShotIsFirstSinceAcquiring = false;
  applySpreadCone(direction, THREE.MathUtils.degToRad(errorDeg));

  const maxRange = archetype.rangedRange + 5;
  const hit = castHitscan(physics, origin, direction, maxRange, undefined, excludeRigidBody);
  const tracerEnd = hit ? hit.point : origin.clone().add(direction.multiplyScalar(maxRange));

  const hitPlayer = hit?.colliderHandle === player.ownCollider.handle;
  if (hitPlayer && !player.isDead) {
    player.takeDamage(archetype.rangedDamage);
  }

  hooks.onRangedShotFired(origin, tracerEnd, hitPlayer);
}

/** Universal melee fallback (Phase D) - a real fan-raycast swing mirroring the player's own knife
 * (same spread-by-two-axis-angle technique, ENEMY_MELEE_SWING_COUNT rays instead of one). Can
 * genuinely miss if none of the swing's rays connect - a player hugging the very edge of
 * ENEMY_ATTACK_RANGE isn't guaranteed to get hit just for being in range. Swing mechanics
 * (count/spread/cooldown) stay global across archetypes; only meleeDamage is the identity knob. */
export function swingMelee(
  physics: PhysicsWorld,
  origin: THREE.Vector3,
  player: Player,
  meleeDamage: number,
  excludeRigidBody: RAPIER.RigidBody,
): void {
  const target = player.position.clone();
  target.y += EYE_OFFSET;
  const baseDirection = target.clone().sub(origin).normalize();
  const spreadRad = THREE.MathUtils.degToRad(ENEMY_MELEE_SWING_SPREAD_DEG);
  const maxRange = ENEMY_ATTACK_RANGE + 1;

  for (let i = 0; i < ENEMY_MELEE_SWING_COUNT; i++) {
    const direction = applySpreadCone(baseDirection.clone(), spreadRad);
    const hit = castHitscan(physics, origin, direction, maxRange, undefined, excludeRigidBody);
    if (hit?.colliderHandle === player.ownCollider.handle) {
      player.takeDamage(meleeDamage);
      return;
    }
  }
}
