/**
 * Enemy AI v2 step 6 (docs/enemy-ai-v2.md): where a director wave comes in. Reinforcements must
 * never pop into existence on the player's screen, so points are drawn behind them, far enough off
 * to hear before they see, clear of houses and towers, and never inside the player's view. Among
 * those, points with no clear line from the player's eye are used first (safe even if the player
 * turns round at once); exposed ones only when nothing drawn is hidden, because in open ground
 * nothing behind the player is, and a line-of-sight rule alone would never send a wave there.
 *
 * Pure: the world is reached only through the injected probes, so it is tested without Rapier.
 */

export interface SpawnProbeContext {
  /** The player's feet and the way they are looking (a unit vector on the ground). */
  readonly player: { readonly x: number; readonly z: number; readonly forwardX: number; readonly forwardZ: number };
  /** Half the player's horizontal field of view plus a margin, degrees: a point inside it is on screen. */
  readonly viewHalfAngleDeg: number;
  /** Inside a house or a watch tower (Game's spawn-blocked check). */
  readonly isBlocked: (x: number, z: number) => boolean;
  readonly heightAt: (x: number, z: number) => number;
  /** One ray: does the player's eye have a clear line to this point? */
  readonly canPlayerSee: (x: number, y: number, z: number) => boolean;
  readonly rng: () => number;
}

export interface SpawnOptions {
  readonly minRadius: number;
  readonly maxRadius: number;
  /** How far round from straight behind the player a point may be drawn, in degrees. */
  readonly behindHalfAngleDeg: number;
  /** Points drawn per wave. */
  readonly candidates: number;
  /** Sight checks allowed per wave. */
  readonly rays: number;
  /** Height above the ground of the point the sight check aims at (an enemy's head). */
  readonly headHeight: number;
  /** Two reinforcements are never placed closer together than this. */
  readonly minSpacing: number;
}

export interface SpawnPoint {
  readonly x: number;
  /** Ground height there. */
  readonly y: number;
  readonly z: number;
  /** No clear line from the player's eye when it was checked. */
  readonly hidden: boolean;
}

/** Up to `count` off-screen points for a wave, hidden ones first. `preferHigh` (a Ridge Walker's
 * wave) tries the highest ground first. Returns fewer than asked, even none, only when too few
 * points drawn were clear of structures, off screen and spaced apart. */
export function pickReinforcementSpawns(
  context: SpawnProbeContext,
  count: number,
  preferHigh: boolean,
  options: SpawnOptions,
): { points: SpawnPoint[]; raysUsed: number } {
  const { player, rng } = context;
  const behind = Math.atan2(-player.forwardX, -player.forwardZ);
  const halfAngle = (options.behindHalfAngleDeg * Math.PI) / 180;
  const cosView = Math.cos((context.viewHalfAngleDeg * Math.PI) / 180);

  const candidates: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < options.candidates; i++) {
    const angle = behind + (rng() * 2 - 1) * halfAngle;
    const radius = options.minRadius + rng() * (options.maxRadius - options.minRadius);
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    if (dx * player.forwardX + dz * player.forwardZ > cosView) continue;
    const x = player.x + dx * radius;
    const z = player.z + dz * radius;
    if (context.isBlocked(x, z)) continue;
    candidates.push({ x, y: context.heightAt(x, z), z });
  }
  if (preferHigh) candidates.sort((a, b) => b.y - a.y);

  const points: SpawnPoint[] = [];
  const exposed: SpawnPoint[] = [];
  const spaced = (candidate: { x: number; z: number }) =>
    points.every((point) => Math.hypot(point.x - candidate.x, point.z - candidate.z) >= options.minSpacing);
  let raysUsed = 0;
  for (const candidate of candidates) {
    if (points.length >= count) break;
    if (!spaced(candidate)) continue;
    if (raysUsed < options.rays) {
      raysUsed++;
      if (!context.canPlayerSee(candidate.x, candidate.y + options.headHeight, candidate.z)) {
        points.push({ ...candidate, hidden: true });
        continue;
      }
    }
    exposed.push({ ...candidate, hidden: false });
  }
  for (const candidate of exposed) {
    if (points.length >= count) break;
    if (spaced(candidate)) points.push(candidate);
  }
  return { points, raysUsed };
}
