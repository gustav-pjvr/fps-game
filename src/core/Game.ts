import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Renderer } from './Renderer.ts';
import { InputManager } from '../input/InputManager.ts';
import { Loop } from './Loop.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Player } from '../entities/Player.ts';
import { EntityManager } from '../entities/EntityManager.ts';
import { ChunkManager } from '../world/ChunkManager.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { WeaponManager } from '../weapons/WeaponManager.ts';
import { ImpactMarkers } from '../combat/ImpactMarkers.ts';
import { Tracers } from '../combat/Tracers.ts';
import { Hud } from '../ui/hud.ts';
import { Hotbar } from '../ui/hotbar.ts';
import { ScopeOverlay } from '../ui/scope.ts';
import { HitMarker } from '../ui/hitMarker.ts';
import { DeathScreen } from '../ui/deathScreen.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { isDamageable } from '../combat/damage.ts';

const SPAWN_X = 0;
const SPAWN_Z = 8;
const SPAWN_HEIGHT_OFFSET = 2;
const REFERENCE_BOX_COLORS = [0xdd4444, 0x4488dd, 0xddaa22, 0x22ddaa];
const TARGET_RING_RADIUS = 15;
const TARGET_COUNT = 5;
const ENEMY_RING_RADIUS = 25;
const ENEMY_COUNT = 3;

/** Read/aim-only hooks for the Playwright e2e suite (e2e/) - no gameplay-affecting cheats beyond aiming. */
export interface GameDebugApi {
  getScore(): number;
  getPlayerHealth(): number;
  getPlayerPosition(): { x: number; y: number; z: number };
  getAmmo(): number;
  getWeaponName(): string;
  getEntityCount(): number;
  isPointerLocked(): boolean;
  lookAt(x: number, y: number, z: number): void;
  getLiveEntityPositions(): { x: number; y: number; z: number }[];
  raycastForward(): { hit: boolean; isEntity?: boolean; distance?: number; point?: { x: number; y: number; z: number } };
}

declare global {
  interface Window {
    __gameDebug?: GameDebugApi;
  }
}

export class Game {
  private readonly loop: Loop;
  private readonly entityManager: EntityManager;
  private readonly deathScreen: DeathScreen;
  private score = 0;

  private constructor(
    private readonly renderer: Renderer,
    private readonly input: InputManager,
    private readonly physics: PhysicsWorld,
    private readonly player: Player,
    private readonly chunkManager: ChunkManager,
    private readonly weaponManager: WeaponManager,
    private readonly impactMarkers: ImpactMarkers,
    private readonly tracers: Tracers,
    private readonly hud: Hud,
    private readonly hotbar: Hotbar,
    private readonly hitMarker: HitMarker,
    hudRoot: HTMLElement,
  ) {
    this.entityManager = new EntityManager(renderer.scene, physics, () => this.onEnemyKilled());
    this.deathScreen = new DeathScreen(hudRoot, () => this.respawn());
    this.loop = new Loop(this.update, this.render);
    this.installDebugApi();
  }

  private installDebugApi(): void {
    window.__gameDebug = {
      getScore: () => this.score,
      getPlayerHealth: () => this.player.currentHealth,
      getPlayerPosition: () => {
        const p = this.player.position;
        return { x: p.x, y: p.y, z: p.z };
      },
      getAmmo: () => this.weaponManager.ammo,
      getWeaponName: () => this.weaponManager.weaponName,
      getEntityCount: () => this.entityManager.count,
      isPointerLocked: () => this.input.isLocked,
      lookAt: (x, y, z) => this.player.debugLookAt(new THREE.Vector3(x, y, z)),
      getLiveEntityPositions: () =>
        this.entityManager.getLiveEntityPositions().map((p) => ({ x: p.x, y: p.y, z: p.z })),
      raycastForward: () => {
        const origin = this.renderer.camera.position.clone();
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.renderer.camera.quaternion);
        const hit = castHitscan(this.physics, origin, direction, 500);
        if (!hit) return { hit: false };
        return {
          hit: true,
          isEntity: isDamageable(this.physics.getEntity(hit.colliderHandle)),
          distance: hit.distance,
          point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
        };
      },
    };
  }

  static async create(container: HTMLElement, blocker: HTMLElement, hudRoot: HTMLElement): Promise<Game> {
    const renderer = new Renderer(container);
    const input = new InputManager(renderer.canvas, blocker);
    const physics = await PhysicsWorld.create();

    Game.addLighting(renderer.scene);
    Game.addReferenceBoxes(renderer.scene, physics);

    const chunkManager = new ChunkManager(renderer.scene, physics);
    // Seed enough chunks around spawn up front so the player never spawns over an ungenerated gap.
    for (let i = 0; i < 30; i++) {
      chunkManager.update(SPAWN_X, SPAWN_Z);
    }

    const spawnY = sampleHeight(SPAWN_X, SPAWN_Z) + SPAWN_HEIGHT_OFFSET;
    const player = new Player(physics, renderer.camera, new THREE.Vector3(SPAWN_X, spawnY, SPAWN_Z));

    const impactMarkers = new ImpactMarkers(renderer.scene);
    const tracers = new Tracers(renderer.scene);
    const scopeOverlay = new ScopeOverlay(hudRoot);
    const hitMarker = new HitMarker(hudRoot);
    const weaponManager = new WeaponManager(
      renderer.camera,
      physics,
      ['pistol', 'sniper'],
      scopeOverlay,
      (point, isEntityHit) => {
        impactMarkers.spawn(point, isEntityHit);
        if (isEntityHit) hitMarker.trigger();
      },
      (start, end) => tracers.spawn(start, end),
    );
    const hud = new Hud(hudRoot);
    const hotbar = new Hotbar(hudRoot);
    hotbar.setSlots(weaponManager.weaponSlotNames);

    const game = new Game(
      renderer,
      input,
      physics,
      player,
      chunkManager,
      weaponManager,
      impactMarkers,
      tracers,
      hud,
      hotbar,
      hitMarker,
      hudRoot,
    );
    Game.spawnEncounters(game.entityManager);

    return game;
  }

  start(): void {
    this.loop.start();
  }

  private onEnemyKilled(): void {
    this.score += 1;
  }

  private respawn(): void {
    const spawnY = sampleHeight(SPAWN_X, SPAWN_Z) + SPAWN_HEIGHT_OFFSET;
    this.player.respawn(new THREE.Vector3(SPAWN_X, spawnY, SPAWN_Z));
    this.deathScreen.hide();
  }

  private static addLighting(scene: THREE.Scene): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 30, 10);
    sun.castShadow = true;
    scene.add(sun);
  }

  private static addReferenceBoxes(scene: THREE.Scene, physics: PhysicsWorld): void {
    for (let i = 0; i < REFERENCE_BOX_COLORS.length; i++) {
      const size = 2;
      const x = Math.cos((i / REFERENCE_BOX_COLORS.length) * Math.PI * 2) * 10;
      const z = Math.sin((i / REFERENCE_BOX_COLORS.length) * Math.PI * 2) * 10;
      const y = sampleHeight(x, z) + size / 2;

      const box = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({ color: REFERENCE_BOX_COLORS[i] }),
      );
      box.position.set(x, y, z);
      box.castShadow = true;
      scene.add(box);

      const boxBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      physics.world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2), boxBody);
    }
  }

  private static spawnEncounters(entityManager: EntityManager): void {
    for (let i = 0; i < TARGET_COUNT; i++) {
      const angle = (i / TARGET_COUNT) * Math.PI * 2;
      const x = SPAWN_X + Math.cos(angle) * TARGET_RING_RADIUS;
      const z = SPAWN_Z + Math.sin(angle) * TARGET_RING_RADIUS;
      entityManager.spawnTarget(new THREE.Vector3(x, sampleHeight(x, z) + 1, z));
    }

    for (let i = 0; i < ENEMY_COUNT; i++) {
      const angle = (i / ENEMY_COUNT) * Math.PI * 2 + 0.5;
      const x = SPAWN_X + Math.cos(angle) * ENEMY_RING_RADIUS;
      const z = SPAWN_Z + Math.sin(angle) * ENEMY_RING_RADIUS;
      entityManager.spawnEnemy(new THREE.Vector3(x, sampleHeight(x, z) + 1, z));
    }
  }

  private readonly update = (dt: number): void => {
    const wasDead = this.player.isDead;

    if (this.player.isDead) {
      // Keep draining look input so it doesn't build up a stale jump in camera angle on respawn.
      this.input.consumeLookDelta();
    } else {
      this.player.update(dt, this.input);
      this.physics.step(dt);
      this.chunkManager.update(this.player.position.x, this.player.position.z);
      this.weaponManager.update(dt, this.input, this.player);
      this.entityManager.update(dt, this.player);
    }

    this.impactMarkers.update(dt);
    this.tracers.update(dt);
    this.hitMarker.update(dt);

    if (this.player.isDead && !wasDead) {
      this.deathScreen.show(this.score);
    }

    this.hud.setAmmo(this.weaponManager.ammo, this.weaponManager.magazineSize, this.weaponManager.isReloading);
    this.hud.setWeaponName(this.weaponManager.weaponName);
    this.hud.setScore(this.score);
    this.hud.setHealth(this.player.currentHealth, this.player.maxHealth);
    this.hotbar.setActive(this.weaponManager.activeWeaponIndex);
  };

  private readonly render = (_alpha: number): void => {
    this.renderer.render();
  };
}
