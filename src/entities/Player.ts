import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { allocateEntityId, type Entity } from './Entity.ts';
import type { ClimbableMantleTarget, PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputManager } from '../input/InputManager.ts';
import { Settings } from '../settings/Settings.ts';
import {
  CAMERA_FOV,
  EYE_OFFSET,
  FOOTSTEP_DISTANCE,
  GRAVITY,
  JUMP_SPEED,
  LADDER_CLIMB_SPEED,
  MAX_PITCH,
  MOUSE_SENSITIVITY,
  PLAYER_HEALTH,
  PLAYER_HEIGHT,
  PLAYER_MOVE_SPEED,
  PLAYER_RADIUS,
  RECOIL_DECAY,
  SPRINT_MULTIPLIER,
  WORLD_EDGE_PUSH_SPEED,
  WORLD_HARD_CLAMP_RADIUS,
  WORLD_SOFT_PUSH_START_RADIUS,
} from '../core/config.ts';

export interface PlayerSoundHooks {
  onDamaged: () => void;
  onFootstep: () => void;
}

export class Player implements Entity {
  readonly id = allocateEntityId();

  private readonly rigidBody: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  private yaw = 0;
  private pitch = 0;
  private recoilPitch = 0;
  private verticalVelocity = 0;
  private grounded = false;
  private climbing = false;
  /** Mantle distance from the last climbable sensor actually touched - see applyMovement's
   * justReachedTop handling for why this needs to be cached from the previous frame. */
  private lastClimbMantleTarget: ClimbableMantleTarget | null = null;
  /** The specific ladder sensor being climbed - captured once when climbing starts so contact
   * checks stay locked onto that one sensor for the whole climb (see applyMovement). */
  private activeClimbColliderHandle: number | null = null;
  private health = PLAYER_HEALTH;
  private footstepAccumulator = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly camera: THREE.PerspectiveCamera,
    spawnPosition: THREE.Vector3,
    private readonly sounds: PlayerSoundHooks,
  ) {
    const cylinderHalfHeight = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawnPosition.x,
      spawnPosition.y,
      spawnPosition.z,
    );
    this.rigidBody = physics.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(cylinderHalfHeight, PLAYER_RADIUS);
    this.collider = physics.world.createCollider(colliderDesc, this.rigidBody);
    physics.registerCollider(this.collider, this);

    this.controller = physics.world.createCharacterController(0.05);
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.controller.enableAutostep(0.5, 0.2, true);
    this.controller.enableSnapToGround(0.3);
  }

  update(dt: number, input: InputManager): void {
    this.applyLook(input);
    this.applyMovement(dt, input);
    this.recoilPitch *= Math.max(0, 1 - RECOIL_DECAY * dt);
  }

  /** Temporary upward camera kick that decays back to the player's held aim over time. */
  addRecoil(kick: number): void {
    this.recoilPitch += kick;
  }

  get currentHealth(): number {
    return this.health;
  }

  get maxHealth(): number {
    return PLAYER_HEALTH;
  }

  get isDead(): boolean {
    return this.health <= 0;
  }

  takeDamage(amount: number): void {
    if (this.isDead) return;
    this.health = Math.max(0, this.health - amount);
    this.sounds.onDamaged();
  }

  respawn(position: THREE.Vector3): void {
    this.health = PLAYER_HEALTH;
    this.verticalVelocity = 0;
    this.recoilPitch = 0;
    const target = { x: position.x, y: position.y, z: position.z };
    this.clampToWorldBounds(target);
    this.rigidBody.setNextKinematicTranslation(target);
    this.rigidBody.setTranslation(target, true);
  }

  /** Debug/test helper - instantly repositions the player (e.g. for e2e tests to reach a known
   * world feature without needing to navigate blindly). Resets vertical velocity like respawn()
   * does, but deliberately leaves health untouched. */
  debugTeleport(position: THREE.Vector3): void {
    this.verticalVelocity = 0;
    const target = { x: position.x, y: position.y, z: position.z };
    this.clampToWorldBounds(target);
    this.rigidBody.setNextKinematicTranslation(target);
    this.rigidBody.setTranslation(target, true);
  }

  /** Debug/test helper - snaps yaw/pitch to face a world point directly, bypassing mouse input. */
  debugLookAt(target: THREE.Vector3): void {
    const eye = this.position.clone();
    eye.y += EYE_OFFSET;
    const dx = target.x - eye.x;
    const dz = target.z - eye.z;
    const dy = target.y - eye.y;
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(dy, horizontalDistance)));
  }

  private applyLook(input: InputManager): void {
    // Scale sensitivity by the current zoom ratio so aiming feels consistent while ADS narrows the FOV.
    const sensitivity = MOUSE_SENSITIVITY * Settings.getMouseSensitivity() * (this.camera.fov / CAMERA_FOV);
    const { dx, dy } = input.consumeLookDelta();
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  private applyMovement(dt: number, input: InputManager): void {
    const yawQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(yawQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(yawQuat);

    const movingForward = input.isActionActive('moveForward');
    const movingBackward = input.isActionActive('moveBackward');

    // Ladder climb-by-contact (WORLD_PLAN.md §3): touching a climbable sensor while holding
    // forward enters climbing; losing contact (reaching the top or stepping off the ladder's
    // width), releasing forward, or holding backward exits it back to normal gravity/movement.
    // Once climbing, contact is checked against that *specific* sensor only (not "any climbable")
    // - in a dense town, two neighboring buildings' ladder sensors can both be in reach at once,
    // and re-querying "any" each frame could silently swap which building's mantle target gets
    // used mid-climb (confirmed via direct testing: this caused climbs to intermittently land
    // nowhere near a roof and fall straight through to the ground).
    let touchingClimbable: boolean;
    if (this.climbing && this.activeClimbColliderHandle !== null) {
      touchingClimbable = this.physics.isTouchingSpecificClimbable(this.collider, this.activeClimbColliderHandle);
    } else {
      const target = this.physics.getClimbableMantleTarget(this.collider);
      touchingClimbable = target !== null;
      if (target) this.lastClimbMantleTarget = target;
    }

    const wasClimbing = this.climbing;
    if (!this.climbing && touchingClimbable && movingForward) {
      this.climbing = true;
      this.verticalVelocity = 0;
      this.activeClimbColliderHandle = this.lastClimbMantleTarget?.colliderHandle ?? null;
    } else if (this.climbing && (!touchingClimbable || movingBackward || !movingForward)) {
      this.climbing = false;
      this.verticalVelocity = 0;
    }
    // Climbing has zero horizontal drift (see below), so the only way to lose sensor contact
    // mid-climb is by rising past its top - never by stepping sideways off it. So losing contact
    // (rather than an explicit backward/release-forward dismount) always means "reached the top."
    const justReachedTop = wasClimbing && !this.climbing && !touchingClimbable && !movingBackward;

    const currentBeforeMove = this.rigidBody.translation();
    let next: { x: number; y: number; z: number };

    if (justReachedTop && this.lastClimbMantleTarget) {
      // Mantle onto the rooftop (WORLD_PLAN.md §3's "payoff" for climbing): teleport straight to
      // the precomputed roof-center landing spot (registered per-building in BuildingManager.ts)
      // instead of nudging there through the physics shape-cast solver - confirmed via direct
      // testing that a shape-cast nudge sometimes clipped the wall's own top corner and dropped
      // the player back to the ground, missing the roof, rather than landing on it reliably.
      next = { x: this.lastClimbMantleTarget.x, y: this.lastClimbMantleTarget.y, z: this.lastClimbMantleTarget.z };
      this.verticalVelocity = 0;
      this.grounded = true;
    } else {
      let desiredMovement: { x: number; y: number; z: number };

      if (this.climbing) {
        desiredMovement = { x: 0, y: LADDER_CLIMB_SPEED * dt, z: 0 };
      } else {
        const moveDir = new THREE.Vector3();
        if (movingForward) moveDir.add(forward);
        if (movingBackward) moveDir.sub(forward);
        if (input.isActionActive('moveRight')) moveDir.add(right);
        if (input.isActionActive('moveLeft')) moveDir.sub(right);
        if (moveDir.lengthSq() > 0) moveDir.normalize();

        const speed = PLAYER_MOVE_SPEED * (input.isActionActive('sprint') ? SPRINT_MULTIPLIER : 1);
        moveDir.multiplyScalar(speed * dt);

        this.applyWorldEdgePush(moveDir, currentBeforeMove, dt);

        if (this.grounded && input.isActionActive('jump')) {
          this.verticalVelocity = JUMP_SPEED;
        }
        this.verticalVelocity += GRAVITY * dt;

        desiredMovement = { x: moveDir.x, y: this.verticalVelocity * dt, z: moveDir.z };
      }

      this.controller.computeColliderMovement(this.collider, desiredMovement);

      const computed = this.controller.computedMovement();
      this.grounded = this.climbing ? false : this.controller.computedGrounded();
      if (this.grounded && this.verticalVelocity < 0) {
        this.verticalVelocity = 0;
      }

      if (this.grounded) {
        this.footstepAccumulator += Math.sqrt(computed.x * computed.x + computed.z * computed.z);
        if (this.footstepAccumulator >= FOOTSTEP_DISTANCE) {
          this.footstepAccumulator -= FOOTSTEP_DISTANCE;
          this.sounds.onFootstep();
        }
      }

      next = {
        x: currentBeforeMove.x + computed.x,
        y: currentBeforeMove.y + computed.y,
        z: currentBeforeMove.z + computed.z,
      };
    }

    this.clampToWorldBounds(next);
    this.rigidBody.setNextKinematicTranslation(next);

    const effectivePitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + this.recoilPitch));
    const lookQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(effectivePitch, this.yaw, 0, 'YXZ'));
    this.camera.position.set(next.x, next.y + EYE_OFFSET, next.z);
    this.camera.quaternion.copy(lookQuat);
  }

  /** Gentle inward nudge as the player nears the world boundary - see WORLD_PLAN.md §2 / config.ts. */
  private applyWorldEdgePush(moveDir: THREE.Vector3, current: RAPIER.Vector, dt: number): void {
    const horizontalDistance = Math.sqrt(current.x * current.x + current.z * current.z);
    if (horizontalDistance <= WORLD_SOFT_PUSH_START_RADIUS) return;

    const pushT = Math.min(
      1,
      (horizontalDistance - WORLD_SOFT_PUSH_START_RADIUS) / (WORLD_HARD_CLAMP_RADIUS - WORLD_SOFT_PUSH_START_RADIUS),
    );
    const pushMagnitude = WORLD_EDGE_PUSH_SPEED * pushT * dt;
    moveDir.x += (-current.x / horizontalDistance) * pushMagnitude;
    moveDir.z += (-current.z / horizontalDistance) * pushMagnitude;
  }

  /** Absolute last-resort clamp so the player can never end up past generated terrain. */
  private clampToWorldBounds(next: { x: number; y: number; z: number }): void {
    const horizontalDistance = Math.sqrt(next.x * next.x + next.z * next.z);
    if (horizontalDistance <= WORLD_HARD_CLAMP_RADIUS) return;

    const scale = WORLD_HARD_CLAMP_RADIUS / horizontalDistance;
    next.x *= scale;
    next.z *= scale;
  }

  get position(): THREE.Vector3 {
    const t = this.rigidBody.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** So hitscan can exclude the shooter's own capsule - camera.position sits inside it, which was self-hitting. */
  get ownCollider(): RAPIER.Collider {
    return this.collider;
  }

  /** Debug-only introspection for the e2e suite - not a gameplay cheat. */
  get isClimbing(): boolean {
    return this.climbing;
  }

  get isTouchingClimbable(): boolean {
    return this.physics.isTouchingClimbable(this.collider);
  }
}
