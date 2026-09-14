import { MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT, MULTIPLAYER_SPAWN_RADIUS } from './config.ts';

export interface SpawnPoint {
  x: number;
  z: number;
}

function distance(a: SpawnPoint, b: SpawnPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Places `playerCount` spawn points evenly around a circle of MULTIPLAYER_SPAWN_RADIUS, at a
 * random starting angle so results still vary match to match (called once by the host at match
 * start, and again for each Rematch/late-joiner spawn - never by a guest for the initial pick, so
 * both sides agree on the result without a shared seed: it rides on the same MatchStartMessage
 * that already carries the world seed). Plain Math.random(), not a seeded RNG - unlike the world
 * itself, there's no reason this needs to be reproducible across runs.
 *
 * This is a closed-form guarantee, not a retry: an evenly-spaced N-gon's minimum pairwise vertex
 * distance is always its adjacent-vertex chord `2 * R * sin(pi / N)` (any non-adjacent chord in a
 * convex polygon is strictly longer), which at this radius comfortably clears
 * MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT for every player count this game supports:
 *   N=2: 2*35*sin(90deg) = 70.0
 *   N=3: 2*35*sin(60deg) = 60.6
 *   N=4: 2*35*sin(45deg) = 49.5
 * Replaces the older fixed 6-point-hexagon-pool + up-to-20-attempt rejection sampling entirely -
 * that approach was hand-tuned for exactly 2 picks and didn't generalize to N without either
 * lowering the separation guarantee or growing the pool. */
export function pickMultiplayerSpawnPoints(playerCount: number): SpawnPoint[] {
  const rotationOffset = Math.random() * 2 * Math.PI;
  return Array.from({ length: playerCount }, (_, i) => {
    const angle = rotationOffset + (i * 2 * Math.PI) / playerCount;
    return { x: Math.cos(angle) * MULTIPLAYER_SPAWN_RADIUS, z: Math.sin(angle) * MULTIPLAYER_SPAWN_RADIUS };
  });
}

const RESPAWN_ATTEMPTS = 20;

/** "Is there a building or tower here?" for a candidate spawn (x, z). Injected rather than imported
 * so these functions stay pure and unit-testable without the world managers. */
export type SpawnBlockedCheck = (x: number, z: number) => boolean;
const NEVER_BLOCKED: SpawnBlockedCheck = () => false;

const CLEAR_SPAWN_SEARCH_STEP = 2;
const CLEAR_SPAWN_SEARCH_RINGS = 15;
const CLEAR_SPAWN_SEARCH_ANGLES = 16;

/** `preferred` if it is clear, otherwise the nearest clear point on expanding rings around it (2 m
 * apart, out to 30 m). Every spawn used terrain height alone, so a spawn point that happened to land
 * on a house or watch tower put the player inside its collider. Falls back to `preferred` if nothing
 * within reach is clear, which is no worse than before. */
export function findClearSpawnPoint(preferred: SpawnPoint, isBlocked: SpawnBlockedCheck): SpawnPoint {
  if (!isBlocked(preferred.x, preferred.z)) return preferred;
  for (let ring = 1; ring <= CLEAR_SPAWN_SEARCH_RINGS; ring++) {
    const radius = ring * CLEAR_SPAWN_SEARCH_STEP;
    for (let i = 0; i < CLEAR_SPAWN_SEARCH_ANGLES; i++) {
      const angle = (i / CLEAR_SPAWN_SEARCH_ANGLES) * 2 * Math.PI;
      const candidate = { x: preferred.x + Math.cos(angle) * radius, z: preferred.z + Math.sin(angle) * radius };
      if (!isBlocked(candidate.x, candidate.z)) return candidate;
    }
  }
  return preferred;
}

/** Picks one fresh spawn point for a mid-match respawn - independent of
 * pickMultiplayerSpawnPoints (which only runs once, at match start/rematch/late-join), and
 * independent per client: each player's own client picks where *it* respawns and reports the
 * result via the existing respawnEvent message, so this never needs to agree with anything
 * cross-client. Must clear MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT from *every* other
 * currently-alive player's position, not just one - with up to 3 opponents who can be anywhere on
 * the map (not confined to the fixed initial ring), this can't be a closed-form guarantee the way
 * the initial spawn placement is, so it keeps the bounded-retry shape: sample a fresh random point
 * on the same ring, keep the one with the largest minimum distance to any other player if none of
 * the attempts clear the threshold outright. */
export function pickRandomRespawnPoint(otherPositions: readonly SpawnPoint[], isBlocked: SpawnBlockedCheck = NEVER_BLOCKED): SpawnPoint {
  let best: SpawnPoint | null = null;
  let bestMinDistance = -Infinity;
  let firstCandidate: SpawnPoint | null = null;

  for (let attempt = 0; attempt < RESPAWN_ATTEMPTS; attempt++) {
    const angle = Math.random() * 2 * Math.PI;
    const candidate: SpawnPoint = { x: Math.cos(angle) * MULTIPLAYER_SPAWN_RADIUS, z: Math.sin(angle) * MULTIPLAYER_SPAWN_RADIUS };
    firstCandidate ??= candidate;
    // Inside a house or tower is never acceptable, however far it is from everyone else.
    if (isBlocked(candidate.x, candidate.z)) continue;
    const minDistance = otherPositions.length === 0 ? Infinity : Math.min(...otherPositions.map((p) => distance(candidate, p)));
    if (minDistance >= MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT) return candidate;
    if (minDistance > bestMinDistance) {
      bestMinDistance = minDistance;
      best = candidate;
    }
  }

  // Exhausted the attempt budget (shouldn't happen at these radius/count/threshold values) -
  // return whichever sampled candidate had the largest minimum distance from any other player. If
  // every candidate was blocked (vanishingly unlikely), step out from the first one to clear ground.
  return best ?? findClearSpawnPoint(firstCandidate!, isBlocked);
}
