import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { allocateEntityId, type Entity } from './Entity.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputManager } from '../input/InputManager.ts';
import {
  CAMERA_FOV,
  EYE_OFFSET,
  GRAVITY,
  JUMP_SPEED,
  MAX_PITCH,
  MOUSE_SENSITIVITY,
  PLAYER_HEALTH,
  PLAYER_HEIGHT,
  PLAYER_MOVE_SPEED,
  PLAYER_RADIUS,
  RECOIL_DECAY,
  SPRINT_MULTIPLIER,
} from '../core/config.ts';

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
  private health = PLAYER_HEALTH;

  constructor(
    physics: PhysicsWorld,
    private readonly camera: THREE.PerspectiveCamera,
    spawnPosition: THREE.Vector3,
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
  }

  respawn(position: THREE.Vector3): void {
    this.health = PLAYER_HEALTH;
    this.verticalVelocity = 0;
    this.recoilPitch = 0;
    this.rigidBody.setNextKinematicTranslation({ x: position.x, y: position.y, z: position.z });
    this.rigidBody.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
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
    const sensitivity = MOUSE_SENSITIVITY * (this.camera.fov / CAMERA_FOV);
    const { dx, dy } = input.consumeLookDelta();
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  private applyMovement(dt: number, input: InputManager): void {
    const yawQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(yawQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(yawQuat);

    const moveDir = new THREE.Vector3();
    if (input.isActionActive('moveForward')) moveDir.add(forward);
    if (input.isActionActive('moveBackward')) moveDir.sub(forward);
    if (input.isActionActive('moveRight')) moveDir.add(right);
    if (input.isActionActive('moveLeft')) moveDir.sub(right);
    if (moveDir.lengthSq() > 0) moveDir.normalize();

    const speed = PLAYER_MOVE_SPEED * (input.isActionActive('sprint') ? SPRINT_MULTIPLIER : 1);
    moveDir.multiplyScalar(speed * dt);

    if (this.grounded && input.isActionActive('jump')) {
      this.verticalVelocity = JUMP_SPEED;
    }
    this.verticalVelocity += GRAVITY * dt;

    const desiredMovement = { x: moveDir.x, y: this.verticalVelocity * dt, z: moveDir.z };
    this.controller.computeColliderMovement(this.collider, desiredMovement);

    const computed = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalVelocity < 0) {
      this.verticalVelocity = 0;
    }

    const current = this.rigidBody.translation();
    const next = {
      x: current.x + computed.x,
      y: current.y + computed.y,
      z: current.z + computed.z,
    };
    this.rigidBody.setNextKinematicTranslation(next);

    const effectivePitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + this.recoilPitch));
    const lookQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(effectivePitch, this.yaw, 0, 'YXZ'));
    this.camera.position.set(next.x, next.y + EYE_OFFSET, next.z);
    this.camera.quaternion.copy(lookQuat);
  }

  get position(): THREE.Vector3 {
    const t = this.rigidBody.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** So hitscan can exclude the shooter's own capsule - camera.position sits inside it, which was self-hitting. */
  get ownCollider(): RAPIER.Collider {
    return this.collider;
  }
}
