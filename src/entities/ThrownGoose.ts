import * as THREE from 'three';
import { buildGooseMesh } from './Goose.ts';
import { GRAVITY } from '../core/config.ts';
import type { PlayerSlot } from '../network/protocol.ts';

/** A goose in ballistic flight after being thrown (Goose Toss mode - see Game.ts's
 * updateGooseToss). Purely a visual/kinematic projectile, no collider/AI, distinct from the
 * wandering Goose entity it was picked up from (which is already removed from GooseManager by the
 * time this exists). Position integrates via plain velocity + GRAVITY each tick; deciding when it
 * has "landed" (ground/player contact) is the caller's job, not this class's - it only knows how
 * to move and render itself. */
export class ThrownGoose {
  readonly mesh: THREE.Group;
  readonly position = new THREE.Vector3();
  readonly velocity: THREE.Vector3;
  age = 0;

  constructor(
    readonly id: string,
    /** Whoever threw this - only meaningful on the thrower's own client, which is the sole
     * authority for this goose's flight (see updateGooseToss's ownership check). Carried through
     * to a damageEvent's senderSlot if it hits an opponent. */
    readonly throwerSlot: PlayerSlot,
    origin: THREE.Vector3,
    initialVelocity: THREE.Vector3,
  ) {
    this.position.copy(origin);
    this.velocity = initialVelocity.clone();
    this.mesh = buildGooseMesh();
    this.mesh.scale.setScalar(0.9);
    this.mesh.position.copy(origin);
  }

  update(dt: number): void {
    this.age += dt;
    this.velocity.y += GRAVITY * dt;
    this.position.addScaledVector(this.velocity, dt);
    this.mesh.position.copy(this.position);
    // Tumbles while flying - a cheap stand-in for a real thrown-object spin, same spirit as the
    // wandering goose's own code-driven waddle (no rig to animate either).
    this.mesh.rotation.x += dt * 6;
    this.mesh.rotation.z += dt * 4;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
  }
}
