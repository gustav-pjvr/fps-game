import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { allocateEntityId, type Entity } from '../Entity.ts';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import type { Damageable } from '../../combat/damage.ts';
import { HEADSHOT_MULTIPLIER, TARGET_HEAD_RADIUS, TARGET_HEALTH, TARGET_RADIUS } from '../../core/config.ts';

export const TARGET_MODEL_PATH = '/assets/models/weapons/target-large.glb';

/** Kenney's target-large.glb (from the Blaster Kit) measures ~0.34 units across its face;
 * scale it up so its visual radius matches TARGET_RADIUS, the invisible hit collider's size. */
const MODEL_RADIUS = 0.17;
const MODEL_SCALE = TARGET_RADIUS / MODEL_RADIUS;

/** Offset the bullseye collider toward the face so it protrudes slightly in front of the body
 * sphere. A sphere concentric with a larger sphere is geometrically unreachable by any ray -
 * its surface is always behind the outer sphere's from the shooter's perspective, so it would
 * never register a hit at all. */
const BULLSEYE_PROTRUSION = 0.15;

/** Static shootable dummy: real target-disc model, with a body collider plus a smaller
 * "bullseye" collider at its center for a headshot-style damage bonus. */
export class Target implements Entity, Damageable {
  readonly id = allocateEntityId();
  readonly isDamageableTarget = true;
  readonly killFeedLabel = 'Target destroyed';
  readonly mesh: THREE.Group;

  private health = TARGET_HEALTH;
  private readonly rigidBody: RAPIER.RigidBody;
  private readonly bodyCollider: RAPIER.Collider;
  private readonly bullseyeCollider: RAPIER.Collider;
  private dead = false;

  /** `facePoint` - the model's painted face is aimed toward this world point (e.g. the spawn
   * point every target rings around), verified empirically: a fixed rotation for every target
   * only happened to face correctly for the one at a specific ring angle - everywhere else it
   * showed edge-on, since the model's face has a fixed local orientation, not one relative to
   * the ring. */
  constructor(
    private readonly physics: PhysicsWorld,
    position: THREE.Vector3,
    gltf: GLTF,
    facePoint: THREE.Vector3,
  ) {
    const dx = facePoint.x - position.x;
    const dz = facePoint.z - position.z;
    // Empirically verified: rotation.y = atan2(dx,dz) + PI/2 makes the model's face point
    // toward (dx,dz) - see commit message for how this was derived from a render comparison.
    const facingRotationY = Math.atan2(dx, dz) + Math.PI / 2;
    const faceDir = new THREE.Vector2(dx, dz).normalize();

    const model = gltf.scene.clone(true);
    model.scale.setScalar(MODEL_SCALE);
    model.rotation.y = facingRotationY;
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    this.mesh = new THREE.Group();
    this.mesh.add(model);
    this.mesh.position.copy(position);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
    this.rigidBody = physics.world.createRigidBody(bodyDesc);

    this.bodyCollider = physics.world.createCollider(RAPIER.ColliderDesc.ball(TARGET_RADIUS), this.rigidBody);
    physics.registerCollider(this.bodyCollider, this);

    this.bullseyeCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(TARGET_HEAD_RADIUS).setTranslation(
        faceDir.x * BULLSEYE_PROTRUSION,
        0,
        faceDir.y * BULLSEYE_PROTRUSION,
      ),
      this.rigidBody,
    );
    physics.registerCollider(this.bullseyeCollider, this);
  }

  get isDead(): boolean {
    return this.dead;
  }

  takeDamage(amount: number, hitColliderHandle: number): void {
    if (this.dead) return;
    const isBullseye = hitColliderHandle === this.bullseyeCollider.handle;
    this.health -= isBullseye ? amount * HEADSHOT_MULTIPLIER : amount;
    if (this.health <= 0) this.dead = true;
  }

  dispose(): void {
    this.physics.unregisterCollider(this.bodyCollider);
    this.physics.unregisterCollider(this.bullseyeCollider);
    this.physics.world.removeCollider(this.bodyCollider, true);
    this.physics.world.removeCollider(this.bullseyeCollider, true);
    this.physics.world.removeRigidBody(this.rigidBody);
  }
}
