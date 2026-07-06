import * as THREE from 'three';
import { Renderer } from './Renderer.ts';
import { InputManager } from '../input/InputManager.ts';
import { Loop } from './Loop.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Player } from '../entities/Player.ts';
import { RemotePlayer } from '../entities/RemotePlayer.ts';
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
import { DamageVignette } from '../ui/damageVignette.ts';
import { DeathScreen } from '../ui/deathScreen.ts';
import type { MultiplayerMatchEndResult } from '../ui/matchEndScreen.ts';
import { WeaponCaption } from '../ui/weaponCaption.ts';
import { LongShotCallout } from '../ui/longShotCallout.ts';
import { KillFeed } from '../ui/killFeed.ts';
import { Minimap } from '../ui/minimap.ts';
import { MultiplayerHud } from '../ui/multiplayerHud.ts';
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
  MULTIPLAYER_RESPAWN_DELAY,
  PLAYER_SNAPSHOT_SEND_INTERVAL,
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
import { getWorldSeed, randomizeWorldSeed, setWorldSeed } from './worldSeed.ts';
import { pickRandomRespawnPoint } from './multiplayerSpawn.ts';
import { Settings } from '../settings/Settings.ts';
import { GRAPHICS_QUALITY_PRESETS, type GraphicsQualityPreset } from '../settings/graphicsQuality.ts';
import type { MultiplayerMatchStartParams, MultiplayerSession } from '../network/MultiplayerSession.ts';

const SPAWN_HEIGHT_OFFSET = 2;
const TARGET_RING_BASE_RADIUS = 15;
/** Desired arc distance between neighboring spawns once a ring's base radius is too cramped for its count. */
const RING_SPACING = 2.2;
/** Entities spawned per batch before yielding a frame, so large match sizes don't spawn as one long stall. */
const SPAWN_BATCH_SIZE = 4;
/** Flat ambient fill used on Low/Medium graphics quality in place of image-based lighting (see
 * Game.addLighting/applyGraphicsQuality). */
const AMBIENT_FILL_INTENSITY = 0.6;

export interface MatchConfig {
  enemyCount: number;
  targetCount: number;
}

/** Everything Game tracks about an in-progress multiplayer match beyond the MultiplayerSession it
 * was handed (see network/MultiplayerSession.ts) - the parts that only exist once the match is
 * actually running, not at hand-off time. `snapshotAccumulator` is mutated every tick (see
 * update()); the object itself is still only ever assigned once, at construction. */
interface ActiveMultiplayer {
  readonly session: MultiplayerSession;
  readonly remotePlayer: RemotePlayer;
  readonly minimap: Minimap;
  readonly multiplayerHud: MultiplayerHud;
  /** Win condition (MULTIPLAYER_PLAN.md §4): first to this many kills wins. Fixed for the match -
   * the host's choice at room-creation time, carried on MatchStartMessage. */
  readonly killLimit: number;
  snapshotAccumulator: number;
  /** Counts up while this client's own player is dead; 0 whenever alive. Compared against
   * MULTIPLAYER_RESPAWN_DELAY in updateMultiplayer() to trigger the automatic respawn. */
  deathTimer: number;
  /** The opponent's last-reported health (piggybacked on their own playerSnapshot messages - see
   * protocol.ts) - this client has no other way to know it, since it's never authoritative over
   * the opponent's health (MULTIPLAYER_PLAN.md §3/§6). Starts at full health, matching what a
   * freshly spawned opponent actually has before their first snapshot ever arrives. */
  opponentHealth: number;
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Host always spawns at spawnA, guest always at spawnB - fixed for the whole match
 * (MULTIPLAYER_PLAN.md §4a), never randomized or swapped *within* a match, though the points
 * themselves are picked fresh by the host each match (see multiplayerSpawn.ts and the
 * MultiplayerSession comment). Returns [ownSpawn, opponentSpawn]. */
function multiplayerSpawnPoints(session: MultiplayerSession): [THREE.Vector2, THREE.Vector2] {
  const spawnA = new THREE.Vector2(session.spawnA.x, session.spawnA.z);
  const spawnB = new THREE.Vector2(session.spawnB.x, session.spawnB.z);
  return session.role === 'host' ? [spawnA, spawnB] : [spawnB, spawnA];
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
  /** Multiplayer only (MULTIPLAYER_PLAN.md §7 phase 2) - null outside a multiplayer match. The
   * opponent's last-smoothed RemotePlayer position, for e2e verification that movement sync is
   * actually reaching the other client, not just that a connection exists. */
  getOpponentPosition(): { x: number; y: number; z: number } | null;
  /** Multiplayer only (MULTIPLAYER_PLAN.md §7 phase 4) - this client's own death count, which
   * equals the opponent's kill count from this client's point of view (see Game's
   * multiplayerDeathCount comment). 0 outside a multiplayer match. */
  getOpponentScore(): number;
  /** Multiplayer only - true once the win condition (or a disconnect) has ended the match and
   * simulation has frozen. Always false outside a multiplayer match. */
  isMultiplayerMatchEnded(): boolean;
  /** Test-only, like damagePlayer above: explicitly closes this client's own connection, the same
   * way PeerConnection.dispose() would, so a disconnect-handling test can trigger Game's
   * onDisconnected path deterministically and quickly. A real opponent vanishing (closed tab, lost
   * network) is instead detected via WebRTC's own close/ICE-failure signals, which - unlike this -
   * have no bound on how long they take to fire; that timing isn't this feature's concern to test. */
  debugDisconnect(): void;
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
  /** Damage from a network `damageEvent`, applied inside the next update tick rather than
   * immediately in the WebRTC message callback - update() detects death by comparing isDead
   * across the tick (wasDead), so applying it outside a tick boundary would make the death
   * transition unobservable (isDead would already be true before wasDead is captured), and
   * neither the death screen nor the `playerDied` reply would ever fire. */
  private pendingNetworkDamage = 0;
  /** Counts this client's own deaths in multiplayer - equivalently, the opponent's kill count,
   * since every death here is a kill for them (see the death-transition block in update()). */
  private multiplayerDeathCount = 0;
  /** True once the win condition (or a disconnect) has ended a multiplayer match - freezes
   * simulation the same way `player.isDead` does, but permanently for the rest of this Game
   * instance's life rather than until a respawn (see the top of update()). */
  private matchEnded = false;

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
    private readonly damageVignette: DamageVignette,
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
    private readonly ambientLight: THREE.AmbientLight,
    private readonly multiplayer: ActiveMultiplayer | null,
    private readonly onMultiplayerMatchEnd?: (result: MultiplayerMatchEndResult) => void,
    /** Fired when a matchStart message arrives *after* this Game already exists - the guest's
     * signal that the host clicked Rematch (see MatchEndScreen / App.restartMultiplayerMatch); the
     * initial matchStart is always consumed by the room screen before Game.create() ever attaches
     * its own message handler, so any matchStart Game itself sees is necessarily this case. */
    private readonly onMultiplayerRematchReceived?: (params: MultiplayerMatchStartParams) => void,
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
      getOpponentPosition: () => {
        if (!this.multiplayer) return null;
        const p = this.multiplayer.remotePlayer.position;
        return { x: p.x, y: p.y, z: p.z };
      },
      getOpponentScore: () => this.multiplayerDeathCount,
      isMultiplayerMatchEnded: () => this.matchEnded,
      debugDisconnect: () => this.multiplayer?.session.connection.dispose(),
    };
  }

  static async create(
    container: HTMLElement,
    hudRoot: HTMLElement,
    matchConfig: MatchConfig,
    onProgress?: (status: string, ratio: number) => void,
    onReturnToLobby?: () => void,
    multiplayer?: MultiplayerSession,
    onMultiplayerMatchEnd?: (result: MultiplayerMatchEndResult) => void,
    onMultiplayerRematchReceived?: (params: MultiplayerMatchStartParams) => void,
  ): Promise<Game> {
    onProgress?.('Initializing world…', 0);
    // Single-player: a new seed per match (not per practice-reset) so each new game generates a
    // different world. Multiplayer: both sides use the exact same externally-generated seed (see
    // MULTIPLAYER_PLAN.md §1) - never randomizeWorldSeed() here, or the two players' worlds would
    // diverge. Either way the seed then stays fixed for the rest of this match.
    if (multiplayer) {
      setWorldSeed(multiplayer.seed);
    } else {
      randomizeWorldSeed();
    }
    // Initial value only - the pause menu's Settings panel can change this live afterward (see
    // applyGraphicsQuality), this is just what a freshly created match starts with.
    const quality = GRAPHICS_QUALITY_PRESETS[Settings.getGraphicsQuality()];
    const renderer = new Renderer(container, quality);
    const input = new InputManager(renderer.canvas);
    const physics = await PhysicsWorld.create();

    const { sun, ambientLight } = Game.addLighting(renderer.scene, quality);

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

    // Multiplayer: each client spawns at its own designated point (MULTIPLAYER_PLAN.md §4a), not
    // the shared single-player one - host always A, guest always B.
    const [ownSpawn, opponentSpawn] = multiplayer
      ? multiplayerSpawnPoints(multiplayer)
      : [new THREE.Vector2(SPAWN_X, SPAWN_Z), null];

    // Seed enough chunks around spawn up front so the player never spawns over an ungenerated gap.
    for (let i = 0; i < 30; i++) {
      chunkManager.update(ownSpawn.x, ownSpawn.y);
    }

    const sound = await SoundEngine.create();
    document.addEventListener('click', () => sound.resume(), { once: true });

    const damageVignette = new DamageVignette(hudRoot);
    const spawnY = sampleHeight(ownSpawn.x, ownSpawn.y) + SPAWN_HEIGHT_OFFSET;
    const player = new Player(physics, renderer.camera, new THREE.Vector3(ownSpawn.x, spawnY, ownSpawn.y), {
      onDamaged: () => {
        sound.playPlayerHurt();
        damageVignette.trigger();
      },
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
      (start, end) => {
        tracers.spawn(start, end);
        // Purely cosmetic on the receiving end (MULTIPLAYER_PLAN.md §3) - the shot itself already
        // resolved locally (damage, if any, is reported separately via the hit pipeline below).
        multiplayer?.connection.send({
          type: 'fireEvent',
          originX: start.x,
          originY: start.y,
          originZ: start.z,
          endX: end.x,
          endY: end.y,
          endZ: end.z,
        });
      },
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

    // Multiplayer matches are pure PvP (MULTIPLAYER_PLAN.md's premise: the bot/enemy system is
    // single-player "training" only) - never spawn AI encounters here, regardless of matchConfig.
    if (!multiplayer) {
      await Game.spawnEncountersAsync(entityManager, matchConfig.targetCount, matchConfig.enemyCount, (status, spawnRatio) => {
        onProgress?.(status, 0.15 + spawnRatio * 0.85);
      });
    }

    // opponentSpawn is non-null exactly when multiplayer is present (see the destructure above) -
    // the RemotePlayer's initial position doesn't need to wait for a first network snapshot,
    // since both sides already know where the opponent starts.
    let activeMultiplayer: ActiveMultiplayer | null = null;
    if (multiplayer && opponentSpawn) {
      const remotePlayer = await RemotePlayer.create(
        physics,
        renderer.scene,
        new THREE.Vector3(opponentSpawn.x, sampleHeight(opponentSpawn.x, opponentSpawn.y) + SPAWN_HEIGHT_OFFSET, opponentSpawn.y),
        // The opponent's own client is what actually applies this to its health - see the class
        // comment on RemotePlayer and the DamageEventMessage comment in protocol.ts.
        (amount) => multiplayer.connection.send({ type: 'damageEvent', amount }),
      );
      activeMultiplayer = {
        session: multiplayer,
        remotePlayer,
        minimap: new Minimap(hudRoot),
        multiplayerHud: new MultiplayerHud(hudRoot),
        killLimit: multiplayer.killLimit,
        snapshotAccumulator: 0,
        deathTimer: 0,
        opponentHealth: player.currentHealth,
      };
    }

    const hud = new Hud(hudRoot);
    if (activeMultiplayer) {
      // MultiplayerHud (constructed above, alongside the rest of activeMultiplayer) shows both
      // players' health/score in different positions - the single-player-shaped elements here
      // would just be a redundant, incomplete (own-only) duplicate.
      hud.setScoreVisible(false);
      hud.setHealthVisible(false);
    }
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
    const settingsPanel = new SettingsPanel(
      hudRoot,
      () => settingsPanel.hide(),
      (value) => sound.setMasterVolume(value),
      (quality) => gameRef.current?.applyGraphicsQuality(GRAPHICS_QUALITY_PRESETS[quality]),
    );
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
      damageVignette,
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
      ambientLight,
      activeMultiplayer,
      onMultiplayerMatchEnd,
      onMultiplayerRematchReceived,
    );
    gameRef.current = game;

    // Takes over from the room screen's own connection callbacks (which only knew how to update
    // now-hidden UI) - see PeerConnection.setCallbacks. `onDisconnected` ends the match rather than
    // leaving the RemotePlayer frozen in place (MULTIPLAYER_PLAN.md §7 phase 4) - there's no
    // Rematch option once the connection itself is gone, only Return to Lobby.
    if (activeMultiplayer) {
      activeMultiplayer.session.connection.setCallbacks({
        onConnected: () => {},
        onDisconnected: () => game.endMultiplayerMatch(false, 'opponentDisconnected'),
        // A dropped connection can surface as a WebRTC/PeerJS error rather than a clean 'close'
        // event (e.g. an abrupt network loss instead of a graceful page unload) - either way, from
        // the remaining player's perspective the match is over the same way.
        onError: () => game.endMultiplayerMatch(false, 'opponentDisconnected'),
        onMessage: (message) => {
          switch (message.type) {
            case 'matchStart':
              // The initial matchStart is always consumed by the room screen before this handler
              // ever attaches - any matchStart seen here is the host's Rematch signal.
              game.onMultiplayerRematchReceived?.({
                seed: message.seed,
                killLimit: message.killLimit,
                spawnA: { x: message.spawnAX, z: message.spawnAZ },
                spawnB: { x: message.spawnBX, z: message.spawnBZ },
              });
              break;
            case 'playerSnapshot':
              activeMultiplayer.remotePlayer.applySnapshot(message.x, message.y, message.z, message.yaw);
              activeMultiplayer.opponentHealth = message.health;
              break;
            case 'fireEvent': {
              // Purely cosmetic (MULTIPLAYER_PLAN.md §3) - the opponent's own client already
              // resolved whether this shot actually hit anything; this just makes it visible here too.
              const origin = new THREE.Vector3(message.originX, message.originY, message.originZ);
              const end = new THREE.Vector3(message.endX, message.endY, message.endZ);
              tracers.spawn(origin, end);
              muzzleFlash.spawn(origin);
              break;
            }
            case 'damageEvent':
              // This client is authoritative over its own player's health (MULTIPLAYER_PLAN.md
              // §3/§6) - the opponent only ever reports "you took N," never "you're dead."
              // Queued rather than applied here directly - see pendingNetworkDamage.
              game.pendingNetworkDamage += message.amount;
              break;
            case 'playerDied':
              // The opponent has no visibility into this client's actual health, only whatever
              // damage it's dealt - this is how it learns a kill actually landed.
              scoreState.value += 1;
              killFeed.show('Opponent eliminated');
              break;
            case 'respawnEvent':
              activeMultiplayer.remotePlayer.teleportTo(message.x, message.y, message.z);
              break;
          }
        },
      });
    }

    return game;
  }

  start(): void {
    this.loop.start();
  }

  /** Tears down everything this Game instance owns - WebGL context, DOM-appended HUD/menu
   * elements, and input listeners - so App can cleanly return to the lobby and later start a
   * fresh match without leaking GL contexts or stacking duplicate HUD nodes.
   *
   * `keepConnectionAlive` (MULTIPLAYER_PLAN.md §7 phase 4): set when App is tearing this Game down
   * to immediately create a fresh one on the same room for a rematch - the underlying
   * PeerConnection must survive the swap, or there'd be no connection left for the new Game to use. */
  dispose(options?: { keepConnectionAlive?: boolean }): void {
    this.loop.stop();
    document.removeEventListener('keydown', this.onDebugKeyDown);
    this.input.dispose();
    this.renderer.dispose();
    this.hud.dispose();
    this.hotbar.dispose();
    this.hitMarker.dispose();
    this.damageVignette.dispose();
    this.deathScreen.dispose();
    this.weaponCaption.dispose();
    this.longShotCallout.dispose();
    this.killFeed.dispose();
    this.scopeOverlay.dispose();
    this.pauseMenu.dispose();
    this.settingsPanel.dispose();
    this.perfOverlay.dispose();
    this.sound.dispose();
    this.multiplayer?.remotePlayer.dispose(this.renderer.scene);
    this.multiplayer?.minimap.dispose();
    this.multiplayer?.multiplayerHud.dispose();
    if (!options?.keepConnectionAlive) {
      this.multiplayer?.session.connection.dispose();
    }
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
   * after releasePointerLock() freed the mouse to make its buttons clickable.
   *
   * Multiplayer: routes to multiplayerRespawn() instead, and only while actually dead - pressing T
   * (or clicking the death screen's Respawn button, which calls this same method) mid-match while
   * still alive must stay a no-op, or it'd let a losing player escape a fight by teleporting home
   * on demand. Auto-respawn (MULTIPLAYER_RESPAWN_DELAY after death, see updateMultiplayer) already
   * calls multiplayerRespawn() on its own, so this is just a way to skip that wait, not a separate
   * reset path - it must never touch matchConfig/entityManager (there's no AI to reset, and
   * spawnEncountersAsync must never run in a multiplayer match at all). */
  private resetPlay(): void {
    if (this.multiplayer) {
      if (this.player.isDead) this.multiplayerRespawn();
      return;
    }

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

  /** AmbientLight is always created (so applyGraphicsQuality can toggle its intensity live) but is
   * only non-zero on Low/Medium - on High, Renderer assigns scene.environment (a PMREM of the sky)
   * for plausible sky/ground-bounced fill instead (VISUAL_REALISM.md §5). Image-based lighting is
   * disabled on Low/Medium (ruinous on the software-rendered e2e sandbox - see
   * GraphicsQualityPreset.environmentLighting), so this flat fill stands in there, otherwise every
   * surface facing away from the sun would render nearly black. */
  private static addLighting(
    scene: THREE.Scene,
    quality: GraphicsQualityPreset,
  ): { sun: THREE.DirectionalLight; ambientLight: THREE.AmbientLight } {
    const ambientLight = new THREE.AmbientLight(0xffffff, quality.environmentLighting ? 0 : AMBIENT_FILL_INTENSITY);
    scene.add(ambientLight);

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
    return { sun, ambientLight };
  }

  /** Everything a Graphics Quality change affects outside Renderer (see Renderer.applyQuality) -
   * called live from the pause menu's Settings panel, so changing the setting takes effect on the
   * very next frame rather than requiring a fresh match. Shadow map resolution is the one part
   * that can't just be reassigned: an already-rendered shadow map is a GPU render target sized at
   * creation, so a size change disposes it and clears the reference, which makes three.js allocate
   * a fresh one at the new size the next time the shadow pass runs. */
  private applyGraphicsQuality(quality: GraphicsQualityPreset): void {
    this.renderer.applyQuality(quality);
    this.ambientLight.intensity = quality.environmentLighting ? 0 : AMBIENT_FILL_INTENSITY;
    this.sun.castShadow = quality.shadowsEnabled;
    if (this.sun.shadow.mapSize.width !== quality.shadowMapSize) {
      this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
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
    // Match end (MULTIPLAYER_PLAN.md §7 phase 4) freezes simulation permanently for the rest of
    // this Game instance, unlike a single death - MatchEndScreen (shown by App, not Game) is what
    // the player sees, and it stays alive underneath until Rematch/Return to Lobby is clicked.
    if (this.matchEnded) {
      this.input.consumeLookDelta();
      return;
    }

    // Pointer lock is the single source of truth for "paused": pressing Escape forces the browser
    // to release it (can't be prevented), and a freshly loaded match starts unlocked too - both
    // cases should show the pause menu and freeze simulation. Death has its own overlay instead.
    const isPaused = !this.input.isLocked && !this.player.isDead;
    this.pauseMenu.setVisible(isPaused);

    // Single-player can freeze everything unconditionally while paused - nothing else is "live"
    // to notice. Multiplayer can't: the opponent's client keeps running and keeps sending
    // damageEvent/playerDied regardless of this client's own pause state, so pausing must never be
    // a way to dodge incoming damage - without this exception, all queued damage would just pile
    // up unapplied and land in one lump the instant the player unpaused, meaning they could simply
    // never unpause to become effectively unkillable while still looking alive to the opponent.
    if (isPaused && !this.multiplayer) {
      this.input.consumeLookDelta();
      return;
    }

    if (!isPaused && this.input.consumeJustPressed('resetPlay')) {
      this.resetPlay();
    }

    const wasDead = this.player.isDead;

    if (this.pendingNetworkDamage > 0) {
      this.player.takeDamage(this.pendingNetworkDamage);
      this.pendingNetworkDamage = 0;
    }

    if (this.pendingDebugDamage > 0) {
      this.player.takeDamage(this.pendingDebugDamage);
      this.pendingDebugDamage = 0;
    }

    // Advances the RemotePlayer's damped position/collider *before* this tick's own hitscan can
    // fire, not after - moved here from the end of update() (see the old updateMultiplayer, which
    // ran after weaponManager.update()) because that ordering meant every shot raycast against a
    // collider position that was one whole extra frame stale on top of the network sync lag
    // already inherent to the snapshot-sync model, silently shrinking the real hit window on top
    // of that inherent lag for no reason - fixable, unlike the network lag itself.
    this.multiplayer?.remotePlayer.update(dt);

    if (this.player.isDead || isPaused) {
      // Keep draining look input so it doesn't build up a stale jump in camera angle on
      // respawn/unpause. Also covers the multiplayer-paused case above: local simulation (movement,
      // shooting, AI) stays frozen while paused - only network damage/death/respawn keeps flowing.
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
    this.damageVignette.update(dt);
    this.weaponCaption.update(dt);
    this.longShotCallout.update(dt);
    this.killFeed.update(dt);
    this.updateMultiplayer(dt);

    if (this.player.isDead && !wasDead) {
      this.deathScreen.show(this.scoreState.value);
      this.input.releasePointerLock();
      if (this.multiplayer) {
        // The opponent has no visibility into this client's health - this is the only way they
        // learn a kill actually landed (MULTIPLAYER_PLAN.md §3). Every death here is a kill for
        // them, so this also doubles as their score from this client's point of view.
        this.multiplayer.session.connection.send({ type: 'playerDied' });
        this.multiplayerDeathCount += 1;
      }
    }

    this.hud.setAmmo(this.weaponManager.ammo, this.weaponManager.magazineSize, this.weaponManager.isReloading);
    this.hud.setWeaponName(this.weaponManager.weaponName);
    this.hud.setScore(this.scoreState.value);
    this.hud.setHealth(this.player.currentHealth, this.player.maxHealth);
    this.hotbar.setActive(this.weaponManager.activeWeaponIndex);
  };

  /** RemotePlayer always smooths toward its last snapshot every tick, independent of send timing -
   * `snapshotAccumulator` only gates how often *this* client broadcasts its own state
   * (PLAYER_SNAPSHOT_SEND_INTERVAL, ~18Hz - see MULTIPLAYER_PLAN.md §3), not how often the
   * opponent's visual position gets smoothed. */
  private updateMultiplayer(dt: number): void {
    if (!this.multiplayer) return;

    // RemotePlayer's own position/collider is advanced earlier in update(), before this tick's
    // hitscan can fire (see that call site's comment) - this just reads the already-updated
    // position for the minimap.
    this.multiplayer.minimap.update(this.player.position, this.multiplayer.remotePlayer.position);
    this.multiplayer.multiplayerHud.update(
      this.player.currentHealth,
      this.player.maxHealth,
      this.multiplayer.opponentHealth,
      this.scoreState.value,
      this.multiplayerDeathCount,
    );

    // Win condition (MULTIPLAYER_PLAN.md §4): first to killLimit ends the match. Checked here
    // rather than where each score actually changes (the `playerDied` handler for my own kills,
    // the death-transition block for the opponent's) so there's exactly one place that decides
    // "the match is over," regardless of which side's counter just crossed the line.
    if (!this.matchEnded) {
      if (this.scoreState.value >= this.multiplayer.killLimit) {
        this.endMultiplayerMatch(true, 'killLimit');
      } else if (this.multiplayerDeathCount >= this.multiplayer.killLimit) {
        this.endMultiplayerMatch(false, 'killLimit');
      }
    }
    if (this.matchEnded) return;

    if (this.player.isDead) {
      this.multiplayer.deathTimer += dt;
      if (this.multiplayer.deathTimer >= MULTIPLAYER_RESPAWN_DELAY) {
        this.multiplayerRespawn();
      }
      return;
    }

    this.multiplayer.snapshotAccumulator += dt;
    if (this.multiplayer.snapshotAccumulator >= PLAYER_SNAPSHOT_SEND_INTERVAL) {
      this.multiplayer.snapshotAccumulator = 0;
      const p = this.player.position;
      this.multiplayer.session.connection.send({
        type: 'playerSnapshot',
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: this.player.facingYaw,
        pitch: this.player.facingPitch,
        health: this.player.currentHealth,
      });
    }
  }

  /** Respawns this client's own player at a fresh random spawn point (per user request - every
   * death picks a new spot from MULTIPLAYER_SPAWN_POINTS, not always the same one used at match
   * start) - triggered automatically MULTIPLAYER_RESPAWN_DELAY seconds after death (see
   * updateMultiplayer), or immediately via the death screen's Respawn button/T key (see
   * resetPlay). Deliberately does not touch scoreState - a kill/death in multiplayer shouldn't
   * reset the running score the way single-player's practice-reset does.
   *
   * Picked independently by this client alone, using plain Math.random() (no cross-client
   * agreement needed) - the chosen position rides on the respawnEvent message already sent below,
   * which is how the opponent's RemotePlayer learns where to snap to either way. */
  private multiplayerRespawn(): void {
    if (!this.multiplayer) return;

    const { x, z } = pickRandomRespawnPoint();
    const spawnY = sampleHeight(x, z) + SPAWN_HEIGHT_OFFSET;
    this.player.respawn(new THREE.Vector3(x, spawnY, z));
    this.multiplayer.deathTimer = 0;
    this.deathScreen.hide();
    this.input.requestPointerLock();
    this.multiplayer.session.connection.send({ type: 'respawnEvent', x, y: spawnY, z });
  }

  /** Ends a multiplayer match, either because the win condition was reached (checked in
   * updateMultiplayer, both sides call this independently off their own local counters - see
   * MULTIPLAYER_PLAN.md §6 on why exact simultaneity isn't worth solving here) or because the
   * opponent disconnected (wired to PeerConnection's onDisconnected in create()). Freezes
   * simulation via `matchEnded` (see the top of update()) and hands off to App, which owns
   * MatchEndScreen and any rematch - Game itself never recreates or disposes itself. */
  private endMultiplayerMatch(won: boolean, reason: MultiplayerMatchEndResult['reason']): void {
    if (this.matchEnded || !this.multiplayer) return;
    this.matchEnded = true;
    this.input.releasePointerLock();
    this.onMultiplayerMatchEnd?.({
      reason,
      won,
      myScore: this.scoreState.value,
      opponentScore: this.multiplayerDeathCount,
      killLimit: this.multiplayer.killLimit,
      role: this.multiplayer.session.role,
      connection: this.multiplayer.session.connection,
    });
  }

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
