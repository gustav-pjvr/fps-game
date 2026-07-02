import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { allocateEntityId, type Entity } from './Entity.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputManager } from '../input/InputManager.ts';
import {
  EYE_OFFSET,
  GRAVITY,
  JUMP_SPEED,
  MAX_PITCH,
  MOUSE_SENSITIVITY,
  PLAYER_HEIGHT,
  PLAYER_MOVE_SPEED,
  PLAYER_RADIUS,
  SPRINT_MULTIPLIER,
} from '../core/config.ts';

export class Player implements Entity {
  readonly id = allocateEntityId();

  private readonly rigidBody: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  private yaw = 0;
  private pitch = 0;
  private verticalVelocity = 0;
  private grounded = false;

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
  }

  private applyLook(input: InputManager): void {
    const { dx, dy } = input.consumeLookDelta();
    this.yaw -= dx * MOUSE_SENSITIVITY;
    this.pitch -= dy * MOUSE_SENSITIVITY;
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

    const lookQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.position.set(next.x, next.y + EYE_OFFSET, next.z);
    this.camera.quaternion.copy(lookQuat);
  }

  get position(): THREE.Vector3 {
    const t = this.rigidBody.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }
}
