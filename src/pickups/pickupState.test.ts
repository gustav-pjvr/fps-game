import { describe, expect, it } from 'vitest';
import { PICKUP_RESPAWN_SECONDS, type PickupKind } from './pickupConfig.ts';
import { PickupBoard } from './pickupState.ts';

const KINDS: PickupKind[] = ['health', 'ammo', 'grenade'];

describe('PickupBoard claims and respawn (the authority)', () => {
  it('starts with every pickup on the map', () => {
    const board = new PickupBoard(KINDS);
    expect(board.count).toBe(3);
    expect([0, 1, 2].every((id) => board.isAvailable(id))).toBe(true);
    expect(board.encodeAvailability()).toBe('111');
  });

  it('grants the first claim only, with the time of its kind', () => {
    const board = new PickupBoard(KINDS);
    expect(board.claim(0)).toEqual({ id: 0, respawnIn: PICKUP_RESPAWN_SECONDS.health });
    expect(board.claim(0)).toBeNull();
    expect(board.claim(1)?.respawnIn).toBe(PICKUP_RESPAWN_SECONDS.ammo);
    expect(board.claim(2)?.respawnIn).toBe(PICKUP_RESPAWN_SECONDS.grenade);
    expect(board.isAvailable(0)).toBe(false);
    expect(board.encodeAvailability()).toBe('000');
  });

  it('ignores a claim on an id that does not exist', () => {
    const board = new PickupBoard(KINDS);
    for (const id of [-1, 3, 1.5, NaN, Infinity]) expect(board.claim(id)).toBeNull();
    expect(board.encodeAvailability()).toBe('111');
  });

  it('returns a pickup after its time, once, and lets it be claimed again', () => {
    const board = new PickupBoard(KINDS);
    board.claim(0);
    board.claim(2);
    expect(board.tick(PICKUP_RESPAWN_SECONDS.health - 0.1)).toEqual([]);
    expect(board.secondsUntilReturn(0)).toBeCloseTo(0.1);
    expect(board.tick(0.2)).toEqual([0]);
    expect(board.tick(10)).toEqual([]);
    expect(board.isAvailable(0)).toBe(true);
    expect(board.isAvailable(2)).toBe(false);
    expect(board.claim(0)).not.toBeNull();
    expect(board.tick(PICKUP_RESPAWN_SECONDS.grenade)).toEqual([0, 2]);
  });

  it('ignores a bad tick', () => {
    const board = new PickupBoard(KINDS);
    board.claim(0);
    for (const dt of [0, -1, NaN, Infinity]) expect(board.tick(dt)).toEqual([]);
    expect(board.isAvailable(0)).toBe(false);
  });

  it('uses the override time for pickups taken after it is set, and the real ones again after it is cleared', () => {
    const board = new PickupBoard(KINDS);
    board.claim(1);
    board.setRespawnOverride(2);
    expect(board.claim(0)?.respawnIn).toBe(2);
    expect(board.secondsUntilReturn(1)).toBe(PICKUP_RESPAWN_SECONDS.ammo);
    expect(board.tick(2)).toEqual([0]);
    board.setRespawnOverride(null);
    expect(board.claim(0)?.respawnIn).toBe(PICKUP_RESPAWN_SECONDS.health);
    board.setRespawnOverride(-3);
    expect(board.claim(2)?.respawnIn).toBe(PICKUP_RESPAWN_SECONDS.grenade);
  });

  it('puts everything back on a reset and reports which had been away', () => {
    const board = new PickupBoard(KINDS);
    board.claim(0);
    board.claim(2);
    expect(board.resetAll()).toEqual([0, 2]);
    expect(board.encodeAvailability()).toBe('111');
    expect(board.tick(1000)).toEqual([]);
  });
});

describe('PickupBoard as a follower', () => {
  it('mirrors taken and respawned from the host and runs no timer of its own', () => {
    const board = new PickupBoard(KINDS);
    expect(board.applyTaken(1)).toBe(true);
    expect(board.isAvailable(1)).toBe(false);
    expect(board.tick(1000)).toEqual([]);
    expect(board.isAvailable(1)).toBe(false);
    expect(board.applyRespawned(1)).toBe(true);
    expect(board.applyRespawned(1)).toBe(false);
    expect(board.isAvailable(1)).toBe(true);
  });

  it('rejects ids that do not exist', () => {
    const board = new PickupBoard(KINDS);
    expect(board.applyTaken(9)).toBe(false);
    expect(board.applyRespawned(-1)).toBe(false);
  });

  it('adopts a full state and reports what changed', () => {
    const board = new PickupBoard(KINDS);
    expect(board.applyAvailability('101')).toEqual([1]);
    expect(board.isAvailable(1)).toBe(false);
    expect(board.applyAvailability('111')).toEqual([1]);
    expect(board.applyAvailability('111')).toEqual([]);
  });

  it('ignores a state of the wrong length, with other characters, or that is not a string', () => {
    const board = new PickupBoard(KINDS);
    for (const bad of ['11', '1111', '1x1', '', null, undefined, 101, ['1', '1', '1']]) expect(board.applyAvailability(bad)).toBeNull();
    expect(board.encodeAvailability()).toBe('111');
  });

  it('round-trips the authority state through the wire encoding', () => {
    const host = new PickupBoard(KINDS);
    host.claim(0);
    host.claim(2);
    const guest = new PickupBoard(KINDS);
    guest.applyAvailability(host.encodeAvailability());
    expect(guest.encodeAvailability()).toBe('010');
  });
});
