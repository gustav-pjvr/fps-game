import type { PlanarPoint } from '../perception.ts';
import type { CoverCandidate, CoverSource } from './coverPoints.ts';
import { ENEMY_HEAD_OFFSET_Y } from '../EnemyBody.ts';
import {
  ENEMY_CHEST_OFFSET_Y,
  ENEMY_HEIGHT,
  ENEMY_TACTICAL_CLAIM_RADIUS,
  ENEMY_TACTICAL_FIRE_LINE_CLEARANCE,
  ENEMY_TACTICAL_HIGH_GROUND_DELTA,
  ENEMY_TACTICAL_MAX_TRAVEL,
  ENEMY_TACTICAL_OPEN_PRIOR,
  ENEMY_TACTICAL_THREAT_CLEARANCE,
  ENEMY_TACTICAL_TRAVEL_WEIGHT,
} from '../../../core/config.ts';

/**
 * Picking where to fight from (enemy AI v2, step 3). The Last of Us post selection, Killzone
 * style scoring: every candidate spot (coverPoints.ts) gets a handful of 0 to 1 scores that
 * multiply, any zero rejects it, and only the best few spend rays to confirm them.
 *
 * Pure: the world is reached only through the injected `heightAt`, `isBlocked` and `probe`, so
 * every rule here is unit-tested without Rapier.
 */

export interface TacticalRequest {
  readonly from: PlanarPoint;
  /** Where the squad believes the player is. */
  readonly threat: PlanarPoint;
  /** Distance band from the threat the firing (peek) spot must fall in. */
  readonly minRange: number;
  readonly maxRange: number;
  /** Reserves: the spot must hide them. */
  readonly requireCover: boolean;
  /** Shooters: the peek spot must have a clear line to the threat. */
  readonly requireLineOfFire: boolean;
  /** Ridge Walkers: a gentle bias toward higher ground than the threat. */
  readonly preferHighGround: boolean;
  /** Spots other enemies stand on or have already picked. */
  readonly claimed: readonly PlanarPoint[];
  /** Other shooters' lines to the threat - never stand in one. */
  readonly fireLines: readonly { readonly from: PlanarPoint; readonly to: PlanarPoint }[];
}

export interface ScoredCandidate extends CoverCandidate {
  readonly score: number;
}

export interface TacticalPick {
  readonly cover: PlanarPoint | null;
  readonly peek: PlanarPoint;
  readonly source: CoverSource;
  readonly score: number;
  /** Confirmed clear line from the peek spot to the threat (only checked when requested). */
  readonly canHit: boolean;
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** True when nothing solid lies between the two points. */
export type LosProbe = (from: WorldPoint, to: WorldPoint) => boolean;

/** Ground-relative heights of an enemy's chest and head (capsule centre is ENEMY_HEIGHT / 2 up). */
export const ENEMY_CHEST_HEIGHT = ENEMY_HEIGHT / 2 + ENEMY_CHEST_OFFSET_Y;
export const ENEMY_HEAD_HEIGHT = ENEMY_HEIGHT / 2 + ENEMY_HEAD_OFFSET_Y;

function distance(a: PlanarPoint, b: PlanarPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Shortest distance from point p to the segment a-b. */
export function pointSegmentDistance(p: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq < 1e-12) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / lengthSq));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

/** Cheap scoring, no rays. Returns the survivors, best first (stable for equal scores). */
export function scoreCandidates(
  request: TacticalRequest,
  candidates: readonly CoverCandidate[],
  heightAt: (x: number, z: number) => number,
  isBlocked: (x: number, z: number) => boolean,
): ScoredCandidate[] {
  const mid = (request.minRange + request.maxRange) / 2;
  const halfBand = Math.max((request.maxRange - request.minRange) / 2, 1e-6);
  // A path may not bring the enemy nearer the threat than THREAT_CLEARANCE - unless it is already
  // nearer, in which case it just may not get any nearer.
  const pathClearance = Math.min(ENEMY_TACTICAL_THREAT_CLEARANCE, distance(request.from, request.threat) - 0.5);
  const threatHeight = request.preferHighGround ? heightAt(request.threat.x, request.threat.z) : 0;

  const scored: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    if (request.requireCover && !candidate.cover) continue;
    const target = candidate.cover ?? candidate.peek;
    if (isBlocked(candidate.peek.x, candidate.peek.z) || (candidate.cover && isBlocked(candidate.cover.x, candidate.cover.z))) continue;

    const range = distance(candidate.peek, request.threat);
    if (range < request.minRange || range > request.maxRange) continue;
    const rangeFit = 1 - 0.5 * Math.min(1, Math.abs(range - mid) / halfBand);

    const travel = distance(request.from, target);
    if (travel > ENEMY_TACTICAL_MAX_TRAVEL) continue;
    const travelScore = 1 - (ENEMY_TACTICAL_TRAVEL_WEIGHT * travel) / ENEMY_TACTICAL_MAX_TRAVEL;

    if (pointSegmentDistance(request.threat, request.from, target) < pathClearance) continue;
    const tooClose = (point: PlanarPoint): boolean => request.claimed.some((claim) => distance(claim, point) < ENEMY_TACTICAL_CLAIM_RADIUS);
    if (tooClose(target) || tooClose(candidate.peek)) continue;
    const inFireLine = (point: PlanarPoint): boolean =>
      request.fireLines.some((line) => pointSegmentDistance(point, line.from, line.to) < ENEMY_TACTICAL_FIRE_LINE_CLEARANCE);
    if (inFireLine(target) || inFireLine(candidate.peek)) continue;

    const prior = candidate.cover ? 1 : ENEMY_TACTICAL_OPEN_PRIOR;
    const highGround = request.preferHighGround
      ? 0.5 +
        0.5 *
          Math.max(-1, Math.min(1, (heightAt(candidate.peek.x, candidate.peek.z) - threatHeight) / ENEMY_TACTICAL_HIGH_GROUND_DELTA))
      : 1;

    const score = rangeFit * travelScore * prior * highGround;
    if (score > 0) scored.push({ ...candidate, score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Confirms candidates best-first with rays until one passes or `allowance` rays are spent: one
 * ray from the threat's eye to the cover spot's chest height (must be blocked), and, for a
 * shooter, one from the peek spot's head height to the threat's eye (must be clear). The first to
 * pass is the pick; nothing passing within the allowance gives null, and the enemy tries again at
 * its next refresh.
 */
export function validateCandidates(
  request: TacticalRequest,
  ranked: readonly ScoredCandidate[],
  probe: LosProbe,
  heightAt: (x: number, z: number) => number,
  threatEyeY: number,
  allowance: number,
): { pick: TacticalPick | null; raysUsed: number } {
  const threatEye = { x: request.threat.x, y: threatEyeY, z: request.threat.z };
  let used = 0;
  for (const candidate of ranked) {
    if (candidate.cover) {
      if (used >= allowance) break;
      used++;
      const coverChest = { x: candidate.cover.x, y: heightAt(candidate.cover.x, candidate.cover.z) + ENEMY_CHEST_HEIGHT, z: candidate.cover.z };
      if (probe(threatEye, coverChest)) continue; // the "cover" spot is in plain view
    }
    let canHit = false;
    if (request.requireLineOfFire) {
      if (used >= allowance) break;
      used++;
      const peekHead = { x: candidate.peek.x, y: heightAt(candidate.peek.x, candidate.peek.z) + ENEMY_HEAD_HEIGHT, z: candidate.peek.z };
      canHit = probe(peekHead, threatEye);
      if (!canHit) continue;
    }
    return {
      pick: { cover: candidate.cover, peek: candidate.peek, source: candidate.source, score: candidate.score, canHit },
      raysUsed: used,
    };
  }
  return { pick: null, raysUsed: used };
}
