import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { Player } from './Player.ts';
import { Target, TARGET_MODEL_PATH } from './enemies/Target.ts';
import { Enemy, ENEMY_MODEL_PATH, type EnemyCombatHooks } from './enemies/Enemy.ts';
import { EngagementSlots } from './enemies/engagementSlots.ts';
import { preloadGLTFs } from '../core/AssetLoader.ts';
import { ENEMY_MAX_CONCURRENT_ENGAGERS } from '../core/config.ts';

interface ManagedEntity {
  readonly mesh: THREE.Object3D;
  readonly isDead: boolean;
  readonly killFeedLabel: string;
  readonly debugState?: string;
  dispose(): void;
  update?(dt: number, player: Player): void;
}

/** Owns spawned targets/enemies: advances moving ones, and cleans up + reports kills once they die. */
export class EntityManager {
  private readonly entities: ManagedEntity[] = [];
  /** Shared across every enemy spawned by this manager (i.e. one per match) - see
   * engagementSlots.ts for why this needs to be shared rather than per-enemy. */
  private readonly engagementSlots = new EngagementSlots(ENEMY_MAX_CONCURRENT_ENGAGERS);

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly onKilled: (label: string) => void,
    private readonly targetGltf: GLTF,
    private readonly enemyGltf: GLTF,
    private readonly enemyCombatHooks: EnemyCombatHooks,
  ) {}

  static async create(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    onKilled: (label: string) => void,
    enemyCombatHooks: EnemyCombatHooks,
  ): Promise<EntityManager> {
    const models = await preloadGLTFs([TARGET_MODEL_PATH, ENEMY_MODEL_PATH]);
    const targetGltf = models.get(TARGET_MODEL_PATH);
    const enemyGltf = models.get(ENEMY_MODEL_PATH);
    if (!targetGltf || !enemyGltf) throw new Error('Failed to preload target/enemy models');

    return new EntityManager(scene, physics, onKilled, targetGltf, enemyGltf, enemyCombatHooks);
  }

  spawnTarget(position: THREE.Vector3, facePoint: THREE.Vector3): void {
    const target = new Target(this.physics, position, this.targetGltf, facePoint);
    this.scene.add(target.mesh);
    this.entities.push(target);
  }

  spawnEnemy(position: THREE.Vector3): void {
    const enemy = new Enemy(this.physics, position, this.enemyGltf, this.engagementSlots, this.enemyCombatHooks);
    this.scene.add(enemy.mesh);
    this.entities.push(enemy);
  }

  update(dt: number, player: Player): void {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const entity = this.entities[i];
      if (!entity) continue;

      entity.update?.(dt, player);

      if (entity.isDead) {
        this.scene.remove(entity.mesh);
        entity.dispose();
        this.entities.splice(i, 1);
        this.onKilled(entity.killFeedLabel);
      }
    }
  }

  get count(): number {
    return this.entities.length;
  }

  /** Despawns everything regardless of alive/dead state - practice-reset feature, not a kill. */
  clearAll(): void {
    for (const entity of this.entities) {
      this.scene.remove(entity.mesh);
      entity.dispose();
    }
    this.entities.length = 0;
  }

  /** Debug/test helper - world positions of everything currently alive. */
  getLiveEntityPositions(): THREE.Vector3[] {
    return this.entities.map((entity) => entity.mesh.position.clone());
  }

  /** Debug/test helper - AI state of everything currently alive (undefined for non-enemy entities
   * like targets, which have no state machine). */
  getLiveEntityStates(): (string | undefined)[] {
    return this.entities.map((entity) => entity.debugState);
  }
}
