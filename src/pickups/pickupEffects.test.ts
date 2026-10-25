import { describe, expect, it } from 'vitest';
import { PICKUP_HEALTH_AMOUNT } from './pickupConfig.ts';
import { applyPickup, grenadeSupplyFrom, healthGain, NO_GRENADES, pickupWouldGive, type GrenadeCarry, type GrenadeSupply, type PickupRecipient } from './pickupEffects.ts';
import { GrenadeHand } from '../combat/grenades/grenadeHand.ts';
import { GRENADE_MAX_COUNT, GRENADE_START_COUNT } from '../combat/grenades/grenadeTuning.ts';

function recipient(overrides: Partial<PickupRecipient> & { state?: { current: number; max: number } } = {}): PickupRecipient & { healed: number[] } {
  const state = overrides.state ?? { current: 50, max: 100 };
  const healed: number[] = [];
  return {
    healed,
    health: () => state,
    heal: (amount) => {
      healed.push(amount);
      state.current = Math.min(state.max, state.current + amount);
    },
    ammoWouldGive: () => true,
    grantAmmo: () => true,
    grenades: NO_GRENADES,
    ...overrides,
  };
}

describe('healthGain', () => {
  it('gives the full amount, cut to what is missing', () => {
    expect(healthGain(50, 100, PICKUP_HEALTH_AMOUNT)).toBe(40);
    expect(healthGain(80, 100, PICKUP_HEALTH_AMOUNT)).toBe(20);
    expect(healthGain(99, 100, PICKUP_HEALTH_AMOUNT)).toBe(1);
  });

  it('gives nothing at full health, or to a dead player', () => {
    expect(healthGain(100, 100, PICKUP_HEALTH_AMOUNT)).toBe(0);
    expect(healthGain(0, 100, PICKUP_HEALTH_AMOUNT)).toBe(0);
    expect(healthGain(-5, 100, PICKUP_HEALTH_AMOUNT)).toBe(0);
  });
});

describe('pickupWouldGive', () => {
  it('skips a health pack at full health and takes it below', () => {
    expect(pickupWouldGive('health', recipient({ state: { current: 100, max: 100 } }))).toBe(false);
    expect(pickupWouldGive('health', recipient({ state: { current: 99, max: 100 } }))).toBe(true);
  });

  it('follows the guns for an ammo box', () => {
    expect(pickupWouldGive('ammo', recipient({ ammoWouldGive: () => false }))).toBe(false);
    expect(pickupWouldGive('ammo', recipient({ ammoWouldGive: () => true }))).toBe(true);
  });

  it('follows the grenade supply for a crate, and gives nothing while grenades do not exist', () => {
    expect(pickupWouldGive('grenade', recipient())).toBe(false);
    expect(pickupWouldGive('grenade', recipient({ grenades: { wouldGive: () => true, grant: () => true } }))).toBe(true);
  });
});

describe('applyPickup', () => {
  it('heals by the gain and reports it', () => {
    const r = recipient({ state: { current: 70, max: 100 } });
    expect(applyPickup('health', r)).toBe('+30 HEALTH');
    expect(r.healed).toEqual([30]);
  });

  it('gives nothing and says nothing for a full player', () => {
    const r = recipient({ state: { current: 100, max: 100 } });
    expect(applyPickup('health', r)).toBeNull();
    expect(r.healed).toEqual([]);
  });

  it('stocks the guns and reports it, or says nothing when they are full', () => {
    expect(applyPickup('ammo', recipient())).toBe('AMMO RESTOCKED');
    expect(applyPickup('ammo', recipient({ grantAmmo: () => false }))).toBeNull();
  });

  it('asks the grenade supply for one frag and one flash', () => {
    const calls: [number, number][] = [];
    const supply: GrenadeSupply = { wouldGive: () => true, grant: (frag, flash) => (calls.push([frag, flash]), true) };
    expect(applyPickup('grenade', recipient({ grenades: supply }))).toBe('+1 FRAG  +1 FLASH');
    expect(calls).toEqual([[1, 1]]);
  });

  it('reports nothing while grenades do not exist', () => {
    expect(applyPickup('grenade', recipient())).toBeNull();
  });
});

describe('grenadeSupplyFrom', () => {
  /** A carry over the grenade system's own hand, so the cap is the real one. */
  const carryOf = (hand: GrenadeHand, enabled = true): GrenadeCarry => ({
    enabled,
    count: (kind) => hand.count(kind),
    addGrenades: (kind, amount) => hand.add(kind, amount),
  });

  it('tops up one frag and one flash from the start count, then stops at the cap', () => {
    const hand = new GrenadeHand(true);
    const supply = grenadeSupplyFrom(() => carryOf(hand));
    for (let n = GRENADE_START_COUNT; n < GRENADE_MAX_COUNT; n++) {
      expect(supply.wouldGive()).toBe(true);
      expect(supply.grant(1, 1)).toBe(true);
    }
    expect(hand.count('frag')).toBe(GRENADE_MAX_COUNT);
    expect(hand.count('flash')).toBe(GRENADE_MAX_COUNT);
    expect(supply.wouldGive()).toBe(false);
    expect(supply.grant(1, 1)).toBe(false);
  });

  it('still gives when only one kind is below the cap', () => {
    const hand = new GrenadeHand(true);
    hand.add('frag', GRENADE_MAX_COUNT);
    const supply = grenadeSupplyFrom(() => carryOf(hand));
    expect(supply.wouldGive()).toBe(true);
    expect(supply.grant(1, 1)).toBe(true);
    expect(hand.count('flash')).toBe(GRENADE_START_COUNT + 1);
  });

  it('gives nothing before the grenade system exists or where grenades are off', () => {
    expect(grenadeSupplyFrom(() => null).wouldGive()).toBe(false);
    expect(grenadeSupplyFrom(() => null).grant(1, 1)).toBe(false);
    const off = new GrenadeHand(false);
    const supply = grenadeSupplyFrom(() => carryOf(off, false));
    expect(supply.wouldGive()).toBe(false);
    expect(supply.grant(1, 1)).toBe(false);
  });
});
