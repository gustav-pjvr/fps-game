import * as THREE from 'three';

const MARKER_LIFETIME = 1.5;
const MAX_MARKERS = 24;

interface ActiveMarker {
  mesh: THREE.Mesh;
  remaining: number;
}

/** Fixed-size pool of transient hit markers so a long play session can't leak meshes into the scene. */
export class ImpactMarkers {
  private readonly active: ActiveMarker[] = [];
  private readonly geometry = new THREE.SphereGeometry(0.04, 6, 6);
  private readonly material = new THREE.MeshBasicMaterial({ color: 0x111111 });

  constructor(private readonly scene: THREE.Scene) {}

  spawn(point: THREE.Vector3): void {
    if (this.active.length >= MAX_MARKERS) {
      const oldest = this.active.shift();
      if (oldest) this.scene.remove(oldest.mesh);
    }
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.position.copy(point);
    this.scene.add(mesh);
    this.active.push({ mesh, remaining: MARKER_LIFETIME });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const marker = this.active[i];
      if (!marker) continue;
      marker.remaining -= dt;
      if (marker.remaining <= 0) {
        this.scene.remove(marker.mesh);
        this.active.splice(i, 1);
      }
    }
  }
}
