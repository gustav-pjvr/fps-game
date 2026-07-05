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
import { MuzzleFlash } from '../combat/MuzzleFlash.ts';
import { Tracers } from '../combat/Tracers.ts';
import { Hud } from '../ui/hud.ts';
import { Hotbar } from '../ui/hotbar.ts';
import { ScopeOverlay } from '../ui/scope.ts';
import { HitMarker } from '../ui/hitMarker.ts';
import { DeathScreen } from '../ui/deathScreen.ts';
import { WeaponCaption } from '../ui/weaponCaption.ts';
import { LongShotCallout } from '../ui/longShotCallout.ts';
import { KillFeed } from '../ui/killFeed.ts';
import { PauseMenu } from '../ui/menu/PauseMenu.ts';
import { SettingsPanel } from '../ui/menu/SettingsPanel.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { isDamageable } from '../combat/damage.ts';
import { SoundEngine } from '../audio/SoundEngine.ts';
import { FpsMeter } from './FpsMeter.ts';
import { PerfOverlay } from '../ui/perfOverlay.ts';
import {
  ENEMY_GUNSHOT_AUDIBLE_RANGE,
  ENEMY_GUNSHOT_FULL_VOLUME_RANGE,
  ENEMY_GUNSHOT_MIN_VOLUME,
  ENEMY_RANGED_TRACER_COLOR,
  ENEMY_RING_BASE_RADIUS,
  SPAWN_X,
  SPAWN_Z,
  SUN_DIRECTION_X,
  SUN_DIRECTION_Y,
  SUN_DIRECTION_Z,
  SUN_SHADOW_BIAS,
  SUN_SHADOW_CAMERA_FAR,
  SUN_SHADOW_NORMAL_BIAS,
  SUN_SHADOW_ORTHO_HALF_EXTENT,
} from './config.ts';
import { getWorldSeed, randomizeWorldSeed } from './worldSeed.ts';
import { Settings } from '../settings/Settings.ts';
import { GRAPHICS_QUALITY_PRESETS, type GraphicsQualityPreset } from '../settings/graphicsQuality.ts';

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

/** Linear gain falloff for enemy gunshots: full volume inside FULL_VOLUME_RANGE, fading to
 * MIN_VOLUME (never silent - an inaudible shot that still damages would read as unfair) at
 * AUDIBLE_RANGE. See the ENEMY_GUNSHOT_* constants' comment in config.ts. */
function enemyGunshotVolume(distance: number): number {
  const t = (distance - ENEMY_GUNSHOT_FULL_VOLUME_RANGE) / (ENEMY_GUNSHOT_AUDIBLE_RANGE - ENEMY_GUNSHOT_FULL_VOLUME_RANGE);
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - clamped * (1 - ENEMY_GUNSHOT_MIN_VOLUME);
}

/** Read/aim-only hooks for the Playwright e2e suite (e2e/) - no gameplay-affecting cheats beyond
 * aiming, with one deliberate exception: damagePlayer, which exists so death-*UI-flow* tests don't
 * have to stage up to ~90s of real combat just to reach the death screen. One death-flow test
 * still uses real combat (see e2e/helpers.ts killPlayerByEnemy) so the genuine
 * enemy-damages-player path stays covered end to end. */
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
  getLiveEntityArchetypes(): (string | undefined)[];
  raycastForward(): { hit: boolean; isEntity?: boolean; distance?: number; point?: { x: number; y: number; z: number } };
  getCameraFov(): number;
  getCameraChildrenDebug(): unknown[];
  getWorldSeed(): number;
  isTouchingClimbable(): boolean;
  isClimbing(): boolean;
  /** Test-only: applies real damage through Player.takeDamage (the same path enemy shots use). */
  damagePlayer(amount: number): void;
  getActiveLadderPositions(): { x: number; wallFaceZ: number }[];
  teleport(x: number, y: number, z: number): void;
  /** Rolling real-frame-time stats (see FpsMeter) - lets a script measure performance on the
   * user's own hardware/browser instead of relying on this environment's software-rendered GPU,
   * which can't produce a meaningful number (see PERFORMANCE.md). */
  getFrameStats(): { fps: number; avgMs: number; p95Ms: number };
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
  private readonly fpsMeter = new FpsMeter();
  private lastRenderTime = performance.now();
  /** Bumped by resetPlay/dispose to cancel any in-flight spawnEncountersAsync loop - its batches
   * yield to requestAnimationFrame, so without this a second rapid reset kept both loops spawning
   * (entity count overshooting the configured match size), and returning to the lobby mid-spawn
   * had the surviving loop calling createRigidBody on an already-freed WASM world. */
  private spawnGeneration = 0;
  /** Damage requested via the debug API, applied inside the next update tick (see installDebugApi). */
  private pendingDebugDamage = 0;

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
    private readonly muzzleFlash: MuzzleFlash,
    private readonly hud: Hud,
    private readonly hotbar: Hotbar,
    private readonly hitMarker: HitMarker,
    private readonly deathScreen: DeathScreen,
    private readonly weaponCaption: WeaponCaption,
    private readonly longShotCallout: LongShotCallout,
    private readonly killFeed: KillFeed,
    private readonly scopeOverlay: ScopeOverlay,
    private readonly pauseMenu: PauseMenu,
    private readonly settingsPanel: SettingsPanel,
    private readonly perfOverlay: PerfOverlay,
    private readonly sound: SoundEngine,
    private readonly scoreState: ScoreState,
    private readonly matchConfig: MatchConfig,
    private readonly sun: THREE.DirectionalLight,
  ) {
    this.lastActiveWeaponIndex = weaponManager.activeWeaponIndex;
    this.loop = new Loop(this.update, this.render);
    document.addEventListener('keydown', this.onDebugKeyDown);
    this.installDebugApi();
  }

  /** Re-centers the shadow camera's ortho box on the player every frame (see the
   * SUN_SHADOW_* comment in config.ts) - keeps the box small/high-res while still covering
   * wherever the player currently is in the 800x800m world. Target/position offset snaps to
   * shadow-texel increments so shadow edges don't visibly crawl ("swim") as the player moves a
   * sub-texel distance between frames. */
  private updateSunFollow(): void {
    const texelSize = (2 * SUN_SHADOW_ORTHO_HALF_EXTENT) / this.sun.shadow.mapSize.width;
    const playerPos = this.player.position;
    const snappedX = Math.round(playerPos.x / texelSize) * texelSize;
    const snappedZ = Math.round(playerPos.z / texelSize) * texelSize;
    this.sun.target.position.set(snappedX, playerPos.y, snappedZ);
    this.sun.position.set(snappedX + SUN_DIRECTION_X, playerPos.y + SUN_DIRECTION_Y, snappedZ + SUN_DIRECTION_Z);
    this.sun.target.updateMatrixWorld();
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
      getLiveEntityArchetypes: () => this.entityManager.getLiveEntityArchetypes(),
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
      // Queued, not applied immediately: update() detects death by comparing isDead across the
      // tick (wasDead), so damage landing *between* ticks would make the death transition
      // unobservable and the death screen would never show. Queuing routes debug damage through
      // the exact same within-tick path enemy damage takes.
      damagePlayer: (amount) => {
        this.pendingDebugDamage += amount;
      },
      getActiveLadderPositions: () => this.buildings.getActiveLadderPositions(),
      getFrameStats: () => this.fpsMeter.getStats(),
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
    // Read once here, not live-applied to an in-progress match - see the comment on
    // Settings.getGraphicsQuality for why (shadow map resolution is baked into a GPU render
    // target at creation). A change made mid-match takes effect starting next match.
    const quality = GRAPHICS_QUALITY_PRESETS[Settings.getGraphicsQuality()];
    const renderer = new Renderer(container, quality);
    const input = new InputManager(renderer.canvas);
    const physics = await PhysicsWorld.create();

    const sun = Game.addLighting(renderer.scene, quality);

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
    const muzzleFlash = new MuzzleFlash(renderer.scene);
    const scopeOverlay = new ScopeOverlay(hudRoot);
    const hitMarker = new HitMarker(hudRoot);
    const longShotCallout = new LongShotCallout(hudRoot);

    onProgress?.('Loading weapons…', 0.05);
    const weaponManager = await WeaponManager.create(
      renderer.camera,
      physics,
      ['pistol', 'rifle', 'shotgun', 'sniper', 'knife'],
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
      (distance) => longShotCallout.show(distance),
      (point) => muzzleFlash.spawn(point),
    );

    onProgress?.('Loading combatants…', 0.1);
    const entityManager = await EntityManager.create(
      renderer.scene,
      physics,
      (label) => {
        scoreState.value += 1;
        killFeed.show(label);
      },
      {
        // hitPlayer damage/hurt-sound already happens inside Enemy.fireRangedShot via
        // player.takeDamage (which itself triggers Player's onDamaged hook) - this callback is
        // purely the cosmetic side (tracer/impact/gunshot), matching WeaponManager's own onFire wiring.
        onRangedShotFired: (origin, end, hitPlayer) => {
          tracers.spawn(origin, end, ENEMY_RANGED_TRACER_COLOR);
          impactMarkers.spawn(end, hitPlayer);
          // Attenuated by the shooter's distance from the player - a shot from 30 units away
          // shouldn't sound identical to one at point-blank (see ENEMY_GUNSHOT_* in config.ts).
          sound.playGunshot('enemy-rifle', enemyGunshotVolume(origin.distanceTo(player.position)));
        },
      },
    );

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
    const perfOverlay = new PerfOverlay(hudRoot);

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
      muzzleFlash,
      hud,
      hotbar,
      hitMarker,
      deathScreen,
      weaponCaption,
      longShotCallout,
      killFeed,
      scopeOverlay,
      pauseMenu,
      settingsPanel,
      perfOverlay,
      sound,
      scoreState,
      matchConfig,
      sun,
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
    document.removeEventListener('keydown', this.onDebugKeyDown);
    this.input.dispose();
    this.renderer.dispose();
    this.hud.dispose();
    this.hotbar.dispose();
    this.hitMarker.dispose();
    this.deathScreen.dispose();
    this.weaponCaption.dispose();
    this.longShotCallout.dispose();
    this.killFeed.dispose();
    this.scopeOverlay.dispose();
    this.pauseMenu.dispose();
    this.settingsPanel.dispose();
    this.perfOverlay.dispose();
    this.sound.dispose();
    // Invalidate any in-flight spawnEncountersAsync loop *before* freeing the physics world -
    // its frame-yielded batches would otherwise call createRigidBody on freed WASM memory.
    this.spawnGeneration++;
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
    const generation = ++this.spawnGeneration;
    void Game.spawnEncountersAsync(
      this.entityManager,
      this.matchConfig.targetCount,
      this.matchConfig.enemyCount,
      undefined,
      () => this.spawnGeneration !== generation,
    );
    this.impactMarkers.clear();
    this.tracers.clear();
    this.scoreState.value = 0;
    this.deathScreen.hide();
    this.input.requestPointerLock();
  }

  private static addLighting(scene: THREE.Scene, quality: GraphicsQualityPreset): THREE.DirectionalLight {
    // On High, Renderer assigns scene.environment (a PMREM of the sky) for plausible
    // sky/ground-bounced fill (VISUAL_REALISM.md §5). On Low/Medium that image-based lighting is
    // disabled (ruinous on the software-rendered e2e sandbox - see
    // GraphicsQualityPreset.environmentLighting), so a flat AmbientLight stands in as cheap fill,
    // otherwise every surface facing away from the sun would render nearly black.
    if (!quality.environmentLighting) {
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    }

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(SUN_DIRECTION_X, SUN_DIRECTION_Y, SUN_DIRECTION_Z);
    // Renderer's shadowMap.enabled already gates the whole shadow pass on Low - this additionally
    // keeps the light itself from ever being asked to cast, rather than relying solely on the
    // renderer-level switch.
    sun.castShadow = quality.shadowsEnabled;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    sun.shadow.camera.left = -SUN_SHADOW_ORTHO_HALF_EXTENT;
    sun.shadow.camera.right = SUN_SHADOW_ORTHO_HALF_EXTENT;
    sun.shadow.camera.top = SUN_SHADOW_ORTHO_HALF_EXTENT;
    sun.shadow.camera.bottom = -SUN_SHADOW_ORTHO_HALF_EXTENT;
    sun.shadow.camera.far = SUN_SHADOW_CAMERA_FAR;
    sun.shadow.bias = SUN_SHADOW_BIAS;
    sun.shadow.normalBias = SUN_SHADOW_NORMAL_BIAS;
    scene.add(sun);
    scene.add(sun.target);
    return sun;
  }

  /** Ring radius that keeps a fixed base size for small counts but grows for large ones so spawns don't stack. */
  private static ringRadius(count: number, baseRadius: number): number {
    if (count <= 1) return baseRadius;
    const spacingRadius = (count * RING_SPACING) / (Math.PI * 2);
    return Math.max(baseRadius, spacingRadius);
  }

  /** Spawns the chosen number of targets/enemies in batches, yielding a frame between batches so
   * large match sizes stay responsive and a loading screen can show real progress. `isCancelled`
   * is checked after every yielded frame - a reset or dispose that happens mid-spawn invalidates
   * the rest of this loop instead of letting it keep pushing entities (or worse, touch a freed
   * physics world). The initial create()-time spawn is awaited before a Game instance exists, so
   * it can't be cancelled and passes nothing. */
  private static async spawnEncountersAsync(
    entityManager: EntityManager,
    targetCount: number,
    enemyCount: number,
    onProgress?: (status: string, ratio: number) => void,
    isCancelled?: () => boolean,
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
      if (done % SPAWN_BATCH_SIZE === 0) {
        await waitForNextFrame();
        if (isCancelled?.()) return;
      }
    }

    const enemyRadius = Game.ringRadius(enemyCount, ENEMY_RING_BASE_RADIUS);
    for (let i = 0; i < enemyCount; i++) {
      const angle = (i / enemyCount) * Math.PI * 2 + 0.5;
      const x = SPAWN_X + Math.cos(angle) * enemyRadius;
      const z = SPAWN_Z + Math.sin(angle) * enemyRadius;
      entityManager.spawnEnemy(new THREE.Vector3(x, sampleHeight(x, z) + 1, z));
      done++;
      report(`Deploying enemies… (${done}/${total})`);
      if (done % SPAWN_BATCH_SIZE === 0) {
        await waitForNextFrame();
        if (isCancelled?.()) return;
      }
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

    if (this.pendingDebugDamage > 0) {
      this.player.takeDamage(this.pendingDebugDamage);
      this.pendingDebugDamage = 0;
    }

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
    this.muzzleFlash.update(dt);
    this.hitMarker.update(dt);
    this.weaponCaption.update(dt);
    this.longShotCallout.update(dt);
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

  private readonly render = (alpha: number): void => {
    const now = performance.now();
    this.fpsMeter.recordFrame(now - this.lastRenderTime);
    this.lastRenderTime = now;
    this.perfOverlay.update(this.fpsMeter.getStats(), this.entityManager.count);

    // Loop's fixed-timestep accumulator already computed this fractional tick progress, but it
    // went unused. Scoped to just the camera (and anything parented to it, i.e. the weapon view
    // models) as the highest-value, lowest-risk slice - it's what the player is actually looking
    // through, and unlike interpolating every enemy/target mesh, it needs no new per-entity
    // prev/current bookkeeping or e2e position-reporting changes.
    this.player.interpolateCamera(alpha);
    this.updateSunFollow();
    this.renderer.render();
  };

  /** F3 toggles the perf overlay - a dev tool, not a rebindable gameplay action, so it
   * deliberately bypasses the Action/InputManager system entirely (same reasoning as
   * openPauseMenu's raw pointer-lock call in the e2e helpers - some things aren't player controls). */
  private readonly onDebugKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'F3') this.perfOverlay.toggle();
  };
}
