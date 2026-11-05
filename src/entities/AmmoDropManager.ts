import * as THREE from 'three';
import { buildAmmoDropMesh } from './AmmoDrop.ts';
import { disposeProceduralMesh } from './Goose.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { isBelowGround, pointInUndergroundVolume } from '../world/underground.ts';
import {
  HORDE_AMMO_DROP_MAX_CONCURRENT,
  HORDE_AMMO_DROP_MAX_SPAWN_DELAY_SECONDS,
  HORDE_AMMO_DROP_MIN_SPAWN_DELAY_SECONDS,
  HORDE_AMMO_DROP_SPAWN_RADIUS,
} from '../core/config.ts';

interface LiveDrop {
  readonly id: string;
  readonly mesh: THREE.Group;
  readonly position: THREE.Vector3;
}

export interface AmmoDropManagerCallbacks {
  /** Host-only: a new crate was placed - Game.ts broadcasts it as a hordeAmmoDropSpawned message. */
  onNetworkSpawn?: (id: string, x: number, y: number, z: number) => void;
}

/** Goose Horde multiplayer's ammo crates (per explicit user request) - up to
 * HORDE_AMMO_DROP_MAX_CONCURRENT at once, spawned by the host near a randomly chosen
 * currently-connected player, no visual/physics collider needed since pickup is resolved by a
 * plain distance check (same pattern as GoldenGooseManager) rather than Rapier. Static once placed
 * (crates don't move), so unlike GooseManager there's no periodic snapshot broadcast to worry
 * about - a spawn message is the entire lifecycle until a pickup message removes it. */
export class AmmoDropManager {
  private readonly drops = new Map<string, LiveDrop>();
  private spawnTimer = randomSpawnDelay();
  private idCounter = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly callbacks: AmmoDropManagerCallbacks,
    private readonly floor?: (x: number, y: number, z: number) => number,
  ) {}

  get count(): number {
    return this.drops.size;
  }

  /** Every live drop's id/position, for the minimap's green-dot indicators (see Minimap.update's
   * `items` param) - a fresh Map each call rather than exposing the internal one directly. */
  positions(): Map<string, THREE.Vector3> {
    return new Map(Array.from(this.drops.values(), (drop) => [drop.id, drop.position] as const));
  }

  // ---- Authoritative side (host only) ---------------------------------------------------------

  /** No-op for a non-host client - see the class comment. Callers don't need to check role
   * themselves first. */
  update(dt: number, playerPositions: readonly THREE.Vector3[], isHost: boolean): void {
    if (!isHost || playerPositions.length === 0) return;
    if (this.drops.size >= HORDE_AMMO_DROP_MAX_CONCURRENT) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = randomSpawnDelay();

    const anchor = playerPositions[Math.floor(Math.random() * playerPositions.length)]!;
    // A player underground gets a crate in the same underground volume (1 m from its walls): a random
    // point in the 18 m disc would mostly fall outside it, on the surface or inside a wall.
    const belowGround = isBelowGround(anchor.x, anchor.y, anchor.z);
    const inside = this.floor && belowGround ? pointInUndergroundVolume(anchor.x, anchor.y, anchor.z, Math.random(), Math.random()) : null;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * HORDE_AMMO_DROP_SPAWN_RADIUS;
    const x = inside ? inside.x : anchor.x + Math.cos(angle) * radius;
    const z = inside ? inside.z : anchor.z + Math.sin(angle) * radius;
    const y = this.floor && belowGround ? this.floor(x, anchor.y, z) : sampleHeight(x, z);
    const id = `ammo-${this.idCounter++}`;

    const mesh = buildAmmoDropMesh();
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.drops.set(id, { id, mesh, position: mesh.position });
    this.callbacks.onNetworkSpawn?.(id, x, y, z);
  }

  // ---- Shared (every client, host and guest alike) --------------------------------------------

  /** Applies the host's spawn broadcast - also how the host's own local spawn eventually reaches
   * other clients, but the host's own copy is already added directly in update() above, not via
   * this method (same split GooseManager uses for its own authoritative spawns). */
  applyRemoteSpawn(id: string, x: number, y: number, z: number): void {
    if (this.drops.has(id)) return;
    const mesh = buildAmmoDropMesh();
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.drops.set(id, { id, mesh, position: mesh.position });
  }

  /** Every live drop, for a late joiner's sync (network/matchSync.ts): each is sent as an ordinary
   * hordeAmmoDropSpawned, same shape as GooseManager.listForSync. */
  listForSync(): { id: string; x: number; y: number; z: number }[] {
    return Array.from(this.drops.values(), (drop) => ({ id: drop.id, x: drop.position.x, y: drop.position.y, z: drop.position.z }));
  }

  /** The nearest live drop within `radius` of `position`, or null - used to resolve a walk-over
   * pickup, same shape as GooseManager.findNearestWithinRadius. */
  findNearestWithinRadius(position: THREE.Vector3, radius: number): string | null {
    let nearestId: string | null = null;
    let nearestDistSq = radius * radius;
    for (const drop of this.drops.values()) {
      const distSq = drop.position.distanceToSquared(position);
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestId = drop.id;
      }
    }
    return nearestId;
  }

  /** Removes a drop regardless of who picked it up or which side (authoritative/follower) is
   * calling - self-reported/relayed, no host arbitration (see protocol.ts's
   * HordeAmmoDropPickedUpMessage comment). Returns whether it was actually present, tolerating the
   * same rare double-pickup race this project's other self-reported pickups already tolerate. */
  removeById(id: string): boolean {
    const drop = this.drops.get(id);
    if (!drop) return false;
    this.scene.remove(drop.mesh);
    // buildAmmoDropMesh allocates fresh geometries/materials per crate, so each removal frees its
    // own - a long Goose Horde run otherwise leaks one crate's GPU buffers per pickup. Nothing
    // reuses the mesh afterwards (positions() only ever hands out live drops).
    disposeProceduralMesh(drop.mesh);
    this.drops.delete(id);
    return true;
  }

  dispose(): void {
    for (const drop of this.drops.values()) {
      this.scene.remove(drop.mesh);
      disposeProceduralMesh(drop.mesh);
    }
    this.drops.clear();
  }
}

function randomSpawnDelay(): number {
  return HORDE_AMMO_DROP_MIN_SPAWN_DELAY_SECONDS + Math.random() * (HORDE_AMMO_DROP_MAX_SPAWN_DELAY_SECONDS - HORDE_AMMO_DROP_MIN_SPAWN_DELAY_SECONDS);
}
