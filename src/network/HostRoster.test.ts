import { describe, expect, it } from 'vitest';
import { HostRoster } from './HostRoster.ts';
import { MULTIPLAYER_MAX_PLAYERS, MULTIPLAYER_REJOIN_GRACE_PERIOD_MS } from '../core/config.ts';
import { HOST_SLOT } from './protocol.ts';

describe('HostRoster', () => {
  it('seeds slot 0 as the host on construction', () => {
    const roster = new HostRoster('Alice');
    expect(roster.currentRoster()).toEqual([{ slot: HOST_SLOT, username: 'Alice' }]);
  });

  it('assigns guests slots 1, 2, 3 in join order', () => {
    const roster = new HostRoster('Alice');
    const first = roster.handleHello('Bob', null, 0);
    const second = roster.handleHello('Cara', null, 0);
    const third = roster.handleHello('Dan', null, 0);
    expect(first).toEqual({ outcome: 'joined', slot: 1 });
    expect(second).toEqual({ outcome: 'joined', slot: 2 });
    expect(third).toEqual({ outcome: 'joined', slot: 3 });
  });

  it('rejects a hello once MULTIPLAYER_MAX_PLAYERS is reached', () => {
    const roster = new HostRoster('Alice');
    for (let i = 1; i < MULTIPLAYER_MAX_PLAYERS; i++) roster.handleHello(`Guest${i}`, null, 0);
    expect(roster.handleHello('OneTooMany', null, 0)).toEqual({ outcome: 'full' });
  });

  it('rejoins a disconnected slot when the token matches, restoring the slot number', () => {
    const roster = new HostRoster('Alice');
    const joined = roster.handleHello('Bob', 'token-bob', 0);
    if (joined.outcome !== 'joined') throw new Error('expected joined');
    roster.handleDisconnect(joined.slot, 1000);

    const rejoined = roster.handleHello('Bob', 'token-bob', 2000);
    expect(rejoined).toEqual({ outcome: 'rejoined', slot: joined.slot });
  });

  it('a matching token takes over a slot the host still believes is connected', () => {
    const roster = new HostRoster('Alice');
    const first = roster.handleHello('Bob', 'token-bob', 0);
    // Bob reloaded before the host noticed his old connection die. Treating this as a fresh join
    // used to put Bob in two slots at once (his ghost plus a new zero-score slot), or refuse him as
    // 'full' in a 4-player room. The same token means the same player: hand the slot back.
    const result = roster.handleHello('Bob', 'token-bob', 1000);
    expect(result).toEqual({ outcome: 'rejoined', slot: first.outcome === 'joined' ? first.slot : -1 });
    expect(roster.currentRoster()).toHaveLength(2);
  });

  it('a token takeover still works when the room is otherwise full', () => {
    const roster = new HostRoster('Alice');
    for (let i = 1; i < MULTIPLAYER_MAX_PLAYERS; i++) roster.handleHello(`Guest${i}`, `token-${i}`, 0);
    expect(roster.handleHello('Guest1', 'token-1', 500).outcome).toBe('rejoined');
    expect(roster.handleHello('Stranger', 'token-x', 500).outcome).toBe('full');
  });

  it('connectedRoster leaves out grace-period reservations', () => {
    const roster = new HostRoster('Alice');
    const bob = roster.handleHello('Bob', 'token-bob', 0);
    roster.handleHello('Cara', 'token-cara', 0);
    if (bob.outcome !== 'joined') throw new Error('expected Bob to join');
    roster.handleDisconnect(bob.slot, 100);
    expect(roster.currentRoster().map((e) => e.username)).toEqual(['Alice', 'Bob', 'Cara']);
    expect(roster.connectedRoster().map((e) => e.username)).toEqual(['Alice', 'Cara']);
  });

  it('a reserved (disconnected, within grace period) slot still counts against capacity', () => {
    const roster = new HostRoster('Alice');
    for (let i = 1; i < MULTIPLAYER_MAX_PLAYERS; i++) roster.handleHello(`Guest${i}`, `token-${i}`, 0);
    roster.handleDisconnect(1, 1000); // one guest drops but is still within its grace period

    // A genuinely new player (no matching token) should see 'full', even though slot 1 is only
    // reserved, not actively connected - favors letting the original player back in.
    expect(roster.handleHello('Newcomer', null, 2000)).toEqual({ outcome: 'full' });
  });

  it('frees a reserved slot once its grace period expires, and the roster drops it', () => {
    const roster = new HostRoster('Alice');
    const joined = roster.handleHello('Bob', 'token-bob', 0);
    if (joined.outcome !== 'joined') throw new Error('expected joined');
    roster.handleDisconnect(joined.slot, 1000);

    const stillReserved = roster.sweepExpiredReservations(1000 + MULTIPLAYER_REJOIN_GRACE_PERIOD_MS - 1);
    expect(stillReserved).toEqual([]);
    expect(roster.currentRoster().some((entry) => entry.slot === joined.slot)).toBe(true);

    const expired = roster.sweepExpiredReservations(1000 + MULTIPLAYER_REJOIN_GRACE_PERIOD_MS);
    expect(expired).toEqual([joined.slot]);
    expect(roster.currentRoster().some((entry) => entry.slot === joined.slot)).toBe(false);
  });

  it('a rejoin attempt after the grace period has expired is treated as a fresh join, not a rejoin', () => {
    const roster = new HostRoster('Alice');
    const joined = roster.handleHello('Bob', 'token-bob', 0);
    if (joined.outcome !== 'joined') throw new Error('expected joined');
    roster.handleDisconnect(joined.slot, 1000);
    roster.sweepExpiredReservations(1000 + MULTIPLAYER_REJOIN_GRACE_PERIOD_MS);

    const result = roster.handleHello('Bob', 'token-bob', 1000 + MULTIPLAYER_REJOIN_GRACE_PERIOD_MS + 1);
    expect(result.outcome).toBe('joined');
  });

  it('reuses the lowest freed slot instead of allocating past 3', () => {
    const roster = new HostRoster('Alice');
    const first = roster.handleHello('Bob', 'token-bob', 0);
    roster.handleHello('Cara', null, 0);
    roster.handleHello('Dan', null, 0);
    if (first.outcome !== 'joined') throw new Error('expected joined');
    roster.handleDisconnect(first.slot, 1000);
    roster.sweepExpiredReservations(1000 + MULTIPLAYER_REJOIN_GRACE_PERIOD_MS); // frees slot 1

    // Before the fix, an ever-incrementing counter would hand out slot 4 here - outside
    // PlayerSlot's 0-3 domain - instead of reclaiming the just-freed slot 1.
    const rejoiner = roster.handleHello('Newcomer', null, 2000);
    expect(rejoiner).toEqual({ outcome: 'joined', slot: 1 });
  });

  it('isMatchInProgress reflects startMatch()', () => {
    const roster = new HostRoster('Alice');
    expect(roster.isMatchInProgress()).toBe(false);
    roster.startMatch();
    expect(roster.isMatchInProgress()).toBe(true);
  });
});
