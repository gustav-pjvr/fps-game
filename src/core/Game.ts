import * as THREE from 'three';
import { Renderer } from './Renderer.ts';
import { InputManager } from '../input/InputManager.ts';
import { Loop } from './Loop.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Player } from '../entities/Player.ts';
import { RemotePlayer } from '../entities/RemotePlayer.ts';
import { EntityManager } from '../entities/EntityManager.ts';
import { GooseManager } from '../entities/GooseManager.ts';
import { ThrownGoose } from '../entities/ThrownGoose.ts';
import { GoldenGooseManager } from '../entities/GoldenGooseManager.ts';
import { AmmoDropManager } from '../entities/AmmoDropManager.ts';
import { HordeGooseManager } from '../entities/HordeGooseManager.ts';
import { BonusGooseManager } from '../entities/BonusGooseManager.ts';
import { BuildingManager } from '../world/BuildingManager.ts';
import { RoadManager } from '../world/RoadManager.ts';
import { isPointInsideWatchTower, WatchTowerManager } from '../world/WatchTowerManager.ts';
import { ChunkManager } from '../world/ChunkManager.ts';
import { VegetationManager } from '../world/VegetationManager.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { WeaponManager } from '../weapons/WeaponManager.ts';
import { WEAPON_DEFINITIONS } from '../weapons/definitions.ts';
import { ImpactMarkers } from '../combat/ImpactMarkers.ts';
import { MuzzleFlash } from '../combat/MuzzleFlash.ts';
import { Tracers } from '../combat/Tracers.ts';
import { ExplosionEffect } from '../combat/ExplosionEffect.ts';
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
import { GooseAnnouncement } from '../ui/gooseAnnouncement.ts';
import { BigAnnouncement } from '../ui/bigAnnouncement.ts';
import { HordeWaveIndicator } from '../ui/hordeWaveIndicator.ts';
import { ModeExplanationScreen } from '../ui/modeExplanationScreen.ts';
import { Minimap } from '../ui/minimap.ts';
import { MultiplayerHud } from '../ui/multiplayerHud.ts';
import { PauseMenu } from '../ui/menu/PauseMenu.ts';
import { SettingsPanel } from '../ui/menu/SettingsPanel.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { isDamageable } from '../combat/damage.ts';
import { computeExplosionDamage, computeKnockbackStrength } from '../combat/explosion.ts';
import { SoundEngine } from '../audio/SoundEngine.ts';
import { FpsMeter } from './FpsMeter.ts';
import { PerfOverlay } from '../ui/perfOverlay.ts';
import { computeStereoPan, enemyGunshotVolume } from './positionalAudio.ts';
import type {} from './gameDebugApi.ts';
import {
  ENEMY_RANGED_TRACER_COLOR,
  ENEMY_RING_BASE_RADIUS,
  type GooseExplosionDifficulty,
  GOOSE_MAX_CONCURRENT,
  GOOSE_RADIUS,
  GOOSE_THROW_MAX_LIFETIME_SECONDS,
  GOOSE_TOSS_EXPLOSION_KNOCKBACK_STRENGTH,
  GOOSE_TOSS_EXPLOSION_MAX_DAMAGE,
  GOOSE_TOSS_EXPLOSION_RADIUS,
  GOOSE_TOSS_MAX_CONCURRENT,
  GOOSE_TOSS_SPAWN_INTERVAL_SECONDS,
  DEFAULT_MATCH_WEATHER,
  GOOSE_LAUNCHER_EXPLOSION_KNOCKBACK_STRENGTH,
  GOOSE_LAUNCHER_EXPLOSION_MAX_DAMAGE,
  GOOSE_LAUNCHER_EXPLOSION_RADIUS,
  GOOSE_LAUNCHER_PROJECTILE_SPEED,
  HORDE_AMMO_DROP_PICKUP_RADIUS,
  HORDE_AMMO_DROP_REFILL_MAGAZINES,
  HORDE_GOOSE_EXPLOSION_MAX_DAMAGE,
  HORDE_GOOSE_EXPLOSION_RADIUS,
  HORDE_GOOSE_KNOCKBACK_STRENGTH,
  HORDE_MAX_RESPAWNS,
  HORDE_PLAYER_SPAWN_MAX_RADIUS,
  HORDE_PLAYER_SPAWN_MIN_RADIUS,
  HORDE_STARTING_RESERVE_MAGAZINES,
  HORDE_WAVE_TABLE,
  HORDE_WAVE_TABLE_MULTIPLAYER,
  KOTH_POINTS_TO_WIN,
  type MatchWeather,
  MULTIPLAYER_CONNECTION_TIMEOUT_MS,
  MULTIPLAYER_KILL_CREDIT_WINDOW_MS,
  MULTIPLAYER_RESPAWN_DELAY,
  NIGHT_AMBIENT_INTENSITY,
  NIGHT_SUN_COLOR,
  NIGHT_SUN_INTENSITY,
  PLAYER_RADIUS,
  PLAYER_SNAPSHOT_SEND_INTERVAL,
  SPAWN_STRUCTURE_CLEARANCE,
  SPAWN_X,
  SPAWN_Z,
  SUN_DIRECTION_X,
  SUN_DIRECTION_Y,
  SUN_DIRECTION_Z,
  SUN_SHADOW_BIAS,
  SUN_SHADOW_CAMERA_FAR,
  SUN_SHADOW_NORMAL_BIAS,
  SUN_SHADOW_ORTHO_HALF_EXTENT,
  APP_VERSION,
} from './config.ts';
import { getWorldSeed, randomizeWorldSeed, setWorldSeed } from './worldSeed.ts';
import { findClearSpawnPoint, pickRandomRespawnPoint, type SpawnBlockedCheck } from './multiplayerSpawn.ts';
import { DEFAULT_GAME_MODE, resolveWeaponLoadout, modeUsesCustomLoadout, type GameMode } from './gameModes.ts';
import { MODE_EXPLANATIONS } from './modeExplanations.ts';
import { loadStoredLoadout } from './loadout.ts';
import { LoadoutScreen } from '../ui/menu/LoadoutScreen.ts';
import { Settings } from '../settings/Settings.ts';
import { GRAPHICS_QUALITY_PRESETS, type GraphicsQualityPreset } from '../settings/graphicsQuality.ts';
import type { MultiplayerMatchStartParams, MultiplayerSession } from '../network/MultiplayerSession.ts';
import { HOST_SLOT, type PlayerSlot } from '../network/protocol.ts';
import type { ActiveMultiplayer, RemoteOpponent } from '../network/multiplayerMatchTypes.ts';
import { routeMatchMessage, type MatchMessageContext } from '../network/MatchMessageRouter.ts';
import { isHordeAllEliminated, MultiplayerMatchState } from '../network/MultiplayerMatchState.ts';
import { GooseTossController } from './modeControllers/GooseTossController.ts';
import { KingOfTheHillController } from './modeControllers/KingOfTheHillController.ts';
import { GunGameController } from './modeControllers/GunGameController.ts';

const SPAWN_HEIGHT_OFFSET = 2;
const TARGET_RING_BASE_RADIUS = 15;
/** Desired arc distance between neighboring spawns once a ring's base radius is too cramped for its count. */
const RING_SPACING = 2.2;
/** Entities spawned per batch before yielding a frame, so large match sizes don't spawn as one long stall. */
const SPAWN_BATCH_SIZE = 4;
/** Flat ambient fill used on Low/Medium graphics quality in place of image-based lighting (see
 * Game.addLighting/applyGraphicsQuality). */
const AMBIENT_FILL_INTENSITY = 0.6;
/** While this client has clicked Skip on the mode briefing and is still waiting on others, it
 * re-broadcasts its readiness this often (see resendModeExplanationReady). */
const MODE_EXPLANATION_READY_RESEND_SECONDS = 1;

export interface MatchConfig {
  enemyCount: number;
  targetCount: number;
  gooseDifficulty: GooseExplosionDifficulty;
  /** Single-player only (see PlaySetupModal) - multiplayer's equivalent is gameMode==='gooseHorde'
   * instead (unused/false here for a multiplayer match, same as enemyCount/targetCount's zeros). */
  hordeMode: boolean;
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Single-player Goose Horde's own spawn point - a random location on the map rather than the
 * fixed single-player spawn, per explicit user request ("not the middle"). Plain Math.random(),
 * not a seeded RNG - single-player has no other client that needs to agree on this. */
function pickRandomHordeSpawnPoint(isBlocked: SpawnBlockedCheck): THREE.Vector2 {
  const angle = Math.random() * Math.PI * 2;
  const radius = HORDE_PLAYER_SPAWN_MIN_RADIUS + Math.random() * (HORDE_PLAYER_SPAWN_MAX_RADIUS - HORDE_PLAYER_SPAWN_MIN_RADIUS);
  // This annulus overlaps towns and towers, so step off any structure the random point landed on.
  const clear = findClearSpawnPoint({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }, isBlocked);
  return new THREE.Vector2(clear.x, clear.z);
}

/** Single-player's fixed spawn, stepped off any house. The world seed is random per match and towns
 * are NOT kept clear of this point: measured across 2000 seeds, (SPAWN_X, SPAWN_Z) sat inside a
 * town in 123 of them (about 6%), so on those maps the player started inside or against a house and
 * every shot hit its wall. The target/enemy rings stay centred on the nominal spawn. */
function clearFixedSpawnPoint(isBlocked: SpawnBlockedCheck): THREE.Vector2 {
  const clear = findClearSpawnPoint({ x: SPAWN_X, z: SPAWN_Z }, isBlocked);
  return new THREE.Vector2(clear.x, clear.z);
}

/** Every player spawn path goes through this: "is (x, z) inside, or within SPAWN_STRUCTURE_CLEARANCE
 * of, a house or a watch tower?" Spawns used terrain height alone, so a point landing on a house or
 * a tower's stairs put the player inside its collider (the reason the multiplayer pause menu has an
 * unstick "Respawn" button at all). */
function makeSpawnBlockedCheck(buildings: BuildingManager): SpawnBlockedCheck {
  return (x, z) => buildings.isPointInsideBuilding(x, z, SPAWN_STRUCTURE_CLEARANCE) || isPointInsideWatchTower(x, z, SPAWN_STRUCTURE_CLEARANCE);
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
  /** Stamped once, at this exact Game instance's construction - the match-end telemetry beacon's
   * durationMs (see sendMatchTelemetry) is just `performance.now() - matchStartedAt` at whichever
   * moment the match actually ends. A field default rather than a constructor parameter since
   * there's nothing to pass in - "now, at construction time" is the only meaningful value this
   * could ever have. */
  private readonly matchStartedAt = performance.now();
  /** Bumped by resetPlay/dispose to cancel any in-flight spawnEncountersAsync loop - its batches
   * yield to requestAnimationFrame, so without this a second rapid reset kept both loops spawning
   * (entity count overshooting the configured match size), and returning to the lobby mid-spawn
   * had the surviving loop calling createRigidBody on an already-freed WASM world. */
  private spawnGeneration = 0;
  /** Damage requested via the debug API, applied inside the next update tick (see installDebugApi). */
  private pendingDebugDamage = 0;
  /** Damage from a network `damageEvent`, applied inside the next update tick rather than
   * immediately in the WebRTC message callback, so it lands in tick order with everything else.
   * Death detection no longer depends on that ordering (see deathHandled), since goose explosions
   * still apply damage straight from a network callback. */
  private pendingNetworkDamage = 0;
  /** True once the current death has been processed (death screen, playerDied broadcast, horde life,
   * KOTH drop); cleared the first tick the player is alive again. Replaces the old per-tick
   * `wasDead` comparison, which missed any death caused BETWEEN ticks: a guest killed by a goose or
   * horde explosion (applied directly from the gooseExploded/hordeGooseExploded message callback)
   * was already dead when the next tick captured wasDead, so no death screen, no playerDied and no
   * horde life lost; they froze for 3s and silently respawned. */
  private deathHandled = false;
  /** Fixed-step tick counter, used to collapse several hit confirmations in the same tick (a
   * shotgun's 8 pellets) into one hit marker and one sound. */
  private tickCount = 0;
  private lastHitConfirmTick = -1;
  /** Compared alongside lastActiveWeaponIndex: a Goose Launcher grant or a Gun Game upgrade swaps
   * the weapon inside the SAME slot, which the index alone never noticed (stale hotbar, no caption). */
  private lastActiveWeaponId = '';
  private modeExplanationResendAccumulator = 0;
  /** Set after construction (same forward-reference pattern as modeExplanationScreen); only needed
   * to build the mid-match Loadout page lazily, the first time the pause menu opens it. */
  private hudRoot: HTMLElement | null = null;
  private loadoutScreenLoading = false;
  private disposed = false;
  /** See makeSpawnBlockedCheck. Assigned in the constructor (it needs the BuildingManager). */
  private readonly isSpawnBlocked: SpawnBlockedCheck;
  /** Host only: set once when it announces a scoreboard winner (see endedMatchVerdict). */
  private hostDeclaredWinner: PlayerSlot | null = null;
  /** Set when death is detected while the pause menu is open (multiplayer only - single-player
   * can never die while paused, see the early-return above isPaused's own comment) - per user
   * request, the death/respawn screen must never visually overlay the pause menu. The death ITSELF
   * (network broadcast, scoreboard credit, goose spawn) still happens immediately regardless of
   * pause; only this UI reveal + pointer-lock release wait for the player to resume/close the
   * pause menu, checked at the top of update() every tick until it does. */
  private pendingDeathScreenReveal = false;
  /** True exactly while DeathScreen is actually shown - distinct from `player.isDead` now that a
   * dead player can exist for a while with the death screen deliberately not yet revealed (see
   * pendingDeathScreenReveal above). Drives `isPaused` below instead of `isDead` directly, so the
   * pause menu correctly stays visible through that deferral window instead of auto-hiding the
   * instant the player dies. */
  private deathScreenVisible = false;
  /** Goose Toss mode only - every ThrownGoose currently in flight, own throws and every other
   * player's alike (see ThrownGoose.ts's class comment on thrower-only authority). */
  private readonly thrownGeese = new Map<string, ThrownGoose>();
  /** Host-only (see update()'s Goose Toss ambient-supply block): throttles
   * GooseManager.spawnRandomOnMap to GOOSE_TOSS_SPAWN_INTERVAL_SECONDS instead of every frame. */
  private gooseTossSpawnAccumulator = 0;
  /** Goose Toss mode's own pickup/throw controller (see modeControllers/GooseTossController.ts) -
   * assigned once in create() right after construction, same forward-reference pattern as
   * modeExplanationScreen/loadoutScreen below. Null for every mode but Goose Toss. */
  private gooseTossController: GooseTossController | null = null;
  /** King of the Hill's own claim/drop/scoring controller (see
   * modeControllers/KingOfTheHillController.ts). Null for every mode but King of the Hill. */
  private kingOfTheHillController: KingOfTheHillController | null = null;
  /** Gun Game's own "one kill from winning" Goose Launcher grant controller (see
   * modeControllers/GunGameController.ts). Null for every mode but Gun Game. */
  private gunGameController: GunGameController | null = null;
  /** Owns the running scoreboard/death-count maps, the win-condition scan, and the "has the match
   * ended" flag (see network/MultiplayerMatchState.ts) - constructed unconditionally (harmlessly
   * unused in single-player, which has no scoreboard/match-end concept). */
  private readonly multiplayerMatchState = new MultiplayerMatchState();
  /** True from the moment a non-default-mode match is created until every player has dismissed the
   * mode-briefing screen (see ui/modeExplanationScreen.ts) - freezes all simulation (enemies, wave
   * spawners, everything) the same way `matchEnded` does, per explicit user request: "the world is
   * only truly active once all players or player is in the world." False for `default` mode
   * (nothing to explain) and for a mid-match late join/rejoin (see MultiplayerSession.
   * showModeExplanation). */
  private worldBriefingActive = false;
  /** Multiplayer only - every slot that has clicked Skip on the mode-briefing screen (own slot
   * included), populated by the self-reported/relayed `modeExplanationReady` message - same
   * "converge independently, no host adjudication" pattern as hordeEliminatedSlots. Unused (stays
   * empty) in single-player, which has nobody else to wait on. */
  private readonly modeExplanationReadySlots = new Set<PlayerSlot>();
  /** Snapshot of every slot actually present when the briefing began (own slot + every opponent at
   * that moment) - captured once in beginModeExplanation and only ever shrinks afterward (see
   * removeMultiplayerOpponent), never grows. A mid-briefing joiner's `showModeExplanation` is
   * always false (see MultiplayerSession's own comment), so they never send a ready signal - if the
   * required total instead tracked `opponents.size + 1` live, a joiner arriving before everyone
   * else had clicked Skip would permanently raise the bar past what the room could ever satisfy.
   * Confirmed bug, fixed in the 2026-07-10 review. */
  private modeExplanationParticipants = new Set<PlayerSlot>();
  private modeExplanationScreen: ModeExplanationScreen | null = null;
  /** Mid-match Loadout page, opened from the pause menu for unrestricted modes only (see
   * PauseMenu's own showLoadoutButton flag) - a separate instance from the lobby's own LoadoutScreen
   * (App.ts owns that one), mirroring how SettingsPanel is already duplicated per-match rather than
   * reused across the lobby/gameplay boundary. */
  private loadoutScreen: LoadoutScreen | null = null;
  /** Set when the mid-match Loadout page closes (see loadoutScreen's onClose) - applied at the next
   * respawn, not instantly (per explicit user request: "it only updates/changes their guns in
   * their hand on their next respawn"). Checked and cleared by applyPendingLoadoutIfNeeded. */
  private pendingLoadoutRebuild = false;
  /** Same weapon-building closure the initial WeaponManager.create() call used - assigned once,
   * right after construction (see create()'s own comment on this forward-reference), so
   * applyPendingLoadoutIfNeeded can call it again later with a *different* set of weaponIds without
   * duplicating every callback WeaponManager.create() needs. */
  private rebuildWeaponManagerFn:
    | ((weaponIds: string[], damageOverrides?: Readonly<Record<string, number>>, reserveAmmo?: Readonly<Record<string, number>>) => Promise<WeaponManager>)
    | null = null;

  private constructor(
    private readonly renderer: Renderer,
    private readonly input: InputManager,
    private readonly physics: PhysicsWorld,
    private readonly player: Player,
    private readonly chunkManager: ChunkManager,
    private readonly buildings: BuildingManager,
    private readonly watchTowers: WatchTowerManager,
    private readonly entityManager: EntityManager,
    // Mutable, not readonly: a mid-match Loadout change rebuilds this entirely at the player's next
    // respawn (see applyPendingLoadoutIfNeeded) rather than mutating WeaponManager's own internals.
    private weaponManager: WeaponManager,
    private readonly impactMarkers: ImpactMarkers,
    private readonly tracers: Tracers,
    private readonly muzzleFlash: MuzzleFlash,
    private readonly gooseManager: GooseManager,
    private readonly goldenGooseManager: GoldenGooseManager | null,
    private readonly hordeGooseManager: HordeGooseManager | null,
    private readonly bonusGooseManager: BonusGooseManager | null,
    private readonly ammoDropManager: AmmoDropManager | null,
    private readonly gooseAnnouncement: GooseAnnouncement,
    private readonly bigAnnouncement: BigAnnouncement,
    private readonly hordeWaveIndicator: HordeWaveIndicator | null,
    private readonly explosionEffect: ExplosionEffect,
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
    /** Resolved once at match setup (multiplayer?.weather ?? DEFAULT_MATCH_WEATHER) - never
     * changes live like graphics quality does. Kept as a field so applyGraphicsQuality's ambient
     * calculation can still respect a 'night' override if the player changes graphics quality
     * mid-match (see that method below). */
    private readonly matchWeather: MatchWeather,
    private readonly multiplayer: ActiveMultiplayer | null,
    private readonly onMultiplayerMatchEnd?: (result: MultiplayerMatchEndResult) => void,
    /** Fired when a matchStart message arrives *after* this Game already exists - the guest's
     * signal that the host clicked Rematch (see MatchEndScreen / App.restartMultiplayerMatch); the
     * initial matchStart is always consumed by the room screen before Game.create() ever attaches
     * its own message handler, so any matchStart Game itself sees is necessarily this case. */
    private readonly onMultiplayerRematchReceived?: (params: MultiplayerMatchStartParams) => void,
    /** Fired when a hostLeftRoom message arrives - the guest's signal that the host clicked
     * "Return to Lobby" from the match-end screen (see protocol.ts's HostLeftRoomMessage). Only
     * ever received by the guest; the host is the one sending it, never the recipient. */
    private readonly onOpponentLeftRoom?: () => void,
  ) {
    this.lastActiveWeaponIndex = weaponManager.activeWeaponIndex;
    this.lastActiveWeaponId = weaponManager.activeWeaponId;
    this.isSpawnBlocked = makeSpawnBlockedCheck(buildings);
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
        // Excludes the player's own capsule, exactly like a real shot (WeaponManager.firePellet): the
        // eye sits inside the capsule, so without this every probe reported a hit at distance 0.
        const hit = castHitscan(this.physics, origin, direction, 500, this.player.ownCollider);
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
      // Queued, not applied immediately, so debug damage takes the exact same within-tick path enemy
      // damage takes (death handling itself copes with either, see deathHandled).
      damagePlayer: (amount) => {
        this.pendingDebugDamage += amount;
      },
      getActiveBuildingCount: () => this.buildings.getActiveBuildingCount(),
      getActiveTowerPositions: () => this.watchTowers.getActiveTowerPositions(),
      getFrameStats: () => this.fpsMeter.getStats(),
      // e2e coverage predates 4-player support and only ever exercises 2-player matches - "the
      // opponent" there unambiguously means the one other player, i.e. the first (only) entry.
      getOpponentPosition: () => {
        const opponent = this.multiplayer?.opponents.values().next().value;
        if (!opponent) return null;
        const p = opponent.remotePlayer.position;
        return { x: p.x, y: p.y, z: p.z };
      },
      getOpponentScore: () => {
        const opponent = this.multiplayer?.opponents.keys().next().value;
        return opponent !== undefined ? this.multiplayerMatchState.scoreboard.get(opponent) ?? 0 : 0;
      },
      isMultiplayerMatchEnded: () => this.multiplayerMatchState.hasEnded,
      getOpponentCount: () => this.multiplayer?.opponents.size ?? 0,
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
    onOpponentLeftRoom?: () => void,
  ): Promise<Game> {
    onProgress?.('Initializing world…', 0);
    // Goose Horde: single-player's own toggle (matchConfig.hordeMode) or multiplayer's co-op mode
    // (gameMode==='gooseHorde') - computed once, up front, since it now also gates the player's own
    // spawn point (random, not the fixed single-player spawn) and every other goose spawn trigger
    // (ambient wandering flock, bonus golden goose) below, not just HordeGooseManager's own
    // construction further down.
    const isHordeMode = matchConfig.hordeMode || multiplayer?.gameMode === 'gooseHorde';
    // Single-player has no gameMode concept (per user request) and is always effectively 'default'
    // unless the horde toggle is on - used both to resolve the starting loadout below and to gate
    // the pause menu's Loadout button (see modeUsesCustomLoadout) to only the three modes that
    // don't already restrict/manage weapons themselves.
    const currentGameMode: GameMode = multiplayer?.gameMode ?? (isHordeMode ? 'gooseHorde' : DEFAULT_GAME_MODE);
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

    // Multiplayer-only, host-chosen (see CreateRoomScreen); single-player always 'day'. Applied
    // once here, not live-toggleable like graphics quality - see Renderer.setMatchWeather and the
    // matchWeather field's own comment for why 'night' also touches sun/ambient directly.
    const matchWeather: MatchWeather = multiplayer?.weather ?? DEFAULT_MATCH_WEATHER;
    renderer.setMatchWeather(matchWeather);
    if (matchWeather === 'night') {
      sun.color.setHex(NIGHT_SUN_COLOR);
      sun.intensity = NIGHT_SUN_INTENSITY;
      ambientLight.intensity = NIGHT_AMBIENT_INTENSITY;
    }

    onProgress?.('Growing vegetation…', 0.02);
    const vegetation = await VegetationManager.create(renderer.scene, physics);
    onProgress?.('Constructing buildings…', 0.04);
    const buildings = await BuildingManager.create(renderer.scene, physics);
    const roads = RoadManager.create(renderer.scene, buildings);
    const watchTowers = WatchTowerManager.create(renderer.scene, physics);

    const chunkManager = new ChunkManager(renderer.scene, physics, {
      onChunkLoaded: (cx, cz, originX, originZ, size) => {
        vegetation.placeForChunk(cx, cz, originX, originZ, size);
        buildings.placeForChunk(cx, cz, originX, originZ, size);
        roads.placeForChunk(cx, cz, originX, originZ, size);
        watchTowers.placeForChunk(cx, cz, originX, originZ, size);
      },
      onChunkUnloaded: (cx, cz) => {
        vegetation.removeChunk(cx, cz);
        buildings.removeChunk(cx, cz);
        roads.removeChunk(cx, cz);
        watchTowers.removeChunk(cx, cz);
      },
    });

    // Multiplayer: each client spawns at its own designated point (one per roster slot, looked up
    // by slot rather than a fixed host/guest pair now that there can be up to 4), not the shared
    // single-player one.
    const ownSpawnPoint = multiplayer?.spawns.find((s) => s.slot === multiplayer.ownSlot)?.point;
    // Single-player Goose Horde spawns somewhere random on the map instead of the fixed
    // single-player spawn ("the middle") - per explicit user request. Multiplayer already spawns
    // every player at their own per-slot point regardless of mode, so this only ever applies to
    // the single-player (!multiplayer) branch.
    // The host picked every slot's point before any world existed (pickMultiplayerSpawnPoints on a
    // fixed ring), so this client steps its OWN point off any house/tower it landed on. Other
    // clients still place this player's RemotePlayer at the host-picked point, but the first
    // playerSnapshot (~33 ms) corrects it, same as a late join.
    const isSpawnBlocked = makeSpawnBlockedCheck(buildings);
    const clearOwnSpawnPoint = ownSpawnPoint ? findClearSpawnPoint(ownSpawnPoint, isSpawnBlocked) : null;
    const ownSpawn = clearOwnSpawnPoint
      ? new THREE.Vector2(clearOwnSpawnPoint.x, clearOwnSpawnPoint.z)
      : isHordeMode && !multiplayer
        ? pickRandomHordeSpawnPoint(isSpawnBlocked)
        : clearFixedSpawnPoint(isSpawnBlocked);

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
      onFootstep: () => {
        sound.playFootstep();
        // Per user request: other players should hear each other's footsteps, not just gunfire -
        // the receiving end positions/attenuates it the same way opponent gunshots already are
        // (see the 'footstepEvent' case below). `player` isn't assigned in this outer scope until
        // after this very call resolves, but this callback only fires later, during gameplay - by
        // then it's safely assigned, same as every other closure captured in this constructor call.
        multiplayer?.connection.send({
          type: 'footstepEvent',
          senderSlot: multiplayer.ownSlot,
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
        });
      },
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
    // The stored loadout is only ever consumed for the three unrestricted modes (see
    // modeUsesCustomLoadout) - harmless to always read/pass it in otherwise, every restricted
    // mode's own branch ignores the third parameter entirely.
    const loadout = resolveWeaponLoadout(currentGameMode, Math.random, loadStoredLoadout());
    // Goose Horde multiplayer's limited ammo economy (per explicit user request) - every other
    // mode omits this entirely, keeping the existing unlimited-reload behavior unchanged.
    const isHordeMultiplayer = isHordeMode && !!multiplayer;
    const initialReserveAmmo = isHordeMultiplayer
      ? Object.fromEntries(
          loadout.weaponIds.map((id) => [id, (WEAPON_DEFINITIONS[id]?.magazineSize ?? 0) * HORDE_STARTING_RESERVE_MAGAZINES]),
        )
      : undefined;
    // Extracted into a reusable closure (not just called once inline) - a mid-match Loadout change
    // (see applyPendingLoadoutIfNeeded) needs to rebuild a fresh WeaponManager from a *new* set of
    // weaponIds at the player's next respawn, using the exact same callbacks the original match
    // start already wires up. Every callback below reads `game.weaponManager`/`game.thrownGeese`
    // (the instance's *current* fields) rather than closing over a specific WeaponManager instance,
    // so a later rebuild doesn't leave stale closures pointing at the disposed one - `game` isn't
    // assigned in this outer scope until after the very first call resolves, but none of these
    // callbacks fire until real gameplay ticks later, by which point it's always assigned.
    const buildWeaponManager = (
      weaponIds: string[],
      damageOverrides?: Readonly<Record<string, number>>,
      reserveAmmo?: Readonly<Record<string, number>>,
    ) =>
      WeaponManager.create(
        renderer.camera,
        physics,
        weaponIds,
        scopeOverlay,
        (point, isEntityHit) => {
          impactMarkers.spawn(point, isEntityHit);
          // Once per tick: this fires per pellet, so a shotgun blast stacked up to 8 hit sounds.
          if (isEntityHit && game.lastHitConfirmTick !== game.tickCount) {
            game.lastHitConfirmTick = game.tickCount;
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
            senderSlot: multiplayer.ownSlot,
            originX: start.x,
            originY: start.y,
            originZ: start.z,
            endX: end.x,
            endY: end.y,
            endZ: end.z,
            // activeWeaponId, not weaponSlotNames[activeWeaponIndex] - the latter returns the
            // display name (e.g. "Kestrel P9"), which playGunshot's `${weaponId}_shot` buffer
            // lookup never matches, silently falling through to its generic fallback sound. This is
            // why every multiplayer opponent's gunshot sounded the same regardless of weapon.
            weaponId: game.weaponManager.activeWeaponId,
          });
        },
        (weaponId) => sound.playGunshot(weaponId),
        (weaponId) => sound.playReloadClick(weaponId),
        (distance) => longShotCallout.show(distance),
        (point) => {
          muzzleFlash.spawn(point);
          // Threat perception (2026-07-10 review, enemy AI phase A): a real gunshot alerts nearby
          // idle enemies toward roughly where it came from, same as a real firefight - previously
          // enemies had no hearing at all, only reacting once the player walked inside their much
          // shorter detection bubble. Harmless no-op in multiplayer (no Enemy instances exist there).
          entityManager.notifyGunshot(point);
        },
        // Goose Launcher's isProjectile firing path (see WeaponManager.fireShot) - spawns a real
        // ballistic ThrownGoose instead of instant hitscan, reusing the exact same thrownGeese map/
        // updateThrownGeese loop Goose Toss's pickup-and-throw already uses (see ThrownGoose.ts's
        // class comment on why the two share one plumbing).
        (origin, _muzzleWorld, direction) => {
          const id = crypto.randomUUID();
          const spawnPoint = origin.clone().addScaledVector(direction, 0.6);
          const velocity = direction.clone().multiplyScalar(GOOSE_LAUNCHER_PROJECTILE_SPEED);
          const ownSlot = multiplayer?.ownSlot ?? null;
          const thrown = new ThrownGoose(id, ownSlot, 'gooseLauncher', spawnPoint, velocity);
          renderer.scene.add(thrown.mesh);
          game.thrownGeese.set(id, thrown);
          if (multiplayer) {
            multiplayer.connection.send({
              type: 'gooseThrown',
              senderSlot: multiplayer.ownSlot,
              id,
              originX: spawnPoint.x,
              originY: spawnPoint.y,
              originZ: spawnPoint.z,
              velX: velocity.x,
              velY: velocity.y,
              velZ: velocity.z,
              source: 'gooseLauncher',
            });
          }
        },
        damageOverrides,
        reserveAmmo,
      );
    const weaponManager = await buildWeaponManager(loadout.weaponIds, loadout.damageOverrides, initialReserveAmmo);

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
          // shouldn't sound identical to one at point-blank (see ENEMY_GUNSHOT_* in config.ts) -
          // and panned by direction too (per user request: positional audio should work the same
          // in single-player against enemies as it does against a multiplayer opponent).
          sound.playGunshot(
            'enemy-rifle',
            enemyGunshotVolume(origin.distanceTo(player.position)),
            computeStereoPan(player.position, player.facingYaw, origin),
          );
        },
      },
    );

    // Multiplayer matches are pure PvP (MULTIPLAYER_PLAN.md's premise: the bot/enemy system is
    // single-player "training" only) - never spawn AI encounters here, regardless of matchConfig.
    // Goose Horde also skips this (single-player's own hordeMode toggle) - the horde flock below
    // is the only thing attacking the player in that mode, not the regular enemy roster.
    if (!multiplayer && !matchConfig.hordeMode) {
      await Game.spawnEncountersAsync(entityManager, matchConfig.targetCount, matchConfig.enemyCount, (status, spawnRatio) => {
        onProgress?.(status, 0.15 + spawnRatio * 0.85);
      });
    }

    const gooseAnnouncement = new GooseAnnouncement(hudRoot);
    const bigAnnouncement = new BigAnnouncement(hudRoot);
    const hordeWaveIndicator = isHordeMode ? new HordeWaveIndicator(hudRoot) : null;
    const explosionEffect = new ExplosionEffect(renderer.scene);
    // Single-player and the multiplayer host run every goose authoritative (see GooseManager's
    // class comment); a guest only ever mirrors what the host broadcasts, never spawns/adjudicates
    // on its own - onNetworkSpawn/onNetworkSnapshot/onNetworkExplosion are host-only (undefined,
    // and therefore never invoked, for single-player and guests), onLocalHitReported is guest-only.
    const gooseManager = new GooseManager(renderer.scene, physics, {
      onGooseSpawned: () => gooseAnnouncement.show('A goose has appeared!'),
      onExplosion: (position, radius) => {
        explosionEffect.spawn(position, radius);
        // Same distance-attenuation/stereo-pan convention as enemy/opponent gunshots (see
        // enemyGunshotVolume/computeStereoPan below) - a goose exploding across the map shouldn't
        // sound identical to one at point-blank.
        sound.playExplosion(enemyGunshotVolume(position.distanceTo(player.position)), computeStereoPan(player.position, player.facingYaw, position));
      },
      onNetworkSpawn:
        multiplayer?.role === 'host' ? (id, x, y, z) => multiplayer.connection.send({ type: 'gooseSpawned', id, x, y, z }) : undefined,
      onNetworkSnapshot:
        multiplayer?.role === 'host' ? (id, x, y, z) => multiplayer.connection.send({ type: 'gooseSnapshot', id, x, y, z }) : undefined,
      onNetworkExplosion:
        multiplayer?.role === 'host' ? (id, x, y, z) => multiplayer.connection.send({ type: 'gooseExploded', id, x, y, z }) : undefined,
      onLocalHitReported:
        multiplayer?.role === 'guest' ? (id) => multiplayer.connection.send({ type: 'gooseHitEvent', senderSlot: multiplayer.ownSlot, id }) : undefined,
    }, multiplayer?.gameMode === 'gooseToss' ? GOOSE_TOSS_MAX_CONCURRENT : GOOSE_MAX_CONCURRENT);
    // Guests don't spawn anything themselves - they wait for the host's own initial-batch
    // gooseSpawned broadcasts (sent from this same call on the host's client) to arrive.
    // Goose Horde is excluded (per explicit user request "no other goose must spawn that are not
    // part of the wave") - the ambient wandering flock is a different mode's feature entirely.
    if (!isHordeMode && (!multiplayer || multiplayer.role === 'host')) {
      gooseManager.spawnInitialBatch(ownSpawn.x, ownSpawn.y);
    }

    // King of the Hill: one golden goose at the map's exact center (0, 0) - the same point
    // pickMultiplayerSpawnPoints already rings every player equally around, so "spawn equidistant
    // from the goose" needs no new placement math. Every client (host and guests alike) builds it
    // locally at this same fixed point rather than needing a spawn broadcast - unlike the
    // exploding geese, there's exactly one of these and its start position is a match constant.
    const goldenGooseManager =
      multiplayer?.gameMode === 'kingOfTheHill'
        ? new GoldenGooseManager(renderer.scene, new THREE.Vector3(0, sampleHeight(0, 0), 0))
        : null;

    // Multiplayer uses its own harder, 15-wave table (per explicit user request); single-player
    // keeps the original 10-wave one. Host-authoritative in multiplayer (same split as
    // GooseManager); single-player is always "authoritative" since there's no one else to defer to.
    const hordeWaveTable = multiplayer ? HORDE_WAVE_TABLE_MULTIPLAYER : HORDE_WAVE_TABLE;
    const hordeGooseManager = isHordeMode
      ? new HordeGooseManager(
          renderer.scene,
          physics,
          {
            onWaveStart: (wave) => gooseAnnouncement.show(`Wave ${wave} of ${hordeWaveTable.length} incoming...`),
            onCleared: () => gooseAnnouncement.show('The horde has been cleared - you survived!'),
            onExplosion: (position) => {
              explosionEffect.spawn(position, HORDE_GOOSE_EXPLOSION_RADIUS);
              const distance = position.distanceTo(player.position);
              sound.playExplosion(enemyGunshotVolume(distance), computeStereoPan(player.position, player.facingYaw, position));
              // Every client independently checks its OWN player against the blast (self-
              // authoritative over own health, same trust model as every other explosion in this
              // project) - this callback fires identically whether the local client decided the
              // explosion (authoritative side) or is just mirroring one via applyExplosion
              // (follower side), so no separate multiplayer-specific damage path is needed.
              const damage = computeExplosionDamage(distance, HORDE_GOOSE_EXPLOSION_RADIUS, HORDE_GOOSE_EXPLOSION_MAX_DAMAGE);
              if (damage > 0) player.takeDamage(damage);
              const knockback = computeKnockbackStrength(distance, HORDE_GOOSE_EXPLOSION_RADIUS, HORDE_GOOSE_KNOCKBACK_STRENGTH);
              if (knockback > 0) player.applyKnockback(player.position.clone().sub(position), knockback);
            },
            onNetworkSpawn:
              multiplayer?.role === 'host'
                ? (id, x, y, z, flavor) => multiplayer.connection.send({ type: 'hordeGooseSpawned', id, x, y, z, flavor })
                : undefined,
            onNetworkSnapshot:
              multiplayer?.role === 'host' ? (id, x, y, z) => multiplayer.connection.send({ type: 'hordeGooseSnapshot', id, x, y, z }) : undefined,
            onNetworkExplosion:
              multiplayer?.role === 'host' ? (id, x, y, z) => multiplayer.connection.send({ type: 'hordeGooseExploded', id, x, y, z }) : undefined,
            onNetworkRemove: multiplayer?.role === 'host' ? (id) => multiplayer.connection.send({ type: 'hordeGooseRemoved', id }) : undefined,
            onNetworkWaveStart: multiplayer?.role === 'host' ? (wave) => multiplayer.connection.send({ type: 'hordeWaveStarted', wave }) : undefined,
            onNetworkCleared: multiplayer?.role === 'host' ? () => multiplayer.connection.send({ type: 'hordeCleared' }) : undefined,
            onNetworkReset: multiplayer?.role === 'host' ? () => multiplayer.connection.send({ type: 'hordeReset' }) : undefined,
            onLocalHitReported:
              multiplayer?.role === 'guest' ? (id) => multiplayer.connection.send({ type: 'hordeGooseHitEvent', senderSlot: multiplayer.ownSlot, id }) : undefined,
          },
          // Centered on this client's own spawn point (random in single-player, this client's own
          // slot point in multiplayer) rather than a fixed world origin - now that single-player
          // horde spawns the player somewhere random on the map (not the middle), geese should
          // still emerge near wherever the player actually starts, not a fixed point that could be
          // far away. Only the host's own value matters in multiplayer (guests never spawn geese
          // themselves - see isAuthoritative below).
          ownSpawn.x,
          ownSpawn.y,
          hordeWaveTable,
          !multiplayer || multiplayer.role === 'host',
        )
      : null;

    // Bonus golden goose - per a later explicit request, restricted to the default mode only (every
    // other mode either has its own reason the ambient goose doesn't fit - Goose Toss's unarmed
    // loadout can't shoot anything, Goose Horde already has its own wave geese and "no other goose
    // must spawn that are not part of the wave" - or, for Gun Game specifically, gets its own
    // distinct golden-goose variant instead, see the "1 kill from winning" grant in
    // updateMultiplayer). Single-player has no gameMode concept and is always effectively
    // 'default' (every other GameMode value is multiplayer-only, chosen in CreateRoomScreen, never
    // single-player's PlaySetupModal), so it keeps the ambient goose too, same as before. Single-
    // player and the multiplayer host run the spawn-timer/hit-attribution state machine themselves;
    // a guest is a pure follower (see BonusGooseManager's own isAuthoritative comment).
    const isBonusGooseEnabled = !isHordeMode && (!multiplayer || multiplayer.gameMode === 'default');
    const bonusGooseManager = isBonusGooseEnabled
      ? new BonusGooseManager(
          renderer.scene,
          physics,
          {
            onSpawned: () => bigAnnouncement.show('A GOLDEN GOOSE HAS APPEARED!'),
            onKilled: (killerSlot) => {
              // null killerSlot only in single-player (no slot concept) - always this client there.
              const isMine = !multiplayer || killerSlot === multiplayer.ownSlot;
              if (!isMine) return;
              gooseAnnouncement.show('You claimed the Goose Launcher!');
              // game.weaponManager, not the create()-local `weaponManager`: a mid-match Loadout change
              // rebuilds it at the next respawn, and the stale capture granted the launcher to the
              // disposed instance (a frozen launcher model on screen, the live gun unchanged).
              void game.weaponManager.grantBonusWeapon('gooseLauncher', game.weaponManager.activeWeaponId);
            },
            onNetworkSpawn:
              multiplayer?.role === 'host' ? (id, x, y, z) => multiplayer.connection.send({ type: 'bonusGooseSpawned', id, x, y, z }) : undefined,
            onNetworkSnapshot:
              multiplayer?.role === 'host' ? (id, x, y, z) => multiplayer.connection.send({ type: 'bonusGooseSnapshot', id, x, y, z }) : undefined,
            onNetworkKilled:
              multiplayer?.role === 'host' ? (killerSlot) => multiplayer.connection.send({ type: 'bonusGooseKilled', killerSlot }) : undefined,
            onLocalHitReported:
              multiplayer?.role === 'guest' ? (id) => multiplayer.connection.send({ type: 'bonusGooseHitEvent', senderSlot: multiplayer.ownSlot, id }) : undefined,
          },
          !multiplayer || multiplayer.role === 'host',
          multiplayer?.ownSlot ?? null,
        )
      : null;

    // Goose Horde multiplayer's ammo crates (per explicit user request) - single-player keeps
    // unlimited reloads, so this is multiplayer-only, unlike the other horde-mode systems above.
    const ammoDropManager = isHordeMultiplayer
      ? new AmmoDropManager(renderer.scene, {
          // `activeMultiplayer` isn't assigned in this outer scope until later in this same
          // function, but this callback only ever fires during later gameplay ticks (from
          // AmmoDropManager.update, which never runs until the whole create() call has resolved) -
          // same forward-reference pattern already used for `game`/`weaponManager` elsewhere here.
          onNetworkSpawn:
            multiplayer?.role === 'host'
              ? (id, x, y, z) => {
                  multiplayer.connection.send({ type: 'hordeAmmoDropSpawned', id, x, y, z });
                  activeMultiplayer?.minimap.addItemDot(id);
                }
              : undefined,
        })
      : null;

    // Every OTHER roster slot gets a RemotePlayer, positioned at its own match-start spawn point
    // (or the local player's own spawn as a harmless placeholder for a late-join/rejoin, where
    // other players' *current* positions aren't known yet - their next playerSnapshot corrects it
    // within one send interval, imperceptibly). Both sides already know where every player starts,
    // so no RemotePlayer needs to wait for a first network snapshot to appear in the right place.
    let activeMultiplayer: ActiveMultiplayer | null = null;
    if (multiplayer) {
      const ownUsername = multiplayer.roster.find((r) => r.slot === multiplayer.ownSlot)?.username ?? 'You';
      const roomCode = multiplayer.roomCode;
      const opponents = new Map<PlayerSlot, RemoteOpponent>();
      const usernames = new Map<PlayerSlot, string>([[multiplayer.ownSlot, ownUsername]]);
      const minimap = new Minimap(hudRoot);
      const multiplayerHud = new MultiplayerHud(hudRoot, multiplayer.ownSlot, ownUsername, roomCode);

      for (const entry of multiplayer.roster) {
        if (entry.slot === multiplayer.ownSlot) continue;
        const spawnPoint = multiplayer.spawns.find((s) => s.slot === entry.slot)?.point ?? { x: ownSpawn.x, z: ownSpawn.y };
        const remotePlayer = await RemotePlayer.create(
          physics,
          renderer.scene,
          new THREE.Vector3(spawnPoint.x, sampleHeight(spawnPoint.x, spawnPoint.z) + SPAWN_HEIGHT_OFFSET, spawnPoint.z),
          // The target's own client is what actually applies this to its health - see the class
          // comment on RemotePlayer and the DamageEventMessage comment in protocol.ts.
          (amount) => multiplayer.connection.send({ type: 'damageEvent', senderSlot: multiplayer.ownSlot, targetSlot: entry.slot, amount }),
        );
        opponents.set(entry.slot, { slot: entry.slot, remotePlayer, username: entry.username, health: player.maxHealth, lastMessageAt: performance.now(), isDead: false });
        usernames.set(entry.slot, entry.username);
        minimap.addDot(entry.slot);
        multiplayerHud.addOpponentRow(entry.slot, entry.username);
      }

      activeMultiplayer = {
        session: multiplayer,
        opponents,
        usernames,
        minimap,
        multiplayerHud,
        killLimit: multiplayer.killLimit,
        gooseDifficulty: multiplayer.gooseDifficulty,
        gameMode: multiplayer.gameMode,
        weather: multiplayer.weather,
        hostRoster: multiplayer.role === 'host' ? multiplayer.hostRoster ?? null : null,
        snapshotAccumulator: 0,
        hostSweepAccumulator: 0,
        deathTimer: 0,
        lastDamageSourceSlot: null,
        lastDamageSourceAt: 0,
        hordeRespawnsUsed: 0,
        hordeEliminatedSlots: new Set<PlayerSlot>(),
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
      () => void gameRef.current?.resetPlay(),
      () => onReturnToLobby?.(),
    );
    // PauseMenu is created before SettingsPanel so the settings overlay (later DOM sibling)
    // paints above it - opening Settings from the pause menu must show over it, not behind it.
    const pauseMenu = new PauseMenu(
      hudRoot,
      {
        onResume: () => input.requestPointerLock(),
        onSettings: () => settingsPanel.show(),
        onResetPlay: () => void gameRef.current?.resetPlay(),
        onReturnToLobby: () => onReturnToLobby?.(),
        onRespawn: () => gameRef.current?.manualRespawn(),
        onLoadout: () => gameRef.current?.openLoadoutScreen(),
      },
      multiplayer !== undefined,
      modeUsesCustomLoadout(currentGameMode),
    );
    const settingsPanel = new SettingsPanel(
      hudRoot,
      () => settingsPanel.hide(),
      (value) => sound.setMasterVolume(value),
      (quality) => gameRef.current?.applyGraphicsQuality(GRAPHICS_QUALITY_PRESETS[quality]),
      (value) => gameRef.current?.applyFov(value),
    );
    const perfOverlay = new PerfOverlay(hudRoot);

    const game = new Game(
      renderer,
      input,
      physics,
      player,
      chunkManager,
      buildings,
      watchTowers,
      entityManager,
      weaponManager,
      impactMarkers,
      tracers,
      muzzleFlash,
      gooseManager,
      goldenGooseManager,
      hordeGooseManager,
      bonusGooseManager,
      ammoDropManager,
      gooseAnnouncement,
      bigAnnouncement,
      hordeWaveIndicator,
      explosionEffect,
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
      matchWeather,
      activeMultiplayer,
      onMultiplayerMatchEnd,
      onMultiplayerRematchReceived,
      onOpponentLeftRoom,
    );
    gameRef.current = game;
    game.modeExplanationScreen = new ModeExplanationScreen(hudRoot, () => gameRef.current?.handleModeExplanationSkipClicked());
    game.rebuildWeaponManagerFn = buildWeaponManager;
    // A separate per-match instance from App.ts's own lobby LoadoutScreen (same duplication
    // SettingsPanel already has) - only ever opened from the pause menu, and only for the three
    // unrestricted modes (see PauseMenu's showLoadoutButton).
    // Built lazily on first open (see openLoadoutScreen) rather than here: most matches never open it,
    // and each instance used to cost several WebGL contexts (thumbnails plus a live preview) on every
    // match start, restricted modes included.
    game.hudRoot = hudRoot;

    // Per-mode controllers (see core/modeControllers/) - each mode gets at most one, matching its
    // own gameMode. Constructed here rather than earlier alongside their underlying managers
    // (goldenGooseManager, etc.) because GunGameController needs game.multiplayerMatchState, which
    // only exists once `game` itself does - same forward-reference shape as modeExplanationScreen/
    // loadoutScreen above.
    if (multiplayer?.gameMode === 'gooseToss') {
      game.gooseTossController = new GooseTossController(renderer.camera, renderer.scene, gooseManager, game.thrownGeese, multiplayer);
    }
    if (multiplayer?.gameMode === 'kingOfTheHill' && goldenGooseManager) {
      game.kingOfTheHillController = new KingOfTheHillController(goldenGooseManager, multiplayer, game.multiplayerMatchState);
    }
    if (multiplayer?.gameMode === 'gunGame') {
      game.gunGameController = new GunGameController(multiplayer, game.multiplayerMatchState, gooseAnnouncement);
    }

    // Seed this match's running scoreboard from whatever a late join/rejoin was handed (empty for
    // a normal fresh match start - see MultiplayerSession.initialScoreboard's own comment).
    if (multiplayer) {
      game.multiplayerMatchState.seedFrom(multiplayer.initialScoreboard);
    }

    // Takes over from the room screen's own connection callbacks (which only knew how to update
    // now-hidden UI) - see PeerConnection.setCallbacks. Relay (host-only, transparent pass-through
    // of gameplay messages to every other connected guest) happens once here, before the
    // slot-aware local-application switch below - see the class comment on why this is safe to do
    // unconditionally rather than per message type.
    if (activeMultiplayer) {
      // Everything the network message router needs from this Game/create() closure, handed over as
      // one explicit context object (see MatchMessageRouter.ts) so the ~270-line message switch no
      // longer has to live inline in this method. Most members are the create()-local managers/
      // systems directly; the method-shaped ones wrap the handful of Game-private operations a
      // message case performs.
      const routerContext: MatchMessageContext = {
        multiplayer: activeMultiplayer,
        scene: renderer.scene,
        player,
        sound,
        tracers,
        muzzleFlash,
        explosionEffect,
        killFeed,
        gooseAnnouncement,
        gooseManager,
        // Getter, not a captured reference: a mid-match Loadout change rebuilds game.weaponManager,
        // and a stale capture would target the disposed instance (see game.weaponManager's comment).
        get weaponManager() {
          return game.weaponManager;
        },
        isHordeMode,
        thrownGeese: game.thrownGeese,
        scoreboard: game.multiplayerMatchState.scoreboard,
        deathCounts: game.multiplayerMatchState.deathCounts,
        goldenGooseManager,
        hordeGooseManager,
        bonusGooseManager,
        ammoDropManager,
        applyNetworkDamage: (amount, sourceSlot) => {
          game.pendingNetworkDamage += amount;
          activeMultiplayer.lastDamageSourceSlot = sourceSlot;
          activeMultiplayer.lastDamageSourceAt = performance.now();
        },
        healLocalPlayerToFull: () => game.healLocalPlayerToFull(),
        applyHostMatchEnd: (winnerSlot, scoreboard) => game.applyHostMatchEnd(winnerSlot, scoreboard),
        endedMatchVerdict: () => game.endedMatchVerdict(),
        checkHordeAllEliminated: () => game.checkHordeAllEliminated(),
        receiveModeExplanationReady: (slot) => game.receiveModeExplanationReady(slot),
        removeMultiplayerOpponent: (slot) => game.removeMultiplayerOpponent(slot),
        addMultiplayerOpponent: (slot, username) => game.addMultiplayerOpponent(slot, username),
        onRematchReceived: (params) => game.onMultiplayerRematchReceived?.(params),
        onOpponentLeftRoom: () => game.onOpponentLeftRoom?.(),
      };

      activeMultiplayer.session.connection.setCallbacks({
        onConnected: () => {}, // side effects for a mid-match join/rejoin live in onHostHello below, not here
        // Guest: its one connection (to the host) closing always ends the match - star topology
        // gives it no path to any other guest without the host relaying, so losing the host is
        // unrecoverable for it (it can still rejoin the same room code later, per the
        // WelcomeMessage.activeMatch path in JoinRoomScreen - just not by staying on this screen).
        // Host: one guest's connection closing does NOT end the match - the remaining players keep
        // playing (per user decision), and everyone else just needs that slot's RemotePlayer/HUD/
        // minimap removed.
        onPeerDisconnected: (slot) => {
          if (activeMultiplayer.session.role === 'guest') {
            // Already on the podium: endMultiplayerMatch is a no-op once ended, so a host who closed
            // the tab (instead of clicking Return to Lobby, which sends hostLeftRoom) left the guest
            // stranded there forever. Treat it the same as hostLeftRoom.
            if (game.multiplayerMatchState.hasEnded) {
              game.onOpponentLeftRoom?.();
              return;
            }
            game.endMultiplayerMatch(false, 'opponentDisconnected');
            return;
          }
          activeMultiplayer.hostRoster?.handleDisconnect(slot, performance.now());
          game.removeMultiplayerOpponent(slot);
          activeMultiplayer.session.connection.send({ type: 'playerLeft', slot });
        },
        // A dropped connection can surface as a WebRTC/PeerJS error rather than a clean 'close'
        // event (e.g. an abrupt network loss instead of a graceful page unload) - from a guest's
        // perspective that's the same "match is over" outcome; from the host's perspective there's
        // no specific slot to react to here (a genuinely per-guest error still fires that guest's
        // own connection 'close' separately, handled by onPeerDisconnected above).
        // Except a lost broker websocket ('brokerLost'): the data channel to the host doesn't use the
        // broker once open, so ending the match on it threw guests out of perfectly healthy games.
        onError: (_message, kind) => {
          if (activeMultiplayer.session.role === 'guest' && kind !== 'brokerLost') game.endMultiplayerMatch(false, 'opponentDisconnected');
        },
        onMessage: (message, senderSlot) => routeMatchMessage(routerContext, message, senderSlot),
        // Host-only - resolves a mid-match join/rejoin's hello into the exact reply to send back,
        // and (for anything past a normal pre-match lobby join, i.e. isMatchInProgress) performs
        // the actual "add this player to the running match" side effects (RemotePlayer/HUD row/
        // minimap dot + telling everyone else) before returning that reply - see HostRoster.ts and
        // protocol.ts's WelcomeMessage/PlayerJoinedMatchMessage docs for the full design.
        onHostHello: async (username, rejoinToken) => {
          const hostRoster = activeMultiplayer.hostRoster;
          if (!hostRoster) return 'full'; // guest never receives a hello to resolve in the first place
          const outcome = hostRoster.handleHello(username, rejoinToken, performance.now());
          if (outcome.outcome === 'full') return 'full';

          // Connected slots only: the joiner builds a RemotePlayer for every roster entry, and a slot
          // sitting in its rejoin grace period used to become a frozen ghost on their screen for up to
          // 90s (guests never run the staleness sweep that would reap it).
          const roster = hostRoster.connectedRoster();
          if (outcome.outcome === 'joined') {
            // A brand-new player may be handed a departed player's slot; don't let them inherit that
            // score (see the matching reset in MatchMessageRouter's playerJoinedMatch case).
            game.multiplayerMatchState.scoreboard.delete(outcome.slot);
            game.multiplayerMatchState.deathCounts.delete(outcome.slot);
          }
          if (hostRoster.isMatchInProgress()) {
            const otherPositions = Array.from(activeMultiplayer.opponents.values(), (o) => ({ x: o.remotePlayer.position.x, z: o.remotePlayer.position.z }));
            otherPositions.push({ x: player.position.x, z: player.position.z });
            const spawnPoint = pickRandomRespawnPoint(otherPositions, game.isSpawnBlocked);
            await game.addMultiplayerOpponent(outcome.slot, username);
            activeMultiplayer.session.connection.send({ type: 'playerJoinedMatch', slot: outcome.slot, username, isRejoin: outcome.outcome === 'rejoined' });
            return {
              type: 'welcome',
              yourSlot: outcome.slot,
              isRejoin: outcome.outcome === 'rejoined',
              hostUsername: activeMultiplayer.usernames.get(HOST_SLOT) ?? 'Host',
              roster,
              activeMatch: {
                seed: getWorldSeed(),
                killLimit: activeMultiplayer.killLimit,
                gooseDifficulty: activeMultiplayer.gooseDifficulty,
                gameMode: activeMultiplayer.gameMode,
                weather: activeMultiplayer.weather,
                // Only slots in the roster handed over above: the joiner learns usernames from that
                // roster alone, so a reserved or departed slot's score would sit in its scoreboard with
                // no name and silently drop off its podium (which iterates known usernames).
                scoreboard: Array.from(game.multiplayerMatchState.scoreboard, ([slot, score]) => ({ slot, score })).filter((entry) =>
                  roster.some((rosterEntry) => rosterEntry.slot === entry.slot),
                ),
                spawnPoint: { x: spawnPoint.x, z: spawnPoint.z },
              },
            };
          }

          return {
            type: 'welcome',
            yourSlot: outcome.slot,
            isRejoin: outcome.outcome === 'rejoined',
            hostUsername: activeMultiplayer.usernames.get(HOST_SLOT) ?? 'Host',
            roster,
          };
        },
      });

      // A guest's own callbacks (above) are only ready to receive gooseSpawned/etc. from this
      // exact point on - the host's initial-batch broadcasts (sent much earlier in this same
      // create() call, while this client was still loading assets) may well have already been
      // sent and lost. Rather than guess at timing, just ask: covers both a guest that missed the
      // initial batch and a late-joiner/rejoiner that missed everything before it connected (see
      // GooseSyncRequestMessage's own comment).
      if (activeMultiplayer.session.role === 'guest') {
        // gooseSyncRequest/hordeSyncRequest are each mode-specific - the ambient ("wild") flock
        // gooseSyncRequest asks about never spawns in Goose Horde, and vice versa, so each is only
        // sent for its own mode to avoid a pointless round trip the host would just no-op anyway.
        if (activeMultiplayer.gameMode !== 'gooseHorde') {
          activeMultiplayer.session.connection.send({ type: 'gooseSyncRequest', senderSlot: activeMultiplayer.session.ownSlot });
        } else {
          activeMultiplayer.session.connection.send({ type: 'hordeSyncRequest', senderSlot: activeMultiplayer.session.ownSlot });
        }
      }
    }

    // Mode-briefing gate (per explicit user request - see worldBriefingActive's own comment):
    // every mode except 'default' gets a pre-match explanation the world waits on. Skipped
    // entirely for a late join/rejoin (multiplayer.showModeExplanation === false - see its own
    // comment on MultiplayerSession), which drops straight into an already-live match.
    if (!multiplayer || multiplayer.showModeExplanation) {
      const effectiveMode: GameMode = multiplayer?.gameMode ?? (isHordeMode ? 'gooseHorde' : 'default');
      const totalPlayers = activeMultiplayer ? activeMultiplayer.opponents.size + 1 : 1;
      game.beginModeExplanation(effectiveMode, totalPlayers);
    }

    return game;
  }

  /** Requesting pointer lock here (rather than leaving the player to click "Resume" on the pause
   * menu that isPaused's own formula shows whenever input isn't locked) lets a match start already
   * playable instead of paused-by-default. Still gated on the browser's pointer-lock user-gesture
   * requirement like every other call site (resetPlay, multiplayerRespawn) - this only succeeds
   * when start() runs close enough behind the click that triggered match creation (Play/Start
   * Match for whoever clicked it) to still carry that gesture's activation forward through
   * Game.create()'s async loading. If it doesn't (a slow load, or a guest whose match start arrived
   * over the network with no local click at all), it fails silently and the existing pause menu
   * click-to-resume gate is exactly today's fallback - never worse than before. */
  start(): void {
    this.loop.start();
    // A host that dropped while this guest was still loading fired its close event on the room
    // screen's callbacks (or App's silenced ones during a rematch), never on Game's, so the guest
    // would otherwise play on alone against a dead connection forever.
    if (this.multiplayer?.session.role === 'guest' && !this.multiplayer.session.connection.isConnectedTo(HOST_SLOT)) {
      this.endMultiplayerMatch(false, 'opponentDisconnected');
      return;
    }
    // A locked pointer hides the OS cursor - the player couldn't actually see/click the mode
    // briefing's Skip button if it were requested here while worldBriefingActive is still true.
    // dismissModeExplanation() requests it instead, once the briefing actually closes.
    if (!this.worldBriefingActive) this.input.requestPointerLock();
  }

  /** Tears down everything this Game instance owns - WebGL context, DOM-appended HUD/menu
   * elements, and input listeners - so App can cleanly return to the lobby and later start a
   * fresh match without leaking GL contexts or stacking duplicate HUD nodes.
   *
   * `keepConnectionAlive` (MULTIPLAYER_PLAN.md §7 phase 4): set when App is tearing this Game down
   * to immediately create a fresh one on the same room for a rematch - the underlying
   * PeerConnection must survive the swap, or there'd be no connection left for the new Game to use. */
  dispose(options?: { keepConnectionAlive?: boolean }): void {
    this.disposed = true;
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
    this.gooseAnnouncement.dispose();
    this.bigAnnouncement.dispose();
    this.hordeWaveIndicator?.dispose();
    this.modeExplanationScreen?.dispose();
    this.loadoutScreen?.dispose();
    this.explosionEffect.dispose();
    this.gooseManager.dispose();
    this.goldenGooseManager?.dispose();
    this.hordeGooseManager?.dispose();
    this.bonusGooseManager?.dispose();
    this.ammoDropManager?.dispose();
    for (const thrown of this.thrownGeese.values()) thrown.dispose(this.renderer.scene);
    this.thrownGeese.clear();
    this.gooseTossController?.dispose();
    this.scopeOverlay.dispose();
    this.pauseMenu.dispose();
    this.settingsPanel.dispose();
    this.perfOverlay.dispose();
    this.sound.dispose();
    if (this.multiplayer) {
      for (const opponent of this.multiplayer.opponents.values()) opponent.remotePlayer.dispose(this.renderer.scene);
    }
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
  private async resetPlay(): Promise<void> {
    if (this.multiplayer) {
      if (this.player.isDead) void this.multiplayerRespawn();
      return;
    }

    // A mid-match Loadout change (see handleLoadoutScreenClosed) takes effect right here - the
    // single-player equivalent of "the next respawn" (both an actual death-respawn and a manual
    // "Reset Play" restart count, since both put the player back at a fresh spawn point). Awaited
    // before resetAllAmmo() below so that call always targets the *current* WeaponManager, not one
    // about to be disposed.
    await this.applyPendingLoadoutIfNeeded();

    // Goose Horde: dying restarts the whole challenge from wave 1 (per explicit user request) at a
    // fresh random point on the map, not the fixed single-player spawn, and skips respawning
    // enemies/targets/the ambient goose flock entirely - none of those are part of this mode.
    const spawnPoint = this.hordeGooseManager ? pickRandomHordeSpawnPoint(this.isSpawnBlocked) : clearFixedSpawnPoint(this.isSpawnBlocked);
    const spawnY = sampleHeight(spawnPoint.x, spawnPoint.y) + SPAWN_HEIGHT_OFFSET;
    this.player.respawn(new THREE.Vector3(spawnPoint.x, spawnY, spawnPoint.y));
    // Re-arm death handling at the respawn itself, not on the next tick: this runs after an await,
    // so a goose explosion landing between here and that tick would otherwise kill the player with
    // deathHandled still true from the previous death, skipping the whole death sequence.
    this.deathHandled = false;
    this.weaponManager.resetAllAmmo();
    this.entityManager.clearAll();
    if (this.hordeGooseManager) {
      this.hordeGooseManager.recenter(spawnPoint.x, spawnPoint.y);
      this.hordeGooseManager.resetToWaveOne();
    } else {
      this.gooseManager.clearAll();
      this.gooseManager.spawnInitialBatch(SPAWN_X, SPAWN_Z);
      const generation = ++this.spawnGeneration;
      void Game.spawnEncountersAsync(
        this.entityManager,
        this.matchConfig.targetCount,
        this.matchConfig.enemyCount,
        undefined,
        () => this.spawnGeneration !== generation,
      );
    }
    this.impactMarkers.clear();
    this.tracers.clear();
    this.scoreState.value = 0;
    this.deathScreen.hide();
    this.deathScreenVisible = false;
    this.pendingDeathScreenReveal = false;
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
    // 'night' always wins over the quality-tier ambient rule (see the matchWeather field's
    // comment) - otherwise switching graphics quality mid-match would silently undo the night
    // brightness floor and leave the match unplayably dark.
    this.ambientLight.intensity =
      this.matchWeather === 'night' ? NIGHT_AMBIENT_INTENSITY : quality.environmentLighting ? 0 : AMBIENT_FILL_INTENSITY;
    this.sun.castShadow = quality.shadowsEnabled;
    if (this.sun.shadow.mapSize.width !== quality.shadowMapSize) {
      this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Fire-and-forget match-end telemetry beacon (docs/CODE_REVIEW.md's Phase 8 roadmap;
   * functions/api/telemetry.ts is the receiving end) - called once from each mode's own natural
   * match-end funnel (the death-detection block below for single-player, endMultiplayerMatch for
   * multiplayer). Deliberately minimal and non-identifying, matching the roadmap item's own stated
   * scope: which mode, wave reached (Goose Horde) or kill count (every other mode), how long the
   * match ran, and this build's version - no username, no room code, nothing that identifies the
   * player. `keepalive: true` lets the request survive the page-unload/navigation that a match end
   * often immediately triggers (returning to the lobby, closing the tab). Never awaited and never
   * allowed to throw back into its caller - a telemetry failure must not affect, delay, or block
   * the actual match-end UI in any way. */
  private sendMatchTelemetry(mode: GameMode, waveOrKills: number, durationMs: number): void {
    try {
      const body = JSON.stringify({ mode, waveOrKills, durationMs, version: APP_VERSION });
      void fetch('/api/telemetry', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    } catch {
      // Same "never affect the caller" contract as the .catch above - covers the synchronous throw
      // path (e.g. fetch not defined at all in some exotic environment) that a .catch alone can't.
    }
  }

  /** Settings panel's Field of View slider (see SettingsPanel's onFovChange) - applies straight to
   * the live camera for instant visual feedback while the panel is open. WeaponManager.updateAim
   * independently re-reads Settings.getFov() every frame once gameplay resumes and isn't frozen
   * behind the pause menu anymore (see its own comment), so this is a one-time nudge for the
   * preview, not the only place this setting ever takes effect. */
  private applyFov(value: number): void {
    this.renderer.camera.fov = value;
    this.renderer.camera.updateProjectionMatrix();
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
    this.tickCount++;
    // Match end (MULTIPLAYER_PLAN.md §7 phase 4) freezes simulation permanently for the rest of
    // this Game instance, unlike a single death - MatchEndScreen (shown by App, not Game) is what
    // the player sees, and it stays alive underneath until Rematch/Return to Lobby is clicked.
    if (this.multiplayerMatchState.hasEnded) {
      this.input.consumeLookDelta();
      return;
    }

    // Mode-briefing gate (per explicit user request - see worldBriefingActive's own comment): the
    // world isn't "live" yet, so nothing gets to simulate - no enemy/goose AI, no wave spawner, no
    // physics for anything but staying rendered in its current pose. Checked before the ordinary
    // pause gate below on purpose: ModeExplanationScreen is its own overlay, not the pause menu,
    // and pointer lock is deliberately never requested while this is active (see start()), so the
    // isPaused formula below would otherwise also show the pause menu underneath it.
    if (this.worldBriefingActive) {
      this.input.consumeLookDelta();
      this.resendModeExplanationReady(dt);
      return;
    }

    // Pointer lock is the single source of truth for "paused": pressing Escape forces the browser
    // to release it (can't be prevented), and a freshly loaded match starts unlocked too - both
    // cases should show the pause menu and freeze simulation. Death has its own overlay instead -
    // gated on `deathScreenVisible`, not `player.isDead` directly, so a death detected while
    // already paused (multiplayer only) doesn't auto-hide the pause menu before the player has
    // actually chosen to resume (see pendingDeathScreenReveal's own comment).
    const isPaused = !this.input.isLocked && !this.deathScreenVisible;
    this.pauseMenu.setVisible(isPaused);
    this.pauseMenu.update();

    // The deferred reveal from below - fires the first tick the pause menu is no longer open.
    if (this.pendingDeathScreenReveal && !isPaused) {
      this.pendingDeathScreenReveal = false;
      this.deathScreen.show(this.scoreState.value);
      this.deathScreenVisible = true;
      this.input.releasePointerLock();
    }

    // Single-player can freeze everything unconditionally while paused - nothing else is "live"
    // to notice. Multiplayer can't: the opponent's client keeps running and keeps sending
    // damageEvent/playerDied regardless of this client's own pause state, so pausing must never be
    // a way to dodge incoming damage - without this exception, all queued damage would just pile
    // up unapplied and land in one lump the instant the player unpaused, meaning they could simply
    // never unpause to become effectively unkillable while still looking alive to the opponent.
    if (isPaused && !this.multiplayer) {
      this.input.consumeLookDelta();
      // WeaponManager.update doesn't run while frozen, so without this the scope overlay and zoomed
      // FOV stayed up behind the pause menu.
      this.weaponManager.cancelAim();
      return;
    }

    if (!isPaused && this.input.consumeJustPressed('resetPlay')) {
      void this.resetPlay();
    }

    // Re-arms death handling the first tick the player is alive (see deathHandled).
    if (!this.player.isDead) this.deathHandled = false;

    if (this.pendingNetworkDamage > 0) {
      this.player.takeDamage(this.pendingNetworkDamage);
      this.pendingNetworkDamage = 0;
    }

    if (this.pendingDebugDamage > 0) {
      this.player.takeDamage(this.pendingDebugDamage);
      this.pendingDebugDamage = 0;
    }

    // Advances every RemotePlayer's damped position/collider *before* this tick's own hitscan can
    // fire, not after - moved here from the end of update() (see the old updateMultiplayer, which
    // ran after weaponManager.update()) because that ordering meant every shot raycast against a
    // collider position that was one whole extra frame stale on top of the network sync lag
    // already inherent to the snapshot-sync model, silently shrinking the real hit window on top
    // of that inherent lag for no reason - fixable, unlike the network lag itself.
    if (this.multiplayer) {
      for (const opponent of this.multiplayer.opponents.values()) opponent.remotePlayer.update(dt);
    }

    const freezeLocalPlayer = this.player.isDead || isPaused;
    if (freezeLocalPlayer) {
      // Keep draining look input so it doesn't build up a stale jump in camera angle on
      // respawn/unpause.
      this.input.consumeLookDelta();
      // Same as the single-player pause above: drop the scope/zoom behind the death screen or pause menu.
      this.weaponManager.cancelAim();
    } else {
      // Runs before weaponManager.update() specifically so a throw's 'fire' press is consumed
      // here first - WeaponManager never sees it, so the harmless 'unarmed' placeholder weapon
      // never has anything to (not) do with it either.
      this.gooseTossController?.update(this.player.position, this.input);
      // Same input-consumption trick as GooseTossController above, narrower in scope: only a fire
      // press while actually carrying is consumed here (to drop it), so aim/reload/switch and
      // ordinary firing while NOT carrying all still reach WeaponManager normally - King of the
      // Hill keeps the full arsenal, unlike Goose Toss's unarmed-only loadout.
      this.kingOfTheHillController?.update(dt, this.player.position, this.input);
      this.player.update(dt, this.input);
      this.weaponManager.update(dt, this.input, this.player);
    }

    // The shared world - physics (including every RemotePlayer/goose collider), and the
    // host-authoritative goose simulation - must keep advancing regardless of THIS client's own
    // pause/death state in multiplayer (per user request: pausing/dying must never freeze anything
    // for anyone else, whether it's the host or a guest paused - a paused host that stops
    // broadcasting goose snapshots/adjudicating hits would otherwise silently stall every other
    // player's geese too, only "catching up" - explosions and all - the instant the host unpauses).
    // Single-player keeps the old full-freeze pause behavior (nothing else is "live" to notice in
    // solo play, and freezing on death already matches the existing death-screen/reset flow).
    if (this.multiplayer || !freezeLocalPlayer) {
      this.physics.step(dt);
      this.chunkManager.update(this.player.position.x, this.player.position.z);
      this.entityManager.update(dt, this.player);
      this.gooseManager.update(dt, this.player, this.multiplayer?.gooseDifficulty ?? this.matchConfig.gooseDifficulty, this.multiplayer?.session.role === 'host');
      this.updateThrownGeese(dt);

      // Goose Horde: no-op for a follower (guest) manager - see HordeGooseManager's isAuthoritative
      // comment. Every living player (own + every opponent) is a valid target so co-op geese chase
      // whoever's nearest, not just the local player.
      if (this.hordeGooseManager) {
        // Dead/permanently-eliminated players are filtered out (M2, 2026-07-10 review) - a corpse
        // never moves again and an eliminated opponent's avatar freezes in place once it stops
        // broadcasting snapshots, so geese kept pathing to a stale position and exploding against
        // nobody instead of concentrating pressure on whoever's actually still up.
        const targets: THREE.Vector3[] = [];
        if (!this.player.isDead) targets.push(this.player.position);
        if (this.multiplayer) {
          for (const opponent of this.multiplayer.opponents.values()) {
            if (opponent.isDead || this.multiplayer.hordeEliminatedSlots.has(opponent.slot)) continue;
            targets.push(opponent.remotePlayer.position);
          }
        }
        this.hordeGooseManager.update(dt, targets, this.multiplayer?.session.role === 'host');
        this.hordeWaveIndicator?.set(this.hordeGooseManager.currentWave, this.hordeGooseManager.totalWaves);
        // Multiplayer Goose Horde previously had no win path at all - clearing wave 10 only ever
        // showed the "you survived!" toast (onCleared), with nothing calling endMultiplayerMatch,
        // so a co-op win just left the match running indefinitely with nothing left to fight.
        // Every client reaches isCleared independently off the same host-authoritative wave state,
        // so this converges the same way every other win/loss condition in this protocol does.
        // Confirmed bug, fixed alongside M4 in the 2026-07-10 review.
        if (this.multiplayer && this.hordeGooseManager.isCleared && !this.multiplayerMatchState.hasEnded) {
          this.endMultiplayerMatch(true, 'hordeCleared');
        }
      }

      // Bonus golden goose - no-op for a follower (guest) manager, same reasoning as above.
      this.bonusGooseManager?.update(dt, this.multiplayer?.session.role === 'host');

      // Goose Horde multiplayer's ammo crates.
      if (this.ammoDropManager) this.updateHordeAmmoDrops(dt);

      // Goose Toss's constant ambient supply (per user request - "many, many geese... spawned
      // across the map constantly"), independent of the normal spawn-on-death trigger above.
      // Host-only, same authority rule as every other goose spawn path.
      if (this.multiplayer?.gameMode === 'gooseToss' && this.multiplayer.session.role === 'host') {
        this.gooseTossSpawnAccumulator += dt;
        if (this.gooseTossSpawnAccumulator >= GOOSE_TOSS_SPAWN_INTERVAL_SECONDS) {
          this.gooseTossSpawnAccumulator = 0;
          this.gooseManager.spawnRandomOnMap(SPAWN_X, SPAWN_Z);
        }
      }
    }

    const activeWeaponId = this.weaponManager.activeWeaponId;
    if (this.weaponManager.activeWeaponIndex !== this.lastActiveWeaponIndex || activeWeaponId !== this.lastActiveWeaponId) {
      // A same-slot swap (launcher grant, Gun Game upgrade) changes the slot's name too.
      if (activeWeaponId !== this.lastActiveWeaponId) this.hotbar.setSlots(this.weaponManager.weaponSlotNames);
      this.lastActiveWeaponIndex = this.weaponManager.activeWeaponIndex;
      this.lastActiveWeaponId = activeWeaponId;
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
    this.gooseAnnouncement.update(dt);
    this.bigAnnouncement.update(dt);
    this.explosionEffect.update(dt);
    this.updateMultiplayer(dt);

    if (this.player.isDead && !this.deathHandled) {
      this.deathHandled = true;
      // Single-player's own match-end telemetry funnel - there's no explicit "match end" concept
      // in single-player (the player can respawn indefinitely via resetPlay), so a death is the
      // natural per-run boundary, same as the death screen's own score readout. Multiplayer sends
      // its own telemetry from endMultiplayerMatch instead - a single death there is a respawn,
      // not the actual end of the match, so this would fire far too often to be a useful signal.
      if (!this.multiplayer) {
        const mode: GameMode = this.hordeGooseManager ? 'gooseHorde' : DEFAULT_GAME_MODE;
        const waveOrKills = this.hordeGooseManager ? this.hordeGooseManager.currentWave : this.scoreState.value;
        this.sendMatchTelemetry(mode, waveOrKills, performance.now() - this.matchStartedAt);
      }
      // King of the Hill: dying while carrying the golden goose drops it right where the player
      // fell, per explicit user request ("if the player is killed then the goose is left at the
      // location for anyone to pick up") - same drop path a voluntary fire-button drop uses.
      if (this.multiplayer) {
        this.kingOfTheHillController?.dropIfCarrying(this.multiplayer.session.ownSlot, this.player.position.clone());
      }
      // Per user request: the death/respawn screen must never overlay the pause menu - if the
      // pause menu is currently open (multiplayer only; single-player can't reach this block while
      // paused, see the early return above), defer the actual reveal until the player resumes
      // (see the top-of-tick check above). The death ITSELF - goose spawn, network broadcast,
      // scoreboard credit below - still happens immediately regardless, since other players are
      // watching this in real time and must not be held up by this client's own menu.
      if (isPaused) {
        this.pendingDeathScreenReveal = true;
      } else {
        this.deathScreen.show(this.scoreState.value);
        this.deathScreenVisible = true;
        this.input.releasePointerLock();
      }
      // "A goose spawns whenever a player dies" - single-player has no host, it's just always
      // authoritative for itself. In multiplayer only the host may create an authoritative goose
      // (see GooseManager's class comment); a dying guest's own death is instead handled when the
      // host receives that guest's playerDied message below (see the 'playerDied' case).
      if (!this.hordeGooseManager && (!this.multiplayer || this.multiplayer.session.role === 'host')) {
        this.gooseManager.spawnNear(this.player.position.x, this.player.position.z);
      }
      if (this.multiplayer) {
        // No other player has visibility into this client's health - this is the only way they
        // learn a kill actually landed. `lastDamageSourceSlot` is this client's own best-effort
        // record of who dealt it (see the damageEvent handler in create()) - self-reported, not
        // adjudicated by anyone else, same trust model this protocol already uses for health.
        const recentlyDamaged = performance.now() - this.multiplayer.lastDamageSourceAt <= MULTIPLAYER_KILL_CREDIT_WINDOW_MS;
        const killerSlot = recentlyDamaged ? this.multiplayer.lastDamageSourceSlot : null;
        const ownSlot = this.multiplayer.session.ownSlot;
        this.multiplayer.session.connection.send({ type: 'playerDied', senderSlot: ownSlot, victimSlot: ownSlot, killerSlot });
        // Goose Horde is co-op - per explicit user request, nobody should score points off a
        // teammate's death (accidental friendly fire or otherwise), and there's no kill-limit win
        // condition for this mode anyway (see updateMultiplayer's own gooseHorde skip). Every other
        // mode keeps the normal self-reported scoreboard update, applied locally rather than
        // waiting to receive its own broadcast back (a host never receives its own sent messages,
        // and a guest's message never loops back to it either).
        // applyDeath itself already skips Goose Horde internally (see its own comment) - this mode
        // has no kill-limit win condition anyway (see updateMultiplayer's own gooseHorde skip).
        this.multiplayerMatchState.applyDeath(this.multiplayer.gameMode, { victimSlot: ownSlot, killerSlot });
        // Goose Horde's limited-lives rule (per explicit user request): each player gets
        // HORDE_MAX_RESPAWNS respawns before this exact death permanently eliminates them instead
        // of auto-respawning (see updateMultiplayer's own gate on this). Self-authoritative and
        // broadcast so every client converges on the same eliminated set without host adjudication.
        if (this.multiplayer.gameMode === 'gooseHorde') {
          if (this.multiplayer.hordeRespawnsUsed >= HORDE_MAX_RESPAWNS) {
            this.multiplayer.hordeEliminatedSlots.add(ownSlot);
            this.multiplayer.session.connection.send({ type: 'hordePlayerEliminated', slot: ownSlot });
            this.checkHordeAllEliminated();
          } else {
            this.multiplayer.hordeRespawnsUsed++;
          }
        }
      }
    }

    this.hud.setAmmo(this.weaponManager.ammo, this.weaponManager.magazineSize, this.weaponManager.isReloading, this.weaponManager.activeReserve);
    // Goose Toss has no real weapon to name (see gameModes.ts's 'unarmed' placeholder) - shows
    // what actually matters here instead: whether this player is currently holding a goose.
    this.hud.setWeaponName(
      this.gooseTossController ? (this.gooseTossController.isHolding ? 'Holding a Goose' : 'Empty-Handed [E to pick up]') : this.weaponManager.weaponName,
    );
    this.hud.setScore(this.scoreState.value);
    this.hud.setHealth(this.player.currentHealth, this.player.maxHealth);
    this.hotbar.setActive(this.weaponManager.activeWeaponIndex);
  };

  /** RemotePlayer always smooths toward its last snapshot every tick, independent of send timing -
   * `snapshotAccumulator` only gates how often *this* client broadcasts its own state
   * (PLAYER_SNAPSHOT_SEND_INTERVAL, ~18Hz), not how often an opponent's visual position gets
   * smoothed. */
  private updateMultiplayer(dt: number): void {
    if (!this.multiplayer) return;

    // Every RemotePlayer's own position/collider is advanced earlier in update(), before this
    // tick's hitscan can fire (see that call site's comment) - this just reads the already-updated
    // positions for the minimap.
    const opponentPositions = new Map(Array.from(this.multiplayer.opponents, ([slot, o]) => [slot, o.remotePlayer.position] as const));
    this.multiplayer.minimap.update(this.player.position, opponentPositions, this.player.facingYaw, this.ammoDropManager?.positions());
    const opponentHealths = new Map(Array.from(this.multiplayer.opponents, ([slot, o]) => [slot, o.health] as const));
    this.multiplayer.multiplayerHud.update(
      this.player.currentHealth,
      this.player.maxHealth,
      opponentHealths,
      this.multiplayerMatchState.scoreboard,
      this.multiplayer.gameMode === 'kingOfTheHill'
        ? { pointsToWin: KOTH_POINTS_TO_WIN, carrierSlot: this.goldenGooseManager?.carrierSlot ?? null }
        : undefined,
    );

    // Win condition: first to killLimit ends the match. Checked here rather than where each score
    // actually changes (the playerDied handling scattered across create()'s onMessage and update()'s
    // own death-transition block) so there's exactly one place that decides "the match is over,"
    // regardless of which slot's score just crossed the line. Only the HOST runs this check and then
    // announces the result (MatchEndedMessage): when every client decided independently, two players
    // reaching the limit at the same moment could each see the other win, because each client
    // credits its own death at once but everyone else's one network hop later.
    if (!this.multiplayerMatchState.hasEnded) {
      // King of the Hill scores points, not kills, and Goose Horde has no scoreboard win condition
      // at all (its survival/victory is driven entirely by HordeGooseManager's onCleared callback
      // instead - see the 'hordeCleared' toast above) - both handled inside findWinner itself.
      // Still tagged 'killLimit' as the end reason regardless of mode (the match-end screen's copy
      // just says "VICTORY"/"DEFEAT" either way, no mode-specific wording exists to reuse here).
      if (this.multiplayer.session.role === 'host') {
        const winner = this.multiplayerMatchState.findWinner(this.multiplayer.gameMode, this.multiplayer.killLimit);
        if (winner !== null) {
          this.hostDeclaredWinner = winner;
          this.multiplayer.session.connection.send({ type: 'matchEnded', ...this.endedMatchVerdict()! });
          this.endMultiplayerMatch(winner === this.multiplayer.session.ownSlot, 'killLimit');
        }
      }
    }
    if (this.multiplayerMatchState.hasEnded) return;

    // Gun Game's own golden-goose variant (see modeControllers/GunGameController.ts).
    this.gunGameController?.checkFinisherGrant(this.player, this.weaponManager, this.multiplayer.killLimit);

    // Host-only housekeeping: no separate server tick exists (the host IS just another player's
    // own tab), so expired rejoin reservations are polled from this client's own update loop
    // instead, at a coarse interval rather than every frame.
    if (this.multiplayer.hostRoster) {
      this.multiplayer.hostSweepAccumulator += dt;
      if (this.multiplayer.hostSweepAccumulator >= 1) {
        this.multiplayer.hostSweepAccumulator = 0;
        const now = performance.now();

        // Reservations whose MULTIPLAYER_REJOIN_GRACE_PERIOD_MS fully expired with no rejoin -
        // the return value was previously discarded, meaning nobody ever learned this slot's
        // roster/token entry was gone for good (distinct from the RemotePlayer visual, which
        // onPeerDisconnected/the staleness sweep below already removes immediately).
        for (const expiredSlot of this.multiplayer.hostRoster.sweepExpiredReservations(now)) {
          this.multiplayer.session.connection.send({ type: 'playerLeft', slot: expiredSlot });
        }

        // Proactively treat a silent opponent as disconnected rather than waiting on PeerJS/WebRTC's
        // own (not always reliable - see MULTIPLAYER_CONNECTION_TIMEOUT_MS's own comment) close
        // detection - this is what actually fixes a RemotePlayer standing stuck forever after an
        // abrupt tab close that never fired a clean disconnect event.
        for (const opponent of this.multiplayer.opponents.values()) {
          // A permanently-eliminated horde player (see checkHordeAllEliminated) stops sending
          // playerSnapshot forever once dead (updateMultiplayer's own eliminated-branch early
          // return skips the broadcast below) - that silence is expected, not a dropped
          // connection, so it must not trip this staleness sweep. Without this guard, every
          // eliminated player gets spuriously marked 'playerLeft' within MULTIPLAYER_CONNECTION_
          // TIMEOUT_MS, which desyncs connectedCount (opponents.size+1) across clients - some end
          // up under-counting and end their own match early (silently, no broadcast to others)
          // while whichever client is still alive keeps waiting on a count that can now never be
          // satisfied, which is exactly what "waves never end" looks like from that client's side.
          if (this.multiplayer.gameMode === 'gooseHorde' && this.multiplayer.hordeEliminatedSlots.has(opponent.slot)) continue;
          if (now - opponent.lastMessageAt < MULTIPLAYER_CONNECTION_TIMEOUT_MS) continue;
          this.multiplayer.hostRoster.handleDisconnect(opponent.slot, now);
          // Actually close their connection too. A silent tab (typically backgrounded, which halts
          // its requestAnimationFrame loop) used to stay connected: removed from everyone's match,
          // never told so, yet its damageEvents were still relayed and applied. Closing it ends the
          // match on their side, and they can rejoin with the same room code.
          this.multiplayer.session.connection.disconnectGuest(opponent.slot);
          this.removeMultiplayerOpponent(opponent.slot);
          this.multiplayer.session.connection.send({ type: 'playerLeft', slot: opponent.slot });
        }
      }
    }

    if (this.player.isDead) {
      // Goose Horde's limited-lives rule: once this client's own slot is eliminated (respawns
      // exhausted), it just stays dead - no auto-respawn timer runs for it anymore. The match
      // itself only actually ends once every connected player reaches this state (see
      // checkHordeAllEliminated, called at the moment elimination happens, not polled here).
      const eliminated = this.multiplayer.gameMode === 'gooseHorde' && this.multiplayer.hordeEliminatedSlots.has(this.multiplayer.session.ownSlot);
      if (!eliminated) {
        this.multiplayer.deathTimer += dt;
        if (this.multiplayer.deathTimer >= MULTIPLAYER_RESPAWN_DELAY) {
          void this.multiplayerRespawn();
        }
      }
      return;
    }

    this.multiplayer.snapshotAccumulator += dt;
    if (this.multiplayer.snapshotAccumulator >= PLAYER_SNAPSHOT_SEND_INTERVAL) {
      this.multiplayer.snapshotAccumulator = 0;
      const p = this.player.position;
      this.multiplayer.session.connection.send({
        type: 'playerSnapshot',
        senderSlot: this.multiplayer.session.ownSlot,
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
   * death picks a new spot, not always the same one used at match start) - triggered automatically
   * MULTIPLAYER_RESPAWN_DELAY seconds after death (see updateMultiplayer), or immediately via the
   * death screen's Respawn button/T key (see resetPlay). Deliberately does not touch scoreState -
   * a kill/death in multiplayer shouldn't reset the running score the way single-player's
   * practice-reset does.
   *
   * Picked independently by this client alone, using plain Math.random() (no cross-client
   * agreement needed) - the chosen position rides on the respawnEvent message already sent below,
   * which is how every other player's RemotePlayer for this slot learns where to snap to either
   * way. Must clear MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT from *every* other currently
   * connected player, not just one. */
  private async multiplayerRespawn(): Promise<void> {
    if (!this.multiplayer) return;

    // A mid-match Loadout change (see handleLoadoutScreenClosed) takes effect right here - awaited
    // before resetAllAmmo() below so that call always targets the *current* WeaponManager, not one
    // about to be disposed. Same shape as single-player's resetPlay() own hook.
    await this.applyPendingLoadoutIfNeeded();
    if (!this.multiplayer) return; // re-check: the match could have ended while the rebuild awaited

    const ownSlot = this.multiplayer.session.ownSlot;
    const otherPositions = Array.from(this.multiplayer.opponents.values(), (o) => ({ x: o.remotePlayer.position.x, z: o.remotePlayer.position.z }));
    const { x, z } = pickRandomRespawnPoint(otherPositions, this.isSpawnBlocked);
    const spawnY = sampleHeight(x, z) + SPAWN_HEIGHT_OFFSET;
    this.player.respawn(new THREE.Vector3(x, spawnY, z));
    this.deathHandled = false; // same reason as resetPlay: re-armed at the respawn, not a tick later
    // Per user request: a fresh life should mean a fresh loadout, not carrying over whatever ammo
    // was left in each weapon at the moment of death - single-player's own resetPlay() already
    // does this same refill, this path (multiplayer's respawn) had just been missing it.
    this.weaponManager.resetAllAmmo();
    this.multiplayer.deathTimer = 0;
    this.multiplayer.lastDamageSourceSlot = null;
    // This runs on a fixed timer (updateMultiplayer) regardless of pause state - per user request,
    // dying/respawning must never stall just because this client is paused. But the reverse must
    // also hold: an auto-respawn firing while the pause menu is legitimately open must not yank
    // pointer lock away from the player mid-menu-browsing. `pauseMenuCurrentlyOpen` is captured
    // before clearing deathScreenVisible/pendingDeathScreenReveal below, since those flags are
    // exactly what distinguishes "pause menu open" from "death screen was showing" while input is
    // unlocked either way (see the main isPaused formula in update()).
    const pauseMenuCurrentlyOpen = !this.input.isLocked && !this.deathScreenVisible;
    this.deathScreen.hide();
    this.deathScreenVisible = false;
    this.pendingDeathScreenReveal = false;
    if (!pauseMenuCurrentlyOpen) this.input.requestPointerLock();
    this.multiplayer.session.connection.send({ type: 'respawnEvent', senderSlot: ownSlot, x, y: spawnY, z });
  }

  /** The pause menu's "Respawn" button (multiplayer only, gated behind PauseMenu's own 5-second
   * continuous-open unlock delay - see PauseMenu.ts). An unstuck button for a player who spawned
   * or got knocked inside geometry (e.g. inside a house), not a real respawn - deliberately does
   * NOT touch health/ammo/score the way multiplayerRespawn() (post-death) does, since a player
   * who is alive and just stuck has no business getting a free heal/reload out of this. Reuses
   * the same random-point-clear-of-every-opponent placement and respawnEvent broadcast so
   * everyone else's view of this player updates immediately, same as a real respawn. Player.
   * debugTeleport is the one existing method that repositions without touching health/ammo. */
  private manualRespawn(): void {
    if (!this.multiplayer || this.player.isDead) return;

    const ownSlot = this.multiplayer.session.ownSlot;
    const otherPositions = Array.from(this.multiplayer.opponents.values(), (o) => ({ x: o.remotePlayer.position.x, z: o.remotePlayer.position.z }));
    const { x, z } = pickRandomRespawnPoint(otherPositions, this.isSpawnBlocked);
    const spawnY = sampleHeight(x, z) + SPAWN_HEIGHT_OFFSET;
    this.player.debugTeleport(new THREE.Vector3(x, spawnY, z));
    this.multiplayer.session.connection.send({ type: 'respawnEvent', senderSlot: ownSlot, x, y: spawnY, z });
  }

  /** Goose Horde multiplayer's ammo crates: host-only spawn tick (see AmmoDropManager.update's own
   * role gate) plus every client's own walk-over pickup check - self-reported/relayed, no host
   * arbitration (see protocol.ts's HordeAmmoDropPickedUpMessage). Only refills whatever weapon this
   * player currently has active, per explicit user request. */
  private updateHordeAmmoDrops(dt: number): void {
    if (!this.ammoDropManager || !this.multiplayer) return;

    // Living players only: crates used to anchor near corpses (and near permanently eliminated
    // players) and could be walked over by a dead body.
    const positions: THREE.Vector3[] = [];
    if (!this.player.isDead) positions.push(this.player.position);
    for (const opponent of this.multiplayer.opponents.values()) {
      if (opponent.isDead || this.multiplayer.hordeEliminatedSlots.has(opponent.slot)) continue;
      positions.push(opponent.remotePlayer.position);
    }
    this.ammoDropManager.update(dt, positions, this.multiplayer.session.role === 'host');

    if (this.player.isDead) return;
    const nearestId = this.ammoDropManager.findNearestWithinRadius(this.player.position, HORDE_AMMO_DROP_PICKUP_RADIUS);
    if (nearestId === null || !this.ammoDropManager.removeById(nearestId)) return;
    this.multiplayer.minimap.removeItemDot(nearestId);
    const refillAmount = this.weaponManager.magazineSize * HORDE_AMMO_DROP_REFILL_MAGAZINES;
    if (Number.isFinite(refillAmount)) this.weaponManager.addReserveAmmoToActive(refillAmount);
    this.multiplayer.session.connection.send({ type: 'hordeAmmoDropPickedUp', senderSlot: this.multiplayer.session.ownSlot, id: nearestId });
  }

  /** Advances every in-flight ThrownGoose (own throws and every other player's mirrored copy -
   * see ThrownGoose.ts's class comment on thrower-only authority). Only the thrower's own copy
   * decides when/where it explodes and applies damage; every other client's copy is purely
   * cosmetic until a matching gooseThrowExploded message arrives (see the 'gooseThrowExploded'
   * case below) or its own GOOSE_THROW_MAX_LIFETIME_SECONDS safety timeout elapses (a dropped
   * message/relay-hop race shouldn't leave an orphaned goose flying forever). */
  private updateThrownGeese(dt: number): void {
    if (this.thrownGeese.size === 0) return;
    // null (not undefined) for single-player, matching ThrownGoose.throwerSlot's own null sentinel
    // for a single-player Goose Launcher shot - `undefined !== null` would otherwise misclassify a
    // single-player's own throw as "someone else's," skipping the authoritative resolution branch
    // below entirely.
    const ownSlot = this.multiplayer?.session.ownSlot ?? null;

    for (const thrown of Array.from(this.thrownGeese.values())) {
      thrown.update(dt);

      if (thrown.throwerSlot !== ownSlot) {
        if (thrown.age >= GOOSE_THROW_MAX_LIFETIME_SECONDS) {
          thrown.dispose(this.renderer.scene);
          this.thrownGeese.delete(thrown.id);
        }
        continue;
      }

      const groundY = sampleHeight(thrown.position.x, thrown.position.z);
      let hitPosition: THREE.Vector3 | null = null;
      if (thrown.position.y <= groundY + GOOSE_RADIUS) {
        hitPosition = new THREE.Vector3(thrown.position.x, groundY, thrown.position.z);
      } else if (thrown.position.distanceTo(this.player.position) <= GOOSE_RADIUS + PLAYER_RADIUS) {
        hitPosition = thrown.position.clone();
      } else if (this.multiplayer) {
        for (const opponent of this.multiplayer.opponents.values()) {
          if (thrown.position.distanceTo(opponent.remotePlayer.position) <= GOOSE_RADIUS + PLAYER_RADIUS) {
            hitPosition = thrown.position.clone();
            break;
          }
        }
      }

      if (hitPosition) {
        this.resolveThrownGooseExplosion(hitPosition, thrown.throwerSlot, thrown.source);
        thrown.dispose(this.renderer.scene);
        this.thrownGeese.delete(thrown.id);
        this.multiplayer?.session.connection.send({
          type: 'gooseThrowExploded',
          id: thrown.id,
          x: hitPosition.x,
          y: hitPosition.y,
          z: hitPosition.z,
          source: thrown.source,
        });
      }
    }
  }

  /** Shared by Goose Toss's thrown geese and the Goose Launcher weapon's shots (see ThrownGoose.ts's
   * class comment) - fixed blast size per `source` (per explicit user request, Goose Toss
   * deliberately ignores the host's chosen goose-explosion-difficulty setting, unlike every other
   * mode/trigger; the launcher has its own separate, deliberately powerful constants - see
   * config.ts's GOOSE_LAUNCHER_* comment). Applies splash damage to whichever players are actually
   * within range: self-applied directly if this client's own player is in range (every client stays
   * authoritative over its own health, same as everywhere else in this protocol), and via an
   * ordinary DamageEventMessage to any opponent in range - reusing the exact same message the
   * shooter of a normal weapon hit already sends, so kill credit flows through the existing
   * playerDied/scoreboard pipeline unchanged (per explicit user request: unlike a wandering goose's
   * own death, dying to either of these DOES count). */
  private resolveThrownGooseExplosion(position: THREE.Vector3, throwerSlot: PlayerSlot | null, source: 'gooseToss' | 'gooseLauncher'): void {
    const radius = source === 'gooseLauncher' ? GOOSE_LAUNCHER_EXPLOSION_RADIUS : GOOSE_TOSS_EXPLOSION_RADIUS;
    const maxDamage = source === 'gooseLauncher' ? GOOSE_LAUNCHER_EXPLOSION_MAX_DAMAGE : GOOSE_TOSS_EXPLOSION_MAX_DAMAGE;
    const knockbackStrength = source === 'gooseLauncher' ? GOOSE_LAUNCHER_EXPLOSION_KNOCKBACK_STRENGTH : GOOSE_TOSS_EXPLOSION_KNOCKBACK_STRENGTH;

    this.explosionEffect.spawn(position, radius);
    this.sound.playExplosion(
      enemyGunshotVolume(position.distanceTo(this.player.position)),
      computeStereoPan(this.player.position, this.player.facingYaw, position),
    );

    const selfDistance = position.distanceTo(this.player.position);
    const selfDamage = computeExplosionDamage(selfDistance, radius, maxDamage);
    if (selfDamage > 0) this.player.takeDamage(selfDamage);
    const knockback = computeKnockbackStrength(selfDistance, radius, knockbackStrength);
    if (knockback > 0) {
      this.player.applyKnockback(this.player.position.clone().sub(position), knockback);
    }

    // Single-player enemies/targets (a no-op in multiplayer, which has none). The launcher is the
    // golden goose's reward, and its blasts used to damage nothing but players.
    this.entityManager.applyExplosion(position, radius, maxDamage);

    if (!this.multiplayer || throwerSlot === null) return;
    for (const opponent of this.multiplayer.opponents.values()) {
      const amount = computeExplosionDamage(position.distanceTo(opponent.remotePlayer.position), radius, maxDamage);
      if (amount > 0) {
        this.multiplayer.session.connection.send({ type: 'damageEvent', senderSlot: throwerSlot, targetSlot: opponent.slot, amount });
      }
    }
  }

  /** Per user request: a kill resets the killer's health too, not just the one who died - the
   * dying player's own health already resets via player.respawn() above (delayed by
   * MULTIPLAYER_RESPAWN_DELAY); this is the *other* side of that same round-reset, called the
   * instant this client learns it was the one who got a particular kill (see the `playerDied`
   * message handler in create()). Reuses Player.respawn() at the player's own current position -
   * a no-op positionally, but it resets health/velocity/recoil/bob the same way a real respawn
   * does, which is the actual point here, not a bespoke narrower "heal" method for a one-line
   * difference.
   *
   * Guarded on !isDead - a mutual kill (each player's shot lands within the same exchange) means
   * this client can receive "you got a kill" credit for the opponent's death *after* its own death
   * has already been detected locally. Without this guard, respawn() would silently reset health
   * to full and flip isDead back to false outside the normal multiplayerRespawn() flow - the death
   * screen stays visible (deathScreenVisible is untouched) but updateMultiplayer()'s
   * `if (this.player.isDead)` auto-respawn branch would never run again, softlocking this client
   * on the death screen forever. Confirmed via a real 2-player playtest report ("we killed each
   * other at the same time and then neither of us could respawn"). Letting the normal death/
   * respawn sequence run its course uninterrupted is correct here regardless - a player who also
   * died in the same exchange has no health to usefully refill anyway. */
  healLocalPlayerToFull(): void {
    if (this.player.isDead) return;
    this.player.respawn(this.player.position);
    // A fresh round for the killer too: whoever damaged them before this kill no longer has a claim
    // on their next death.
    if (this.multiplayer) this.multiplayer.lastDamageSourceSlot = null;
  }

  /** Kicks off the pre-match mode-briefing gate for `mode` (no-op for `default`, which has no
   * MODE_EXPLANATIONS entry) - called once, right at the end of create(), before this Game
   * instance's first tick. `totalPlayers` is 1 in single-player. */
  private beginModeExplanation(mode: GameMode, totalPlayers: number): void {
    const explanation = MODE_EXPLANATIONS[mode];
    if (!explanation) return;
    this.worldBriefingActive = true;
    this.modeExplanationParticipants = this.multiplayer
      ? new Set([this.multiplayer.session.ownSlot, ...this.multiplayer.opponents.keys()])
      : new Set();
    this.modeExplanationScreen?.show(explanation.title, explanation.steps, totalPlayers);
    // A modeExplanationReady broadcast can arrive (and get recorded - see receiveModeExplanation-
    // Ready) before this method even runs, if another player clicks Skip while this client is
    // still mid-load - re-check immediately so that signal isn't silently lost.
    this.recheckModeExplanationReady();
  }

  /** The mode-briefing screen's Skip button - single-player dismisses immediately (nobody else to
   * wait on); multiplayer instead broadcasts its own readiness and waits for every other slot to
   * do the same (see receiveModeExplanationReady), so one player can't skip past the rules while
   * the rest of the room hasn't even read them yet. */
  private handleModeExplanationSkipClicked(): void {
    if (!this.worldBriefingActive) return;
    if (!this.multiplayer) {
      this.dismissModeExplanation();
      return;
    }
    const ownSlot = this.multiplayer.session.ownSlot;
    if (this.modeExplanationReadySlots.has(ownSlot)) return;
    this.multiplayer.session.connection.send({ type: 'modeExplanationReady', slot: ownSlot });
    this.receiveModeExplanationReady(ownSlot);
  }

  /** Multiplayer only - applies one slot's readiness (this client's own, or one learned via the
   * relayed modeExplanationReady broadcast) to the shared set, updates the live "N/M" readout, and
   * dismisses the briefing once every currently-connected player is accounted for - every client
   * converges on the same moment independently, same pattern as checkHordeAllEliminated. */
  private receiveModeExplanationReady(slot: PlayerSlot): void {
    if (!this.multiplayer) return;
    this.modeExplanationReadySlots.add(slot);
    // The briefing may not have been shown yet on this client (still mid-load while another
    // player already clicked Skip) - just remember the signal for beginModeExplanation to pick up
    // rather than acting on it early.
    this.recheckModeExplanationReady();
  }

  /** Unfreezes simulation and hands pointer lock back to the player - the world only actually
   * "starts" from this point on (see worldBriefingActive's own comment). */
  private dismissModeExplanation(): void {
    this.worldBriefingActive = false;
    this.modeExplanationScreen?.hide();
    this.input.requestPointerLock();
    // One last readiness broadcast on the way out: the slowest player may have finished loading only
    // moments ago, after this client's periodic resends had already stopped mattering to anyone else.
    if (this.multiplayer) this.multiplayer.session.connection.send({ type: 'modeExplanationReady', slot: this.multiplayer.session.ownSlot });
  }

  /** While waiting on the briefing, re-broadcast this client's own readiness every
   * MODE_EXPLANATION_READY_RESEND_SECONDS. A ready signal sent while another player was still inside
   * Game.create() landed on their room screen's (or App's silenced) callbacks and was dropped, and
   * the Skip button refuses to send twice, so a fast skipper could leave a slower loader frozen on
   * the briefing forever. Receivers dedupe via the ready-slot Set, so repeats are harmless. */
  private resendModeExplanationReady(dt: number): void {
    if (!this.multiplayer) return;
    const ownSlot = this.multiplayer.session.ownSlot;
    if (!this.modeExplanationReadySlots.has(ownSlot)) return;
    this.modeExplanationResendAccumulator += dt;
    if (this.modeExplanationResendAccumulator < MODE_EXPLANATION_READY_RESEND_SECONDS) return;
    this.modeExplanationResendAccumulator = 0;
    this.multiplayer.session.connection.send({ type: 'modeExplanationReady', slot: ownSlot });
  }

  /** The mid-match Loadout page's Close button - just hides it and marks a rebuild pending (see
   * applyPendingLoadoutIfNeeded); the pause menu underneath is still showing (pointer lock was
   * never re-requested to open this), so the player explicitly resumes from there same as closing
   * Settings. Applied at the *next* respawn per explicit user request, not instantly. */
  private handleLoadoutScreenClosed(): void {
    this.loadoutScreen?.hide();
    this.pendingLoadoutRebuild = true;
  }

  /** Opened from the pause menu (unrestricted modes only). Built on first use, see create(). */
  private openLoadoutScreen(): void {
    if (this.loadoutScreen) {
      this.loadoutScreen.show();
      return;
    }
    if (this.loadoutScreenLoading || !this.hudRoot) return;
    this.loadoutScreenLoading = true;
    void LoadoutScreen.create(this.hudRoot, () => this.handleLoadoutScreenClosed()).then((screen) => {
      this.loadoutScreenLoading = false;
      if (this.disposed) {
        screen.dispose();
        return;
      }
      this.loadoutScreen = screen;
      screen.show();
    }).catch(() => {
      // Without this a failed build left loadoutScreenLoading stuck true, so the pause menu's
      // Loadout button did nothing for the rest of the match (plus an unhandled rejection). Clearing
      // the flag lets the next click simply try again.
      this.loadoutScreenLoading = false;
    });
  }

  /** Called at the top of both resetPlay() (single-player) and multiplayerRespawn() (multiplayer) -
   * a no-op unless the mid-match Loadout page was actually closed since the last check. Rebuilds an
   * entirely fresh WeaponManager from whatever's currently stored (see core/loadout.ts) rather than
   * mutating the existing one's slots in place - same shape the initial match-start construction
   * already uses (see create()'s buildWeaponManager), just called again later with different
   * weaponIds. */
  private async applyPendingLoadoutIfNeeded(): Promise<void> {
    if (!this.pendingLoadoutRebuild || !this.rebuildWeaponManagerFn) return;
    this.pendingLoadoutRebuild = false;

    const mode: GameMode = this.multiplayer?.gameMode ?? (this.hordeGooseManager ? 'gooseHorde' : DEFAULT_GAME_MODE);
    const loadout = resolveWeaponLoadout(mode, Math.random, loadStoredLoadout());
    const isHordeMultiplayer = mode === 'gooseHorde' && !!this.multiplayer;
    const reserveAmmo = isHordeMultiplayer
      ? Object.fromEntries(loadout.weaponIds.map((id) => [id, (WEAPON_DEFINITIONS[id]?.magazineSize ?? 0) * HORDE_STARTING_RESERVE_MAGAZINES]))
      : undefined;

    this.weaponManager.dispose();
    this.weaponManager = await this.rebuildWeaponManagerFn(loadout.weaponIds, loadout.damageOverrides, reserveAmmo);
    this.hotbar.setSlots(this.weaponManager.weaponSlotNames);
    this.lastActiveWeaponIndex = -1; // forces the weapon-caption toast to re-announce the new active weapon, same as a fresh match start
  }

  /** Constructs a fresh RemotePlayer for a slot joining or rejoining an already-running match (see
   * protocol.ts's PlayerJoinedMatchMessage) - mirrors the initial-roster construction in create(),
   * just for one slot arriving later instead of everyone arriving at once. Placed at this client's
   * own current position as a harmless placeholder (their real position isn't known yet - their
   * first playerSnapshot corrects it within one send interval, imperceptibly). No-ops if the slot
   * is already tracked (a relay-hop race, or this client is the host that already added it inside
   * onHostHello before broadcasting - see create()'s own comment on that ordering). */
  private async addMultiplayerOpponent(slot: PlayerSlot, username: string): Promise<void> {
    if (!this.multiplayer || this.multiplayer.opponents.has(slot)) return;
    const remotePlayer = await RemotePlayer.create(
      this.physics,
      this.renderer.scene,
      this.player.position,
      (amount) => this.multiplayer!.session.connection.send({ type: 'damageEvent', senderSlot: this.multiplayer!.session.ownSlot, targetSlot: slot, amount }),
    );
    if (!this.multiplayer || this.multiplayer.opponents.has(slot)) {
      // Torn down or raced while the GLTF load above was in flight - don't leak the collider/mesh.
      remotePlayer.dispose(this.renderer.scene);
      return;
    }
    this.multiplayer.opponents.set(slot, { slot, remotePlayer, username, health: this.player.maxHealth, lastMessageAt: performance.now(), isDead: false });
    this.multiplayer.usernames.set(slot, username);
    this.multiplayer.minimap.addDot(slot);
    this.multiplayer.multiplayerHud.addOpponentRow(slot, username);
  }

  /** Removes a slot that disconnected mid-match (see protocol.ts's PlayerLeftMessage) - the match
   * continues for everyone else (per user decision), this just tears down that one slot's visuals.
   * Deliberately leaves multiplayerMatchState's scoreboard/deathCounts untouched - a disconnected
   * player's final score still needs to show correctly on the podium. */
  private removeMultiplayerOpponent(slot: PlayerSlot): void {
    if (!this.multiplayer) return;
    const opponent = this.multiplayer.opponents.get(slot);
    if (!opponent) return;
    // King of the Hill: if the departing player was carrying the golden goose, drop it at their
    // last known position right here - the only other drop paths are the carrier's own client
    // (voluntary fire-press or its own death), so without this a carrier disconnecting left
    // `carrierSlot` pointed at a slot that no longer exists, `isHeld` stuck true forever, and the
    // match unwinnable for everyone else. Every remaining client reacts to the same relayed
    // `playerLeft` message independently, so this needs no extra broadcast - it converges exactly
    // like every other self-reported/relayed state in this protocol.
    this.kingOfTheHillController?.dropLocallyIfCarrying(slot, opponent.remotePlayer.position.clone());
    opponent.remotePlayer.dispose(this.renderer.scene);
    this.multiplayer.opponents.delete(slot);
    this.multiplayer.minimap.removeDot(slot);
    this.multiplayer.multiplayerHud.removeOpponentRow(slot);
    // A departure shrinks the mode-briefing's own "everyone" total - without this, a player
    // disconnecting mid-briefing before clicking Skip could leave the remaining players stuck
    // waiting forever, since nothing else re-checks readiness once no further modeExplanationReady
    // message is ever coming for that slot. No-op if they were never a participant in the first
    // place (e.g. a mid-briefing joiner who never counted toward the total - see
    // modeExplanationParticipants's own comment).
    this.modeExplanationParticipants.delete(slot);
    this.recheckModeExplanationReady();
    // Goose Horde: the "everyone is out" check compares eliminated slots against CONNECTED players,
    // so a departed player must leave the eliminated set too. Otherwise, with 3 players, A eliminated
    // then leaving and B eliminated later counted 2 of 2 and ended the run while C was still alive.
    // Re-checking here also covers the reverse: the last surviving teammate leaving must end the run
    // for the eliminated players left waiting.
    this.multiplayer.hordeEliminatedSlots.delete(slot);
    this.checkHordeAllEliminated();
  }

  /** Re-evaluates the mode-briefing's ready count against the *current* opponent total without
   * marking any new slot ready - unlike receiveModeExplanationReady, this never adds to
   * modeExplanationReadySlots. Needed because the total (opponents.size + 1) can shrink out from
   * under an in-progress briefing (see removeMultiplayerOpponent), and nothing else would ever
   * re-check readiness once no further modeExplanationReady message is coming for the slot that
   * just left. */
  private recheckModeExplanationReady(): void {
    if (!this.multiplayer || !this.worldBriefingActive) return;
    // The frozen participant snapshot, not `opponents.size + 1` live - see
    // modeExplanationParticipants's own comment on why a live count deadlocks on a mid-briefing
    // joiner. A disconnect during the briefing still shrinks this (removeMultiplayerOpponent
    // removes the slot from the snapshot before calling this), so leaving still unblocks everyone
    // else exactly as before.
    const total = this.modeExplanationParticipants.size;
    this.modeExplanationScreen?.setReadyCount(this.modeExplanationReadySlots.size, total);
    if (this.modeExplanationReadySlots.size >= total) this.dismissModeExplanation();
  }

  /** Guest side of MatchEndedMessage: adopts the host's final scoreboard (so every podium is
   * identical) and ends the match with the host's verdict. No-op once already ended (a disconnect
   * or Horde result may have got there first). */
  /** Host only: the winner and final scoreboard it announced via MatchEndedMessage, or null while the
   * match runs (and always null on a guest, or in Goose Horde, which never has a scoreboard winner).
   * Replayed to any guest that asks for a sync afterwards (see MatchMessageRouter's gooseSyncRequest). */
  endedMatchVerdict(): { winnerSlot: PlayerSlot; scoreboard: { slot: PlayerSlot; score: number }[] } | null {
    if (this.hostDeclaredWinner === null) return null;
    return {
      winnerSlot: this.hostDeclaredWinner,
      scoreboard: Array.from(this.multiplayerMatchState.scoreboard, ([slot, score]) => ({ slot, score })),
    };
  }

  applyHostMatchEnd(winnerSlot: PlayerSlot, scoreboard: readonly { slot: PlayerSlot; score: number }[]): void {
    if (!this.multiplayer || this.multiplayerMatchState.hasEnded) return;
    this.multiplayerMatchState.replaceScoreboard(scoreboard);
    this.endMultiplayerMatch(winnerSlot === this.multiplayer.session.ownSlot, 'killLimit');
  }

  /** Goose Horde's limited-lives loss condition (per explicit user request: "if both players have
   * used their respawns then they lose") - generalized to "every currently-connected player," not
   * hardcoded to exactly 2, so it still holds correctly for a 3-4 player room. Called after any
   * elimination (this client's own, or one learned via the 'hordePlayerEliminated' broadcast) -
   * every client runs this same check against the same self-reported/relayed set, so they all
   * converge on ending the match at the same moment without host adjudication, same pattern as
   * every other win/loss condition in this protocol. */
  private checkHordeAllEliminated(): void {
    if (!this.multiplayer || this.multiplayer.gameMode !== 'gooseHorde') return;
    const connectedCount = this.multiplayer.opponents.size + 1;
    if (isHordeAllEliminated(this.multiplayer.hordeEliminatedSlots.size, connectedCount)) {
      // 'hordeWipe', not 'killLimit' - this mode has no kill limit at all, and mislabeling the
      // reason breaks any reason-specific copy (match-end title, rematch eligibility). Confirmed
      // bug, fixed in the 2026-07-10 review.
      this.endMultiplayerMatch(false, 'hordeWipe');
    }
  }

  /** Ends a multiplayer match, either because the win condition was reached (checked in
   * updateMultiplayer - every client decides independently off its own local scoreboard, kept in
   * sync purely by relaying playerDied messages, so no host adjudication is needed) or because the
   * host disconnected (wired to PeerConnection's onPeerDisconnected in create() - a guest has no
   * path to any other guest without the host relaying, so losing the host is unrecoverable for it).
   * Freezes simulation via multiplayerMatchState.hasEnded (see the top of update()) and hands off
   * to App, which owns MatchEndScreen and any rematch - Game itself never recreates or disposes
   * itself. */
  private endMultiplayerMatch(won: boolean, reason: MultiplayerMatchEndResult['reason']): void {
    if (this.multiplayerMatchState.hasEnded || !this.multiplayer) return;
    this.multiplayerMatchState.markEnded();
    this.input.releasePointerLock();
    const ownSlot = this.multiplayer.session.ownSlot;
    const placements = this.multiplayerMatchState.buildPlacements(this.multiplayer.usernames, ownSlot);
    // Wave reached for the co-op mode (no scoreboard at all), this client's own kill count for
    // every other mode - see sendMatchTelemetry's own comment on the payload's minimal shape.
    const waveOrKills = this.multiplayer.gameMode === 'gooseHorde'
      ? this.hordeGooseManager?.currentWave ?? 0
      : this.multiplayerMatchState.scoreboard.get(ownSlot) ?? 0;
    this.sendMatchTelemetry(this.multiplayer.gameMode, waveOrKills, performance.now() - this.matchStartedAt);
    this.onMultiplayerMatchEnd?.({
      reason,
      won,
      placements,
      killLimit: this.multiplayer.killLimit,
      gooseDifficulty: this.multiplayer.gooseDifficulty,
      gameMode: this.multiplayer.gameMode,
      weather: this.multiplayer.weather,
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
