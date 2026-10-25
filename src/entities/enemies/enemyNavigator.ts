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

/** Whether an enemy at (x, z) about to walk along the unit direction (dirX, dirZ) must stand still
 * this tick: a Facility match's closed door in the way (docs/facility-map.md, section 12). The gate
 * itself counts the wait and opens the door. */
export type EnemyDoorGate = (enemyId: number, x: number, z: number, dirX: number, dirZ: number, dt: number) => boolean;

let doorGate: EnemyDoorGate | null = null;

/** Module-level like the navigator: set by a Facility match, cleared on its dispose. */
export function setEnemyDoorGate(fn: EnemyDoorGate | null): void {
  doorGate = fn;
}

/** True when a door gate holds this enemy where it stands this tick; always false without one. */
export function heldAtDoor(enemyId: number, x: number, z: number, dirX: number, dirZ: number, dt: number): boolean {
  return doorGate ? doorGate(enemyId, x, z, dirX, dirZ, dt) : false;
}
