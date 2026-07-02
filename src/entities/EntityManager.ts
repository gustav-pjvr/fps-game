import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Target } from './enemies/Target.ts';
import { Enemy } from './enemies/Enemy.ts';

interface ManagedEntity {
  readonly mesh: THREE.Object3D;
  readonly isDead: boolean;
  dispose(): void;
  update?(dt: number, targetPosition: THREE.Vector3): void;
}

/** Owns spawned targets/enemies: advances moving ones, and cleans up + reports kills once they die. */
export class EntityManager {
  private readonly entities: ManagedEntity[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly onKilled: () => void,
  ) {}

  spawnTarget(position: THREE.Vector3): void {
    const target = new Target(this.physics, position);
    this.scene.add(target.mesh);
    this.entities.push(target);
  }

  spawnEnemy(position: THREE.Vector3): void {
    const enemy = new Enemy(this.physics, position);
    this.scene.add(enemy.mesh);
    this.entities.push(enemy);
  }

  update(dt: number, playerPosition: THREE.Vector3): void {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const entity = this.entities[i];
      if (!entity) continue;

      entity.update?.(dt, playerPosition);

      if (entity.isDead) {
        this.scene.remove(entity.mesh);
        entity.dispose();
        this.entities.splice(i, 1);
        this.onKilled();
      }
    }
  }
}
