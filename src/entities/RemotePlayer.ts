import * as THREE from 'three';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../core/config.ts';

/** How quickly the visual mesh catches up to the latest received snapshot (MathUtils.damp's rate
 * parameter - larger closes the gap faster). Deliberately a damped follow rather than true
 * interpolation between the last two snapshots: with an 18Hz send rate, a snapshot arrives roughly
 * every 3-4 render frames, and dampening toward whatever the latest one is reads smoothly enough
 * without needing a second snapshot buffered and timestamped - a reasonable v1 simplification per
 * MULTIPLAYER_PLAN.md §7 (true interpolation is a documented possible refinement, not required to
 * prove movement sync works). */
const POSITION_DAMP_RATE = 12;
const ROTATION_DAMP_RATE = 12;

/** The opponent, as this client sees them - never simulated locally (no physics, no input), purely
 * a mesh driven by whatever the network last reported. See MULTIPLAYER_PLAN.md §3/§5. Visual is a
 * plain capsule placeholder for now, sized to match the local player's own collision capsule
 * (PLAYER_HEIGHT/PLAYER_RADIUS) - a real character model is a later polish pass, not required to
 * prove the sync mechanism. No Rapier collider yet either: hit detection against the opponent is
 * phase 3's concern (MULTIPLAYER_PLAN.md §7), and there's no reason to guess at that shape now. */
export class RemotePlayer {
  readonly mesh: THREE.Mesh;

  private targetPosition: THREE.Vector3;
  private targetYaw: number;

  constructor(scene: THREE.Scene, initialPosition: THREE.Vector3) {
    const geometry = new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 4, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0xd9483c, roughness: 0.7 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.position.copy(initialPosition);
    scene.add(this.mesh);

    this.targetPosition = initialPosition.clone();
    this.targetYaw = 0;
  }

  /** Called whenever a `playerSnapshot` message arrives - just records where the opponent should
   * be; `update()` is what actually moves the mesh there, smoothly, every rendered frame. */
  applySnapshot(x: number, y: number, z: number, yaw: number): void {
    this.targetPosition.set(x, y, z);
    this.targetYaw = yaw;
  }

  /** Snaps instantly instead of smoothing - for the moment a match starts (or, in a later phase, a
   * respawn): the opponent didn't "walk" to their spawn point, they just appeared there, and
   * damping across that whole-map distance would read as a bizarre high-speed slide. */
  teleportTo(x: number, y: number, z: number): void {
    this.targetPosition.set(x, y, z);
    this.mesh.position.set(x, y, z);
  }

  update(dt: number): void {
    this.mesh.position.x = THREE.MathUtils.damp(this.mesh.position.x, this.targetPosition.x, POSITION_DAMP_RATE, dt);
    this.mesh.position.y = THREE.MathUtils.damp(this.mesh.position.y, this.targetPosition.y, POSITION_DAMP_RATE, dt);
    this.mesh.position.z = THREE.MathUtils.damp(this.mesh.position.z, this.targetPosition.z, POSITION_DAMP_RATE, dt);
    this.mesh.rotation.y = THREE.MathUtils.damp(this.mesh.rotation.y, this.targetYaw, ROTATION_DAMP_RATE, dt);
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
