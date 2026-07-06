import { MULTIPLAYER_SPAWN_MIN_SEPARATION, MULTIPLAYER_SPAWN_POINTS } from './config.ts';

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
 * never needs to avoid the opponent's current position or agree with anything cross-client. */
export function pickRandomRespawnPoint(): SpawnPoint {
  return MULTIPLAYER_SPAWN_POINTS[Math.floor(Math.random() * MULTIPLAYER_SPAWN_POINTS.length)]!;
}
