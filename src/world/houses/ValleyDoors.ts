import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FACILITY_DOOR_SLIDE_SECONDS } from '../../core/config.ts';
import { worldBox } from '../structureGeometry.ts';
import { getStructureMaterials, STRUCTURE_TILE_METRES } from '../structureMaterials.ts';
import {
  bodyInDoorway, distanceToDoor, doorPickBox, rayBoxDistance, walkMeetsDoor, type DoorPlane,
} from '../doors/doorGeometry.ts';
import type { InteractiveWorldObjects } from '../doors/interactiveObjects.ts';
import { SlidingDoorView, type SlidingDoorLook } from '../doors/SlidingDoorView.ts';
import type { WorldObjectChanges, WorldObjectKind, WorldObjectWire } from '../facility/facilityObjectState.ts';
import { parseHouseObjectId, towerIndexFromDoorId } from './valleyHouseIds.ts';
import { towerDoorPlane } from '../towerUnderground.ts';

/** A received list longer than this is not a real match's (it is ignored whole). */
const MAX_OPEN_DOORS = 4096;
const LAMP_GREEN = 0x3dff6a;
const LAMP_RED = 0xff3326;

/** Finds the world plane of any house door by id, streamed in or not (null for an id that names no
 * house door in this world). BuildingManager answers it from the seeded town layouts. */
export type ValleyDoorLookup = (id: number) => DoorPlane | null;

/**
 * The Valley houses' front doors (docs/enterable-buildings.md): the shared sliding door
 * (world/doors/SlidingDoorView.ts) in each streamed-in house, and the state of every house door in
 * the world, streamed in or not. Doors start closed; the state is the set of open door ids (house
 * key plus door slot, world/houses/valleyHouseIds.ts), which is also the wire form. Gameplay (the
 * prompt, who decides, sync, sound) is core/facilityInteraction.ts through InteractiveWorldObjects.
 */
export class ValleyDoors implements InteractiveWorldObjects {
  /** Towers share the houses' authority and wire state, regardless of construction order. */
  private static readonly worlds = new WeakMap<RAPIER.World, { owner?: ValleyDoors; towers: Map<number, DoorPlane> }>();

  private static registry(world: RAPIER.World) {
    let entry = this.worlds.get(world);
    if (!entry) { entry = { towers: new Map() }; this.worlds.set(world, entry); }
    return entry;
  }

  static addTowerDoor(world: RAPIER.World, id: number, plane: DoorPlane): void {
    const entry = this.registry(world);
    entry.towers.set(id, plane);
    entry.owner?.addDoor(id, plane);
  }

  static removeTowerDoor(world: RAPIER.World, id: number): void {
    const entry = this.registry(world);
    entry.towers.delete(id);
    entry.owner?.removeDoor(id);
  }

  private readonly open = new Set<number>();
  private readonly views = new Map<number, { view: SlidingDoorView; plane: DoorPlane }>();
  /** Planes of doors looked up while not streamed in (a guest's interact far from the host). */
  private readonly planes = new Map<number, DoorPlane>();
  private readonly group = new THREE.Group();
  private readonly body: RAPIER.RigidBody;
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly look: SlidingDoorLook;
  private disposed = false;

  readonly state = {
    has: (kind: WorldObjectKind, id: number): boolean => kind === 'door' && this.plane(id) !== null,
    isActive: (kind: WorldObjectKind, id: number): boolean => kind === 'door' && this.open.has(id) && this.plane(id) !== null,
  };

  constructor(scene: THREE.Scene, private readonly world: RAPIER.World, private readonly lookup: ValleyDoorLookup) {
    this.group.name = 'valley-doors';
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const shared = getStructureMaterials();
    this.look = {
      box: (width, height, depth, key) => this.geometry(`${key}:${width}:${height}:${depth}`, () => worldBox(width, height, depth, STRUCTURE_TILE_METRES[key])),
      statusLamp: () => this.geometry('lamp', () => new THREE.BoxGeometry(0.16, 0.05, 0.02)),
      steel: shared.steel,
      hazard: shared.hazard,
      green: new THREE.MeshBasicMaterial({ name: 'valley-door-green', color: LAMP_GREEN, toneMapped: false }),
      red: new THREE.MeshBasicMaterial({ name: 'valley-door-red', color: LAMP_RED, toneMapped: false }),
    };
    scene.add(this.group);
    const entry = ValleyDoors.registry(world);
    entry.owner = this;
    for (const [id, plane] of entry.towers) this.addDoor(id, plane);
  }

  private geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geometry = this.geometries.get(key);
    if (!geometry) { geometry = make(); this.geometries.set(key, geometry); }
    return geometry;
  }

  private plane(id: number): DoorPlane | null {
    const loaded = this.views.get(id);
    if (loaded) return loaded.plane;
    if (this.planes.has(id)) return this.planes.get(id)!;
    const plane = parseHouseObjectId(id) ? this.lookup(id) : towerDoorPlane(id);
    // Only real doors are remembered, so a stream of made-up ids cannot grow the cache.
    if (plane) this.planes.set(id, plane);
    return plane;
  }

  /** A house streamed in: its door, in the world frame, shown in its current state. */
  addDoor(id: number, plane: DoorPlane): void {
    if (this.disposed || this.views.has(id)) return;
    const view = new SlidingDoorView(plane, this.look, this.world, this.body, !this.open.has(id));
    view.root.name = `valley-door-${id}`;
    this.group.add(view.root);
    this.views.set(id, { view, plane });
    this.planes.set(id, plane);
  }

  /** A house streamed out: its door leaves the world; its state stays. */
  removeDoor(id: number): void {
    const entry = this.views.get(id);
    if (!entry) return;
    entry.view.remove(this.world);
    this.views.delete(id);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const step = (Number.isFinite(dt) ? Math.max(0, dt) : 0) / FACILITY_DOOR_SLIDE_SECONDS;
    for (const { view } of this.views.values()) view.update(step);
  }

  pick(origin: THREE.Vector3Like, direction: THREE.Vector3Like, maxDistance: number): { kind: WorldObjectKind; id: number; distance: number } | null {
    if (this.disposed) return null;
    let best: { kind: WorldObjectKind; id: number; distance: number } | null = null;
    for (const [id, { plane }] of this.views) {
      const distance = rayBoxDistance(doorPickBox(plane), origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, maxDistance);
      if (distance < (best?.distance ?? Infinity)) best = { kind: 'door', id, distance };
    }
    return best;
  }

  set(kind: WorldObjectKind, id: number, active: boolean, instant = false): boolean {
    if (this.disposed || !this.state.has(kind, id) || this.open.has(id) === active) return false;
    if (active) this.open.add(id); else this.open.delete(id);
    this.views.get(id)?.view.show(!active, instant);
    return true;
  }

  doorwayOccupied(id: number, bodies: Iterable<{ x: number; z: number }>, radius: number): boolean {
    const plane = this.plane(id);
    if (!plane) return false;
    for (const body of bodies) if (bodyInDoorway(plane, body.x, body.z, radius)) return true;
    return false;
  }

  distanceTo(kind: WorldObjectKind, id: number, x: number, z: number): number {
    const plane = kind === 'door' ? this.plane(id) : null;
    return plane ? distanceToDoor(plane, x, z) : Infinity;
  }

  position(kind: WorldObjectKind, id: number): THREE.Vector3 | null {
    const plane = kind === 'door' ? this.plane(id) : null;
    return plane ? new THREE.Vector3(plane.x, (plane.y ?? 0) + plane.height / 2, plane.z) : null;
  }

  closedDoorAhead(x: number, z: number, dirX: number, dirZ: number, reach?: number, feetY?: number): number {
    for (const [id, { plane }] of this.views) {
      // Tower entrances remain enemy barriers when a player leaves their door open.
      if ((towerIndexFromDoorId(id) !== null || !this.open.has(id)) && walkMeetsDoor(plane, x, z, dirX, dirZ, reach, feetY)) return id;
    }
    return -1;
  }

  wire(): WorldObjectWire {
    return { doors: '', breakers: '', valleyDoors: [...this.open].sort((a, b) => a - b) };
  }

  /** The Valley's wire: empty Facility strings and a list of open house door ids, each a real door. */
  parseWire(value: unknown): WorldObjectWire | null {
    if (typeof value !== 'object' || value === null) return null;
    const { doors, breakers, valleyDoors } = value as { doors?: unknown; breakers?: unknown; valleyDoors?: unknown };
    if (doors !== '' || breakers !== '' || !Array.isArray(valleyDoors) || valleyDoors.length > MAX_OPEN_DOORS) return null;
    if (!valleyDoors.every((id) => typeof id === 'number' && this.state.has('door', id))) return null;
    return { doors: '', breakers: '', valleyDoors: [...new Set(valleyDoors as number[])] };
  }

  applyWire(wire: WorldObjectWire, instant = false): WorldObjectChanges {
    const changes: WorldObjectChanges = { doors: [], breakers: [] };
    if (this.disposed) return changes;
    const next = new Set(wire.valleyDoors ?? []);
    for (const id of [...this.open]) if (!next.has(id) && this.set('door', id, false, instant)) changes.doors.push(id);
    for (const id of next) if (this.set('door', id, true, instant)) changes.doors.push(id);
    return changes;
  }

  reset(): WorldObjectChanges {
    return this.applyWire({ doors: '', breakers: '', valleyDoors: [] }, true);
  }

  /** Debug API: the streamed-in doors with their state and whether their collider is in the world. */
  debugDoors(): { id: number; x: number; y: number; z: number; axis: 'x' | 'z'; side: 1 | -1; open: boolean; collider: boolean }[] {
    return [...this.views].map(([id, { view, plane }]) => ({
      id, x: plane.x, y: plane.y ?? 0, z: plane.z, axis: plane.axis, side: plane.side, open: this.open.has(id), collider: view.collider.isEnabled(),
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const entry = ValleyDoors.registry(this.world);
    if (entry.owner === this) entry.owner = undefined;
    for (const id of [...this.views.keys()]) this.removeDoor(id);
    if (this.world.getRigidBody(this.body.handle)) this.world.removeRigidBody(this.body);
    this.group.removeFromParent();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    this.look.green.dispose();
    this.look.red.dispose();
  }
}
