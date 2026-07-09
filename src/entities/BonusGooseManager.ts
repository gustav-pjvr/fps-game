import * as THREE from 'three';
import { Goose } from './Goose.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import type { PlayerSlot } from '../network/protocol.ts';
import {
  BONUS_GOOSE_MAX_RESPAWN_DELAY_SECONDS,
  BONUS_GOOSE_MIN_RESPAWN_DELAY_SECONDS,
  BONUS_GOOSE_SPAWN_RADIUS,
  BONUS_GOOSE_TINT,
  GOOSE_HEIGHT,
  GOOSE_HITS_TO_KILL,
  GOOSE_SNAPSHOT_SEND_INTERVAL,
} from '../core/config.ts';

export interface BonusGooseManagerCallbacks {
  /** Fired on every client the instant a bonus goose exists (authoritative spawn, or a follower
   * mirroring one) - Game.ts wires this to the big center-screen announcement. */
  onSpawned: () => void;
  /** Fired on every client once the goose is confirmed dead, regardless of who gets credit -
   * `killerSlot` is whoever landed the final hit (null in single-player, where there's no slot
   * concept but only one possible "killer" anyway - Game.ts treats null as "always this client" in
   * that case). Game.ts checks this against its own slot to decide whether to grant the reward. */
  onKilled: (killerSlot: PlayerSlot | null) => void;
  /** Authoritative side only (single-player has nothing to wire these to; host wires them to
   * connection.send) - mirrors GooseManager's identical split. */
  onNetworkSpawn?: (id: string, x: number, y: number, z: number) => void;
  onNetworkSnapshot?: (id: string, x: number, y: number, z: number) => void;
  onNetworkKilled?: (killerSlot: PlayerSlot | null) => void;
  /** Follower side only (guest): a local hit landed on a goose this client doesn't have final say
   * over - see GooseManager's identical contract. */
  onLocalHitReported?: (id: string) => void;
}

function randomRespawnDelay(): number {
  return BONUS_GOOSE_MIN_RESPAWN_DELAY_SECONDS + Math.random() * (BONUS_GOOSE_MAX_RESPAWN_DELAY_SECONDS - BONUS_GOOSE_MIN_RESPAWN_DELAY_SECONDS);
}

function tintGold(mesh: THREE.Group): void {
  mesh.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.color.setHex(BONUS_GOOSE_TINT);
      child.material.emissive.setHex(BONUS_GOOSE_TINT);
      child.material.emissiveIntensity = 0.35;
    }
  });
}

/** The bonus "golden goose" (see config.ts's BONUS_GOOSE_* comment) - exactly one at a time,
 * respawning after a random delay once killed. Reuses the plain wandering `Goose` class as-is for
 * mesh/AI (tinted gold), but deliberately does NOT let it manage its own death: every Goose
 * instance here is constructed with a hit-report callback (repurposing the "follower" mechanism
 * Goose.ts normally reserves for multiplayer guests, here used unconditionally on every side) so
 * `takeDamage` always just reports "a local hit landed" instead of deciding death internally - this
 * manager tracks hit count AND which slot landed each hit itself, since (unlike the normal
 * exploding goose) death here needs to remember WHO gets credit for the final hit, not just that it
 * happened. Same authoritative(single-player/host)/follower(guest) split as GooseManager/
 * HordeGooseManager otherwise. */
export class BonusGooseManager {
  private goose: Goose | null = null;
  private id: string | null = null;
  private hitsTaken = 0;
  private lastHitSlot: PlayerSlot | null = null;
  private respawnTimer = randomRespawnDelay();
  private snapshotAccumulator = 0;
  private idCounter = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly callbacks: BonusGooseManagerCallbacks,
    /** Single-player and the multiplayer host run the spawn-timer/hit-attribution state machine
     * themselves; a guest is a pure follower (spawns/snapshots/kills all arrive as messages),
     * exact same reasoning as HordeGooseManager's identical flag. */
    private readonly isAuthoritative: boolean,
    /** This client's own slot, for attributing an authoritative side's OWN local hit (the host
     * shooting it themselves) - null in single-player (no slot concept) and unused on a guest
     * (which never calls registerLocalHit). */
    private readonly ownSlot: PlayerSlot | null,
  ) {}

  // ---- Authoritative side (single-player, multiplayer host) ----------------------------------

  update(dt: number, isHost: boolean): void {
    if (!this.isAuthoritative) return;

    if (this.goose) {
      this.goose.update(dt);
      if (isHost) {
        this.snapshotAccumulator += dt;
        if (this.snapshotAccumulator >= GOOSE_SNAPSHOT_SEND_INTERVAL) {
          this.snapshotAccumulator = 0;
          const p = this.goose.position;
          this.callbacks.onNetworkSnapshot?.(this.id!, p.x, p.y, p.z);
        }
      }
      return;
    }

    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0) this.spawnOne();
  }

  /** This client's own local hitscan (single-player, or the host shooting it themselves) landed a
   * hit on the authoritative goose. */
  registerLocalHit(): void {
    this.registerHit(this.ownSlot);
  }

  /** Host-only: applies a hit reported by a guest, attributed to that guest's own slot. */
  registerRemoteHit(senderSlot: PlayerSlot): void {
    this.registerHit(senderSlot);
  }

  private registerHit(slot: PlayerSlot | null): void {
    if (!this.isAuthoritative || !this.goose) return;
    this.hitsTaken++;
    this.lastHitSlot = slot;
    if (this.hitsTaken >= GOOSE_HITS_TO_KILL) this.killGoose();
  }

  private spawnOne(): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * BONUS_GOOSE_SPAWN_RADIUS;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = sampleHeight(x, z) + GOOSE_HEIGHT / 2;
    const id = `bonus-${this.idCounter++}`;

    this.id = id;
    this.hitsTaken = 0;
    this.lastHitSlot = null;
    this.goose = new Goose(this.physics, new THREE.Vector3(x, y, z), id, Math.random, () => this.registerLocalHit());
    tintGold(this.goose.mesh);
    this.scene.add(this.goose.mesh);

    this.callbacks.onSpawned();
    this.callbacks.onNetworkSpawn?.(id, x, y, z);
  }

  private killGoose(): void {
    if (!this.goose) return;
    const killerSlot = this.lastHitSlot;
    this.scene.remove(this.goose.mesh);
    this.goose.dispose();
    this.goose = null;
    this.id = null;
    this.hitsTaken = 0;
    this.lastHitSlot = null;
    this.respawnTimer = randomRespawnDelay();

    this.callbacks.onNetworkKilled?.(killerSlot);
    this.callbacks.onKilled(killerSlot);
  }

  // ---- Follower side (multiplayer guest) ------------------------------------------------------

  applyRemoteSpawn(id: string, x: number, y: number, z: number): void {
    if (this.goose) return; // never more than one live at a time
    this.id = id;
    this.goose = new Goose(this.physics, new THREE.Vector3(x, y, z), id, Math.random, () => this.callbacks.onLocalHitReported?.(id));
    tintGold(this.goose.mesh);
    this.scene.add(this.goose.mesh);
    this.callbacks.onSpawned();
  }

  applyRemoteSnapshot(id: string, x: number, z: number): void {
    if (this.goose?.networkId === id) this.goose.snapTo(x, z);
  }

  applyKilled(killerSlot: PlayerSlot | null): void {
    if (this.goose) {
      this.scene.remove(this.goose.mesh);
      this.goose.dispose();
      this.goose = null;
    }
    this.id = null;
    this.callbacks.onKilled(killerSlot);
  }

  // ---- Shared ------------------------------------------------------------------------------------

  dispose(): void {
    if (this.goose) {
      this.scene.remove(this.goose.mesh);
      this.goose.dispose();
      this.goose = null;
    }
  }
}
