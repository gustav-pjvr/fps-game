import type * as THREE from 'three';
import type { NetworkMessage, PlayerSlot } from '../network/protocol.ts';
import {
  PICKUP_CLAIM_RESEND_SECONDS,
  PICKUP_CLAIM_TOLERANCE,
  PICKUP_HOVER_HEIGHT,
  PICKUP_MINIMAP_RANGE,
  PICKUP_RADIUS,
  PICKUP_VERTICAL_REACH,
  type PickupKind,
} from './pickupConfig.ts';
import { applyPickup, pickupWouldGive, type PickupRecipient } from './pickupEffects.ts';
import type { PickupSite } from './pickupPlacement.ts';
import { PickupBoard } from './pickupState.ts';
import { PickupVisuals } from './PickupVisuals.ts';

/** How a multiplayer match talks to the other players. Absent in single-player, where this client
 * is its own authority. */
export interface PickupNetwork {
  readonly role: 'host' | 'guest';
  readonly ownSlot: PlayerSlot;
  /** Host: to every guest. Guest: to the host. */
  send(message: NetworkMessage): void;
  /** Host only: to one guest. */
  sendTo(slot: PlayerSlot, message: NetworkMessage): void;
  /** Where the host sees another player's avatar, or null if that slot is not in the match. */
  opponentPosition(slot: PlayerSlot): { x: number; z: number } | null;
}

export interface PickupSystemOptions {
  /** A pickup was taken by this client's player: the line to show and the kind (sound, toast). */
  onPickedUp?: (kind: PickupKind, line: string) => void;
}

/** One pickup as the minimap and the tests see it. */
export interface PickupView {
  readonly id: number;
  readonly kind: PickupKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly available: boolean;
}

/** Seconds between a guest's repeated pickupSyncRequest until the host's state arrives. */
const SYNC_RETRY_SECONDS = 2;

/** Health, ammo and grenade pickups for one match (docs/pickups.md): the walk-over check, the
 * host-authoritative claim protocol, the respawn timers and the visuals. Game.ts only constructs
 * it, calls `update` once a tick, hands it network messages and disposes it. */
export class PickupSystem {
  private readonly board: PickupBoard;
  private readonly visuals: PickupVisuals;
  private readonly isAuthority: boolean;
  /** Guest: pickups it has claimed and not yet heard back about, with seconds until it may re-claim. */
  private readonly pendingClaims = new Map<number, number>();
  private syncReceived: boolean;
  private syncTimer = 0;

  constructor(
    scene: THREE.Scene,
    private readonly sites: readonly PickupSite[],
    private readonly recipient: PickupRecipient,
    private readonly network: PickupNetwork | null,
    private readonly options: PickupSystemOptions = {},
  ) {
    this.board = new PickupBoard(sites.map((site) => site.kind));
    this.visuals = new PickupVisuals(scene, sites);
    this.isAuthority = !network || network.role === 'host';
    this.syncReceived = this.isAuthority;
  }

  get count(): number {
    return this.sites.length;
  }

  /** One fixed tick. `position` is the player's centre; `alive` false (dead, or frozen behind an end
   * screen) skips the walk-over check but the timers and visuals carry on. */
  update(dt: number, position: THREE.Vector3, alive: boolean): void {
    for (const id of this.board.tick(dt)) {
      this.visuals.setAvailable(id, true);
      this.network?.send({ type: 'pickupRespawned', id });
    }
    this.visuals.update(dt, position.x, position.z);

    for (const [id, wait] of this.pendingClaims) {
      if (wait - dt <= 0) this.pendingClaims.delete(id);
      else this.pendingClaims.set(id, wait - dt);
    }
    if (!this.syncReceived && this.network) {
      this.syncTimer -= dt;
      if (this.syncTimer <= 0) {
        this.syncTimer = SYNC_RETRY_SECONDS;
        this.network.send({ type: 'pickupSyncRequest', senderSlot: this.network.ownSlot });
      }
    }
    if (alive) this.checkWalkOver(position);
  }

  private checkWalkOver(position: THREE.Vector3): void {
    let nearest: PickupSite | null = null;
    let nearestSq = PICKUP_RADIUS * PICKUP_RADIUS;
    for (const site of this.sites) {
      if (!this.board.isAvailable(site.id) || this.pendingClaims.has(site.id)) continue;
      const dx = site.x - position.x;
      const dz = site.z - position.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq >= nearestSq || Math.abs(position.y - (site.y + PICKUP_HOVER_HEIGHT)) > PICKUP_VERTICAL_REACH) continue;
      // A pickup that would give nothing is walked past, and stays for someone who needs it.
      if (!pickupWouldGive(site.kind, this.recipient)) continue;
      nearest = site;
      nearestSq = distanceSq;
    }
    if (!nearest) return;
    if (this.isAuthority) {
      this.grant(nearest.id, this.network?.ownSlot ?? null);
    } else {
      this.pendingClaims.set(nearest.id, PICKUP_CLAIM_RESEND_SECONDS);
      this.network!.send({ type: 'pickupClaim', id: nearest.id });
    }
  }

  /** Authority: takes pickup `id` for `slot` (null in single-player), tells everyone, and applies
   * the effect at once when the claimant is this client. False when it was not on the map. */
  private grant(id: number, slot: PlayerSlot | null): boolean {
    const grant = this.board.claim(id);
    if (!grant) return false;
    this.visuals.setAvailable(id, false);
    if (this.network && slot !== null) this.network.send({ type: 'pickupTaken', id, slot, respawnIn: grant.respawnIn });
    if (slot === (this.network?.ownSlot ?? null)) this.applyToSelf(id);
    return true;
  }

  private applyToSelf(id: number): void {
    const site = this.sites[id];
    if (!site) return;
    const line = applyPickup(site.kind, this.recipient);
    if (line !== null) this.options.onPickedUp?.(site.kind, line);
  }

  /** A pickup message from the network. `transportSlot` is the connection it came in on: the real
   * claimant of a pickupClaim, since a payload could name anyone. */
  handleMessage(message: NetworkMessage, transportSlot: PlayerSlot): void {
    const network = this.network;
    if (!network) return;
    switch (message.type) {
      case 'pickupClaim': {
        if (network.role !== 'host' || !this.board.isValidId(message.id)) return;
        // The host only grants a claim it can believe: the claimant's avatar is near the pickup.
        const site = this.sites[message.id]!;
        const where = network.opponentPosition(transportSlot);
        if (!where || Math.hypot(where.x - site.x, where.z - site.z) > PICKUP_CLAIM_TOLERANCE) return;
        this.grant(message.id, transportSlot);
        return;
      }
      case 'pickupTaken': {
        if (network.role === 'host' || !this.board.applyTaken(message.id)) return;
        this.visuals.setAvailable(message.id, false);
        this.pendingClaims.delete(message.id);
        if (message.slot === network.ownSlot) this.applyToSelf(message.id);
        return;
      }
      case 'pickupRespawned': {
        if (network.role === 'host') return;
        if (this.board.applyRespawned(message.id)) this.visuals.setAvailable(message.id, true);
        return;
      }
      case 'pickupSyncRequest': {
        if (network.role !== 'host') return;
        network.sendTo(transportSlot, { type: 'pickupState', available: this.board.encodeAvailability() });
        return;
      }
      case 'pickupState': {
        if (network.role === 'host') return;
        const changed = this.board.applyAvailability(message.available);
        if (changed === null) return;
        this.syncReceived = true;
        for (const id of changed) this.visuals.setAvailable(id, this.board.isAvailable(id));
        return;
      }
    }
  }

  /** Pickups on the map within PICKUP_MINIMAP_RANGE of (x, z), for the minimap's icons. */
  minimapEntries(x: number, z: number): PickupView[] {
    return this.views().filter((view) => view.available && Math.hypot(view.x - x, view.z - z) <= PICKUP_MINIMAP_RANGE);
  }

  views(): PickupView[] {
    return this.sites.map((site) => ({ ...site, available: this.board.isAvailable(site.id) }));
  }

  /** Everything back on the map (a single-player practice reset). */
  resetAll(): void {
    for (const id of this.board.resetAll()) this.visuals.setAvailable(id, true);
    this.pendingClaims.clear();
  }

  /** Test hook: pickups taken from now on return after `seconds` (null restores the real times). */
  setRespawnSeconds(seconds: number | null): void {
    this.board.setRespawnOverride(seconds);
  }

  dispose(): void {
    this.visuals.dispose();
  }
}
