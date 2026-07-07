import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { allocateEntityId, type Entity } from './Entity.ts';
import type { Damageable } from '../combat/damage.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../core/config.ts';
import { ENEMY_MODEL_PATH } from './enemies/Enemy.ts';
import { loadGLTF } from '../core/AssetLoader.ts';

/** How quickly the visual mesh catches up to the latest received snapshot (MathUtils.damp's rate
 * parameter - larger closes the gap faster). Deliberately a damped follow rather than true
 * interpolation between the last two snapshots: with a 30Hz send rate, a snapshot arrives roughly
 * every 2 render frames, and dampening toward whatever the latest one is reads smoothly enough
 * without needing a second snapshot buffered and timestamped - a reasonable v1 simplification per
 * MULTIPLAYER_PLAN.md §7 (true interpolation is a documented possible refinement, not required to
 * prove movement sync works). Raised from 12 to 18 alongside the snapshot-rate increase (see
 * PLAYER_SNAPSHOT_SEND_INTERVAL's comment) - damping itself adds lag on top of the network delay
 * (it only ever asymptotically approaches the target, never instantly reaching it), and that stacked
 * with the old, slower snapshot rate was part of why hits against a moving target - especially at
 * sniper range - frequently missed a target that looked like it was standing right there. */
const POSITION_DAMP_RATE = 18;
const ROTATION_DAMP_RATE = 18;

/** Same model Enemy.ts uses (Kenney "Mini Characters", CC0) - the only downloaded character skin
 * this project has; there's no separate "player" model since the local player never sees their own
 * body (first-person). Reusing it means the opponent finally looks like an actual character
 * instead of the flat-red capsule placeholder this used to be. */
const MODEL_BIND_HEIGHT = 0.671;
const MODEL_SCALE = PLAYER_HEIGHT / MODEL_BIND_HEIGHT;

/** Below this squared distance moved in a frame, treat the opponent as standing still rather than
 * walking - damping technically never reaches exactly zero, so a raw "moved at all" check would
 * flicker between idle/walk while the opponent is stationary and floating-point noise nudges the
 * damped position by a hair each frame. */
const MOVING_THRESHOLD_SQ = 0.0004;

/** The opponent, as this client sees them - never simulated locally (no physics, no input), purely
 * a mesh driven by whatever the network last reported. See MULTIPLAYER_PLAN.md §3/§5.
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
  readonly mesh: THREE.Group;

  private readonly rigidBody: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private disposed = false;

  private readonly mixer: THREE.AnimationMixer;
  private readonly idleAction: THREE.AnimationAction | undefined;
  private readonly walkAction: THREE.AnimationAction | undefined;
  private isMoving = false;

  private targetPosition: THREE.Vector3;
  private targetYaw: number;

  private constructor(
    private readonly physics: PhysicsWorld,
    scene: THREE.Scene,
    initialPosition: THREE.Vector3,
    model: THREE.Group,
    mixer: THREE.AnimationMixer,
    idleAction: THREE.AnimationAction | undefined,
    walkAction: THREE.AnimationAction | undefined,
    private readonly onHit: (amount: number) => void,
  ) {
    this.mesh = new THREE.Group();
    this.mesh.add(model);
    this.mesh.position.copy(initialPosition);
    scene.add(this.mesh);

    this.mixer = mixer;
    this.idleAction = idleAction;
    this.walkAction = walkAction;
    this.idleAction?.play();

    this.targetPosition = initialPosition.clone();
    this.targetYaw = 0;

    // Kinematic, not simulated - this body only ever gets pushed to wherever the mesh already is
    // (see update()), it never falls, collides, or reacts to anything itself. It exists purely so
    // other colliders (the local player's hitscan raycasts) have something real to hit. Sized to
    // match the local player's own collision capsule (PLAYER_HEIGHT/PLAYER_RADIUS), not the visual
    // model's own silhouette - the model is cosmetic only, same as Enemy's.
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

  /** Async because the model has to be loaded (and cached - see AssetLoader.loadGLTF, shared with
   * Enemy so a match only ever fetches character-male-a.glb once regardless of how many
   * enemies/opponents end up using it). */
  static async create(
    physics: PhysicsWorld,
    scene: THREE.Scene,
    initialPosition: THREE.Vector3,
    onHit: (amount: number) => void,
  ): Promise<RemotePlayer> {
    const gltf = await loadGLTF(ENEMY_MODEL_PATH);

    // SkeletonUtils.clone (not Object3D.clone) is required for skinned meshes - see Enemy.ts's
    // identical comment; a plain clone would leave this instance's bones pointing at Enemy's (or
    // any other clone's) shared skeleton.
    const model = cloneSkeleton(gltf.scene) as THREE.Group;
    model.scale.setScalar(MODEL_SCALE);
    model.position.y = -PLAYER_HEIGHT / 2; // model origin is at its feet; group origin is capsule-center
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const mixer = new THREE.AnimationMixer(model);
    const idleClip = gltf.animations.find((clip) => clip.name === 'idle');
    const walkClip = gltf.animations.find((clip) => clip.name === 'walk');
    const idleAction = idleClip ? mixer.clipAction(idleClip) : undefined;
    const walkAction = walkClip ? mixer.clipAction(walkClip) : undefined;

    return new RemotePlayer(physics, scene, initialPosition, model, mixer, idleAction, walkAction, onHit);
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
   * be; `update()` is what actually moves the mesh there, smoothly, every rendered frame.
   *
   * `yaw` is `Player.facingYaw` - a camera-forward convention where yaw=0 means the *camera*
   * faces -Z (see Player.applyMovement's `forward = (0,0,-1).applyQuaternion(...)`). The model
   * itself faces +Z at rotation.y=0 (the same convention Enemy.ts's own atan2(dx,dz) facing logic
   * assumes), so applying the raw camera yaw directly showed the model facing exactly backwards -
   * the model's face turned away from wherever the real player was actually looking. The +π offset
   * corrects for that mismatch. */
  applySnapshot(x: number, y: number, z: number, yaw: number): void {
    this.targetPosition.set(x, y, z);
    this.targetYaw = yaw + Math.PI;
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
    const previousX = this.mesh.position.x;
    const previousZ = this.mesh.position.z;

    this.mesh.position.x = THREE.MathUtils.damp(this.mesh.position.x, this.targetPosition.x, POSITION_DAMP_RATE, dt);
    this.mesh.position.y = THREE.MathUtils.damp(this.mesh.position.y, this.targetPosition.y, POSITION_DAMP_RATE, dt);
    this.mesh.position.z = THREE.MathUtils.damp(this.mesh.position.z, this.targetPosition.z, POSITION_DAMP_RATE, dt);
    this.mesh.rotation.y = THREE.MathUtils.damp(this.mesh.rotation.y, this.targetYaw, ROTATION_DAMP_RATE, dt);
    this.rigidBody.setNextKinematicTranslation(this.mesh.position);

    const dx = this.mesh.position.x - previousX;
    const dz = this.mesh.position.z - previousZ;
    const isMoving = dx * dx + dz * dz > MOVING_THRESHOLD_SQ;
    if (isMoving !== this.isMoving) {
      this.isMoving = isMoving;
      const next = isMoving ? this.walkAction : this.idleAction;
      const previous = isMoving ? this.idleAction : this.walkAction;
      previous?.fadeOut(0.2);
      next?.reset().fadeIn(0.2).play();
    }
    this.mixer.update(dt);
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  /** Guarded against a second call - confirmed via a live 2-browser repro to be a real risk, not
   * theoretical: `Game.dispose()` disposes every RemotePlayer directly, then disposes the
   * PeerConnection a few lines later, and closing that connection can still fire an
   * `onPeerDisconnected` callback that was never silenced first (see App.ts's teardown-ordering
   * fix) - which calls `removeMultiplayerOpponent` -> this same `dispose()` a second time. Rapier
   * doesn't tolerate re-removing an already-removed rigid body/collider: the second call trapped
   * inside the WASM module itself (`RuntimeError: unreachable` in `removeRigidBody`), which is
   * unrecoverable for the rest of that page - explaining the "everything just hangs, only a reload
   * fixes it" symptom. This guard, plus the callback-silencing fix, close it from both ends. */
  dispose(scene: THREE.Scene): void {
    if (this.disposed) return;
    this.disposed = true;
    this.physics.unregisterCollider(this.collider);
    this.physics.world.removeCollider(this.collider, true);
    this.physics.world.removeRigidBody(this.rigidBody);
    scene.remove(this.mesh);
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
  }
}
