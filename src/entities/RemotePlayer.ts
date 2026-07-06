import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { allocateEntityId, type Entity } from './Entity.ts';
import type { Damageable } from '../combat/damage.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
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
 * prove the sync mechanism.
 *
 * Implements Damageable so WeaponManager's existing hitscan pipeline (isDamageable/takeDamage)
 * needs zero changes to hit this - but `takeDamage` doesn't apply damage locally at all: this
 * client has no authority over the opponent's health, only the opponent's own client does
 * (MULTIPLAYER_PLAN.md §3/§6). It just forwards to `onHit`, which Game.ts wires to send a
 * `damageEvent` across the network - the *receiving* client is what actually decrements its own
 * Player's health. The collider tracks the exact same damped position the mesh renders at (updated
 * every frame in `update()`), not the raw undamped network target - so what you see is
 * always what you can hit, with no invisible offset between the two. */
export class RemotePlayer implements Entity, Damageable {
  readonly id = allocateEntityId();
  readonly isDamageableTarget = true;
  readonly mesh: THREE.Mesh;

  private readonly rigidBody: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;

  private targetPosition: THREE.Vector3;
  private targetYaw: number;

  constructor(
    private readonly physics: PhysicsWorld,
    scene: THREE.Scene,
    initialPosition: THREE.Vector3,
    private readonly onHit: (amount: number) => void,
  ) {
    const geometry = new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 4, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0xd9483c, roughness: 0.7 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.position.copy(initialPosition);
    scene.add(this.mesh);

    this.targetPosition = initialPosition.clone();
    this.targetYaw = 0;

    // Kinematic, not simulated - this body only ever gets pushed to wherever the mesh already is
    // (see update()), it never falls, collides, or reacts to anything itself. It exists purely so
    // other colliders (the local player's hitscan raycasts) have something real to hit.
    const cylinderHalfHeight = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      initialPosition.x,
      initialPosition.y,
      initialPosition.z,
    );
    this.rigidBody = physics.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.capsule(cylinderHalfHeight, PLAYER_RADIUS);
    this.collider = physics.world.createCollider(colliderDesc, this.rigidBody);
    physics.registerCollider(this.collider, this);
  }

  /** Always false from this client's perspective - it has no authority over the opponent's health
   * (see the class comment), so there's nothing meaningful for a Damageable consumer to read here
   * beyond "never treat this as already dead." */
  get isDead(): boolean {
    return false;
  }

  takeDamage(amount: number, _hitColliderHandle: number): void {
    this.onHit(amount);
  }

  /** Called whenever a `playerSnapshot` message arrives - just records where the opponent should
   * be; `update()` is what actually moves the mesh there, smoothly, every rendered frame. */
  applySnapshot(x: number, y: number, z: number, yaw: number): void {
    this.targetPosition.set(x, y, z);
    this.targetYaw = yaw;
  }

  /** Snaps instantly instead of smoothing - for the moment a match starts or a player respawns:
   * the opponent didn't "walk" to their spawn point, they just appeared there, and damping across
   * that whole-map distance would read as a bizarre high-speed slide. */
  teleportTo(x: number, y: number, z: number): void {
    this.targetPosition.set(x, y, z);
    this.mesh.position.set(x, y, z);
    this.rigidBody.setNextKinematicTranslation({ x, y, z });
  }

  update(dt: number): void {
    this.mesh.position.x = THREE.MathUtils.damp(this.mesh.position.x, this.targetPosition.x, POSITION_DAMP_RATE, dt);
    this.mesh.position.y = THREE.MathUtils.damp(this.mesh.position.y, this.targetPosition.y, POSITION_DAMP_RATE, dt);
    this.mesh.position.z = THREE.MathUtils.damp(this.mesh.position.z, this.targetPosition.z, POSITION_DAMP_RATE, dt);
    this.mesh.rotation.y = THREE.MathUtils.damp(this.mesh.rotation.y, this.targetYaw, ROTATION_DAMP_RATE, dt);
    this.rigidBody.setNextKinematicTranslation(this.mesh.position);
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  dispose(scene: THREE.Scene): void {
    this.physics.unregisterCollider(this.collider);
    this.physics.world.removeCollider(this.collider, true);
    this.physics.world.removeRigidBody(this.rigidBody);
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
