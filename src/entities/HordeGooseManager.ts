import * as THREE from 'three';
import { HordeGoose, type HordeGooseFlavor } from './HordeGoose.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import {
  GOOSE_HEIGHT,
  GOOSE_SNAPSHOT_SEND_INTERVAL,
  HORDE_GOOSE_BASE_SPEED,
  HORDE_GOOSE_SPAWN_RADIUS,
  HORDE_MAX_CONCURRENT_BASE,
  HORDE_MAX_CONCURRENT_CEILING,
  HORDE_WAVE_INTERMISSION_SECONDS,
  type HordeWaveSpec,
} from '../core/config.ts';

export interface HordeGooseManagerCallbacks {
  onWaveStart: (wave: number) => void;
  /** All HORDE_WAVE_COUNT waves survived - the win condition. */
  onCleared: () => void;
  /** A goose actually reached a target and exploded - VFX/sound only, damage/knockback is the
   * caller's job (same contract as GooseManager's onExplosion). */
  onExplosion: (position: THREE.Vector3) => void;
  /** Authoritative side only (single-player has nothing to wire these to; host wires them to
   * connection.send) - mirrors GooseManager's identical split. */
  onNetworkSpawn?: (id: string, x: number, y: number, z: number, flavor: HordeGooseFlavor) => void;
  onNetworkSnapshot?: (id: string, x: number, y: number, z: number) => void;
  onNetworkExplosion?: (id: string, x: number, y: number, z: number) => void;
  /** A goose was shot dead (no explosion) - the host-only broadcast for that case. */
  onNetworkRemove?: (id: string) => void;
  onNetworkWaveStart?: (wave: number) => void;
  onNetworkCleared?: () => void;
  /** Any player's death restarted the whole co-op run from wave 1 - host-only broadcast, sent
   * right before the fresh wave 1's own onWaveStart/onNetworkWaveStart fire (see resetToWaveOne). */
  onNetworkReset?: () => void;
  /** Follower side only (guest): a local hit landed on a goose this client doesn't have final say
   * over - see GooseManager's identical contract. */
  onLocalHitReported?: (id: string) => void;
}

type Phase = 'active' | 'intermission' | 'cleared';

/** An indoor map's horde site (the Facility: world/facility/facilityModes.ts's facilityHordeSite).
 * Absent on the Valley, where geese come in on a ring around the centre and flyers drop from the sky. */
export interface HordeIndoorSite {
  /** Where the next goose comes in, given every live target; null falls back to the ring. */
  spawnPoint(players: readonly { x: number; z: number }[]): { x: number; z: number } | null;
  /** A flyer's height over a point, under the local ceiling. */
  flightHeight(x: number, z: number): number;
}

/** Pure: how many geese are allowed alive at once during `waveIndex` - scales with the current
 * wave (M5) up to a hard ceiling, rather than a flat cap. Exported so wave-progression accounting
 * can be unit tested without a live PhysicsWorld/THREE.Scene (2026-07-10 review, Phase 6 test-
 * coverage pass) - HordeGooseManager itself needs real Rapier physics to spawn/steer geese, which
 * this repo's Vitest unit-test layer deliberately never touches (see vitest.config.ts's own
 * comment); this and its two siblings below pull the actual bookkeeping math out where it can be. */
export function computeConcurrentCap(waveIndex: number): number {
  return Math.min(HORDE_MAX_CONCURRENT_CEILING, HORDE_MAX_CONCURRENT_BASE + waveIndex);
}

/** Pure: how many additional geese should spawn this tick - never past the wave's concurrent cap,
 * never past what's actually left queued. Mirrors the exact stop condition of the `while` loop this
 * replaced (`spawnQueueRemaining > 0 && geese.size < concurrentCap`), just computed as a count up
 * front instead of decremented one spawn at a time. */
export function computeSpawnBudget(spawnQueueRemaining: number, aliveCount: number, concurrentCap: number): number {
  return Math.max(0, Math.min(spawnQueueRemaining, concurrentCap - aliveCount));
}

/** Pure: the phase transition once a wave's queue is fully drained and every spawned goose is gone
 * - 'cleared' once every wave in the table has been survived, otherwise a fresh intermission before
 * the next wave begins. Returns null (no transition) while the wave still has queued or alive
 * geese - callers should only act on a non-null result. */
export function resolveWaveCompletion(
  spawnQueueRemaining: number,
  aliveCount: number,
  waveIndex: number,
  totalWaves: number,
): 'cleared' | 'intermission' | null {
  if (spawnQueueRemaining !== 0 || aliveCount !== 0) return null;
  return waveIndex + 1 >= totalWaves ? 'cleared' : 'intermission';
}

/** Owns the live horde flock and wave progression - single-player and the multiplayer host run it
 * fully authoritative (spawn queue, chase AI, hit/contact resolution, wave advancement); a
 * multiplayer guest instead mirrors the host's authoritative geese as follower copies (see
 * HordeGoose.ts's class comment), exact same split as GooseManager. A late join/rejoin syncs the
 * current wave and every live goose via HordeSyncRequestMessage/listForSync (protocol.ts),
 * mirroring GooseManager's own gooseSyncRequest mechanism - previously a documented gap here,
 * fixed in the 2026-07-10 review. */
export class HordeGooseManager {
  private readonly geese = new Map<string, HordeGoose>();
  private waveIndex = 0;
  private phase: Phase = 'active';
  private spawnQueueRemaining = 0;
  private intermissionTimer = 0;
  private snapshotAccumulator = 0;
  private idCounter = 0;
  /** Follower side only - a guest never advances its own `waveIndex` (see the constructor's
   * isAuthoritative comment), so `currentWave` can't derive from it the way the authoritative side
   * does. Mirrors the host's wave number instead, updated whenever a hordeWaveStarted/hordeReset
   * broadcast arrives (see applyWaveStarted) - without this a guest's wave HUD indicator would
   * report "Wave 1" for the entire match regardless of what wave is actually in progress. */
  private followerWave = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly callbacks: HordeGooseManagerCallbacks,
    // Mutable: single-player Goose Horde respawns the player at a fresh random point after every
    // death, and the ring must follow them there (see recenter).
    private centerX: number,
    private centerZ: number,
    /** Single-player uses the 10-wave HORDE_WAVE_TABLE; multiplayer uses its own harder, longer
     * HORDE_WAVE_TABLE_MULTIPLAYER (see config.ts) - passed in rather than imported directly so
     * this class doesn't need to know which mode it's running in. Wave count is simply the table's
     * own length, not a separately-passed number that could drift out of sync with it. */
    private readonly waveTable: readonly HordeWaveSpec[],
    /** Single-player and the multiplayer host run the wave/spawn state machine themselves; a
     * guest is a pure follower of it (spawns/snapshots/explosions/wave events all arrive as
     * messages, applied via the "Follower side" methods below, never advancing its own copy of
     * `waveIndex`/`spawnQueueRemaining`) - without this split a guest would independently roll its
     * own spawns and desync from the host's actual flock, unlike the per-goose follower mode alone
     * (which only stops a guest's individual geese from self-adjudicating, not this manager-level
     * wave state). */
    private readonly isAuthoritative: boolean = true,
    /** Indoors only: spawn points away from the players and flight under the ceiling. */
    private readonly indoor: HordeIndoorSite | null = null,
  ) {
    if (this.isAuthoritative) this.beginWave();
  }

  private get indoorFlightHeight(): ((x: number, z: number) => number) | undefined {
    const indoor = this.indoor;
    return indoor ? (x, z) => indoor.flightHeight(x, z) : undefined;
  }

  get currentWave(): number {
    return this.isAuthoritative ? this.waveIndex + 1 : this.followerWave;
  }

  get totalWaves(): number {
    return this.waveTable.length;
  }

  get isCleared(): boolean {
    return this.phase === 'cleared';
  }

  get aliveCount(): number {
    return this.geese.size;
  }

  // ---- Authoritative side (single-player, multiplayer host) ----------------------------------

  /** No-op for a follower (guest) manager - see the constructor's isAuthoritative comment. Callers
   * don't need to check the flag themselves before calling this; it's safe (and a no-op) either
   * way. */
  update(dt: number, targetPositions: readonly THREE.Vector3[], isHost: boolean): void {
    if (!this.isAuthoritative || this.phase === 'cleared') return;

    if (this.phase === 'intermission') {
      this.intermissionTimer -= dt;
      if (this.intermissionTimer <= 0) {
        this.waveIndex++;
        this.beginWave();
      }
    }

    // Scales with the current wave (M5) rather than a flat cap - see HORDE_MAX_CONCURRENT_BASE's
    // own comment.
    const concurrentCap = computeConcurrentCap(this.waveIndex);
    const spawnBudget = computeSpawnBudget(this.spawnQueueRemaining, this.geese.size, concurrentCap);
    for (let i = 0; i < spawnBudget; i++) {
      this.spawnQueueRemaining--;
      this.spawnOne(targetPositions);
    }

    for (const goose of Array.from(this.geese.values())) {
      const target = nearestPosition(goose.position, targetPositions);
      if (target) goose.update(dt, target);
      if (goose.isDead) {
        this.geese.delete(goose.networkId);
        this.scene.remove(goose.mesh);
        const position = goose.position.clone();
        const reachedTarget = goose.hasReachedTarget;
        goose.dispose();
        if (reachedTarget) {
          this.callbacks.onExplosion(position);
          this.callbacks.onNetworkExplosion?.(goose.networkId, position.x, position.y, position.z);
        } else {
          this.callbacks.onNetworkRemove?.(goose.networkId);
        }
      }
    }

    if (this.phase === 'active') {
      const completion = resolveWaveCompletion(this.spawnQueueRemaining, this.geese.size, this.waveIndex, this.waveTable.length);
      if (completion === 'cleared') {
        this.phase = 'cleared';
        this.callbacks.onCleared();
        this.callbacks.onNetworkCleared?.();
      } else if (completion === 'intermission') {
        this.phase = 'intermission';
        this.intermissionTimer = HORDE_WAVE_INTERMISSION_SECONDS;
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

  /** Host-only: applies a hit reported by a guest, through the exact same one-hit-kill path the
   * host's own local hits already use directly. */
  registerRemoteHit(id: string): void {
    this.geese.get(id)?.kill();
  }

  /** Single-player only (see Game.ts's resetPlay) - dying restarts the whole run from wave 1,
   * clearing every currently-live goose immediately (no carrying a partial wave into the restart)
   * and beginning wave 1 right away, no intermission. Multiplayer deliberately does NOT call this
   * on an ordinary death anymore - that was tried and reverted (per explicit user report: it made
   * the limited-respawns/lives system pointless, since every single death wiped wave progress
   * regardless of how many respawns were left) - only single-player, which has no lives system,
   * still resets on every death. A no-op if this manager isn't authoritative (single-player is
   * always authoritative), but defensive all the same. */
  resetToWaveOne(): void {
    if (!this.isAuthoritative) return;
    this.callbacks.onNetworkReset?.();
    for (const goose of this.geese.values()) {
      this.scene.remove(goose.mesh);
      goose.dispose();
    }
    this.geese.clear();
    this.waveIndex = 0;
    this.phase = 'active';
    this.spawnQueueRemaining = 0;
    this.intermissionTimer = 0;
    this.beginWave();
  }

  /** Moves the spawn ring's center. Single-player's resetPlay calls this with the player's new random
   * respawn point before resetToWaveOne; without it, walkers and jumpers kept spawning around the
   * FIRST spawn point, possibly hundreds of metres away, so later runs dragged. */
  recenter(x: number, z: number): void {
    this.centerX = x;
    this.centerZ = z;
  }

  /** Follower side only (guest): the host just cleared the final wave. A follower never runs its own
   * wave state machine (update() returns early), so `phase` stayed 'active' forever and
   * Game.update()'s `isCleared` win check only ever fired on the host: guests were left in a frozen
   * world after a co-op win. */
  applyCleared(): void {
    this.phase = 'cleared';
  }

  /** Follower side only (guest): the host just reset the whole run to wave 1 - clears every local
   * follower goose immediately so nothing stale lingers on screen; the host's own fresh
   * hordeGooseSpawned/hordeWaveStarted broadcasts (from its own resetToWaveOne/beginWave) repopulate
   * it right after. */
  applyReset(): void {
    for (const goose of this.geese.values()) {
      this.scene.remove(goose.mesh);
      goose.dispose();
    }
    this.geese.clear();
    this.followerWave = 1;
  }

  /** Follower side only (guest): mirrors the host's current wave number, driven by the
   * hordeWaveStarted broadcast (see currentWave's own comment on why a guest can't derive this
   * from its own waveIndex). Harmless no-op on the authoritative side, same defensive shape as
   * every other follower method here. */
  applyWaveStarted(wave: number): void {
    this.followerWave = wave;
  }

  private beginWave(): void {
    const spec = this.waveTable[this.waveIndex]!;
    this.spawnQueueRemaining = spec.count;
    this.phase = 'active';
    this.callbacks.onWaveStart(this.currentWave);
    this.callbacks.onNetworkWaveStart?.(this.currentWave);
  }

  /** Authoritative side only (single-player has nothing to sync; the multiplayer host is the one
   * that answers a HordeSyncRequestMessage with this) - mirrors GooseManager.listForSync exactly,
   * plus `flavor` since a follower's local HordeGoose needs it to render the right descent/lunge
   * behavior (see HordeGooseSpawnedMessage). */
  listForSync(): { id: string; x: number; y: number; z: number; flavor: HordeGooseFlavor }[] {
    return Array.from(this.geese.values(), (goose) => ({
      id: goose.networkId,
      x: goose.position.x,
      y: goose.position.y,
      z: goose.position.z,
      flavor: goose.flavor,
    }));
  }

  private spawnOne(targetPositions: readonly THREE.Vector3[]): void {
    const spec = this.waveTable[this.waveIndex]!;
    const angle = Math.random() * Math.PI * 2;
    const indoorPoint = this.indoor?.spawnPoint(targetPositions) ?? null;
    const x = indoorPoint ? indoorPoint.x : this.centerX + Math.cos(angle) * HORDE_GOOSE_SPAWN_RADIUS;
    const z = indoorPoint ? indoorPoint.z : this.centerZ + Math.sin(angle) * HORDE_GOOSE_SPAWN_RADIUS;
    const y = sampleHeight(x, z) + GOOSE_HEIGHT / 2;
    const roll = Math.random();
    const flavor: HordeGooseFlavor = roll < spec.flyerChance ? 'flyer' : roll < spec.flyerChance + spec.jumperChance ? 'jumper' : 'walker';
    const speed = HORDE_GOOSE_BASE_SPEED * spec.speedMultiplier;
    const id = `horde-${this.idCounter++}`;

    const goose = new HordeGoose(this.physics, new THREE.Vector3(x, y, z), flavor, speed, id, undefined, this.indoorFlightHeight);
    this.scene.add(goose.mesh);
    this.geese.set(id, goose);
    this.callbacks.onNetworkSpawn?.(id, x, y, z, flavor);
  }

  // ---- Follower side (multiplayer guest) ------------------------------------------------------

  applyRemoteSpawn(id: string, x: number, y: number, z: number, flavor: HordeGooseFlavor): void {
    if (this.geese.has(id)) return;
    const goose = new HordeGoose(this.physics, new THREE.Vector3(x, y, z), flavor, 0, id, () => this.callbacks.onLocalHitReported?.(id), this.indoorFlightHeight);
    this.scene.add(goose.mesh);
    this.geese.set(id, goose);
  }

  applyRemoteSnapshot(id: string, x: number, y: number, z: number): void {
    this.geese.get(id)?.snapTo(x, y, z);
  }

  applyExplosion(id: string, position: THREE.Vector3): void {
    this.removeLocal(id);
    this.callbacks.onExplosion(position);
  }

  applyRemove(id: string): void {
    this.removeLocal(id);
  }

  private removeLocal(id: string): void {
    const goose = this.geese.get(id);
    if (!goose) return;
    this.geese.delete(id);
    this.scene.remove(goose.mesh);
    goose.dispose();
  }

  // ---- Shared ------------------------------------------------------------------------------------

  dispose(): void {
    for (const goose of this.geese.values()) {
      this.scene.remove(goose.mesh);
      goose.dispose();
    }
    this.geese.clear();
  }
}

function nearestPosition(from: THREE.Vector3, candidates: readonly THREE.Vector3[]): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestDistSq = Infinity;
  for (const candidate of candidates) {
    const distSq = from.distanceToSquared(candidate);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = candidate;
    }
  }
  return best;
}
