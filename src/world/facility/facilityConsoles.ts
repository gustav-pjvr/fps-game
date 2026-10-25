import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { ACCENT_CYAN } from '../../render/look.ts';
import { box, createBoxCollider } from '../structureKit.ts';

/** Top of a console's beacon cap above the floor: the indoor uplink beams rise from here. */
export const FACILITY_CONSOLE_HEIGHT = 1.35;
const BODY = { width: 0.9, height: 1.05, depth: 0.6 };

/**
 * The Uplink mission's consoles on the Facility (docs/facility-map.md, "Modes on the Facility"):
 * a dark steel cabinet with a lit screen and a beacon cap on top, one at each mission point, solid
 * to walk into. Lit like other movable things (the probe-tinted fill and the torch) and lit up by
 * emissive meshes only: the Facility's materials compile for a fixed number of lights, so nothing
 * here adds one. The beam over each cap is UplinkBeacons' own.
 */
export class FacilityConsoles {
  private readonly root = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private body: RAPIER.RigidBody | null;

  constructor(private readonly scene: THREE.Scene, private readonly physics: PhysicsWorld, points: readonly { x: number; z: number }[]) {
    this.root.name = 'facility-consoles';
    const cabinetGeometry = new THREE.BoxGeometry(BODY.width, BODY.height, BODY.depth);
    const screenGeometry = new THREE.PlaneGeometry(BODY.width * 0.75, 0.42);
    const capGeometry = new THREE.CylinderGeometry(0.12, 0.16, FACILITY_CONSOLE_HEIGHT - BODY.height, 12);
    const cabinet = new THREE.MeshStandardMaterial({ name: 'facility-console', color: 0x2b3038, roughness: 0.55, metalness: 0.6 });
    const screen = new THREE.MeshBasicMaterial({ name: 'facility-console-screen', color: ACCENT_CYAN, toneMapped: false });
    const cap = new THREE.MeshBasicMaterial({ name: 'facility-console-cap', color: 0xffd2a0, toneMapped: false });
    this.geometries.push(cabinetGeometry, screenGeometry, capGeometry);
    this.materials.push(cabinet, screen, cap);

    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const { x, z } of points) {
      const unit = new THREE.Group();
      unit.position.set(x, 0, z);
      const cabinetMesh = new THREE.Mesh(cabinetGeometry, cabinet);
      cabinetMesh.position.y = BODY.height / 2;
      cabinetMesh.castShadow = true;
      cabinetMesh.receiveShadow = true;
      // On both long faces, so it reads from either side of the room.
      for (const side of [1, -1]) {
        const screenMesh = new THREE.Mesh(screenGeometry, screen);
        screenMesh.position.set(0, BODY.height * 0.68, side * (BODY.depth / 2 + 0.005));
        screenMesh.rotation.y = side > 0 ? 0 : Math.PI;
        unit.add(screenMesh);
      }
      const capMesh = new THREE.Mesh(capGeometry, cap);
      capMesh.position.y = (BODY.height + FACILITY_CONSOLE_HEIGHT) / 2;
      unit.add(cabinetMesh, capMesh);
      this.root.add(unit);
      createBoxCollider(physics.world, this.body, box(x, BODY.height / 2, z, BODY.width, BODY.height, BODY.depth));
    }
    scene.add(this.root);
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    // Removing the fixed body also removes its colliders.
    if (this.body) this.physics.world.removeRigidBody(this.body);
    this.body = null;
  }
}
