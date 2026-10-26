import type * as THREE from 'three';
import type { WorldObjectChanges, WorldObjectKind, WorldObjectWire } from '../facility/facilityObjectState.ts';

/**
 * The world side of interactive objects (doors, breaker panels) as core/facilityInteraction.ts drives
 * them: the Facility's doors and breakers (FacilityObjects) and the Valley houses' doors
 * (world/houses/ValleyDoors.ts). Ids are whatever the map numbers its objects with, identical on
 * every client; the interaction only passes them through.
 */
export interface InteractiveWorldObjects {
  readonly state: {
    has(kind: WorldObjectKind, id: number): boolean;
    /** A door open, a breaker on. */
    isActive(kind: WorldObjectKind, id: number): boolean;
  };
  /** Per tick: doors slide toward their state. */
  update(dt: number): void;
  /** The nearest object a ray crosses within maxDistance, or null. */
  pick(origin: THREE.Vector3Like, direction: THREE.Vector3Like, maxDistance: number): { kind: WorldObjectKind; id: number; distance: number } | null;
  /** Sets one object; true when it changed. */
  set(kind: WorldObjectKind, id: number, active: boolean, instant?: boolean): boolean;
  /** Whether any of the bodies stands where door `id`'s leaves would close. */
  doorwayOccupied(id: number, bodies: Iterable<{ x: number; z: number }>, radius: number): boolean;
  /** Horizontal distance from (x, z) to the object; Infinity for an unknown id. */
  distanceTo(kind: WorldObjectKind, id: number, x: number, z: number): number;
  /** Where the object sits (its sounds play there), or null. */
  position(kind: WorldObjectKind, id: number): THREE.Vector3 | null;
  /** The closed door an enemy at (x, z) walking along (dirX, dirZ) is about to reach, or -1. The
   * lookahead stops `reach` m on (its waypoint), and feet at feetY must be at the door's height. */
  closedDoorAhead(x: number, z: number, dirX: number, dirZ: number, reach?: number, feetY?: number): number;
  /** The whole state as worldObjectState and the welcome carry it. */
  wire(): WorldObjectWire;
  /** A received state checked against this world, or null when it does not fit (another build, a
   * malformed message). */
  parseWire(value: unknown): WorldObjectWire | null;
  /** Adopts a parsed state whole; returns what changed. */
  applyWire(wire: WorldObjectWire, instant?: boolean): WorldObjectChanges;
  /** Back to the match's start, at once. */
  reset(): WorldObjectChanges;
}
