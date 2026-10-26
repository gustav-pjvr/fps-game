import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GoldenGooseManager } from '../../entities/GoldenGooseManager.ts';
import type { InputManager } from '../../input/InputManager.ts';
import type { MultiplayerMatchState } from '../../network/MultiplayerMatchState.ts';
import type { MultiplayerSession } from '../../network/MultiplayerSession.ts';
import type { PlayerSlot } from '../../network/protocol.ts';
import { GOOSE_PICKUP_RADIUS, KOTH_POINT_INTERVAL_SECONDS } from '../config.ts';
import { acceptsGoldenGooseClaim, acceptsGoldenGooseDrop, KingOfTheHillController } from './KingOfTheHillController.ts';

describe('acceptsGoldenGooseClaim', () => {
  it('takes a free goose from anyone', () => {
    for (const claimant of [0, 1, 2, 3] as PlayerSlot[]) expect(acceptsGoldenGooseClaim(null, claimant)).toBe(true);
  });

  it('displaces a carrier only with a lower slot, so every client settles on the lowest claimant', () => {
    expect(acceptsGoldenGooseClaim(2, 1)).toBe(true);
    expect(acceptsGoldenGooseClaim(2, 0)).toBe(true);
    expect(acceptsGoldenGooseClaim(2, 3)).toBe(false);
  });

  it('ignores a repeated claim from the carrier itself', () => {
    expect(acceptsGoldenGooseClaim(2, 2)).toBe(false);
  });
});

describe('acceptsGoldenGooseDrop', () => {
  it('counts a drop only from the carrier this client knows', () => {
    expect(acceptsGoldenGooseDrop(1, 1)).toBe(true);
    expect(acceptsGoldenGooseDrop(1, 3)).toBe(false); // a claimant that lost the tie-break
    expect(acceptsGoldenGooseDrop(null, 1)).toBe(false); // nobody carries it
  });
});

describe('KingOfTheHillController', () => {
  function setup(ownSlot: PlayerSlot = 1) {
    const goose = new GoldenGooseManager({ add: vi.fn() } as unknown as THREE.Scene, new THREE.Vector3(0, 0, 0));
    const send = vi.fn();
    const session = { ownSlot, connection: { send } } as unknown as MultiplayerSession;
    const matchState = { scoreboard: new Map<PlayerSlot, number>() } as unknown as MultiplayerMatchState;
    const controller = new KingOfTheHillController(goose, session, matchState);
    const pressed = new Set<string>();
    const input = { consumeJustPressed: (action: string) => pressed.delete(action) } as unknown as InputManager;
    return { goose, send, matchState, controller, pressed, input };
  }

  it('claims the goose in reach on interact and tells everyone', () => {
    const { goose, send, controller, pressed, input } = setup(2);
    pressed.add('interact');
    controller.update(0.016, new THREE.Vector3(GOOSE_PICKUP_RADIUS - 0.1, 0, 0), input);
    expect(goose.carrierSlot).toBe(2);
    expect(send).toHaveBeenCalledWith({ type: 'goldenGoosePickedUp', senderSlot: 2 });
  });

  it('does not claim out of reach, or a goose someone else holds', () => {
    const { goose, send, controller, pressed, input } = setup(2);
    pressed.add('interact');
    controller.update(0.016, new THREE.Vector3(GOOSE_PICKUP_RADIUS + 1, 0, 0), input);
    expect(goose.isHeld).toBe(false);

    goose.claim(3);
    pressed.add('interact');
    controller.update(0.016, new THREE.Vector3(0, 0, 0), input);
    expect(goose.carrierSlot).toBe(3);
    expect(send).not.toHaveBeenCalled();
  });

  it('scores a point per interval of carrying and broadcasts the new total', () => {
    const { goose, send, matchState, controller, input } = setup(1);
    goose.claim(1);
    controller.update(KOTH_POINT_INTERVAL_SECONDS * 0.6, new THREE.Vector3(), input);
    expect(send).not.toHaveBeenCalled();
    controller.update(KOTH_POINT_INTERVAL_SECONDS * 0.6, new THREE.Vector3(), input);
    expect(matchState.scoreboard.get(1)).toBe(1);
    expect(send).toHaveBeenCalledWith({ type: 'kothScoreTick', senderSlot: 1, score: 1 });
  });

  it('drops on fire at the carrier position, broadcasts the drop and restarts the hold clock', () => {
    const { goose, send, controller, pressed, input } = setup(1);
    goose.claim(1);
    controller.update(KOTH_POINT_INTERVAL_SECONDS * 0.9, new THREE.Vector3(), input);
    pressed.add('fire');
    controller.update(0.016, new THREE.Vector3(4, 0, 5), input);
    expect(goose.carrierSlot).toBeNull();
    expect(goose.position.x).toBe(4);
    expect(send).toHaveBeenCalledWith({ type: 'goldenGooseDropped', senderSlot: 1, x: 4, y: 0, z: 5 });

    // Picked up again: the earlier 0.9 s must not count toward the next point.
    send.mockClear();
    goose.claim(1);
    controller.update(KOTH_POINT_INTERVAL_SECONDS * 0.5, new THREE.Vector3(), input);
    expect(send).not.toHaveBeenCalled();
  });

  it('dropIfCarrying drops and broadcasts only for the carrier', () => {
    const { goose, send, controller } = setup(1);
    goose.claim(1);
    controller.dropIfCarrying(2, new THREE.Vector3(1, 0, 1));
    expect(goose.carrierSlot).toBe(1);
    expect(send).not.toHaveBeenCalled();
    controller.dropIfCarrying(1, new THREE.Vector3(1, 0, 1));
    expect(goose.carrierSlot).toBeNull();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'goldenGooseDropped', senderSlot: 1 }));
  });

  it('dropLocallyIfCarrying frees the goose of a departed carrier without broadcasting', () => {
    const { goose, send, controller } = setup(1);
    goose.claim(3);
    controller.dropLocallyIfCarrying(2, new THREE.Vector3(7, 0, 7));
    expect(goose.carrierSlot).toBe(3);
    controller.dropLocallyIfCarrying(3, new THREE.Vector3(7, 0, 7));
    expect(goose.carrierSlot).toBeNull();
    expect(goose.position.x).toBe(7);
    expect(send).not.toHaveBeenCalled();
  });
});
