import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { allocateEntityId, type Entity } from '../Entity.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import type { Damageable } from '../../combat/damage.ts';
import { HEADSHOT_MULTIPLIER, TARGET_HEAD_RADIUS, TARGET_HEALTH, TARGET_RADIUS } from '../../core/config.ts';

const HEAD_OFFSET_Y = TARGET_RADIUS + TARGET_HEAD_RADIUS - 0.05;

/** Static shootable dummy: a body sphere plus a smaller head sphere for headshot detection. */
export class Target implements Entity, Damageable {
  readonly id = allocateEntityId();
  readonly mesh: THREE.Group;

  private health = TARGET_HEALTH;
  private readonly rigidBody: RAPIER.RigidBody;
  private readonly bodyCollider: RAPIER.Collider;
  private readonly headCollider: RAPIER.Collider;
  private dead = false;

  constructor(
    private readonly physics: PhysicsWorld,
    position: THREE.Vector3,
  ) {
    const bodyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(TARGET_RADIUS, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xcc3333 }),
    );
    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(TARGET_HEAD_RADIUS, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xffcc88 }),
    );
    headMesh.position.y = HEAD_OFFSET_Y;

    this.mesh = new THREE.Group();
    this.mesh.add(bodyMesh, headMesh);
    this.mesh.position.copy(position);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
    this.rigidBody = physics.world.createRigidBody(bodyDesc);

    this.bodyCollider = physics.world.createCollider(RAPIER.ColliderDesc.ball(TARGET_RADIUS), this.rigidBody);
    physics.registerCollider(this.bodyCollider, this);

    this.headCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(TARGET_HEAD_RADIUS).setTranslation(0, HEAD_OFFSET_Y, 0),
      this.rigidBody,
    );
    physics.registerCollider(this.headCollider, this);
  }

  get isDead(): boolean {
    return this.dead;
  }

  takeDamage(amount: number, hitColliderHandle: number): void {
    if (this.dead) return;
    const isHeadshot = hitColliderHandle === this.headCollider.handle;
    this.health -= isHeadshot ? amount * HEADSHOT_MULTIPLIER : amount;
    if (this.health <= 0) this.dead = true;
  }

  dispose(): void {
    this.physics.unregisterCollider(this.bodyCollider);
    this.physics.unregisterCollider(this.headCollider);
    this.physics.world.removeCollider(this.bodyCollider, true);
    this.physics.world.removeCollider(this.headCollider, true);
    this.physics.world.removeRigidBody(this.rigidBody);
  }
}
