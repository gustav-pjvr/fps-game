import * as THREE from 'three';
import { buildGooseMesh, disposeProceduralMesh } from './Goose.ts';
import type { HillSite, HillSnapshot } from '../core/modeControllers/hillState.ts';

const GOLDEN_TINT = 0xffd54a;
const RING_SEGMENTS = 72;
const RING_WIDTH = 0.35;
/** How far the ring and its wall float above the ground, so they never fight the terrain. */
const LIFT = 0.12;
const WALL_HEIGHT = 0.9;
const BEACON_HEIGHT = 34;

/** Whose hill it reads as to this player. */
export type HillTone = 'open' | 'ours' | 'theirs' | 'contested';

const TONES: Readonly<Record<HillTone, number>> = { open: 0xe8a64a, ours: 0x6ff0dc, theirs: 0xff5a3c, contested: 0xf2f2f2 };

/** King of the Hill in the world: the hill's ring on the ground (it follows the terrain), a low
 * wall of light along it, a beacon that shows from across the map, a faint ring where the hill goes
 * next, and the golden goose that is the crown. Unlit, emissive-style materials only: the Facility
 * compiles its shaders for a fixed number of lights, so nothing here is a light. */
export class HillView {
  private readonly group = new THREE.Group();
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: TONES.open, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  private readonly wallMaterial = new THREE.MeshBasicMaterial({ color: TONES.open, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly beaconMaterial = new THREE.MeshBasicMaterial({ color: TONES.open, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly nextMaterial = new THREE.MeshBasicMaterial({ color: TONES.open, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
  private readonly ring = new THREE.Mesh(new THREE.BufferGeometry(), this.ringMaterial);
  private readonly wall = new THREE.Mesh(new THREE.BufferGeometry(), this.wallMaterial);
  private readonly beacon: THREE.Mesh;
  private readonly nextRing = new THREE.Mesh(new THREE.BufferGeometry(), this.nextMaterial);
  private readonly goose: THREE.Group;
  private shownHill: HillSite | null = null;
  private shownRadius = 0;
  private shownNext: HillSite | null = null;
  private time = 0;

  /** `groundAt` is the height of the ground at (x, z): the terrain on the Valley, the floor on the Facility. */
  constructor(private readonly scene: THREE.Scene, private readonly groundAt: (x: number, z: number) => number) {
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, BEACON_HEIGHT, 10, 1, true), this.beaconMaterial);
    this.goose = buildGooseMesh();
    this.goose.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        child.material.color.setHex(GOLDEN_TINT);
        child.material.emissive.setHex(GOLDEN_TINT);
        child.material.emissiveIntensity = 0.45;
      }
    });
    this.goose.scale.setScalar(1.25);
    this.nextRing.visible = false;
    for (const mesh of [this.ring, this.wall, this.beacon, this.nextRing]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
    }
    this.group.add(this.ring, this.wall, this.beacon, this.nextRing, this.goose);
    this.scene.add(this.group);
  }

  /** A strip `width` wide round (x, z) at `radius`, each vertex on the ground plus `lift`; with
   * `height` it stands up as a wall instead of lying flat. */
  private strip(site: HillSite, radius: number, width: number, height: number): THREE.BufferGeometry {
    const positions = new Float32Array((RING_SEGMENTS + 1) * 6);
    const index: number[] = [];
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const angle = (i / RING_SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const ox = site.x + cos * radius, oz = site.z + sin * radius;
      const ix = site.x + cos * (radius - width), iz = site.z + sin * (radius - width);
      const outerY = this.groundAt(ox, oz) + LIFT;
      const innerY = height > 0 ? outerY + height : this.groundAt(ix, iz) + LIFT;
      positions.set(height > 0 ? [ox, outerY, oz, ox, innerY, oz] : [ox, outerY, oz, ix, innerY, iz], i * 6);
      if (i < RING_SEGMENTS) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(index);
    return geometry;
  }

  private replace(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): void {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }

  /** Draws `state` as this player sees it. Rebuilds the rings only when the hill moves or shrinks. */
  update(dt: number, state: HillSnapshot, tone: HillTone): void {
    this.time += dt;
    const { hill, next, radius } = state;
    if (!this.shownHill || this.shownHill.x !== hill.x || this.shownHill.z !== hill.z || this.shownRadius !== radius) {
      this.shownHill = hill;
      this.shownRadius = radius;
      this.replace(this.ring, this.strip(hill, radius, RING_WIDTH, 0));
      this.replace(this.wall, this.strip(hill, radius, 0, WALL_HEIGHT));
      this.beacon.position.set(hill.x, this.groundAt(hill.x, hill.z) + BEACON_HEIGHT / 2, hill.z);
    }
    if (!this.shownNext || this.shownNext.x !== next.x || this.shownNext.z !== next.z) {
      this.shownNext = next;
      this.replace(this.nextRing, this.strip(next, radius, RING_WIDTH * 0.6, 0));
    }

    const colour = TONES[tone];
    // A contested hill flickers; any other breathes slowly.
    const pulse = tone === 'contested' ? 0.55 + 0.45 * Math.abs(Math.sin(this.time * 9)) : 0.82 + 0.18 * Math.sin(this.time * 2.2);
    this.ringMaterial.color.setHex(colour);
    this.ringMaterial.opacity = 0.9 * pulse;
    this.wallMaterial.color.setHex(colour);
    this.wallMaterial.opacity = 0.16 * pulse;
    this.beaconMaterial.color.setHex(colour);
    // The next hill shows only once the move is announced.
    this.nextRing.visible = state.moveIn <= 8;
    this.nextMaterial.opacity = 0.25 + 0.2 * Math.abs(Math.sin(this.time * 4));

    const crownAt = state.crownAt;
    this.goose.visible = crownAt !== null;
    if (crownAt) {
      this.goose.position.set(crownAt.x, this.groundAt(crownAt.x, crownAt.z) + 0.25 + Math.sin(this.time * 2.4) * 0.12, crownAt.z);
      this.goose.rotation.y = this.time * 1.2;
    }
  }

  /** The crown's place in the world while it lies free, for the marker above it. */
  crownPosition(state: HillSnapshot, out: THREE.Vector3): THREE.Vector3 | null {
    if (!state.crownAt) return null;
    return out.set(state.crownAt.x, this.groundAt(state.crownAt.x, state.crownAt.z) + 1.6, state.crownAt.z);
  }

  hillPosition(site: HillSite, out: THREE.Vector3): THREE.Vector3 {
    return out.set(site.x, this.groundAt(site.x, site.z) + 2.4, site.z);
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const mesh of [this.ring, this.wall, this.beacon, this.nextRing]) mesh.geometry.dispose();
    for (const material of [this.ringMaterial, this.wallMaterial, this.beaconMaterial, this.nextMaterial]) material.dispose();
    disposeProceduralMesh(this.goose);
  }
}
