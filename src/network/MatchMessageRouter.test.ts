import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ThrownGoose } from '../entities/ThrownGoose.ts';
import { HostRoster } from './HostRoster.ts';
import { buildMatchSync } from './matchSync.ts';
import { routeMatchMessage, type MatchMessageContext } from './MatchMessageRouter.ts';
import { isNetworkMessage, type KothStateMessage, type NetworkMessage, type PlayerSlot } from './protocol.ts';
import { clearUnderground, registerUndergroundVolume } from '../world/underground.ts';

/** A context with only what the cases under test touch; everything else is left out on purpose. */
function makeContext(overrides: { role?: 'host' | 'guest'; ownSlot?: PlayerSlot; gameMode?: string; killLimit?: number; map?: string } = {}) {
  const kingOfTheHill = { receiveState: vi.fn(), receiveClaim: vi.fn(), playerDown: vi.fn(), syncMessage: vi.fn(() => null) };
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
    kingOfTheHill,
    hordeGooseManager: { applyWaveStarted: vi.fn(), applyCleared: vi.fn(), applyState: vi.fn(), registerRemoteHit: vi.fn(), applyRemoteSpawn: vi.fn(), applyExplosion: vi.fn() },
    squad: { teammateFell: vi.fn(), teammateStoodUp: vi.fn(), adoptFallen: vi.fn(), receiveRevive: vi.fn(), receivePing: vi.fn() },
    hordeWaveStarted: vi.fn(),
    gooseAnnouncement: { show: vi.fn() },
    checkHordeAllEliminated: vi.fn(),
    killFeed: { show: vi.fn() },
    weaponManager: { activeWeaponId: 'rifle', replaceActiveWeapon: vi.fn(async () => {}) },
    healLocalPlayerToFull: vi.fn(),
    endLostHordeRun: vi.fn(),
    addMultiplayerOpponent: vi.fn(async () => {}),
    removeMultiplayerOpponent: vi.fn(),
    opponentInMatch: vi.fn(),
    noteSnapshotApplied: vi.fn(),
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
  it('turns a remote Dusk torch off when its next snapshot leaves underground', () => {
    const ctx = makeContext({ map: 'valley' });
    const setTorch = vi.fn();
    ctx.multiplayer.opponents.set(2, {
      lastMessageAt: 0, firstSnapshotAt: null, isDead: false, health: 100,
      remotePlayer: { applySnapshot: vi.fn(), setLookPitch: vi.fn(), setTorch, setHeldWeapon: vi.fn() },
    });
    registerUndergroundVolume({ minX: 10, maxX: 20, minZ: 10, maxZ: 20, floorY: -9, ceilY: -3 });
    try {
      for (const [y, allowed] of [[-7, true], [20, false]] as const) {
        route(ctx, { type: 'playerSnapshot', senderSlot: 2, x: 15, y, z: 15, yaw: 0, pitch: 0, health: 100, torch: true }, 2);
        expect(setTorch).toHaveBeenLastCalledWith(allowed);
      }
    } finally { clearUnderground(); }
  });

  it('shows the weapon and skin a snapshot names in that player\'s hand', () => {
    const ctx = makeContext({ map: 'valley' });
    const setHeldWeapon = vi.fn();
    ctx.multiplayer.opponents.set(2, {
      lastMessageAt: 0, firstSnapshotAt: null, isDead: false, health: 100,
      remotePlayer: { applySnapshot: vi.fn(), setLookPitch: vi.fn(), setTorch: vi.fn(), setHeldWeapon },
    });
    route(ctx, { type: 'playerSnapshot', senderSlot: 2, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100, w: 'revolver', k: 'gilded' }, 2);
    expect(setHeldWeapon).toHaveBeenLastCalledWith('revolver', 'gilded');
    // An older build names neither: the player is drawn empty-handed.
    route(ctx, { type: 'playerSnapshot', senderSlot: 2, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100 }, 2);
    expect(setHeldWeapon).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it('the host relays through relay(), which skips directly linked guest pairs', () => {
    const ctx = makeContext({ role: 'host', ownSlot: 0 });
    route(ctx, { type: 'playerSnapshot', senderSlot: 2, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100 }, 2);
    expect(ctx.multiplayer.session.connection.relay).toHaveBeenCalledWith(expect.objectContaining({ type: 'playerSnapshot' }), 2);
  });

  it('a guest takes the King of the Hill state from its host, and the host ignores one sent to it', () => {
    const state = { type: 'kothState', hill: [0, 0], next: [40, 0], radius: 8, moveIn: 30, hold: 'held', holder: 1, crown: 1, crownAt: null, push: false, teams: false, scores: [{ slot: 0, score: 4 }, { slot: 1, score: 9 }] } as const;
    const guest = makeContext({ gameMode: 'kingOfTheHill' });
    route(guest, state as unknown as NetworkMessage);
    expect(guest.kingOfTheHill.receiveState).toHaveBeenCalledWith(expect.objectContaining({ type: 'kothState', crown: 1 }));
    const host = makeContext({ role: 'host', ownSlot: 0, gameMode: 'kingOfTheHill' });
    route(host, state as unknown as NetworkMessage, 2);
    expect(host.kingOfTheHill.receiveState).not.toHaveBeenCalled();
    expect(host.multiplayer.session.connection.relay).not.toHaveBeenCalled();
  });

  it('a crown claim reaches the host as the link it came in on, is never relayed and means nothing to a guest', () => {
    const host = makeContext({ role: 'host', ownSlot: 0, gameMode: 'kingOfTheHill' });
    route(host, { type: 'kothCrownClaim' }, 3);
    expect(host.kingOfTheHill.receiveClaim).toHaveBeenCalledWith(3);
    expect(host.multiplayer.session.connection.relay).not.toHaveBeenCalled();
    const guest = makeContext({ gameMode: 'kingOfTheHill' });
    route(guest, { type: 'kothCrownClaim' });
    expect(guest.kingOfTheHill.receiveClaim).not.toHaveBeenCalled();
  });

  it('a death tells King of the Hill where the victim fell, so the host can drop the crown there', () => {
    const ctx = makeContext({ gameMode: 'kingOfTheHill' });
    const position = { x: 7, y: 1, z: -3 };
    ctx.multiplayer.opponents.set(2, { lastMessageAt: 0, isDead: false, remotePlayer: { position, stopPrediction: vi.fn() } });
    route(ctx, { type: 'playerDied', senderSlot: 2, victimSlot: 2, killerSlot: 0 });
    expect(ctx.kingOfTheHill.playerDown).toHaveBeenCalledWith(2, position);
    // The kill clears the hill but scores nothing: the mode is won on the hill.
    expect(ctx.scoreboard.get(0) ?? 0).toBe(0);
    expect(ctx.deathCounts.get(2)).toBe(1);
  });

  it('the retired carry messages of the old King of the Hill change nothing and are not relayed', () => {
    const ctx = makeContext({ role: 'host', ownSlot: 0, gameMode: 'kingOfTheHill' });
    ctx.scoreboard.set(2, 30);
    route(ctx, { type: 'kothScoreTick', senderSlot: 2, score: 31 }, 2);
    route(ctx, { type: 'goldenGoosePickedUp', senderSlot: 2 }, 2);
    route(ctx, { type: 'goldenGooseDropped', senderSlot: 2, x: 1, y: 2, z: 3 }, 2);
    expect(ctx.scoreboard.get(2)).toBe(30);
    expect(ctx.multiplayer.session.connection.relay).not.toHaveBeenCalled();
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
      remotePlayer: { applySnapshot: vi.fn(), setLookPitch: vi.fn(), setTorch: vi.fn(), setHeldWeapon: vi.fn() },
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

  it('reports each applied playerSnapshot to the telemetry hook, and a stale one not at all', () => {
    const ctx = makeContext({ role: 'guest', ownSlot: 1 });
    const opponent = {
      lastMessageAt: 0,
      firstSnapshotAt: null as number | null,
      isDead: false,
      health: 100,
      remotePlayer: { applySnapshot: vi.fn(), setLookPitch: vi.fn(), setTorch: vi.fn(), setHeldWeapon: vi.fn() },
    };
    ctx.multiplayer.opponents.set(2, opponent);
    route(ctx, { type: 'playerSnapshot', senderSlot: 2, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100, t: 500 }, 0);
    expect(ctx.noteSnapshotApplied).toHaveBeenCalledTimes(1);
    expect(ctx.noteSnapshotApplied).toHaveBeenCalledWith(2, expect.any(Number));
    // Older than what is shown already: dropped before it is applied, so it is no telemetry sample either.
    route(ctx, { type: 'playerSnapshot', senderSlot: 2, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100, t: 400 }, 0);
    expect(ctx.noteSnapshotApplied).toHaveBeenCalledTimes(1);
  });

  it.each(['valley', 'facility'])("an opponent's snapshot on the %s cues the lamp and door catch-up", (map) => {
    const ctx = makeContext({ role: 'host', ownSlot: 0, map });
    ctx.multiplayer.opponents.set(2, {
      lastMessageAt: 0, firstSnapshotAt: null, isDead: false, health: 100,
      remotePlayer: { applySnapshot: vi.fn(), setLookPitch: vi.fn(), setTorch: vi.fn(), setHeldWeapon: vi.fn() },
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

  it('Goose Horde: a fall, a stand-up, a revive and a ping reach the squad layer', () => {
    const ctx = makeContext({ gameMode: 'gooseHorde', ownSlot: 1 });
    ctx.multiplayer.opponents.set(2, {
      lastMessageAt: 0, firstSnapshotAt: null, isDead: true, health: 0, lastStateSentAt: undefined,
      remotePlayer: { teleportTo: vi.fn() },
    });
    route(ctx, { type: 'hordePlayerEliminated', slot: 2 }, 2);
    expect([...ctx.multiplayer.hordeEliminatedSlots]).toEqual([2]);
    expect(ctx.squad.teammateFell).toHaveBeenCalledWith(2);
    expect(ctx.checkHordeAllEliminated).toHaveBeenCalledTimes(1);

    route(ctx, { type: 'reviveEvent', senderSlot: 3, targetSlot: 2 }, 0);
    expect(ctx.squad.receiveRevive).toHaveBeenCalledWith(3, 2);

    // The fallen player's own respawnEvent is what takes it off the list.
    route(ctx, { type: 'respawnEvent', senderSlot: 2, x: 1, y: 2, z: 3 }, 0);
    expect([...ctx.multiplayer.hordeEliminatedSlots]).toEqual([]);
    expect(ctx.squad.teammateStoodUp).toHaveBeenCalledWith(2);

    route(ctx, { type: 'ping', senderSlot: 3, x: 4, y: 5, z: 6 }, 0);
    expect(ctx.squad.receivePing).toHaveBeenCalledWith(3, 4, 5, 6);
  });

  it('Goose Horde: a guest takes the host\'s state, a wave start stands the fallen up, and the host takes a hit with its damage', () => {
    const guest = makeContext({ gameMode: 'gooseHorde', ownSlot: 1 });
    const state = { type: 'hordeState' as const, wave: 6, phase: 'active' as const, nextIn: 0, left: 5, meter: 1, need: 18, boss: { id: 'mother' as const, hp: 10, max: 2250 }, kills: [{ slot: 1 as PlayerSlot, kills: 3 }] };
    route(guest, state);
    expect(guest.hordeGooseManager.applyState).toHaveBeenCalledWith(state);
    route(guest, { type: 'hordeWaveStarted', wave: 7 });
    expect(guest.hordeGooseManager.applyWaveStarted).toHaveBeenCalledWith(7);
    expect(guest.hordeWaveStarted).toHaveBeenCalledTimes(1);
    route(guest, { type: 'hordeGooseSpawned', id: 'horde-9', x: 1, y: 2, z: 3, flavor: 'boss', boss: 'matriarch' });
    expect(guest.hordeGooseManager.applyRemoteSpawn).toHaveBeenCalledWith('horde-9', 1, 2, 3, 'boss', 'matriarch');
    route(guest, { type: 'hordeGooseExploded', id: 'horde-9', x: 1, y: 2, z: 3, stomp: true });
    expect(guest.hordeGooseManager.applyExplosion).toHaveBeenCalledWith('horde-9', expect.anything(), true);

    const host = makeContext({ role: 'host', gameMode: 'gooseHorde', ownSlot: 0 });
    route(host, state, 2);
    expect(host.hordeGooseManager.applyState).not.toHaveBeenCalled();
    route(host, { type: 'hordeGooseHitEvent', senderSlot: 2, id: 'horde-9', damage: 55 }, 2);
    expect(host.hordeGooseManager.registerRemoteHit).toHaveBeenCalledWith('horde-9', 2, 55);
  });

  it('bounds the new Goose Horde and co-op messages', () => {
    const state = { type: 'hordeState', wave: 3, phase: 'intermission', nextIn: 6.5, left: 0, meter: 4, need: 14, boss: null, kills: [{ slot: 0, kills: 20 }] };
    expect(isNetworkMessage(state)).toBe(true);
    expect(isNetworkMessage({ ...state, boss: { id: 'mother', hp: 5, max: 1500 } })).toBe(true);
    for (const bad of [
      { ...state, wave: 0 }, { ...state, phase: 'won' }, { ...state, nextIn: -1 }, { ...state, nextIn: Number.NaN }, { ...state, left: 1e9 },
      { ...state, meter: 1.5 }, { ...state, boss: { id: 'goose', hp: 5, max: 10 } }, { ...state, boss: { id: 'mother', hp: 50, max: 10 } },
      { ...state, kills: [{ slot: 7, kills: 1 }] }, { ...state, kills: [{ slot: 0, kills: -1 }] }, { ...state, kills: 'x' },
    ]) expect(isNetworkMessage(bad), JSON.stringify(bad)).toBe(false);

    expect(isNetworkMessage({ type: 'hordeGooseSpawned', id: 'horde-1', x: 0, y: 1, z: 2, flavor: 'brute' })).toBe(true);
    expect(isNetworkMessage({ type: 'hordeGooseSpawned', id: 'horde-1', x: 0, y: 1, z: 2, flavor: 'dragon' })).toBe(false);
    expect(isNetworkMessage({ type: 'hordeGooseSpawned', id: 'horde-1', x: 0, y: 1e9, z: 2, flavor: 'walker' })).toBe(false);
    expect(isNetworkMessage({ type: 'hordeGooseSpawned', id: 'horde-1', x: 0, y: 1, z: 2, flavor: 'boss', boss: 'king' })).toBe(false);
    expect(isNetworkMessage({ type: 'hordeGooseHitEvent', senderSlot: 1, id: 'horde-1' })).toBe(true);
    expect(isNetworkMessage({ type: 'hordeGooseHitEvent', senderSlot: 1, id: 'horde-1', damage: 1e9 })).toBe(false);
    expect(isNetworkMessage({ type: 'hordeGooseHitEvent', senderSlot: 1, id: 'horde-1', damage: Number.NaN })).toBe(false);
    expect(isNetworkMessage({ type: 'reviveEvent', senderSlot: 1, targetSlot: 2 })).toBe(true);
    expect(isNetworkMessage({ type: 'reviveEvent', senderSlot: 1, targetSlot: 9 })).toBe(false);
    expect(isNetworkMessage({ type: 'ping', senderSlot: 1, x: 1, y: 2, z: 3 })).toBe(true);
    expect(isNetworkMessage({ type: 'ping', senderSlot: 1, x: 1, y: Number.POSITIVE_INFINITY, z: 3 })).toBe(false);
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
    const kothState: KothStateMessage = { type: 'kothState', hill: [0, 0], next: [40, 0], radius: 8, moveIn: 30, hold: 'held', holder: 1, crown: 1, crownAt: null, push: false, teams: false, scores: [{ slot: 0, score: 4 }, { slot: 1, score: 9 }] };
    const multiplayer = { ...base.multiplayer, hostRoster };
    multiplayer.hordeEliminatedSlots.add(2);
    const hordeState = { wave: 4, phase: 'active' as const, nextIn: 0, left: 7, meter: 2, need: 18, boss: null, kills: [{ slot: 0 as PlayerSlot, kills: 12 }] };
    const horde = { currentWave: 4, isCleared: false, listForSync: vi.fn(() => []), statePayload: vi.fn(() => hordeState), applyWaveStarted: vi.fn(), applyCleared: vi.fn() };
    const verdict = { winnerSlot: 1 as PlayerSlot, scoreboard: [{ slot: 1 as PlayerSlot, score: 10 }] };
    const ctx = {
      ...base,
      multiplayer,
      gooseManager: { listForSync: vi.fn(() => [{ id: 'g1', x: 1, y: 0, z: 2, killerSlot: null }]) },
      hordeGooseManager: gameMode === 'gooseHorde' ? horde : null,
      kingOfTheHill: { ...base.kingOfTheHill, syncMessage: vi.fn(() => (gameMode === 'kingOfTheHill' ? kothState : null)) },
      bonusGooseManager: null,
      ammoDropManager: null,
      matchHasEnded: vi.fn(() => false),
      endedMatchVerdict: vi.fn<() => typeof verdict | null>(() => null),
    };
    ctx.thrownGeese.set('t9', new ThrownGoose('t9', 1, 'gooseLauncher', new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6)));
    const expected = (verdictOverride: typeof verdict | null = null) =>
      buildMatchSync({
        roster: hostRoster.connectedRoster(),
        koth: gameMode === 'kingOfTheHill' ? kothState : null,
        geese: ctx.gooseManager.listForSync(),
        horde: gameMode === 'gooseHorde' ? { wave: 4, eliminated: [2], result: undefined, state: hordeState, geese: [] } : null,
        ammoDrops: [],
        bonusGeese: [],
        thrownGeese: ctx.thrownGeese.values(),
        scoreboard: ctx.scoreboard,
        deathCounts: ctx.deathCounts,
        verdict: verdictOverride,
      });
    return { ctx, expected, verdict, kothState };
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

  it('includes the hill, crown and scores in King of the Hill and the result once the match has ended', () => {
    const { ctx, expected, verdict, kothState } = hostContext('kingOfTheHill');
    ctx.endedMatchVerdict.mockReturnValue(verdict);
    route(ctx, { type: 'gooseSyncRequest', senderSlot: 3 }, 3);
    const messages = sentMessages(ctx);
    expect(messages).toEqual(expected(verdict));
    expect(messages).toContainEqual(kothState);
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
