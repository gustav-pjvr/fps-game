import * as THREE from 'three';
import { Renderer } from './Renderer.ts';
import { InputManager } from '../input/InputManager.ts';
import { Loop } from './Loop.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Player } from '../entities/Player.ts';
import { EntityManager } from '../entities/EntityManager.ts';
import { BuildingManager } from '../world/BuildingManager.ts';
import { RoadManager } from '../world/RoadManager.ts';
import { ChunkManager } from '../world/ChunkManager.ts';
import { VegetationManager } from '../world/VegetationManager.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { WeaponManager } from '../weapons/WeaponManager.ts';
import { ImpactMarkers } from '../combat/ImpactMarkers.ts';
import { Tracers } from '../combat/Tracers.ts';
import { Hud } from '../ui/hud.ts';
import { Hotbar } from '../ui/hotbar.ts';
import { ScopeOverlay } from '../ui/scope.ts';
import { HitMarker } from '../ui/hitMarker.ts';
import { DeathScreen } from '../ui/deathScreen.ts';
import { WeaponCaption } from '../ui/weaponCaption.ts';
import { KillFeed } from '../ui/killFeed.ts';
import { PauseMenu } from '../ui/menu/PauseMenu.ts';
import { SettingsPanel } from '../ui/menu/SettingsPanel.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { isDamageable } from '../combat/damage.ts';
import { SoundEngine } from '../audio/SoundEngine.ts';
import { ENEMY_RING_BASE_RADIUS, SPAWN_X, SPAWN_Z, SUN_DIRECTION_X, SUN_DIRECTION_Y, SUN_DIRECTION_Z } from './config.ts';
import { getWorldSeed, randomizeWorldSeed } from './worldSeed.ts';

const SPAWN_HEIGHT_OFFSET = 2;
const TARGET_RING_BASE_RADIUS = 15;
/** Desired arc distance between neighboring spawns once a ring's base radius is too cramped for its count. */
const RING_SPACING = 2.2;
/** Entities spawned per batch before yielding a frame, so large match sizes don't spawn as one long stall. */
const SPAWN_BATCH_SIZE = 4;

export interface MatchConfig {
  enemyCount: number;
  targetCount: number;
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

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
  getLiveEntityStates(): (string | undefined)[];
  raycastForward(): { hit: boolean; isEntity?: boolean; distance?: number; point?: { x: number; y: number; z: number } };
  getCameraFov(): number;
  getCameraChildrenDebug(): unknown[];
  getWorldSeed(): number;
  isTouchingClimbable(): boolean;
  isClimbing(): boolean;
  getActiveLadderPositions(): { x: number; wallFaceZ: number }[];
  teleport(x: number, y: number, z: number): void;
}

declare global {
  interface Window {
    __gameDebug?: GameDebugApi;
  }
}

/** Score lives in a shared mutable holder, not a Game field - EntityManager.create() (async) is
 * awaited before a Game instance exists, so its onKilled callback can't close over `this`. */
interface ScoreState {
  value: number;
}

export class Game {
  private readonly loop: Loop;
  private lastActiveWeaponIndex: number;

  private constructor(
    private readonly renderer: Renderer,
    private readonly input: InputManager,
    private readonly physics: PhysicsWorld,
    private readonly player: Player,
    private readonly chunkManager: ChunkManager,
    private readonly buildings: BuildingManager,
    private readonly entityManager: EntityManager,
    private readonly weaponManager: WeaponManager,
    private readonly impactMarkers: ImpactMarkers,
    private readonly tracers: Tracers,
    private readonly hud: Hud,
    private readonly hotbar: Hotbar,
    private readonly hitMarker: HitMarker,
    private readonly deathScreen: DeathScreen,
    private readonly weaponCaption: WeaponCaption,
    private readonly killFeed: KillFeed,
    private readonly scopeOverlay: ScopeOverlay,
    private readonly pauseMenu: PauseMenu,
    private readonly settingsPanel: SettingsPanel,
    private readonly scoreState: ScoreState,
    private readonly matchConfig: MatchConfig,
  ) {
    this.lastActiveWeaponIndex = weaponManager.activeWeaponIndex;
    this.loop = new Loop(this.update, this.render);
    this.installDebugApi();
  }

  private installDebugApi(): void {
    window.__gameDebug = {
      getScore: () => this.scoreState.value,
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
      teleport: (x, y, z) => this.player.debugTeleport(new THREE.Vector3(x, y, z)),
      getLiveEntityPositions: () =>
        this.entityManager.getLiveEntityPositions().map((p) => ({ x: p.x, y: p.y, z: p.z })),
      getLiveEntityStates: () => this.entityManager.getLiveEntityStates(),
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
      getCameraFov: () => this.renderer.camera.fov,
      getCameraChildrenDebug: () =>
        this.renderer.camera.children.map((child) => ({
          type: child.type,
          visible: child.visible,
          position: { x: child.position.x, y: child.position.y, z: child.position.z },
          childCount: child.children.length,
          grandchildInfo: child.children.map((gc) => ({
            type: gc.type,
            visible: gc.visible,
            scale: { x: gc.scale.x, y: gc.scale.y, z: gc.scale.z },
          })),
        })),
      getWorldSeed: () => getWorldSeed(),
      isTouchingClimbable: () => this.player.isTouchingClimbable,
      isClimbing: () => this.player.isClimbing,
      getActiveLadderPositions: () => this.buildings.getActiveLadderPositions(),
    };
  }

  static async create(
    container: HTMLElement,
    hudRoot: HTMLElement,
    matchConfig: MatchConfig,
    onProgress?: (status: string, ratio: number) => void,
    onReturnToLobby?: () => void,
  ): Promise<Game> {
    onProgress?.('Initializing world…', 0);
    // A new seed per match (not per practice-reset) so each new game generates a different world,
    // while staying fixed for the rest of this match so chunk streaming/reload stays deterministic.
    randomizeWorldSeed();
    const renderer = new Renderer(container);
    const input = new InputManager(renderer.canvas);
    const physics = await PhysicsWorld.create();

    Game.addLighting(renderer.scene);

    onProgress?.('Growing vegetation…', 0.02);
    const vegetation = await VegetationManager.create(renderer.scene, physics);
    onProgress?.('Constructing buildings…', 0.04);
    const buildings = await BuildingManager.create(renderer.scene, physics);
    const roads = RoadManager.create(renderer.scene, buildings);

    const chunkManager = new ChunkManager(renderer.scene, physics, {
      onChunkLoaded: (cx, cz, originX, originZ, size) => {
        vegetation.placeForChunk(cx, cz, originX, originZ, size);
        buildings.placeForChunk(cx, cz, originX, originZ, size);
        roads.placeForChunk(cx, cz, originX, originZ, size);
      },
      onChunkUnloaded: (cx, cz) => {
        vegetation.removeChunk(cx, cz);
        buildings.removeChunk(cx, cz);
        roads.removeChunk(cx, cz);
      },
    });
    // Seed enough chunks around spawn up front so the player never spawns over an ungenerated gap.
    for (let i = 0; i < 30; i++) {
      chunkManager.update(SPAWN_X, SPAWN_Z);
    }

    const sound = await SoundEngine.create();
    document.addEventListener('click', () => sound.resume(), { once: true });

    const spawnY = sampleHeight(SPAWN_X, SPAWN_Z) + SPAWN_HEIGHT_OFFSET;
    const player = new Player(physics, renderer.camera, new THREE.Vector3(SPAWN_X, spawnY, SPAWN_Z), {
      onDamaged: () => sound.playPlayerHurt(),
      onFootstep: () => sound.playFootstep(),
    });

    const killFeed = new KillFeed(hudRoot);
    const scoreState: ScoreState = { value: 0 };

    const impactMarkers = new ImpactMarkers(renderer.scene);
    const tracers = new Tracers(renderer.scene);
    const scopeOverlay = new ScopeOverlay(hudRoot);
    const hitMarker = new HitMarker(hudRoot);

    onProgress?.('Loading weapons…', 0.05);
    const weaponManager = await WeaponManager.create(
      renderer.camera,
      physics,
      ['pistol', 'rifle', 'shotgun', 'sniper'],
      scopeOverlay,
      (point, isEntityHit) => {
        impactMarkers.spawn(point, isEntityHit);
        if (isEntityHit) {
          hitMarker.trigger();
          sound.playHitConfirm();
        }
      },
      (start, end) => tracers.spawn(start, end),
      (weaponId) => sound.playGunshot(weaponId),
      (weaponId) => sound.playReloadClick(weaponId),
    );

    onProgress?.('Loading combatants…', 0.1);
    const entityManager = await EntityManager.create(renderer.scene, physics, (label) => {
      scoreState.value += 1;
      killFeed.show(label);
    });

    await Game.spawnEncountersAsync(entityManager, matchConfig.targetCount, matchConfig.enemyCount, (status, spawnRatio) => {
      onProgress?.(status, 0.15 + spawnRatio * 0.85);
    });

    const hud = new Hud(hudRoot);
    const hotbar = new Hotbar(hudRoot);
    hotbar.setSlots(weaponManager.weaponSlotNames);
    const weaponCaption = new WeaponCaption(hudRoot);

    // DeathScreen/PauseMenu click handlers need to call back into `game`, but it doesn't exist
    // until after construction - same circular-dependency shape as scoreState above, forward-ref instead.
    const gameRef: { current: Game | null } = { current: null };
    const deathScreen = new DeathScreen(
      hudRoot,
      () => gameRef.current?.resetPlay(),
      () => onReturnToLobby?.(),
    );
    // PauseMenu is created before SettingsPanel so the settings overlay (later DOM sibling)
    // paints above it - opening Settings from the pause menu must show over it, not behind it.
    const pauseMenu = new PauseMenu(hudRoot, {
      onResume: () => input.requestPointerLock(),
      onSettings: () => settingsPanel.show(),
      onResetPlay: () => gameRef.current?.resetPlay(),
      onReturnToLobby: () => onReturnToLobby?.(),
    });
    const settingsPanel = new SettingsPanel(hudRoot, () => settingsPanel.hide(), (value) => sound.setMasterVolume(value));

    const game = new Game(
      renderer,
      input,
      physics,
      player,
      chunkManager,
      buildings,
      entityManager,
      weaponManager,
      impactMarkers,
      tracers,
      hud,
      hotbar,
      hitMarker,
      deathScreen,
      weaponCaption,
      killFeed,
      scopeOverlay,
      pauseMenu,
      settingsPanel,
      scoreState,
      matchConfig,
    );
    gameRef.current = game;

    return game;
  }

  start(): void {
    this.loop.start();
  }

  /** Tears down everything this Game instance owns - WebGL context, DOM-appended HUD/menu
   * elements, and input listeners - so App can cleanly return to the lobby and later start a
   * fresh match without leaking GL contexts or stacking duplicate HUD nodes. */
  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.renderer.dispose();
    this.hud.dispose();
    this.hotbar.dispose();
    this.hitMarker.dispose();
    this.deathScreen.dispose();
    this.weaponCaption.dispose();
    this.killFeed.dispose();
    this.scopeOverlay.dispose();
    this.pauseMenu.dispose();
    this.settingsPanel.dispose();
    this.physics.dispose();
    window.__gameDebug = undefined;
  }

  /** Practice-reset (T key, or the death screen's Respawn button): fresh targets/enemies, full
   * ammo on every weapon, full health, score back to 0 - a clean slate without needing a page
   * reload. Works even while dead. Reuses the enemy/target counts chosen at match setup, not the
   * class defaults. Also re-requests pointer lock, since it may be the death screen calling this
   * after releasePointerLock() freed the mouse to make its buttons clickable. */
  private resetPlay(): void {
    const spawnY = sampleHeight(SPAWN_X, SPAWN_Z) + SPAWN_HEIGHT_OFFSET;
    this.player.respawn(new THREE.Vector3(SPAWN_X, spawnY, SPAWN_Z));
    this.weaponManager.resetAllAmmo();
    this.entityManager.clearAll();
    void Game.spawnEncountersAsync(this.entityManager, this.matchConfig.targetCount, this.matchConfig.enemyCount);
    this.impactMarkers.clear();
    this.tracers.clear();
    this.scoreState.value = 0;
    this.deathScreen.hide();
    this.input.requestPointerLock();
  }

  private static addLighting(scene: THREE.Scene): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(SUN_DIRECTION_X, SUN_DIRECTION_Y, SUN_DIRECTION_Z);
    sun.castShadow = true;
    scene.add(sun);
  }

  /** Ring radius that keeps a fixed base size for small counts but grows for large ones so spawns don't stack. */
  private static ringRadius(count: number, baseRadius: number): number {
    if (count <= 1) return baseRadius;
    const spacingRadius = (count * RING_SPACING) / (Math.PI * 2);
    return Math.max(baseRadius, spacingRadius);
  }

  /** Spawns the chosen number of targets/enemies in batches, yielding a frame between batches so
   * large match sizes stay responsive and a loading screen can show real progress. */
  private static async spawnEncountersAsync(
    entityManager: EntityManager,
    targetCount: number,
    enemyCount: number,
    onProgress?: (status: string, ratio: number) => void,
  ): Promise<void> {
    const total = targetCount + enemyCount;
    let done = 0;
    const report = (status: string): void => onProgress?.(status, total > 0 ? done / total : 1);

    const targetRadius = Game.ringRadius(targetCount, TARGET_RING_BASE_RADIUS);
    for (let i = 0; i < targetCount; i++) {
      const angle = (i / targetCount) * Math.PI * 2;
      const x = SPAWN_X + Math.cos(angle) * targetRadius;
      const z = SPAWN_Z + Math.sin(angle) * targetRadius;
      const y = sampleHeight(x, z) + 1;
      entityManager.spawnTarget(new THREE.Vector3(x, y, z), new THREE.Vector3(SPAWN_X, y, SPAWN_Z));
      done++;
      report(`Placing targets… (${done}/${total})`);
      if (done % SPAWN_BATCH_SIZE === 0) await waitForNextFrame();
    }

    const enemyRadius = Game.ringRadius(enemyCount, ENEMY_RING_BASE_RADIUS);
    for (let i = 0; i < enemyCount; i++) {
      const angle = (i / enemyCount) * Math.PI * 2 + 0.5;
      const x = SPAWN_X + Math.cos(angle) * enemyRadius;
      const z = SPAWN_Z + Math.sin(angle) * enemyRadius;
      entityManager.spawnEnemy(new THREE.Vector3(x, sampleHeight(x, z) + 1, z));
      done++;
      report(`Deploying enemies… (${done}/${total})`);
      if (done % SPAWN_BATCH_SIZE === 0) await waitForNextFrame();
    }

    report('Ready');
  }

  private readonly update = (dt: number): void => {
    // Pointer lock is the single source of truth for "paused": pressing Escape forces the browser
    // to release it (can't be prevented), and a freshly loaded match starts unlocked too - both
    // cases should show the pause menu and freeze simulation. Death has its own overlay instead.
    const isPaused = !this.input.isLocked && !this.player.isDead;
    this.pauseMenu.setVisible(isPaused);
    if (isPaused) {
      this.input.consumeLookDelta();
      return;
    }

    if (this.input.consumeJustPressed('resetPlay')) {
      this.resetPlay();
    }

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

    if (this.weaponManager.activeWeaponIndex !== this.lastActiveWeaponIndex) {
      this.lastActiveWeaponIndex = this.weaponManager.activeWeaponIndex;
      this.weaponCaption.show(this.weaponManager.weaponName, this.weaponManager.weaponDescription);
    }

    this.impactMarkers.update(dt);
    this.tracers.update(dt);
    this.hitMarker.update(dt);
    this.weaponCaption.update(dt);
    this.killFeed.update(dt);

    if (this.player.isDead && !wasDead) {
      this.deathScreen.show(this.scoreState.value);
      this.input.releasePointerLock();
    }

    this.hud.setAmmo(this.weaponManager.ammo, this.weaponManager.magazineSize, this.weaponManager.isReloading);
    this.hud.setWeaponName(this.weaponManager.weaponName);
    this.hud.setScore(this.scoreState.value);
    this.hud.setHealth(this.player.currentHealth, this.player.maxHealth);
    this.hotbar.setActive(this.weaponManager.activeWeaponIndex);
  };

  private readonly render = (_alpha: number): void => {
    this.renderer.render();
  };
}
