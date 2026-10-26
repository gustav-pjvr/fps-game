import { describe, expect, it, vi } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import { EYE_OFFSET, PLAYER_HEIGHT, PLAYER_RADIUS } from '../../core/config.ts';
import type { Player } from '../../entities/Player.ts';
import type { InputManager } from '../../input/InputManager.ts';
import type { SoundEngine } from '../../audio/SoundEngine.ts';
import type { Entity } from '../../entities/Entity.ts';
import type { NetworkMessage, PlayerSlot } from '../../network/protocol.ts';
import { GrenadeSystem, type GrenadeHandState, type GrenadeOpponent, type GrenadeTargets } from './GrenadeSystem.ts';
import { FRAG_MAX_DAMAGE, GRENADE_FUSE, GRENADE_ORPHAN_GRACE_SECONDS, GRENADE_MAX_COUNT, GRENADE_START_COUNT, type GrenadeKind } from './grenadeTuning.ts';

// GrenadeSystem against a real Rapier world: a floor slab, a player capsule, and optionally a wall.

const DT = 1 / 60;

interface Rig {
  physics: PhysicsWorld;
  scene: THREE.Scene;
  system: GrenadeSystem;
  player: { takeDamage: ReturnType<typeof vi.fn>; applyKnockback: ReturnType<typeof vi.fn>; isDead: boolean };
  camera: THREE.PerspectiveCamera;
  sent: NetworkMessage[];
  targets: { applyBlast: ReturnType<typeof vi.fn>; applyFlash: ReturnType<typeof vi.fn>; notifyGunshot: ReturnType<typeof vi.fn> };
  explosions: ReturnType<typeof vi.fn>;
  lamps: ReturnType<typeof vi.fn>;
  hand: GrenadeHandState[];
  opponents: GrenadeOpponent[];
  canStart: { value: boolean };
  sound: Record<'playFragExplosion' | 'playFlashBang' | 'playGrenadePin' | 'playGrenadeThrow' | 'playGrenadeBounce', ReturnType<typeof vi.fn>>;
  step(seconds: number, input?: InputManager | null): void;
}

function fixedCuboid(physics: PhysicsWorld, x: number, y: number, z: number, hx: number, hy: number, hz: number): RAPIER.Collider {
  return physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
}

/** A remote grenade from slot 1 thrown and gone off at `position` (a detonation needs its throw). */
function remoteDetonation(system: GrenadeSystem, id: string, kind: GrenadeKind, position: { x: number; y: number; z: number }): void {
  system.receiveThrown({ type: 'grenadeThrown', senderSlot: 1, id, kind, origin: position, velocity: { x: 0, y: 0, z: 0 }, fuseLeft: 5, t: 1 });
  system.receiveDetonated({ type: 'grenadeDetonated', senderSlot: 1, id, kind, position });
}
async function rig(options: { enabled?: boolean; kind?: GrenadeKind; network?: boolean; wallAt?: number; friendlyFire?: boolean } = {}): Promise<Rig> {
  const physics = await PhysicsWorld.create();
  // Floor: top surface at y = 0.
  fixedCuboid(physics, 0, -0.5, 0, 60, 0.5, 60);
  if (options.wallAt !== undefined) fixedCuboid(physics, 0, 1.5, options.wallAt, 10, 1.5, 0.1);

  const center = new THREE.Vector3(0, PLAYER_HEIGHT / 2, 0);
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z));
  const collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS), body);
  const player = {
    takeDamage: vi.fn(),
    applyKnockback: vi.fn(),
    isDead: false,
    facingYaw: 0,
    get position() {
      return center.clone();
    },
    get ownCollider() {
      return collider;
    },
  };
  physics.registerCollider(collider, player as unknown as Entity);

  // Looking down -z, level.
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, center.y + EYE_OFFSET, 0);
  const scene = new THREE.Scene();
  scene.add(camera);
  physics.world.step();

  const sent: NetworkMessage[] = [];
  const targets = { applyBlast: vi.fn(), applyFlash: vi.fn(() => 0), notifyGunshot: vi.fn() };
  const explosions = vi.fn();
  const lamps = vi.fn();
  const hand: GrenadeHandState[] = [];
  const opponents: GrenadeOpponent[] = [];
  const canStart = { value: true };
  const sound = {
    playFragExplosion: vi.fn(),
    playFlashBang: vi.fn(),
    playGrenadePin: vi.fn(),
    playGrenadeThrow: vi.fn(),
    playGrenadeBounce: vi.fn(),
  };
  const system = new GrenadeSystem({
    scene,
    physics,
    camera,
    player: player as unknown as Player,
    enabled: options.enabled ?? true,
    kind: options.kind ?? 'frag',
    sound: sound as unknown as SoundEngine,
    targets: targets as unknown as GrenadeTargets,
    network: options.network
      ? { ownSlot: 0 as PlayerSlot, send: (message) => sent.push(message), opponents: () => opponents }
      : null,
    friendlyFire: options.friendlyFire,
    canStartThrow: () => canStart.value,
    onHandChange: (state) => hand.push(state),
    shootLampsNear: lamps,
  });
  // What GrenadeEffects listens on to play the frag's explosion.
  system.addDetonationListener(explosions);
  return {
    physics,
    scene,
    system,
    player,
    camera,
    sent,
    targets,
    explosions,
    lamps,
    hand,
    opponents,
    canStart,
    sound,
    step(seconds, input = null) {
      for (let t = 0; t < seconds - 1e-9; t += DT) {
        physics.world.step();
        system.update(DT, input);
        system.tickEffects(DT);
      }
    },
  };
}

function fakeInput(held: { grenade?: boolean }): InputManager {
  return {
    isActionActive: (action: string) => Boolean(held[action as keyof typeof held]),
    consumeJustPressed: () => false,
  } as unknown as InputManager;
}

describe('GrenadeSystem flight', () => {
  it('flies, lands on the floor, comes to rest and goes off at its fuse', async () => {
    const r = await rig();
    const id = r.system.debugThrow({ x: 0, y: 0.5, z: -1 });
    expect(id).not.toBeNull();
    expect(r.system.count).toBe(GRENADE_START_COUNT - 1);
    r.step(GRENADE_FUSE.frag - 0.2);
    const [grenade] = r.system.liveGrenades();
    expect(grenade?.resting).toBe(true);
    expect(grenade!.position.y).toBeGreaterThan(0);
    expect(grenade!.position.y).toBeLessThan(0.2);
    expect(grenade!.position.z).toBeLessThan(-5);
    r.step(0.4);
    expect(r.system.liveGrenades()).toHaveLength(0);
    expect(r.explosions).toHaveBeenCalledTimes(1);
    const detonation = r.system.debugState().lastDetonation;
    expect(detonation?.kind).toBe('frag');
    // The floor it rested on, for the scorch and the dust ring.
    expect(detonation?.surface?.normal.y).toBeCloseTo(1, 3);
    expect(detonation?.surface?.point.y).toBeCloseTo(0, 2);
    expect(detonation?.surface?.point.z).toBeCloseTo(grenade!.position.z, 1);
  });

  it('finds the wall a frag went off against, and no surface in the air', async () => {
    const r = await rig({ network: true, wallAt: -3 });
    // Wall face at z = -2.9: a copy that goes off just in front of it, a metre up, and one in the air.
    const copy = (id: string, z: number) =>
      r.system.receiveThrown({ type: 'grenadeThrown', senderSlot: 1, id, kind: 'frag', origin: { x: 0, y: 1, z }, velocity: { x: 0, y: 0, z: 0 }, fuseLeft: 1, t: 1 });
    copy('wall', -2.75);
    copy('air', 6);
    r.system.receiveDetonated({ type: 'grenadeDetonated', senderSlot: 1, id: 'wall', kind: 'frag', position: { x: 0, y: 1, z: -2.75 } });
    const wall = r.system.debugState().lastDetonation!.surface!;
    expect(wall.normal.z).toBeCloseTo(1, 3);
    expect(wall.point.z).toBeCloseTo(-2.9, 2);
    r.system.receiveDetonated({ type: 'grenadeDetonated', senderSlot: 1, id: 'air', kind: 'frag', position: { x: 0, y: 3, z: 6 } });
    expect(r.system.debugState().lastDetonation!.surface).toBeNull();
  });

  it('keeps an own throw out of sight while the view-model hand still holds it', async () => {
    for (const kind of ['frag', 'flash'] as const) {
      const r = await rig({ kind });
      r.step(DT * 3, fakeInput({ grenade: true }));
      r.step(DT, fakeInput({}));
      const model = r.scene.getObjectByName(`grenade-${kind}`)!;
      expect(r.system.liveGrenades()).toHaveLength(1);
      expect(r.system.liveGrenades()[0]!.kind).toBe(kind);
      expect(model.visible).toBe(false);
      r.step(0.15);
      expect(model.visible).toBe(true);
      // A scripted throw has no hand to leave.
      r.system.debugThrow();
      expect(r.system.liveGrenades()).toHaveLength(2);
      expect(r.system.liveGrenades().every((g) => g.kind === kind)).toBe(true);
    }
  });

  it('whooshes on the throw, clinks on the bounces (not while settling) and bangs at the fuse', async () => {
    const r = await rig();
    r.system.debugThrow({ x: 0, y: 0.5, z: -1 });
    expect(r.sound.playGrenadeThrow).toHaveBeenCalledTimes(1);
    r.step(GRENADE_FUSE.frag + 0.1);
    const clinks = r.sound.playGrenadeBounce.mock.calls;
    expect(clinks.length).toBeGreaterThan(0);
    expect(clinks.length).toBeLessThan(12);
    for (const [volume] of clinks) expect(volume).toBeGreaterThan(0);
    expect(r.sound.playFragExplosion).toHaveBeenCalledTimes(1);
    const flash = await rig({ kind: 'flash' });
    flash.system.debugThrow();
    flash.step(GRENADE_FUSE.flash + 0.1);
    expect(flash.sound.playFlashBang).toHaveBeenCalledTimes(1);
  });

  it('bounces back off a wall instead of passing through it', async () => {
    const r = await rig({ kind: 'flash', wallAt: -4 });
    r.system.debugThrow({ x: 0, y: 0.1, z: -1 });
    r.step(1.2);
    const [grenade] = r.system.liveGrenades();
    expect(grenade!.position.z).toBeGreaterThan(-4);
  });
});

describe('GrenadeSystem frag', () => {
  it('shakes only the rendered camera position, never its aim, and never accumulates', async () => {
    const r = await rig();
    r.system.debugThrow({ x: 0, y: -1, z: 0 });
    r.step(GRENADE_FUSE.frag + DT);
    expect(r.system.cameraShake).toBeGreaterThan(0);
    const base = r.camera.position.clone();
    const aim = r.camera.quaternion.clone();
    let moved = 0;
    for (const t of [0.01, 0.02, 0.03, 0.04]) {
      // As Game.render: the interpolation rewrites the position, then the shake offsets it.
      r.camera.position.copy(base);
      r.system.applyCameraShake(r.camera, t);
      const offset = r.camera.position.distanceTo(base);
      expect(offset).toBeLessThanOrEqual(r.system.cameraShake * 1.2 + 1e-9);
      moved = Math.max(moved, offset);
      expect(r.camera.quaternion.equals(aim)).toBe(true);
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('damages and knocks back its own thrower in range, and damages opponents through damageEvent', async () => {
    const r = await rig({ network: true });
    const opponentCenter = new THREE.Vector3(0, PLAYER_HEIGHT / 2, -3);
    r.opponents.push({ slot: 1, position: opponentCenter, entity: {}, isDead: false });
    r.opponents.push({ slot: 2, position: new THREE.Vector3(0, PLAYER_HEIGHT / 2, -40), entity: {}, isDead: false });
    // Dropped at the feet.
    r.system.debugThrow({ x: 0, y: -1, z: 0 });
    r.step(GRENADE_FUSE.frag + DT);
    expect(r.player.takeDamage).toHaveBeenCalledTimes(1);
    expect(r.player.takeDamage.mock.calls[0]![0]).toBeGreaterThan(FRAG_MAX_DAMAGE * 0.5);
    expect(r.player.applyKnockback).toHaveBeenCalledTimes(1);
    const damage = r.sent.filter((m) => m.type === 'damageEvent');
    expect(damage).toHaveLength(1);
    expect(damage[0]).toMatchObject({ senderSlot: 0, targetSlot: 1, weaponId: 'frag' });
    expect(r.sent.map((m) => m.type)).toEqual(['grenadeThrown', 'damageEvent', 'grenadeDetonated']);
    expect(r.targets.applyBlast).toHaveBeenCalledTimes(1);
    expect(r.targets.notifyGunshot).toHaveBeenCalledWith(expect.anything(), 'frag');
    expect(r.lamps).toHaveBeenCalledWith(expect.anything(), 4);
    expect(r.system.cameraShake).toBeGreaterThan(0);
  });

  it('lights the blast with the one light made at the start, never a new one', async () => {
    const r = await rig();
    const lights = (): THREE.PointLight[] => r.scene.children.filter((child): child is THREE.PointLight => child instanceof THREE.PointLight);
    expect(lights()).toHaveLength(1);
    const [light] = lights();
    expect(light!.intensity).toBe(0);
    r.system.debugThrow({ x: 0, y: -1, z: 0 });
    r.step(GRENADE_FUSE.frag + DT);
    expect(lights()).toEqual([light]);
    expect(light!.intensity).toBeGreaterThan(0);
    // Warm, and lifted off the floor it went off on.
    expect(light!.color.r).toBeGreaterThan(light!.color.b);
    expect(light!.position.y).toBeGreaterThan(0.4);
    r.step(0.3);
    expect(light!.intensity).toBe(0);
  });

  it('never hurts a teammate in co-op (no friendly fire), still the thrower and the enemies', async () => {
    const r = await rig({ network: true, friendlyFire: false });
    r.opponents.push({ slot: 1, position: new THREE.Vector3(0, PLAYER_HEIGHT / 2, -2), entity: {}, isDead: false });
    r.system.debugThrow({ x: 0, y: -1, z: 0 });
    r.step(GRENADE_FUSE.frag + DT);
    expect(r.sent.filter((m) => m.type === 'damageEvent')).toHaveLength(0);
    expect(r.player.takeDamage).toHaveBeenCalledTimes(1);
    expect(r.targets.applyBlast).toHaveBeenCalledTimes(1);
  });

  it('is stopped by a wall between the blast and the target', async () => {
    const r = await rig({ network: true, wallAt: -2 });
    r.opponents.push({ slot: 1, position: new THREE.Vector3(0, PLAYER_HEIGHT / 2, -3.5), entity: {}, isDead: false });
    r.system.debugThrow({ x: 0, y: -1, z: 0 });
    r.step(GRENADE_FUSE.frag + DT);
    expect(r.sent.filter((m) => m.type === 'damageEvent')).toHaveLength(0);
  });
});

describe('GrenadeSystem flash', () => {
  it('whites out a player looking at it and asks the enemies to judge it', async () => {
    const r = await rig({ kind: 'flash' });
    r.system.debugThrow({ x: 0, y: -0.5, z: -1 });
    r.step(GRENADE_FUSE.flash - 0.1);
    const [grenade] = r.system.liveGrenades();
    r.camera.lookAt(grenade!.position.x, grenade!.position.y, grenade!.position.z);
    r.step(0.1 + DT);
    expect(r.system.liveGrenades()).toHaveLength(0);
    expect(r.system.blindLevel).toBeGreaterThan(0.5);
    expect(r.targets.applyFlash).toHaveBeenCalledTimes(1);
    expect(r.player.takeDamage).not.toHaveBeenCalled();
  });

  it('does nothing to a player behind a wall from it', async () => {
    const r = await rig({ wallAt: -1.5 });
    // Over the wall it cannot go: it bounces back, so judge a remote flash beyond the wall instead.
    r.system.receiveThrown({ type: 'grenadeThrown', senderSlot: 1, id: 'x-1', kind: 'flash', origin: { x: 0, y: 0.5, z: -4 }, velocity: { x: 0, y: 0, z: 0 }, fuseLeft: 1, t: 1 });
    r.system.receiveDetonated({ type: 'grenadeDetonated', senderSlot: 1, id: 'x-1', kind: 'flash', position: { x: 0, y: 0.5, z: -4 } });
    expect(r.system.blindLevel).toBe(0);
  });
});

describe('GrenadeSystem effects while the simulation is frozen', () => {
  it('the shake, blast light and white-out run out through tickEffects alone, and update() does not tick them', async () => {
    const frag = await rig();
    const light = frag.scene.children.find((child): child is THREE.PointLight => child instanceof THREE.PointLight)!;
    frag.system.debugThrow({ x: 0, y: -1, z: 0 });
    frag.step(GRENADE_FUSE.frag + DT);
    expect(frag.system.cameraShake).toBeGreaterThan(0);
    expect(light.intensity).toBeGreaterThan(0);
    // Dead, or the match over: Game ticks only the effects.
    for (let i = 0; i < 60 * 3; i++) frag.system.tickEffects(DT);
    expect(frag.system.cameraShake).toBe(0);
    expect(light.intensity).toBe(0);

    const flash = await rig({ kind: 'flash' });
    remoteDetonation(flash.system, 'x-2', 'flash', { x: 0, y: 1.5, z: -1 });
    const blind = flash.system.blindLevel;
    expect(blind).toBeGreaterThan(0.5);
    // The simulation tick alone leaves the white-out where it is.
    for (let i = 0; i < 60 * 10; i++) flash.system.update(DT, null);
    expect(flash.system.blindLevel).toBe(blind);
    for (let i = 0; i < 60 * 10; i++) flash.system.tickEffects(DT);
    expect(flash.system.blindLevel).toBe(0);
  });
});

describe('GrenadeSystem flash and enemies', () => {
  it('blinds the enemies before the bang is heard, so an idle one is not already searching when it is judged', async () => {
    const r = await rig({ kind: 'flash' });
    r.system.debugThrow({ x: 0, y: -1, z: 0 });
    r.step(GRENADE_FUSE.flash + DT);
    expect(r.targets.applyFlash).toHaveBeenCalledTimes(1);
    expect(r.targets.notifyGunshot).toHaveBeenCalledWith(expect.anything(), 'flash');
    expect(r.targets.applyFlash.mock.invocationCallOrder[0]!).toBeLessThan(r.targets.notifyGunshot.mock.invocationCallOrder[0]!);
  });
});

describe('GrenadeSystem blast rays and sweeps', () => {
  it('a frag inside a tree canopy sensor still hurts what is near it', async () => {
    const r = await rig({ network: true });
    // A canopy ball round the blast and the target, as VegetationManager makes them.
    r.physics.world.createCollider(RAPIER.ColliderDesc.ball(4).setSensor(true).setTranslation(0, 1, -2));
    r.opponents.push({ slot: 1, position: new THREE.Vector3(0, PLAYER_HEIGHT / 2, -3), entity: {}, isDead: false });
    r.physics.world.step();
    r.system.debugThrow({ x: 0, y: -1, z: 0 });
    r.step(GRENADE_FUSE.frag + DT);
    expect(r.sent.filter((m) => m.type === 'damageEvent')).toHaveLength(1);
    expect(r.player.takeDamage).toHaveBeenCalledTimes(1);
  });

  it('a flash in a canopy still blinds a player looking at it', async () => {
    const r = await rig();
    r.physics.world.createCollider(RAPIER.ColliderDesc.ball(3).setSensor(true).setTranslation(0, 1.5, -2));
    r.physics.world.step();
    remoteDetonation(r.system, 'x-3', 'flash', { x: 0, y: 1.5, z: -2 });
    expect(r.system.blindLevel).toBeGreaterThan(0.5);
  });

  it('a flash that went off inside a fixed collider (a door closed on it) still lights up what stands by its near face', async () => {
    const r = await rig();
    // The slab spans z -2.3 to -1.7: the blast sits 0.15 m inside its near face, the player looks at it.
    fixedCuboid(r.physics, 0, 1.5, -2, 2, 1.5, 0.3);
    r.physics.world.step();
    remoteDetonation(r.system, 'x-6', 'flash', { x: 0, y: 1.4, z: -1.85 });
    expect(r.system.blindLevel).toBeGreaterThan(0.5);
  });

  it('flies a copy of another player grenade into the local capsule instead of through it', async () => {
    const r = await rig({ network: true });
    r.system.receiveThrown({ type: 'grenadeThrown', senderSlot: 1, id: 'x-5', kind: 'frag', origin: { x: 0, y: 1, z: -3 }, velocity: { x: 0, y: 0, z: 12 }, fuseLeft: 9, t: 1 });
    r.step(0.6);
    const [grenade] = r.system.liveGrenades();
    expect(grenade!.position.z).toBeLessThan(0);
  });
});

describe('GrenadeSystem per-frame work', () => {
  it('recomputes the cooking arc about 15 times a second, not every tick', async () => {
    const r = await rig();
    r.step(DT, fakeInput({ grenade: true }));
    const first = r.system.arcPreview;
    expect(first).not.toBeNull();
    r.step(DT * 3, fakeInput({ grenade: true }));
    expect(r.system.arcPreview).toBe(first);
    r.step(DT * 3, fakeInput({ grenade: true }));
    expect(r.system.arcPreview).not.toBe(first);
  });

  it('hands out the same live-view array and objects every call, refreshed in place', async () => {
    const r = await rig();
    r.system.debugThrow({ x: 0, y: 0.5, z: -1 });
    const first = r.system.liveViews();
    const view = first[0]!;
    const x = view.position.z;
    r.step(0.2);
    const second = r.system.liveViews();
    expect(second).toBe(first);
    expect(second[0]).toBe(view);
    expect(view.position.z).not.toBe(x);
    expect(view.position.z).toBeCloseTo(r.system.liveGrenades()[0]!.position.z);
  });
});

describe('GrenadeSystem carry', () => {
  it('carries only the loadout kind: 2 of it, one count, a cap of 3, back to 2 on a respawn', async () => {
    for (const kind of ['frag', 'flash'] as const) {
      const r = await rig({ kind });
      expect(r.system.kind).toBe(kind);
      expect(r.system.count).toBe(GRENADE_START_COUNT);
      expect(r.system.debugState()).toMatchObject({ kind, count: GRENADE_START_COUNT });
      expect(r.system.addGrenades(5)).toBe(GRENADE_MAX_COUNT - GRENADE_START_COUNT);
      expect(r.system.count).toBe(GRENADE_MAX_COUNT);
      expect(r.system.addGrenades(1)).toBe(0);
      r.system.debugThrow();
      expect(r.system.count).toBe(GRENADE_MAX_COUNT - 1);
      r.system.resetForSpawn();
      expect(r.system.count).toBe(GRENADE_START_COUNT);
    }
  });

  it('throws the loadout kind with the key, and tells the others which kind it is', async () => {
    for (const kind of ['frag', 'flash'] as const) {
      const r = await rig({ kind, network: true });
      r.step(DT * 3, fakeInput({ grenade: true }));
      expect(r.system.cooking?.kind).toBe(kind);
      r.step(DT, fakeInput({}));
      expect(r.system.liveGrenades().map((g) => g.kind)).toEqual([kind]);
      expect(r.sent.find((m) => m.type === 'grenadeThrown')).toMatchObject({ kind });
      expect(r.system.count).toBe(GRENADE_START_COUNT - 1);
    }
  });
});

describe('GrenadeSystem input', () => {
  it('cooks while held and throws on release', async () => {
    const r = await rig();
    r.step(DT * 3, fakeInput({ grenade: true }));
    expect(r.system.cooking?.kind).toBe('frag');
    expect(r.system.arcPreview?.points.length).toBeGreaterThan(1);
    expect(r.hand).toEqual(['cooking']);
    expect(r.sound.playGrenadePin).toHaveBeenCalledTimes(1);
    r.step(DT, fakeInput({}));
    expect(r.system.cooking).toBeNull();
    expect(r.hand).toEqual(['cooking', 'thrown']);
    const [grenade] = r.system.liveGrenades();
    expect(grenade!.fuseLeft).toBeLessThan(GRENADE_FUSE.frag);
  });

  it('goes off in the hand when cooked past the fuse', async () => {
    const r = await rig({ kind: 'flash' });
    r.step(GRENADE_FUSE.flash + 0.1, fakeInput({ grenade: true }));
    expect(r.system.liveGrenades()).toHaveLength(0);
    expect(r.system.debugState().detonations).toBe(1);
    expect(r.system.count).toBe(GRENADE_START_COUNT - 1);
  });

  it('refuses to start while the weapon says no (reloading, knife swing)', async () => {
    const r = await rig();
    r.canStart.value = false;
    r.step(DT * 5, fakeInput({ grenade: true }));
    expect(r.system.cooking).toBeNull();
  });

  it('drops a cook when the player is frozen, without spending it', async () => {
    const r = await rig();
    r.step(DT * 2, fakeInput({ grenade: true }));
    r.step(DT, null);
    expect(r.system.cooking).toBeNull();
    expect(r.system.count).toBe(GRENADE_START_COUNT);
    expect(r.hand).toEqual(['cooking', 'empty']);
  });

  it('carries none and throws nothing where grenades are off', async () => {
    const r = await rig({ enabled: false });
    expect(r.system.count).toBe(0);
    expect(r.system.debugThrow()).toBeNull();
    r.step(DT * 3, fakeInput({ grenade: true }));
    expect(r.system.cooking).toBeNull();
  });
});

describe('GrenadeSystem network copies', () => {
  const thrown = {
    type: 'grenadeThrown' as const,
    senderSlot: 1 as PlayerSlot,
    id: '1abcd-0',
    kind: 'frag' as const,
    origin: { x: 0, y: 1.5, z: -6 },
    velocity: { x: 0, y: 0, z: 0 },
    fuseLeft: 1,
    t: 100,
  };

  it('flies a copy that never decides anything, and drops it when its message never comes', async () => {
    const r = await rig({ network: true });
    r.opponents.push({ slot: 1, position: new THREE.Vector3(0, PLAYER_HEIGHT / 2, -6), entity: {}, isDead: false });
    r.system.receiveThrown(thrown);
    expect(r.system.liveGrenades()).toHaveLength(1);
    r.step(1 + DT);
    expect(r.system.liveGrenades()).toHaveLength(1);
    expect(r.explosions).not.toHaveBeenCalled();
    r.step(GRENADE_ORPHAN_GRACE_SECONDS);
    expect(r.system.liveGrenades()).toHaveLength(0);
    expect(r.sent).toHaveLength(0);
  });

  it('flies and plays either kind another player throws, whatever this player carries', async () => {
    for (const carried of ['frag', 'flash'] as const) {
      const r = await rig({ kind: carried, network: true });
      const other = carried === 'frag' ? 'flash' : 'frag';
      r.system.receiveThrown({ ...thrown, kind: other });
      expect(r.system.liveGrenades().map((g) => g.kind)).toEqual([other]);
      r.system.receiveDetonated({ type: 'grenadeDetonated', senderSlot: 1, id: thrown.id, kind: other, position: { x: 0, y: 0.1, z: -1 } });
      expect(r.system.debugState().lastDetonation?.kind).toBe(other);
      expect(r.system.count).toBe(GRENADE_START_COUNT);
    }
  });

  it('in co-op a teammate\'s frag never knocks the player back; their own still does', async () => {
    const r = await rig({ network: true, friendlyFire: false });
    r.system.receiveThrown(thrown);
    r.system.receiveDetonated({ type: 'grenadeDetonated', senderSlot: 1, id: thrown.id, kind: 'frag', position: { x: 0, y: 0.1, z: -1 } });
    expect(r.explosions).toHaveBeenCalledTimes(1);
    expect(r.player.applyKnockback).not.toHaveBeenCalled();
    expect(r.player.takeDamage).not.toHaveBeenCalled();
    r.system.debugThrow({ x: 0, y: -1, z: 0 });
    r.step(GRENADE_FUSE.frag + DT);
    expect(r.player.applyKnockback).toHaveBeenCalledTimes(1);
  });

  it('plays a detonation where the thrower says, knocks back but never self-damages', async () => {
    const r = await rig({ network: true });
    r.system.receiveThrown(thrown);
    r.system.receiveDetonated({ type: 'grenadeDetonated', senderSlot: 1, id: thrown.id, kind: 'frag', position: { x: 0, y: 0.1, z: -1 } });
    expect(r.system.liveGrenades()).toHaveLength(0);
    expect(r.explosions).toHaveBeenCalledTimes(1);
    expect(r.player.takeDamage).not.toHaveBeenCalled();
    expect(r.player.applyKnockback).toHaveBeenCalledTimes(1);
    expect(r.targets.applyBlast).not.toHaveBeenCalled();
    // A late resend of a grenade already gone off is ignored.
    r.system.receiveThrown({ ...thrown, t: 200 });
    expect(r.system.liveGrenades()).toHaveLength(0);
  });

  it("sets off only a copy it is flying, and only on its own thrower's word", async () => {
    const r = await rig({ network: true });
    const detonate = (senderSlot: PlayerSlot, id: string) =>
      r.system.receiveDetonated({ type: 'grenadeDetonated', senderSlot, id, kind: 'frag', position: { x: 0, y: 0.1, z: -1 } });
    // No throw first: a blast out of nowhere, beside the player.
    detonate(1, 'never-thrown');
    expect(r.explosions).not.toHaveBeenCalled();
    expect(r.player.applyKnockback).not.toHaveBeenCalled();
    r.system.receiveThrown(thrown);
    // Another player naming slot 1's grenade can neither set it off nor move it.
    detonate(2, thrown.id);
    r.system.receiveThrown({ ...thrown, senderSlot: 2, origin: { x: 50, y: 1.5, z: 50 }, t: 500 });
    expect(r.explosions).not.toHaveBeenCalled();
    expect(r.system.liveGrenades()[0]!.position.x).toBeCloseTo(0, 3);
    detonate(1, thrown.id);
    expect(r.explosions).toHaveBeenCalledTimes(1);
    expect(r.player.applyKnockback).toHaveBeenCalledTimes(1);
  });

  it('re-sends its own live grenades the first time an opponent is seen', async () => {
    const r = await rig({ network: true });
    r.system.debugThrow({ x: 0, y: 0, z: -1 });
    r.step(0.5);
    r.sent.length = 0;
    r.system.opponentInMatch(2);
    r.system.opponentInMatch(2);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ type: 'grenadeThrown', senderSlot: 0, kind: 'frag' });
    expect((r.sent[0] as { fuseLeft: number }).fuseLeft).toBeCloseTo(GRENADE_FUSE.frag - 0.5, 1);
  });
});
