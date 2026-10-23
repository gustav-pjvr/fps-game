import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { RemotePlayer } from './RemotePlayer.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { PLAYER_HIT_SHAPE } from './characterHitbox.ts';
import { HEADSHOT_MULTIPLIER, PLAYER_HEIGHT } from '../core/config.ts';
import type { Damageable } from '../combat/damage.ts';

// The shot path WeaponManager takes against another player in multiplayer: a ray, the collider's
// entity, then takeDamage with that collider's handle. What reaches onHit is what the damageEvent
// carries to the victim.

type RemotePlayerConstructor = new (
  physics: PhysicsWorld,
  scene: THREE.Scene,
  initialPosition: THREE.Vector3,
  model: THREE.Group,
  mixer: THREE.AnimationMixer,
  idleAction: THREE.AnimationAction | undefined,
  walkAction: THREE.AnimationAction | undefined,
  onHit: (amount: number) => void,
) => RemotePlayer;

async function remoteAtOrigin(): Promise<{ physics: PhysicsWorld; sent: number[] }> {
  const physics = await PhysicsWorld.create();
  const sent: number[] = [];
  const model = new THREE.Group();
  const Construct = RemotePlayer as unknown as RemotePlayerConstructor;
  const remote = new Construct(physics, new THREE.Scene(), new THREE.Vector3(0, PLAYER_HEIGHT / 2, 0), model, new THREE.AnimationMixer(model), undefined, undefined, (amount) => sent.push(amount));
  remote.update(1 / 60);
  physics.step(1 / 60);
  return { physics, sent };
}

function fire(physics: PhysicsWorld, height: number, from: { x: number; z: number }, dir: { x: number; z: number }, damage: number): boolean {
  const hit = physics.world.castRay(new RAPIER.Ray({ x: from.x, y: height, z: from.z }, { x: dir.x, y: 0, z: dir.z }), 20, true);
  if (!hit) return false;
  const target = physics.getEntity(hit.collider.handle) as unknown as Damageable | undefined;
  target?.takeDamage(damage, hit.collider.handle);
  return target !== undefined;
}

describe('RemotePlayer hits', () => {
  it('a helmet hit sends HEADSHOT_MULTIPLIER times the damage, a body hit the plain amount', async () => {
    const { physics, sent } = await remoteAtOrigin();
    expect(fire(physics, PLAYER_HIT_SHAPE.headHeight, { x: 5, z: PLAYER_HIT_SHAPE.headForward }, { x: -1, z: 0 }, 25)).toBe(true);
    expect(fire(physics, 1.0, { x: 0, z: 5 }, { x: 0, z: -1 }, 25)).toBe(true);
    expect(sent).toEqual([25 * HEADSHOT_MULTIPLIER, 25]);
    physics.dispose();
  });

  it('a shot 0.38 m beside the chest, inside the old 0.4 m capsule, misses', async () => {
    const { physics, sent } = await remoteAtOrigin();
    expect(fire(physics, 1.0, { x: 0.38, z: 5 }, { x: 0, z: -1 }, 25)).toBe(false);
    expect(sent).toEqual([]);
    physics.dispose();
  });
});
