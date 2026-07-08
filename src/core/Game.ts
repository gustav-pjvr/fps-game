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
import { buildGooseMesh } from '../entities/Goose.ts';
import { BuildingManager } from '../world/BuildingManager.ts';
import { RoadManager } from '../world/RoadManager.ts';
import { WatchTowerManager } from '../world/WatchTowerManager.ts';
import { ChunkManager } from '../world/ChunkManager.ts';
import { VegetationManager } from '../world/VegetationManager.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { WeaponManager } from '../weapons/WeaponManager.ts';
import { WEAPON_HIP_POSITION } from '../weapons/viewModel.ts';
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
import { Minimap } from '../ui/minimap.ts';
import { MultiplayerHud } from '../ui/multiplayerHud.ts';
import { PauseMenu } from '../ui/menu/PauseMenu.ts';
import { SettingsPanel } from '../ui/menu/SettingsPanel.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { isDamageable } from '../combat/damage.ts';
import { computeExplosionDamage } from '../combat/explosion.ts';
import { SoundEngine } from '../audio/SoundEngine.ts';
import { FpsMeter } from './FpsMeter.ts';
import { PerfOverlay } from '../ui/perfOverlay.ts';
import {
  ENEMY_GUNSHOT_AUDIBLE_RANGE,
  ENEMY_GUNSHOT_FULL_VOLUME_RANGE,
  ENEMY_GUNSHOT_MIN_VOLUME,
  ENEMY_RANGED_TRACER_COLOR,
  ENEMY_RING_BASE_RADIUS,
  type GooseExplosionDifficulty,
  GOOSE_MAX_CONCURRENT,
  GOOSE_PICKUP_RADIUS,
  GOOSE_RADIUS,
  GOOSE_THROW_MAX_LIFETIME_SECONDS,
  GOOSE_THROW_SPEED,
  GOOSE_TOSS_EXPLOSION_MAX_DAMAGE,
  GOOSE_TOSS_EXPLOSION_RADIUS,
  GOOSE_TOSS_MAX_CONCURRENT,
  GOOSE_TOSS_SPAWN_INTERVAL_SECONDS,
  MULTIPLAYER_CONNECTION_TIMEOUT_MS,
  MULTIPLAYER_GUNSHOT_AUDIBLE_RANGE,
  MULTIPLAYER_GUNSHOT_FULL_VOLUME_RANGE,
  MULTIPLAYER_GUNSHOT_MIN_VOLUME,
  MULTIPLAYER_RESPAWN_DELAY,
  PLAYER_RADIUS,
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
import { applyPlayerDied } from './multiplayerScoring.ts';
import { DEFAULT_GAME_MODE, pickGunGameUpgrade, resolveWeaponLoadout, type GameMode } from './gameModes.ts';
import { Settings } from '../settings/Settings.ts';
import { GRAPHICS_QUALITY_PRESETS, type GraphicsQualityPreset } from '../settings/graphicsQuality.ts';
import type { MultiplayerMatchStartParams, MultiplayerSession } from '../network/MultiplayerSession.ts';
import { HOST_SLOT, type PlayerSlot } from '../network/protocol.ts';
import type { HostRoster } from '../network/HostRoster.ts';

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
  gooseDifficulty: GooseExplosionDifficulty;
}

/** One other player currently in the match - keyed by slot in ActiveMultiplayer.opponents below,
 * replacing the old single `remotePlayer`/`opponentHealth` fields now that there can be up to 3. */
interface RemoteOpponent {
  readonly slot: PlayerSlot;
  readonly remotePlayer: RemotePlayer;
  username: string;
  /** Piggybacked on their own playerSnapshot messages - this client has no other way to know it,
   * since it's never authoritative over another player's health. Starts at full health, matching
   * what a freshly spawned/joined opponent actually has before their first snapshot arrives. */
  health: number;
  /** Host-only liveness tracking (see MULTIPLAYER_CONNECTION_TIMEOUT_MS's own comment) - updated on
   * every message received from this slot, not just playerSnapshot. Unused on a guest's own client
   * (guests never run the staleness sweep - see updateMultiplayer). */
  lastMessageAt: number;
}

/** Everything Game tracks about an in-progress multiplayer match beyond the MultiplayerSession it
 * was handed (see network/MultiplayerSession.ts) - the parts that only exist once the match is
 * actually running, not at hand-off time. `snapshotAccumulator` is mutated every tick (see
 * update()); the object itself is still only ever assigned once, at construction. */
interface ActiveMultiplayer {
  readonly session: MultiplayerSession;
  /** Every OTHER player currently connected to the match, keyed by slot. Entries are removed on a
   * mid-match disconnect (playerLeft) and re-added on a rejoin/late-join (playerJoinedMatch) - see
   * the onMessage handling in create(). */
  readonly opponents: Map<PlayerSlot, RemoteOpponent>;
  /** Every slot ever seen in this match, own included, NEVER removed (unlike `opponents` above) -
   * a disconnected player's name/score still needs to show correctly on the final podium. */
  readonly usernames: Map<PlayerSlot, string>;
  readonly minimap: Minimap;
  readonly multiplayerHud: MultiplayerHud;
  /** Win condition: first to this many kills wins. Fixed for the match - the host's choice at
   * room-creation time, carried on MatchStartMessage. */
  readonly killLimit: number;
  /** Goose explosion blast radius/damage tuning - the host's choice, fixed for the match, carried
   * on MatchStartMessage alongside killLimit. */
  readonly gooseDifficulty: GooseExplosionDifficulty;
  /** Loadout/damage-rules mode - the host's choice, fixed for the match, carried on
   * MatchStartMessage alongside killLimit/gooseDifficulty. Drives both the initial
   * WeaponManager.create() call (see create()) and Gun Game's kill-upgrade hook (see the
   * 'playerDied' case below). */
  readonly gameMode: GameMode;
  /** Host-only (see MultiplayerSession.hostRoster) - non-null exactly when role==='host', used to
   * resolve a mid-match join/rejoin's hello (see onHostHello below) and to periodically free
   * expired rejoin reservations (see hostSweepAccumulator). */
  readonly hostRoster: HostRoster | null;
  snapshotAccumulator: number;
  /** Host-only throttle for HostRoster.sweepExpiredReservations - there's no separate server tick
   * to hang this off of (the host IS just another player's own tab), so it's polled from this
   * client's own update loop instead, at a coarse interval rather than every frame. */
  hostSweepAccumulator: number;
  /** Counts up while this client's own player is dead; 0 whenever alive. Compared against
   * MULTIPLAYER_RESPAWN_DELAY in updateMultiplayer() to trigger the automatic respawn. */
  deathTimer: number;
  /** This client's own best-effort "who last damaged me" tracking for kill-credit (see
   * protocol.ts's PlayerDiedMessage doc) - reset to null on respawn/match start. */
  lastDamageSourceSlot: PlayerSlot | null;
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Message types the host transparently re-broadcasts to every other connected guest, unchanged,
 * tagged with the original sender's own slot - see the class comment on Game's onMessage handler.
 * Lobby/roster messages (hello/welcome/rosterUpdate/roomFull) and host-authored broadcasts
 * (matchStart/hostLeftRoom/playerLeft/playerJoinedMatch) are deliberately excluded - the host
 * authors those itself, they never arrive from elsewhere to relay. */
const RELAYABLE_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'playerSnapshot',
  'fireEvent',
  'damageEvent',
  'playerDied',
  'respawnEvent',
  'footstepEvent',
  'goosePickedUp',
  'gooseThrown',
  'gooseThrowExploded',
]);

/** Shared linear gain falloff shape: full volume inside `fullVolumeRange`, fading to `minVolume`
 * (never silent - an inaudible shot that still damages would read as unfair) at `audibleRange`. */
function distanceGainFalloff(distance: number, fullVolumeRange: number, audibleRange: number, minVolume: number): number {
  const t = (distance - fullVolumeRange) / (audibleRange - fullVolumeRange);
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - clamped * (1 - minVolume);
}

/** Single-player enemy gunshots and goose explosions - see the ENEMY_GUNSHOT_* constants'
 * comment in config.ts. */
function enemyGunshotVolume(distance: number): number {
  return distanceGainFalloff(distance, ENEMY_GUNSHOT_FULL_VOLUME_RANGE, ENEMY_GUNSHOT_AUDIBLE_RANGE, ENEMY_GUNSHOT_MIN_VOLUME);
}

/** Multiplayer opponent gunshots/footsteps specifically - a deliberately more generous full-volume
 * range than enemyGunshotVolume (see MULTIPLAYER_GUNSHOT_* constants' comment in config.ts for
 * why this needed to be a separate function rather than widening the shared one). */
function multiplayerGunshotVolume(distance: number): number {
  return distanceGainFalloff(distance, MULTIPLAYER_GUNSHOT_FULL_VOLUME_RANGE, MULTIPLAYER_GUNSHOT_AUDIBLE_RANGE, MULTIPLAYER_GUNSHOT_MIN_VOLUME);
}

/** Stereo pan (-1 full left .. 1 full right) for a sound at `sourcePosition`, from the perspective
 * of a listener at `listenerPosition` facing `listenerYaw` (see Player.facingYaw's own comment on
 * this yaw convention - 0 faces -Z) - used for opponent gunshots in multiplayer (per user request:
 * "positional audio") so a shot fired from off to the player's side is audibly distinguishable
 * from one straight ahead, not just louder/quieter with distance. Purely horizontal (XZ plane) -
 * this is a stereo pan, not full 3D audio, so vertical offset (a shot from a watch tower platform
 * above) doesn't factor in. */
function computeStereoPan(listenerPosition: THREE.Vector3, listenerYaw: number, sourcePosition: THREE.Vector3): number {
  const dx = sourcePosition.x - listenerPosition.x;
  const dz = sourcePosition.z - listenerPosition.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.001) return 0; // Coincident points - direction is undefined, default centered.

  // The listener's own "right" direction in world space, derived from the same yaw convention
  // Player.ts's debugLookAt uses (yaw = atan2(-dx, -dz), i.e. forward = (-sin(yaw), -cos(yaw))) -
  // rotating that forward vector -90 degrees around Y gives right = (cos(yaw), -sin(yaw)).
  const rightX = Math.cos(listenerYaw);
  const rightZ = -Math.sin(listenerYaw);
  return Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / distance));
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
  /** Test-only: applies real damage through Player.takeDamage (the same path enemy shots use). */
  damagePlayer(amount: number): void;
  getActiveBuildingCount(): number;
  getActiveTowerPositions(): { x: number; z: number }[];
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
  /** Multiplayer only - how many OTHER players are currently in this match (0-3), for verifying a
   * 3-4 player lobby actually has everyone present instead of just the single opponent the older
   * getOpponentPosition/getOpponentScore helpers above assume. 0 outside a multiplayer match. */
  getOpponentCount(): number;
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
  /** Goose Toss mode only (see updateGooseToss) - the id of the wandering goose currently held in
   * this player's own hands, or null if empty-handed. Distinct from WeaponManager's "unarmed"
   * placeholder slot, which never actually changes regardless of this. */
  private heldGooseId: string | null = null;
  /** The held-goose view model attached to the camera, shown/hidden alongside heldGooseId - built
   * once at Goose Toss match start (see create()), not per-pickup, so there's no per-pickup asset
   * work. */
  private heldGooseViewModel: THREE.Group | null = null;
  /** Goose Toss mode only - every ThrownGoose currently in flight, own throws and every other
   * player's alike (see ThrownGoose.ts's class comment on thrower-only authority). */
  private readonly thrownGeese = new Map<string, ThrownGoose>();
  /** Host-only (see updateGooseToss): throttles GooseManager.spawnRandomOnMap to
   * GOOSE_TOSS_SPAWN_INTERVAL_SECONDS instead of every frame. */
  private gooseTossSpawnAccumulator = 0;
  /** Every player's running kill count in the current multiplayer match, own slot included -
   * replaces the old single scoreState.value (mine)/multiplayerDeathCount (a 1v1-only proxy for
   * the one opponent's score) now that there can be up to 3 opponents. Updated symmetrically by
   * applyPlayerDied for every playerDied this client sends or receives (see multiplayerScoring.ts). */
  private readonly multiplayerScoreboard = new Map<PlayerSlot, number>();
  /** Every player's running death count - kept alongside the scoreboard for parity, though only
   * the scoreboard actually drives the win condition/podium. */
  private readonly multiplayerDeathCounts = new Map<PlayerSlot, number>();
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
    private readonly watchTowers: WatchTowerManager,
    private readonly entityManager: EntityManager,
    private readonly weaponManager: WeaponManager,
    private readonly impactMarkers: ImpactMarkers,
    private readonly tracers: Tracers,
    private readonly muzzleFlash: MuzzleFlash,
    private readonly gooseManager: GooseManager,
    private readonly gooseAnnouncement: GooseAnnouncement,
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
      // Queued, not applied immediately: update() detects death by comparing isDead across the
      // tick (wasDead), so damage landing *between* ticks would make the death transition
      // unobservable and the death screen would never show. Queuing routes debug damage through
      // the exact same within-tick path enemy damage takes.
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
        return opponent !== undefined ? this.multiplayerScoreboard.get(opponent) ?? 0 : 0;
      },
      isMultiplayerMatchEnded: () => this.matchEnded,
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
    const ownSpawn = ownSpawnPoint ? new THREE.Vector2(ownSpawnPoint.x, ownSpawnPoint.z) : new THREE.Vector2(SPAWN_X, SPAWN_Z);

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
    // Single-player never has a mode (per user request) - resolveWeaponLoadout('default') is the
    // same unrestricted 5-weapon loadout this was a literal array for before game modes existed.
    const loadout = resolveWeaponLoadout(multiplayer?.gameMode ?? DEFAULT_GAME_MODE);
    const weaponManager = await WeaponManager.create(
      renderer.camera,
      physics,
      loadout.weaponIds,
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
          senderSlot: multiplayer.ownSlot,
          originX: start.x,
          originY: start.y,
          originZ: start.z,
          endX: end.x,
          endY: end.y,
          endZ: end.z,
          // weaponManager isn't assigned in this outer scope until after this very call resolves,
          // but this callback only ever fires later, during gameplay - by then it's safely
          // assigned, same as every other closure captured in this constructor call.
          //
          // activeWeaponId, not weaponSlotNames[activeWeaponIndex] - the latter returns the
          // display name (e.g. "Kestrel P9"), which playGunshot's `${weaponId}_shot` buffer
          // lookup never matches, silently falling through to its generic fallback sound. This is
          // why every multiplayer opponent's gunshot sounded the same regardless of weapon.
          weaponId: weaponManager.activeWeaponId,
        });
      },
      (weaponId) => sound.playGunshot(weaponId),
      (weaponId) => sound.playReloadClick(weaponId),
      (distance) => longShotCallout.show(distance),
      (point) => muzzleFlash.spawn(point),
      loadout.damageOverrides,
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
    if (!multiplayer) {
      await Game.spawnEncountersAsync(entityManager, matchConfig.targetCount, matchConfig.enemyCount, (status, spawnRatio) => {
        onProgress?.(status, 0.15 + spawnRatio * 0.85);
      });
    }

    const gooseAnnouncement = new GooseAnnouncement(hudRoot);
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
    if (!multiplayer || multiplayer.role === 'host') {
      gooseManager.spawnInitialBatch(ownSpawn.x, ownSpawn.y);
    }

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
        opponents.set(entry.slot, { slot: entry.slot, remotePlayer, username: entry.username, health: player.maxHealth, lastMessageAt: performance.now() });
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
        hostRoster: multiplayer.role === 'host' ? multiplayer.hostRoster ?? null : null,
        snapshotAccumulator: 0,
        hostSweepAccumulator: 0,
        deathTimer: 0,
        lastDamageSourceSlot: null,
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
    const pauseMenu = new PauseMenu(
      hudRoot,
      {
        onResume: () => input.requestPointerLock(),
        onSettings: () => settingsPanel.show(),
        onResetPlay: () => gameRef.current?.resetPlay(),
        onReturnToLobby: () => onReturnToLobby?.(),
        onRespawn: () => gameRef.current?.manualRespawn(),
      },
      multiplayer !== undefined,
    );
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
      watchTowers,
      entityManager,
      weaponManager,
      impactMarkers,
      tracers,
      muzzleFlash,
      gooseManager,
      gooseAnnouncement,
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
      activeMultiplayer,
      onMultiplayerMatchEnd,
      onMultiplayerRematchReceived,
      onOpponentLeftRoom,
    );
    gameRef.current = game;

    // Goose Toss mode only (see updateGooseToss) - built once here, shown/hidden per pickup/throw
    // rather than rebuilt each time, same reasoning as every weapon view model already attached to
    // this camera.
    if (multiplayer?.gameMode === 'gooseToss') {
      const heldGoose = buildGooseMesh();
      heldGoose.scale.setScalar(0.55);
      heldGoose.position.copy(WEAPON_HIP_POSITION);
      heldGoose.visible = false;
      renderer.camera.add(heldGoose);
      game.heldGooseViewModel = heldGoose;
    }

    // Seed this match's running scoreboard from whatever a late join/rejoin was handed (empty for
    // a normal fresh match start - see MultiplayerSession.initialScoreboard's own comment).
    if (multiplayer) {
      for (const entry of multiplayer.initialScoreboard) game.multiplayerScoreboard.set(entry.slot, entry.score);
    }

    // Takes over from the room screen's own connection callbacks (which only knew how to update
    // now-hidden UI) - see PeerConnection.setCallbacks. Relay (host-only, transparent pass-through
    // of gameplay messages to every other connected guest) happens once here, before the
    // slot-aware local-application switch below - see the class comment on why this is safe to do
    // unconditionally rather than per message type.
    if (activeMultiplayer) {
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
        onError: () => {
          if (activeMultiplayer.session.role === 'guest') game.endMultiplayerMatch(false, 'opponentDisconnected');
        },
        onMessage: (message, senderSlot) => {
          if (activeMultiplayer.session.role === 'host' && RELAYABLE_MESSAGE_TYPES.has(message.type)) {
            activeMultiplayer.session.connection.sendExcept(message, senderSlot);
          }

          // Host-only liveness signal (see MULTIPLAYER_CONNECTION_TIMEOUT_MS's own comment) - any
          // message at all counts, not just playerSnapshot, so this stays fresh even during a brief
          // gap in position updates.
          const liveOpponent = activeMultiplayer.opponents.get(senderSlot);
          if (liveOpponent) liveOpponent.lastMessageAt = performance.now();

          switch (message.type) {
            case 'matchStart':
              // The initial matchStart is always consumed by the room screen before this handler
              // ever attaches - any matchStart seen here is the host's Rematch signal.
              game.onMultiplayerRematchReceived?.({
                seed: message.seed,
                killLimit: message.killLimit,
                gooseDifficulty: message.gooseDifficulty,
                gameMode: message.gameMode,
                ownSlot: activeMultiplayer.session.ownSlot,
                spawns: message.spawns.map((s) => ({ slot: s.slot, point: { x: s.x, z: s.z } })),
                roster: message.roster,
                // Room code/HostRoster don't change mid-connection - carry this match's own
                // session forward rather than re-deriving them (the host does the same, see
                // App.ts's handleRematchClick).
                roomCode: activeMultiplayer.session.roomCode,
                initialScoreboard: [],
                hostRoster: activeMultiplayer.hostRoster ?? undefined,
              });
              break;
            case 'playerSnapshot': {
              const opponent = activeMultiplayer.opponents.get(senderSlot);
              if (!opponent) break; // disconnected/unknown slot - a relay-hop race, not an error
              opponent.remotePlayer.applySnapshot(message.x, message.y, message.z, message.yaw);
              opponent.health = message.health;
              break;
            }
            case 'fireEvent': {
              // Purely cosmetic - the shooter's own client already resolved whether this shot
              // actually hit anything; this just makes it visible (and, per user request, audible
              // with real positioning) here too.
              const origin = new THREE.Vector3(message.originX, message.originY, message.originZ);
              const end = new THREE.Vector3(message.endX, message.endY, message.endZ);
              tracers.spawn(origin, end);
              muzzleFlash.spawn(origin);
              const distance = origin.distanceTo(player.position);
              const pan = computeStereoPan(player.position, player.facingYaw, origin);
              sound.playGunshot(message.weaponId, multiplayerGunshotVolume(distance), pan);
              break;
            }
            case 'damageEvent':
              // This client is authoritative over its own player's health - the attacker only ever
              // reports "you took N," never "you're dead," and only the actual intended target
              // applies it (everyone else still relays it - see RELAYABLE_MESSAGE_TYPES - but
              // ignores it for health purposes). Queued rather than applied here directly - see
              // pendingNetworkDamage.
              if (message.targetSlot !== activeMultiplayer.session.ownSlot) break;
              game.pendingNetworkDamage += message.amount;
              activeMultiplayer.lastDamageSourceSlot = message.senderSlot;
              break;
            case 'playerDied': {
              applyPlayerDied(game.multiplayerScoreboard, game.multiplayerDeathCounts, message);
              if (message.victimSlot !== activeMultiplayer.session.ownSlot) {
                const victimName = activeMultiplayer.usernames.get(message.victimSlot) ?? 'A player';
                const killerName = message.killerSlot !== null ? activeMultiplayer.usernames.get(message.killerSlot) : null;
                killFeed.show(killerName ? `${victimName} eliminated by ${killerName}` : `${victimName} eliminated`);
              }
              // Per user request: a kill resets the killer's health too, not just the one who
              // died - the dying player's own health already resets via player.respawn() (delayed
              // by MULTIPLAYER_RESPAWN_DELAY); this is the *other* side of that same round-reset,
              // scoped to "only if I'm the one who got this particular kill" now that any of up to
              // 3 other players could have been the actual killer, not always me.
              if (message.killerSlot === activeMultiplayer.session.ownSlot) game.healLocalPlayerToFull();
              // Gun Game's kill-upgrade: only the killer's own client acts on its own kill (each
              // client is already authoritative over its own weapon state, same as every other
              // per-client-authoritative pattern in this protocol) - dying does NOT reset the
              // weapon (per user request), which already falls out of the fact that respawn only
              // ever refills ammo, never touches weapon identity (see Weapon reset comments).
              if (activeMultiplayer.gameMode === 'gunGame' && message.killerSlot === activeMultiplayer.session.ownSlot) {
                void weaponManager.replaceActiveWeapon(pickGunGameUpgrade(weaponManager.activeWeaponId));
              }
              // "A goose spawns whenever a player dies" - a dying guest can't spawn its own
              // authoritative goose (see GooseManager's class comment), so the host does it here on
              // that guest's behalf the moment its playerDied arrives. The host's own death instead
              // takes the direct path in update()'s wasDead block (this message never loops back to
              // its own sender, so the host would otherwise never react to its own death here).
              if (activeMultiplayer.session.role === 'host') {
                const victimPosition = activeMultiplayer.opponents.get(message.victimSlot)?.remotePlayer.position;
                if (victimPosition) gooseManager.spawnNear(victimPosition.x, victimPosition.z);
              }
              break;
            }
            case 'gooseSpawned':
              gooseManager.applyRemoteSpawn(message.id, message.x, message.y, message.z);
              break;
            case 'gooseSnapshot':
              gooseManager.applyRemoteSnapshot(message.id, message.x, message.z);
              break;
            case 'gooseHitEvent':
              // Guest -> host only (see protocol.ts) - a guest's own connection never receives this.
              if (activeMultiplayer.session.role === 'host') gooseManager.registerRemoteHit(message.id);
              break;
            case 'gooseExploded':
              gooseManager.applyExplosion(
                message.id,
                new THREE.Vector3(message.x, message.y, message.z),
                activeMultiplayer.gooseDifficulty,
                player,
              );
              break;
            case 'gooseSyncRequest':
              // Guest -> host only (see protocol.ts) - replies with every currently-live goose as
              // an individual gooseSpawned targeted only at the requester (sendTo, not a
              // broadcast), so the other already-synced guests don't get redundant spawns.
              if (activeMultiplayer.session.role === 'host') {
                for (const goose of gooseManager.listForSync()) {
                  activeMultiplayer.session.connection.sendTo(senderSlot, { type: 'gooseSpawned', ...goose });
                }
              }
              break;
            case 'respawnEvent': {
              const opponent = activeMultiplayer.opponents.get(senderSlot);
              opponent?.remotePlayer.teleportTo(message.x, message.y, message.z);
              break;
            }
            case 'footstepEvent': {
              const origin = new THREE.Vector3(message.x, message.y, message.z);
              const distance = origin.distanceTo(player.position);
              const pan = computeStereoPan(player.position, player.facingYaw, origin);
              sound.playFootstep(multiplayerGunshotVolume(distance), pan);
              break;
            }
            case 'goosePickedUp':
              // Removes it from this client's own view of the flock regardless of role - for the
              // host that's the actual authoritative entry (so it stops being offered to anyone
              // else via findNearestWithinRadius/broadcast further snapshots for it); for a guest
              // it's just their own follower mirror. See protocol.ts's own comment on why this is
              // relay-based rather than host-arbitrated.
              gooseManager.removeById(message.id);
              break;
            case 'gooseThrown': {
              // Only ever received for another player's throw - the thrower's own client already
              // spawned its local copy before sending this (see updateGooseToss).
              const origin = new THREE.Vector3(message.originX, message.originY, message.originZ);
              const velocity = new THREE.Vector3(message.velX, message.velY, message.velZ);
              const thrown = new ThrownGoose(message.id, senderSlot, origin, velocity);
              renderer.scene.add(thrown.mesh);
              game.thrownGeese.set(message.id, thrown);
              break;
            }
            case 'gooseThrowExploded': {
              // VFX/sound only - damage was already applied by the thrower via ordinary
              // damageEvent messages (see resolveGooseTossExplosion), so this must NOT re-apply it.
              const position = new THREE.Vector3(message.x, message.y, message.z);
              explosionEffect.spawn(position, GOOSE_TOSS_EXPLOSION_RADIUS);
              sound.playExplosion(enemyGunshotVolume(position.distanceTo(player.position)), computeStereoPan(player.position, player.facingYaw, position));
              const thrown = game.thrownGeese.get(message.id);
              if (thrown) {
                thrown.dispose(renderer.scene);
                game.thrownGeese.delete(message.id);
              }
              break;
            }
            case 'hostLeftRoom':
              game.onOpponentLeftRoom?.();
              break;
            case 'playerLeft':
              game.removeMultiplayerOpponent(message.slot);
              break;
            case 'playerJoinedMatch':
              if (message.slot !== activeMultiplayer.session.ownSlot) void game.addMultiplayerOpponent(message.slot, message.username);
              break;
          }
        },
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

          const roster = hostRoster.currentRoster();
          if (hostRoster.isMatchInProgress()) {
            const otherPositions = Array.from(activeMultiplayer.opponents.values(), (o) => ({ x: o.remotePlayer.position.x, z: o.remotePlayer.position.z }));
            otherPositions.push({ x: player.position.x, z: player.position.z });
            const spawnPoint = pickRandomRespawnPoint(otherPositions);
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
                scoreboard: Array.from(game.multiplayerScoreboard, ([slot, score]) => ({ slot, score })),
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
        activeMultiplayer.session.connection.send({ type: 'gooseSyncRequest', senderSlot: activeMultiplayer.session.ownSlot });
      }
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
    this.input.requestPointerLock();
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
    this.gooseAnnouncement.dispose();
    this.explosionEffect.dispose();
    this.gooseManager.dispose();
    for (const thrown of this.thrownGeese.values()) thrown.dispose(this.renderer.scene);
    this.thrownGeese.clear();
    if (this.heldGooseViewModel) this.renderer.camera.remove(this.heldGooseViewModel);
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
  private resetPlay(): void {
    if (this.multiplayer) {
      if (this.player.isDead) this.multiplayerRespawn();
      return;
    }

    const spawnY = sampleHeight(SPAWN_X, SPAWN_Z) + SPAWN_HEIGHT_OFFSET;
    this.player.respawn(new THREE.Vector3(SPAWN_X, spawnY, SPAWN_Z));
    this.weaponManager.resetAllAmmo();
    this.entityManager.clearAll();
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
    } else {
      // Runs before weaponManager.update() specifically so a throw's 'fire' press is consumed
      // here first - WeaponManager never sees it, so the harmless 'unarmed' placeholder weapon
      // never has anything to (not) do with it either.
      if (this.multiplayer?.gameMode === 'gooseToss') this.updateGooseToss(dt);
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
    this.gooseAnnouncement.update(dt);
    this.explosionEffect.update(dt);
    this.updateMultiplayer(dt);

    if (this.player.isDead && !wasDead) {
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
      if (!this.multiplayer || this.multiplayer.session.role === 'host') {
        this.gooseManager.spawnNear(this.player.position.x, this.player.position.z);
      }
      if (this.multiplayer) {
        // No other player has visibility into this client's health - this is the only way they
        // learn a kill actually landed. `lastDamageSourceSlot` is this client's own best-effort
        // record of who dealt it (see the damageEvent handler in create()) - self-reported, not
        // adjudicated by anyone else, same trust model this protocol already uses for health.
        const killerSlot = this.multiplayer.lastDamageSourceSlot;
        const ownSlot = this.multiplayer.session.ownSlot;
        this.multiplayer.session.connection.send({ type: 'playerDied', senderSlot: ownSlot, victimSlot: ownSlot, killerSlot });
        // The sender applies its own scoreboard update locally rather than waiting to receive its
        // own broadcast back - a host never receives its own sent messages, and a guest's message
        // never loops back to it either.
        applyPlayerDied(this.multiplayerScoreboard, this.multiplayerDeathCounts, { victimSlot: ownSlot, killerSlot });
      }
    }

    this.hud.setAmmo(this.weaponManager.ammo, this.weaponManager.magazineSize, this.weaponManager.isReloading);
    // Goose Toss has no real weapon to name (see gameModes.ts's 'unarmed' placeholder) - shows
    // what actually matters here instead: whether this player is currently holding a goose.
    this.hud.setWeaponName(
      this.multiplayer?.gameMode === 'gooseToss' ? (this.heldGooseId ? 'Holding a Goose' : 'Empty-Handed [E to pick up]') : this.weaponManager.weaponName,
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
    this.multiplayer.minimap.update(this.player.position, opponentPositions, this.player.facingYaw);
    const opponentHealths = new Map(Array.from(this.multiplayer.opponents, ([slot, o]) => [slot, o.health] as const));
    this.multiplayer.multiplayerHud.update(this.player.currentHealth, this.player.maxHealth, opponentHealths, this.multiplayerScoreboard);

    // Win condition: first to killLimit ends the match. Checked here rather than where each score
    // actually changes (the playerDied handling scattered across create()'s onMessage and update()'s
    // own death-transition block) so there's exactly one place that decides "the match is over,"
    // regardless of which slot's score just crossed the line - every client runs this same check
    // against its own copy of the scoreboard (kept in sync purely by relaying playerDied messages),
    // so no host adjudication is needed for everyone to converge on the same outcome.
    if (!this.matchEnded) {
      for (const [slot, score] of this.multiplayerScoreboard) {
        if (score >= this.multiplayer.killLimit) {
          this.endMultiplayerMatch(slot === this.multiplayer.session.ownSlot, 'killLimit');
          break;
        }
      }
    }
    if (this.matchEnded) return;

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
          if (now - opponent.lastMessageAt < MULTIPLAYER_CONNECTION_TIMEOUT_MS) continue;
          this.multiplayer.hostRoster.handleDisconnect(opponent.slot, now);
          this.removeMultiplayerOpponent(opponent.slot);
          this.multiplayer.session.connection.send({ type: 'playerLeft', slot: opponent.slot });
        }
      }
    }

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
  private multiplayerRespawn(): void {
    if (!this.multiplayer) return;

    const ownSlot = this.multiplayer.session.ownSlot;
    const otherPositions = Array.from(this.multiplayer.opponents.values(), (o) => ({ x: o.remotePlayer.position.x, z: o.remotePlayer.position.z }));
    const { x, z } = pickRandomRespawnPoint(otherPositions);
    const spawnY = sampleHeight(x, z) + SPAWN_HEIGHT_OFFSET;
    this.player.respawn(new THREE.Vector3(x, spawnY, z));
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
    const { x, z } = pickRandomRespawnPoint(otherPositions);
    const spawnY = sampleHeight(x, z) + SPAWN_HEIGHT_OFFSET;
    this.player.debugTeleport(new THREE.Vector3(x, spawnY, z));
    this.multiplayer.session.connection.send({ type: 'respawnEvent', senderSlot: ownSlot, x, y: spawnY, z });
  }

  /** Goose Toss mode's own input handling (pickup via 'interact', throw via 'fire') - runs once
   * per tick before weaponManager.update() so a throw's fire press never reaches the harmless
   * 'unarmed' placeholder weapon (see updateGooseToss's call site). Multiplayer only (see
   * gameModes.ts) - never called otherwise. */
  private updateGooseToss(dt: number): void {
    void dt; // no per-frame state of its own beyond consuming this tick's input - kept for a
    // consistent method signature alongside every other per-tick updateX(dt) in this class.
    if (!this.multiplayer) return;
    const ownSlot = this.multiplayer.session.ownSlot;

    if (this.heldGooseId === null) {
      if (!this.input.consumeJustPressed('interact')) return;
      const nearestId = this.gooseManager.findNearestWithinRadius(this.player.position, GOOSE_PICKUP_RADIUS);
      if (nearestId === null || !this.gooseManager.removeById(nearestId)) return;
      this.heldGooseId = nearestId;
      if (this.heldGooseViewModel) this.heldGooseViewModel.visible = true;
      this.multiplayer.session.connection.send({ type: 'goosePickedUp', senderSlot: ownSlot, id: nearestId });
      return;
    }

    if (!this.input.consumeJustPressed('fire')) return;
    const id = this.heldGooseId;
    this.heldGooseId = null;
    if (this.heldGooseViewModel) this.heldGooseViewModel.visible = false;

    const camera = this.renderer.camera;
    const origin = camera.position.clone();
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    // A small forward offset so the goose doesn't immediately register as hitting the thrower's
    // own position on its very first physics tick.
    origin.addScaledVector(direction, 0.6);
    const velocity = direction.clone().multiplyScalar(GOOSE_THROW_SPEED);

    const thrown = new ThrownGoose(id, ownSlot, origin, velocity);
    this.renderer.scene.add(thrown.mesh);
    this.thrownGeese.set(id, thrown);

    this.multiplayer.session.connection.send({
      type: 'gooseThrown',
      senderSlot: ownSlot,
      id,
      originX: origin.x,
      originY: origin.y,
      originZ: origin.z,
      velX: velocity.x,
      velY: velocity.y,
      velZ: velocity.z,
    });
  }

  /** Advances every in-flight ThrownGoose (own throws and every other player's mirrored copy -
   * see ThrownGoose.ts's class comment on thrower-only authority). Only the thrower's own copy
   * decides when/where it explodes and applies damage; every other client's copy is purely
   * cosmetic until a matching gooseThrowExploded message arrives (see the 'gooseThrowExploded'
   * case below) or its own GOOSE_THROW_MAX_LIFETIME_SECONDS safety timeout elapses (a dropped
   * message/relay-hop race shouldn't leave an orphaned goose flying forever). */
  private updateThrownGeese(dt: number): void {
    if (this.thrownGeese.size === 0) return;
    const ownSlot = this.multiplayer?.session.ownSlot;

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
        this.resolveGooseTossExplosion(hitPosition, thrown.throwerSlot);
        thrown.dispose(this.renderer.scene);
        this.thrownGeese.delete(thrown.id);
        this.multiplayer?.session.connection.send({ type: 'gooseThrowExploded', id: thrown.id, x: hitPosition.x, y: hitPosition.y, z: hitPosition.z });
      }
    }
  }

  /** Fixed blast size (per explicit user request - Goose Toss deliberately ignores the host's
   * chosen goose-explosion-difficulty setting, unlike every other mode/trigger). Applies splash
   * damage to whichever players are actually within range: self-applied directly if this client's
   * own player is in range (every client stays authoritative over its own health, same as
   * everywhere else in this protocol), and via an ordinary DamageEventMessage to any opponent in
   * range - reusing the exact same message the shooter of a normal weapon hit already sends, so
   * kill credit flows through the existing playerDied/scoreboard pipeline unchanged (per explicit
   * user request: unlike a wandering goose's own death, dying to a Goose Toss throw DOES count). */
  private resolveGooseTossExplosion(position: THREE.Vector3, throwerSlot: PlayerSlot): void {
    this.explosionEffect.spawn(position, GOOSE_TOSS_EXPLOSION_RADIUS);
    this.sound.playExplosion(
      enemyGunshotVolume(position.distanceTo(this.player.position)),
      computeStereoPan(this.player.position, this.player.facingYaw, position),
    );

    const selfDamage = computeExplosionDamage(position.distanceTo(this.player.position), GOOSE_TOSS_EXPLOSION_RADIUS, GOOSE_TOSS_EXPLOSION_MAX_DAMAGE);
    if (selfDamage > 0) this.player.takeDamage(selfDamage);

    if (!this.multiplayer) return;
    for (const opponent of this.multiplayer.opponents.values()) {
      const amount = computeExplosionDamage(position.distanceTo(opponent.remotePlayer.position), GOOSE_TOSS_EXPLOSION_RADIUS, GOOSE_TOSS_EXPLOSION_MAX_DAMAGE);
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
    this.multiplayer.opponents.set(slot, { slot, remotePlayer, username, health: this.player.maxHealth, lastMessageAt: performance.now() });
    this.multiplayer.usernames.set(slot, username);
    this.multiplayer.minimap.addDot(slot);
    this.multiplayer.multiplayerHud.addOpponentRow(slot, username);
  }

  /** Removes a slot that disconnected mid-match (see protocol.ts's PlayerLeftMessage) - the match
   * continues for everyone else (per user decision), this just tears down that one slot's visuals.
   * Deliberately leaves multiplayerScoreboard/multiplayerDeathCounts untouched - a disconnected
   * player's final score still needs to show correctly on the podium. */
  private removeMultiplayerOpponent(slot: PlayerSlot): void {
    if (!this.multiplayer) return;
    const opponent = this.multiplayer.opponents.get(slot);
    if (!opponent) return;
    opponent.remotePlayer.dispose(this.renderer.scene);
    this.multiplayer.opponents.delete(slot);
    this.multiplayer.minimap.removeDot(slot);
    this.multiplayer.multiplayerHud.removeOpponentRow(slot);
  }

  /** Ends a multiplayer match, either because the win condition was reached (checked in
   * updateMultiplayer - every client decides independently off its own local scoreboard, kept in
   * sync purely by relaying playerDied messages, so no host adjudication is needed) or because the
   * host disconnected (wired to PeerConnection's onPeerDisconnected in create() - a guest has no
   * path to any other guest without the host relaying, so losing the host is unrecoverable for it).
   * Freezes simulation via `matchEnded` (see the top of update()) and hands off to App, which owns
   * MatchEndScreen and any rematch - Game itself never recreates or disposes itself. */
  private endMultiplayerMatch(won: boolean, reason: MultiplayerMatchEndResult['reason']): void {
    if (this.matchEnded || !this.multiplayer) return;
    this.matchEnded = true;
    this.input.releasePointerLock();
    const ownSlot = this.multiplayer.session.ownSlot;
    const placements = Array.from(this.multiplayer.usernames, ([slot, username]) => ({
      slot,
      username,
      score: this.multiplayerScoreboard.get(slot) ?? 0,
      isYou: slot === ownSlot,
    })).sort((a, b) => b.score - a.score);
    this.onMultiplayerMatchEnd?.({
      reason,
      won,
      placements,
      killLimit: this.multiplayer.killLimit,
      gooseDifficulty: this.multiplayer.gooseDifficulty,
      gameMode: this.multiplayer.gameMode,
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
