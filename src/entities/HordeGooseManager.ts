import * as THREE from 'three';
import { HordeGoose, type HordeGooseFlavor } from './HordeGoose.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import {
  GOOSE_HEIGHT,
  GOOSE_SNAPSHOT_SEND_INTERVAL,
  HORDE_GOOSE_BASE_SPEED,
  HORDE_GOOSE_SPAWN_RADIUS,
  HORDE_MAX_CONCURRENT,
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

/** Owns the live horde flock and wave progression - single-player and the multiplayer host run it
 * fully authoritative (spawn queue, chase AI, hit/contact resolution, wave advancement); a
 * multiplayer guest instead mirrors the host's authoritative geese as follower copies (see
 * HordeGoose.ts's class comment), exact same split as GooseManager. Known simplification: no
 * late-join sync (unlike GooseManager's gooseSyncRequest) - a player joining a horde match already
 * in progress only sees geese spawned from that point on, since this mode wasn't asked to support
 * mid-match joining the way the PvP modes are. */
export class HordeGooseManager {
  private readonly geese = new Map<string, HordeGoose>();
  private waveIndex = 0;
  private phase: Phase = 'active';
  private spawnQueueRemaining = 0;
  private intermissionTimer = 0;
  private snapshotAccumulator = 0;
  private idCounter = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly callbacks: HordeGooseManagerCallbacks,
    private readonly centerX: number,
    private readonly centerZ: number,
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
  ) {
    if (this.isAuthoritative) this.beginWave();
  }

  get currentWave(): number {
    return this.waveIndex + 1;
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

    while (this.spawnQueueRemaining > 0 && this.geese.size < HORDE_MAX_CONCURRENT) {
      this.spawnQueueRemaining--;
      this.spawnOne();
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

    if (this.phase === 'active' && this.spawnQueueRemaining === 0 && this.geese.size === 0) {
      if (this.waveIndex + 1 >= this.waveTable.length) {
        this.phase = 'cleared';
        this.callbacks.onCleared();
        this.callbacks.onNetworkCleared?.();
      } else {
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
    this.geese.get(id)?.takeDamage(0, -1);
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
  }

  private beginWave(): void {
    const spec = this.waveTable[this.waveIndex]!;
    this.spawnQueueRemaining = spec.count;
    this.phase = 'active';
    this.callbacks.onWaveStart(this.currentWave);
    this.callbacks.onNetworkWaveStart?.(this.currentWave);
  }

  private spawnOne(): void {
    const spec = this.waveTable[this.waveIndex]!;
    const angle = Math.random() * Math.PI * 2;
    const x = this.centerX + Math.cos(angle) * HORDE_GOOSE_SPAWN_RADIUS;
    const z = this.centerZ + Math.sin(angle) * HORDE_GOOSE_SPAWN_RADIUS;
    const y = sampleHeight(x, z) + GOOSE_HEIGHT / 2;
    const roll = Math.random();
    const flavor: HordeGooseFlavor = roll < spec.flyerChance ? 'flyer' : roll < spec.flyerChance + spec.jumperChance ? 'jumper' : 'walker';
    const speed = HORDE_GOOSE_BASE_SPEED * spec.speedMultiplier;
    const id = `horde-${this.idCounter++}`;

    const goose = new HordeGoose(this.physics, new THREE.Vector3(x, y, z), flavor, speed, id);
    this.scene.add(goose.mesh);
    this.geese.set(id, goose);
    this.callbacks.onNetworkSpawn?.(id, x, y, z, flavor);
  }

  // ---- Follower side (multiplayer guest) ------------------------------------------------------

  applyRemoteSpawn(id: string, x: number, y: number, z: number, flavor: HordeGooseFlavor): void {
    if (this.geese.has(id)) return;
    const goose = new HordeGoose(this.physics, new THREE.Vector3(x, y, z), flavor, 0, id, () => this.callbacks.onLocalHitReported?.(id));
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
