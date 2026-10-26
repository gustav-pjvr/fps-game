import * as THREE from 'three';
import { ACCENT_CYAN } from '../../render/look.ts';
import type { ArcPrediction, Vec3 } from './grenadeFlight.ts';
import { GRENADE_RADIUS } from './grenadeTuning.ts';

/** Metres between the preview's dots along the path. */
export const ARC_DOT_SPACING = 0.32;
/** The first dot sits this far along the path from the hand, clear of the arm. */
export const ARC_DOT_START = 0.7;
const MAX_DOTS = 96;
const DOT_RADIUS = 0.028;
const RING_INNER = 0.3;
const RING_OUTER = 0.38;

/** Points every `spacing` metres along the polyline `points`, starting `start` metres in. */
export function resampleArc(points: readonly Vec3[], spacing: number, start: number, max = MAX_DOTS): Vec3[] {
  const result: Vec3[] = [];
  let next = start;
  let travelled = 0;
  for (let i = 1; i < points.length && result.length < max; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    while (length > 0 && next <= travelled + length && result.length < max) {
      const t = (next - travelled) / length;
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
      next += spacing;
    }
    travelled += length;
  }
  return result;
}

/**
 * While a grenade cooks: a dotted line along GrenadeSystem.arcPreview and a ring on the landing
 * point lying on the surface it lands on, in the HUD accent. Unlit (MeshBasicMaterial, so it never
 * changes the scene's light count) and depth-tested, so walls hide the part of the arc behind them.
 */
export class GrenadeArcPreview {
  private readonly dots: THREE.InstancedMesh;
  private readonly ring: THREE.Mesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly normal = new THREE.Vector3();
  private drawn: ArcPrediction | null = null;

  constructor(private readonly scene: THREE.Scene) {
    const material = new THREE.MeshBasicMaterial({ color: ACCENT_CYAN, fog: false, toneMapped: false, transparent: true, opacity: 0.9 });
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(DOT_RADIUS, 8, 6), material, MAX_DOTS);
    this.dots.name = 'grenade-arc-dots';
    // The instances move every frame: a cached bounding sphere would cull them wrongly.
    this.dots.frustumCulled = false;
    this.dots.count = 0;
    this.dots.visible = false;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(RING_INNER, RING_OUTER, 40),
      new THREE.MeshBasicMaterial({
        color: ACCENT_CYAN,
        fog: false,
        toneMapped: false,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.ring.name = 'grenade-arc-ring';
    this.ring.visible = false;
    scene.add(this.dots, this.ring);
  }

  /** `arc`: GrenadeSystem.arcPreview (null when nothing is cooking, which hides the preview). The
   * system makes a new prediction object a few times a second, so the same one needs no redraw. */
  update(arc: ArcPrediction | null): void {
    if (arc === this.drawn) return;
    this.drawn = arc;
    if (!arc) {
      this.dots.visible = false;
      this.ring.visible = false;
      return;
    }
    const positions = resampleArc(arc.points, ARC_DOT_SPACING, ARC_DOT_START);
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]!;
      this.dots.setMatrixAt(i, this.matrix.makeTranslation(p.x, p.y, p.z));
    }
    this.dots.count = positions.length;
    this.dots.instanceMatrix.needsUpdate = true;
    this.dots.visible = positions.length > 0;

    const landing = arc.landing;
    this.ring.visible = landing !== null;
    if (landing) {
      this.normal.set(landing.normal.x, landing.normal.y, landing.normal.z).normalize();
      // The landing point is the ball's centre at contact: the surface is GRENADE_RADIUS behind it.
      this.ring.position.set(landing.point.x, landing.point.y, landing.point.z).addScaledVector(this.normal, 0.01 - GRENADE_RADIUS);
      this.ring.quaternion.setFromUnitVectors(Z_AXIS, this.normal);
    }
  }

  dispose(): void {
    this.scene.remove(this.dots, this.ring);
    this.dots.geometry.dispose();
    (this.dots.material as THREE.Material).dispose();
    this.dots.dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
