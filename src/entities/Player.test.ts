import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Player } from './Player.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputManager } from '../input/InputManager.ts';
import { PLAYER_MOVE_SPEED } from '../core/config.ts';
import { Settings } from '../settings/Settings.ts';

describe('Player analog input', () => {
  it('moves half as far with a half stick and preserves normalized keyboard diagonals', async () => {
    for (const move of [{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: Math.SQRT1_2, y: -Math.SQRT1_2 }]) {
      const physics = await PhysicsWorld.create();
      try {
        const player = new Player(physics, new THREE.PerspectiveCamera(), new THREE.Vector3(0, 10, 0), { onDamaged: () => {}, onFootstep: () => {} });
        const input = { getMoveVector: () => move, consumeLookDelta: () => ({ dx: 0, dy: 0 }), isActionActive: () => false } as unknown as InputManager;
        player.update(1 / 60, input);
        physics.step(1 / 60);
        expect(Math.hypot(player.position.x, player.position.z)).toBeCloseTo(PLAYER_MOVE_SPEED / 60 * Math.hypot(move.x, move.y));
      } finally { physics.dispose(); }
    }
  });

  it('keeps the existing zoom ratio for controller look deltas', async () => {
    const physics = await PhysicsWorld.create();
    try {
      const camera = new THREE.PerspectiveCamera(Settings.getFov() / 2);
      const player = new Player(physics, camera, new THREE.Vector3(0, 10, 0), { onDamaged: () => {}, onFootstep: () => {} });
      const input = { getMoveVector: () => ({ x: 0, y: 0 }), consumeLookDelta: () => ({ dx: 10, dy: 0 }), isActionActive: () => false } as unknown as InputManager;
      player.update(1 / 60, input);
      const zoomYaw = player.facingYaw;
      camera.fov = Settings.getFov();
      player.update(1 / 60, input);
      expect(player.facingYaw - zoomYaw).toBeCloseTo(zoomYaw * 2);
    } finally { physics.dispose(); }
  });
});
