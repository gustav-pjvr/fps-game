import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { InputManager } from '../../input/InputManager.ts';
import type { PlayerSlot } from '../../network/protocol.ts';
import { REVIVE_RULES } from './reviveRules.ts';
import { PING_RULES, SquadController, type SquadDeps } from './SquadController.ts';

/** A squad of three (this player is slot 1) with fakes for everything the controller touches. */
function makeSquad(overrides: Partial<SquadDeps> = {}) {
  const send = vi.fn();
  const positions = new Map<PlayerSlot, THREE.Vector3>([[0, new THREE.Vector3(1, 0, 1)], [2, new THREE.Vector3(40, 0, 0)]]);
  const pressed = new Set<string>();
  const held = new Set<string>();
  const input = {
    consumeJustPressed: (action: string) => pressed.delete(action),
    isActionActive: (action: string) => held.has(action),
  } as unknown as InputManager;
  const deps = {
    session: { ownSlot: 1 as PlayerSlot, role: 'guest', connection: { send } },
    usernames: new Map<PlayerSlot, string>([[0, 'Ann'], [1, 'Me'], [2, 'Cy']]),
    markers: { set: vi.fn(), remove: vi.fn() },
    downed: { showDown: vi.fn(), showOut: vi.fn(), setBleed: vi.fn(), hide: vi.fn(), dispose: vi.fn() },
    revives: true,
    isTeammate: () => true,
    positionOf: (slot: PlayerSlot) => positions.get(slot) ?? null,
    aimPoint: () => new THREE.Vector3(5, 6, 7),
    setPrompt: vi.fn(),
    notify: vi.fn(),
    cue: vi.fn(),
    setRowTag: vi.fn(),
    reviveOwn: vi.fn(),
    ...overrides,
  };
  const squad = new SquadController(deps as unknown as SquadDeps);
  const here = new THREE.Vector3(0, 0, 0);
  return { squad, deps, send, input, pressed, held, positions, tick: (dt = 0.1, alive = true) => squad.update(dt, input, here, alive) };
}

describe('SquadController, pings', () => {
  it('marks the aimed point, tells the squad, and takes the marker down after its time', () => {
    const { deps, send, pressed, tick } = makeSquad();
    pressed.add('ping');
    tick();
    expect(send).toHaveBeenCalledWith({ type: 'ping', senderSlot: 1, x: 5, y: 6, z: 7 });
    expect(deps.markers.set).toHaveBeenCalledWith('ping-1', expect.anything(), 'YOUR PING');
    tick(PING_RULES.seconds + 0.1);
    expect(deps.markers.remove).toHaveBeenCalledWith('ping-1');
  });

  it('does not ping at the sky, while fallen, twice inside the cooldown, or with no teammate to see it', () => {
    const sky = makeSquad({ aimPoint: () => null });
    sky.pressed.add('ping');
    sky.tick();
    expect(sky.send).not.toHaveBeenCalled();

    const fallen = makeSquad();
    fallen.pressed.add('ping');
    fallen.tick(0.1, false);
    expect(fallen.send).not.toHaveBeenCalled();
    // The press was consumed: it does not fire once the player stands up.
    fallen.tick(0.1, true);
    expect(fallen.send).not.toHaveBeenCalled();

    const twice = makeSquad();
    twice.pressed.add('ping');
    twice.tick(0.1);
    twice.pressed.add('ping');
    twice.tick(0.1);
    expect(twice.send).toHaveBeenCalledTimes(1);

    const alone = makeSquad({ isTeammate: () => false });
    alone.pressed.add('ping');
    alone.tick();
    expect(alone.send).not.toHaveBeenCalled();
  });

  it('shows a teammate\'s ping under their name and drops an enemy\'s', () => {
    const { squad, deps } = makeSquad({ isTeammate: (slot) => slot === 0 });
    squad.receivePing(0, 1, 2, 3);
    expect(deps.markers.set).toHaveBeenCalledWith('ping-0', expect.anything(), 'ANN');
    squad.receivePing(2, 1, 2, 3);
    expect(deps.markers.set).toHaveBeenCalledTimes(1);
  });
});

describe('SquadController, the fallen and their revives', () => {
  it('offers a fallen teammate in reach, and a full hold sends the revive', () => {
    const { squad, deps, send, held, tick } = makeSquad();
    squad.teammateFell(0);
    expect(deps.notify).toHaveBeenCalledWith('ANN is down');
    tick();
    expect(deps.setPrompt).toHaveBeenLastCalledWith('HOLD TO REVIVE ANN');
    expect(deps.markers.set).toHaveBeenCalledWith('down-0', expect.anything(), 'REVIVE ANN');
    expect(deps.setRowTag).toHaveBeenLastCalledWith(0, `DOWN ${Math.ceil(REVIVE_RULES.bleedOut - 0.1)}`);

    held.add('interact');
    tick(REVIVE_RULES.hold - 0.2);
    expect(send).not.toHaveBeenCalled();
    tick(0.3);
    expect(send).toHaveBeenCalledWith({ type: 'reviveEvent', senderSlot: 1, targetSlot: 0 });

    // The teammate's own respawn takes it off the list.
    squad.teammateStoodUp(0);
    expect(deps.markers.remove).toHaveBeenCalledWith('down-0');
    expect(deps.setRowTag).toHaveBeenLastCalledWith(0, null);
    tick();
    expect(deps.setPrompt).toHaveBeenLastCalledWith(null);
  });

  it('shows a teammate out once their time has run down, with no marker to revive them', () => {
    const { squad, deps, tick } = makeSquad();
    squad.teammateFell(0);
    tick(REVIVE_RULES.bleedOut + 1);
    expect(deps.setRowTag).toHaveBeenLastCalledWith(0, 'OUT');
    expect(deps.markers.remove).toHaveBeenCalledWith('down-0');
  });

  it('goes down, then out, and stands up only on a revive that reaches it in time', () => {
    const { squad, deps, tick } = makeSquad();
    squad.ownFell();
    expect(squad.ownState).toBe('down');
    expect(deps.downed.showDown).toHaveBeenCalledTimes(1);
    expect(squad.fallenSlots).toEqual([1]);

    // A revive of someone else is only a line in the feed.
    squad.receiveRevive(0, 2);
    expect(deps.reviveOwn).not.toHaveBeenCalled();
    squad.receiveRevive(0, 1);
    expect(deps.reviveOwn).toHaveBeenCalledWith(REVIVE_RULES.health);
    squad.ownStoodUp();
    expect(squad.ownState).toBe('up');
    expect(deps.downed.hide).toHaveBeenCalledTimes(1);

    squad.ownFell();
    tick(REVIVE_RULES.bleedOut + 1, false);
    expect(squad.ownState).toBe('out');
    expect(deps.downed.showOut).toHaveBeenCalledTimes(1);
    // Too late: an out player waits for its mode to bring it back.
    squad.receiveRevive(0, 1);
    expect(deps.reviveOwn).toHaveBeenCalledTimes(1);
  });

  it('has no fallen in a mode without revives', () => {
    const { squad, deps, tick } = makeSquad({ revives: false });
    squad.ownFell();
    squad.teammateFell(0);
    tick();
    expect(squad.ownState).toBe('up');
    expect(squad.fallenSlots).toEqual([]);
    expect(deps.setPrompt).not.toHaveBeenCalled();
  });

  it('adopts the fallen a late joiner is told of, and forgets a player who leaves', () => {
    const { squad, deps } = makeSquad();
    squad.adoptFallen([0, 1]);
    expect(squad.fallenSlots).toEqual([0]);
    squad.receivePing(0, 1, 2, 3);
    squad.forget(0);
    expect(squad.fallenSlots).toEqual([]);
    expect(deps.markers.remove).toHaveBeenCalledWith('ping-0');
  });
});
