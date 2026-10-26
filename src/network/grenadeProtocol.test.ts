import { describe, expect, it, vi } from 'vitest';
import { RELAYABLE_MESSAGE_TYPES, routeMatchMessage, type MatchMessageContext } from './MatchMessageRouter.ts';
import { isNetworkMessage, type GrenadeDetonatedMessage, type GrenadeThrownMessage } from './protocol.ts';

const thrown: GrenadeThrownMessage = {
  type: 'grenadeThrown',
  senderSlot: 1,
  id: '1-3',
  kind: 'frag',
  origin: { x: 1, y: 2, z: 3 },
  velocity: { x: 0, y: 4, z: 17 },
  fuseLeft: 2.4,
  t: 1234.5,
};

const detonated: GrenadeDetonatedMessage = {
  type: 'grenadeDetonated',
  senderSlot: 1,
  id: '1-3',
  kind: 'flash',
  position: { x: 4, y: 0.07, z: -2 },
};

function decode(message: unknown): unknown {
  return JSON.parse(JSON.stringify(message));
}

describe('grenade message validation', () => {
  it('accepts well-formed messages after a JSON round trip', () => {
    expect(isNetworkMessage(decode(thrown))).toBe(true);
    expect(isNetworkMessage(decode(detonated))).toBe(true);
    expect(isNetworkMessage(decode({ type: 'damageEvent', senderSlot: 1, targetSlot: 0, amount: 40, weaponId: 'frag' }))).toBe(true);
  });

  it.each([
    ['an unknown kind', { kind: 'smoke' }],
    ['an empty id', { id: '' }],
    ['a long id', { id: 'x'.repeat(49) }],
    ['a non-string id', { id: 7 }],
    ['a negative fuse', { fuseLeft: -0.1 }],
    ['a fuse over 10 s', { fuseLeft: 10.5 }],
    ['a missing fuse', { fuseLeft: undefined }],
    ['a non-finite origin', { origin: { x: 1, y: null, z: 3 } }],
    ['a missing velocity', { velocity: undefined }],
    ['a non-numeric velocity', { velocity: { x: '1', y: 0, z: 0 } }],
    ['a missing clock', { t: undefined }],
    ['a velocity near 1e200 (its flight would turn NaN)', { velocity: { x: 1e200, y: 0, z: 0 } }],
    ['a speed past the cap', { velocity: { x: 0, y: 0, z: 201 } }],
    ['an origin far outside any map', { origin: { x: 1e7, y: 0, z: 0 } }],
  ])('rejects a grenadeThrown with %s', (_label, patch) => {
    expect(isNetworkMessage(decode({ ...thrown, ...patch }))).toBe(false);
  });

  it('rejects a grenadeThrown with an infinite speed (not finite before JSON)', () => {
    expect(isNetworkMessage({ ...thrown, velocity: { x: Infinity, y: 0, z: 0 } })).toBe(false);
  });

  it.each([
    ['an unknown kind', { kind: 'gas' }],
    ['a missing position', { position: undefined }],
    ['a NaN position', { position: { x: NaN, y: 0, z: 0 } }],
    ['a long id', { id: 'y'.repeat(100) }],
    ['a position far outside any map', { position: { x: 0, y: -1e9, z: 0 } }],
  ])('rejects a grenadeDetonated with %s', (_label, patch) => {
    expect(isNetworkMessage({ ...detonated, ...patch })).toBe(false);
  });
});

describe('grenade message routing', () => {
  function context(role: 'host' | 'guest') {
    const grenades = { enabled: true, receiveThrown: vi.fn(), receiveDetonated: vi.fn(), opponentInMatch: vi.fn() };
    const relay = vi.fn();
    const ctx = {
      multiplayer: {
        session: { role, ownSlot: role === 'host' ? 0 : 2, connection: { relay } },
        opponents: new Map(),
        map: 'valley',
      },
      grenades,
    } as unknown as MatchMessageContext;
    return { ctx, grenades, relay };
  }

  it('is relayed by the host', () => {
    expect(RELAYABLE_MESSAGE_TYPES.has('grenadeThrown')).toBe(true);
    expect(RELAYABLE_MESSAGE_TYPES.has('grenadeDetonated')).toBe(true);
    const { ctx, relay } = context('host');
    routeMatchMessage(ctx, thrown, 1);
    expect(relay).toHaveBeenCalledWith(thrown, 1);
  });

  it('hands thrown and detonated grenades to the grenade system', () => {
    const { ctx, grenades } = context('guest');
    routeMatchMessage(ctx, thrown, 0);
    routeMatchMessage(ctx, detonated, 0);
    expect(grenades.receiveThrown).toHaveBeenCalledWith(thrown);
    expect(grenades.receiveDetonated).toHaveBeenCalledWith(detonated);
  });

  it('ignores grenade messages where grenades are off', () => {
    const { ctx } = context('guest');
    const off = { ...ctx, grenades: null } as MatchMessageContext;
    expect(() => routeMatchMessage(off, thrown, 0)).not.toThrow();
  });

  it('neither flies nor relays grenades in a mode whose grenade system is disabled', () => {
    const { ctx, grenades, relay } = context('host');
    grenades.enabled = false;
    routeMatchMessage(ctx, thrown, 1);
    routeMatchMessage(ctx, detonated, 1);
    expect(grenades.receiveThrown).not.toHaveBeenCalled();
    expect(grenades.receiveDetonated).not.toHaveBeenCalled();
    expect(relay).not.toHaveBeenCalled();
  });
});
