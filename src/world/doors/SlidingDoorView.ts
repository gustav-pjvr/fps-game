import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { DoorPlane } from './doorGeometry.ts';

/** Leaf thickness and how far the leaves sit toward the outside of the room, so an open leaf is
 * inside the wall's mass rather than proud of the room's wall. */
const LEAF_DEPTH = 0.06;
const LEAF_SHIFT = 0.04;
/** Half the thickness of a closed door's collider. */
const COLLIDER_HALF_DEPTH = 0.08;

/** What a door is drawn with. The owner keeps (and disposes) every geometry and material. */
export interface SlidingDoorLook {
  /** A box whose faces tile a structure texture at its real size. */
  box(width: number, height: number, depth: number, key: 'steel' | 'hazard'): THREE.BufferGeometry;
  /** The small status lamp's box (0.16 x 0.05 x 0.02 m). */
  statusLamp(): THREE.BufferGeometry;
  readonly steel: THREE.Material;
  readonly hazard: THREE.Material;
  /** Status lamp: green open, red closed. */
  readonly green: THREE.Material;
  readonly red: THREE.Material;
}

/**
 * One sliding steel door in the world (shared by the Facility and the Valley houses): two leaves
 * with a hazard stripe that slide half a width each into the wall, a status lamp on each face of the
 * header, and a collider that exists only while the door is shut (it blocks players, bullets,
 * grenades and enemy sight). The collider and lamps follow a state at once (gameplay never waits for
 * the leaves); the leaves ease there over a full travel.
 */
export class SlidingDoorView {
  readonly root = new THREE.Group();
  readonly collider: RAPIER.Collider;
  private readonly leaves: [THREE.Object3D, THREE.Object3D];
  private readonly lamps: THREE.Mesh[];
  /** 0 open to 1 shut. */
  private progress: number;
  private closed: boolean;

  /** `body` carries the collider in the same frame as `door`; the caller adds `root` to a parent in
   * that frame. */
  constructor(private readonly door: DoorPlane, private readonly look: SlidingDoorLook, world: RAPIER.World, body: RAPIER.RigidBody, closed: boolean) {
    this.closed = closed;
    this.progress = closed ? 1 : 0;
    const root = this.root;
    root.position.set(door.x, door.y ?? 0, door.z);
    // Local x runs along the opening and local z across it, toward the room on +side.
    if (door.axis === 'x') root.rotation.y = Math.PI / 2;
    const toRoom = door.side;
    const leafWidth = door.width / 2 + 0.02;
    const leafGeometry = look.box(leafWidth, door.height, LEAF_DEPTH, 'steel');
    const stripeGeometry = look.box(leafWidth, 0.28, LEAF_DEPTH + 0.008, 'hazard');
    const makeLeaf = (end: number): THREE.Object3D => {
      const leaf = new THREE.Group();
      const panel = new THREE.Mesh(leafGeometry, look.steel);
      panel.position.y = door.height / 2;
      const stripe = new THREE.Mesh(stripeGeometry, look.hazard);
      stripe.position.y = 0.14;
      for (const mesh of [panel, stripe]) { mesh.castShadow = true; mesh.receiveShadow = true; }
      leaf.add(panel, stripe);
      leaf.position.set(end * door.width / 4, 0, -toRoom * LEAF_SHIFT);
      leaf.userData.end = end;
      root.add(leaf);
      return leaf;
    };
    this.leaves = [makeLeaf(-1), makeLeaf(1)];
    const lampGeometry = look.statusLamp();
    this.lamps = [-1, 1].map(face => {
      const lamp = new THREE.Mesh(lampGeometry, closed ? look.red : look.green);
      lamp.position.set(0, door.height + 0.06, face * 0.09);
      root.add(lamp);
      return lamp;
    });
    const desc = RAPIER.ColliderDesc.cuboid(door.axis === 'x' ? COLLIDER_HALF_DEPTH : door.width / 2, door.height / 2,
      door.axis === 'x' ? door.width / 2 : COLLIDER_HALF_DEPTH).setTranslation(door.x, (door.y ?? 0) + door.height / 2, door.z);
    this.collider = world.createCollider(desc, body);
    this.collider.setEnabled(closed);
    this.placeLeaves();
  }

  get isClosed(): boolean { return this.closed; }

  /** Shows a state: the collider and status lamps at once; the leaves slide there (see update), or
   * jump there when `instant` (a late joiner, a reset, a house streaming in). */
  show(closed: boolean, instant: boolean): void {
    this.closed = closed;
    this.collider.setEnabled(closed);
    for (const lamp of this.lamps) lamp.material = closed ? this.look.red : this.look.green;
    if (instant) { this.progress = closed ? 1 : 0; this.placeLeaves(); }
  }

  /** Per tick: the leaves move `step` of a full travel toward the state. */
  update(step: number): void {
    const target = this.closed ? 1 : 0;
    if (this.progress === target) return;
    this.progress = target > this.progress ? Math.min(target, this.progress + step) : Math.max(target, this.progress - step);
    this.placeLeaves();
  }

  /** Takes the door out of the world: its meshes leave their parent, its collider the physics world.
   * Geometry and materials belong to the look's owner. */
  remove(world: RAPIER.World): void {
    this.root.removeFromParent();
    if (world.getCollider(this.collider.handle)) world.removeCollider(this.collider, false);
  }

  private placeLeaves(): void {
    // Shut, each leaf covers its half of the opening; open, it has slid a half width into the wall.
    const t = this.progress * this.progress * (3 - 2 * this.progress), width = this.door.width;
    for (const leaf of this.leaves) {
      const end = leaf.userData.end as number;
      leaf.position.x = end * (width / 4 + (1 - t) * width / 2);
    }
  }
}
