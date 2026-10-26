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
import { getWatchTowerPositions, isPointInsideWatchTower, WatchTowerManager } from '../world/WatchTowerManager.ts';
import { WATCH_TOWER_ROOF_TOP } from '../world/towerDesign.ts';
import { ChunkManager } from '../world/ChunkManager.ts';
import { VegetationManager } from '../world/VegetationManager.ts';
import { sampleHeight, setHeightOverride } from '../world/TerrainGenerator.ts';
import { FacilityWorld } from '../world/facility/FacilityBuilder.ts';
import { LampBreakEffect } from '../world/facility/lampBreakEffect.ts';
import {
  cellCentre,
  encounterPoints,
  generateFacilityLayout,
  isSpawnBlocked as isFacilitySpawnBlocked,
  OPEN,
  playerStart,
  type FacilityLayout,
} from '../world/facility/facilityLayout.ts';
import { FacilityNav } from '../world/facility/facilityNav.ts';
import { FacilityObjects } from '../world/facility/FacilityObjects.ts';
import { FacilityInteraction } from './facilityInteraction.ts';
import { Enemy, setEnemyDoorGate, setEnemyEntrance, setEnemyFloor, setEnemyNavigator } from '../entities/enemies/Enemy.ts';
import { crossesClosedDoor, facilityBlocksThrow, facilityCeilingAt, facilityGoosePlacement, facilityHordeSite, facilityMissionObjectives } from '../world/facility/facilityModes.ts';
import { WeaponManager } from '../weapons/WeaponManager.ts';
import { WEAPON_DEFINITIONS } from '../weapons/definitions.ts';
import { ImpactMarkers } from '../combat/ImpactMarkers.ts';
import { MuzzleFlash } from '../combat/MuzzleFlash.ts';
import { Tracers } from '../combat/Tracers.ts';
import { ExplosionEffect } from '../combat/ExplosionEffect.ts';
import { Hud } from '../ui/hud.ts';
import { DamageArcs } from '../ui/damageArcs.ts';
import { WorldMarkers } from '../ui/worldMarkers.ts';
import { MissionState, missionMapMarkers, type MissionView } from './mission/missionState.ts';
import { UplinkBeacons } from '../world/UplinkBeacons.ts';
import { FACILITY_CONSOLE_HEIGHT } from '../world/facility/facilityConsoles.ts';
import { bearingDeg } from '../ui/compass.ts';
import { Hotbar } from '../ui/hotbar.ts';
import { ScopeOverlay } from '../ui/scope.ts';
import { HitMarker } from '../ui/hitMarker.ts';
import { DamageVignette } from '../ui/damageVignette.ts';
import { DeathScreen, type MissionResult } from '../ui/deathScreen.ts';
import type { MultiplayerMatchEndResult } from '../ui/matchEndScreen.ts';
import { WeaponCaption } from '../ui/weaponCaption.ts';
import { LongShotCallout } from '../ui/longShotCallout.ts';
import { KillFeed } from '../ui/killFeed.ts';
import { GooseAnnouncement } from '../ui/gooseAnnouncement.ts';
import { BigAnnouncement } from '../ui/bigAnnouncement.ts';
import { HordeWaveIndicator } from '../ui/hordeWaveIndicator.ts';
import { ModeExplanationScreen } from '../ui/modeExplanationScreen.ts';
import { Minimap } from '../ui/minimap.ts';
import { ValleyHouseMapLayer } from '../ui/valleyHouseMapLayer.ts';
import { FACILITY_MAP_RADIUS, FacilityMapLayer } from '../ui/facilityMapLayer.ts';
import { MultiplayerHud, scoreboardRows } from '../ui/multiplayerHud.ts';
import { PauseMenu } from '../ui/menu/PauseMenu.ts';
import { SettingsPanel } from '../ui/menu/SettingsPanel.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { isDamageable } from '../combat/damage.ts';
import { computeExplosionDamage, computeKnockbackStrength } from '../combat/explosion.ts';
import { SoundEngine } from '../audio/SoundEngine.ts';
import { FpsMeter } from './FpsMeter.ts';
import { PerfOverlay } from '../ui/perfOverlay.ts';
import { PerfLogger, type PerfContext } from './perfStats.ts';
import { ObstacleRegistry } from '../entities/enemies/tactics/obstacleRegistry.ts';
import { GlintMarkers } from '../combat/GlintMarkers.ts';
import { PacingDirector, type DirectorOptions, type WaveBias } from '../entities/enemies/director/pacingDirector.ts';
import { pickReinforcementSpawns, type SpawnOptions } from '../entities/enemies/director/reinforcementSpawner.ts';
import { archetypeNamed, type EnemyArchetype } from '../entities/enemies/archetypes.ts';
import { ENEMY_HEAD_OFFSET_Y } from '../entities/enemies/EnemyBody.ts';
import { mulberry32 } from '../utils/rng.ts';
import {
  ENEMY_DIRECTOR_DECAY_PER_SECOND,
  ENEMY_DIRECTOR_FADE_EXIT,
  ENEMY_DIRECTOR_INITIAL_COUNT,
  ENEMY_DIRECTOR_INTENSITY_PER_DAMAGE,
  ENEMY_DIRECTOR_INTENSITY_PER_KILL,
  ENEMY_DIRECTOR_KILL_RADIUS,
  ENEMY_DIRECTOR_MAX_ALIVE,
  ENEMY_DIRECTOR_PEAK_MAX,
  ENEMY_DIRECTOR_PEAK_MIN,
  ENEMY_DIRECTOR_PEAK_THRESHOLD,
  ENEMY_DIRECTOR_RELAX_MAX,
  ENEMY_DIRECTOR_RELAX_MIN,
  ENEMY_DIRECTOR_RETRY_DELAY,
  ENEMY_DIRECTOR_RUSHER_WAVE_SHARE,
  ENEMY_DIRECTOR_SNIPER_WAVE_SHARE,
  ENEMY_DIRECTOR_SPAWN_BEHIND_HALF_ANGLE_DEG,
  ENEMY_DIRECTOR_SPAWN_CANDIDATES,
  ENEMY_DIRECTOR_SPAWN_MAX_RADIUS,
  ENEMY_DIRECTOR_SPAWN_MIN_RADIUS,
  ENEMY_DIRECTOR_SPAWN_MIN_SPACING,
  ENEMY_DIRECTOR_SPAWN_RAYS,
  ENEMY_DIRECTOR_SPAWN_VIEW_MARGIN_DEG,
  ENEMY_DIRECTOR_WAVE_INTERVAL,
  ENEMY_DIRECTOR_WAVE_SIZE,
  ENEMY_GLINT_LEAD_TIME,
  ENEMY_HEIGHT,
  WORLD_EDGE_RAMP_START,
  ZONE_EDGE_MARGIN,
} from './config.ts';
import { computeStereoPan, enemyGunshotVolume, lampBreakVolume } from './positionalAudio.ts';
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
  type MatchMap,
  MULTIPLAYER_CONNECTION_POLL_INTERVAL,
  MULTIPLAYER_KILL_CREDIT_WINDOW_MS,
  MULTIPLAYER_MAX_PLAYERS,
  MULTIPLAYER_RESPAWN_DELAY,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SNAPSHOT_SEND_INTERVAL,
  SPAWN_STRUCTURE_CLEARANCE,
  SPAWN_X,
  SPAWN_Z,
  SUN_SHADOW_LIGHT_DISTANCE,
  SUN_SHADOW_BIAS,
  SUN_SHADOW_CAMERA_FAR,
  SUN_SHADOW_NORMAL_BIAS,
  SUN_SHADOW_ORTHO_HALF_EXTENT,
  APP_VERSION,
} from './config.ts';
import { getWorldSeed, randomizeWorldSeed, setWorldSeed } from './worldSeed.ts';
import { findClearSpawnPoint, pickRandomRespawnPoint, type SpawnBlockedCheck } from './multiplayerSpawn.ts';
import { isOpponentSilent } from './opponentLiveness.ts';
import { DEFAULT_GAME_MODE, grenadesEnabled, resolveWeaponLoadout, modeUsesCustomLoadout, type GameMode } from './gameModes.ts';
import { GrenadeSystem } from '../combat/grenades/GrenadeSystem.ts';
import { GrenadeEffects } from '../combat/grenades/GrenadeEffects.ts';
import { grenadeNetworkFor } from '../combat/grenades/grenadeNetwork.ts';
import { withBlastTargets } from '../combat/grenades/grenadeTargets.ts';
import { MODE_EXPLANATIONS } from './modeExplanations.ts';
import { equippedGrenade, loadStoredLoadout } from './loadout.ts';
import { LoadoutScreen } from '../ui/menu/LoadoutScreen.ts';
import { Settings } from '../settings/Settings.ts';
import { GRAPHICS_QUALITY_PRESETS, type GraphicsQualityPreset } from '../settings/graphicsQuality.ts';
import type { MultiplayerMatchStartParams, MultiplayerSession } from '../network/MultiplayerSession.ts';
import { HOST_SLOT, helloSupportsMap, type PlayerSlot } from '../network/protocol.ts';
import { LampSyncTracker, parseLampList } from '../network/lampSync.ts';
import { summarizeConnection } from '../network/connectionStats.ts';
import { createSendClock } from '../network/stateOrder.ts';
import type { ActiveMultiplayer, RemoteOpponent } from '../network/multiplayerMatchTypes.ts';
import { routeMatchMessage, type MatchMessageContext } from '../network/MatchMessageRouter.ts';
import { isHordeAllEliminated, MultiplayerMatchState } from '../network/MultiplayerMatchState.ts';
import { GooseTossController } from './modeControllers/GooseTossController.ts';
import { KingOfTheHillController } from './modeControllers/KingOfTheHillController.ts';
import { GunGameController } from './modeControllers/GunGameController.ts';
import { FACILITY_LOOK, type LookPreset } from '../render/look.ts';
import { Flashlight, RemoteTorches, torchAvailable, torchOnByDefault } from '../render/Flashlight.ts';
import { flashLightsPlayer, visibility } from '../entities/enemies/playerVisibility.ts';
import { createMatchPickups } from '../pickups/createMatchPickups.ts';
import { grenadeSupplyFrom } from '../pickups/pickupEffects.ts';
import type { PickupSystem } from '../pickups/PickupSystem.ts';

const SPAWN_HEIGHT_OFFSET = 2;

/** The pacing director's own seeded stream (enemy AI v2 step 6), at the offset the design reserved
 * for it: clear of every other world-seed offset (see EntityManager's COORDINATOR_SEED_OFFSET). It
 * drives both the director's rolls and where its reinforcements are drawn. */
const DIRECTOR_SEED_OFFSET = 419;
/** Reinforcements stay inside the same bound every other spawn keeps (zones, towers, the encounter
 * ring): short of the world's edge ramp, never on the edge mountain or past the last chunk. */
const DIRECTOR_SPAWN_MAX_WORLD_RADIUS = WORLD_EDGE_RAMP_START - ZONE_EDGE_MARGIN;
const DIRECTOR_OPTIONS: DirectorOptions = {
  intensityPerDamage: ENEMY_DIRECTOR_INTENSITY_PER_DAMAGE,
  intensityPerKill: ENEMY_DIRECTOR_INTENSITY_PER_KILL,
  decayPerSecond: ENEMY_DIRECTOR_DECAY_PER_SECOND,
  peakThreshold: ENEMY_DIRECTOR_PEAK_THRESHOLD,
  peakMin: ENEMY_DIRECTOR_PEAK_MIN,
  peakMax: ENEMY_DIRECTOR_PEAK_MAX,
  fadeExit: ENEMY_DIRECTOR_FADE_EXIT,
  relaxMin: ENEMY_DIRECTOR_RELAX_MIN,
  relaxMax: ENEMY_DIRECTOR_RELAX_MAX,
  maxAlive: ENEMY_DIRECTOR_MAX_ALIVE,
  waveSize: ENEMY_DIRECTOR_WAVE_SIZE,
  waveInterval: ENEMY_DIRECTOR_WAVE_INTERVAL,
  retryDelay: ENEMY_DIRECTOR_RETRY_DELAY,
  rusherWaveShare: ENEMY_DIRECTOR_RUSHER_WAVE_SHARE,
  sniperWaveShare: ENEMY_DIRECTOR_SNIPER_WAVE_SHARE,
};
const DIRECTOR_SPAWN_OPTIONS: SpawnOptions = {
  minRadius: ENEMY_DIRECTOR_SPAWN_MIN_RADIUS,
  maxRadius: ENEMY_DIRECTOR_SPAWN_MAX_RADIUS,
  behindHalfAngleDeg: ENEMY_DIRECTOR_SPAWN_BEHIND_HALF_ANGLE_DEG,
  candidates: ENEMY_DIRECTOR_SPAWN_CANDIDATES,
  rays: ENEMY_DIRECTOR_SPAWN_RAYS,
  // The sight check aims at an enemy's head: capsule centre above the ground, plus the head offset.
  headHeight: ENEMY_HEIGHT / 2 + ENEMY_HEAD_OFFSET_Y,
  minSpacing: ENEMY_DIRECTOR_SPAWN_MIN_SPACING,
};

/** One reinforcement as getDirectorDebug reports it. */
interface DirectorSpawnRecord {
  readonly x: number;
  readonly z: number;
  readonly playerX: number;
  readonly playerZ: number;
  readonly forwardX: number;
  readonly forwardZ: number;
  /** The spawner's verdict: no clear line from the player's eye when it was checked. */
  readonly hidden: boolean;
  /** Fresh check once placed: inside the player's view and with a clear line to its real head. */
  readonly onScreen: boolean;
}
const TARGET_RING_BASE_RADIUS = 15;
/** Facility encounters keep this far from the player's start (docs/facility-map.md). */
const FACILITY_ENCOUNTER_AVOID_RADIUS = 14;
/** How fast the hemisphere fill follows the baked probe under the camera, per second. */
const FACILITY_PROBE_DAMP_RATE = 4;

/** A Facility match's world (docs/facility-map.md): the built geometry with its baked light, the
 * layout it came from, and the single-player start that every reset returns to. */
interface FacilityMatch {
  readonly world: FacilityWorld;
  readonly layout: FacilityLayout;
  readonly start: { x: number; z: number };
  /** The minimap's plan of the layout (section 8). */
  readonly mapLayer: FacilityMapLayer;
  /** Sparks and glass from shot-out lamps (section 11). */
  readonly lampBreak: LampBreakEffect;
  /** Doors and breaker panels (section 12). */
  readonly objects: FacilityObjects;
}
/** No opponents: the single-player Facility minimap only shows the plan and enemy blips. */
const NO_OPPONENTS: ReadonlyMap<PlayerSlot, THREE.Vector3> = new Map();
/** Desired arc distance between neighboring spawns once a ring's base radius is too cramped for its count. */
const RING_SPACING = 2.2;
/** Entities spawned per batch before yielding a frame, so large match sizes don't spawn as one long stall. */
const SPAWN_BATCH_SIZE = 4;
/** While this client has clicked Skip on the mode briefing and is still waiting on others, it
 * re-broadcasts its readiness this often (see resendModeExplanationReady). */
const MODE_EXPLANATION_READY_RESEND_SECONDS = 1;

export interface MatchConfig {
  enemyCount: number;
  targetCount: number;
  gooseDifficulty: GooseExplosionDifficulty;
  map: MatchMap;
  /** Single-player's weather choice (PlaySetupModal); a multiplayer match reads it from its session. */
  weather: MatchWeather;
  /** Single-player only (see PlaySetupModal) - multiplayer's equivalent is gameMode==='gooseHorde'
   * instead (unused/false here for a multiplayer match, same as enemyCount/targetCount's zeros). */
  hordeMode: boolean;
  /** Single-player only (see PlaySetupModal): the pacing director runs the enemies (enemy AI v2
   * step 6). Never together with hordeMode; always false for a multiplayer match. */
  directorMode: boolean;
  /** Single-player only (see PlaySetupModal): the Uplink mission (docs/visual-overhaul.md, phase 4),
   * which runs the pacing director too. Never together with hordeMode or directorMode. */
  missionMode: boolean;
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
  /** Once-a-second performance rows (see perfStats.ts) - prints with `?perflog` in the URL or after
   * F4, always readable via window.__gameDebug.getPerfLog(). */
  private readonly perfLogger = new PerfLogger({
    consoleEnabled: new URLSearchParams(window.location.search).has('perflog'),
  });
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
  /** Enemy AI v2 step 6: the pacing director and its seeded stream, in a Director match only (see
   * updateDirector); null in every other match. */
  private readonly director: PacingDirector | null;
  private readonly directorRng: () => number;
  /** Player health at the director's last look, so it can tell damage taken per tick. */
  private directorLastHealth = 0;
  /** The Uplink mission and its visuals, set up after construction by startMission; null in every
   * other mode. */
  private mission: MissionState | null = null;
  private uplinkBeacons: UplinkBeacons | null = null;
  private worldMarkers: WorldMarkers | null = null;
  private missionKills = 0;
  private missionDamageTaken = 0;
  private missionLastHealth = 0;
  private missionClock = 0;
  /** True from the mission's win until Respawn restarts it: the world freezes behind the end screen. */
  private missionWon = false;
  private readonly missionMarkerPosition = new THREE.Vector3();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  /** The last wave's reinforcements, for getDirectorDebug. */
  private directorLastSpawns: DirectorSpawnRecord[] = [];
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
  private readonly hudForward = new THREE.Vector3();
  private secondsSinceShot = Infinity;
  private readonly playerVisibility = { value: 1, torchOn: false, eye: new THREE.Vector3(), aim: new THREE.Vector3() };
  private loadoutScreenLoading = false;
  private disposed = false;
  /** See makeSpawnBlockedCheck on the Valley; the layout's own check on the Facility. Built in
   * create() and handed to the constructor. */
  private readonly isSpawnBlocked: SpawnBlockedCheck;
  /** The probe under the camera, damped (see updateFacilityLight); primed on the first frame. */
  private readonly facilityProbe = new THREE.Color(0, 0, 0);
  private facilityProbePrimed = false;
  private readonly facilityTint = new THREE.Color();
  /** Single-player on the Facility (docs/facility-map.md, section 8): the plan and enemy blips. A
   * multiplayer match's minimap lives on `multiplayer` instead. Assigned in create(). */
  private soloMinimap: Minimap | null = null;
  /** Health, ammo and grenade pickups (docs/pickups.md); assigned in create() once the Game exists. */
  private pickups: PickupSystem | null = null;
  /** The Facility's doors and breakers as gameplay (core/facilityInteraction.ts); null on the Valley. */
  private facilityInteraction: FacilityInteraction | null = null;
  /** Host only: set once when it announces a scoreboard winner (see endedMatchVerdict). */
  private hostDeclaredWinner: PlayerSlot | null = null;
  private connectionPollAccumulator = 0;
  /** When this client re-broadcasts its dead Facility lamps (see network/lampSync.ts). */
  private readonly lampSync = new LampSyncTracker();
  /** Bumped by every add and remove of an opponent's slot: an add whose model load finishes after a
   * newer add or a removal for that slot (a playerLeft during the load) is dropped, not shown. */
  private readonly opponentGenerations = new Map<PlayerSlot, number>();
  /** Stamps `t` on this player's snapshots, deaths and respawns (see network/stateOrder.ts). */
  private readonly sendClock = createSendClock();
  private connectionPollInFlight = false;
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
  /** Frag and flash grenades (combat/grenades/GrenadeSystem.ts); set in create(). */
  grenades: GrenadeSystem | null = null;
  /** The grenades' view-model arm, arc preview, HUD marks, white-out and deafness; set in create(). */
  private grenadeEffects: GrenadeEffects | null = null;
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
    // The Valley's world managers; null on the Facility, which builds none of them.
    private readonly chunkManager: ChunkManager | null,
    private readonly buildings: BuildingManager | null,
    private readonly watchTowers: WatchTowerManager | null,
    /** Null on the Valley. */
    private readonly facility: FacilityMatch | null,
    private readonly torch: Flashlight | null,
    private readonly remoteTorches: RemoteTorches | null,
    private readonly matchWeather: MatchWeather,
    isSpawnBlocked: SpawnBlockedCheck,
    private readonly entityManager: EntityManager,
    // Mutable, not readonly: a mid-match Loadout change rebuilds this entirely at the player's next
    // respawn (see applyPendingLoadoutIfNeeded) rather than mutating WeaponManager's own internals.
    private weaponManager: WeaponManager,
    private readonly impactMarkers: ImpactMarkers,
    private readonly tracers: Tracers,
    private readonly muzzleFlash: MuzzleFlash,
    private readonly glintMarkers: GlintMarkers,
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
    private readonly damageArcs: DamageArcs,
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
    private readonly fillLight: THREE.HemisphereLight,
    private multiplayer: ActiveMultiplayer | null,
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
    this.isSpawnBlocked = isSpawnBlocked;
    this.directorRng = mulberry32(getWorldSeed() + DIRECTOR_SEED_OFFSET);
    this.director = !multiplayer && (matchConfig.directorMode || matchConfig.missionMode) && !matchConfig.hordeMode ? new PacingDirector(DIRECTOR_OPTIONS, this.directorRng) : null;
    this.directorLastHealth = player.currentHealth;
    hud.setObjective(this.director ? 'DIRECTOR' : matchConfig.hordeMode ? 'GOOSE HORDE' : 'ELIMINATION', this.director || matchConfig.hordeMode ? 'Survive the waves' : facility ? 'Clear the facility' : 'Clear the valley');
    hud.compass.setSunDirection(renderer.currentLook.sunDirection);
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
    const toSun = this.renderer.currentLook.sunDirection;
    this.sun.position.set(
      snappedX + toSun.x * SUN_SHADOW_LIGHT_DISTANCE,
      playerPos.y + toSun.y * SUN_SHADOW_LIGHT_DISTANCE,
      snappedZ + toSun.z * SUN_SHADOW_LIGHT_DISTANCE,
    );
    this.sun.target.updateMatrixWorld();
  }

  /** A player's own ranged pellet (docs/facility-map.md, section 11): a live lamp nearer than the
   * pellet's physics hit is shot out. The pellet itself carries on to that hit unchanged. */
  private handleHitscanRay(origin: THREE.Vector3, direction: THREE.Vector3, distance: number): void {
    if (!this.facility) {
      // A Valley house's ceiling lamp (docs/enterable-buildings.md), synced like a Facility lamp.
      const lamp = this.buildings?.houses.shootRay(origin, direction, distance);
      if (lamp) this.houseLampBroken(lamp.id, lamp, true);
      return;
    }
    const lamp = this.facility.world.rayHitLamp(origin, direction, distance);
    if (lamp >= 0) this.destroyFacilityLamp(lamp, true);
  }

  /** Shoots out a Facility lamp: its light leaves the room, sparks and glass fall and it breaks
   * audibly where it hung. `broadcast` for this player's own shot (other clients then do the same
   * on lampDestroyed). False when there is no such live lamp. */
  private destroyFacilityLamp(lamp: number, broadcast: boolean): boolean {
    const position = this.facility?.world.killLamp(lamp);
    if (!this.facility || !position) return false;
    this.facility.lampBreak.spawn(position);
    const at = new THREE.Vector3(position.x, position.y, position.z);
    const volume = lampBreakVolume(at.distanceTo(this.player.position));
    if (volume > 0) this.sound.playLampBreak(volume, computeStereoPan(this.player.position, this.player.facingYaw, at));
    if (broadcast && this.multiplayer) {
      this.multiplayer.session.connection.send({ type: 'lampDestroyed', senderSlot: this.multiplayer.session.ownSlot, lamp });
    }
    return true;
  }

  /** Shoots out Valley house lamp `id` (another player's lampDestroyed, or the debug API): dark for
   * good, with sparks and its sound when streamed in. False when it is no lamp or already dark. */
  private destroyHouseLamp(id: number, broadcast: boolean): boolean {
    const houses = this.buildings?.houses;
    if (!houses || !houses.isLampId(id) || houses.lights.isDead(id)) return false;
    this.houseLampBroken(id, houses.lights.killLamp(id), broadcast);
    return true;
  }

  /** A house lamp just broke (`at` where it hangs, null when not streamed in): its sound, and for
   * this player's own shot the lampDestroyed send. */
  private houseLampBroken(id: number, at: { x: number; y: number; z: number } | null, broadcast: boolean): void {
    if (at) {
      const position = new THREE.Vector3(at.x, at.y, at.z), volume = lampBreakVolume(position.distanceTo(this.player.position));
      if (volume > 0) this.sound.playLampBreak(volume, computeStereoPan(this.player.position, this.player.facingYaw, position));
    }
    if (broadcast && this.multiplayer) {
      this.multiplayer.session.connection.send({ type: 'lampDestroyed', senderSlot: this.multiplayer.session.ownSlot, lamp: id });
    }
  }

  /** This map's shot-out lamps as lampSync carries them: Facility indices, or Valley house lamp ids. */
  private readonly deadLampIds = (): readonly number[] =>
    this.facility?.world.deadLampIndices() ?? this.buildings?.houses.lights.deadLampIds() ?? [];

  /** Another player's whole dead-lamp set (lampSync): every listed lamp still lit goes dark
   * quietly, with no sparks or sound (it broke a while ago, out of this client's hearing). */
  private syncFacilityLamps(lamps: unknown): void {
    if (!this.facility) {
      this.buildings?.houses.killLampsQuietly(lamps);
      return;
    }
    this.facility.world.killLamps(parseLampList(lamps, this.facility.world.lampCount));
  }

  /** A playerSnapshot from `slot` on the Facility or the Valley: the first one sends them the doors
   * (host) and this client's dead lamps, which they may have missed while loading (see
   * network/lampSync.ts). */
  private noteOpponentInMatch(slot: PlayerSlot): void {
    if (!this.facility && !this.buildings) return;
    this.facilityInteraction?.opponentInMatch(slot);
    const lamps = this.lampSync.opponentSnapshot(slot, this.deadLampIds);
    if (lamps) this.sendLampSync(lamps);
  }

  private sendLampSync(lamps: number[]): void {
    if (this.multiplayer) this.multiplayer.session.connection.send({ type: 'lampSync', senderSlot: this.multiplayer.session.ownSlot, lamps });
  }

  /** The Facility's light for moving things (docs/facility-map.md, section 6): the hemisphere fill
   * takes the baked probe under the camera, damped so walking from a lit room into a dark corridor
   * fades rather than snaps, tinted by the probe's colour over the look's neutral-warm base. It
   * lights players, enemies and the gun the way the baked light lights the walls around them. Also
   * drifts the facility's dust around the camera. */
  private updateFacilityLight(dt: number): void {
    const facility = this.facility!;
    const camera = this.renderer.camera;
    facility.world.update(camera, dt);
    const [r, g, b] = facility.world.probeAt(camera.position.x, camera.position.z);
    const probe = this.facilityProbe;
    const blend = this.facilityProbePrimed ? 1 - Math.exp(-FACILITY_PROBE_DAMP_RATE * dt) : 1;
    this.facilityProbePrimed = true;
    probe.setRGB(probe.r + (r - probe.r) * blend, probe.g + (g - probe.g) * blend, probe.b + (b - probe.b) * blend);
    const peak = Math.max(probe.r, probe.g, probe.b);
    const look = this.renderer.currentLook;
    if (peak > 1e-6) {
      this.facilityTint.setRGB(probe.r / peak, probe.g / peak, probe.b / peak);
      this.fillLight.color.setHex(look.hemiSkyColor).multiply(this.facilityTint);
      this.fillLight.groundColor.setHex(look.hemiGroundColor).multiply(this.facilityTint);
    }
    this.fillLight.intensity = look.hemiIntensity * peak;
  }

  /** The match's torches, after the camera's interpolation:
   * the player's own on the gun (its body on the active ranged view model) or the shoulder, and one
   * pooled light per opponent, dark while their torch is off or they are dead. */
  private updateTorches(): void {
    const { torch, remoteTorches } = this;
    if (!torch) return;
    const mount = this.weaponManager.torchMount;
    torch.mountBody(mount);
    torch.update(this.renderer.camera, mount !== null);
    if (!remoteTorches) return;
    const sources = this.multiplayer
      ? Array.from(this.multiplayer.opponents.values(), (opponent) => ({
          position: opponent.remotePlayer.position,
          yaw: opponent.remotePlayer.lookYaw,
          pitch: opponent.remotePlayer.lookPitch,
          on: opponent.remotePlayer.torchOn && !opponent.isDead,
        }))
      : [];
    remoteTorches.update(sources);
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
      getActiveBuildingCount: () => this.buildings?.getActiveBuildingCount() ?? 0,
      getActiveTowerPositions: () => this.watchTowers?.getActiveTowerPositions() ?? [],
      getFrameStats: () => this.fpsMeter.getStats(),
      getPerfLog: () => [...this.perfLogger.log],
      getLiveEnemyDebug: () => this.entityManager.getLiveEnemyDebug(),
      getSquadDebug: () => this.entityManager.getSquadDebug(),
      placeEnemy: (index, x, z) => this.entityManager.placeEnemy(index, x, z),
      commandEnemy: (index, target) => this.entityManager.commandEnemy(index, target),
      getCoverNear: (x, z, radius) => this.entityManager.getCoverNear(x, z, radius),
      damageEnemy: (index, amount) => this.entityManager.damageEnemy(index, amount),
      getDirectorDebug: () =>
        this.director
          ? {
              phase: this.director.phase,
              intensity: this.director.intensity,
              totalSpawned: this.director.totalSpawned,
              lastSpawns: [...this.directorLastSpawns],
            }
          : null,
      getMissionDebug: () => {
        if (!this.mission) return null;
        const view = this.mission.view(this.player.position);
        return { ...view, won: this.missionWon, kills: this.missionKills, damageTaken: this.missionDamageTaken };
      },
      getHordeDebug: () =>
        this.hordeGooseManager ? { wave: this.hordeGooseManager.currentWave, geese: this.hordeGooseManager.listForSync() } : null,
      getFacilityDebug: () => {
        if (!this.facility) return null;
        const { layout, world } = this.facility;
        let openCells = 0;
        for (const kind of layout.kinds) if (kind === OPEN) openCells++;
        return {
          map: 'facility',
          seed: layout.seed,
          rooms: layout.rooms.length,
          openCells,
          lamps: layout.lamps.length,
          bakeMs: world.bakeMs,
          vertexCount: world.vertexCount,
          torchOn: this.torch?.isOn ?? false,
          deadLamps: world.deadLampIndices().length,
          ...this.facility.objects.counts(),
        };
      },
      getTorchDebug: () => ({ available: this.torch !== null, on: this.torch?.isOn ?? false, weather: this.matchWeather, facility: this.facility !== null }),
      facilityDoor: (index) => this.facility?.objects.debugDoor(index) ?? null,
      setFacilityDoor: (index, open) => this.facilityInteraction?.requestState('door', index, open) ?? false,
      facilityBreaker: (index) => this.facility?.objects.debugBreaker(index) ?? null,
      setFacilityBreaker: (index, on) => this.facilityInteraction?.requestState('breaker', index, on) ?? false,
      facilityLookTarget: () => this.facilityInteraction?.lookTarget() ?? null,
      getValleyHouses: () => this.buildings?.houses.debugHouses() ?? [],
      setValleyDoor: (id, open) => (this.buildings ? this.facilityInteraction?.requestState('door', id, open) ?? false : false),
      getHouseLights: () => this.buildings?.houses.lights.debug() ?? null,
      shootLamp: (index) => (this.facility ? this.destroyFacilityLamp(index, true) : this.destroyHouseLamp(index, true)),
      lampPosition: (index) => this.facility?.world.lampPosition(index) ?? null,
      getPickups: () => this.pickups?.views() ?? [],
      setPickupRespawnSeconds: (seconds) => this.pickups?.setRespawnSeconds(seconds),
      getGrenadeDebug: () => this.grenades?.debugState() ?? null,
      throwGrenade: (direction) => this.grenades?.debugThrow(direction) ?? null,
      setPlayerInvulnerable: (invulnerable) => {
        this.player.debugInvulnerable = invulnerable;
      },
      // e2e coverage predates 4-player support and only ever exercises 2-player matches - "the
      // opponent" there unambiguously means the one other player, i.e. the first (only) entry.
      getOpponentPosition: () => {
        const opponent = this.multiplayer?.opponents.values().next().value;
        if (!opponent) return null;
        const p = opponent.remotePlayer.position;
        return { x: p.x, y: p.y, z: p.z };
      },
      getNetworkDebug: () => ({
        fastChannelsReady: this.multiplayer?.session.connection.fastChannelReadyCount() ?? 0,
        pingLabel: this.multiplayer?.multiplayerHud.connectionText ?? '',
        directLinksReady: this.multiplayer?.session.connection.directLinksReady() ?? 0,
      }),
      getOpponentPositions: () =>
        Array.from(this.multiplayer?.opponents.values() ?? [], ({ slot, remotePlayer: { position: p } }) => ({ slot, x: p.x, y: p.y, z: p.z })).sort(
          (a, b) => a.slot - b.slot,
        ),
      getScoreboardRows: () => {
        if (!this.multiplayer) return [];
        const { ownSlot } = this.multiplayer.session;
        const names = this.multiplayer.usernames;
        return scoreboardRows(ownSlot, names.get(ownSlot) ?? 'You', this.multiplayer.opponents.keys(), names, this.multiplayerMatchState.scoreboard);
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

    // Host-chosen in multiplayer (see CreateRoomScreen), picked in single-player's PlaySetupModal. Applied
    // once here, before anything compiles, not live-toggleable like graphics quality - see
    // Renderer.setMatchWeather. The lights then take the same look.
    // The Facility (docs/facility-map.md) is indoors: weather does not apply, it has its own look.
    const isFacility = (multiplayer?.map ?? matchConfig.map) === 'facility';
    const matchWeather: MatchWeather = multiplayer?.weather ?? matchConfig.weather;
    if (isFacility) renderer.setMatchLook(FACILITY_LOOK);
    else renderer.setMatchWeather(matchWeather);
    const { sun, fillLight } = Game.addLighting(renderer.scene, quality, renderer.currentLook);
    const map = isFacility ? 'facility' : 'valley';
    const torch = torchAvailable(map, matchWeather) ? new Flashlight(renderer.scene, quality.shadowsEnabled) : null;
    torch?.setOn(torchOnByDefault(map, matchWeather));
    const remoteTorches = torch && multiplayer ? new RemoteTorches(renderer.scene, MULTIPLAYER_MAX_PLAYERS - 1) : null;

    // Cover for enemy position picking (enemy AI v2 step 3): trees and houses register themselves
    // here as their chunks load (the Facility's crates and pillars once, when it is built), and
    // EntityManager's enemies read it.
    const obstacles = new ObstacleRegistry();
    let chunkManager: ChunkManager | null = null;
    let buildings: BuildingManager | null = null;
    let watchTowers: WatchTowerManager | null = null;
    let facility: FacilityMatch | null = null;
    let isSpawnBlocked: SpawnBlockedCheck;
    if (isFacility) {
      // The Facility builds none of the outdoor world: its floor is flat at y = 0 for every height
      // query, and enemies route through its doors (both cleared in dispose).
      onProgress?.('Building the facility…', 0.02);
      await waitForNextFrame();
      const layout = generateFacilityLayout(getWorldSeed());
      setHeightOverride(() => 0);
      const nav = new FacilityNav(layout);
      setEnemyNavigator((fromX, fromZ, toX, toZ) => nav.nextWaypoint(fromX, fromZ, toX, toZ));
      onProgress?.('Baking light…', 0.03);
      await waitForNextFrame();
      const world = FacilityWorld.build(layout, {
        scene: renderer.scene,
        physics,
        obstacles,
        lightShafts: quality.postProcessing,
        dust: quality.postProcessing,
      });
      const objects = FacilityObjects.build(layout, world, nav, { scene: renderer.scene, physics });
      // Single-player starts in a room other than the atrium; plain Math.random like the other
      // single-player spawn picks (nobody else has to agree on it).
      facility = {
        objects,
        world,
        layout,
        start: playerStart(layout, Math.random),
        mapLayer: new FacilityMapLayer(layout, objects),
        lampBreak: new LampBreakEffect(renderer.scene),
      };
      // A late joiner starts with the lamps the others already shot out (section 11), quietly.
      // Their rebakes are queued and run one per frame (FacilityWorld.update).
      world.killLamps(parseLampList(multiplayer?.deadLamps, world.lampCount));
      isSpawnBlocked = (x, z) => isFacilitySpawnBlocked(layout, x, z);
    } else {
      // A failed Facility create could have left these set; the Valley always runs without them.
      setHeightOverride(null);
      setEnemyNavigator(null);
      setEnemyDoorGate(null);
      setEnemyFloor(null);
      setEnemyEntrance(null);
      onProgress?.('Growing vegetation…', 0.02);
      const vegetation = await VegetationManager.create(renderer.scene, physics, obstacles);
      onProgress?.('Constructing buildings…', 0.04);
      // Houses' ceiling lamps are lit at Night and in Fog (docs/enterable-buildings.md).
      const valleyBuildings = await BuildingManager.create(renderer.scene, physics, obstacles, { lampsOn: matchWeather !== 'day' });
      const roads = RoadManager.create(renderer.scene, valleyBuildings);
      const valleyTowers = WatchTowerManager.create(renderer.scene, physics);

      chunkManager = new ChunkManager(renderer.scene, physics, {
        onChunkLoaded: (cx, cz, originX, originZ, size) => {
          vegetation.placeForChunk(cx, cz, originX, originZ, size);
          valleyBuildings.placeForChunk(cx, cz, originX, originZ, size);
          roads.placeForChunk(cx, cz, originX, originZ, size);
          valleyTowers.placeForChunk(cx, cz, originX, originZ, size);
        },
        onChunkUnloaded: (cx, cz) => {
          vegetation.removeChunk(cx, cz);
          valleyBuildings.removeChunk(cx, cz);
          roads.removeChunk(cx, cz);
          valleyTowers.removeChunk(cx, cz);
        },
      });
      buildings = valleyBuildings;
      // A late joiner starts with the house lamps the others already shot out, quietly.
      valleyBuildings.houses.killLampsQuietly(multiplayer?.deadLamps);
      // Enemies walk into and out of the houses on their walk grids (docs/enterable-buildings.md).
      setEnemyNavigator(valleyBuildings.houses.nav.navigate);
      setEnemyFloor(valleyBuildings.houses.nav.floorAt);
      setEnemyEntrance(valleyBuildings.houses.nav.entranceAt);
      watchTowers = valleyTowers;
      isSpawnBlocked = makeSpawnBlockedCheck(valleyBuildings);
    }

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
    // playerSnapshot (~33 ms) corrects it, same as a late join. On the Facility the same search
    // steps it off the walls instead. Single-player on the Facility starts at the layout's start.
    const clearOwnSpawnPoint = ownSpawnPoint ? findClearSpawnPoint(ownSpawnPoint, isSpawnBlocked) : null;
    const ownSpawn = clearOwnSpawnPoint
      ? new THREE.Vector2(clearOwnSpawnPoint.x, clearOwnSpawnPoint.z)
      : facility
        ? new THREE.Vector2(facility.start.x, facility.start.z)
        : isHordeMode && !multiplayer
          ? pickRandomHordeSpawnPoint(isSpawnBlocked)
          : clearFixedSpawnPoint(isSpawnBlocked);

    // Seed enough chunks around spawn up front so the player never spawns over an ungenerated gap.
    if (chunkManager) {
      for (let i = 0; i < 30; i++) {
        chunkManager.update(ownSpawn.x, ownSpawn.y);
      }
    }

    const sound = await SoundEngine.create();
    document.addEventListener('click', () => sound.resume(), { once: true });

    const damageVignette = new DamageVignette(hudRoot);
    const damageArcs = new DamageArcs(hudRoot);
    const hud = new Hud(hudRoot);
    const spawnY = sampleHeight(ownSpawn.x, ownSpawn.y) + SPAWN_HEIGHT_OFFSET;
    const player = new Player(physics, renderer.camera, new THREE.Vector3(ownSpawn.x, spawnY, ownSpawn.y), {
      onDamaged: (sourcePosition) => {
        input.vibrate('damage');
        sound.playPlayerHurt();
        damageVignette.trigger();
        if (sourcePosition) {
          const bearing = bearingDeg(sourcePosition.x - player.position.x, sourcePosition.z - player.position.z);
          damageArcs.trigger(bearing);
          hud.compass.addContact(bearing);
        }
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
    // The Ridge Walker's long-shot warning (enemy AI v2 step 5).
    const glintMarkers = new GlintMarkers(renderer.scene);
    const scopeOverlay = new ScopeOverlay(hudRoot);
    const hitMarker = new HitMarker(hudRoot);
    const longShotCallout = new LongShotCallout(hudRoot);

    onProgress?.('Loading weapons…', 0.05);
    // The stored loadout is only ever consumed for the three unrestricted modes (see
    // modeUsesCustomLoadout) - harmless to always read/pass it in otherwise, every restricted
    // mode's own branch ignores the third parameter entirely.
    const storedLoadout = loadStoredLoadout();
    const loadout = resolveWeaponLoadout(currentGameMode, Math.random, storedLoadout);
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
            if (WEAPON_DEFINITIONS[game.weaponManager.activeWeaponId]?.kind === 'melee') sound.playKnifeHit();
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
        (origin, weaponId) => {
          sound.playKnifeSwing();
          multiplayer?.connection.send({
            type: 'fireEvent',
            senderSlot: multiplayer.ownSlot,
            originX: origin.x,
            originY: origin.y,
            originZ: origin.z,
            endX: origin.x,
            endY: origin.y,
            endZ: origin.z,
            weaponId,
          });
        },
        (weaponId) => {
          input.vibrate(WEAPON_DEFINITIONS[weaponId]?.automatic ? 'automatic' : 'fire');
          if (WEAPON_DEFINITIONS[weaponId]?.kind !== 'melee') sound.playGunshot(weaponId);
        },
        (weaponId) => sound.playReloadClick(weaponId),
        (distance) => longShotCallout.show(distance),
        (point, weaponId) => {
          muzzleFlash.spawn(point);
          game.secondsSinceShot = 0;
          // Threat perception (2026-07-10 review, enemy AI phase A): a real gunshot alerts nearby
          // idle enemies toward roughly where it came from, same as a real firefight - previously
          // enemies had no hearing at all, only reacting once the player walked inside their much
          // shorter detection bubble. The weapon id sets how far it carries (enemy AI v2 step 1).
          // Harmless no-op in multiplayer (no Enemy instances exist there).
          entityManager.notifyGunshot(point, weaponId);
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
        // Facility lamps are not physics colliders: each ranged pellet's ray is tested against them.
        (origin, direction, distance) => game.handleHitscanRay(origin, direction, distance),
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
        // Enemy AI v2 step 5: the squad's voiced callout for this tick, and visual cues - both
        // attenuated and panned like enemy gunshots, so they read as coming from that enemy.
        onCallout: (event) => {
          if (event.kind === 'glint' || event.kind === 'staggered') return;
          const origin = new THREE.Vector3(event.x, event.y, event.z);
          sound.playCallout(
            event.kind,
            enemyGunshotVolume(origin.distanceTo(player.position)),
            computeStereoPan(player.position, player.facingYaw, origin),
          );
        },
        onCue: (event) => {
          if (event.kind !== 'glint') return;
          const origin = new THREE.Vector3(event.x, event.y, event.z);
          glintMarkers.spawn(origin, ENEMY_GLINT_LEAD_TIME);
          sound.playGlint(
            enemyGunshotVolume(origin.distanceTo(player.position)),
            computeStereoPan(player.position, player.facingYaw, origin),
          );
        },
      },
      // Enemies may not pick a spot inside a house or a watch tower - the same check spawns use.
      { obstacles, isBlocked: isSpawnBlocked },
    );

    // Multiplayer matches are pure PvP (MULTIPLAYER_PLAN.md's premise: the bot/enemy system is
    // single-player "training" only) - never spawn AI encounters here, regardless of matchConfig.
    // Goose Horde also skips this (single-player's own hordeMode toggle) - the horde flock below
    // is the only thing attacking the player in that mode, not the regular enemy roster.
    if (!multiplayer && !matchConfig.hordeMode) {
      const counts = Game.encounterCounts(matchConfig);
      await Game.spawnEncountersAsync(entityManager, counts.targets, counts.enemies, facility, (status, spawnRatio) => {
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
        if (position.distanceTo(player.position) <= 10) input.vibrate('explosion');
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
    }, multiplayer?.gameMode === 'gooseToss' ? GOOSE_TOSS_MAX_CONCURRENT : GOOSE_MAX_CONCURRENT,
    // Indoors every goose lands on clear floor (docs/facility-map.md, "Modes on the Facility").
    facility ? facilityGoosePlacement(facility.layout, Math.random, facility.objects) : null);
    // Guests don't spawn anything themselves - they wait for the host's own initial-batch
    // gooseSpawned broadcasts (sent from this same call on the host's client) to arrive.
    // Goose Horde is excluded (per explicit user request "no other goose must spawn that are not
    // part of the wave") - the ambient wandering flock is a different mode's feature entirely.
    // No ambient flock on the Facility either (docs/facility-map.md, section 1), except Goose Toss's
    // pickups, which are the whole mode.
    if ((!facility || multiplayer?.gameMode === 'gooseToss') && !isHordeMode && (!multiplayer || multiplayer.role === 'host')) {
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
              if (position.distanceTo(player.position) <= 10) input.vibrate('explosion');
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
          // Indoors they come in through rooms away from every player (docs/facility-map.md).
          facility ? facilityHordeSite(facility.layout) : null,
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
    // Never on the Facility (docs/facility-map.md, section 1).
    const isBonusGooseEnabled = !facility && !isHordeMode && (!multiplayer || multiplayer.gameMode === 'default');
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
      const minimap = new Minimap(hudRoot, facility
        ? { worldRadius: FACILITY_MAP_RADIUS, layer: facility.mapLayer }
        : buildings ? { layer: new ValleyHouseMapLayer(buildings.houses) } : undefined);
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
          (amount) =>
            multiplayer.connection.send({ type: 'damageEvent', senderSlot: multiplayer.ownSlot, targetSlot: entry.slot, amount, weaponId: game.weaponManager.activeWeaponId }),
        );
        opponents.set(entry.slot, { slot: entry.slot, remotePlayer, username: entry.username, health: player.maxHealth, lastMessageAt: performance.now(), firstSnapshotAt: null, isDead: false });
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
        map: multiplayer.map,
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
        onResume: () => input.resume(),
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
      facility,
      torch,
      remoteTorches,
      matchWeather,
      isSpawnBlocked,
      entityManager,
      weaponManager,
      impactMarkers,
      tracers,
      muzzleFlash,
      glintMarkers,
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
      damageArcs,
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
      fillLight,
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
    game.pickups = createMatchPickups({
      scene: renderer.scene,
      mode: currentGameMode,
      facility: facility ? { layout: facility.layout, start: facility.start } : null,
      buildings,
      multiplayer: activeMultiplayer,
      player,
      weaponManager: () => game.weaponManager,
      // A grenade crate tops up the match's grenade carry (docs/pickups.md); built further down.
      grenades: grenadeSupplyFrom(() => game.grenades),
      onPickedUp: (kind, line) => {
        gooseAnnouncement.show(line);
        sound.playPickup(kind);
      },
    });
    if (facility && !activeMultiplayer) {
      game.soloMinimap = new Minimap(hudRoot, { worldRadius: FACILITY_MAP_RADIUS, layer: facility.mapLayer });
    }
    // Doors and breakers (docs/facility-map.md, section 12): a late joiner starts with the host's.
    // A door never closes on a living enemy or goose either.
    const others = () => ({
      enemies: entityManager.liveEnemyMotion(),
      geese: [...gooseManager.listForSync(), ...(hordeGooseManager?.listForSync() ?? [])],
    });
    if (facility) {
      const interaction = new FacilityInteraction({ objects: facility.objects, physics, camera: renderer.camera, player, hud, sound, multiplayer: activeMultiplayer, others });
      interaction.applyInitial(multiplayer?.worldObjects);
      setEnemyDoorGate(interaction.enemyGate);
      game.facilityInteraction = interaction;
    } else if (buildings) {
      // The Valley houses' doors (docs/enterable-buildings.md) run through the same interaction and
      // messages; enemies open them through the same gate as the Facility's.
      const interaction = new FacilityInteraction({ objects: buildings.houses.doors, physics, camera: renderer.camera, player, hud, sound, multiplayer: activeMultiplayer, others });
      interaction.applyInitial(multiplayer?.worldObjects);
      setEnemyDoorGate(interaction.enemyGate);
      game.facilityInteraction = interaction;
    }
    if (matchConfig.missionMode && !activeMultiplayer) game.startMission(hudRoot);

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
    // Grenades: the system owns the carry, flight and blasts; these are its hooks into the match.
    game.grenades = new GrenadeSystem({
      scene: renderer.scene,
      physics,
      camera: renderer.camera,
      player,
      enabled: grenadesEnabled(currentGameMode),
      // The loadout's grenade at match start; a mid-match Loadout change does not touch it.
      kind: equippedGrenade(storedLoadout),
      sound,
      targets: withBlastTargets(entityManager, hordeGooseManager),
      network: activeMultiplayer ? grenadeNetworkFor(activeMultiplayer) : null,
      // Goose Horde is co-op: a frag never hurts or pushes a teammate.
      friendlyFire: currentGameMode !== 'gooseHorde',
      floor: facility ? undefined : sampleHeight,
      canStartThrow: () => game.weaponManager.canStartThrow,
      onHandChange: (state) => (state === 'thrown' ? game.weaponManager.beginThrowLower() : game.weaponManager.setGrenadeInHand(state === 'cooking')),
      shootLampsNear: (position, radius) => {
        if (!facility) return;
        for (let i = 0; i < facility.world.lampCount; i++) {
          const lamp = facility.world.lampPosition(i);
          if (lamp && !facility.world.isLampDead(i) && position.distanceTo(new THREE.Vector3(lamp.x, lamp.y, lamp.z)) <= radius) game.destroyFacilityLamp(i, true);
        }
      },
    });
    game.grenadeEffects = new GrenadeEffects({ system: game.grenades, camera: renderer.camera, scene: renderer.scene, hud, hudRoot, sound });

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
        applyNetworkDamage: (amount, sourceSlot, weaponId) => {
          game.pendingNetworkDamage += amount;
          activeMultiplayer.lastDamageSourceSlot = sourceSlot;
          activeMultiplayer.lastDamageSourceAt = performance.now();
          activeMultiplayer.lastDamageSourceWeaponId = weaponId;
        },
        healLocalPlayerToFull: () => game.healLocalPlayerToFull(),
        applyHostMatchEnd: (winnerSlot, scoreboard) => game.applyHostMatchEnd(winnerSlot, scoreboard),
        endedMatchVerdict: () => game.endedMatchVerdict(),
        checkHordeAllEliminated: () => game.checkHordeAllEliminated(),
        matchHasEnded: () => game.multiplayerMatchState.hasEnded,
        endLostHordeRun: () => game.endMultiplayerMatch(false, 'hordeWipe'),
        receiveModeExplanationReady: (slot) => game.receiveModeExplanationReady(slot),
        removeMultiplayerOpponent: (slot) => game.removeMultiplayerOpponent(slot),
        addMultiplayerOpponent: (slot, username) => game.addMultiplayerOpponent(slot, username),
        onRematchReceived: (params) => game.onMultiplayerRematchReceived?.(params),
        onOpponentLeftRoom: () => game.onOpponentLeftRoom?.(),
        destroyLamp: (lamp) => void (game.facility ? game.destroyFacilityLamp(lamp, false) : game.destroyHouseLamp(lamp, false)),
        syncLamps: (lamps) => game.syncFacilityLamps(lamps),
        opponentInMatch: (slot) => game.noteOpponentInMatch(slot),
        // Getter: assigned right after construction, before any message can arrive.
        get pickups() {
          return game.pickups;
        },
        worldInteract: (slot, kind, id) => game.facilityInteraction?.receiveInteract(slot, kind, id),
        worldObjectState: (doors, breakers, valleyDoors) => game.facilityInteraction?.receiveState(doors, breakers, valleyDoors),
        get grenades() {
          return game.grenades;
        },
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
        onMessage: (message, senderSlot) => {
          if (message.type === 'gooseThrowExploded'
            && player.position.distanceTo(new THREE.Vector3(message.x, message.y, message.z)) <= 10) input.vibrate('explosion');
          routeMatchMessage(routerContext, message, senderSlot);
        },
        // Host-only - resolves a mid-match join/rejoin's hello into the exact reply to send back,
        // and (for anything past a normal pre-match lobby join, i.e. isMatchInProgress) performs
        // the actual "add this player to the running match" side effects (RemotePlayer/HUD row/
        // minimap dot + telling everyone else) before returning that reply - see HostRoster.ts and
        // protocol.ts's WelcomeMessage/PlayerJoinedMatchMessage docs for the full design.
        onHostHello: async (username, rejoinToken, features, peerId) => {
          const hostRoster = activeMultiplayer.hostRoster;
          if (!hostRoster) return 'full'; // guest never receives a hello to resolve in the first place
          // An older build would load the Valley inside a Facility match: turned away before it takes a slot.
          if (!helloSupportsMap(features, activeMultiplayer.map)) return 'outdated';
          const outcome = hostRoster.handleHello(username, rejoinToken, performance.now(), peerId);
          if (outcome.outcome === 'full') return 'full';

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
            // A joiner whose connection dropped while its model loaded: removeMultiplayerOpponent
            // cancelled the add and already sent playerLeft, so announcing it now would give the
            // other guests a ghost for a player who is gone.
            if (!activeMultiplayer.opponents.has(outcome.slot)) return 'full';
            // Read after the await: another player joining while this one's model loaded is in the
            // roster now, though its playerJoinedMatch went out before this player was connected.
            // Connected slots only: a slot in its rejoin grace period would be a frozen ghost here.
            const roster = hostRoster.connectedRoster();
            activeMultiplayer.session.connection.send({
              type: 'playerJoinedMatch',
              slot: outcome.slot,
              username,
              isRejoin: outcome.outcome === 'rejoined',
              peerId: hostRoster.peerIdOf(outcome.slot),
            });
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
                map: activeMultiplayer.map,
                // Only slots in the roster handed over above: the joiner learns usernames from that
                // roster alone, so a reserved or departed slot's score would sit in its scoreboard with
                // no name and silently drop off its podium (which iterates known usernames).
                scoreboard: Array.from(game.multiplayerMatchState.scoreboard, ([slot, score]) => ({ slot, score })).filter((entry) =>
                  roster.some((rosterEntry) => rosterEntry.slot === entry.slot),
                ),
                spawnPoint: { x: spawnPoint.x, z: spawnPoint.z },
                ...(game.facility ? { deadLamps: game.facility.world.deadLampIndices(), worldObjects: game.facility.objects.wire() } : {}),
                ...(game.buildings ? { deadLamps: game.buildings.houses.lights.deadLampIds(), worldObjects: game.buildings.houses.doors.wire() } : {}),
              },
            };
          }

          return {
            type: 'welcome',
            yourSlot: outcome.slot,
            isRejoin: outcome.outcome === 'rejoined',
            hostUsername: activeMultiplayer.usernames.get(HOST_SLOT) ?? 'Host',
            roster: hostRoster.connectedRoster(),
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
    if (!this.worldBriefingActive) this.input.resume();
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
    // Before the renderer and the physics world go: the facility removes its own body and frees its
    // GPU resources. The height override and the enemy navigator are module-level, and the lobby
    // samples the valley again after this match.
    this.facility?.world.dispose();
    this.facility?.objects.dispose();
    this.facilityInteraction?.dispose();
    this.buildings?.houses.dispose();
    this.facility?.lampBreak.dispose();
    this.torch?.dispose();
    this.remoteTorches?.dispose();
    setHeightOverride(null);
    setEnemyNavigator(null);
    setEnemyDoorGate(null);
    setEnemyFloor(null);
    setEnemyEntrance(null);
    document.removeEventListener('keydown', this.onDebugKeyDown);
    this.input.dispose();
    this.renderer.dispose();
    this.hud.dispose();
    this.hotbar.dispose();
    this.hitMarker.dispose();
    this.damageVignette.dispose();
    this.damageArcs.dispose();
    this.uplinkBeacons?.dispose();
    this.worldMarkers?.dispose();
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
    this.grenadeEffects?.dispose();
    this.grenades?.dispose();
    this.glintMarkers.dispose();
    this.gooseManager.dispose();
    this.goldenGooseManager?.dispose();
    this.hordeGooseManager?.dispose();
    this.bonusGooseManager?.dispose();
    this.ammoDropManager?.dispose();
    this.pickups?.dispose();
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
    this.soloMinimap?.dispose();
    this.multiplayer?.multiplayerHud.dispose();
    if (!options?.keepConnectionAlive) {
      this.multiplayer?.session.connection.dispose();
    }
    this.multiplayer = null;
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
    // "Restart" restart count, since both put the player back at a fresh spawn point). Awaited
    // before resetAllAmmo() below so that call always targets the *current* WeaponManager, not one
    // about to be disposed.
    await this.applyPendingLoadoutIfNeeded();

    // Goose Horde: dying restarts the whole challenge from wave 1 (per explicit user request) at a
    // fresh random point on the map, not the fixed single-player spawn, and skips respawning
    // enemies/targets/the ambient goose flock entirely - none of those are part of this mode.
    // The Facility puts the player back at the same start every time.
    const spawnPoint = this.facility
      ? new THREE.Vector2(this.facility.start.x, this.facility.start.z)
      : this.hordeGooseManager
        ? pickRandomHordeSpawnPoint(this.isSpawnBlocked)
        : clearFixedSpawnPoint(this.isSpawnBlocked);
    const spawnY = sampleHeight(spawnPoint.x, spawnPoint.y) + SPAWN_HEIGHT_OFFSET;
    this.player.respawn(new THREE.Vector3(spawnPoint.x, spawnY, spawnPoint.y));
    this.grenades?.resetMatch();
    this.grenadeEffects?.resetMatch();
    // Re-arm death handling at the respawn itself, not on the next tick: this runs after an await,
    // so a goose explosion landing between here and that tick would otherwise kill the player with
    // deathHandled still true from the previous death, skipping the whole death sequence.
    this.deathHandled = false;
    this.weaponManager.resetAllAmmo();
    this.entityManager.clearAll();
    this.director?.reset();
    this.directorLastHealth = this.player.currentHealth;
    this.directorLastSpawns = [];
    if (this.mission) this.restartMission();
    if (this.hordeGooseManager) {
      this.hordeGooseManager.recenter(spawnPoint.x, spawnPoint.y);
      this.hordeGooseManager.resetToWaveOne();
    } else {
      this.gooseManager.clearAll();
      if (!this.facility) this.gooseManager.spawnInitialBatch(SPAWN_X, SPAWN_Z);
      const generation = ++this.spawnGeneration;
      const counts = Game.encounterCounts(this.matchConfig);
      void Game.spawnEncountersAsync(
        this.entityManager,
        counts.targets,
        counts.enemies,
        this.facility,
        undefined,
        () => this.spawnGeneration !== generation,
      );
    }
    this.impactMarkers.clear();
    this.tracers.clear();
    // Every lamp shot out in the last run is lit again (section 11).
    this.facility?.world.relightAll();
    this.facilityInteraction?.reset();
    this.facility?.lampBreak.clear();
    this.pickups?.resetAll();
    this.scoreState.value = 0;
    this.deathScreen.hide();
    this.deathScreenVisible = false;
    this.pendingDeathScreenReveal = false;
    this.input.resume();
  }

  /** The hemisphere fill is always created (so applyGraphicsQuality can toggle its intensity live)
   * but is only non-zero on Low/Medium - on High, Renderer assigns scene.environment (a PMREM of
   * the sky) for sky/ground-bounced fill instead (VISUAL_REALISM.md §5). Image-based lighting is
   * disabled on Low/Medium (ruinous on the software-rendered e2e sandbox - see
   * GraphicsQualityPreset.environmentLighting), so the hemisphere stands in there: sky-coloured
   * from above, ground-coloured from below, so surfaces facing away from the low sun still read
   * their shape instead of going flat. Colours and strengths come from the match's look. */
  private static addLighting(
    scene: THREE.Scene,
    quality: GraphicsQualityPreset,
    look: LookPreset,
  ): { sun: THREE.DirectionalLight; fillLight: THREE.HemisphereLight } {
    // Indoors the fill is never zeroed: it is the light for moving things (see updateFacilityLight).
    const fillLight = new THREE.HemisphereLight(look.hemiSkyColor, look.hemiGroundColor, quality.environmentLighting && !look.indoor ? 0 : look.hemiIntensity);
    scene.add(fillLight);

    const sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
    sun.position.copy(look.sunDirection).multiplyScalar(SUN_SHADOW_LIGHT_DISTANCE);
    // Renderer's shadowMap.enabled already gates the whole shadow pass on Low - this additionally
    // keeps the light itself from ever being asked to cast, rather than relying solely on the
    // renderer-level switch.
    // Indoors the sun is off (intensity 0 from the look) and casts nothing.
    sun.castShadow = quality.shadowsEnabled && !look.indoor;
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
    return { sun, fillLight };
  }

  /** Everything a Graphics Quality change affects outside Renderer (see Renderer.applyQuality) -
   * called live from the pause menu's Settings panel, so changing the setting takes effect on the
   * very next frame rather than requiring a fresh match. Shadow map resolution is the one part
   * that can't just be reassigned: an already-rendered shadow map is a GPU render target sized at
   * creation, so a size change disposes it and clears the reference, which makes three.js allocate
   * a fresh one at the new size the next time the shadow pass runs. */
  private applyGraphicsQuality(quality: GraphicsQualityPreset): void {
    this.renderer.applyQuality(quality);
    // On the Facility the fill follows the probe every frame (updateFacilityLight) and the sun is off.
    if (!this.facility) this.fillLight.intensity = quality.environmentLighting ? 0 : this.renderer.currentLook.hemiIntensity;
    this.sun.castShadow = quality.shadowsEnabled && !this.facility;
    this.torch?.setCastShadow(quality.shadowsEnabled);
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

  /** What a match spawns at the start: its chosen counts, or in a Director match (enemy AI v2 step 6)
   * just ENEMY_DIRECTOR_INITIAL_COUNT enemies and no targets, the director sending the rest. */
  private static encounterCounts(config: MatchConfig): { targets: number; enemies: number } {
    return config.directorMode || config.missionMode ? { targets: 0, enemies: ENEMY_DIRECTOR_INITIAL_COUNT } : { targets: config.targetCount, enemies: config.enemyCount };
  }

  /** Enemy AI v2 step 6: feeds the pacing director this tick's damage taken, close kills and enemy
   * counts, and brings in any wave it calls for. Runs after the entity update, so a spawn never
   * changes the entity list mid-loop. */
  private updateDirector(dt: number): void {
    const director = this.director;
    if (!director) return;
    const health = this.player.currentHealth;
    const damageTaken = Math.max(0, this.directorLastHealth - health);
    this.directorLastHealth = health;
    const position = this.player.position;
    const nearbyKills = this.entityManager.killsThisTick.filter(
      (kill) => Math.hypot(kill.x - position.x, kill.z - position.z) <= ENEMY_DIRECTOR_KILL_RADIUS,
    ).length;
    const counts = this.entityManager.enemyCounts();
    const command = director.update({ dt, damageTaken, nearbyKills, engagedEnemies: counts.engaged, aliveEnemies: counts.alive });
    if (command.kind === 'spawnWave') director.confirmSpawned(this.spawnDirectorWave(command.count, command.bias));
  }

  /** The Uplink mission (docs/visual-overhaul.md, phase 4): world markers live for the whole match,
   * the mission itself restarts with each Respawn. */
  private startMission(root: HTMLElement): void {
    this.worldMarkers = new WorldMarkers(root);
    this.restartMission();
  }

  private restartMission(): void {
    this.uplinkBeacons?.dispose();
    for (const uplink of this.mission?.view(this.player.position).uplinks ?? []) {
      this.hud.compass.removeMarker(`uplink-${uplink.label}`);
      this.worldMarkers?.remove(`uplink-${uplink.label}`);
    }
    this.hud.compass.removeMarker('extract');
    this.worldMarkers?.remove('extract');

    const position = this.player.position;
    // On the Facility four rooms' consoles stand in for the watch towers (docs/facility-map.md).
    const facility = this.facility;
    const points = facility ? facilityMissionObjectives(facility.layout, facility.start) : getWatchTowerPositions();
    const mission = new MissionState(points, { x: position.x, z: position.z });
    this.mission = mission;
    const view = mission.view(position);
    this.uplinkBeacons = new UplinkBeacons(this.renderer.scene, view, facility
      ? { physics: this.physics, ceilingAt: (x, z) => facilityCeilingAt(facility.layout, x, z) }
      : null);
    for (const uplink of view.uplinks) {
      this.hud.compass.addMarker(`uplink-${uplink.label}`, () => bearingDeg(uplink.x - this.player.position.x, uplink.z - this.player.position.z));
    }
    this.missionKills = 0;
    this.missionDamageTaken = 0;
    this.missionLastHealth = this.player.currentHealth;
    this.missionClock = 0;
    this.missionWon = false;
    this.hud.setPrompt('interact', null);
  }

  /** Feeds the mission this tick's position and interact press, and acts on what it asks for: waves
   * through the director's own reinforcement spawner, announcements, and the win screen. Runs right
   * after updateDirector, while killsThisTick still describes this tick. */
  private updateMission(dt: number): void {
    const mission = this.mission;
    if (!mission) return;
    this.missionClock += dt;
    const health = this.player.currentHealth;
    this.missionDamageTaken += Math.max(0, this.missionLastHealth - health);
    this.missionLastHealth = health;
    this.missionKills += this.entityManager.killsThisTick.length;
    const position = this.player.position;
    const events = mission.update({
      dt,
      player: { x: position.x, z: position.z },
      interactPressed: this.input.consumeJustPressed('interact'),
      playerDead: false,
    });
    for (const event of events) {
      if (event.kind === 'waveRequested') {
        this.spawnDirectorWave(event.count, event.bias);
      } else if (event.kind === 'uplinkOnline') {
        this.bigAnnouncement.show(`UPLINK ${event.online} / ${event.total} ONLINE`);
        this.hud.compass.removeMarker(`uplink-${event.label}`);
        this.worldMarkers?.remove(`uplink-${event.label}`);
      } else if (event.kind === 'extractionOpen') {
        this.bigAnnouncement.show('EXTRACTION OPEN');
        const { x, z } = mission.extraction;
        this.hud.compass.addMarker('extract', () => bearingDeg(x - this.player.position.x, z - this.player.position.z));
      } else if (event.kind === 'won') {
        this.missionWon = true;
        this.hud.setPrompt('interact', null);
        this.deathScreen.showMission(this.missionResult(true));
        this.deathScreenVisible = true;
        this.input.releasePointerLock();
      }
    }
  }

  private missionResult(won: boolean): MissionResult {
    // The killing blow lands on a tick updateMission no longer runs on, so settle it here.
    this.missionDamageTaken += Math.max(0, this.missionLastHealth - this.player.currentHealth);
    this.missionLastHealth = this.player.currentHealth;
    const view = this.mission?.view(this.player.position);
    return {
      won,
      seconds: this.missionClock,
      kills: this.missionKills,
      damageTaken: this.missionDamageTaken,
      online: view?.online ?? 0,
      total: view?.uplinks.length ?? 0,
    };
  }

  /** The death screen, or in the Uplink mission its "Signal lost" variant (death ends the mission;
   * Respawn restarts it). */
  private showDeathScreen(): void {
    if (this.mission) {
      this.mission.update({ dt: 0, player: { x: this.player.position.x, z: this.player.position.z }, interactPressed: false, playerDead: true });
      this.deathScreen.showMission(this.missionResult(false));
    } else {
      this.deathScreen.show(this.scoreState.value);
    }
  }

  /** The objective panel, the interaction prompt, the beams and the world markers for this tick. */
  private updateMissionHud(view: MissionView): void {
    const hud = this.hud;
    if (view.phase === 'extract' || view.phase === 'won') {
      hud.setObjective('UPLINK', 'Reach extraction');
      if (view.extractionProgress > 0) hud.setScoreLine(`EXTRACTING  ${Math.round(view.extractionProgress * 100)}%`);
      else hud.setObjectiveProgress(view.online, view.uplinks.length);
    } else if (view.active) {
      hud.setObjective('UPLINK', view.active.paused ? 'Upload paused, return to the tower' : 'Hold the tower');
      hud.setScoreLine(`UPLINK ${view.active.label}  ${Math.floor(view.active.progress * 100)}%`);
    } else {
      hud.setObjective('UPLINK', 'Bring the uplinks online');
      hud.setObjectiveProgress(view.online, view.uplinks.length);
    }
    hud.setPrompt('interact', this.missionWon ? null : view.prompt);
    this.uplinkBeacons?.update(view, this.missionClock, this.reducedMotion.matches);
    // Only the Facility has a single-player map.
    this.soloMinimap?.setMarkers(missionMapMarkers(view));

    const markers = this.worldMarkers;
    if (!markers) return;
    for (const uplink of view.uplinks) {
      if (uplink.status === 'online') continue;
      this.missionMarkerPosition.set(uplink.x, sampleHeight(uplink.x, uplink.z) + (this.facility ? FACILITY_CONSOLE_HEIGHT + 1 : WATCH_TOWER_ROOF_TOP + 3), uplink.z);
      markers.set(`uplink-${uplink.label}`, this.missionMarkerPosition, `UPLINK ${uplink.label}`);
    }
    if (view.phase === 'extract') {
      const { x, z } = view.extraction;
      this.missionMarkerPosition.set(x, sampleHeight(x, z) + 2, z);
      markers.set('extract', this.missionMarkerPosition, 'EXTRACT');
    }
  }

  /** Places up to `count` reinforcements behind the player and off their screen, hidden ones first
   * (see reinforcementSpawner.ts), returning how many it placed. Each is recorded for
   * getDirectorDebug with a fresh on-screen check against its real head, which guards this wiring;
   * the spawner's own rules are unit-tested. */
  private spawnDirectorWave(count: number, bias: WaveBias): number {
    const player = this.player;
    const forwardX = -Math.sin(player.facingYaw);
    const forwardZ = -Math.cos(player.facingYaw);
    const viewHalfAngleDeg = this.viewHalfAngleDeg();
    const { points } = pickReinforcementSpawns(
      {
        player: { x: player.position.x, z: player.position.z, forwardX, forwardZ },
        viewHalfAngleDeg,
        isBlocked: (x, z) => this.isSpawnBlocked(x, z) || Math.hypot(x, z) > DIRECTOR_SPAWN_MAX_WORLD_RADIUS,
        heightAt: sampleHeight,
        canPlayerSee: (x, y, z) => this.entityManager.playerCanSee(player, x, y, z),
        rng: this.directorRng,
      },
      count,
      bias === 'sniper',
      DIRECTOR_SPAWN_OPTIONS,
    );
    this.directorLastSpawns = points.map((point, index) => {
      const enemy = this.entityManager.spawnEnemy(new THREE.Vector3(point.x, point.y + 1, point.z), Game.waveArchetype(bias, index));
      // A reinforcement is sent, not scattered: it comes looking for the player, already suspicious,
      // rather than patrolling behind them unnoticed through a quiet build-up (final review).
      enemy.dispatchToward(player.position);
      const head = enemy.mesh.position;
      const dx = head.x - player.position.x;
      const dz = head.z - player.position.z;
      const inView = (dx * forwardX + dz * forwardZ) / Math.hypot(dx, dz) > Math.cos((viewHalfAngleDeg * Math.PI) / 180);
      const lineClear = this.entityManager.playerCanSee(player, head.x, head.y + ENEMY_HEAD_OFFSET_Y, head.z, enemy.excludeRigidBody);
      return {
        x: point.x,
        z: point.z,
        playerX: player.position.x,
        playerZ: player.position.z,
        forwardX,
        forwardZ,
        hidden: point.hidden,
        onScreen: inView && lineClear,
      };
    });
    return points.length;
  }

  /** Half the camera's horizontal field of view plus ENEMY_DIRECTOR_SPAWN_VIEW_MARGIN_DEG, in
   * degrees: the director treats anything inside it as on screen. */
  private viewHalfAngleDeg(): number {
    const camera = this.renderer.camera;
    const halfVertical = (camera.fov * Math.PI) / 360;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
    return (halfHorizontal * 180) / Math.PI + ENEMY_DIRECTOR_SPAWN_VIEW_MARGIN_DEG;
  }

  /** A Rush Job wave is all Rush Jobs and a sniper wave leads with a Ridge Walker (on the highest
   * hidden ground drawn); anything else is the usual seeded mix. */
  private static waveArchetype(bias: WaveBias, index: number): EnemyArchetype | undefined {
    if (bias === 'rusher') return archetypeNamed('Rush Job');
    if (bias === 'sniper' && index === 0) return archetypeNamed('Ridge Walker');
    return undefined;
  }

  /** `count` clear Facility cell centres for targets and enemies, none within
   * FACILITY_ENCOUNTER_AVOID_RADIUS of the player's start: the layout's encounterPoints first (spread
   * over the rooms, at most three per room), then, for a match larger than that, other clear cells
   * at random; a point repeats only once every clear cell is taken. Single-player only, so plain
   * Math.random like the other single-player spawn picks. */
  private static facilityEncounterPoints(facility: FacilityMatch, count: number): { x: number; z: number }[] {
    const { layout, start } = facility;
    const points = encounterPoints(layout, count, { x: start.x, z: start.z, radius: FACILITY_ENCOUNTER_AVOID_RADIUS }, Math.random);
    if (points.length >= count) return points;
    const used = new Set(points.map((p) => `${p.x},${p.z}`));
    const extra: { x: number; z: number }[] = [];
    for (let j = 0; j < layout.size; j++) {
      for (let i = 0; i < layout.size; i++) {
        const point = cellCentre(i, j);
        if (used.has(`${point.x},${point.z}`) || isFacilitySpawnBlocked(layout, point.x, point.z)) continue;
        if (Math.hypot(point.x - start.x, point.z - start.z) < FACILITY_ENCOUNTER_AVOID_RADIUS) continue;
        extra.push(point);
      }
    }
    for (let i = extra.length - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      [extra[i], extra[k]] = [extra[k]!, extra[i]!];
    }
    points.push(...extra.slice(0, count - points.length));
    const available = points.length;
    if (available === 0) return Array.from({ length: count }, () => ({ x: start.x, z: start.z }));
    for (let i = available; i < count; i++) points.push(points[i % available]!);
    return points;
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
    facility: FacilityMatch | null,
    onProgress?: (status: string, ratio: number) => void,
    isCancelled?: () => boolean,
  ): Promise<void> {
    const total = targetCount + enemyCount;
    let done = 0;
    const report = (status: string): void => onProgress?.(status, total > 0 ? done / total : 1);
    // The Facility spreads everything over its rooms instead of the rings around the valley spawn:
    // targets first (facing the player's start), then enemies.
    const facilityPoints = facility ? Game.facilityEncounterPoints(facility, total) : null;
    const facePoint = facility ? facility.start : { x: SPAWN_X, z: SPAWN_Z };

    const targetRadius = Game.ringRadius(targetCount, TARGET_RING_BASE_RADIUS);
    for (let i = 0; i < targetCount; i++) {
      const point = facilityPoints?.[i];
      const angle = (i / targetCount) * Math.PI * 2;
      const x = point ? point.x : SPAWN_X + Math.cos(angle) * targetRadius;
      const z = point ? point.z : SPAWN_Z + Math.sin(angle) * targetRadius;
      const y = sampleHeight(x, z) + 1;
      entityManager.spawnTarget(new THREE.Vector3(x, y, z), new THREE.Vector3(facePoint.x, y, facePoint.z));
      done++;
      report(`Placing targets… (${done}/${total})`);
      if (done % SPAWN_BATCH_SIZE === 0) {
        await waitForNextFrame();
        if (isCancelled?.()) return;
      }
    }

    const enemyRadius = Game.ringRadius(enemyCount, ENEMY_RING_BASE_RADIUS);
    for (let i = 0; i < enemyCount; i++) {
      const point = facilityPoints?.[targetCount + i];
      const angle = (i / enemyCount) * Math.PI * 2 + 0.5;
      const x = point ? point.x : SPAWN_X + Math.cos(angle) * enemyRadius;
      const z = point ? point.z : SPAWN_Z + Math.sin(angle) * enemyRadius;
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

  private readonly crosshairOverEnemy = (): boolean => {
    const camera = this.renderer.camera;
    const hit = castHitscan(this.physics, camera.position, camera.getWorldDirection(new THREE.Vector3()), 60, this.player.ownCollider);
    if (!hit) return false;
    const entity = this.physics.getEntity(hit.colliderHandle);
    return (entity instanceof Enemy || entity instanceof RemotePlayer) && !entity.isDead;
  };

  private readonly update = (dt: number): void => {
    this.tickCount++;
    // The grenades' shake, white-out and blast light run out on every tick, also while the
    // simulation below is frozen (dead, paused, mission won, match ended): render keeps drawing them.
    this.grenades?.tickEffects(dt);
    this.input.update(dt, this.worldBriefingActive || this.deathScreenVisible || this.multiplayerMatchState.hasEnded, this.crosshairOverEnemy);
    if (this.deathScreenVisible && !this.multiplayerMatchState.hasEnded && this.input.consumeJustPressed('resetPlay')) void this.resetPlay();
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

    // Mouse play needs pointer lock; controller play uses explicit pause state.
    // Death has its own overlay instead -
    // gated on `deathScreenVisible`, not `player.isDead` directly, so a death detected while
    // already paused (multiplayer only) doesn't auto-hide the pause menu before the player has
    // actually chosen to resume (see pendingDeathScreenReveal's own comment).
    const isPaused = !this.input.isEngaged && !this.deathScreenVisible;
    this.pauseMenu.setVisible(isPaused);
    this.pauseMenu.update();

    // The deferred reveal from below - fires the first tick the pause menu is no longer open.
    if (this.pendingDeathScreenReveal && !isPaused) {
      this.pendingDeathScreenReveal = false;
      this.showDeathScreen();
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

    // Consume the toggle even in Valley day, where no torch is available.
    if (this.input.consumeJustPressed('flashlight') && !isPaused && this.torch) {
      const torch = this.torch;
      torch.setOn(!torch.isOn);
      this.sound.playTorchClick(torch.isOn);
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

    this.secondsSinceShot += dt;
    const freezeLocalPlayer = this.player.isDead || isPaused || this.missionWon;
    // Facility doors and breakers (section 12): before the mode controllers, which only see an
    // interact press this did not take (it takes one only while a door or panel is looked at).
    this.facilityInteraction?.update(dt, freezeLocalPlayer ? null : this.input);
    this.buildings?.houses.update(dt, this.renderer.camera);
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

    const probe = this.facility?.world.probeAt(this.player.position.x, this.player.position.z);
    const at = this.player.position;
    this.playerVisibility.value = visibility({
      map: this.facility ? 'facility' : 'valley',
      weather: this.matchWeather,
      probeLuma: probe ? probe[0] * 0.2126 + probe[1] * 0.7152 + probe[2] * 0.0722 : undefined,
      secondsSinceShot: this.secondsSinceShot,
      torchOn: this.torch?.isOn ?? false,
      enemyInTorchBeam: false,
      houseRoomLit: this.buildings?.houses.roomLampLitAt(at.x, at.y - PLAYER_HEIGHT / 2, at.z) ?? null,
      flashLit: this.grenades ? flashLightsPlayer(this.grenades.recentDetonations, this.grenades.now, at) : false,
    });
    this.playerVisibility.torchOn = this.torch?.isOn ?? false;
    this.playerVisibility.eye.copy(this.renderer.camera.position);
    this.renderer.camera.getWorldDirection(this.playerVisibility.aim);
    this.hud.setVisibility(this.torch ? this.playerVisibility.value : null);

    // The shared world - physics (including every RemotePlayer/goose collider), and the
    // host-authoritative goose simulation - must keep advancing regardless of THIS client's own
    // pause/death state in multiplayer (per user request: pausing/dying must never freeze anything
    // for anyone else, whether it's the host or a guest paused - a paused host that stops
    // broadcasting goose snapshots/adjudicating hits would otherwise silently stall every other
    // player's geese too, only "catching up" - explosions and all - the instant the host unpauses).
    // Single-player keeps the old full-freeze pause behavior (nothing else is "live" to notice in
    // solo play, and freezing on death already matches the existing death-screen/reset flow).
    if (this.multiplayer || !freezeLocalPlayer) {
      this.perfLogger.recordTick();
      let sectionStart = this.perfLogger.mark();
      this.physics.step(dt);
      sectionStart = this.perfLogger.endSection('physics', sectionStart);
      this.chunkManager?.update(this.player.position.x, this.player.position.z);
      sectionStart = this.perfLogger.endSection('world', sectionStart);
      this.entityManager.update(dt, this.player, this.playerVisibility);
      this.updateDirector(dt);
      this.updateMission(dt);
      this.perfLogger.endSection('ai', sectionStart);
      this.gooseManager.update(dt, this.player, this.multiplayer?.gooseDifficulty ?? this.matchConfig.gooseDifficulty, this.multiplayer?.session.role === 'host');
      this.updateThrownGeese(dt);
      this.grenades?.update(dt, freezeLocalPlayer ? null : this.input);

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

      // Health, ammo and grenade pickups: timers, the walk-over check and the host's claims.
      this.pickups?.update(dt, this.player.position, !freezeLocalPlayer);

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
    this.glintMarkers.update(dt);
    this.hitMarker.update(dt);
    this.damageVignette.update(dt);
    this.weaponCaption.update(dt);
    this.longShotCallout.update(dt);
    this.killFeed.update(dt);
    this.gooseAnnouncement.update(dt);
    this.bigAnnouncement.update(dt);
    this.explosionEffect.update(dt);
    this.facility?.lampBreak.update(dt);
    this.updateMultiplayer(dt);
    this.soloMinimap?.update(this.player.position, NO_OPPONENTS, this.player.facingYaw, undefined, this.entityManager.liveEnemyMotion());
    if (this.soloMinimap) this.updateMinimapPickups(this.soloMinimap);

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
        this.showDeathScreen();
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
        const killerWeaponId = killerSlot === null ? undefined : this.multiplayer.lastDamageSourceWeaponId;
        const ownSlot = this.multiplayer.session.ownSlot;
        this.multiplayer.session.connection.send({ type: 'playerDied', senderSlot: ownSlot, victimSlot: ownSlot, killerSlot, killerWeaponId, t: this.sendClock() });
        // Goose Horde is co-op - per explicit user request, nobody should score points off a
        // teammate's death (accidental friendly fire or otherwise), and there's no kill-limit win
        // condition for this mode anyway (see updateMultiplayer's own gooseHorde skip). Every other
        // mode keeps the normal self-reported scoreboard update, applied locally rather than
        // waiting to receive its own broadcast back (a host never receives its own sent messages,
        // and a guest's message never loops back to it either).
        // applyDeath itself already skips Goose Horde internally (see its own comment) - this mode
        // has no kill-limit win condition anyway (see updateMultiplayer's own gooseHorde skip).
        this.multiplayerMatchState.applyDeath(this.multiplayer.gameMode, this.multiplayer.killLimit, { victimSlot: ownSlot, killerSlot, killerWeaponId });
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
    if (this.mission) {
      this.updateMissionHud(this.mission.view(this.player.position));
    } else {
      this.hud.setScore(this.scoreState.value);
      if (this.director) {
        const phase = { buildUp: 'BUILDING', peak: 'PEAK', fade: 'FADING', relax: 'QUIET' }[this.director.phase];
        this.hud.setScoreLine(`SCORE ${this.scoreState.value}  ${phase}`);
      }
    }
    this.hud.setHealth(this.player.currentHealth, this.player.maxHealth);
    // Phase 6 sound: the director drives the music, low health the heartbeat. Both fade out while
    // paused, dead or behind the mission's end screen.
    this.sound.updateAmbience({
      healthRatio: this.player.currentHealth / this.player.maxHealth,
      director: this.director ? { phase: this.director.phase, intensity: this.director.intensity } : null,
      active: this.input.isEngaged && !this.player.isDead && !this.missionWon && !this.deathScreenVisible,
    });
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
    // The hill on the Facility's map (docs/facility-map.md, "Modes on the Facility").
    if (this.facility && this.kingOfTheHillController) this.multiplayer.minimap.setMarkers(this.kingOfTheHillController.minimapMarkers());
    this.multiplayer.minimap.update(this.player.position, opponentPositions, this.player.facingYaw, this.ammoDropManager?.positions());
    this.updateMinimapPickups(this.multiplayer.minimap);
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

    // Ping comes from the browser's own connection stats; lead lets RemotePlayer draw opponents where they are now.
    this.connectionPollAccumulator += dt;
    if (this.connectionPollAccumulator >= MULTIPLAYER_CONNECTION_POLL_INTERVAL) {
      this.connectionPollAccumulator = 0;
      if (!this.connectionPollInFlight) {
        this.connectionPollInFlight = true;
        void this.multiplayer.session.connection.connectionQuality().then((measured) => {
          if (!this.multiplayer) return;
          const summary = summarizeConnection(measured, this.multiplayer.opponents.keys());
          this.multiplayer.multiplayerHud.setConnection(summary.perOpponent);
          for (const [slot, opponent] of this.multiplayer.opponents) {
            opponent.remotePlayer.setLeadSeconds(summary.leadSeconds.get(slot) ?? 0);
          }
        }).catch(() => {}).finally(() => {
          this.connectionPollInFlight = false;
        });
      }
    }

    // A periodic resync of this client's dead lamps (Facility or Valley houses), for anyone who was
    // loading when a lampDestroyed went past (see network/lampSync.ts).
    if (this.facility || this.buildings) {
      const lamps = this.lampSync.update(dt, this.deadLampIds);
      if (lamps) this.sendLampSync(lamps);
    }

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
          if (!isOpponentSilent(now, opponent.lastMessageAt, opponent.firstSnapshotAt, opponent.isDead)) continue;
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
        t: this.sendClock(),
        ...(this.torch ? { torch: this.torch.isOn } : {}),
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
    this.grenades?.resetForSpawn();
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
    const pauseMenuCurrentlyOpen = !this.input.isEngaged && !this.deathScreenVisible;
    this.deathScreen.hide();
    this.deathScreenVisible = false;
    this.pendingDeathScreenReveal = false;
    if (!pauseMenuCurrentlyOpen) this.input.resume();
    this.multiplayer.session.connection.send({ type: 'respawnEvent', senderSlot: ownSlot, x, y: spawnY, z, t: this.sendClock() });
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
    this.multiplayer.session.connection.send({ type: 'respawnEvent', senderSlot: ownSlot, x, y: spawnY, z, t: this.sendClock() });
  }

  /** The pickups within reach of the minimap (docs/pickups.md) as small icons. */
  private updateMinimapPickups(minimap: Minimap): void {
    const position = this.player.position;
    minimap.updatePickups(position, this.player.facingYaw, this.pickups?.minimapEntries(position.x, position.z) ?? []);
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
      const fromX = thrown.position.x, fromZ = thrown.position.z;
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
      } else if (this.facility && facilityBlocksThrow(this.facility.layout, thrown.position.x, thrown.position.y, thrown.position.z, GOOSE_RADIUS)) {
        // Indoors a throw bursts on the first wall, crate or ceiling it meets.
        hitPosition = thrown.position.clone();
      } else if (this.facility && crossesClosedDoor(this.facility.objects.closedDoors(), fromX, fromZ, thrown.position.x, thrown.position.z)) {
        // ...and on a closed door, on the side it came from.
        hitPosition = new THREE.Vector3(fromX, thrown.position.y, fromZ);
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
    if (position.distanceTo(this.player.position) <= 10) this.input.vibrate('explosion');
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
        this.multiplayer.session.connection.send({ type: 'damageEvent', senderSlot: throwerSlot, targetSlot: opponent.slot, amount, weaponId: source });
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
    this.input.resume();
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
    if (!this.multiplayer) return;
    const existing = this.multiplayer.opponents.get(slot);
    if (existing) {
      // A rejoin that took over this slot before the old connection closed: the new page's clock
      // starts again near zero, so the old floor would drop its snapshots (see stateOrder.ts).
      existing.lastStateSentAt = undefined;
      return;
    }
    const generation = this.bumpOpponentGeneration(slot);
    const remotePlayer = await RemotePlayer.create(
      this.physics,
      this.renderer.scene,
      this.player.position,
      (amount) =>
        this.multiplayer!.session.connection.send({
          type: 'damageEvent',
          senderSlot: this.multiplayer!.session.ownSlot,
          targetSlot: slot,
          amount,
          weaponId: this.weaponManager.activeWeaponId,
        }),
    );
    if (!this.multiplayer || this.multiplayer.opponents.has(slot) || this.opponentGenerations.get(slot) !== generation) {
      // Torn down, raced, or the slot left (or was added again) while the GLTF load above was in
      // flight - don't leak the collider/mesh, and never show a player who already left.
      remotePlayer.dispose(this.renderer.scene);
      return;
    }
    this.multiplayer.opponents.set(slot, { slot, remotePlayer, username, health: this.player.maxHealth, lastMessageAt: performance.now(), firstSnapshotAt: null, isDead: false });
    this.multiplayer.usernames.set(slot, username);
    this.multiplayer.minimap.addDot(slot);
    this.multiplayer.multiplayerHud.addOpponentRow(slot, username);
  }

  private bumpOpponentGeneration(slot: PlayerSlot): number {
    const generation = (this.opponentGenerations.get(slot) ?? 0) + 1;
    this.opponentGenerations.set(slot, generation);
    return generation;
  }

  /** Removes a slot that disconnected mid-match (see protocol.ts's PlayerLeftMessage) - the match
   * continues for everyone else (per user decision), this just tears down that one slot's visuals.
   * Deliberately leaves multiplayerMatchState's scoreboard/deathCounts untouched - a disconnected
   * player's final score still needs to show correctly on the podium. */
  private removeMultiplayerOpponent(slot: PlayerSlot): void {
    if (!this.multiplayer) return;
    // Before the lookup: a removal while this slot's model is still loading must cancel that add.
    this.bumpOpponentGeneration(slot);
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
    // A rejoin on this slot gets this client's dead lamps again on its first snapshot.
    this.lampSync.forget(slot);
    this.facilityInteraction?.forget(slot);
    this.grenades?.forgetOpponent(slot);
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
    this.pauseMenu.setVisible(false);
    this.settingsPanel.hide();
    this.loadoutScreen?.hide();
    this.deathScreen.hide();
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
      map: this.multiplayer.map,
      role: this.multiplayer.session.role,
      connection: this.multiplayer.session.connection,
    });
  }

  private readonly render = (alpha: number): void => {
    const now = performance.now();
    const frameMs = now - this.lastRenderTime;
    this.fpsMeter.recordFrame(frameMs);
    this.perfLogger.recordFrame(frameMs);
    this.lastRenderTime = now;
    this.perfOverlay.update(this.fpsMeter.getStats(), this.entityManager.count);

    // Loop's fixed-timestep accumulator already computed this fractional tick progress, but it
    // went unused. Scoped to just the camera (and anything parented to it, i.e. the weapon view
    // models) as the highest-value, lowest-risk slice - it's what the player is actually looking
    // through, and unlike interpolating every enemy/target mesh, it needs no new per-entity
    // prev/current bookkeeping or e2e position-reporting changes.
    this.player.interpolateCamera(alpha);
    this.grenades?.applyCameraShake(this.renderer.camera, now / 1000);
    this.renderer.camera.getWorldDirection(this.hudForward);
    const heading = bearingDeg(this.hudForward.x, this.hudForward.z);
    const hudDt = Math.max(0, frameMs / 1000);
    this.hud.compass.setSunDirection(this.renderer.currentLook.sunDirection);
    this.hud.update(hudDt, -heading * Math.PI / 180);
    this.damageArcs.update(hudDt, heading);
    this.worldMarkers?.update(this.renderer.camera);
    this.grenadeEffects?.update(hudDt, this.weaponManager);
    if (this.facility) {
      this.updateFacilityLight(hudDt);
    } else {
      this.updateSunFollow();
    }
    this.updateTorches();
    const renderStart = this.perfLogger.mark();
    this.renderer.render();
    this.grenadeEffects?.afterRender(this.renderer.webgl.domElement);
    this.perfLogger.endSection('render', renderStart);
    this.perfLogger.maybeEmit(this.perfContext);
  };

  /** Only evaluated once a second, when the perf logger actually emits a row. Read right after
   * renderer.render(), so three's per-frame info counters describe the frame just drawn. */
  private readonly perfContext = (): PerfContext => {
    const info = this.renderer.webgl.info.render;
    return { states: this.entityManager.getLiveEntityStates(), drawCalls: info.calls, triangles: info.triangles };
  };

  /** F3 toggles the perf overlay and F4 toggles printing the once-a-second perf log to the console -
   * dev tools, not rebindable gameplay actions, so they deliberately bypass the Action/InputManager
   * system entirely (same reasoning as openPauseMenu's raw pointer-lock call in the e2e helpers -
   * some things aren't player controls). */
  private readonly onDebugKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'F3') this.perfOverlay.toggle();
    else if (event.code === 'F4') this.perfLogger.toggleConsole();
  };
}
