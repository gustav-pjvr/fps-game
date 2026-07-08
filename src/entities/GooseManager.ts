import * as THREE from 'three';
import { Goose } from './Goose.ts';
import type { Player } from './Player.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { computeExplosionDamage } from '../combat/explosion.ts';
import { getWorldSeed } from '../core/worldSeed.ts';
import { mulberry32 } from '../utils/rng.ts';
import {
  GOOSE_EXPLOSION_PRESETS,
  GOOSE_HEIGHT,
  GOOSE_MAX_CONCURRENT,
  GOOSE_ROAM_RADIUS,
  GOOSE_SNAPSHOT_SEND_INTERVAL,
  GOOSE_SPAWN_COUNT_INITIAL,
  GOOSE_SPAWN_MIN_DISTANCE_FROM_PLAYER,
  type GooseExplosionDifficulty,
} from '../core/config.ts';

/** Distinct from every other seed-offset derivation in the codebase (terrain +0, ridge +1,
 * vegetation +2, zones +10..+13, guaranteed sites +40/+41, archetypes +101, enemy patrol +211) so
 * goose patrol streams don't correlate with anything else derived from the same world seed. */
const PATROL_SEED_OFFSET = 311;

export interface GooseManagerCallbacks {
  /** Fired once per goose spawn - Game.ts wires this to the GooseAnnouncement toast. */
  onGooseSpawned: () => void;
  /** Fired once per goose death, before damage is applied - Game.ts wires this to ExplosionEffect. */
  onExplosion: (position: THREE.Vector3, radius: number) => void;
  /** Authoritative side only (single-player has nothing to wire these to; host wires them to
   * connection.send). A guest never calls spawnAuthoritative/spawnNear itself, so these are simply
   * never invoked on a guest's own GooseManager. */
  onNetworkSpawn?: (id: string, x: number, y: number, z: number) => void;
  onNetworkSnapshot?: (id: string, x: number, y: number, z: number) => void;
  onNetworkExplosion?: (id: string, x: number, y: number, z: number) => void;
  /** Follower side only (guest): a local hit landed on a goose this client doesn't have final say
   * over - Game.ts wires this to a gooseHitEvent sent to the host. */
  onLocalHitReported?: (id: string) => void;
}

/** Owns the live flock. Single-player and the multiplayer host run every goose "authoritative"
 * (spawns, wander AI, hit counting, explosion all decided locally) - a multiplayer guest instead
 * mirrors the host's authoritative geese as "follower" copies (see Goose.ts's class comment),
 * driven by applyRemoteSpawn/applyRemoteSnapshot/applyExplosion rather than spawnInitialBatch/
 * spawnNear/update's own death detection. Deliberately separate from EntityManager, since a
 * goose's death (explode) has nothing in common with an enemy/target's (fall over and sink). */
export class GooseManager {
  private readonly geese = new Map<string, Goose>();
  private patrolSeedCounter = 0;
  private snapshotAccumulator = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly callbacks: GooseManagerCallbacks,
    /** Overrides GOOSE_MAX_CONCURRENT - Goose Toss mode passes GOOSE_TOSS_MAX_CONCURRENT (25)
     * instead, since throwing geese at each other is the entire game there. */
    private readonly maxConcurrent: number = GOOSE_MAX_CONCURRENT,
  ) {}

  // ---- Authoritative side (single-player, multiplayer host) ----------------------------------

  /** Scatters GOOSE_SPAWN_COUNT_INITIAL geese in a ring around (centerX, centerZ) - called once at
   * match start. Silent (no announcement toast) - the initial flock is just "how the map starts,"
   * not a notable event the way a mid-match spawn is. */
  spawnInitialBatch(centerX: number, centerZ: number): void {
    for (let i = 0; i < GOOSE_SPAWN_COUNT_INITIAL; i++) {
      const angle = (i / GOOSE_SPAWN_COUNT_INITIAL) * Math.PI * 2;
      const radius = GOOSE_ROAM_RADIUS * 0.5;
      this.spawnAuthoritative(centerX + Math.cos(angle) * radius, centerZ + Math.sin(angle) * radius);
    }
  }

  /** The "a goose spawns whenever a player dies" trigger (see Game.ts) - lands a fresh goose a safe
   * distance from (x, z) and announces it. No-op past GOOSE_MAX_CONCURRENT so a long match doesn't
   * accumulate an unbounded flock (my own addition, not explicitly requested but necessary). */
  spawnNear(x: number, z: number): void {
    if (this.geese.size >= this.maxConcurrent) return;
    const angle = Math.random() * Math.PI * 2;
    const distance = GOOSE_SPAWN_MIN_DISTANCE_FROM_PLAYER + Math.random() * GOOSE_SPAWN_MIN_DISTANCE_FROM_PLAYER;
    this.spawnAuthoritative(x + Math.cos(angle) * distance, z + Math.sin(angle) * distance);
    this.callbacks.onGooseSpawned();
  }

  /** Goose Toss mode only: lands one goose at a random point within GOOSE_ROAM_RADIUS of the map
   * center, independent of player deaths - the mode's constant ambient supply instead of the
   * normal spawn-only-on-death trigger above. Host/single-player only, same authority rule as
   * every other spawn path here. */
  spawnRandomOnMap(centerX: number, centerZ: number): void {
    if (this.geese.size >= this.maxConcurrent) return;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * GOOSE_ROAM_RADIUS;
    this.spawnAuthoritative(centerX + Math.cos(angle) * radius, centerZ + Math.sin(angle) * radius);
    this.callbacks.onGooseSpawned();
  }

  /** Goose Toss mode only: the nearest live goose within `radius` of `position`, or null if none -
   * used to resolve an interact-key pickup attempt. Works identically for an authoritative goose
   * (single-player/host) or a follower's own local mirror (a guest can pick from what it can see;
   * see the class comment on the follower/authoritative split for why that's fine here). */
  findNearestWithinRadius(position: THREE.Vector3, radius: number): string | null {
    let nearestId: string | null = null;
    let nearestDistSq = radius * radius;
    for (const goose of this.geese.values()) {
      const distSq = goose.position.distanceToSquared(position);
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestId = goose.networkId;
      }
    }
    return nearestId;
  }

  /** Goose Toss mode only: removes a goose by id regardless of authoritative/follower role - used
   * both when this client picks one up itself and when applying another player's relayed
   * goosePickedUp message (see Game.ts's updateGooseToss). Returns whether it was actually present
   * (a pickup race - two players grabbing the same goose in the same instant - is possible and
   * tolerated, same as this project's other self-reported multiplayer interactions; the loser of
   * the race just silently no-ops here). */
  removeById(id: string): boolean {
    const goose = this.geese.get(id);
    if (!goose) return false;
    this.scene.remove(goose.mesh);
    goose.dispose();
    this.geese.delete(id);
    return true;
  }

  private spawnAuthoritative(x: number, z: number): void {
    if (this.geese.size >= this.maxConcurrent) return;
    const y = sampleHeight(x, z) + GOOSE_HEIGHT / 2;
    const id = crypto.randomUUID();
    const patrolRng = mulberry32(getWorldSeed() + PATROL_SEED_OFFSET + this.patrolSeedCounter++);
    const goose = new Goose(this.physics, new THREE.Vector3(x, y, z), id, patrolRng);
    this.scene.add(goose.mesh);
    this.geese.set(id, goose);
    this.callbacks.onNetworkSpawn?.(id, x, y, z);
  }

  /** Host-only: applies a hit reported by a guest (see callbacks.onLocalHitReported) through the
   * exact same authoritative takeDamage path the host's own local hits already use directly. */
  registerRemoteHit(id: string): void {
    this.geese.get(id)?.takeDamage(0, -1);
  }

  /** Host-only: every currently-live authoritative goose, for replying to a gooseSyncRequest (see
   * protocol.ts) - covers both "a guest's own Game.create() wasn't ready yet for the initial
   * gooseSpawned broadcasts" and "a late-joining/rejoining guest missed everything that spawned
   * before it connected," since both are really the same problem (a guest that doesn't yet know
   * about a goose the host already owns) with the same fix (ask the host for the current list). */
  listForSync(): { id: string; x: number; y: number; z: number }[] {
    return Array.from(this.geese.values(), (goose) => ({ id: goose.networkId, x: goose.position.x, y: goose.position.y, z: goose.position.z }));
  }

  // ---- Follower side (multiplayer guest) ------------------------------------------------------

  /** The host just told us a new goose exists - build a local mirror with a real collider (so this
   * client's own hitscan can still register a hit) but no local AI; the host is the sole
   * simulation authority (see Goose.ts's class comment). */
  applyRemoteSpawn(id: string, x: number, y: number, z: number): void {
    if (this.geese.has(id)) return;
    const goose = new Goose(this.physics, new THREE.Vector3(x, y, z), id, Math.random, () => this.callbacks.onLocalHitReported?.(id));
    this.scene.add(goose.mesh);
    this.geese.set(id, goose);
  }

  /** Periodic position update from the host - see GOOSE_SNAPSHOT_SEND_INTERVAL. */
  applyRemoteSnapshot(id: string, x: number, z: number): void {
    this.geese.get(id)?.snapTo(x, z);
  }

  /** The host has decided this goose is dead - removes it locally and triggers the explosion (VFX
   * for everyone, damage applied only to this client's own player). Callable on either side: it's
   * also how an authoritative goose's own death (single-player, or the host's local copy) is
   * handled inside `update` below, so there's exactly one explosion code path. */
  applyExplosion(id: string, position: THREE.Vector3, difficulty: GooseExplosionDifficulty, player: Player): void {
    const goose = this.geese.get(id);
    if (goose) {
      this.scene.remove(goose.mesh);
      goose.dispose();
      this.geese.delete(id);
    }
    this.explode(position, difficulty, player);
  }

  // ---- Shared ----------------------------------------------------------------------------------

  /** Advances local wander AI for authoritative geese (follower geese are a no-op here - see
   * Goose.update). Any authoritative goose that just died explodes immediately and, if this is the
   * host, gets broadcast via callbacks.onNetworkExplosion so every guest's follower copy explodes
   * too. `isHost` also gates the periodic position-snapshot broadcast - single-player and guests
   * pass false (a guest has nothing authoritative to broadcast). */
  update(dt: number, player: Player, difficulty: GooseExplosionDifficulty, isHost: boolean): void {
    for (const goose of Array.from(this.geese.values())) {
      goose.update(dt);
      if (goose.isDead) {
        const position = goose.position.clone();
        this.applyExplosion(goose.networkId, position, difficulty, player);
        this.callbacks.onNetworkExplosion?.(goose.networkId, position.x, position.y, position.z);
      }
    }

    if (isHost) {
      this.snapshotAccumulator += dt;
      if (this.snapshotAccumulator >= GOOSE_SNAPSHOT_SEND_INTERVAL) {
        this.snapshotAccumulator = 0;
        for (const goose of this.geese.values()) {
          const p = goose.position;
          this.callbacks.onNetworkSnapshot?.(goose.networkId, p.x, p.y, p.z);
        }
      }
    }
  }

  private explode(position: THREE.Vector3, difficulty: GooseExplosionDifficulty, player: Player): void {
    const preset = GOOSE_EXPLOSION_PRESETS[difficulty];
    this.callbacks.onExplosion(position, preset.radius);
    const damage = computeExplosionDamage(position.distanceTo(player.position), preset.radius, preset.maxDamage);
    if (damage > 0) player.takeDamage(damage);
  }

  get count(): number {
    return this.geese.size;
  }

  clearAll(): void {
    for (const goose of this.geese.values()) {
      this.scene.remove(goose.mesh);
      goose.dispose();
    }
    this.geese.clear();
  }

  dispose(): void {
    this.clearAll();
  }
}
