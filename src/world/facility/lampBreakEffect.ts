import * as THREE from 'three';

const MAX_SPARKS = 96;
const MAX_SHARDS = 48;
const SPARKS_PER_BREAK = 16;
const SHARDS_PER_BREAK = 7;
const GRAVITY = 9.8;
/** Spark colour above 1 so it blooms (the Facility's bloom threshold is about 0.75). */
const SPARK_COLOR = new THREE.Color(4, 2.6, 1.1);
const SHARD_COLOR = new THREE.Color(0xd8ecff);

interface Particle {
  life: number;
  age: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  spin: THREE.Vector3;
}

function pool(count: number): Particle[] {
  return Array.from({ length: count }, () => ({ life: 0, age: 0, position: new THREE.Vector3(),
    velocity: new THREE.Vector3(), rotation: new THREE.Euler(), spin: new THREE.Vector3() }));
}

/**
 * A shot-out Facility lamp (docs/facility-map.md, section 11): a short burst of bright sparks and a
 * few glass shards that tumble to the floor. Two fixed instanced pools made up front, so a burst
 * never adds a draw call or compiles a shader mid-match; the oldest particles are reused when full.
 */
export class LampBreakEffect {
  private readonly sparks = pool(MAX_SPARKS);
  private readonly shards = pool(MAX_SHARDS);
  private readonly sparkMesh: THREE.InstancedMesh;
  private readonly shardMesh: THREE.InstancedMesh;
  private nextSpark = 0;
  private nextShard = 0;
  private live = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(private readonly scene: THREE.Scene) {
    this.sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ name: 'lamp-sparks', toneMapped: false, fog: false }), MAX_SPARKS);
    this.shardMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ name: 'lamp-shards', transparent: true, opacity: 0.7, depthWrite: false }), MAX_SHARDS);
    for (const [mesh, name] of [[this.sparkMesh, 'lamp-sparks'], [this.shardMesh, 'lamp-shards']] as const) {
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < mesh.count; i++) {
        mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
        mesh.setColorAt(i, this.color.setRGB(0, 0, 0));
      }
      scene.add(mesh);
    }
  }

  spawn(at: { x: number; y: number; z: number }): void {
    for (let n = 0; n < SPARKS_PER_BREAK; n++) {
      const p = this.sparks[this.nextSpark]!;
      this.nextSpark = (this.nextSpark + 1) % MAX_SPARKS;
      const angle = Math.random() * Math.PI * 2, out = 1 + Math.random() * 3.5;
      p.position.set(at.x, at.y - 0.05, at.z);
      p.velocity.set(Math.cos(angle) * out, -0.5 - Math.random() * 2.5, Math.sin(angle) * out);
      p.life = 0.3 + Math.random() * 0.45; p.age = 0;
    }
    for (let n = 0; n < SHARDS_PER_BREAK; n++) {
      const p = this.shards[this.nextShard]!;
      this.nextShard = (this.nextShard + 1) % MAX_SHARDS;
      p.position.set(at.x + (Math.random() - 0.5) * 0.6, at.y - 0.06, at.z + (Math.random() - 0.5) * 0.2);
      p.velocity.set((Math.random() - 0.5) * 1.2, -Math.random() * 0.8, (Math.random() - 0.5) * 1.2);
      p.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      p.spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      p.life = 1.8 + Math.random() * 0.6; p.age = 0;
    }
    this.live = Math.max(this.live, 1);
  }

  update(dt: number): void {
    if (!this.live || !(dt > 0)) return;
    const step = Math.min(dt, 0.1);
    let live = 0;
    this.sparks.forEach((p, i) => {
      if (p.age >= p.life) return;
      p.age += step;
      p.velocity.y -= GRAVITY * step;
      p.position.addScaledVector(p.velocity, step);
      if (p.position.y < 0.01) { p.position.y = 0.01; p.velocity.set(p.velocity.x * 0.3, Math.abs(p.velocity.y) * 0.25, p.velocity.z * 0.3); }
      const fade = Math.max(0, 1 - p.age / p.life), size = 0.035 * (0.4 + 0.6 * fade);
      this.matrix.compose(p.position, this.quaternion.identity(), this.scale.set(size, size, size * 2.2));
      this.sparkMesh.setMatrixAt(i, p.age >= p.life ? this.matrix.makeScale(0, 0, 0) : this.matrix);
      this.sparkMesh.setColorAt(i, this.color.copy(SPARK_COLOR).multiplyScalar(fade));
      if (p.age < p.life) live++;
    });
    this.shards.forEach((p, i) => {
      if (p.age >= p.life) return;
      p.age += step;
      if (p.position.y > 0.004) {
        p.velocity.y -= GRAVITY * step;
        p.position.addScaledVector(p.velocity, step);
        p.rotation.set(p.rotation.x + p.spin.x * step, p.rotation.y + p.spin.y * step, p.rotation.z + p.spin.z * step);
        // Lands flat on the floor and stays there until it fades.
        if (p.position.y <= 0.004) { p.position.y = 0.004; p.rotation.set(0, p.rotation.y, 0); }
      }
      const fade = Math.min(1, (p.life - p.age) / 0.4);
      this.matrix.compose(p.position, this.quaternion.setFromEuler(p.rotation), this.scale.set(0.07 * fade, 0.004, 0.045 * fade));
      this.shardMesh.setMatrixAt(i, p.age >= p.life ? this.matrix.makeScale(0, 0, 0) : this.matrix);
      this.shardMesh.setColorAt(i, this.color.copy(SHARD_COLOR));
      if (p.age < p.life) live++;
    });
    this.live = live;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
    if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;
  }

  /** Ends every burst at once (a single-player Restart). */
  clear(): void {
    for (const p of [...this.sparks, ...this.shards]) p.age = p.life;
    this.sparks.forEach((_, i) => this.sparkMesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0)));
    this.shards.forEach((_, i) => this.shardMesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0)));
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    this.live = 0;
  }

  dispose(): void {
    for (const mesh of [this.sparkMesh, this.shardMesh]) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
