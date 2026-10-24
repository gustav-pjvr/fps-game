import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { allocateEntityId, type Entity } from './Entity.ts';
import type { Damageable } from '../combat/damage.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { HEADSHOT_MULTIPLIER, PLAYER_HEIGHT } from '../core/config.ts';
import { createHitColliders, PLAYER_HIT_SHAPE, yawRotation } from './characterHitbox.ts';
import { instantiateCharacter, PLAYER_CHARACTER } from './characterModels.ts';
import { loadGLTF } from '../core/AssetLoader.ts';
import { RemoteMotion } from './remoteMotion.ts';

/** Dead reckoning uses recent horizontal speed to damp toward where the opponent likely is now.
 * Capped lead limits overshoot when movement changes, and stale snapshots stop prediction.
 * Vertical movement still follows the last received height to avoid predicting jumps or falls. */
const POSITION_DAMP_RATE = 25;
const VERTICAL_DAMP_RATE = 18;
const ROTATION_DAMP_RATE = 18;
/** The torch lens (docs/facility-map.md, section 7): chest high, a little to the right of the
 * model's own forward (+Z), where the first-person torch sits on the gun. */
const TORCH_LENS_POSITION = new THREE.Vector3(-0.18, 0.5, 0.32);
const TORCH_LENS_GLOW = 4;


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
  private readonly bodyCollider: RAPIER.Collider;
  private readonly headCollider: RAPIER.Collider;
  private disposed = false;

  private readonly mixer: THREE.AnimationMixer;
  private readonly idleAction: THREE.AnimationAction | undefined;
  private readonly walkAction: THREE.AnimationAction | undefined;
  private isMoving = false;

  private readonly motion: RemoteMotion;
  private readonly predictedPosition = new THREE.Vector3();
  private targetYaw: number;
  /** The look pitch from their snapshots, damped like the yaw; their torch aims with it. */
  private targetPitch = 0;
  private pitch = 0;
  /** Facility only: their torch, lit unless their snapshots say otherwise. Null until the first
   * setTorch, so the Valley never builds a lens. */
  private torchLens: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial> | null = null;
  private torchLit = false;

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

    this.motion = new RemoteMotion(initialPosition.x, initialPosition.y, initialPosition.z);
    this.targetYaw = 0;

    // Kinematic, not simulated - this body only ever gets pushed to wherever the mesh already is
    // (see update()), it never falls, collides, or reacts to anything itself. It exists purely so
    // other colliders (the local player's hitscan raycasts) have something real to hit. Its body and
    // head shapes are fitted to the spacesuit character (characterHitbox.ts), the same way Enemy's
    // are to the SWAT kit; it turns with the model so the head sits where the helmet is.
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      initialPosition.x,
      initialPosition.y,
      initialPosition.z,
    );
    this.rigidBody = physics.world.createRigidBody(bodyDesc);
    const colliders = createHitColliders(physics.world, this.rigidBody, PLAYER_HIT_SHAPE);
    this.bodyCollider = colliders.body;
    this.headCollider = colliders.head;
    physics.registerCollider(this.bodyCollider, this);
    physics.registerCollider(this.headCollider, this);
  }

  /** Async because the model has to be loaded (and cached - see AssetLoader.loadGLTF, so a match
   * fetches the spacesuit character once however many opponents use it). Other players wear the
   * spacesuit with a cyan visor, enemies the SWAT kit with a red one (characterModels.ts). */
  static async create(
    physics: PhysicsWorld,
    scene: THREE.Scene,
    initialPosition: THREE.Vector3,
    onHit: (amount: number) => void,
  ): Promise<RemotePlayer> {
    const gltf = await loadGLTF(PLAYER_CHARACTER.path);
    const { model, mixer, actions } = instantiateCharacter(gltf, PLAYER_CHARACTER, PLAYER_HEIGHT);
    // A moving player is nearly always at a run (walk and sprint are 5 m/s and up).
    return new RemotePlayer(physics, scene, initialPosition, model, mixer, actions.idle, actions.run, onHit);
  }

  /** Always false from this client's perspective - it has no authority over the opponent's health
   * (see the class comment), so there's nothing meaningful for a Damageable consumer to read here
   * beyond "never treat this as already dead." */
  get isDead(): boolean {
    return false;
  }

  /** A hit on the helmet counts HEADSHOT_MULTIPLIER times, as on an enemy. The amount sent is
   * the multiplied one: the victim's client applies whatever the damageEvent carries. */
  takeDamage(amount: number, hitColliderHandle: number): void {
    this.onHit(hitColliderHandle === this.headCollider.handle ? amount * HEADSHOT_MULTIPLIER : amount);
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
  applySnapshot(x: number, y: number, z: number, yaw: number, sentAtMs?: number, snap = false): void {
    const teleported = this.motion.push(x, y, z, sentAtMs, performance.now());
    this.targetYaw = yaw + Math.PI;
    // Snapshots can overtake a respawnEvent (they travel on the unordered fast channel): a jump no
    // one could run, or the first snapshot of a player still shown dead, snaps like a respawn
    // instead of sliding the body and its hitbox across the map.
    if (teleported || snap) this.teleportTo(x, y, z);
  }

  /** Their camera pitch from the latest snapshot (Player.facingPitch). */
  setLookPitch(pitch: number): void {
    this.targetPitch = pitch;
  }

  /** Facility only (docs/facility-map.md, section 7): shows or hides the small glowing lens on the
   * avatar. Built on first use. */
  setTorch(on: boolean): void {
    this.torchLit = on;
    if (!this.torchLens) {
      if (!on) return;
      const material = new THREE.MeshStandardMaterial({ name: 'remote-torch-lens', color: 0x1a1a18, emissive: 0xfff1dc, emissiveIntensity: TORCH_LENS_GLOW });
      this.torchLens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), material);
      this.torchLens.position.copy(TORCH_LENS_POSITION);
      this.mesh.add(this.torchLens);
    }
    this.torchLens.visible = on;
  }

  get torchOn(): boolean {
    return this.torchLit;
  }

  /** The damped look, in Player's camera convention (yaw 0 faces -Z): the model's own facing less
   * the +PI that applySnapshot adds. */
  get lookYaw(): number {
    return this.mesh.rotation.y - Math.PI;
  }

  get lookPitch(): number {
    return this.pitch;
  }

  /** A player who just died: stop drawing them ahead of their last snapshot. */
  stopPrediction(): void {
    this.motion.stop();
  }

  /** Snaps instantly instead of smoothing - for the moment a match starts or a player respawns:
   * the opponent didn't "walk" to their spawn point, they just appeared there, and damping across
   * that whole-map distance would read as a bizarre high-speed slide. */
  teleportTo(x: number, y: number, z: number): void {
    this.motion.reset(x, y, z);
    this.mesh.position.set(x, y, z);
    this.rigidBody.setNextKinematicTranslation({ x, y, z });
  }

  setLeadSeconds(seconds: number): void {
    this.motion.setLeadSeconds(seconds);
  }

  update(dt: number): void {
    const previousX = this.mesh.position.x;
    const previousZ = this.mesh.position.z;

    const predicted = this.motion.predict(performance.now(), this.predictedPosition);
    this.mesh.position.x = THREE.MathUtils.damp(this.mesh.position.x, predicted.x, POSITION_DAMP_RATE, dt);
    this.mesh.position.y = THREE.MathUtils.damp(this.mesh.position.y, predicted.y, VERTICAL_DAMP_RATE, dt);
    this.mesh.position.z = THREE.MathUtils.damp(this.mesh.position.z, predicted.z, POSITION_DAMP_RATE, dt);
    this.mesh.rotation.y = THREE.MathUtils.damp(this.mesh.rotation.y, this.targetYaw, ROTATION_DAMP_RATE, dt);
    this.pitch = THREE.MathUtils.damp(this.pitch, this.targetPitch, ROTATION_DAMP_RATE, dt);
    this.rigidBody.setNextKinematicTranslation(this.mesh.position);
    this.rigidBody.setNextKinematicRotation(yawRotation(this.mesh.rotation.y));

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
    this.physics.unregisterCollider(this.bodyCollider);
    this.physics.unregisterCollider(this.headCollider);
    this.physics.world.removeCollider(this.bodyCollider, true);
    this.physics.world.removeCollider(this.headCollider, true);
    this.physics.world.removeRigidBody(this.rigidBody);
    scene.remove(this.mesh);
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
    this.torchLens?.material.dispose();
  }
}
