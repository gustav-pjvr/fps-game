import type { NetworkMessage, PlayerSlot } from './protocol.ts';

/**
 * Direct guest-to-guest links (docs/squad-arsenal-night.md section 1.1): the rules both ends share.
 * The links themselves are opened and kept by network/GuestMesh.ts; this module holds what the host
 * decides about relaying and what a guest does with a message that arrives twice.
 */

/** The only messages a guest sends straight to another guest: cosmetic and latency sensitive.
 * Everything else (damage, deaths, respawns, mode state, world objects) keeps the host path, so
 * authority and ordering are the same as with no direct links at all. */
export const DIRECT_MESSAGE_TYPES: ReadonlySet<NetworkMessage['type']> = new Set(['playerSnapshot', 'fireEvent', 'footstepEvent']);

/** The two discrete events of DIRECT_MESSAGE_TYPES. A snapshot needs no duplicate check: receivers
 * already drop any not newer than the last applied (stateOrder.ts). */
export const DIRECT_EVENT_TYPES: ReadonlySet<NetworkMessage['type']> = new Set(['fireEvent', 'footstepEvent']);

/** Host side: which guests report a live direct link to which, from their meshStatus messages. The
 * host stops relaying DIRECT_MESSAGE_TYPES between two guests only while BOTH list each other, so
 * either side losing the link (or leaving) puts relaying straight back. A guest that never reports
 * (an older build, or a link that never opens) is relayed to exactly as before. */
export class MeshRelayPolicy {
  private readonly reports = new Map<PlayerSlot, ReadonlySet<PlayerSlot>>();

  report(slot: PlayerSlot, linked: readonly PlayerSlot[]): void {
    this.reports.set(slot, new Set(linked));
  }

  /** The slot's connection closed or was replaced by a rejoin: its old links mean nothing now. */
  forget(slot: PlayerSlot): void {
    this.reports.delete(slot);
  }

  isLinked(a: PlayerSlot, b: PlayerSlot): boolean {
    return a !== b && (this.reports.get(a)?.has(b) ?? false) && (this.reports.get(b)?.has(a) ?? false);
  }

  /** Whether the host should pass `type`, sent by `from`, on to `to`. */
  shouldRelay(type: NetworkMessage['type'], from: PlayerSlot, to: PlayerSlot): boolean {
    return !DIRECT_MESSAGE_TYPES.has(type) || !this.isLinked(from, to);
  }

  /** How many guest pairs are linked both ways (the host's getNetworkDebug().directLinksReady). */
  linkedPairCount(): number {
    let pairs = 0;
    for (const [slot, linked] of this.reports) {
      for (const other of linked) if (other > slot && this.isLinked(slot, other)) pairs++;
    }
    return pairs;
  }
}

/** How many recent stamps to remember per sender. A copy that arrives twice does so within a round
 * trip, when a guest sends at most a few dozen events (a shotgun blast is 8 fireEvents). */
const REMEMBERED_STAMPS = 64;

/** Guest side: drops the second copy of a fireEvent or footstepEvent. While the host has not yet
 * seen both sides of a new link, a guest's event comes over the link and through the host. Each
 * copy carries the sender's never-repeating clock `t` (stateOrder.ts's createSendClock), so the
 * pair is recognised exactly; an event with no `t` (an older build) always passes. */
export class DuplicateEventFilter {
  private readonly seen = new Map<PlayerSlot, number[]>();

  accept(senderSlot: PlayerSlot, t: number | undefined): boolean {
    if (t === undefined) return true;
    let stamps = this.seen.get(senderSlot);
    if (!stamps) {
      stamps = [];
      this.seen.set(senderSlot, stamps);
    }
    if (stamps.includes(t)) return false;
    stamps.push(t);
    if (stamps.length > REMEMBERED_STAMPS) stamps.shift();
    return true;
  }

  /** The sender left; a rejoin starts a new page clock. */
  forget(senderSlot: PlayerSlot): void {
    this.seen.delete(senderSlot);
  }
}
