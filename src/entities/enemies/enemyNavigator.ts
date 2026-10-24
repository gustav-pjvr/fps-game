/** Where an enemy should head next on its way from one point to another. A Facility match sets one
 * from its grid navigation (world/facility/facilityNav.ts) so enemies path through doors instead of
 * walking into walls; the Valley leaves it unset and enemies steer straight at their target. */
export type EnemyNavigator = (fromX: number, fromZ: number, toX: number, toZ: number) => { x: number; z: number };

let navigator: EnemyNavigator | null = null;

/** Module-level, like TerrainGenerator's height override: set at a Facility match's start and
 * cleared on its dispose. */
export function setEnemyNavigator(fn: EnemyNavigator | null): void {
  navigator = fn;
}

/** The point a move from (fromX, fromZ) toward (toX, toZ) should steer at this tick: the navigator's
 * next waypoint when one is set, otherwise the target itself. */
export function resolveMoveTarget(fromX: number, fromZ: number, toX: number, toZ: number): { x: number; z: number } {
  return navigator ? navigator(fromX, fromZ, toX, toZ) : { x: toX, z: toZ };
}

/** True while a navigator is set (a Facility match). */
export function hasEnemyNavigator(): boolean {
  return navigator !== null;
}
