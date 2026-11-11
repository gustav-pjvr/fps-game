import * as THREE from 'three';
import { HordeGoose, type HordeGooseFlavor } from './HordeGoose.ts';
import {
  HORDE_BOSSES,
  HORDE_FLAVORS,
  hordeBossHealth,
  hordeBruteCount,
  hordeBruteHealth,
  hordeWaveCount,
  supplyKillValue,
  supplyKillsNeeded,
  type HordeBossId,
  type HordeFlavorStats,
} from './hordeRules.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import {
  GOOSE_HEIGHT,
  GOOSE_SNAPSHOT_SEND_INTERVAL,
  HORDE_BRUTE_SPAWN_INTERVAL,
  HORDE_GOOSE_BASE_SPEED,
  HORDE_GOOSE_SPAWN_RADIUS,
  HORDE_MAX_CONCURRENT_BASE,
  HORDE_MAX_CONCURRENT_CEILING,
  HORDE_STATE_SEND_INTERVAL,
  HORDE_WAVE_INTERMISSION_SECONDS,
  type HordeWaveSpec,
} from '../core/config.ts';

/** The wave panel's numbers (ui/hordeHud.ts): the authoritative side's own, or a guest's copy of the
 * host's last hordeState message. */
export interface HordeView {
  readonly wave: number;
  readonly totalWaves: number;
  readonly phase: 'active' | 'intermission' | 'cleared';
  /** Seconds to the next wave, during an intermission. */
  readonly nextIn: number;
  /** Geese still to kill this wave: alive, plus those yet to come in. */
  readonly left: number;
  /** The squad's kills toward its next supply drop, and how many that takes. */
  readonly meter: number;
  readonly need: number;
  readonly boss: { readonly id: HordeBossId; readonly hp: number; readonly max: number } | null;
  /** Kills per slot (slot 0 in single-player). */
  readonly kills: ReadonlyMap<number, number>;
}

/** What the host tells every guest about the run (protocol.ts's HordeStateMessage, without its type). */
export interface HordeStatePayload {
  wave: number;
  phase: 'active' | 'intermission';
  nextIn: number;
  left: number;
  meter: number;
  need: number;
  boss: { id: HordeBossId; hp: number; max: number } | null;
  kills: { slot: 0 | 1 | 2 | 3; kills: number }[];
}

export interface HordeGooseManagerCallbacks {
  /** A wave begins; `boss` names its boss on a boss wave. */
  onWaveStart: (wave: number, boss: HordeBossId | undefined) => void;
  /** A wave is survived and the breather before the next one begins (never after the last wave). */
  onWaveCleared?: (wave: number) => void;
  /** Every wave survived - the win condition. */
  onCleared: () => void;
  /** A goose reached a target and went off, or a boss stomped - VFX/sound and the local player's
   * damage are the caller's job; `stats` carries that blast's reach, damage and push. */
  onExplosion: (position: THREE.Vector3, stats: HordeFlavorStats) => void;
  /** Authoritative side: the squad's kills filled the supply meter. */
  onSupplyEarned?: () => void;
  /** Authoritative side only (single-player has nothing to wire these to; host wires them to
   * connection.send) - mirrors GooseManager's identical split. */
  onNetworkSpawn?: (id: string, x: number, y: number, z: number, flavor: HordeGooseFlavor, boss: HordeBossId | undefined) => void;
  onNetworkSnapshot?: (id: string, x: number, y: number, z: number) => void;
  onNetworkExplosion?: (id: string, x: number, y: number, z: number, stomp: boolean) => void;
  /** A goose was shot dead (no explosion) - the host-only broadcast for that case. */
  onNetworkRemove?: (id: string) => void;
  onNetworkWaveStart?: (wave: number) => void;
  onNetworkCleared?: () => void;
  /** The run restarted from wave 1 - host-only broadcast (see resetToWaveOne). */
  onNetworkReset?: () => void;
  /** Host only: the wave panel's numbers, twice a second and at once on a change. */
  onNetworkState?: (state: HordeStatePayload) => void;
  /** Follower side only (guest): a local hit landed on a goose this client doesn't have final say
   * over - see GooseManager's identical contract. `damage` is what it would take off a brute or boss. */
  onLocalHitReported?: (id: string, damage: number) => void;
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

/** Most damage one reported hit may take off a brute or a boss: a guest reports its own hits, and
 * the heaviest single hit in the arsenal is well under this. */
const REMOTE_HIT_MAX_DAMAGE = 400;
/** What a hit reported without a damage figure (an older guest) takes off. */
const REMOTE_HIT_DEFAULT_DAMAGE = 40;
/** How far from its boss a brood hatches (m). */
const BROOD_RING_RADIUS = 2.4;
/** What a Second Wind's blast takes off a brute or a boss it reaches. */
const CLEAR_BLAST_HEAVY_DAMAGE = 150;

/** Pure: how many geese are allowed alive at once during `waveIndex` for a squad of `players` -
 * scales with the wave (M5) and a little with the squad, up to a hard ceiling, rather than a flat
 * cap. Exported so wave-progression accounting can be unit tested without a live
 * PhysicsWorld/THREE.Scene - HordeGooseManager itself needs real Rapier physics to spawn/steer
 * geese, which this repo's Vitest unit-test layer deliberately never touches (see vitest.config.ts's
 * own comment); this and its two siblings below pull the actual bookkeeping math out where it can be. */
export function computeConcurrentCap(waveIndex: number, players = 1): number {
  const extra = 2 * (Math.max(1, Math.min(4, players)) - 1);
  return Math.min(HORDE_MAX_CONCURRENT_CEILING + extra, HORDE_MAX_CONCURRENT_BASE + waveIndex + extra);
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
 * geese - callers should only act on a non-null result. `spawnQueueRemaining` counts everything
 * still to come in: the small geese, the brutes and a boss not yet on the field. */
export function resolveWaveCompletion(
  spawnQueueRemaining: number,
  aliveCount: number,
  waveIndex: number,
  totalWaves: number,
): 'cleared' | 'intermission' | null {
  if (spawnQueueRemaining !== 0 || aliveCount !== 0) return null;
  return waveIndex + 1 >= totalWaves ? 'cleared' : 'intermission';
}

/** Pure: the supply meter after a kill worth `value`: the new meter, and whether a drop was earned.
 * A drop empties the meter (a boss's kill is worth far more than one drop and earns exactly one). */
export function advanceSupplyMeter(meter: number, value: number, need: number): { meter: number; earned: boolean } {
  const next = meter + value;
  return next >= need ? { meter: 0, earned: true } : { meter: next, earned: false };
}

/** Owns the live horde flock and wave progression (docs/goose-horde.md) - single-player and the
 * multiplayer host run it fully authoritative (spawn queue, chase AI, hit/contact resolution, wave
 * advancement, the kill count and the supply meter); a multiplayer guest instead mirrors the host's
 * authoritative geese as follower copies (see HordeGoose.ts's class comment), exact same split as
 * GooseManager, and shows the host's numbers (applyState). A late join/rejoin syncs the current
 * wave and every live goose via HordeSyncRequestMessage/listForSync (protocol.ts). */
export class HordeGooseManager {
  private readonly geese = new Map<string, HordeGoose>();
  private waveIndex = 0;
  private phase: Phase = 'active';
  private spawnQueueRemaining = 0;
  private brutesRemaining = 0;
  private bruteTimer = 0;
  private bossPending: HordeBossId | null = null;
  private broodTimer = 0;
  private intermissionTimer = 0;
  private snapshotAccumulator = 0;
  private stateAccumulator = 0;
  private stateDirty = true;
  private idCounter = 0;
  /** The squad this wave was sized for, read when the wave begins: a player who joins mid-wave is
   * counted from the next one. */
  private squadSize = 1;
  private meter = 0;
  private readonly kills = new Map<number, number>();
  /** Test-only (window.__gameDebug.holdHordeWave): a wave that has run out of geese does not end,
   * so a slow browser run can finish its checks inside one wave. Never set by gameplay code. */
  debugWaveHeld = false;
  /** Follower side only: the host's last state, shown as is (see `view`). */
  private followerState: HordeStatePayload | null = null;
  /** Follower side only - a guest never advances its own `waveIndex` (see the constructor's
   * isAuthoritative comment), so `currentWave` can't derive from it the way the authoritative side
   * does. Mirrors the host's wave number instead, updated whenever a hordeWaveStarted/hordeReset
   * broadcast or a state message arrives. */
  private followerWave = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly callbacks: HordeGooseManagerCallbacks,
    // Mutable: single-player Goose Horde respawns the player at a fresh random point after every
    // death, and the ring must follow them there (see recenter).
    private centerX: number,
    private centerZ: number,
    /** The waves (config.ts's HORDE_WAVE_TABLE): passed in rather than imported so a test can run a
     * short table. Wave count is simply the table's own length. */
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
    /** How many players are in the run now (1 in single-player): each wave is sized for it. */
    private readonly players: () => number = () => 1,
    /** The slot the authoritative side's own hits count for (0 in single-player). */
    private readonly localSlot: number = 0,
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

  /** The wave panel's numbers, on either side. */
  get view(): HordeView {
    if (!this.isAuthoritative) {
      const state = this.followerState;
      return {
        wave: this.followerWave,
        totalWaves: this.waveTable.length,
        phase: this.phase === 'cleared' ? 'cleared' : state?.phase ?? 'active',
        nextIn: state?.nextIn ?? 0,
        left: state?.left ?? this.geese.size,
        meter: state?.meter ?? 0,
        need: state?.need ?? supplyKillsNeeded(1),
        boss: state?.boss ?? null,
        kills: new Map(state?.kills.map((entry) => [entry.slot, entry.kills]) ?? []),
      };
    }
    return {
      wave: this.waveIndex + 1,
      totalWaves: this.waveTable.length,
      phase: this.phase,
      nextIn: Math.max(0, this.intermissionTimer),
      left: this.remainingToSpawn + this.geese.size,
      meter: this.meter,
      need: supplyKillsNeeded(this.squadSize),
      boss: this.liveBoss(),
      kills: this.kills,
    };
  }

  private get remainingToSpawn(): number {
    return this.spawnQueueRemaining + this.brutesRemaining + (this.bossPending ? 1 : 0);
  }

  private liveBoss(): { id: HordeBossId; hp: number; max: number } | null {
    for (const goose of this.geese.values()) {
      if (goose.bossId) return { id: goose.bossId, hp: Math.ceil(goose.currentHealth), max: goose.maxHealth };
    }
    return null;
  }

  // ---- Authoritative side (single-player, multiplayer host) ----------------------------------

  /** The authoritative side runs the waves; a follower (guest) only fades its geese's hit flashes.
   * Callers don't need to check the flag themselves before calling this. */
  update(dt: number, targetPositions: readonly THREE.Vector3[], isHost: boolean): void {
    for (const goose of this.geese.values()) goose.tickEffects(dt);
    if (!this.isAuthoritative || this.phase === 'cleared') return;

    if (this.phase === 'intermission') {
      this.intermissionTimer -= dt;
      if (this.intermissionTimer <= 0) {
        this.waveIndex++;
        this.beginWave();
      }
    }

    if (this.phase === 'active') this.spawnDue(dt, targetPositions);

    for (const goose of Array.from(this.geese.values())) {
      const target = nearestPosition(goose.position, targetPositions);
      if (target) goose.update(dt, target);
      if (goose.consumeStomp()) {
        const at = goose.position;
        this.callbacks.onExplosion(at.clone(), goose.stats);
        this.callbacks.onNetworkExplosion?.(goose.networkId, at.x, at.y, at.z, true);
      }
      if (goose.isDead) this.retire(goose);
    }

    if (this.phase === 'active' && !this.debugWaveHeld) {
      const completion = resolveWaveCompletion(this.remainingToSpawn, this.geese.size, this.waveIndex, this.waveTable.length);
      if (completion === 'cleared') {
        this.phase = 'cleared';
        this.callbacks.onCleared();
        this.callbacks.onNetworkCleared?.();
      } else if (completion === 'intermission') {
        this.phase = 'intermission';
        this.intermissionTimer = HORDE_WAVE_INTERMISSION_SECONDS;
        this.stateDirty = true;
        this.callbacks.onWaveCleared?.(this.waveIndex + 1);
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
      this.stateAccumulator += dt;
      if (this.stateDirty || this.stateAccumulator >= HORDE_STATE_SEND_INTERVAL) {
        this.stateAccumulator = 0;
        this.stateDirty = false;
        this.callbacks.onNetworkState?.(this.statePayload());
      }
    }
  }

  /** Everything that comes in this tick: the boss first, the small geese up to the concurrent cap,
   * a brute every HORDE_BRUTE_SPAWN_INTERVAL, and a live boss's brood. */
  private spawnDue(dt: number, targetPositions: readonly THREE.Vector3[]): void {
    if (this.bossPending) {
      const boss = this.bossPending;
      this.bossPending = null;
      this.broodTimer = HORDE_BOSSES[boss].broodEvery;
      this.spawnOne(targetPositions, 'boss', boss);
      this.stateDirty = true;
    }

    // Scales with the current wave (M5) rather than a flat cap - see HORDE_MAX_CONCURRENT_BASE's
    // own comment.
    const concurrentCap = computeConcurrentCap(this.waveIndex, this.squadSize);
    const spawnBudget = computeSpawnBudget(this.spawnQueueRemaining, this.geese.size, concurrentCap);
    for (let i = 0; i < spawnBudget; i++) {
      this.spawnQueueRemaining--;
      this.spawnOne(targetPositions);
    }

    if (this.brutesRemaining > 0) {
      this.bruteTimer -= dt;
      if (this.bruteTimer <= 0) {
        this.bruteTimer = HORDE_BRUTE_SPAWN_INTERVAL;
        this.brutesRemaining--;
        this.spawnOne(targetPositions, 'brute');
      }
    }

    const boss = this.liveBossGoose();
    if (boss?.bossId) {
      this.broodTimer -= dt;
      if (this.broodTimer <= 0) {
        const stats = HORDE_BOSSES[boss.bossId];
        this.broodTimer = stats.broodEvery;
        // A brood may go a little past the cap: it is the boss's own pressure, not the wave's.
        const room = Math.max(0, concurrentCap + stats.broodSize - this.geese.size);
        for (let i = 0; i < Math.min(stats.broodSize, room); i++) {
          const angle = Math.random() * Math.PI * 2;
          this.spawnAt(boss.position.x + Math.cos(angle) * BROOD_RING_RADIUS, boss.position.z + Math.sin(angle) * BROOD_RING_RADIUS, 'walker');
        }
      }
    }
  }

  private liveBossGoose(): HordeGoose | null {
    for (const goose of this.geese.values()) if (goose.bossId) return goose;
    return null;
  }

  /** Takes a dead goose off the field: a goose that reached its target goes off, one that was shot
   * counts for whoever landed the last hit and feeds the supply meter. */
  private retire(goose: HordeGoose): void {
    this.geese.delete(goose.networkId);
    this.scene.remove(goose.mesh);
    const position = goose.position.clone();
    const reachedTarget = goose.hasReachedTarget;
    goose.dispose();
    this.stateDirty = true;
    if (reachedTarget) {
      this.callbacks.onExplosion(position, goose.stats);
      this.callbacks.onNetworkExplosion?.(goose.networkId, position.x, position.y, position.z, false);
      return;
    }
    this.callbacks.onNetworkRemove?.(goose.networkId);
    const slot = goose.lastHitSlot ?? this.localSlot;
    this.kills.set(slot, (this.kills.get(slot) ?? 0) + 1);
    const supply = advanceSupplyMeter(this.meter, supplyKillValue(goose.flavor), supplyKillsNeeded(this.squadSize));
    this.meter = supply.meter;
    if (supply.earned) this.callbacks.onSupplyEarned?.();
  }

  /** Host-only: applies a hit a guest reported. A small goose dies to it; a brute or a boss loses
   * `damage`, capped (a guest reports its own hits). */
  registerRemoteHit(id: string, slot: number, damage: number | undefined): void {
    const amount = Math.max(0, Math.min(REMOTE_HIT_MAX_DAMAGE, damage ?? REMOTE_HIT_DEFAULT_DAMAGE));
    this.geese.get(id)?.applyHit(amount, slot);
  }

  /** Authoritative side: a Second Wind's blast. Every small goose within `radius` of `position` is
   * gone (no kill counted, no explosion), and a brute or a boss there takes a heavy hit. */
  clearAround(position: THREE.Vector3, radius: number): void {
    if (!this.isAuthoritative) return;
    for (const goose of this.geese.values()) {
      if (goose.isDead || Math.hypot(goose.position.x - position.x, goose.position.z - position.z) > radius) continue;
      if (goose.stats.health <= 1) goose.kill();
      else goose.applyHit(CLEAR_BLAST_HEAVY_DAMAGE, null);
    }
  }

  /** Single-player only (see Game.ts's resetPlay) - dying with no Second Wind left restarts the
   * whole run from wave 1, clearing every currently-live goose immediately (no carrying a partial
   * wave into the restart) and beginning wave 1 right away, no intermission. Co-op never calls
   * this: its squad goes down and gets back up (docs/goose-horde.md). A no-op if this manager
   * isn't authoritative (single-player is always authoritative), but defensive all the same. */
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
    this.intermissionTimer = 0;
    this.meter = 0;
    this.kills.clear();
    this.beginWave();
  }

  /** Test-only (window.__gameDebug.setHordeWave), authoritative side: drops what is left of the
   * current wave and begins wave `wave` (1 based) at once. */
  debugSkipToWave(wave: number): void {
    if (!this.isAuthoritative || this.phase === 'cleared') return;
    for (const goose of this.geese.values()) {
      this.scene.remove(goose.mesh);
      goose.dispose();
      this.callbacks.onNetworkRemove?.(goose.networkId);
    }
    this.geese.clear();
    this.waveIndex = Math.max(0, Math.min(this.waveTable.length - 1, Math.floor(wave) - 1));
    this.intermissionTimer = 0;
    this.beginWave();
  }

  /** Test-only (window.__gameDebug.killHordeGeese), authoritative side: every live goose dies as if
   * this side's own player had shot it. */
  debugKillAll(): void {
    if (!this.isAuthoritative) return;
    for (const goose of this.geese.values()) goose.applyHit(Number.MAX_SAFE_INTEGER, this.localSlot);
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
    this.followerState = null;
  }

  /** Follower side only (guest): mirrors the host's current wave number, driven by the
   * hordeWaveStarted broadcast (see currentWave's own comment on why a guest can't derive this
   * from its own waveIndex). Harmless no-op on the authoritative side, same defensive shape as
   * every other follower method here. */
  applyWaveStarted(wave: number): void {
    this.followerWave = wave;
  }

  /** Follower side only (guest): the host's numbers for the wave panel, taken as they are. */
  applyState(state: HordeStatePayload): void {
    if (this.isAuthoritative) return;
    this.followerState = state;
    this.followerWave = state.wave;
    if (state.boss) {
      for (const goose of this.geese.values()) if (goose.bossId) goose.setHealth(state.boss.hp);
    }
  }

  /** Authoritative side: the state a guest is sent (also a late joiner's, in its sync). */
  statePayload(): HordeStatePayload {
    return {
      wave: this.waveIndex + 1,
      phase: this.phase === 'intermission' ? 'intermission' : 'active',
      nextIn: Math.max(0, Math.round(this.intermissionTimer * 10) / 10),
      left: this.remainingToSpawn + this.geese.size,
      meter: this.meter,
      need: supplyKillsNeeded(this.squadSize),
      boss: this.liveBoss(),
      kills: Array.from(this.kills, ([slot, kills]) => ({ slot: slot as 0 | 1 | 2 | 3, kills })),
    };
  }

  private beginWave(): void {
    const spec = this.waveTable[this.waveIndex]!;
    this.squadSize = Math.max(1, Math.min(4, this.players()));
    this.spawnQueueRemaining = hordeWaveCount(spec, this.squadSize);
    this.brutesRemaining = hordeBruteCount(spec, this.squadSize);
    this.bruteTimer = HORDE_BRUTE_SPAWN_INTERVAL / 2;
    this.bossPending = spec.boss ?? null;
    this.phase = 'active';
    this.stateDirty = true;
    this.callbacks.onWaveStart(this.currentWave, spec.boss);
    this.callbacks.onNetworkWaveStart?.(this.currentWave);
  }

  /** Authoritative side (single-player has nothing to sync; the multiplayer host is the one
   * that answers a HordeSyncRequestMessage with this) - mirrors GooseManager.listForSync exactly,
   * plus `flavor` (and `boss`) since a follower's local HordeGoose needs them to build the right
   * goose (see HordeGooseSpawnedMessage). */
  listForSync(): { id: string; x: number; y: number; z: number; flavor: HordeGooseFlavor; boss?: HordeBossId }[] {
    return Array.from(this.geese.values(), (goose) => ({
      id: goose.networkId,
      x: goose.position.x,
      // A follower's goose lifts itself to its own size on the way in (see spawnAt).
      y: goose.position.y - sizeLift(goose.flavor),
      z: goose.position.z,
      flavor: goose.flavor,
      ...(goose.bossId ? { boss: goose.bossId } : {}),
    }));
  }

  private spawnOne(targetPositions: readonly THREE.Vector3[], forced?: 'brute' | 'boss', boss?: HordeBossId): void {
    const spec = this.waveTable[this.waveIndex]!;
    const angle = Math.random() * Math.PI * 2;
    const indoorPoint = this.indoor?.spawnPoint(targetPositions) ?? null;
    const x = indoorPoint ? indoorPoint.x : this.centerX + Math.cos(angle) * HORDE_GOOSE_SPAWN_RADIUS;
    const z = indoorPoint ? indoorPoint.z : this.centerZ + Math.sin(angle) * HORDE_GOOSE_SPAWN_RADIUS;
    const roll = Math.random();
    const flavor: HordeGooseFlavor = forced ?? (roll < spec.flyerChance ? 'flyer' : roll < spec.flyerChance + spec.jumperChance ? 'jumper' : 'walker');
    this.spawnAt(x, z, flavor, boss);
  }

  private spawnAt(x: number, z: number, flavor: HordeGooseFlavor, boss?: HordeBossId): void {
    const spec = this.waveTable[this.waveIndex]!;
    // The height of an ordinary goose standing there; a bigger goose lifts itself to its own size.
    const y = sampleHeight(x, z) + GOOSE_HEIGHT / 2;
    const speed = HORDE_GOOSE_BASE_SPEED * spec.speedMultiplier;
    const id = `horde-${this.idCounter++}`;
    const health = flavor === 'boss' && boss ? hordeBossHealth(boss, this.squadSize) : flavor === 'brute' ? hordeBruteHealth(this.squadSize) : undefined;

    const goose = new HordeGoose(this.physics, new THREE.Vector3(x, y, z), flavor, speed, id, undefined, this.indoorFlightHeight, health, boss);
    this.scene.add(goose.mesh);
    this.geese.set(id, goose);
    this.callbacks.onNetworkSpawn?.(id, x, y, z, flavor, boss);
  }

  // ---- Follower side (multiplayer guest) ------------------------------------------------------

  applyRemoteSpawn(id: string, x: number, y: number, z: number, flavor: HordeGooseFlavor, boss?: HordeBossId): void {
    if (this.geese.has(id)) return;
    const health = flavor === 'boss' && boss ? this.followerState?.boss?.max : undefined;
    const goose = new HordeGoose(
      this.physics,
      new THREE.Vector3(x, y, z),
      flavor,
      0,
      id,
      (damage) => this.callbacks.onLocalHitReported?.(id, damage),
      this.indoorFlightHeight,
      health,
      boss,
    );
    this.scene.add(goose.mesh);
    this.geese.set(id, goose);
  }

  applyRemoteSnapshot(id: string, x: number, y: number, z: number): void {
    this.geese.get(id)?.snapTo(x, y, z);
  }

  /** A goose went off at `position`. A boss's stomp leaves the boss standing. */
  applyExplosion(id: string, position: THREE.Vector3, stomp = false): void {
    const stats = this.geese.get(id)?.stats ?? HORDE_FLAVORS.walker;
    if (!stomp) this.removeLocal(id);
    this.callbacks.onExplosion(position, stats);
  }

  /** A frag (combat/grenades): every live goose it reaches takes a hit, through the same path a
   * bullet does (HordeGoose.takeDamage: the host or single-player applies it, a guest reports it). */
  applyBlast(
    _position: THREE.Vector3,
    damageFor: (center: THREE.Vector3, height: number, entity: object) => number,
  ): void {
    for (const goose of this.geese.values()) {
      if (goose.isDead) continue;
      const amount = damageFor(goose.position, goose.height, goose);
      if (amount > 0) goose.takeDamage(amount, -1);
    }
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

/** How far a goose of `flavor` stands above an ordinary goose's centre height. */
function sizeLift(flavor: HordeGooseFlavor): number {
  return (HORDE_FLAVORS[flavor].scale - 1) * (GOOSE_HEIGHT / 2);
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
