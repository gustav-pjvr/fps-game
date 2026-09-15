import type { PlanarPoint } from '../perception.ts';
import type { ObstacleQuery } from './obstacleRegistry.ts';
import { circleCoverCandidates, obstacleCoverCandidates, openCandidates, type CoverCandidate } from './coverPoints.ts';
import { scoreCandidates, validateCandidates, type LosProbe, type TacticalPick, type TacticalRequest } from './tacticalQuery.ts';
import {
  ENEMY_TACTICAL_BAND_FAR_FRACTION,
  ENEMY_TACTICAL_BAND_NEAR_FRACTION,
  ENEMY_TACTICAL_MIN_RANGE,
  ENEMY_TACTICAL_OBSTACLE_RADIUS,
  WATCH_TOWER_HALF_WIDTH,
  WATCH_TOWER_STAIR_WIDTH,
} from '../../../core/config.ts';

/**
 * Glue for one enemy's position pick (enemy AI v2, step 3): gathers candidate spots from the
 * obstacle registry, the watch towers and open ground, scores them (tacticalQuery.ts), and confirms
 * the best with rays. Pure, like everything in tactics/: the world arrives through PlannerWorld.
 */

/** A watch tower's shaft plus its wrap-around stairs, treated as one round obstacle. */
const TOWER_COVER_RADIUS = WATCH_TOWER_HALF_WIDTH + WATCH_TOWER_STAIR_WIDTH;

export interface PickPlan {
  readonly from: PlanarPoint;
  readonly threat: PlanarPoint;
  /** Height of the threat's eye (the squad's belief), for the rays. */
  readonly threatEyeY: number;
  readonly rangedRange: number;
  readonly role: 'shooter' | 'reserve';
  readonly preferHighGround: boolean;
  readonly claimed: readonly PlanarPoint[];
  readonly fireLines: readonly { readonly from: PlanarPoint; readonly to: PlanarPoint }[];
}

export interface PlannerWorld {
  readonly obstacles: ObstacleQuery;
  readonly towers: readonly PlanarPoint[];
  readonly isBlocked: (x: number, z: number) => boolean;
  readonly heightAt: (x: number, z: number) => number;
  readonly probe: LosProbe;
}

/** What EntityManager hands each enemy when its refresh comes up (built once per tick). */
export interface TacticalContext {
  readonly now: number;
  readonly threat: PlanarPoint | null;
  readonly threatEyeY: number;
  readonly world: Omit<PlannerWorld, 'probe'>;
  /** A probe that ignores the player's own capsule and this enemy's own body. */
  probeFor(enemyId: number): LosProbe;
  /** Everyone else's positions and picked spots. */
  claimsFor(enemyId: number): PlanarPoint[];
  /** Every other shooter's line of fire. */
  fireLinesFor(enemyId: number): { from: PlanarPoint; to: PlanarPoint }[];
}

/** The request for this plan: a firing spot between ENEMY_TACTICAL_BAND_NEAR_FRACTION and
 * ENEMY_TACTICAL_BAND_FAR_FRACTION of the enemy's ranged range (never nearer than
 * ENEMY_TACTICAL_MIN_RANGE); a reserve must hide, a shooter must be able to hit. */
export function requestFor(plan: PickPlan): TacticalRequest {
  return {
    from: plan.from,
    threat: plan.threat,
    minRange: Math.max(ENEMY_TACTICAL_MIN_RANGE, plan.rangedRange * ENEMY_TACTICAL_BAND_NEAR_FRACTION),
    maxRange: plan.rangedRange * ENEMY_TACTICAL_BAND_FAR_FRACTION,
    requireCover: plan.role === 'reserve',
    requireLineOfFire: plan.role === 'shooter',
    preferHighGround: plan.preferHighGround,
    claimed: plan.claimed,
    fireLines: plan.fireLines,
  };
}

export function gatherCandidates(plan: PickPlan, world: PlannerWorld, rng: () => number): CoverCandidate[] {
  const candidates: CoverCandidate[] = [];
  for (const obstacle of world.obstacles.near(plan.from.x, plan.from.z, ENEMY_TACTICAL_OBSTACLE_RADIUS)) {
    candidates.push(...obstacleCoverCandidates(obstacle, plan.threat));
  }
  for (const tower of world.towers) {
    if (Math.hypot(tower.x - plan.from.x, tower.z - plan.from.z) > ENEMY_TACTICAL_OBSTACLE_RADIUS + TOWER_COVER_RADIUS) continue;
    candidates.push(...circleCoverCandidates(tower.x, tower.z, TOWER_COVER_RADIUS, plan.threat, 'tower'));
  }
  candidates.push(...openCandidates(plan.from, rng));
  return candidates;
}

export function findPick(
  plan: PickPlan,
  world: PlannerWorld,
  rng: () => number,
  rayAllowance: number,
): { pick: TacticalPick | null; raysUsed: number } {
  const request = requestFor(plan);
  const ranked = scoreCandidates(request, gatherCandidates(plan, world, rng), world.heightAt, world.isBlocked);
  return validateCandidates(request, ranked, world.probe, world.heightAt, plan.threatEyeY, rayAllowance);
}

/** Re-checks a spot the enemy already holds: still in its distance band, still hidden, and (for a
 * shooter) still able to hit - the player may have moved. With too few rays to check properly it
 * keeps the spot (its TTL still bounds how long it is trusted unchecked). */
export function revalidatePick(
  pick: TacticalPick,
  plan: PickPlan,
  world: PlannerWorld,
  rayAllowance: number,
): { valid: boolean; raysUsed: number } {
  const request = requestFor(plan);
  const range = Math.hypot(pick.peek.x - plan.threat.x, pick.peek.z - plan.threat.z);
  if (range < request.minRange || range > request.maxRange) return { valid: false, raysUsed: 0 };
  if (request.requireCover && !pick.cover) return { valid: false, raysUsed: 0 };
  const needed = (pick.cover ? 1 : 0) + (request.requireLineOfFire ? 1 : 0);
  if (rayAllowance < needed) return { valid: true, raysUsed: 0 };
  const result = validateCandidates(
    request,
    [{ cover: pick.cover, peek: pick.peek, source: pick.source, score: pick.score }],
    world.probe,
    world.heightAt,
    plan.threatEyeY,
    rayAllowance,
  );
  return { valid: result.pick !== null, raysUsed: result.raysUsed };
}
