import RAPIER from '@dimforge/rapier3d-compat';
import type { Entity } from '../entities/Entity.ts';
import { GRAVITY } from '../core/config.ts';

export interface ClimbableMantleTarget {
  colliderHandle: number;
  x: number;
  y: number;
  z: number;
}

export class PhysicsWorld {
  private readonly colliderToEntity = new Map<number, Entity>();
  /** Climbable sensor collider handle -> exact world position to snap the player to when climbing
   * exits at the top (see registerClimbable). */
  private readonly climbableMantleTargets = new Map<number, ClimbableMantleTarget>();

  private constructor(readonly world: RAPIER.World) {}

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    return new PhysicsWorld(world);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  registerCollider(collider: RAPIER.Collider, entity: Entity): void {
    this.colliderToEntity.set(collider.handle, entity);
  }

  unregisterCollider(collider: RAPIER.Collider): void {
    this.colliderToEntity.delete(collider.handle);
  }

  getEntity(colliderHandle: number): Entity | undefined {
    return this.colliderToEntity.get(colliderHandle);
  }

  /** Marks a sensor collider as a climbable ladder face (WORLD_PLAN.md §3's climb-by-contact
   * mechanic) - separate from colliderToEntity since a climbable collider has no owning Entity,
   * just a "you can climb here" tag plus the exact rooftop position to snap to at the top (see
   * getClimbableMantleTarget) - computed per-building since footprint depth/height vary by preset. */
  registerClimbable(collider: RAPIER.Collider, mantleTarget: ClimbableMantleTarget): void {
    this.climbableMantleTargets.set(collider.handle, mantleTarget);
  }

  unregisterClimbable(collider: RAPIER.Collider): void {
    this.climbableMantleTargets.delete(collider.handle);
  }

  isClimbable(colliderHandle: number): boolean {
    return this.climbableMantleTargets.has(colliderHandle);
  }

  /** True if the given collider currently overlaps any collider tagged climbable - used by
   * Player.ts to decide whether to enter the climbing movement state. Rapier tracks sensor
   * intersection pairs internally regardless of activeEvents (those only gate the event-queue
   * callbacks, not this direct query), so this works without extra collider setup beyond
   * `setSensor(true)` on the ladder collider itself. */
  isTouchingClimbable(collider: RAPIER.Collider): boolean {
    return this.getClimbableMantleTarget(collider) !== null;
  }

  /** The mantle target for whichever climbable sensor the given collider currently overlaps, or
   * null if it isn't touching one. In a dense town, two neighboring buildings' ladder sensors can
   * both be within reach at once - if so, this arbitrarily returns whichever the query happens to
   * visit last, which is NOT safe to use as "the ladder I'm currently climbing" once a climb is
   * already in progress (confirmed via direct testing: this caused mid-climb mantle targets to
   * sometimes silently swap to a neighboring building's roof position, which usually wasn't
   * anywhere near where the player actually was, ending in a fall straight through to the
   * ground). Use isTouchingSpecificClimbable to check continued contact with one already-known
   * sensor instead. */
  getClimbableMantleTarget(collider: RAPIER.Collider): ClimbableMantleTarget | null {
    let result: ClimbableMantleTarget | null = null;
    this.world.intersectionPairsWith(collider, (other) => {
      const target = this.climbableMantleTargets.get(other.handle);
      if (target !== undefined) result = target;
    });
    return result;
  }

  /** True if the given collider currently overlaps the *specific* climbable sensor identified by
   * colliderHandle - used to keep climbing locked onto the same ladder it started on, immune to
   * whatever getClimbableMantleTarget's ambiguity might otherwise introduce mid-climb. */
  isTouchingSpecificClimbable(collider: RAPIER.Collider, colliderHandle: number): boolean {
    let found = false;
    this.world.intersectionPairsWith(collider, (other) => {
      if (other.handle === colliderHandle) found = true;
    });
    return found;
  }

  /** RAPIER.World is backed by WASM linear memory, not GC'd JS heap - must be freed explicitly or
   * repeated lobby <-> match cycles leak a whole physics world's worth of memory each time. */
  dispose(): void {
    this.world.free();
  }
}
