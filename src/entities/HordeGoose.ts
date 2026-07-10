import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { allocateEntityId, type Entity } from './Entity.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { Damageable } from '../combat/damage.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { steerWithAvoidance } from './enemies/enemySteering.ts';
import { buildGooseMesh } from './Goose.ts';
import {
  GOOSE_HEIGHT,
  GOOSE_RADIUS,
  HORDE_FLYER_DESCENT_SECONDS,
  HORDE_FLYER_SPAWN_HEIGHT,
  HORDE_GOOSE_CONTACT_RADIUS,
  HORDE_JUMPER_BURST_MULTIPLIER,
  HORDE_JUMPER_BURST_SECONDS,
  HORDE_JUMPER_TRIGGER_RADIUS,
} from '../core/config.ts';

export type HordeGooseFlavor = 'walker' | 'jumper' | 'flyer';

const WADDLE_BOB_SPEED = 11;
const WADDLE_ROCK_ANGLE = 0.22;

/** Goose Horde's aggressive, always-chasing goose - a parallel to (not a subclass of) both the
 * passive wandering Goose and the GLTF/archetype-coupled Enemy, reusing each's relevant piece:
 * Goose's procedural mesh (buildGooseMesh) and Enemy's chase-steering primitive
 * (steerWithAvoidance, same function Enemy itself uses). Always heads straight for whichever
 * target position it's given each tick (Game.ts/HordeGooseManager pick the nearest player) and
 * explodes on contact - no idle/alert/search states, a horde goose aggros immediately on spawn.
 *
 * Dies in exactly one hit from any weapon (see takeDamage) - a killed goose just falls over
 * (`dead` without `reachedTarget`), only a goose that actually reaches its target explodes (see
 * HordeGooseManager's own update loop for where that distinction is read). */
export class HordeGoose implements Entity, Damageable {
  readonly id = allocateEntityId();
  readonly isDamageableTarget = true;
  readonly mesh: THREE.Group;
  readonly flavor: HordeGooseFlavor;

  private dead = false;
  private reachedTarget = false;
  private disposed = false;
  private readonly rigidBody: RAPIER.RigidBody;
  private readonly bodyCollider: RAPIER.Collider;
  private waddlePhase = Math.random() * Math.PI * 2;

  /** Jumper only: counts down once triggered (see HORDE_JUMPER_TRIGGER_RADIUS) - while positive,
   * chase speed is multiplied by HORDE_JUMPER_BURST_MULTIPLIER instead of the normal per-wave
   * speed, reading as a sudden rush tell. */
  private jumperBurstRemaining = 0;

  /** Flyer only: seconds since spawn - drives the straight-down descent until it either lands
   * (converts to a normal ground chase for any remaining life) or reaches its target mid-descent
   * (explodes in the air, right on top of whatever it was diving at). */
  private flyerAge = 0;
  private flyerLanded = false;
  /** The nearest player's position the *first* time this flyer ticks (effectively "at spawn," a
   * few ms later) - not the goose's own spawn point. Previously initialized from `position` (the
   * spawn point itself), so a flyer dove straight down onto the fixed spawn ring instead of at a
   * player, only ever hitting someone who happened to be standing on that exact ring - the config
   * comment's own "dives straight down toward the player" was never actually true. Confirmed bug
   * (M1), fixed in the 2026-07-10 review. Mutable rather than readonly-from-constructor because
   * the constructor only knows the spawn position, not yet the live nearest-player target
   * HordeGooseManager computes fresh each tick. */
  private flyerTargetX: number;
  private flyerTargetZ: number;
  private flyerTargetCaptured = false;

  constructor(
    private readonly physics: PhysicsWorld,
    position: THREE.Vector3,
    flavor: HordeGooseFlavor,
    /** m/s, already includes the current wave's speedMultiplier (see HordeGooseManager). */
    private readonly chaseSpeed: number,
    /** Stable id shared across every client's copy of this same goose - see Goose.ts's identical
     * field for the full reasoning (assigned by the authoritative HordeGooseManager). */
    public readonly networkId: string = '',
    /** Presence selects follower mode (multiplayer guest): no local AI, position driven externally
     * via snapTo, and a local hit reports itself here instead of self-adjudicating - same pattern
     * as Goose.ts's onRemoteHitReport. */
    private readonly onRemoteHitReport?: () => void,
  ) {
    this.flavor = flavor;
    this.flyerTargetX = position.x;
    this.flyerTargetZ = position.z;

    this.mesh = buildGooseMesh();
    const spawnY = flavor === 'flyer' ? sampleHeight(position.x, position.z) + HORDE_FLYER_SPAWN_HEIGHT : position.y;
    this.mesh.position.set(position.x, spawnY, position.z);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, spawnY, position.z);
    this.rigidBody = physics.world.createRigidBody(bodyDesc);
    this.bodyCollider = physics.world.createCollider(RAPIER.ColliderDesc.ball(GOOSE_RADIUS), this.rigidBody);
    physics.registerCollider(this.bodyCollider, this);
  }

  get isDead(): boolean {
    return this.dead;
  }

  /** True only once this goose has actually reached its target and should explode - a one-hit
   * weapon kill (`dead` alone) never sets this. */
  get hasReachedTarget(): boolean {
    return this.reachedTarget;
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  /** One hit from any weapon kills it outright, regardless of damage amount - see the class
   * comment on why this diverges from both Enemy's amount-based health and the normal Goose's
   * hit-count. */
  takeDamage(_amount: number, _hitColliderHandle: number): void {
    if (this.dead) return;
    if (this.onRemoteHitReport) {
      this.onRemoteHitReport();
      return;
    }
    this.dead = true;
  }

  /** Host-only: kills this goose outright, no damage amount involved - used when the host is
   * applying a hit a guest already reported (HordeGooseManager.registerRemoteHit), where the
   * hit is known-authoritative and there's nothing left to adjudicate. Never routes through
   * onRemoteHitReport - only the host's own authoritative copy calls this. */
  kill(): void {
    this.dead = true;
  }

  /** Follower mode only: snaps directly to a host-reported position, mirroring Goose.ts's
   * identical method - only the host's copy runs real AI/decides death. */
  snapTo(x: number, y: number, z: number): void {
    this.rigidBody.setNextKinematicTranslation({ x, y, z });
    this.mesh.position.set(x, y, z);
  }

  update(dt: number, targetPosition: THREE.Vector3): void {
    if (this.dead || this.onRemoteHitReport) return;

    if (this.flavor === 'flyer' && !this.flyerLanded) {
      this.updateFlyerDescent(dt, targetPosition);
      return;
    }

    this.updateChase(dt, targetPosition);
  }

  private updateFlyerDescent(dt: number, targetPosition: THREE.Vector3): void {
    if (!this.flyerTargetCaptured) {
      this.flyerTargetCaptured = true;
      this.flyerTargetX = targetPosition.x;
      this.flyerTargetZ = targetPosition.z;
    }
    this.flyerAge += dt;
    const groundY = sampleHeight(this.flyerTargetX, this.flyerTargetZ) + GOOSE_HEIGHT / 2;
    const startY = groundY + HORDE_FLYER_SPAWN_HEIGHT;
    const t = Math.min(1, this.flyerAge / HORDE_FLYER_DESCENT_SECONDS);
    const y = startY + (groundY - startY) * t;
    this.rigidBody.setNextKinematicTranslation({ x: this.flyerTargetX, y, z: this.flyerTargetZ });
    this.mesh.position.set(this.flyerTargetX, y, this.flyerTargetZ);
    this.mesh.rotation.x = -Math.PI / 2.4;

    if (this.position.distanceTo(targetPosition) <= HORDE_GOOSE_CONTACT_RADIUS) {
      this.reachedTarget = true;
      this.dead = true;
      return;
    }
    if (t >= 1) {
      this.flyerLanded = true;
      this.mesh.rotation.x = 0;
    }
  }

  private updateChase(dt: number, targetPosition: THREE.Vector3): void {
    const current = this.rigidBody.translation();
    const dx = targetPosition.x - current.x;
    const dz = targetPosition.z - current.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance <= HORDE_GOOSE_CONTACT_RADIUS) {
      this.reachedTarget = true;
      this.dead = true;
      return;
    }

    if (this.flavor === 'jumper' && this.jumperBurstRemaining <= 0 && distance <= HORDE_JUMPER_TRIGGER_RADIUS) {
      this.jumperBurstRemaining = HORDE_JUMPER_BURST_SECONDS;
    }
    let speed = this.chaseSpeed;
    if (this.jumperBurstRemaining > 0) {
      this.jumperBurstRemaining -= dt;
      speed *= HORDE_JUMPER_BURST_MULTIPLIER;
    }

    const desiredDir = new THREE.Vector3(dx / distance, 0, dz / distance);
    const chestPos = new THREE.Vector3(current.x, current.y, current.z);
    const steeredDir = steerWithAvoidance(this.physics, chestPos, desiredDir, this.bodyCollider);

    const step = Math.min(distance, speed * dt);
    const nextX = current.x + steeredDir.x * step;
    const nextZ = current.z + steeredDir.z * step;
    const groundY = sampleHeight(nextX, nextZ) + GOOSE_HEIGHT / 2;

    this.rigidBody.setNextKinematicTranslation({ x: nextX, y: groundY, z: nextZ });
    this.waddlePhase += dt * WADDLE_BOB_SPEED;
    this.mesh.position.set(nextX, groundY + Math.sin(this.waddlePhase) * 0.05, nextZ);
    this.mesh.rotation.y = Math.atan2(steeredDir.x, steeredDir.z);
    this.mesh.rotation.z = Math.sin(this.waddlePhase) * WADDLE_ROCK_ANGLE;
  }

  /** Guarded against a second call - same reasoning as Goose.ts/RemotePlayer.ts's identical guard
   * (re-entering Rapier's removal path for an already-removed collider isn't guaranteed safe). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.physics.unregisterCollider(this.bodyCollider);
    this.physics.world.removeCollider(this.bodyCollider, true);
    this.physics.world.removeRigidBody(this.rigidBody);
  }
}
