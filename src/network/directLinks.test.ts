import { describe, expect, it } from 'vitest';
import { DIRECT_EVENT_TYPES, DIRECT_MESSAGE_TYPES, DuplicateEventFilter, MeshRelayPolicy } from './directLinks.ts';

describe('MeshRelayPolicy', () => {
  it('relays between guests that have not reported anything', () => {
    const policy = new MeshRelayPolicy();
    expect(policy.shouldRelay('playerSnapshot', 1, 2)).toBe(true);
    expect(policy.isLinked(1, 2)).toBe(false);
  });

  it('skips a direct message only when both guests list each other', () => {
    const policy = new MeshRelayPolicy();
    policy.report(1, [2]);
    expect(policy.shouldRelay('playerSnapshot', 1, 2)).toBe(true); // one side only
    policy.report(2, [1]);
    expect(policy.shouldRelay('playerSnapshot', 1, 2)).toBe(false);
    expect(policy.shouldRelay('fireEvent', 2, 1)).toBe(false);
    expect(policy.shouldRelay('footstepEvent', 1, 2)).toBe(false);
  });

  it('never skips a message type that is not sent on direct links', () => {
    const policy = new MeshRelayPolicy();
    policy.report(1, [2]);
    policy.report(2, [1]);
    expect(policy.shouldRelay('damageEvent', 1, 2)).toBe(true);
    expect(policy.shouldRelay('playerDied', 1, 2)).toBe(true);
    expect(policy.shouldRelay('goosePickedUp', 2, 1)).toBe(true);
  });

  it('keeps relaying to a third guest the sender is not linked to', () => {
    const policy = new MeshRelayPolicy();
    policy.report(1, [2]);
    policy.report(2, [1]);
    expect(policy.shouldRelay('playerSnapshot', 1, 3)).toBe(true);
  });

  it('resumes relaying when either side drops the link, leaves or is replaced', () => {
    const policy = new MeshRelayPolicy();
    policy.report(1, [2, 3]);
    policy.report(2, [1]);
    expect(policy.shouldRelay('playerSnapshot', 1, 2)).toBe(false);

    policy.report(2, []);
    expect(policy.shouldRelay('playerSnapshot', 1, 2)).toBe(true);

    policy.report(2, [1]);
    expect(policy.shouldRelay('playerSnapshot', 1, 2)).toBe(false);
    policy.forget(1);
    expect(policy.shouldRelay('playerSnapshot', 2, 1)).toBe(true);
  });

  it('a slot is never linked to itself', () => {
    const policy = new MeshRelayPolicy();
    policy.report(1, [1]);
    expect(policy.isLinked(1, 1)).toBe(false);
  });

  it('counts each linked pair once', () => {
    const policy = new MeshRelayPolicy();
    expect(policy.linkedPairCount()).toBe(0);
    policy.report(1, [2, 3]);
    policy.report(2, [1, 3]);
    policy.report(3, [1]);
    expect(policy.linkedPairCount()).toBe(2); // 1-2 and 1-3; 2 lists 3 but 3 does not list 2
    policy.report(3, [1, 2]);
    expect(policy.linkedPairCount()).toBe(3);
  });

  it('direct events are a subset of the direct types', () => {
    for (const type of DIRECT_EVENT_TYPES) expect(DIRECT_MESSAGE_TYPES.has(type)).toBe(true);
    expect(DIRECT_EVENT_TYPES.has('playerSnapshot')).toBe(false);
  });
});

describe('DuplicateEventFilter', () => {
  it('drops the second copy of an event with the same sender stamp', () => {
    const filter = new DuplicateEventFilter();
    expect(filter.accept(1, 100)).toBe(true);
    expect(filter.accept(1, 100)).toBe(false);
    expect(filter.accept(1, 101)).toBe(true);
  });

  it('keeps stamps apart per sender', () => {
    const filter = new DuplicateEventFilter();
    expect(filter.accept(1, 100)).toBe(true);
    expect(filter.accept(2, 100)).toBe(true);
    expect(filter.accept(2, 100)).toBe(false);
  });

  it('always passes an event with no stamp', () => {
    const filter = new DuplicateEventFilter();
    expect(filter.accept(1, undefined)).toBe(true);
    expect(filter.accept(1, undefined)).toBe(true);
  });

  it('forgets a sender that left, so a rejoin on a new clock starts clean', () => {
    const filter = new DuplicateEventFilter();
    filter.accept(1, 5);
    filter.forget(1);
    expect(filter.accept(1, 5)).toBe(true);
  });

  it('remembers only the most recent stamps', () => {
    const filter = new DuplicateEventFilter();
    for (let t = 0; t < 100; t++) filter.accept(1, t);
    expect(filter.accept(1, 99)).toBe(false);
    expect(filter.accept(1, 0)).toBe(true); // long forgotten
  });
});
