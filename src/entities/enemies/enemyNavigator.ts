/** Where an enemy should head next on its way from one point to another. A Facility match sets one
 * from its grid navigation (world/facility/facilityNav.ts) so enemies path through doors instead of
 * walking into walls; the Valley sets the houses' (world/houses/HouseNavigator.ts), which leaves any
 * move that never touches a house unchanged. `fromY` and `toY` are body centre heights when known (a
 * house's upper floor); `direct` on the answer means the straight way to it is known clear, so the
 * enemy walks it without whisker steering. */
export type EnemyNavigator = (fromX: number, fromZ: number, toX: number, toZ: number, fromY?: number, toY?: number) => { x: number; z: number; direct?: boolean };

let navigator: EnemyNavigator | null = null;

/** Module-level, like TerrainGenerator's height override: set at a Facility match's start and
 * cleared on its dispose. */
export function setEnemyNavigator(fn: EnemyNavigator | null): void {
  navigator = fn;
}

/** The point a move from (fromX, fromZ) toward (toX, toZ) should steer at this tick: the navigator's
 * next waypoint when one is set, otherwise the target itself. */
export function resolveMoveTarget(fromX: number, fromZ: number, toX: number, toZ: number, fromY?: number, toY?: number): { x: number; z: number; direct?: boolean } {
  return navigator ? navigator(fromX, fromZ, toX, toZ, fromY, toY) : { x: toX, z: toZ };
}

/** True while a navigator is set (a Facility or Valley match). */
export function hasEnemyNavigator(): boolean {
  return navigator !== null;
}

/** Whether an enemy (or a horde goose) at (x, z) about to walk along the unit direction (dirX, dirZ)
 * must stand still this tick: a closed Facility or Valley house door in the way (docs/facility-map.md,
 * section 12). `reach` is how far on its waypoint is (the door must lie before it) and feetY its feet
 * height (the door must be at that height). The gate itself counts the wait and opens the door. */
export type EnemyDoorGate = (enemyId: number, x: number, z: number, dirX: number, dirZ: number, dt: number, reach?: number, feetY?: number) => boolean;

let doorGate: EnemyDoorGate | null = null;
let doorForget: ((enemyId: number) => void) | null = null;

/** Module-level like the navigator: set by a Facility match, cleared on its dispose. `forget` drops
 * the gate's wait for an enemy that is gone (see forgetDoorWait). */
export function setEnemyDoorGate(fn: EnemyDoorGate | null, forget?: (enemyId: number) => void): void {
  doorGate = fn;
  doorForget = fn ? forget ?? null : null;
}

/** An enemy or horde goose is gone (killed, removed): the gate drops any wait it left at a door. */
export function forgetDoorWait(enemyId: number): void {
  doorForget?.(enemyId);
}

/** True when a door gate holds this enemy where it stands this tick; always false without one. */
export function heldAtDoor(enemyId: number, x: number, z: number, dirX: number, dirZ: number, dt: number, reach?: number, feetY?: number): boolean {
  return doorGate ? doorGate(enemyId, x, z, dirX, dirZ, dt, reach, feetY) : false;
}

/** The floor under an enemy whose feet are at feetY: a Valley house's floor, stair or upper floor
 * (world/houses/HouseNavigator.ts), or null where the terrain is the floor. */
export type EnemyFloor = (x: number, z: number, feetY: number) => number | null;

let floor: EnemyFloor | null = null;

/** Module-level like the navigator: set by a Valley match, cleared on its dispose. */
export function setEnemyFloor(fn: EnemyFloor | null): void {
  floor = fn;
}

/** The floor height at (x, z) for feet at feetY, or null for the terrain (always null unset). */
export function enemyFloorAt(x: number, z: number, feetY: number): number | null {
  return floor ? floor(x, z, feetY) : null;
}

/** Where a walker going into the building that holds (x, z) starts from: the spot in front of its
 * door outside (a Valley house's street node), or null where (x, z) is in no building. */
export type EnemyEntrance = (x: number, z: number) => { x: number; z: number } | null;

let entrance: EnemyEntrance | null = null;

/** Module-level like the floor: set by a Valley match, cleared on its dispose. */
export function setEnemyEntrance(fn: EnemyEntrance | null): void {
  entrance = fn;
}

/** The outside spot in front of the door of the building at (x, z), or null (always null unset). */
export function buildingEntranceAt(x: number, z: number): { x: number; z: number } | null {
  return entrance ? entrance(x, z) : null;
}
