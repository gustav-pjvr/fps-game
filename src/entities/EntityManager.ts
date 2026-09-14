import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { Player } from './Player.ts';
import { Target, TARGET_MODEL_PATH } from './enemies/Target.ts';
import { Enemy, ENEMY_MODEL_PATH, type EnemyCombatHooks } from './enemies/Enemy.ts';
import { createArchetypePicker } from './enemies/archetypes.ts';
import { EngagementSlots } from './enemies/engagementSlots.ts';
import { preloadGLTFs } from '../core/AssetLoader.ts';
import { computeExplosionDamage } from '../combat/explosion.ts';
import {
  DEATH_FALL_ANGLE,
  DEATH_FALL_DURATION,
  DEATH_HOLD_DURATION,
  DEATH_SINK_DISTANCE,
  DEATH_SINK_DURATION,
  ENEMY_MAX_CONCURRENT_ENGAGERS,
} from '../core/config.ts';
import { getWorldSeed } from '../core/worldSeed.ts';
import { mulberry32 } from '../utils/rng.ts';

/** Distinct from every other seed-offset derivation (terrain +0, ridge +1, vegetation +2, zones
 * +10..+13, guaranteed sites +40/+41, archetypes +101) so per-enemy patrol streams don't correlate
 * with anything else derived from the same world seed. */
const PATROL_SEED_OFFSET = 211;

const DEATH_TOTAL_DURATION = DEATH_FALL_DURATION + DEATH_HOLD_DURATION + DEATH_SINK_DURATION;

interface ManagedEntity {
  readonly mesh: THREE.Object3D;
  readonly isDead: boolean;
  readonly killFeedLabel: string;
  readonly debugState?: string;
  readonly debugArchetype?: string;
  dispose(): void;
  update?(dt: number, player: Player): void;
  /** Both Target and Enemy implement Damageable; optional here only so the interface stays honest
   * about what EntityManager actually relies on. */
  takeDamage?(amount: number, hitColliderHandle: number, sourcePosition?: THREE.Vector3): void;
  /** Enemy-only (see Enemy.ts's own threat-perception methods) - undefined for Target, which has
   * no AI to alert. */
  onHeardGunshot?(origin: THREE.Vector3): void;
  onNearbyDeath?(deathPosition: THREE.Vector3, killerPosition: THREE.Vector3): void;
}

/** A corpse mid-death-sequence (see the DEATH_* comment in config.ts) - its physics presence is
 * already gone, but the mesh lingers to topple/hold/sink before actually leaving the scene. */
interface DyingEntity {
  readonly mesh: THREE.Object3D;
  elapsed: number;
  readonly startY: number;
  readonly startRotationX: number;
}

/** Owns spawned targets/enemies: advances moving ones, and cleans up + reports kills once they die. */
export class EntityManager {
  private readonly entities: ManagedEntity[] = [];
  private readonly dying: DyingEntity[] = [];
  /** Shared across every enemy spawned by this manager (i.e. one per match) - see
   * engagementSlots.ts for why this needs to be shared rather than per-enemy. */
  private readonly engagementSlots = new EngagementSlots(ENEMY_MAX_CONCURRENT_ENGAGERS);
  /** Seeded once per match (getWorldSeed()) so a given world's enemy loadout composition is
   * reproducible - each spawnEnemy call advances the same stream, so spawn order matters too. */
  private readonly pickArchetype = createArchetypePicker(getWorldSeed());
  /** Per-enemy patrol RNG seeding: world seed + spawn index, so a given world reproduces the same
   * patrol behavior for every enemy regardless of how many draws each one's stream makes -
   * completing the determinism story archetype assignment already had (patrol previously used raw
   * Math.random despite pickPatrolDestination taking an rng parameter). */
  private enemiesSpawned = 0;

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
    const archetype = this.pickArchetype();
    const patrolRng = mulberry32(getWorldSeed() + PATROL_SEED_OFFSET + this.enemiesSpawned++);
    const enemy = new Enemy(this.physics, position, this.enemyGltf, archetype, this.engagementSlots, this.enemyCombatHooks, patrolRng);
    this.scene.add(enemy.mesh);
    this.entities.push(enemy);
  }

  /** A player gunshot just fired - alerts every currently-oblivious enemy within hearing range
   * toward its origin (see Enemy.onHeardGunshot's own gating). Cheap no-op when `entities` holds no
   * enemies (multiplayer, or a match with enemyCount 0) - Target simply doesn't implement this. */
  notifyGunshot(origin: THREE.Vector3): void {
    for (const entity of this.entities) entity.onHeardGunshot?.(origin);
  }

  /** Splash damage from a Goose Launcher shot or thrown goose, with the same linear falloff players
   * get. Previously these blasts only ever hurt players, so the single-player golden-goose reward
   * weapon could not damage a single enemy or target. Deaths are picked up by update() as usual
   * (score, kill feed, death sequence). `-1` as the collider handle means "body hit", never a
   * headshot multiplier. */
  applyExplosion(position: THREE.Vector3, radius: number, maxDamage: number): void {
    for (const entity of this.entities) {
      if (entity.isDead || !entity.takeDamage) continue;
      const amount = computeExplosionDamage(entity.mesh.position.distanceTo(position), radius, maxDamage);
      if (amount > 0) entity.takeDamage(amount, -1, position);
    }
  }

  update(dt: number, player: Player): void {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const entity = this.entities[i];
      if (!entity) continue;

      entity.update?.(dt, player);

      if (entity.isDead) {
        const deathPosition = entity.mesh.position.clone();
        // Physics presence goes immediately (same tick as before this feature existed) - only the
        // mesh lingers, for the death sequence below. Nothing can still collide with or shoot
        // through a corpse mid-sequence.
        entity.dispose();
        this.entities.splice(i, 1);
        this.onKilled(entity.killFeedLabel);
        this.dying.push({
          mesh: entity.mesh,
          elapsed: 0,
          startY: entity.mesh.position.y,
          startRotationX: entity.mesh.rotation.x,
        });
        // Threat perception (phase A): a comrade dying alerts nearby oblivious enemies - the
        // player is this match's only real killer (single-player has no other combat source that
        // kills enemies), so their current position doubles as "the direction the threat came
        // from" for the ones that react.
        for (const other of this.entities) other.onNearbyDeath?.(deathPosition, player.position);
      }
    }

    this.updateDying(dt);
  }

  private updateDying(dt: number): void {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const dying = this.dying[i];
      if (!dying) continue;

      dying.elapsed += dt;
      if (dying.elapsed <= DEATH_FALL_DURATION) {
        const fallProgress = THREE.MathUtils.smoothstep(dying.elapsed, 0, DEATH_FALL_DURATION);
        dying.mesh.rotation.x = dying.startRotationX + DEATH_FALL_ANGLE * fallProgress;
      } else if (dying.elapsed <= DEATH_FALL_DURATION + DEATH_HOLD_DURATION) {
        dying.mesh.rotation.x = dying.startRotationX + DEATH_FALL_ANGLE;
      } else {
        const sinkElapsed = dying.elapsed - DEATH_FALL_DURATION - DEATH_HOLD_DURATION;
        const sinkProgress = THREE.MathUtils.smoothstep(sinkElapsed, 0, DEATH_SINK_DURATION);
        dying.mesh.position.y = dying.startY - DEATH_SINK_DISTANCE * sinkProgress;
      }

      if (dying.elapsed >= DEATH_TOTAL_DURATION) {
        this.scene.remove(dying.mesh);
        this.dying.splice(i, 1);
      }
    }
  }

  get count(): number {
    return this.entities.length;
  }

  /** Despawns everything regardless of alive/dead state - practice-reset feature, not a kill.
   * Includes mid-death-sequence corpses: a reset should give a clean slate, not leave sinking
   * bodies from the previous life behind. */
  clearAll(): void {
    for (const entity of this.entities) {
      this.scene.remove(entity.mesh);
      entity.dispose();
    }
    this.entities.length = 0;
    for (const dying of this.dying) {
      this.scene.remove(dying.mesh);
    }
    this.dying.length = 0;
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

  /** Debug/test helper - per-archetype loadouts: which real archetype each live enemy actually got
   * assigned (undefined for non-enemy entities like targets). */
  getLiveEntityArchetypes(): (string | undefined)[] {
    return this.entities.map((entity) => entity.debugArchetype);
  }
}
