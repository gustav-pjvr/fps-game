import { describe, expect, it } from 'vitest';
import { GrenadeHand } from './grenadeHand.ts';
import { GRENADE_FUSE, GRENADE_MAX_COUNT, GRENADE_START_COUNT } from './grenadeTuning.ts';

const DT = 1 / 60;

describe('GrenadeHand carry', () => {
  it('starts with 2 of the chosen kind, one count, and resets to 2', () => {
    const hand = new GrenadeHand('flash', true);
    expect(hand.kind).toBe('flash');
    expect(hand.count).toBe(GRENADE_START_COUNT);
    hand.take();
    expect(hand.count).toBe(GRENADE_START_COUNT - 1);
    hand.reset();
    expect(hand.count).toBe(GRENADE_START_COUNT);
  });

  it('tops up to at most 3', () => {
    const hand = new GrenadeHand('frag', true);
    expect(hand.add(5)).toBe(GRENADE_MAX_COUNT - GRENADE_START_COUNT);
    expect(hand.count).toBe(GRENADE_MAX_COUNT);
    expect(hand.add(1)).toBe(0);
  });

  it('carries none where grenades are off', () => {
    const hand = new GrenadeHand('frag', false);
    expect(hand.count).toBe(0);
    expect(hand.add(1)).toBe(0);
    expect(hand.update(DT, true, true)).toEqual([]);
  });
});

describe('GrenadeHand cooking', () => {
  it('cooks on press and throws on release with the fuse left', () => {
    const hand = new GrenadeHand('frag', true);
    expect(hand.update(DT, true, true)).toEqual([{ type: 'cook', kind: 'frag' }]);
    for (let i = 0; i < 60; i++) expect(hand.update(DT, true, true)).toEqual([]);
    const [event] = hand.update(DT, false, true);
    expect(event?.type).toBe('throw');
    expect(event && event.type === 'throw' ? event.fuseLeft : 0).toBeCloseTo(GRENADE_FUSE.frag - 61 * DT);
    expect(hand.count).toBe(GRENADE_START_COUNT - 1);
    expect(hand.cookingKind).toBeNull();
  });

  it('throws the chosen kind: a flash hand throws flashes', () => {
    const hand = new GrenadeHand('flash', true);
    expect(hand.update(DT, true, true)).toEqual([{ type: 'cook', kind: 'flash' }]);
    expect(hand.cookingKind).toBe('flash');
    const events = hand.update(DT, false, true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'throw', kind: 'flash' });
  });

  it('throws a tap at once, a tick later', () => {
    const hand = new GrenadeHand('frag', true);
    hand.update(DT, true, true);
    const events = hand.update(DT, false, true);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('throw');
  });

  it('detonates in the hand when cooked past the fuse, and needs a fresh press after', () => {
    const hand = new GrenadeHand('flash', true);
    hand.update(DT, true, true);
    const events = [];
    for (let t = 0; t < GRENADE_FUSE.flash + 0.1; t += DT) events.push(...hand.update(DT, true, true));
    expect(events).toEqual([{ type: 'inHand', kind: 'flash' }]);
    expect(hand.count).toBe(GRENADE_START_COUNT - 1);
    // Still holding: no new cook until the key is released and pressed again.
    expect(hand.update(DT, true, true)).toEqual([]);
    hand.update(DT, false, true);
    expect(hand.update(DT, true, true)).toEqual([{ type: 'cook', kind: 'flash' }]);
  });

  it('refuses to start while canStart is false, until the key is pressed again', () => {
    const hand = new GrenadeHand('frag', true);
    expect(hand.update(DT, true, false)).toEqual([]);
    expect(hand.update(DT, true, true)).toEqual([]);
    hand.update(DT, false, true);
    expect(hand.update(DT, true, true)).toEqual([{ type: 'cook', kind: 'frag' }]);
  });

  it('does nothing with none left', () => {
    const hand = new GrenadeHand('frag', true);
    hand.take();
    hand.take();
    expect(hand.take()).toBe(false);
    expect(hand.update(DT, true, true)).toEqual([]);
  });

  it('gives the grenade back when a cook is cancelled', () => {
    const hand = new GrenadeHand('frag', true);
    hand.update(DT, true, true);
    hand.cancel();
    expect(hand.cookingKind).toBeNull();
    expect(hand.count).toBe(GRENADE_START_COUNT);
  });

  it('holds one grenade at a time: a held key mid-cook adds nothing', () => {
    const hand = new GrenadeHand('frag', true);
    hand.update(DT, true, true);
    expect(hand.update(DT, true, true)).toEqual([]);
    expect(hand.cookingKind).toBe('frag');
    expect(hand.fuseLeft).toBeCloseTo(GRENADE_FUSE.frag - DT);
  });
});
