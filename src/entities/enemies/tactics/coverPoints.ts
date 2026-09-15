import type { HouseFootprint } from '../../../world/buildingColliders.ts';
import type { PlanarPoint } from '../perception.ts';
import type { Obstacle } from './obstacleRegistry.ts';
import {
  ENEMY_COVER_FACE_INSET,
  ENEMY_COVER_FACE_MIN_DOT,
  ENEMY_COVER_MARGIN,
  ENEMY_RADIUS,
  ENEMY_TACTICAL_OPEN_RADII,
  ENEMY_TACTICAL_OPEN_SAMPLES,
} from '../../../core/config.ts';

/**
 * Candidate spots for an enemy to fight from (enemy AI v2, step 3). Each candidate is a pair: a
 * `cover` spot hidden from the threat behind an obstacle, and a `peek` spot a step out to the side
 * where it can shoot. The enemy hides at the first and steps out to the second to fire - the
 * enemies cannot crouch, so "hidden at chest height but clear at head height" (the design's
 * single-spot peek) would almost never exist, while a corner or a trunk always has a side to step
 * out to. Open spots (no obstacle) have only a peek.
 *
 * Pure geometry, no rays: tacticalQuery.ts confirms each spot with one ray before it is trusted.
 */

export type CoverSource = 'trunk' | 'tower' | 'houseCorner' | 'open';

export interface CoverCandidate {
  readonly cover: PlanarPoint | null;
  readonly peek: PlanarPoint;
  readonly source: CoverSource;
}

/** How far a capsule's centre must stand from an obstacle's edge to be clear of it. */
const STAND_OFF = ENEMY_RADIUS + ENEMY_COVER_MARGIN;

/** Cover behind a round obstacle (a trunk, or a watch tower treated as one): the spot directly
 * behind it as seen from the threat, and two peek spots stepping out either side. */
export function circleCoverCandidates(
  centreX: number,
  centreZ: number,
  radius: number,
  threat: PlanarPoint,
  source: CoverSource,
): CoverCandidate[] {
  const dx = centreX - threat.x;
  const dz = centreZ - threat.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return [];
  const ux = dx / length;
  const uz = dz / length;
  const behind = radius + STAND_OFF;
  const cover = { x: centreX + ux * behind, z: centreZ + uz * behind };
  // Perpendicular to the threat line; stepping out this far takes the enemy's centre clear of the
  // obstacle's silhouette as the threat sees it.
  const px = -uz;
  const pz = ux;
  return [1, -1].map((side) => ({
    cover,
    peek: { x: cover.x + px * side * behind, z: cover.z + pz * side * behind },
    source,
  }));
}

/** Cover at a house's corners. For each corner, the wall faces meeting there that point away from
 * the threat are hidden from it; the cover spot sits just off such a face, inset from the corner,
 * and the peek spot is just off the corner itself, where the enemy can lean round. */
export function houseCoverCandidates(footprint: HouseFootprint, threat: PlanarPoint): CoverCandidate[] {
  const cos = Math.cos(footprint.rotationY);
  const sin = Math.sin(footprint.rotationY);
  // local -> world, the inverse of isPointNearFootprint's world -> local.
  const toWorld = (lx: number, lz: number): PlanarPoint => ({
    x: footprint.originX + lx * cos + lz * sin,
    z: footprint.originZ - lx * sin + lz * cos,
  });
  const directionToWorld = (lx: number, lz: number): PlanarPoint => ({ x: lx * cos + lz * sin, z: -lx * sin + lz * cos });
  const inset = Math.min(ENEMY_COVER_FACE_INSET, footprint.halfWidth, footprint.halfDepth);

  const candidates: CoverCandidate[] = [];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const corner = toWorld(footprint.offsetX + sx * footprint.halfWidth, footprint.offsetZ + sz * footprint.halfDepth);
      const awayX = corner.x - threat.x;
      const awayZ = corner.z - threat.z;
      const awayLength = Math.hypot(awayX, awayZ);
      if (awayLength < 1e-6) continue;
      const diagonal = directionToWorld(sx * Math.SQRT1_2, sz * Math.SQRT1_2);
      const peek = { x: corner.x + diagonal.x * STAND_OFF * Math.SQRT2, z: corner.z + diagonal.z * STAND_OFF * Math.SQRT2 };
      const faces = [
        { normal: directionToWorld(sx, 0), inward: directionToWorld(0, -sz) },
        { normal: directionToWorld(0, sz), inward: directionToWorld(-sx, 0) },
      ];
      for (const face of faces) {
        const facing = (face.normal.x * awayX + face.normal.z * awayZ) / awayLength;
        if (facing < ENEMY_COVER_FACE_MIN_DOT) continue;
        candidates.push({
          cover: {
            x: corner.x + face.normal.x * STAND_OFF + face.inward.x * inset,
            z: corner.z + face.normal.z * STAND_OFF + face.inward.z * inset,
          },
          peek,
          source: 'houseCorner',
        });
      }
    }
  }
  return candidates;
}

export function obstacleCoverCandidates(obstacle: Obstacle, threat: PlanarPoint): CoverCandidate[] {
  if (obstacle.kind === 'trunk') return circleCoverCandidates(obstacle.x, obstacle.z, obstacle.radius, threat, 'trunk');
  return houseCoverCandidates(obstacle.footprint, threat);
}

/** Open firing spots on rings around the enemy, at a seeded angular offset per ring, for when no
 * cover is near enough. They have a peek spot only. */
export function openCandidates(from: PlanarPoint, rng: () => number): CoverCandidate[] {
  const candidates: CoverCandidate[] = [];
  for (const radius of ENEMY_TACTICAL_OPEN_RADII) {
    const offset = rng() * Math.PI * 2;
    for (let i = 0; i < ENEMY_TACTICAL_OPEN_SAMPLES; i++) {
      const angle = offset + (i / ENEMY_TACTICAL_OPEN_SAMPLES) * Math.PI * 2;
      candidates.push({ cover: null, peek: { x: from.x + Math.sin(angle) * radius, z: from.z + Math.cos(angle) * radius }, source: 'open' });
    }
  }
  return candidates;
}
