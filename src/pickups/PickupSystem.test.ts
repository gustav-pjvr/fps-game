import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { NetworkMessage, PlayerSlot } from '../network/protocol.ts';
import { PICKUP_CLAIM_RESEND_SECONDS, PICKUP_RESPAWN_SECONDS } from './pickupConfig.ts';
import { NO_GRENADES, type PickupRecipient } from './pickupEffects.ts';
import type { PickupSite } from './pickupPlacement.ts';
import { PickupSystem, type PickupNetwork } from './PickupSystem.ts';

// The visuals need a browser (canvas, matchMedia); the claim protocol does not.
const shown = vi.hoisted(() => new Map<unknown, Map<number, boolean>>());
vi.mock('./PickupVisuals.ts', () => ({
  PickupVisuals: class {
    readonly state = new Map<number, boolean>();
    constructor() {
      shown.set(this, this.state);
    }
    setAvailable(id: number, available: boolean): void {
      this.state.set(id, available);
    }
    update(): void {}
    dispose(): void {}
  },
}));

const SITES: PickupSite[] = [
  { id: 0, kind: 'health', x: 0, y: 0, z: 0 },
  { id: 1, kind: 'ammo', x: 20, y: 0, z: 0 },
  { id: 2, kind: 'grenade', x: 40, y: 0, z: 0 },
];
const STAND = 0.9;
const at = (x: number, y = STAND, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);

function makeRecipient(state = { current: 50, max: 100 }) {
  const log = { healed: [] as number[], ammo: 0 };
  const recipient: PickupRecipient = {
    health: () => state,
    heal: (amount) => {
      log.healed.push(amount);
      state.current = Math.min(state.max, state.current + amount);
    },
    ammoWouldGive: () => true,
    grantAmmo: () => {
      log.ammo++;
      return true;
    },
    grenades: NO_GRENADES,
  };
  return { recipient, log, state };
}

function visualsOf(_system: PickupSystem): Map<number, boolean> {
  // The mock registered itself by instance; the system's own is the one created last.
  return [...shown.values()].at(-1)!;
}

describe('PickupSystem in single-player', () => {
  it('heals on walk-over, takes the pickup away and brings it back after its time', () => {
    const { recipient, log } = makeRecipient();
    const picked: string[] = [];
    const system = new PickupSystem(new THREE.Scene(), SITES, recipient, null, { onPickedUp: (kind, line) => picked.push(`${kind}:${line}`) });
    const visuals = visualsOf(system);

    system.update(0.05, at(0.5), true);
    expect(log.healed).toEqual([40]);
    expect(picked).toEqual(['health:+40 HEALTH']);
    expect(visuals.get(0)).toBe(false);
    expect(system.views()[0]!.available).toBe(false);

    // Away: standing on the spot gives nothing more.
    system.update(0.05, at(0), true);
    expect(log.healed).toEqual([40]);

    system.update(PICKUP_RESPAWN_SECONDS.health, at(10), true);
    expect(system.views()[0]!.available).toBe(true);
    expect(visuals.get(0)).toBe(true);
  });

  it('walks past a pickup that would give nothing and leaves it on the map', () => {
    const { recipient, log } = makeRecipient({ current: 100, max: 100 });
    const system = new PickupSystem(new THREE.Scene(), SITES, recipient, null);
    system.update(0.05, at(0), true);
    expect(log.healed).toEqual([]);
    expect(system.views()[0]!.available).toBe(true);
  });

  it('needs the player within the radius, near the height, and alive', () => {
    const { recipient, log } = makeRecipient();
    const system = new PickupSystem(new THREE.Scene(), SITES, recipient, null);
    system.update(0.05, at(1.6), true);
    system.update(0.05, at(0, 5), true);
    system.update(0.05, at(0), false);
    expect(log.healed).toEqual([]);
    system.update(0.05, at(1.3), true);
    expect(log.healed).toEqual([40]);
  });

  it('stocks the guns from an ammo box', () => {
    const { recipient, log } = makeRecipient();
    const system = new PickupSystem(new THREE.Scene(), SITES, recipient, null);
    system.update(0.05, at(20), true);
    expect(log.ammo).toBe(1);
  });

  it('takes a grenade crate only when the supply says it would give something', () => {
    const { recipient } = makeRecipient();
    const granted: number[] = [];
    let wants = false;
    const withGrenades: PickupRecipient = { ...recipient, grenades: { wouldGive: () => wants, grant: (amount) => (granted.push(amount), 'frag') } };
    const system = new PickupSystem(new THREE.Scene(), SITES, withGrenades, null);
    system.update(0.05, at(40), true);
    expect(granted).toEqual([]);
    wants = true;
    system.update(0.05, at(40), true);
    expect(granted).toEqual([1]);
  });

  it('honours the respawn override hook and a practice reset', () => {
    const { recipient } = makeRecipient();
    const system = new PickupSystem(new THREE.Scene(), SITES, recipient, null);
    system.setRespawnSeconds(1);
    system.update(0.05, at(0), true);
    expect(system.views()[0]!.available).toBe(false);
    system.update(1.1, at(10), true);
    expect(system.views()[0]!.available).toBe(true);

    system.update(0.05, at(20), true);
    expect(system.views()[1]!.available).toBe(false);
    system.resetAll();
    expect(system.views()[1]!.available).toBe(true);
  });

  it('lists the pickups within the minimap range that are on the map', () => {
    const { recipient } = makeRecipient();
    const system = new PickupSystem(new THREE.Scene(), SITES, recipient, null);
    expect(system.minimapEntries(0, 0).map((p) => p.id)).toEqual([0, 1]);
    expect(system.minimapEntries(35, 0).map((p) => p.id)).toEqual([1, 2]);
    expect(system.minimapEntries(200, 0)).toEqual([]);
    system.update(0.05, at(0), true);
    expect(system.minimapEntries(0, 0).map((p) => p.id)).toEqual([1]);
  });
});

/** A host and guests joined by in-memory queues, delivered by hand so a test controls the order. */
function makeMatch(guestSlots: PlayerSlot[] = [1]) {
  type Peer = { system: PickupSystem; log: ReturnType<typeof makeRecipient>['log']; visuals: Map<number, boolean>; position: THREE.Vector3; picked: string[] };
  const peers = new Map<PlayerSlot, Peer>();
  const queue: { to: PlayerSlot; from: PlayerSlot; message: NetworkMessage }[] = [];
  const sent: { from: PlayerSlot; message: NetworkMessage }[] = [];
  const build = (slot: PlayerSlot, role: 'host' | 'guest'): void => {
    const { recipient, log } = makeRecipient();
    const picked: string[] = [];
    const network: PickupNetwork = {
      role,
      ownSlot: slot,
      send: (message) => {
        sent.push({ from: slot, message });
        if (role === 'host') for (const to of guestSlots) queue.push({ to, from: slot, message });
        else queue.push({ to: 0, from: slot, message });
      },
      sendTo: (to, message) => {
        sent.push({ from: slot, message });
        queue.push({ to, from: slot, message });
      },
      // The host sees every guest where that guest stands.
      opponentPosition: (other) => {
        const peer = peers.get(other);
        return peer ? { x: peer.position.x, z: peer.position.z } : null;
      },
    };
    const system = new PickupSystem(new THREE.Scene(), SITES, recipient, network, { onPickedUp: (kind, line) => picked.push(`${kind}:${line}`) });
    peers.set(slot, { system, log, visuals: visualsOf(system), position: at(500), picked });
  };
  build(0, 'host');
  for (const slot of guestSlots) build(slot, 'guest');
  const deliver = (): void => {
    while (queue.length > 0) {
      const { to, from, message } = queue.shift()!;
      peers.get(to)?.system.handleMessage(message, from);
    }
  };
  const tick = (dt = 0.05): void => {
    for (const peer of peers.values()) peer.system.update(dt, peer.position, true);
    deliver();
  };
  return { peers, sent, deliver, tick };
}

describe('PickupSystem in multiplayer', () => {
  it('applies a host claim at once and tells the guests, who hide the pickup without gaining', () => {
    const { peers, sent, tick } = makeMatch();
    peers.get(0)!.position = at(0);
    tick();
    expect(peers.get(0)!.log.healed).toEqual([40]);
    expect(sent.some((s) => s.message.type === 'pickupTaken' && s.message.id === 0 && s.message.slot === 0)).toBe(true);
    expect(peers.get(1)!.visuals.get(0)).toBe(false);
    expect(peers.get(1)!.log.healed).toEqual([]);
  });

  it('grants a guest claim through the host and applies the effect when the guest hears its own grant', () => {
    const { peers, tick } = makeMatch();
    peers.get(1)!.position = at(0.3);
    tick();
    expect(peers.get(1)!.log.healed).toEqual([40]);
    expect(peers.get(1)!.picked).toEqual(['health:+40 HEALTH']);
    expect(peers.get(0)!.visuals.get(0)).toBe(false);
    expect(peers.get(0)!.system.views()[0]!.available).toBe(false);
  });

  it('gives a pickup to the first of two claimants only', () => {
    const { peers, tick } = makeMatch([1, 2]);
    peers.get(1)!.position = at(0.3);
    peers.get(2)!.position = at(-0.3);
    tick();
    expect(peers.get(1)!.log.healed).toEqual([40]);
    expect(peers.get(2)!.log.healed).toEqual([]);
    expect(peers.get(2)!.visuals.get(0)).toBe(false);
    // Both ended up with the same view: it is away.
    expect(peers.get(2)!.system.views()[0]!.available).toBe(false);
  });

  it('does not grant a claim from a guest the host sees far away, or for an unknown id', () => {
    const { peers, deliver, tick } = makeMatch();
    const host = peers.get(0)!;
    host.system.handleMessage({ type: 'pickupClaim', id: 0 }, 1);
    host.system.handleMessage({ type: 'pickupClaim', id: 99 }, 1);
    deliver();
    expect(host.system.views()[0]!.available).toBe(true);
    // And one from a slot the host does not know at all.
    host.system.handleMessage({ type: 'pickupClaim', id: 0 }, 3);
    tick();
    expect(host.system.views()[0]!.available).toBe(true);
  });

  it('does not let a guest take what is away, and does not re-send a claim at once', () => {
    const { peers, sent, tick } = makeMatch();
    peers.get(1)!.position = at(0.3);
    peers.get(1)!.system.handleMessage({ type: 'pickupState', available: '011' }, 0);
    tick();
    expect(sent.filter((s) => s.message.type === 'pickupClaim')).toHaveLength(0);
  });

  it('claims once per resend window while waiting for the answer', () => {
    const { peers, sent } = makeMatch();
    const guest = peers.get(1)!;
    guest.system.handleMessage({ type: 'pickupState', available: '111' }, 0);
    // Nothing is delivered, so the guest never hears back.
    for (let i = 0; i < 4; i++) guest.system.update(PICKUP_CLAIM_RESEND_SECONDS / 4, at(0.3), true);
    expect(sent.filter((s) => s.message.type === 'pickupClaim')).toHaveLength(1);
    guest.system.update(PICKUP_CLAIM_RESEND_SECONDS, at(0.3), true);
    expect(sent.filter((s) => s.message.type === 'pickupClaim')).toHaveLength(2);
  });

  it('returns a pickup on the host timer and tells the guests', () => {
    const { peers, tick } = makeMatch();
    peers.get(0)!.system.setRespawnSeconds(1);
    peers.get(0)!.position = at(0);
    tick();
    peers.get(0)!.position = at(500);
    expect(peers.get(1)!.system.views()[0]!.available).toBe(false);
    for (let i = 0; i < 25; i++) tick();
    expect(peers.get(0)!.system.views()[0]!.available).toBe(true);
    expect(peers.get(1)!.system.views()[0]!.available).toBe(true);
    expect(peers.get(1)!.visuals.get(0)).toBe(true);
  });

  it('lets a late joiner ask for the state and adopt it, asking again until it arrives', () => {
    const { peers, sent, tick } = makeMatch();
    const host = peers.get(0)!;
    host.system.handleMessage({ type: 'pickupClaim', id: 1 }, 1);
    peers.get(1)!.position = at(20);
    // The guest's first request goes out on its first tick; take it off the queue to lose it.
    peers.get(1)!.system.update(0.05, at(500), true);
    expect(sent.filter((s) => s.message.type === 'pickupSyncRequest')).toHaveLength(1);
    sent.length = 0;
    // 1.9 s later no second request yet; past 2 s there is one.
    peers.get(1)!.system.update(1.9, at(500), true);
    expect(sent.filter((s) => s.message.type === 'pickupSyncRequest')).toHaveLength(0);
    peers.get(1)!.system.update(0.2, at(500), true);
    expect(sent.filter((s) => s.message.type === 'pickupSyncRequest')).toHaveLength(1);

    // The host answers this one; the guest adopts the state and stops asking.
    host.system.handleMessage({ type: 'pickupSyncRequest', senderSlot: 1 }, 1);
    tick();
    expect(peers.get(1)!.system.views().map((p) => p.available)).toEqual([true, false, true]);
    expect(peers.get(1)!.visuals.get(1)).toBe(false);
    sent.length = 0;
    peers.get(1)!.system.update(5, at(500), true);
    expect(sent.filter((s) => s.message.type === 'pickupSyncRequest')).toHaveLength(0);
  });

  it('ignores a state of the wrong length and any pickup message from the wrong side', () => {
    const { peers } = makeMatch();
    const guest = peers.get(1)!;
    const host = peers.get(0)!;
    guest.system.handleMessage({ type: 'pickupState', available: '1' }, 0);
    guest.system.handleMessage({ type: 'pickupTaken', id: 99, slot: 0, respawnIn: 5 }, 0);
    expect(guest.system.views().every((p) => p.available)).toBe(true);
    host.system.handleMessage({ type: 'pickupTaken', id: 0, slot: 1, respawnIn: 5 }, 1);
    host.system.handleMessage({ type: 'pickupState', available: '000' }, 1);
    expect(host.system.views().every((p) => p.available)).toBe(true);
  });

  it('applies a taken message to the claimant only', () => {
    const { peers } = makeMatch();
    const guest = peers.get(1)!;
    guest.system.handleMessage({ type: 'pickupTaken', id: 0, slot: 2, respawnIn: 30 }, 0);
    expect(guest.log.healed).toEqual([]);
    expect(guest.system.views()[0]!.available).toBe(false);
    guest.system.handleMessage({ type: 'pickupTaken', id: 1, slot: 1, respawnIn: 25 }, 0);
    expect(guest.log.ammo).toBe(1);
  });
});
