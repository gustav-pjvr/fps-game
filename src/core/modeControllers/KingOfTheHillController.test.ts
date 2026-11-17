import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { isNetworkMessage, type KothStateMessage, type NetworkMessage, type PlayerSlot } from '../../network/protocol.ts';
import { KOTH_STATE_SEND_INTERVAL } from '../config.ts';
import type { HillPlayer, HillSite } from './hillState.ts';
import { KingOfTheHillController, type KingOfTheHillDeps } from './KingOfTheHillController.ts';

const SITES: HillSite[] = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 0, z: 40 }];

/** A controller with fakes for everything it touches. `players` is what the rules see; the tests
 * move them by editing the array. */
function make(role: 'host' | 'guest', ownSlot: PlayerSlot, players: HillPlayer[], teams = false) {
  const sent: NetworkMessage[] = [];
  const scoreboard = new Map<PlayerSlot, number>();
  const pressed = { interact: false };
  const deps = {
    session: { role, ownSlot, connection: { send: (message: NetworkMessage) => sent.push(message) } },
    matchState: { scoreboard },
    view: { update: vi.fn(), hillPosition: (_site: HillSite, out: THREE.Vector3) => out, crownPosition: () => null, dispose: vi.fn() },
    hud: { set: vi.fn(), dispose: vi.fn() },
    markers: { set: vi.fn(), remove: vi.fn() },
    players: () => players,
    usernames: new Map<PlayerSlot, string>([[0, 'Host'], [1, 'Bob'], [2, 'Cara'], [3, 'Dee']]),
    announce: vi.fn(),
    notify: vi.fn(),
    cue: vi.fn(),
    setPrompt: vi.fn(),
    setSprintAllowed: vi.fn(),
  };
  const input = { consumeJustPressed: (action: string) => action === 'interact' && pressed.interact && !(pressed.interact = false) };
  const controller = new KingOfTheHillController(deps as unknown as KingOfTheHillDeps, role === 'host' ? SITES : null, () => 0, teams);
  const tick = (dt = 0.1) => {
    const own = players.find((player) => player.slot === ownSlot)!;
    controller.update(dt, input as never, new THREE.Vector3(own.x, 0, own.z), own.counts);
  };
  return { controller, deps, sent, scoreboard, pressed, tick };
}

const at = (slot: PlayerSlot, x: number, z: number, counts = true): HillPlayer => ({ slot, x, z, counts });
const states = (sent: NetworkMessage[]): KothStateMessage[] => sent.filter((message): message is KothStateMessage => message.type === 'kothState');

describe('KingOfTheHillController, host', () => {
  it('scores its own scoreboard from the rules and sends a state every client can accept', () => {
    const players = [at(0, 1, 1), at(1, 30, 30)];
    const { tick, scoreboard, sent } = make('host', 0, players);
    for (let i = 0; i < 31; i++) tick();
    expect(scoreboard.get(0)).toBe(3);
    expect(scoreboard.get(1)).toBe(0);
    const sentStates = states(sent);
    expect(sentStates.length).toBeGreaterThan(1);
    for (const state of sentStates) expect(isNetworkMessage(JSON.parse(JSON.stringify(state)))).toBe(true);
    expect(sentStates[sentStates.length - 1]).toMatchObject({ hold: 'held', holder: 0, hill: [0, 0], teams: false });
  });

  it('sends on a timer while nothing changes and at once when something does', () => {
    const players = [at(0, 30, 30), at(1, 30, 31)];
    const { tick, sent } = make('host', 0, players);
    tick(0.01);
    const first = states(sent).length;
    for (let i = 0; i < 5; i++) tick(0.01);
    expect(states(sent).length).toBe(first);
    // The other player walks onto the hill: the change goes out on that tick.
    players[1] = at(1, 0, 1);
    tick(0.01);
    expect(states(sent).length).toBe(first + 1);
    for (let t = 0; t < KOTH_STATE_SEND_INTERVAL + 0.02; t += 0.01) tick(0.01);
    expect(states(sent).length).toBeGreaterThan(first + 1);
  });

  it('gives the crown to the host on its own key, and to a guest on its claim, by reach', () => {
    const players = [at(0, 1, 0), at(1, 30, 30)];
    const { controller, tick, pressed, deps } = make('host', 0, players);
    tick();
    expect(deps.setPrompt).toHaveBeenLastCalledWith('TAKE THE CROWN');
    pressed.interact = true;
    tick();
    expect(controller.snapshot?.crown).toBe(0);
    expect(deps.setSprintAllowed).toHaveBeenLastCalledWith(false);
    // The host dies: the crown lies where it fell; a guest out of reach cannot take it, one in reach can.
    controller.playerDown(0, { x: 4, z: 4 });
    tick();
    expect(controller.snapshot).toMatchObject({ crown: null, crownAt: { x: 4, z: 4 } });
    expect(deps.setSprintAllowed).toHaveBeenLastCalledWith(true);
    controller.receiveClaim(1);
    expect(controller.snapshot?.crown).toBeNull();
    players[1] = at(1, 5, 5);
    controller.receiveClaim(1);
    tick();
    expect(controller.snapshot?.crown).toBe(1);
    expect(deps.notify).toHaveBeenCalledWith('Bob wears the crown');
  });

  it('answers a late joiner with the whole state', () => {
    const players = [at(0, 1, 1), at(1, 30, 30)];
    const { controller, tick } = make('host', 0, players);
    for (let i = 0; i < 12; i++) tick();
    const sync = controller.syncMessage()!;
    expect(sync).toMatchObject({ type: 'kothState', hold: 'held', holder: 0, scores: [{ slot: 0, score: 1 }, { slot: 1, score: 0 }] });
    expect(isNetworkMessage(JSON.parse(JSON.stringify(sync)))).toBe(true);
  });
});

describe('KingOfTheHillController, guest', () => {
  const state: KothStateMessage = {
    type: 'kothState', hill: [0, 0], next: [40, 0], radius: 8, moveIn: 30, hold: 'held', holder: 0, crown: null, crownAt: [0, 0],
    push: false, teams: false, scores: [{ slot: 0, score: 7 }, { slot: 1, score: 2 }],
  };

  it('shows nothing until the host speaks, then follows the host for the hill, the crown and the score', () => {
    const players = [at(1, 20, 20)];
    const { controller, tick, scoreboard, deps, sent } = make('guest', 1, players);
    tick();
    expect(controller.snapshot).toBeNull();
    expect(deps.view.update).not.toHaveBeenCalled();
    controller.receiveState(state);
    tick();
    expect(scoreboard.get(0)).toBe(7);
    expect(scoreboard.get(1)).toBe(2);
    expect(deps.view.update).toHaveBeenLastCalledWith(0.1, expect.objectContaining({ hill: { x: 0, z: 0 } }), 'theirs');
    expect(deps.hud.set).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'theirs', status: 'Host holds the hill' }));
    // It never sends a state of its own.
    expect(states(sent)).toEqual([]);
  });

  it('asks the host for the crown instead of taking it', () => {
    const players = [at(1, 1, 0)];
    const { controller, tick, pressed, sent } = make('guest', 1, players);
    controller.receiveState(state);
    pressed.interact = true;
    tick();
    expect(sent).toContainEqual({ type: 'kothCrownClaim' });
    expect(controller.snapshot?.crown).toBeNull();
    controller.receiveState({ ...state, crown: 1, crownAt: null });
    tick();
    expect(controller.snapshot?.crown).toBe(1);
  });

  it('announces what changed between two states: the move, the push, who holds it', () => {
    const { controller, deps } = make('guest', 1, [at(1, 20, 20)]);
    controller.receiveState(state);
    controller.receiveState({ ...state, hill: [40, 0], next: [0, 40], crownAt: [40, 0], hold: 'empty', holder: null });
    expect(deps.announce).toHaveBeenCalledWith('THE HILL HAS MOVED');
    controller.receiveState({ ...state, hill: [40, 0], next: [0, 40], crownAt: [40, 0], hold: 'held', holder: 1, push: true });
    expect(deps.announce).toHaveBeenCalledWith('FINAL PUSH');
    expect(deps.cue).toHaveBeenCalledWith('gain');
  });

  it('counts a teammate as its own side in a two against two, for the hill and for the win', () => {
    const { controller, tick, deps } = make('guest', 1, [at(1, 20, 20)], true);
    controller.receiveState({ ...state, teams: true, holder: 1, hold: 'held' });
    tick();
    expect(deps.hud.set).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'ours', status: 'Your team holds the hill' }));
    expect(controller.isTeammate(3)).toBe(true);
    expect(controller.isTeammate(0)).toBe(false);
    expect(controller.sharesVictory(3)).toBe(true);
    expect(controller.sharesVictory(2)).toBe(false);
  });
});
