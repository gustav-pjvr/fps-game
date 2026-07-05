import * as THREE from 'three';
import { TRACER_COLOR, TRACER_LENGTH, TRACER_SPEED } from '../core/config.ts';

interface ActiveTracer {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  end: THREE.Vector3;
  elapsed: number;
  duration: number;
}

/** A short streak that visually travels from muzzle to impact point - purely cosmetic, the hit already landed. */
export class Tracers {
  private readonly active: ActiveTracer[] = [];
  private readonly geometry: THREE.CylinderGeometry;
  private readonly material = new THREE.MeshBasicMaterial({ color: TRACER_COLOR });
  private readonly materialsByColor = new Map<number, THREE.MeshBasicMaterial>();

  constructor(private readonly scene: THREE.Scene) {
    this.geometry = new THREE.CylinderGeometry(0.015, 0.015, TRACER_LENGTH, 6);
    this.geometry.rotateX(Math.PI / 2);
  }

  /** `color` defaults to the player's own tracer color - enemy fire (fair combat, Phase C) passes a
   * distinct color so the player has a real visual signal of incoming shots, not just a health bar
   * tick. */
  spawn(start: THREE.Vector3, end: THREE.Vector3, color?: number): void {
    const distance = start.distanceTo(end);
    const duration = Math.max(0.03, distance / TRACER_SPEED);

    const material = color === undefined ? this.material : this.materialFor(color);
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.position.copy(start);
    mesh.lookAt(end);
    this.scene.add(mesh);

    this.active.push({ mesh, start, end, elapsed: 0, duration });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const tracer = this.active[i];
      if (!tracer) continue;

      tracer.elapsed += dt;
      const t = Math.min(1, tracer.elapsed / tracer.duration);
      tracer.mesh.position.lerpVectors(tracer.start, tracer.end, t);

      if (t >= 1) {
        this.scene.remove(tracer.mesh);
        this.active.splice(i, 1);
      }
    }
  }

  private materialFor(color: number): THREE.MeshBasicMaterial {
    let material = this.materialsByColor.get(color);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color });
      this.materialsByColor.set(color, material);
    }
    return material;
  }

  clear(): void {
    for (const tracer of this.active) {
      this.scene.remove(tracer.mesh);
    }
    this.active.length = 0;
  }
}
