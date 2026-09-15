import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { Player } from './Player.ts';
import { Target, TARGET_MODEL_PATH } from './enemies/Target.ts';
import { Enemy, ENEMY_MODEL_PATH, type EnemyCombatHooks, type EnemyDebugRecord } from './enemies/Enemy.ts';
import { createArchetypePicker } from './enemies/archetypes.ts';
import { CombatCoordinator, type CombatRole, type RoleCandidate } from './enemies/combatCoordinator.ts';
import { SquadKnowledge } from './enemies/squadKnowledge.ts';
import type { PlanarPoint } from './enemies/perception.ts';
import { obstacleCentre, type ObstacleQuery } from './enemies/tactics/obstacleRegistry.ts';
import type { TacticalContext } from './enemies/tactics/planner.ts';
import { RayBudget, TacticalScheduler } from './enemies/tactics/rayBudget.ts';
import type { LosProbe } from './enemies/tactics/tacticalQuery.ts';
import { TerrainHeightCache } from './enemies/tactics/terrainHeightCache.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { preloadGLTFs } from '../core/AssetLoader.ts';
import { computeExplosionDamage } from '../combat/explosion.ts';
import { perfCounters } from '../core/perfStats.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { getWatchTowerPositions } from '../world/WatchTowerManager.ts';
import {
  DEATH_FALL_ANGLE,
  DEATH_FALL_DURATION,
  DEATH_HOLD_DURATION,
  DEATH_SINK_DISTANCE,
  DEATH_SINK_DURATION,
  ENEMY_MAX_CONCURRENT_ENGAGERS,
  ENEMY_TACTICAL_MAX_RAYS_PER_JOB,
  ENEMY_TACTICAL_RAY_BUDGET_PER_TICK,
  ENEMY_TACTICAL_REFRESH_INTERVAL,
  ENEMY_TERRAIN_HEIGHT_CACHE_MAX,
  ENEMY_TERRAIN_HEIGHT_CACHE_QUANTUM,
  EYE_OFFSET,
} from '../core/config.ts';
import { getWorldSeed } from '../core/worldSeed.ts';
import { mulberry32 } from '../utils/rng.ts';

/** Distinct from every other seed-offset derivation (terrain +0, ridge +1, vegetation +2, zones
 * +10..+13, guaranteed sites +40/+41, archetypes +101) so per-enemy patrol streams don't correlate
 * with anything else derived from the same world seed. */
const PATROL_SEED_OFFSET = 211;
/** The combat coordinator's own seeded stream (it only picks which side a flanker goes), clear of
 * every other offset in the codebase (0 to 13, 40/41, 101, 211 plus spawn index, GooseManager's
 * 311). See docs/enemy-ai-v2-design.md for the reserved v2 offsets. */
const COORDINATOR_SEED_OFFSET = 401;
/** Per-enemy position-picking streams (step 3): 431 plus spawn index, like patrol's 211 plus
 * spawn index; at most MAX_MATCH_ENTITY_COUNT (50) enemies keeps them clear of everything else. */
const TACTICS_SEED_OFFSET = 431;

const DEATH_TOTAL_DURATION = DEATH_FALL_DURATION + DEATH_HOLD_DURATION + DEATH_SINK_DURATION;

interface ManagedEntity {
  /** Every Entity has one; optional here only so the interface stays honest about what
   * EntityManager relies on. */
  readonly id?: number;
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
  onHeardGunshot?(origin: THREE.Vector3, weaponId?: string): void;
  onNearbyDeath?(deathPosition: THREE.Vector3, killerPosition: THREE.Vector3): void;
  /** Enemy-only debug hooks (enemy AI v2 e2e checks). */
  debugRecord?(): EnemyDebugRecord;
  debugPlace?(x: number, z: number): void;
  /** Enemy-only: its entry on the combat coordinator's roster, or null when not fighting. */
  combatCandidate?(): RoleCandidate | null;
  /** Enemy-only: position picking (step 3). */
  readonly excludeRigidBody?: RAPIER.RigidBody;
  wantsTacticalPick?(): boolean;
  refreshTacticalPick?(context: TacticalContext, rayAllowance: number): number;
  tacticalClaims?(): PlanarPoint[];
  fireLineStart?(): PlanarPoint | null;
}

/** A corpse mid-death-sequence (see the DEATH_* comment in config.ts) - its physics presence is
 * already gone, but the mesh lingers to topple/hold/sink before actually leaving the scene. */
interface DyingEntity {
  readonly mesh: THREE.Object3D;
  elapsed: number;
  readonly startY: number;
  readonly startRotationX: number;
}

export interface LiveEnemyDebug extends EnemyDebugRecord {
  /** Index into getLiveEntityPositions/States (targets included), so e2e checks can cross-reference. */
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SquadDebug {
  readonly belief: { x: number; z: number; source: string; confidence: number; age: number } | null;
  readonly visibleCount: number;
  readonly secondsSinceSeen: number;
  readonly roles: Readonly<Record<CombatRole, number>>;
}

/** The world as position picking needs it (step 3): where the cover is, and where an enemy may
 * not stand (inside houses and watch towers - Game's spawn-blocked check). */
export interface TacticalWorldSource {
  readonly obstacles: ObstacleQuery;
  readonly isBlocked: (x: number, z: number) => boolean;
}

/** Owns spawned targets/enemies: advances moving ones, and cleans up + reports kills once they die. */
export class EntityManager {
  private readonly entities: ManagedEntity[] = [];
  private readonly dying: DyingEntity[] = [];
  /** Hands out combat roles (shooter tokens, flanker, rusher, reserve) to every enemy in a fight
   * (enemy AI v2 step 2, combatCoordinator.ts) - one per match, so the shooter cap is squad-wide. */
  private readonly coordinator = new CombatCoordinator(
    { shooter: ENEMY_MAX_CONCURRENT_ENGAGERS },
    mulberry32(getWorldSeed() + COORDINATOR_SEED_OFFSET),
  );
  /** What the whole squad knows about the player (enemy AI v2 step 1, squadKnowledge.ts) - one per
   * match, shared by every enemy, advanced once per tick before any enemy thinks. */
  private readonly knowledge = new SquadKnowledge();
  /** Position picking's shared per-tick raycast budget and the round robin that spends it (step 3,
   * tactics/rayBudget.ts), and a memo of terrain heights for candidate spots. */
  private readonly rayBudget = new RayBudget(ENEMY_TACTICAL_RAY_BUDGET_PER_TICK);
  private readonly scheduler = new TacticalScheduler(ENEMY_TACTICAL_REFRESH_INTERVAL, ENEMY_TACTICAL_MAX_RAYS_PER_JOB);
  private readonly heightCache = new TerrainHeightCache(sampleHeight, ENEMY_TERRAIN_HEIGHT_CACHE_QUANTUM, ENEMY_TERRAIN_HEIGHT_CACHE_MAX);
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
    private readonly tacticalWorld: TacticalWorldSource,
  ) {}

  static async create(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    onKilled: (label: string) => void,
    enemyCombatHooks: EnemyCombatHooks,
    tacticalWorld: TacticalWorldSource,
  ): Promise<EntityManager> {
    const models = await preloadGLTFs([TARGET_MODEL_PATH, ENEMY_MODEL_PATH]);
    const targetGltf = models.get(TARGET_MODEL_PATH);
    const enemyGltf = models.get(ENEMY_MODEL_PATH);
    if (!targetGltf || !enemyGltf) throw new Error('Failed to preload target/enemy models');

    return new EntityManager(scene, physics, onKilled, targetGltf, enemyGltf, enemyCombatHooks, tacticalWorld);
  }

  spawnTarget(position: THREE.Vector3, facePoint: THREE.Vector3): void {
    const target = new Target(this.physics, position, this.targetGltf, facePoint);
    this.scene.add(target.mesh);
    this.entities.push(target);
  }

  spawnEnemy(position: THREE.Vector3): void {
    const archetype = this.pickArchetype();
    const spawnIndex = this.enemiesSpawned++;
    const patrolRng = mulberry32(getWorldSeed() + PATROL_SEED_OFFSET + spawnIndex);
    const tacticsRng = mulberry32(getWorldSeed() + TACTICS_SEED_OFFSET + spawnIndex);
    const enemy = new Enemy(
      this.physics,
      position,
      this.enemyGltf,
      archetype,
      this.coordinator,
      this.knowledge,
      this.enemyCombatHooks,
      patrolRng,
      tacticsRng,
    );
    this.scene.add(enemy.mesh);
    this.entities.push(enemy);
  }

  /** A player gunshot just fired - remembered by the squad (for which way the fire comes from) and
   * heard by every enemy within that weapon's range (see Enemy.onHeardGunshot's own gating). Cheap
   * no-op when `entities` holds no enemies (multiplayer, or a match with enemyCount 0) - Target
   * simply doesn't implement onHeardGunshot. */
  notifyGunshot(origin: THREE.Vector3, weaponId?: string): void {
    this.knowledge.reportGunshot(origin);
    for (const entity of this.entities) entity.onHeardGunshot?.(origin, weaponId);
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
    this.knowledge.advance(dt);
    this.updateCoordinator();
    this.updateTactics(player);

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
        // from" for the ones that react. Targets have no comrades to warn.
        if (entity.onNearbyDeath) this.knowledge.reportComradeDeath(player.position);
        for (const other of this.entities) other.onNearbyDeath?.(deathPosition, player.position);
      }
    }

    this.updateDying(dt);
  }

  /** The squad phase of the tick: every fighting enemy (as of the end of last tick) goes on the
   * roster, and the coordinator re-deals roles before any enemy acts on them. */
  private updateCoordinator(): void {
    const roster: RoleCandidate[] = [];
    for (const entity of this.entities) {
      const candidate = entity.combatCandidate?.();
      if (candidate) roster.push(candidate);
    }
    const belief = this.knowledge.belief;
    this.coordinator.update(roster, {
      now: this.knowledge.now,
      threat: belief ? { x: belief.position.x, z: belief.position.z } : null,
      isThreatVisible: this.knowledge.isThreatVisible,
    });
  }

  /** Position picking (step 3): the enemies that want a spot this tick share one ray budget, in
   * stalest-first order (TacticalScheduler). The context is built lazily - claims and fire lines
   * are only gathered if some enemy's refresh actually comes up. */
  private updateTactics(player: Player): void {
    this.rayBudget.beginTick();
    const fighters = this.entities.filter((entity) => entity.id !== undefined && entity.wantsTacticalPick?.() === true);
    this.scheduler.sync(fighters.map((entity) => entity.id!));
    if (fighters.length === 0) return;

    const belief = this.knowledge.belief;
    const threat = belief ? { x: belief.position.x, z: belief.position.z } : null;
    const byId = new Map<number, ManagedEntity>();
    for (const entity of this.entities) {
      if (entity.id !== undefined) byId.set(entity.id, entity);
    }

    let claims: { id: number; points: PlanarPoint[] }[] | null = null;
    const allClaims = (): { id: number; points: PlanarPoint[] }[] =>
      (claims ??= this.entities.flatMap((entity) =>
        entity.id !== undefined && entity.tacticalClaims ? [{ id: entity.id, points: entity.tacticalClaims() }] : [],
      ));
    let fireLines: { id: number; line: { from: PlanarPoint; to: PlanarPoint } }[] | null = null;
    const allFireLines = (): { id: number; line: { from: PlanarPoint; to: PlanarPoint } }[] =>
      (fireLines ??= threat
        ? this.entities.flatMap((entity) => {
            const start = entity.id !== undefined ? entity.fireLineStart?.() : null;
            return start && entity.id !== undefined ? [{ id: entity.id, line: { from: start, to: threat } }] : [];
          })
        : []);

    const context: TacticalContext = {
      now: this.knowledge.now,
      threat,
      threatEyeY: belief ? belief.position.y + EYE_OFFSET : 0,
      world: {
        obstacles: this.tacticalWorld.obstacles,
        towers: getWatchTowerPositions(),
        isBlocked: this.tacticalWorld.isBlocked,
        heightAt: this.heightAt,
      },
      probeFor: (id) => this.probeExcluding(byId.get(id)?.excludeRigidBody, player),
      claimsFor: (id) => allClaims().flatMap((claim) => (claim.id === id ? [] : claim.points)),
      fireLinesFor: (id) => allFireLines().flatMap((entry) => (entry.id === id ? [] : [entry.line])),
    };

    this.scheduler.update(this.knowledge.now, this.rayBudget, (id, allowance) => byId.get(id)?.refreshTacticalPick?.(context, allowance) ?? 0);
    if (this.rayBudget.exhaustedThisTick) perfCounters.rayBudgetExhaustedTicks += 1;
  }

  private readonly heightAt = (x: number, z: number): number => this.heightCache.heightAt(x, z);

  /** A sight line for position picking that ignores the player's own capsule (the threat's eye sits
   * inside it, so every ray would otherwise start "blocked") and the asking enemy's own body. */
  private probeExcluding(body: RAPIER.RigidBody | undefined, player: Player): LosProbe {
    return (from, to) => {
      const direction = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
      const length = direction.length();
      if (length < 1e-4) return true;
      direction.divideScalar(length);
      perfCounters.tacticalRaycasts += 1;
      return castHitscan(this.physics, new THREE.Vector3(from.x, from.y, from.z), direction, length, player.ownCollider, body) === null;
    };
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
   * bodies from the previous life behind. The squad forgets everything it knew, too. */
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
    this.knowledge.reset();
    this.coordinator.reset();
    this.scheduler.clear();
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

  /** Debug/test helper (enemy AI v2) - state, awareness, sightline, facing, role and spot of every
   * live enemy. */
  getLiveEnemyDebug(): LiveEnemyDebug[] {
    const records: LiveEnemyDebug[] = [];
    this.entities.forEach((entity, index) => {
      const record = entity.debugRecord?.();
      if (!record) return;
      const p = entity.mesh.position;
      records.push({ ...record, index, x: p.x, y: p.y, z: p.z });
    });
    return records;
  }

  /** Debug/test helper (enemy AI v2) - what the squad currently believes about the player. */
  getSquadDebug(): SquadDebug {
    const belief = this.knowledge.belief;
    return {
      belief: belief
        ? {
            x: belief.position.x,
            z: belief.position.z,
            source: belief.source,
            confidence: belief.confidence,
            age: this.knowledge.now - belief.at,
          }
        : null,
      visibleCount: this.knowledge.visibleCount,
      secondsSinceSeen: this.knowledge.secondsSinceSeen(),
      roles: this.coordinator.countRoles(),
    };
  }

  /** Debug/test helper (enemy AI v2) - the registered cover within `radius` of (x, z): tree trunks
   * and house footprints, by centre. Lets a behaviour test find a wood or a town to fight in. */
  getCoverNear(x: number, z: number, radius: number): { kind: string; x: number; z: number }[] {
    return this.tacticalWorld.obstacles.near(x, z, radius).map((obstacle) => ({ kind: obstacle.kind, ...obstacleCentre(obstacle) }));
  }

  /** Test-only - instantly moves the live entity at `index` (an enemy) to (x, z) on the ground. */
  placeEnemy(index: number, x: number, z: number): void {
    this.entities[index]?.debugPlace?.(x, z);
  }
}
