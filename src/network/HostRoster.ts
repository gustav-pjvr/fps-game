import { MULTIPLAYER_MAX_PLAYERS, MULTIPLAYER_REJOIN_GRACE_PERIOD_MS } from '../core/config.ts';
import { HOST_SLOT, type PlayerSlot, type RosterEntry } from './protocol.ts';

interface RosterSlotState {
  slot: PlayerSlot;
  username: string;
  /** null for the host's own slot - the host never "rejoins" itself. */
  rejoinToken: string | null;
  connected: boolean;
  /** Timestamp (ms) the slot went disconnected, only while connected===false and still within its
   * grace period - null once connected, or once the grace period has been swept away. */
  disconnectedAt: number | null;
  /** The guest's PeerJS id on its current connection (a rejoin brings a new one), handed to the
   * other guests in every roster so they can open direct links (network/GuestMesh.ts). */
  peerId?: string;
}

export type HelloOutcome = { outcome: 'rejoined'; slot: PlayerSlot } | { outcome: 'joined'; slot: PlayerSlot } | { outcome: 'full' };

/** Host-only policy for "who gets which slot, is this a rejoin, is the room full" - pulled out of
 * PeerConnection's raw connection plumbing so it's a small, pure-ish, mockable-`now()` state
 * machine, independently unit-testable (see HostRoster.test.ts). Mirrors why
 * computeWatchTowerPositions/computeGuaranteedSites were kept pure and separate from actual
 * THREE/RAPIER construction elsewhere in this codebase - here the "actual construction" being
 * separated out is real PeerJS connection objects. */
/** Every guest slot in ascending allocation order - the lowest one not currently present in
 * `slots` is handed to the next joiner (see handleHello). */
const GUEST_SLOTS: readonly PlayerSlot[] = [1, 2, 3];

function rosterEntryOf(state: RosterSlotState): RosterEntry {
  return state.peerId === undefined ? { slot: state.slot, username: state.username } : { slot: state.slot, username: state.username, peerId: state.peerId };
}

export class HostRoster {
  private readonly slots = new Map<PlayerSlot, RosterSlotState>();
  private matchInProgress = false;

  constructor(hostUsername: string) {
    this.slots.set(HOST_SLOT, { slot: HOST_SLOT, username: hostUsername, rejoinToken: null, connected: true, disconnectedAt: null });
  }

  /** Called when a new connection's `hello` arrives. A reserved-but-disconnected slot still counts
   * against capacity (favors letting the original player back in over instantly admitting a
   * stranger) - a genuinely new distinct player can see 'full' even though one slot is only
   * reserved, not actively connected. */
  handleHello(username: string, rejoinToken: string | null, _now: number, peerId?: string): HelloOutcome {
    if (rejoinToken !== null) {
      for (const slot of this.slots.values()) {
        // A token match counts even while the slot still reads as connected: a player who reloads
        // or reconnects before the host has noticed the old connection dying (WebRTC close can take
        // seconds, the staleness sweep 8s) used to be treated as a stranger, handed a fresh slot
        // with a zero score, or refused as 'full' in a 4-player room. The old connection is stale
        // by definition, and PeerConnection closes it when the slot is handed to the new one.
        if (slot.rejoinToken === rejoinToken) {
          slot.connected = true;
          slot.disconnectedAt = null;
          slot.username = username;
          slot.peerId = peerId;
          return { outcome: 'rejoined', slot: slot.slot };
        }
      }
    }

    if (this.slots.size >= MULTIPLAYER_MAX_PLAYERS) return { outcome: 'full' };

    // Lowest free slot in 1..3, not an ever-incrementing counter - a counter would eventually
    // allocate slot 4/5/... once an earlier reservation was swept away (slots.size drops below 4
    // while the counter keeps climbing), silently breaking the protocol's 0-3 PlayerSlot domain.
    // Confirmed bug, fixed in the 2026-07-10 review. `slots.size < MULTIPLAYER_MAX_PLAYERS` above
    // already guarantees one of these is free.
    const slot = GUEST_SLOTS.find((candidate) => !this.slots.has(candidate));
    if (slot === undefined) return { outcome: 'full' }; // defensive - unreachable given the size check above
    this.slots.set(slot, { slot, username, rejoinToken, connected: true, disconnectedAt: null, peerId });
    return { outcome: 'joined', slot };
  }

  /** Marks a slot disconnected and starts its grace-period timer. Does NOT remove the slot's
   * roster/score entry - that only happens via sweepExpiredReservations. No-op for a slot that
   * isn't currently tracked (defensive - shouldn't happen). */
  handleDisconnect(slot: PlayerSlot, now: number): void {
    const state = this.slots.get(slot);
    if (!state || !state.connected) return;
    state.connected = false;
    state.disconnectedAt = now;
  }

  /** Polled periodically (not on a dedicated timer - there's no separate server tick, the host IS
   * just another player's tab) from Game.ts's own update loop while hosting. Returns slots whose
   * grace period just expired in this call, so the caller can broadcast final cleanup for them. */
  sweepExpiredReservations(now: number): PlayerSlot[] {
    const expired: PlayerSlot[] = [];
    for (const state of this.slots.values()) {
      if (state.connected || state.disconnectedAt === null) continue;
      if (now - state.disconnectedAt >= MULTIPLAYER_REJOIN_GRACE_PERIOD_MS) {
        this.slots.delete(state.slot);
        expired.push(state.slot);
      }
    }
    return expired;
  }

  /** Lets the host correct their own displayed name after the room already exists (e.g. they
   * edited the "Your name" field after clicking Create Room, which is the only time that field is
   * ever visible to type into - the room's own creation can't wait for that, so this exists to fix
   * up the name afterward instead of silently ignoring the edit). No-op if the host's own slot
   * somehow isn't tracked (shouldn't happen - constructor always seeds it). */
  updateHostUsername(username: string): void {
    const hostSlot = this.slots.get(HOST_SLOT);
    if (hostSlot) hostSlot.username = username;
  }

  currentRoster(): RosterEntry[] {
    return Array.from(this.slots.values(), rosterEntryOf);
  }

  /** Only slots with a live connection, excluding grace-period reservations. What a match actually
   * starts with (lobby Start Match readiness, matchStart/rematch spawns, a late joiner's roster):
   * including a reserved slot gave everyone a frozen ghost RemotePlayer for it, and kept Start Match
   * disabled for the whole 90s grace period after a guest left the lobby, since a disconnected slot
   * can never click Ready. A reserved player who comes back mid-match rejoins through the normal
   * onHostHello path. */
  connectedRoster(): RosterEntry[] {
    return Array.from(this.slots.values())
      .filter((s) => s.connected)
      .map(rosterEntryOf);
  }

  /** The PeerJS id a slot's player is on now, if known (playerJoinedMatch carries it). */
  peerIdOf(slot: PlayerSlot): string | undefined {
    return this.slots.get(slot)?.peerId;
  }

  startMatch(): void {
    this.matchInProgress = true;
  }

  isMatchInProgress(): boolean {
    return this.matchInProgress;
  }
}
