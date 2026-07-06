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

  /** Marks a sensor collider as a crate-stack mantle face (WORLD_PLAN.md §3) - separate from
   * colliderToEntity since a climbable sensor has no owning Entity, just a "walking into this
   * closes the gap" tag plus the exact rooftop position to snap to (see getClimbableMantleTarget)
   * - computed per-building since footprint depth/height vary by preset. */
  registerClimbable(collider: RAPIER.Collider, mantleTarget: ClimbableMantleTarget): void {
    this.climbableMantleTargets.set(collider.handle, mantleTarget);
  }

  unregisterClimbable(collider: RAPIER.Collider): void {
    this.climbableMantleTargets.delete(collider.handle);
  }

  /** The mantle target for whichever climbable sensor the given collider currently overlaps, or
   * null if it isn't touching one. In a dense town, two neighboring buildings' crate-mantle
   * sensors can both be within reach at once - if so, this arbitrarily returns whichever the
   * query happens to visit last, which is fine here since Player.ts only ever uses this for a
   * one-shot teleport (not a sustained multi-frame climb where a mid-action swap would matter). */
  getClimbableMantleTarget(collider: RAPIER.Collider): ClimbableMantleTarget | null {
    let result: ClimbableMantleTarget | null = null;
    this.world.intersectionPairsWith(collider, (other) => {
      const target = this.climbableMantleTargets.get(other.handle);
      if (target !== undefined) result = target;
    });
    return result;
  }

  /** RAPIER.World is backed by WASM linear memory, not GC'd JS heap - must be freed explicitly or
   * repeated lobby <-> match cycles leak a whole physics world's worth of memory each time. */
  dispose(): void {
    this.world.free();
  }
}
