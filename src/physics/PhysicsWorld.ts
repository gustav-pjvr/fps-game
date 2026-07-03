import RAPIER from '@dimforge/rapier3d-compat';
import type { Entity } from '../entities/Entity.ts';
import { GRAVITY } from '../core/config.ts';

export class PhysicsWorld {
  private readonly colliderToEntity = new Map<number, Entity>();

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

  /** RAPIER.World is backed by WASM linear memory, not GC'd JS heap - must be freed explicitly or
   * repeated lobby <-> match cycles leak a whole physics world's worth of memory each time. */
  dispose(): void {
    this.world.free();
  }
}
