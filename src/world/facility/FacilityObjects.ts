import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FACILITY_DOOR_SLIDE_SECONDS } from '../../core/config.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { getStructureMaterials, STRUCTURE_TILE_METRES, type StructureMaterialKey } from '../structureMaterials.ts';
import type { FacilityWorld } from './FacilityBuilder.ts';
import { cellCentre, isWalkable, type FacilityLayout } from './facilityLayout.ts';
import type { FacilityNav } from './facilityNav.ts';
import { doorCrossings, facilityDoors, type FacilityDoor } from './facilityDoors.ts';
import { bodyInDoorway, distanceToDoor, doorPickBox, rayBoxDistance, segmentCrossesDoor, type Box3 } from '../doors/doorGeometry.ts';
import type { InteractiveWorldObjects } from '../doors/interactiveObjects.ts';
import { SlidingDoorView, type SlidingDoorLook } from '../doors/SlidingDoorView.ts';
import { facilityPower, type FacilityBreaker, type FacilityPower } from './facilityPower.ts';
import {
  FacilityObjectState, parseWorldObjectWire, type WorldObjectChanges, type WorldObjectKind, type WorldObjectWire,
} from './facilityObjectState.ts';

/** Breaker panel size (m) and its pick box, a little larger so it is easy to aim at. */
const PANEL = { width: 0.5, height: 0.7, depth: 0.12 } as const;
const PANEL_PICK_HALF = { along: 0.3, up: 0.4, out: 0.12 } as const;
/** How far ahead (m) along its walk an enemy notices a closed door and stops for it. */
const ENEMY_DOOR_LOOKAHEAD = 1.6;
const LAMP_GREEN = 0x3dff6a;
const LAMP_RED = 0xff3326;

interface BreakerView {
  readonly lever: THREE.Object3D;
  readonly lamp: THREE.Mesh;
}

interface ObjectsOptions {
  scene: THREE.Scene;
  physics: PhysicsWorld;
}

/**
 * The Facility's doors and breaker panels in the world (docs/facility-map.md, section 12): their
 * meshes, the closed doors' colliders (they block players, bullets, grenades and enemy sight), the
 * enemy flow field's door costs and the lamps each breaker powers. Gameplay rules (who may flip what,
 * sync, sound) live in core/facilityInteraction.ts; this class only shows and applies a state.
 */
export class FacilityObjects implements InteractiveWorldObjects {
  readonly doors: readonly FacilityDoor[];
  readonly power: FacilityPower;
  readonly state: FacilityObjectState;
  private readonly group = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  /** The leaves ease toward their state at FACILITY_DOOR_SLIDE_SECONDS for a full travel. */
  private readonly doorViews: SlidingDoorView[] = [];
  private readonly breakerViews: BreakerView[] = [];
  private readonly breakerBoxes: Box3[];
  private body: RAPIER.RigidBody | null = null;
  private lampMaterials: { green: THREE.Material; red: THREE.Material } | null = null;
  private disposed = false;

  private constructor(
    private readonly layout: FacilityLayout,
    private readonly world: FacilityWorld,
    private readonly nav: FacilityNav | null,
    private readonly options: ObjectsOptions,
  ) {
    this.group.name = 'facility-objects';
    this.doors = facilityDoors(layout);
    this.power = facilityPower(layout);
    this.state = new FacilityObjectState(this.doors.map(door => !door.startsClosed), this.power.breakers.length);
    this.breakerBoxes = this.power.breakers.map(breaker => {
      const alongX = breaker.nx === 0;
      return { cx: breaker.x, cy: breaker.y, cz: breaker.z,
        hx: alongX ? PANEL_PICK_HALF.along : PANEL_PICK_HALF.out, hy: PANEL_PICK_HALF.up,
        hz: alongX ? PANEL_PICK_HALF.out : PANEL_PICK_HALF.along };
    });
  }

  static build(layout: FacilityLayout, world: FacilityWorld, nav: FacilityNav | null, options: ObjectsOptions): FacilityObjects {
    const objects = new FacilityObjects(layout, world, nav, options);
    try {
      objects.lampMaterials = {
        green: objects.ownMaterial(new THREE.MeshBasicMaterial({ name: 'facility-status-green', color: LAMP_GREEN, toneMapped: false })),
        red: objects.ownMaterial(new THREE.MeshBasicMaterial({ name: 'facility-status-red', color: LAMP_RED, toneMapped: false })),
      };
      objects.body = options.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      for (const door of objects.doors) objects.addDoor(door);
      for (const breaker of objects.power.breakers) objects.addBreaker(breaker);
      nav?.setDoorCrossings(doorCrossings(objects.doors, layout.size));
      for (const door of objects.doors) nav?.setDoorClosed(door.id, door.startsClosed);
      options.scene.add(objects.group);
      return objects;
    } catch (error) {
      objects.dispose();
      throw error;
    }
  }

  private ownMaterial<T extends THREE.Material>(material: T): T {
    this.materials.add(material);
    return material;
  }

  /** A box whose faces tile the structure texture at its real size, like the static geometry. */
  private box(width: number, height: number, depth: number, key: StructureMaterialKey): THREE.BoxGeometry {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute, tile = STRUCTURE_TILE_METRES[key];
    // BoxGeometry's faces, 4 vertices each: +x, -x, +y, -y, +z, -z.
    const faces = [[depth, height], [depth, height], [width, depth], [width, depth], [width, height], [width, height]];
    for (let v = 0; v < uv.count; v++) {
      const [u, w] = faces[Math.floor(v / 4)]!;
      uv.setXY(v, uv.getX(v) * u! / tile, uv.getY(v) * w! / tile);
    }
    this.geometries.add(geometry);
    return geometry;
  }

  private addDoor(door: FacilityDoor): void {
    const shared = getStructureMaterials();
    const look: SlidingDoorLook = {
      box: (width, height, depth, key) => this.box(width, height, depth, key),
      statusLamp: () => {
        const geometry = new THREE.BoxGeometry(0.16, 0.05, 0.02);
        this.geometries.add(geometry);
        return geometry;
      },
      steel: shared.steel, hazard: shared.hazard, green: this.lampMaterials!.green, red: this.lampMaterials!.red,
    };
    const view = new SlidingDoorView(door, look, this.options.physics.world, this.body!, door.startsClosed);
    view.root.name = `facility-door-${door.id}`;
    this.doorViews.push(view);
    this.group.add(view.root);
  }

  private addBreaker(breaker: FacilityBreaker): void {
    const shared = getStructureMaterials();
    const root = new THREE.Group();
    root.name = `facility-breaker-${breaker.id}`;
    root.position.set(breaker.x, breaker.y, breaker.z);
    // Local +z is the wall's normal, out into the room.
    root.rotation.y = Math.atan2(breaker.nx, breaker.nz);
    const panel = new THREE.Mesh(this.box(PANEL.width, PANEL.height, PANEL.depth, 'cladding'), shared.cladding);
    const label = new THREE.Mesh(this.box(PANEL.width, 0.07, PANEL.depth + 0.006, 'hazard'), shared.hazard);
    label.position.y = PANEL.height / 2 - 0.035;
    const pivot = new THREE.Group();
    pivot.position.set(-0.08, -0.08, PANEL.depth / 2);
    const handle = new THREE.Mesh(this.box(0.05, 0.24, 0.05, 'steel'), shared.steel);
    handle.position.y = 0.12;
    pivot.add(handle);
    const lampGeometry = new THREE.BoxGeometry(0.08, 0.08, 0.03);
    this.geometries.add(lampGeometry);
    const lamp = new THREE.Mesh(lampGeometry, this.lampMaterials!.green);
    lamp.position.set(0.14, 0.12, PANEL.depth / 2 + 0.01);
    for (const mesh of [panel, label, handle]) { mesh.castShadow = true; mesh.receiveShadow = true; }
    root.add(panel, label, pivot, lamp);
    this.group.add(root);
    const view: BreakerView = { lever: pivot, lamp };
    this.breakerViews.push(view);
    this.showBreaker(breaker.id);
  }

  private showBreaker(id: number): void {
    const view = this.breakerViews[id], on = this.state.isActive('breaker', id);
    if (!view) return;
    // Lever up and out when on, down when off.
    view.lever.rotation.x = on ? 0.5 : Math.PI - 0.5;
    view.lamp.material = on ? this.lampMaterials!.green : this.lampMaterials!.red;
  }

  /**
   * Sets one door or breaker. A door's collider and the enemies' flow field follow at once (gameplay
   * never waits for the leaves); its leaves slide over FACILITY_DOOR_SLIDE_SECONDS, or jump there
   * when `instant` (a late joiner, a reset). A breaker darkens or relights every panel lamp of its
   * zone that was not shot out; emergency lamps stay lit. True when it changed.
   */
  set(kind: WorldObjectKind, id: number, active: boolean, instant = false): boolean {
    if (this.disposed || !this.state.set(kind, id, active)) return false;
    this.show(kind, id, instant);
    return true;
  }

  private show(kind: WorldObjectKind, id: number, instant: boolean): void {
    if (kind === 'breaker') {
      this.showBreaker(id);
      const on = this.state.isActive('breaker', id);
      this.layout.lamps.forEach((lamp, index) => {
        if (lamp.kind !== 'emergency' && this.power.lampZone[index] === id) this.world.setLampPowered(index, on);
      });
      return;
    }
    const closed = !this.state.isActive('door', id);
    this.doorViews[id]!.show(closed, instant);
    this.nav?.setDoorClosed(id, closed);
  }

  /** Adopts a whole state (the host's worldObjectState, a welcome). Returns what changed. */
  applyWire(wire: WorldObjectWire, instant = false): WorldObjectChanges {
    if (this.disposed) return { doors: [], breakers: [] };
    return this.showChanges(this.state.apply(wire), instant);
  }

  /** Back to the match's start, at once (a single-player Restart). */
  reset(): WorldObjectChanges {
    if (this.disposed) return { doors: [], breakers: [] };
    return this.showChanges(this.state.reset(), true);
  }

  private showChanges(changes: WorldObjectChanges, instant: boolean): WorldObjectChanges {
    for (const id of changes.doors) this.show('door', id, instant);
    for (const id of changes.breakers) this.show('breaker', id, instant);
    return changes;
  }

  wire(): WorldObjectWire {
    return this.state.encode();
  }

  parseWire(value: unknown): WorldObjectWire | null {
    return parseWorldObjectWire(value, this.doors.length, this.power.breakers.length);
  }

  /** Where a door or panel sits: the door's centre at mid height, or the panel's centre. */
  position(kind: WorldObjectKind, id: number): THREE.Vector3 | null {
    if (!this.state.has(kind, id)) return null;
    if (kind === 'door') { const door = this.doors[id]!; return new THREE.Vector3(door.x, door.height / 2, door.z); }
    const breaker = this.power.breakers[id]!;
    return new THREE.Vector3(breaker.x, breaker.y, breaker.z);
  }

  /** Horizontal distance from (x, z) to a door's opening (its centre line) or a panel. */
  distanceTo(kind: WorldObjectKind, id: number, x: number, z: number): number {
    if (!this.state.has(kind, id)) return Infinity;
    if (kind === 'breaker') { const breaker = this.power.breakers[id]!; return Math.hypot(x - breaker.x, z - breaker.z); }
    return distanceToDoor(this.doors[id]!, x, z);
  }

  /** The nearest door or breaker panel a ray crosses within maxDistance, or null. */
  pick(origin: THREE.Vector3Like, direction: THREE.Vector3Like, maxDistance: number): { kind: WorldObjectKind; id: number; distance: number } | null {
    if (this.disposed) return null;
    let best: { kind: WorldObjectKind; id: number; distance: number } | null = null;
    const test = (kind: WorldObjectKind, id: number, box: Box3): void => {
      const distance = rayBoxDistance(box, origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, maxDistance);
      if (distance < (best?.distance ?? Infinity)) best = { kind, id, distance };
    };
    this.doors.forEach(door => test('door', door.id, doorPickBox(door)));
    this.breakerBoxes.forEach((box, id) => test('breaker', id, box));
    return best;
  }

  /** The closed door an enemy at (x, z) walking along (dirX, dirZ) is about to reach, or -1. */
  closedDoorAhead(x: number, z: number, dirX: number, dirZ: number): number {
    const toX = x + dirX * ENEMY_DOOR_LOOKAHEAD, toZ = z + dirZ * ENEMY_DOOR_LOOKAHEAD;
    for (const door of this.doors) {
      if (this.state.isActive('door', door.id)) continue;
      if (segmentCrossesDoor(door, x, z, toX, toZ)) return door.id;
    }
    return -1;
  }

  /** Whether any of the given bodies stands where door `id`'s leaves would close. */
  doorwayOccupied(id: number, bodies: Iterable<{ x: number; z: number }>, radius: number): boolean {
    const door = this.doors[id];
    if (!door) return false;
    for (const body of bodies) if (bodyInDoorway(door, body.x, body.z, radius)) return true;
    return false;
  }

  /** The minimap's view (docs/facility-map.md, section 12): closed doors and every panel. */
  closedDoors(): FacilityDoor[] {
    return this.doors.filter(door => !this.state.isActive('door', door.id));
  }

  /** Debug API: how many doors and breakers there are and how many are shut or off. */
  counts(): { doors: number; closedDoors: number; breakers: number; breakersOff: number } {
    const breakers = this.power.breakers.length;
    return { doors: this.doors.length, closedDoors: this.closedDoors().length, breakers,
      breakersOff: this.power.breakers.filter(b => !this.state.isActive('breaker', b.id)).length };
  }

  breakerMarkers(): { x: number; z: number; floorX: number; floorZ: number; on: boolean }[] {
    return this.power.breakers.map(breaker => {
      const floor = cellCentre(breaker.floor.i, breaker.floor.j);
      return { x: breaker.x, z: breaker.z, floorX: floor.x, floorZ: floor.z, on: this.state.isActive('breaker', breaker.id) };
    });
  }

  /** Debug API: door `id` with its state, whether its collider is in the physics world, and a
   * walkable spot 2 m out on its corridor side (null when that spot is not walkable). */
  debugDoor(id: number): {
    x: number; z: number; axis: 'x' | 'z'; width: number; height: number; open: boolean; collider: boolean;
    front: { x: number; z: number } | null;
  } | null {
    const door = this.doors[id];
    if (!door) return null;
    const front = { x: door.x - (door.axis === 'x' ? door.side * 2 : 0), z: door.z - (door.axis === 'z' ? door.side * 2 : 0) };
    return { x: door.x, z: door.z, axis: door.axis, width: door.width, height: door.height,
      open: this.state.isActive('door', id), collider: this.doorViews[id]!.collider.isEnabled(),
      front: isWalkable(this.layout, front.x, front.z, 0.45) ? front : null };
  }

  /** Debug API: breaker `id`, its zone's lamps and how many of them are lit now. */
  debugBreaker(id: number): {
    x: number; y: number; z: number; on: boolean; panelLamps: number; panelLampsLit: number; emergencyLamps: number; emergencyLampsLit: number;
  } | null {
    const breaker = this.power.breakers[id];
    if (!breaker) return null;
    const counts = { panelLamps: 0, panelLampsLit: 0, emergencyLamps: 0, emergencyLampsLit: 0 };
    this.layout.lamps.forEach((lamp, index) => {
      if (this.power.lampZone[index] !== id) return;
      const lit = this.world.isLampLit(index) ? 1 : 0;
      if (lamp.kind === 'emergency') { counts.emergencyLamps++; counts.emergencyLampsLit += lit; }
      else { counts.panelLamps++; counts.panelLampsLit += lit; }
    });
    return { x: breaker.x, y: breaker.y, z: breaker.z, on: this.state.isActive('breaker', id), ...counts };
  }

  /** Per tick: the leaves slide toward their door's state. */
  update(dt: number): void {
    if (this.disposed) return;
    const step = (Number.isFinite(dt) ? Math.max(0, dt) : 0) / FACILITY_DOOR_SLIDE_SECONDS;
    for (const view of this.doorViews) view.update(step);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    // Removing the body also removes the door colliders attached to it.
    if (this.body) this.options.physics.world.removeRigidBody(this.body);
    this.body = null;
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear(); this.materials.clear();
    this.group.clear();
  }
}
