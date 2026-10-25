import { describe, expect, it, vi } from 'vitest';
import { routeMatchMessage, type MatchMessageContext } from './MatchMessageRouter.ts';
import { isNetworkMessage, type NetworkMessage, type PlayerSlot } from './protocol.ts';

/** A context with only what the cases under test touch; everything else is left out on purpose. */
function makeContext(overrides: { role?: 'host' | 'guest'; ownSlot?: PlayerSlot; gameMode?: string; killLimit?: number; carrier?: PlayerSlot | null } = {}) {
  const goldenGoose = { carrierSlot: overrides.carrier ?? null, claim: vi.fn(), drop: vi.fn() };
  goldenGoose.claim.mockImplementation((slot: PlayerSlot) => (goldenGoose.carrierSlot = slot));
  const opponents = new Map<PlayerSlot, unknown>();
  const ctx = {
    multiplayer: {
      session: { role: overrides.role ?? 'guest', ownSlot: overrides.ownSlot ?? 1, connection: { relay: vi.fn(), sendTo: vi.fn() } },
      opponents,
      usernames: new Map<PlayerSlot, string>(),
      gameMode: overrides.gameMode ?? 'default',
      killLimit: overrides.killLimit ?? 10,
      hordeEliminatedSlots: new Set<PlayerSlot>(),
      hostRoster: null,
    },
    scoreboard: new Map<PlayerSlot, number>(),
    deathCounts: new Map<PlayerSlot, number>(),
    thrownGeese: new Map(),
    isHordeMode: false,
    goldenGooseManager: goldenGoose,
    hordeGooseManager: { applyWaveStarted: vi.fn(), applyCleared: vi.fn() },
    killFeed: { show: vi.fn() },
    weaponManager: { activeWeaponId: 'rifle', replaceActiveWeapon: vi.fn(async () => {}) },
    healLocalPlayerToFull: vi.fn(),
    endLostHordeRun: vi.fn(),
    addMultiplayerOpponent: vi.fn(async () => {}),
    removeMultiplayerOpponent: vi.fn(),
  };
  return ctx;
}

function route(ctx: ReturnType<typeof makeContext>, message: NetworkMessage, senderSlot: PlayerSlot = 0): void {
  const decoded: unknown = JSON.parse(JSON.stringify(message));
  if (!isNetworkMessage(decoded)) throw new Error(`rejected ${message.type}`);
  routeMatchMessage(ctx as unknown as MatchMessageContext, decoded, senderSlot);
}

describe('routeMatchMessage, 3 to 4 players', () => {
  it('the host relays through relay(), which skips directly linked guest pairs', () => {
    const ctx = makeContext({ role: 'host', ownSlot: 0 });
    route(ctx, { type: 'kothScoreTick', senderSlot: 2, score: 4 }, 2);
    expect(ctx.multiplayer.session.connection.relay).toHaveBeenCalledWith(expect.objectContaining({ type: 'kothScoreTick' }), 2);
    expect(ctx.scoreboard.get(2)).toBe(4);
  });

  it('a drop from a claimant that lost the tie-break leaves the real carrier', () => {
    const ctx = makeContext({ carrier: 1 });
    route(ctx, { type: 'goldenGooseDropped', senderSlot: 3, x: 1, y: 2, z: 3 });
    expect(ctx.goldenGooseManager.drop).not.toHaveBeenCalled();
    route(ctx, { type: 'goldenGooseDropped', senderSlot: 1, x: 1, y: 2, z: 3 });
    expect(ctx.goldenGooseManager.drop).toHaveBeenCalledTimes(1);
  });

  it('a claim displaces only a higher-slot carrier', () => {
    const ctx = makeContext({ carrier: 2 });
    route(ctx, { type: 'goldenGoosePickedUp', senderSlot: 3 });
    expect(ctx.goldenGooseManager.carrierSlot).toBe(2);
    route(ctx, { type: 'goldenGoosePickedUp', senderSlot: 1 });
    expect(ctx.goldenGooseManager.carrierSlot).toBe(1);
  });

  it('a late joiner takes the golden goose state from the host as is', () => {
    const ctx = makeContext({ carrier: null });
    route(ctx, { type: 'goldenGooseState', carrierSlot: 3, x: 0, y: 0, z: 0 });
    expect(ctx.goldenGooseManager.carrierSlot).toBe(3);
    route(ctx, { type: 'goldenGooseState', carrierSlot: null, x: 4, y: 5, z: 6 }, 2);
    expect(ctx.goldenGooseManager.drop).not.toHaveBeenCalled(); // only the host's sync counts
  });

  it('a Gun Game kill that is not credited does not upgrade the killer', () => {
    const ctx = makeContext({ ownSlot: 1, gameMode: 'gunGame', killLimit: 5 });
    ctx.scoreboard.set(1, 4);
    route(ctx, { type: 'playerDied', senderSlot: 2, victimSlot: 2, killerSlot: 1, killerWeaponId: 'rifle' });
    expect(ctx.scoreboard.get(1)).toBe(4);
    expect(ctx.weaponManager.replaceActiveWeapon).not.toHaveBeenCalled();
    ctx.scoreboard.set(1, 2);
    route(ctx, { type: 'playerDied', senderSlot: 3, victimSlot: 3, killerSlot: 1, killerWeaponId: 'rifle' });
    expect(ctx.scoreboard.get(1)).toBe(3);
    expect(ctx.weaponManager.replaceActiveWeapon).toHaveBeenCalledTimes(1);
  });

  it('rosterSync adds missing opponents and removes departed ones', () => {
    const ctx = makeContext({ ownSlot: 2 });
    ctx.multiplayer.opponents.set(0, {});
    ctx.multiplayer.opponents.set(1, {});
    route(ctx, { type: 'rosterSync', roster: [{ slot: 0, username: 'Host' }, { slot: 2, username: 'Me' }, { slot: 3, username: 'Dee', peerId: 'p3' }] });
    expect(ctx.removeMultiplayerOpponent).toHaveBeenCalledWith(1);
    expect(ctx.addMultiplayerOpponent).toHaveBeenCalledTimes(1);
    expect(ctx.addMultiplayerOpponent).toHaveBeenCalledWith(3, 'Dee');
  });

  it('hordeSyncState adopts the eliminated set and a finished result', () => {
    const ctx = makeContext({ gameMode: 'gooseHorde' });
    route(ctx, { type: 'hordeSyncState', wave: 3, eliminated: [0, 3] });
    expect([...ctx.multiplayer.hordeEliminatedSlots]).toEqual([0, 3]);
    expect(ctx.endLostHordeRun).not.toHaveBeenCalled();
    route(ctx, { type: 'hordeSyncState', wave: 3, result: 'wiped' });
    expect(ctx.endLostHordeRun).toHaveBeenCalledTimes(1);
    route(ctx, { type: 'hordeSyncState', wave: 5, result: 'cleared' });
    expect(ctx.hordeGooseManager.applyCleared).toHaveBeenCalledTimes(1);
  });

  it('drops a hordeSyncState with a malformed eliminated list or result', () => {
    expect(isNetworkMessage({ type: 'hordeSyncState', wave: 1, eliminated: ['x'] })).toBe(false);
    expect(isNetworkMessage({ type: 'hordeSyncState', wave: 1, result: 'won' })).toBe(false);
    expect(isNetworkMessage({ type: 'hordeSyncState', wave: 1 })).toBe(true);
  });
});
