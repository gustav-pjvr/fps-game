import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { DoorPlane } from '../doors/doorGeometry.ts';
import { HOUSE_DESIGNS } from '../houseDesigns.ts';
import { doorToWorld, houseToWorld } from './houseLayout.ts';
import { HouseLights } from './HouseLights.ts';
import { HouseNavigator } from './HouseNavigator.ts';
import { houseKey, houseObjectId, parseHouseObjectId, type HouseRef } from './valleyHouseIds.ts';
import { ValleyDoors } from './ValleyDoors.ts';

/** Interiors (furniture, partitions, the stair) are hidden past this distance from the camera. */
export const INTERIOR_DRAW_DISTANCE = 70;

/** Where a house stands, from the seeded town layout (BuildingManager.houseAt). */
export interface HousePlacement {
  readonly ref: HouseRef;
  /** Index into HOUSE_DESIGNS / HOUSE_LAYOUTS. */
  readonly design: number;
  readonly x: number;
  readonly groundY: number;
  readonly z: number;
  readonly rotationY: number;
}

interface LoadedHouse {
  readonly placement: HousePlacement;
  readonly key: number;
  readonly interior: THREE.Object3D;
  readonly lampIds: number[];
  readonly doorId: number;
}

/** The front door's slot in a house's object ids (world/houses/valleyHouseIds.ts). */
export const FRONT_DOOR_SLOT = 0;

/**
 * The enterable Valley houses at runtime (docs/enterable-buildings.md), owned by BuildingManager: as
 * each house streams in or out it adds or removes its door (ValleyDoors) and ceiling lamps
 * (HouseLights); per frame it hides far interiors and moves the lamp light pool. The door state and
 * the shot-out lamps outlive a house streaming out.
 */
export class ValleyHouses {
  readonly doors: ValleyDoors;
  readonly lights: HouseLights;
  /** The streamed-in houses' walk grids for the enemies (HouseNavigator.ts). */
  readonly nav = new HouseNavigator();
  private readonly loaded = new Map<string, LoadedHouse>();
  private readonly cameraPosition = new THREE.Vector3();

  /** `houseAt` answers for any house in the world, streamed in or not. */
  constructor(scene: THREE.Scene, world: RAPIER.World, private readonly houseAt: (ref: HouseRef) => HousePlacement | null, lampsOn: boolean) {
    this.doors = new ValleyDoors(scene, world, (id) => this.doorPlane(id));
    this.lights = new HouseLights(scene, lampsOn);
  }

  /** A house door's plane in the world, or null when `id` names no house door. */
  doorPlane(id: number): DoorPlane | null {
    const parsed = parseHouseObjectId(id);
    if (!parsed || parsed.slot !== FRONT_DOOR_SLOT) return null;
    const placement = this.houseAt(parsed.house);
    if (!placement) return null;
    const layout = HOUSE_DESIGNS[placement.design]?.layout;
    return layout ? doorToWorld(layout.door, placement.x, placement.groundY, placement.z, placement.rotationY) : null;
  }

  /** BuildingManager placed a house (`name` is its own id for it); `interior` is its interior group. */
  housePlaced(name: string, placement: HousePlacement, interior: THREE.Object3D): void {
    const key = houseKey(placement.ref), layout = HOUSE_DESIGNS[placement.design]?.layout;
    if (key < 0 || !layout || this.loaded.has(name)) return;
    const doorId = houseObjectId(key, FRONT_DOOR_SLOT);
    this.doors.addDoor(doorId, doorToWorld(layout.door, placement.x, placement.groundY, placement.z, placement.rotationY));
    const lampIds = layout.rooms.map((room, index) => {
      const id = houseObjectId(key, index);
      const at = houseToWorld(room.lamp.x, room.lamp.y, room.lamp.z, placement.x, placement.groundY, placement.z, placement.rotationY);
      this.lights.addLamp(id, at.x, at.y, at.z);
      return id;
    });
    this.loaded.set(name, { placement, key, interior, lampIds, doorId });
    this.nav.add(name, placement);
  }

  houseRemoved(name: string): void {
    const house = this.loaded.get(name);
    if (!house) return;
    this.doors.removeDoor(house.doorId);
    for (const id of house.lampIds) this.lights.removeLamp(id);
    this.loaded.delete(name);
    this.nav.remove(name);
  }

  /** Per frame, after the camera has moved. (Door leaves slide in the interaction's update.) */
  update(dt: number, camera: THREE.Camera): void {
    camera.getWorldPosition(this.cameraPosition);
    const far = INTERIOR_DRAW_DISTANCE * INTERIOR_DRAW_DISTANCE;
    for (const house of this.loaded.values()) {
      const dx = house.placement.x - this.cameraPosition.x, dz = house.placement.z - this.cameraPosition.z;
      house.interior.visible = dx * dx + dz * dz < far;
    }
    this.lights.update(dt, this.cameraPosition);
  }

  /** A player's own pellet: the streamed-in lamp it breaks before its physics hit, if any. Returns
   * the broken lamp's id and position, or null. */
  shootRay(origin: THREE.Vector3Like, direction: THREE.Vector3Like, distance: number): { id: number; x: number; y: number; z: number } | null {
    const id = this.lights.rayHitLamp(origin, direction, distance);
    const at = id >= 0 ? this.lights.killLamp(id) : null;
    return at ? { id, ...at } : null;
  }

  /** The minimap's houses (ui/valleyHouseMapLayer.ts): every streamed-in house with its door state. */
  *mapHouses(): Iterable<{ key: number; design: number; x: number; z: number; rotationY: number; doorOpen: boolean }> {
    for (const house of this.loaded.values()) {
      const { placement } = house;
      yield { key: house.key, design: placement.design, x: placement.x, z: placement.z, rotationY: placement.rotationY, doorOpen: this.doors.state.isActive('door', house.doorId) };
    }
  }

  /** Debug API: every streamed-in house with its design, placement, door and lamps. */
  debugHouses(): {
    name: string; design: string; x: number; y: number; z: number; rotationY: number;
    doorId: number; doorOpen: boolean; lamps: { id: number; lit: boolean }[]; interiorVisible: boolean;
    rooms: { name: string; x: number; y: number; z: number }[];
  }[] {
    return [...this.loaded].map(([name, house]) => {
      const { placement } = house, layout = HOUSE_DESIGNS[placement.design]!.layout;
      return {
        name, design: layout.name, x: placement.x, y: placement.groundY, z: placement.z, rotationY: placement.rotationY,
        doorId: house.doorId, doorOpen: this.doors.state.isActive('door', house.doorId),
        lamps: house.lampIds.map((id) => ({ id, lit: this.lights.isLit(id) })),
        interiorVisible: house.interior.visible,
        // Each room's middle at floor level, in the world: somewhere to stand inside it.
        rooms: layout.rooms.map((room) => ({ name: room.name, ...houseToWorld((room.bounds.minX + room.bounds.maxX) / 2, room.bounds.minY, (room.bounds.minZ + room.bounds.maxZ) / 2, placement.x, placement.groundY, placement.z, placement.rotationY) })),
      };
    });
  }

  dispose(): void {
    this.doors.dispose();
    this.lights.dispose();
    this.loaded.clear();
    this.nav.clear();
  }
}
