import {
  MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT,
  MULTIPLAYER_SPAWN_MIN_SEPARATION,
  MULTIPLAYER_SPAWN_POINTS,
} from './config.ts';

export interface SpawnPoint {
  x: number;
  z: number;
}

function distance(a: SpawnPoint, b: SpawnPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Picks two spawn points from MULTIPLAYER_SPAWN_POINTS at least MULTIPLAYER_SPAWN_MIN_SEPARATION
 * apart - called once by the host at match start (and again for each Rematch), never by the guest,
 * so both sides agree on the result without needing a shared seed for it: the choice rides on the
 * same MatchStartMessage that already carries the world seed. Plain Math.random(), not a seeded
 * RNG - unlike the world itself, there's no reason this needs to be reproducible across runs. */
export function pickMultiplayerSpawnPoints(): [SpawnPoint, SpawnPoint] {
  for (let attempt = 0; attempt < 20; attempt++) {
    const a = MULTIPLAYER_SPAWN_POINTS[Math.floor(Math.random() * MULTIPLAYER_SPAWN_POINTS.length)];
    const b = MULTIPLAYER_SPAWN_POINTS[Math.floor(Math.random() * MULTIPLAYER_SPAWN_POINTS.length)];
    if (a && b && distance(a, b) >= MULTIPLAYER_SPAWN_MIN_SEPARATION) return [a, b];
  }
  // Exhausted the attempt budget (shouldn't happen with the current pool/separation values, but a
  // pool misconfigured too small shouldn't hang forever either) - falls back to the two points
  // guaranteed to be farthest apart in a symmetric pool: opposite ends.
  const half = Math.floor(MULTIPLAYER_SPAWN_POINTS.length / 2);
  return [MULTIPLAYER_SPAWN_POINTS[0]!, MULTIPLAYER_SPAWN_POINTS[half]!];
}

/** Picks one fresh spawn point for a mid-match respawn - independent of pickMultiplayerSpawnPoints
 * (which only runs once, at match start), and independent per client: each player's own client
 * picks where *it* respawns and reports the result via the existing respawnEvent message, so this
 * never needs to agree with anything cross-client. Per user request, does need to avoid the
 * opponent's *current* position though - filters to points at least
 * MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT away and picks randomly among whichever qualify,
 * so a respawn never drops the player back in sight of (or right next to) whoever just killed
 * them. Falls back to the single farthest point if the opponent is positioned such that nothing
 * qualifies (shouldn't happen with the current pool/distance values, but a future pool change
 * shouldn't be able to leave this with zero candidates and no result). */
export function pickRandomRespawnPoint(opponentPosition: SpawnPoint): SpawnPoint {
  const candidates = MULTIPLAYER_SPAWN_POINTS.filter(
    (point) => distance(point, opponentPosition) >= MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT,
  );
  if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)]!;

  return MULTIPLAYER_SPAWN_POINTS.reduce((farthest, point) =>
    distance(point, opponentPosition) > distance(farthest, opponentPosition) ? point : farthest,
  );
}
