import * as THREE from 'three';

const FLASH_COLOR = 0xffb347;
const BURST_DURATION = 0.6;
const DEBRIS_COUNT = 10;
const DEBRIS_GRAVITY = 9;

interface ActiveBurst {
  readonly sphere: THREE.Mesh;
  readonly light: THREE.PointLight;
  readonly debris: THREE.Mesh[];
  readonly debrisVelocity: THREE.Vector3[];
  readonly maxScale: number;
  elapsed: number;
}

/** Procedural explosion VFX (spawn/update convention mirrors MuzzleFlash/Tracers) - an expanding
 * emissive sphere, a brief point-light flash, and a handful of debris cubes flung outward with
 * simple velocity/gravity. No AOE weapon existed before the goose, so there was nothing to reuse
 * here - this is new. Visual size scales with the active difficulty's blast radius so Easy/Normal/
 * Extreme read as visibly different explosions. */
export class ExplosionEffect {
  private readonly active: ActiveBurst[] = [];
  private readonly sphereGeometry = new THREE.SphereGeometry(1, 12, 8);
  private readonly debrisGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  private readonly sphereMaterial = new THREE.MeshBasicMaterial({
    color: FLASH_COLOR,
    transparent: true,
    depthWrite: false,
  });
  private readonly debrisMaterial = new THREE.MeshBasicMaterial({ color: 0x3a2a1a });

  constructor(private readonly scene: THREE.Scene) {}

  spawn(position: THREE.Vector3, radius: number): void {
    const material = this.sphereMaterial.clone();
    const sphere = new THREE.Mesh(this.sphereGeometry, material);
    sphere.position.copy(position);
    sphere.scale.setScalar(0.01);
    this.scene.add(sphere);

    const light = new THREE.PointLight(FLASH_COLOR, radius * 8, radius * 4);
    light.position.copy(position);
    this.scene.add(light);

    const debris: THREE.Mesh[] = [];
    const debrisVelocity: THREE.Vector3[] = [];
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const mesh = new THREE.Mesh(this.debrisGeometry, this.debrisMaterial);
      mesh.position.copy(position);
      this.scene.add(mesh);
      debris.push(mesh);

      const angle = (i / DEBRIS_COUNT) * Math.PI * 2;
      const speed = radius * (1.5 + Math.random());
      debrisVelocity.push(new THREE.Vector3(Math.cos(angle) * speed, speed * 0.8, Math.sin(angle) * speed));
    }

    this.active.push({ sphere, light, debris, debrisVelocity, maxScale: radius, elapsed: 0 });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const burst = this.active[i];
      if (!burst) continue;

      burst.elapsed += dt;
      const t = Math.min(1, burst.elapsed / BURST_DURATION);

      const scale = THREE.MathUtils.lerp(0.2, burst.maxScale, THREE.MathUtils.smoothstep(t, 0, 0.3));
      burst.sphere.scale.setScalar(scale);
      (burst.sphere.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      burst.light.intensity = burst.maxScale * 8 * (1 - t);

      for (let d = 0; d < burst.debris.length; d++) {
        const mesh = burst.debris[d];
        const velocity = burst.debrisVelocity[d];
        if (!mesh || !velocity) continue;
        velocity.y -= DEBRIS_GRAVITY * dt;
        mesh.position.addScaledVector(velocity, dt);
      }

      if (t >= 1) {
        this.scene.remove(burst.sphere, burst.light, ...burst.debris);
        (burst.sphere.material as THREE.MeshBasicMaterial).dispose();
        this.active.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const burst of this.active) {
      this.scene.remove(burst.sphere, burst.light, ...burst.debris);
      (burst.sphere.material as THREE.MeshBasicMaterial).dispose();
    }
    this.active.length = 0;
  }
}
