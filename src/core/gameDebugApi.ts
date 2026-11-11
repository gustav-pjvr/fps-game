import type { MissionView } from './mission/missionState.ts';
import type { PerfLogEntry } from './perfStats.ts';
import type { GrenadeDebug } from '../combat/grenades/GrenadeSystem.ts';

/** Hooks for the Playwright e2e suite (e2e/). Mostly read and aim; a few change state on purpose
 * (teleport, placeEnemy, commandEnemy, setFacilityDoor, throwGrenade and the like), and damagePlayer, which exists so death-*UI-flow* tests don't
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
  /** Test-only, for frame captures (scripts/viewShots.mjs): stops the game's clock while frames
   * keep drawing, and steps a held game on by `seconds`. */
  holdTime(held: boolean): void;
  stepTime(seconds: number): void;
  /** The last shots fired (at most 64, oldest first) and what their handling came to: the weapon,
   * the shot's place in its burst, how far it was aimed (0 hip to 1), the cone it was drawn from and
   * the bloom in it (radians), and the kick it gave the view (docs/gun-handling.md). */
  getShotLog(): { weaponId: string; shotIndex: number; aim: number; spread: number; bloom: number; kick: number; side: number }[];
  getCameraChildrenDebug(): unknown[];
  /** Every drawn object within `radius` metres of the eye: its path of names, where its centre
   * is in the camera's space and on screen (-1 to 1), and its size. For finding a stray piece. */
  getNearEyeObjects(radius?: number): { path: string; kind: string; cam: number[]; screen: number[]; size: number[] }[];
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
    /** Seconds of flash-grenade blindness left. */
    blindSeconds: number;
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
  /** Test-only: live enemy `index` stops thinking and walks to `target` (a body centre point) through
   * the houses' navigator and doors; null lets it think again. */
  commandEnemy(index: number, target: { x: number; y: number; z: number } | null): void;
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
  /** Operation Uplink's state (docs/uplink.md), null outside a mission match: the stage, the alert
   * level, the redeploys left, the timers and the core as the HUD shows them, plus whether the
   * player carries the core and where it hovers when nobody does. */
  getMissionDebug(): (MissionView & {
    won: boolean; kills: number; damageTaken: number; carrying: boolean; corePosition: { x: number; y: number; z: number };
  }) | null;
  /** Operation Uplink: finishes the current stage as if its rule had been met (the hack done, the
   * core plugged in, the upload done, the extraction reached). */
  completeMissionStage(): void;
  /** Operation Uplink: runs the operation's own clock `seconds` forward with the player where they
   * stand, so its timers and waves fire without waiting for them in a slow test run. */
  advanceMission(seconds: number): void;
  /** King of the Hill, null in every other mode and on a guest before the host's first state: the
   * hill, the crown and who holds it, as this client shows them. */
  getKothDebug(): {
    hill: { x: number; z: number }; next: { x: number; z: number }; radius: number; moveIn: number;
    hold: 'empty' | 'held' | 'contested'; holder: number | null; crown: number | null; crownAt: { x: number; z: number } | null;
    push: boolean; teams: boolean;
  } | null;
  /** Showdown (the solo Director mode), null in every other mode: the act, the stage, the score and
   * its multiplier, the redeploys left, and how many enemies are alive. */
  getShowdownDebug(): {
    act: number; totalActs: number; stage: 'act' | 'breather' | 'finale' | 'won' | 'lost'; phase: string;
    score: number; multiplier: number; bestMultiplier: number; kills: number; redeploysLeft: number; alive: number;
    /** Supply crates on the field. */
    crates: { id: string; x: number; y: number; z: number }[];
    /** Whether a Warden is alive. */
    warden: boolean;
  } | null;
  /** Showdown, test-only: jumps to the start of act `act` (1 to 5). */
  setShowdownAct(act: number): void;
  /** A Director or Showdown match, test-only: ends the current build-up with its peak at once. */
  forceDirectorPeak(): void;
  /** Test-only, like damageEnemy: kills every live enemy through takeDamage, as the player's kills. */
  killEnemies(): void;
  /** King of the Hill, on the host: stops (or restarts) the hill's clock, so a slow test run can
   * finish its checks on one hill. */
  holdKothHill(held: boolean): void;
  /** Goose Horde, null in every other mode: the wave panel's numbers as this client shows them, every
   * live horde goose, the supply crates on the field, and this player's own state. */
  getHordeDebug(): {
    wave: number; totalWaves: number; phase: 'active' | 'intermission' | 'cleared'; nextIn: number; left: number;
    meter: number; need: number; boss: { id: string; hp: number; max: number } | null;
    kills: { slot: number; kills: number }[];
    geese: { id: string; x: number; y: number; z: number; flavor: string }[];
    crates: { id: string; x: number; y: number; z: number }[];
    /** 'up', 'down' (a teammate can revive) or 'out' (until the next wave); solo is always 'up'. */
    own: 'up' | 'down' | 'out';
    /** Slots this client holds to be down or out. */
    fallen: number[];
    /** Solo: the Second Winds left. */
    secondWinds: number;
  } | null;
  /** Goose Horde, on the authoritative side (solo or the host): skips to wave `wave` (1 based), with
   * nothing left of the current one, for tests of the late waves and the bosses. */
  setHordeWave(wave: number): void;
  /** Goose Horde, on the authoritative side: kills every live horde goose as this player's own. */
  killHordeGeese(): void;
  /** Goose Horde, on the authoritative side: while held, a wave that has run out of geese does not
   * end, so a slow test run can finish its checks inside one wave. */
  holdHordeWave(held: boolean): void;
  /** The torch (render/Flashlight.ts): whether this match has one, whether it is on, the match's
   * weather and whether it is on the Facility. */
  getTorchDebug(): { available: boolean; on: boolean; weather: 'day' | 'night' | 'fog'; facility: boolean };
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
    /** Lamps shot out so far (docs/facility-map.md, section 11). */
    deadLamps: number;
    /** Doors, how many are shut, breakers and how many are off (section 12). */
    doors: number;
    closedDoors: number;
    breakers: number;
    breakersOff: number;
  } | null;
  /** Facility only (section 12): door `index`, its state, whether its collider is in the physics
   * world, and a walkable spot 2 m out on its corridor side (null if that spot is not walkable);
   * null for no such door. */
  facilityDoor(index: number): {
    x: number; z: number; axis: 'x' | 'z'; width: number; height: number; open: boolean; collider: boolean;
    front: { x: number; z: number } | null;
  } | null;
  /** Test-only, Facility only: asks for door `index` open or shut through the interact key's own
   * path (authority, sync, sound). False when it already is, there is no such door, or a player
   * stands in its way. */
  setFacilityDoor(index: number, open: boolean): boolean;
  /** Facility only: breaker `index` (one per power zone), whether it is on, and its zone's panel and
   * emergency lamps with how many of each are lit now; null for no such breaker. */
  facilityBreaker(index: number): {
    x: number; y: number; z: number; on: boolean;
    panelLamps: number; panelLampsLit: number; emergencyLamps: number; emergencyLampsLit: number;
  } | null;
  /** Test-only, Facility only: like setFacilityDoor, for a breaker. */
  setFacilityBreaker(index: number, on: boolean): boolean;
  /** Facility only: the door or breaker panel the player looks at within reach, or null. */
  facilityLookTarget(): { kind: 'door' | 'breaker'; id: number } | null;
  /** The Valley's streamed-in houses (docs/enterable-buildings.md): design, placement, front door id
   * and state, ceiling lamps, whether the interior is drawn, and each room's middle at floor level. */
  getValleyHouses(): {
    name: string; design: string; x: number; y: number; z: number; rotationY: number;
    doorId: number; doorOpen: boolean; lamps: { id: number; lit: boolean }[]; interiorVisible: boolean;
    rooms: { name: string; x: number; y: number; z: number }[];
  }[];
  /** Asks for a Valley house door to be open or shut through the same rules as a key press. */
  setValleyDoor(id: number, open: boolean): boolean;
  /** Underground state and seeded lab routes in world coordinates at floor level. */
  getUndergroundDebug(): {
    amount: number; underground: boolean; torchAvailable: boolean;
    labs: {
      index: number; kind: 'full' | 'compact' | 'dead-end'; x: number; z: number; groundY: number; floorY: number;
      route: { x: number; y: number; z: number }[]; doorId: number;
    }[];
  };
  /** Like setValleyDoor, for the tower at `index`. */
  setTowerDoor(index: number, open: boolean): boolean;
  /** The windows' glass (docs/glass.md), null off the Valley: how many panes are streamed in, the
   * store's revision, what the view draws, and every streamed-in pane within `radius` metres of the
   * player (all of them when omitted) with its place, size and state. */
  getGlassDebug(radius?: number): {
    streamed: number; revision: number; drawn: { panes: number; airborne: number; lying: number };
    panes: { id: number; x: number; y: number; z: number; ux: number; uz: number; nx: number; nz: number; halfWidth: number; halfHeight: number; damage: number; broken: boolean; holes: number[] }[];
  } | null;
  /** Test-only: hits pane `id` at (u, v) with `power` exactly like this player's own round (state,
   * look, sound and, in multiplayer, the glassHit send). False when there is no such pane or it is
   * already broken. */
  hitGlass(id: number, u: number, v: number, power: number): boolean;
  /** Test-only, Valley only: unloads the terrain chunk holding (x, z) with everything streamed with
   * it (its houses, their doors, lamps and glass); the game loads it again within a few ticks. False
   * when that chunk is not loaded. */
  restreamChunkAt(x: number, z: number): boolean;
  /** The sound engine's counters (docs/sound.md): voices opened, skipped as inaudible or over the
   * cap, the most alive at once, the occlusion probe's ray casts, and where the listener stands. */
  getSoundDebug(): {
    voices: { opened: number; inaudible: number; overCap: number; peakLive: number };
    probe: { probes: number; casts: number; clear: number; bent: number; blocked: number };
    space: string;
  };
  /** The houses' lamps: how many are streamed in, lit and shot out, and the light pool. */
  getHouseLights(): { lamps: number; lit: number; dead: number; lights: { x: number; y: number; z: number; on: boolean }[] } | null;
  /** Test-only: shoots out lamp `index` exactly like a hit (light, effect, sound and, in multiplayer,
   * the lampDestroyed send); on the Valley `index` is a house lamp id (getValleyHouses' lamps).
   * False when there is no such live lamp. */
  shootLamp(index: number): boolean;
  /** Grenades (combat/grenades/GrenadeSystem.ts): the kind and count, the grenade in hand, every live grenade,
   * the local white-out level, the camera shake and the last detonation. */
  getGrenadeDebug(): GrenadeDebug | null;
  /** Test-only: throws one grenade (of the loadout's kind) at once with a full fuse, along
   * `direction` (default: the aim), spent from the carry like a real throw. The grenade's id, or
   * null with none left or grenades off. */
  throwGrenade(direction?: { x: number; y: number; z: number }): string | null;
  /** Facility only: where lamp `index` hangs, so an e2e test can aim at it; null elsewhere. */
  lampPosition(index: number): { x: number; y: number; z: number } | null;
  /** Every pickup of the match (docs/pickups.md) with its kind, the ground position and whether it
   * is on the map right now; empty when the match has none. */
  getPickups(): { id: number; kind: 'health' | 'ammo' | 'grenade'; x: number; y: number; z: number; available: boolean }[];
  /** Test-only: pickups taken from now on return after this many seconds (null restores the real
   * times). Pickups already away keep their timers. */
  setPickupRespawnSeconds(seconds: number | null): void;
  /** Multiplayer only (MULTIPLAYER_PLAN.md §7 phase 2) - null outside a multiplayer match. The
   * opponent's last-smoothed RemotePlayer position, for e2e verification that movement sync is
   * actually reaching the other client, not just that a connection exists. */
  getOpponentPosition(): { x: number; y: number; z: number } | null;
  /** Multiplayer only (MULTIPLAYER_PLAN.md §7 phase 4) - this client's own death count, which
   * equals the opponent's kill count from this client's point of view (see Game's
   * multiplayerDeathCount comment). 0 outside a multiplayer match. */
  getOpponentScore(): number;
  /** Multiplayer only - how many of this client's connections carry position snapshots on the
   * confirmed fast channel (network/fastChannel.ts), the HUD's ping line, and the live direct guest
   * links (PeerConnection.directLinksReady: a guest's own, the host's count of linked pairs). 0 and
   * '' outside a multiplayer match. */
  getNetworkDebug(): { fastChannelsReady: number; pingLabel: string; directLinksReady: number };
  /** Multiplayer only: every opponent's smoothed position, by slot (ascending), for a 3 to 4
   * player e2e test. Empty outside a multiplayer match. */
  getOpponentPositions(): { slot: number; x: number; y: number; z: number }[];
  /** Multiplayer only: the weapon and skin each opponent is seen holding, by slot (ascending); null
   * until their first snapshot names one. Empty outside a multiplayer match. */
  getOpponentWeapons(): { slot: number; weaponId: string | null; skinId: string | null }[];
  /** The held weapon's id and the skin it wears. */
  getHeldWeapon(): { weaponId: string; skinId: string };
  /** Multiplayer only: the scoreboard's rows as the HUD shows them (multiplayerHud.ts's
   * scoreboardRows), highest score first. Empty outside a multiplayer match. */
  getScoreboardRows(): { slot: number; name: string; score: number; isYou: boolean }[];
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
