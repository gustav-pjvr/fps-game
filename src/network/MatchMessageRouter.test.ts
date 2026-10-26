import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ThrownGoose } from '../entities/ThrownGoose.ts';
import { HostRoster } from './HostRoster.ts';
import { buildMatchSync } from './matchSync.ts';
import { KOTH_SCORE_STEP_MAX, routeMatchMessage, type MatchMessageContext } from './MatchMessageRouter.ts';
import { isNetworkMessage, type NetworkMessage, type PlayerSlot } from './protocol.ts';

/** A context with only what the cases under test touch; everything else is left out on purpose. */
function makeContext(overrides: { role?: 'host' | 'guest'; ownSlot?: PlayerSlot; gameMode?: string; killLimit?: number; carrier?: PlayerSlot | null; map?: string } = {}) {
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
      map: overrides.map ?? 'valley',
      weather: 'day',
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
    opponentInMatch: vi.fn(),
    grenades: null,
  };
  return ctx;
}

function route(ctx: object, message: NetworkMessage, senderSlot: PlayerSlot = 0): void {
  const decoded: unknown = JSON.parse(JSON.stringify(message));
  if (!isNetworkMessage(decoded)) throw new Error(`rejected ${message.type}`);
  routeMatchMessage(ctx as unknown as MatchMessageContext, decoded, senderSlot);
}

describe('routeMatchMessage, 3 to 4 players', () => {
  it('the host relays through relay(), which skips directly linked guest pairs', () => {
    const ctx = makeContext({ role: 'host', ownSlot: 0, carrier: 2 });
    route(ctx, { type: 'kothScoreTick', senderSlot: 2, score: 1 }, 2);
    expect(ctx.multiplayer.session.connection.relay).toHaveBeenCalledWith(expect.objectContaining({ type: 'kothScoreTick' }), 2);
    expect(ctx.scoreboard.get(2)).toBe(1);
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

  it("starts an opponent's playing clock on its first playerSnapshot only", () => {
    const ctx = makeContext({ role: 'host', ownSlot: 0 });
    const opponent = {
      lastMessageAt: 0,
      firstSnapshotAt: null as number | null,
      isDead: false,
      health: 100,
      remotePlayer: { applySnapshot: vi.fn(), setLookPitch: vi.fn(), setTorch: vi.fn() },
    };
    ctx.multiplayer.opponents.set(3, opponent);
    // The connection layer talks while the world is still being built: that is not "playing".
    route(ctx, { type: 'meshStatus', senderSlot: 3, linked: [1] }, 3);
    expect(opponent.lastMessageAt).toBeGreaterThan(0);
    expect(opponent.firstSnapshotAt).toBeNull();
    route(ctx, { type: 'playerSnapshot', senderSlot: 3, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100 }, 3);
    const first = opponent.firstSnapshotAt;
    expect(first).not.toBeNull();
    route(ctx, { type: 'playerSnapshot', senderSlot: 3, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100 }, 3);
    expect(opponent.firstSnapshotAt).toBe(first);
  });

  it('a King of the Hill score only rises: a lower one is neither applied nor relayed', () => {
    const ctx = makeContext({ role: 'host', ownSlot: 0, gameMode: 'kingOfTheHill', carrier: 2 });
    ctx.scoreboard.set(2, 30);
    route(ctx, { type: 'kothScoreTick', senderSlot: 2, score: 3 }, 2);
    expect(ctx.scoreboard.get(2)).toBe(30);
    expect(ctx.multiplayer.session.connection.relay).not.toHaveBeenCalled();
    route(ctx, { type: 'kothScoreTick', senderSlot: 2, score: 31 }, 2);
    expect(ctx.scoreboard.get(2)).toBe(31);
  });

  it('a King of the Hill score counts only from the carrier, and rises at most KOTH_SCORE_STEP_MAX per tick', () => {
    const ctx = makeContext({ role: 'host', ownSlot: 0, gameMode: 'kingOfTheHill', carrier: 1 });
    route(ctx, { type: 'kothScoreTick', senderSlot: 2, score: 1 }, 2);   // not the carrier
    expect(ctx.scoreboard.get(2) ?? 0).toBe(0);
    route(ctx, { type: 'kothScoreTick', senderSlot: 1, score: 90 }, 1);  // claims the win at once
    expect(ctx.scoreboard.get(1)).toBe(KOTH_SCORE_STEP_MAX);
    route(ctx, { type: 'kothScoreTick', senderSlot: 1, score: 4 }, 1);   // catches up after a mismatch
    expect(ctx.scoreboard.get(1)).toBe(4);
  });

  it.each(['valley', 'facility'])("an opponent's snapshot on the %s cues the lamp and door catch-up", (map) => {
    const ctx = makeContext({ role: 'host', ownSlot: 0, map });
    ctx.multiplayer.opponents.set(2, {
      lastMessageAt: 0, firstSnapshotAt: null, isDead: false, health: 100,
      remotePlayer: { applySnapshot: vi.fn(), setLookPitch: vi.fn(), setTorch: vi.fn() },
    });
    route(ctx, { type: 'playerSnapshot', senderSlot: 2, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100 }, 2);
    expect(ctx.opponentInMatch).toHaveBeenCalledWith(2);
  });

  it("a joiner takes the host's scoreboardSync as is; the host ignores one", () => {
    const ctx = makeContext({ ownSlot: 3 });
    ctx.scoreboard.set(1, 4);
    ctx.scoreboard.set(2, 6);
    route(ctx, { type: 'scoreboardSync', scores: [{ slot: 1, score: 5, deaths: 1 }, { slot: 2, score: 0, deaths: 0 }, { slot: 3, score: 0, deaths: 0 }] });
    expect([...ctx.scoreboard]).toEqual([[1, 5], [2, 0], [3, 0]]);
    expect(ctx.deathCounts.get(1)).toBe(1);
    const host = makeContext({ role: 'host', ownSlot: 0 });
    route(host, { type: 'scoreboardSync', scores: [{ slot: 1, score: 50, deaths: 0 }] }, 1);
    expect(host.scoreboard.size).toBe(0);
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

const thrown = (id: string, senderSlot: PlayerSlot = 2): NetworkMessage => ({
  type: 'gooseThrown',
  senderSlot,
  id,
  originX: 1,
  originY: 2,
  originZ: 3,
  velX: 0,
  velY: 1,
  velZ: -4,
  source: 'gooseToss',
});

describe('routeMatchMessage, thrown geese', () => {
  it('adds a thrown goose once, however many times its id arrives (live, then in a late join sync)', () => {
    const scene = { add: vi.fn(), remove: vi.fn() };
    const ctx = { ...makeContext({ ownSlot: 1 }), scene };
    route(ctx, thrown('t1'));
    route(ctx, thrown('t1'));
    expect(ctx.thrownGeese.size).toBe(1);
    expect(scene.add).toHaveBeenCalledTimes(1);
    route(ctx, thrown('t2', 3));
    expect(ctx.thrownGeese.size).toBe(2);
    expect(scene.add).toHaveBeenCalledTimes(2);
    expect(ctx.thrownGeese.get('t1')?.throwerSlot).toBe(2);
    expect(ctx.thrownGeese.get('t2')?.throwerSlot).toBe(3);
  });
});

describe('routeMatchMessage, the host answers a sync request', () => {
  /** A host in a running match with two guests, and what its managers hold. */
  function hostContext(gameMode: string) {
    const hostRoster = new HostRoster('Host');
    hostRoster.handleHello('Bob', 'tb', 0, 'peer-bob');
    hostRoster.handleHello('Cara', 'tc', 0, 'peer-cara');
    hostRoster.startMatch();
    const base = makeContext({ role: 'host', ownSlot: 0, gameMode });
    const multiplayer = { ...base.multiplayer, hostRoster };
    multiplayer.hordeEliminatedSlots.add(2);
    const horde = { currentWave: 4, isCleared: false, listForSync: vi.fn(() => []), applyWaveStarted: vi.fn(), applyCleared: vi.fn() };
    const verdict = { winnerSlot: 1 as PlayerSlot, scoreboard: [{ slot: 1 as PlayerSlot, score: 10 }] };
    const ctx = {
      ...base,
      multiplayer,
      gooseManager: { listForSync: vi.fn(() => [{ id: 'g1', x: 1, y: 0, z: 2, killerSlot: null }]) },
      hordeGooseManager: gameMode === 'gooseHorde' ? horde : null,
      goldenGooseManager: gameMode === 'kingOfTheHill' ? { carrierSlot: 1 as PlayerSlot | null, position: { x: 5, y: 6, z: 7 }, claim: vi.fn(), drop: vi.fn() } : null,
      bonusGooseManager: null,
      ammoDropManager: null,
      matchHasEnded: vi.fn(() => false),
      endedMatchVerdict: vi.fn<() => typeof verdict | null>(() => null),
    };
    ctx.thrownGeese.set('t9', new ThrownGoose('t9', 1, 'gooseLauncher', new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6)));
    const expected = (verdictOverride: typeof verdict | null = null) =>
      buildMatchSync({
        roster: hostRoster.connectedRoster(),
        goldenGoose: ctx.goldenGooseManager ? { carrierSlot: ctx.goldenGooseManager.carrierSlot, position: ctx.goldenGooseManager.position } : null,
        geese: ctx.gooseManager.listForSync(),
        horde: gameMode === 'gooseHorde' ? { wave: 4, eliminated: [2], result: undefined, geese: [] } : null,
        ammoDrops: [],
        bonusGeese: [],
        thrownGeese: ctx.thrownGeese.values(),
        scoreboard: ctx.scoreboard,
        deathCounts: ctx.deathCounts,
        verdict: verdictOverride,
      });
    return { ctx, expected, verdict };
  }

  const sentMessages = (ctx: ReturnType<typeof hostContext>['ctx']) => ctx.multiplayer.session.connection.sendTo.mock.calls.map(([, message]) => message as NetworkMessage);

  it('sends each buildMatchSync message to the requester only, for a gooseSyncRequest', () => {
    const { ctx, expected } = hostContext('default');
    // A kill made while the joiner loaded reaches it in the sync.
    ctx.scoreboard.set(1, 3);
    route(ctx, { type: 'gooseSyncRequest', senderSlot: 2 }, 2);
    expect(ctx.multiplayer.session.connection.sendTo.mock.calls.every(([slot]) => slot === 2)).toBe(true);
    const messages = sentMessages(ctx);
    expect(messages).toEqual(expected());
    const types = messages.map((message) => message.type);
    expect(types[0]).toBe('rosterSync');
    expect(types[1]).toBe('scoreboardSync');
    expect(types).toContain('gooseSpawned');
    expect(types).toContain('gooseThrown');
    expect(types).not.toContain('hordeSyncState');
    expect(messages[1]).toEqual({
      type: 'scoreboardSync',
      scores: [{ slot: 0, score: 0, deaths: 0 }, { slot: 1, score: 3, deaths: 0 }, { slot: 2, score: 0, deaths: 0 }],
    });
  });

  it('answers a hordeSyncRequest with the same kind of full sync, with the horde state in it', () => {
    const { ctx, expected } = hostContext('gooseHorde');
    route(ctx, { type: 'hordeSyncRequest', senderSlot: 1 }, 1);
    expect(ctx.multiplayer.session.connection.sendTo.mock.calls.every(([slot]) => slot === 1)).toBe(true);
    const messages = sentMessages(ctx);
    expect(messages).toEqual(expected());
    expect(messages).toContainEqual({ type: 'hordeSyncState', wave: 4, eliminated: [2] });
  });

  it('both requests give a joiner the same sync', () => {
    const { ctx } = hostContext('default');
    route(ctx, { type: 'gooseSyncRequest', senderSlot: 2 }, 2);
    const first = sentMessages(ctx);
    ctx.multiplayer.session.connection.sendTo.mockClear();
    route(ctx, { type: 'hordeSyncRequest', senderSlot: 2 }, 2);
    expect(sentMessages(ctx)).toEqual(first);
  });

  it('includes the golden goose in King of the Hill and the result once the match has ended', () => {
    const { ctx, expected, verdict } = hostContext('kingOfTheHill');
    ctx.endedMatchVerdict.mockReturnValue(verdict);
    route(ctx, { type: 'gooseSyncRequest', senderSlot: 3 }, 3);
    const messages = sentMessages(ctx);
    expect(messages).toEqual(expected(verdict));
    expect(messages).toContainEqual({ type: 'goldenGooseState', carrierSlot: 1, x: 5, y: 6, z: 7 });
    expect(messages[messages.length - 1]).toEqual({ type: 'matchEnded', ...verdict });
  });

  it('lists only connected players in the roster it sends', () => {
    const { ctx } = hostContext('default');
    ctx.multiplayer.hostRoster.handleDisconnect(1, 1000);
    route(ctx, { type: 'gooseSyncRequest', senderSlot: 2 }, 2);
    expect(sentMessages(ctx).find((message) => message.type === 'rosterSync')).toEqual({
      type: 'rosterSync',
      roster: [
        { slot: 0, username: 'Host' },
        { slot: 2, username: 'Cara', peerId: 'peer-cara' },
      ],
    });
  });

  it('a guest never answers a sync request', () => {
    const { ctx } = hostContext('default');
    ctx.multiplayer.session.role = 'guest';
    route(ctx, { type: 'gooseSyncRequest', senderSlot: 2 }, 2);
    route(ctx, { type: 'hordeSyncRequest', senderSlot: 2 }, 2);
    expect(ctx.multiplayer.session.connection.sendTo).not.toHaveBeenCalled();
  });
});
