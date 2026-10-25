import { describe, expect, it } from 'vitest';
import { GrenadeHand } from './grenadeHand.ts';
import { GRENADE_FUSE, GRENADE_MAX_COUNT, GRENADE_START_COUNT } from './grenadeTuning.ts';

const NONE = { frag: false, flash: false };
const FRAG = { frag: true, flash: false };
const FLASH = { frag: false, flash: true };
const DT = 1 / 60;

describe('GrenadeHand carry', () => {
  it('starts with 2 of each and resets to 2', () => {
    const hand = new GrenadeHand(true);
    expect(hand.count('frag')).toBe(GRENADE_START_COUNT);
    expect(hand.count('flash')).toBe(GRENADE_START_COUNT);
    hand.take('frag');
    hand.reset();
    expect(hand.count('frag')).toBe(GRENADE_START_COUNT);
  });

  it('tops up to at most 3', () => {
    const hand = new GrenadeHand(true);
    expect(hand.add('frag', 5)).toBe(GRENADE_MAX_COUNT - GRENADE_START_COUNT);
    expect(hand.count('frag')).toBe(GRENADE_MAX_COUNT);
  });

  it('carries none where grenades are off', () => {
    const hand = new GrenadeHand(false);
    expect(hand.count('frag')).toBe(0);
    expect(hand.add('flash', 1)).toBe(0);
    expect(hand.update(DT, FRAG, true)).toEqual([]);
  });
});

describe('GrenadeHand cooking', () => {
  it('cooks on press and throws on release with the fuse left', () => {
    const hand = new GrenadeHand(true);
    expect(hand.update(DT, FRAG, true)).toEqual([{ type: 'cook', kind: 'frag' }]);
    for (let i = 0; i < 60; i++) expect(hand.update(DT, FRAG, true)).toEqual([]);
    const [event] = hand.update(DT, NONE, true);
    expect(event?.type).toBe('throw');
    expect(event && event.type === 'throw' ? event.fuseLeft : 0).toBeCloseTo(GRENADE_FUSE.frag - 61 * DT);
    expect(hand.count('frag')).toBe(GRENADE_START_COUNT - 1);
    expect(hand.cookingKind).toBeNull();
  });

  it('throws a tap at once, a tick later', () => {
    const hand = new GrenadeHand(true);
    hand.update(DT, FLASH, true);
    const events = hand.update(DT, NONE, true);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('throw');
  });

  it('detonates in the hand when cooked past the fuse, and needs a fresh press after', () => {
    const hand = new GrenadeHand(true);
    hand.update(DT, FLASH, true);
    const events = [];
    for (let t = 0; t < GRENADE_FUSE.flash + 0.1; t += DT) events.push(...hand.update(DT, FLASH, true));
    expect(events).toEqual([{ type: 'inHand', kind: 'flash' }]);
    expect(hand.count('flash')).toBe(GRENADE_START_COUNT - 1);
    // Still holding: no new cook until the key is released and pressed again.
    expect(hand.update(DT, FLASH, true)).toEqual([]);
    hand.update(DT, NONE, true);
    expect(hand.update(DT, FLASH, true)).toEqual([{ type: 'cook', kind: 'flash' }]);
  });

  it('refuses to start while canStart is false, until the key is pressed again', () => {
    const hand = new GrenadeHand(true);
    expect(hand.update(DT, FRAG, false)).toEqual([]);
    expect(hand.update(DT, FRAG, true)).toEqual([]);
    hand.update(DT, NONE, true);
    expect(hand.update(DT, FRAG, true)).toEqual([{ type: 'cook', kind: 'frag' }]);
  });

  it('does nothing with none left', () => {
    const hand = new GrenadeHand(true);
    hand.take('frag');
    hand.take('frag');
    expect(hand.take('frag')).toBe(false);
    expect(hand.update(DT, FRAG, true)).toEqual([]);
  });

  it('gives the grenade back when a cook is cancelled', () => {
    const hand = new GrenadeHand(true);
    hand.update(DT, FRAG, true);
    hand.cancel();
    expect(hand.cookingKind).toBeNull();
    expect(hand.count('frag')).toBe(GRENADE_START_COUNT);
  });

  it('holds one grenade at a time: the other key does nothing mid-cook', () => {
    const hand = new GrenadeHand(true);
    hand.update(DT, FRAG, true);
    expect(hand.update(DT, { frag: true, flash: true }, true)).toEqual([]);
    expect(hand.cookingKind).toBe('frag');
    expect(hand.fuseLeft).toBeCloseTo(GRENADE_FUSE.frag - DT);
  });
});
