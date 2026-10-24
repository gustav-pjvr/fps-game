import type { MissionView } from './mission/missionState.ts';
import type { PerfLogEntry } from './perfStats.ts';

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
  /** The once-a-second performance rows (see core/perfStats.ts), oldest first. */
  getPerfLog(): PerfLogEntry[];
  /** Test-only, like damagePlayer: the perf log spec uses it to watch a long fight without the
   * player dying and freezing single-player simulation. */
  setPlayerInvulnerable(invulnerable: boolean): void;
  /** Enemy AI v2: every live enemy's state, awareness (0 to 1), sightline and facing, with its
   * index into getLiveEntityPositions and its position. Targets are left out. */
  getLiveEnemyDebug(): {
    index: number;
    archetype: string;
    state: string;
    awareness: number;
    hasLineOfSight: boolean;
    yaw: number;
    /** Combat role (step 2): 'shooter' | 'flanker' | 'rusher' | 'reserve' while chasing, else null. */
    role: string | null;
    /** The spot it is fighting from (step 3): 'trunk' | 'tower' | 'houseCorner' | 'open', its phase
     * ('moving' | 'hiding' | 'peeking') and whether it is covered; null when it has none. */
    pick: { x: number; z: number; source: string; phase: string; covered: boolean } | null;
    /** The search-grid cell it is heading for while searching (step 4), else null. */
    searchTarget: { x: number; z: number } | null;
    /** Knocked off balance by a heavy hit right now (step 5). */
    staggered: boolean;
    x: number;
    y: number;
    z: number;
  }[];
  /** Enemy AI v2: what the squad believes about the player right now. */
  getSquadDebug(): {
    /** Game time in seconds (the squad clock) - use it to time behaviour in e2e checks. */
    clock: number;
    belief: { x: number; z: number; source: string; confidence: number; age: number } | null;
    visibleCount: number;
    secondsSinceSeen: number;
    /** How many enemies hold each combat role right now. */
    roles: Record<string, number>;
    /** Step 5: callouts voiced ('spotted', 'flanking', 'lostThem') and cues shown ('glint',
     * 'staggered') so far this match. */
    callouts: Record<string, number>;
    /** The live search grid (step 4): cell count, probability left (1 at the start), age in
     * seconds and the likeliest cell; null when the squad is not searching. */
    searchGrid: { cells: number; total: number; age: number; peak: { x: number; z: number; probability: number } | null } | null;
    /** Search grids built this match, and why the last one ended ('seen' | 'forgotten' | 'cleared'
     * | 'timedOut'), with its age and the chance left then. */
    searchGridsBuilt: number;
    lastSearchEnd: { reason: string; age: number; total: number } | null;
  };
  /** Test-only, like teleport: instantly moves the live enemy at `index` to (x, z) on the ground and
   * makes that its patrol home, so a behaviour test can stage a known layout that stays put. */
  placeEnemy(index: number, x: number, z: number): void;
  /** Enemy AI v2: registered cover (tree trunks, houses) within `radius` of (x, z), by centre. */
  getCoverNear(x: number, z: number, radius: number): { kind: string; x: number; z: number }[];
  /** Test-only, like damagePlayer: real damage to the live enemy at `index` through takeDamage. */
  damageEnemy(index: number, amount: number): void;
  /** Enemy AI v2 step 6: the pacing director in a Director match, null in any other match. */
  getDirectorDebug(): {
    phase: string;
    intensity: number;
    totalSpawned: number;
    /** The last wave's reinforcements, each with where the player stood and looked when it came in,
     * whether the spawner found it hidden from the player's eye, and a fresh check once placed of
     * whether it was on screen (inside the view with a clear line to its head). */
    lastSpawns: {
      x: number;
      z: number;
      playerX: number;
      playerZ: number;
      forwardX: number;
      forwardZ: number;
      hidden: boolean;
      onScreen: boolean;
    }[];
  } | null;
  /** The Uplink mission's state (docs/visual-overhaul.md, phase 4), null outside a mission match. */
  getMissionDebug(): (MissionView & { won: boolean; kills: number; damageTaken: number }) | null;
  /** The Facility (docs/facility-map.md) in a Facility match, null on the Valley: the map, the
   * layout's seed, its room, open cell and lamp counts, how long the light bake took and how many
   * vertices it lit, and whether the player's torch is on. */
  getFacilityDebug(): {
    map: 'facility';
    seed: number;
    rooms: number;
    openCells: number;
    lamps: number;
    bakeMs: number;
    vertexCount: number;
    torchOn: boolean;
  } | null;
  /** Multiplayer only (MULTIPLAYER_PLAN.md §7 phase 2) - null outside a multiplayer match. The
   * opponent's last-smoothed RemotePlayer position, for e2e verification that movement sync is
   * actually reaching the other client, not just that a connection exists. */
  getOpponentPosition(): { x: number; y: number; z: number } | null;
  /** Multiplayer only (MULTIPLAYER_PLAN.md §7 phase 4) - this client's own death count, which
   * equals the opponent's kill count from this client's point of view (see Game's
   * multiplayerDeathCount comment). 0 outside a multiplayer match. */
  getOpponentScore(): number;
  /** Multiplayer only - how many of this client's connections carry position snapshots on the
   * confirmed fast channel (network/fastChannel.ts), and the HUD's ping line. 0 and '' outside a
   * multiplayer match. */
  getNetworkDebug(): { fastChannelsReady: number; pingLabel: string };
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
