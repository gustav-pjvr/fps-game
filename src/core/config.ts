import { GAME_VERSION } from './version.ts';

export const FIXED_TIMESTEP = 1 / 60;
export const MAX_FRAME_TIME = 0.25;

/** Reported by the match-end telemetry beacon (see Game.ts's sendMatchTelemetry) so any future
 * server-side aggregation can tell which build a data point came from - not read anywhere else in
 * the client. Re-exports GAME_VERSION (version.ts's own single source of truth) rather than a
 * separate literal, so it can't drift out of sync with the version shown in the main menu. */
export const APP_VERSION = GAME_VERSION;

// World seed lives in core/worldSeed.ts (not here) - it's mutable at runtime so each new match
// generates a different world, unlike every other constant in this file.

/** Match spawn point and the largest encounter ring drawn around it (enemies use a bigger ring
 * than targets - see Game.ringRadius) - shared with VegetationManager so placement can keep world
 * content out of the actual spawn/combat area, not just world origin (0,0). */
export const SPAWN_X = 0;
export const SPAWN_Z = 8;
/** Extra clearance (metres) a player spawn point must keep from any house footprint or watch tower
 * footprint (see Game.ts's isSpawnBlocked), on top of the structure's own extent: a player capsule
 * is 0.4 m in radius, so this keeps the spawn comfortably outside walls and stair rails. */
export const SPAWN_STRUCTURE_CLEARANCE = 2;
export const ENEMY_RING_BASE_RADIUS = 25;

/** Up to 4 players in one lobby (1 host + up to 3 guests), host-relay star topology - see
 * PeerConnection.ts/HostRoster.ts. Every room-capacity/roster-loop/spawn-count computation in the
 * multiplayer code reads this one constant rather than a scattered magic 3/4. */
export const MULTIPLAYER_MAX_PLAYERS = 4;
/** How long the host holds a mid-match-disconnected guest's slot/score reserved before it's freed
 * for a genuinely new player - see HostRoster.ts's grace-period reservation and
 * core/multiplayerRejoin.ts's rejoin token. Long enough to survive a real dropped-wifi/tab-reload
 * blip, short enough that an abandoned slot doesn't block a 4th player from joining for the rest
 * of the match. */
export const MULTIPLAYER_REJOIN_GRACE_PERIOD_MS = 90_000;

/** Host-only: how long an opponent slot can go without sending *any* message before the host
 * proactively treats it as disconnected, independent of PeerJS/WebRTC's own connection-close
 * detection. That native detection isn't reliable enough to depend on alone - an abrupt tab close
 * (as opposed to a graceful page unload) doesn't always fire a prompt 'close'/'disconnected' event,
 * sometimes leaving a stale RemotePlayer standing indefinitely until the browser's own ICE timeout
 * eventually fires, if it ever does. Each client sends a playerSnapshot roughly every
 * PLAYER_SNAPSHOT_SEND_INTERVAL (~18Hz), so several seconds of total silence is already a strong
 * signal something is wrong, not a false positive from one dropped packet. */
export const MULTIPLAYER_CONNECTION_TIMEOUT_MS = 8_000;

/** The radius every multiplayer spawn ring (initial match-start spawns, mid-match respawns) is
 * placed on - see multiplayerSpawn.ts's pickMultiplayerSpawnPoints/pickRandomRespawnPoint. */
export const MULTIPLAYER_SPAWN_RADIUS = 35;
/** Fixed reference points at 6 canonical angles around MULTIPLAYER_SPAWN_RADIUS - kept purely as a
 * clearance-check reference for VegetationManager.ts (so trees don't spawn overlapping a spot a
 * match could plausibly place a player), decoupled from actual spawn *selection*: since
 * pickMultiplayerSpawnPoints now computes points analytically at a random rotation rather than
 * drawing from a fixed pool (there is no fixed pool to draw from anymore - see multiplayerSpawn.ts
 * for why), this array no longer represents "the possible spawn points," just 6 representative
 * samples around the same ring, evenly spaced, dense enough that a tree cleared of all 6 is
 * effectively cleared of the whole ring regardless of the actual per-match rotation offset.
 *
 * Known gap, not solved yet: unlike SPAWN_X/SPAWN_Z, these points are not currently excluded from
 * flat/forest zone placement (ZoneMap.ts's isSiteClear only measures clearance from the
 * single-player spawn) - a town or forest could rarely generate overlapping one of them. Doing the
 * same for zone placement would mean touching the guaranteed-zone system ZoneMap.test.ts locks in
 * across 1000 seeds, which isn't something to do incidentally alongside this. */
export const MULTIPLAYER_SPAWN_POINTS: ReadonlyArray<{ x: number; z: number }> = [0, 60, 120, 180, 240, 300].map(
  (angleDeg) => {
    const angle = (angleDeg * Math.PI) / 180;
    return { x: Math.cos(angle) * MULTIPLAYER_SPAWN_RADIUS, z: Math.sin(angle) * MULTIPLAYER_SPAWN_RADIUS };
  },
);
/** Per user request: a mid-match respawn must land at least "half a map size" from every other
 * currently-alive player's position - "map size" here is the spawn ring's own diameter (2x
 * MULTIPLAYER_SPAWN_RADIUS), so half of that is 35. See pickRandomRespawnPoint
 * (multiplayerSpawn.ts). */
export const MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT = 35;

/** How often this client broadcasts its own player's transform to the opponent (MULTIPLAYER_PLAN.md
 * §3) - well below the 60Hz simulation rate, since a remote player's on-screen position only needs
 * to look smooth, not be physically exact; RemotePlayer smooths between updates on the receiving
 * end. Raised from 1/18 (~55ms) to 1/30 (~33ms) after players reported hits frequently not
 * registering, worst with the sniper - at sprint speed (PLAYER_MOVE_SPEED * SPRINT_MULTIPLIER = 8
 * units/sec) the old interval let real position drift up to ~0.44 units between updates, close to
 * the target's then hit-radius (0.4; the spacesuit's fitted body is now 0.28, see
 * entities/characterHitbox.ts), before RemotePlayer's damping smoothing even adds its own further
 * lag on top. More frequent, tiny snapshot messages is a fine trade for a 1v1. */
export const PLAYER_SNAPSHOT_SEND_INTERVAL = 1 / 30;

/** How long a dead player waits before automatically respawning at their own spawn point
 * (MULTIPLAYER_PLAN.md §4a/§4) - a PvP match should keep flowing after a kill, not stop at a death
 * screen until someone clicks a button the way single-player's practice-reset flow does. */
export const MULTIPLAYER_RESPAWN_DELAY = 3;
/** How recently another player must have damaged you for your death to count as their kill (see
 * ActiveMultiplayer.lastDamageSourceAt). Long enough to credit a shot followed by a finishing goose
 * blast, short enough that an unrelated later death isn't credited to whoever last hit you. */
export const MULTIPLAYER_KILL_CREDIT_WINDOW_MS = 8_000;

/** World-distance the opponent-position minimap (MULTIPLAYER_PLAN.md §4b) represents at its edge -
 * inside this radius the dot is placed proportionally; beyond it, the dot clamps to the rim, still
 * pointing the right way. Raised from 120 to 220 when the spawns were still ~280 units apart (see
 * NOTES.md), then brought back down here once WORLD_SIZE_CHUNKS/the multiplayer spawns shrunk too -
 * spawns are now only ~70 units apart (MULTIPLAYER_SPAWN_A/B_X) in a world whose own boundary
 * radius is 200, so 220 would have made the whole map fit inside a small fraction of the minimap's
 * range, the opposite problem (too little dot movement resolution) from the one that radius fix
 * addressed in the first place. 90 keeps the spawns just outside range at the very start of a
 * match while giving the now much-smaller map's real engagement distances useful resolution. */
export const MINIMAP_WORLD_RADIUS = 90;

/** Win condition (MULTIPLAYER_PLAN.md §4): first to this many kills wins. Host types a number
 * (see CreateRoomScreen) instead of picking from a fixed preset list, clamped to
 * [MULTIPLAYER_KILL_LIMIT_MIN, MULTIPLAYER_KILL_LIMIT_MAX] - DEFAULT_MULTIPLAYER_KILL_LIMIT is
 * only the pre-filled default and the fallback if a match is somehow started without an explicit
 * choice. */
export const DEFAULT_MULTIPLAYER_KILL_LIMIT = 15;
export const MULTIPLAYER_KILL_LIMIT_MIN = 1;
export const MULTIPLAYER_KILL_LIMIT_MAX = 100;

export const CAMERA_FOV = 75;
/** Settings panel's Field of View slider bounds (see settings/Settings.ts's getFov/setFov) - wide
 * enough to matter (a narrow FOV feels like zooming, a wide one feels like a fisheye) without going
 * so far either direction that the view models/weapon sway (tuned around CAMERA_FOV) look broken. */
export const CAMERA_FOV_MIN = 60;
export const CAMERA_FOV_MAX = 110;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 2000;

/** Directional-light shadow camera (VISUAL_REALISM.md §1) - an unconfigured Three.js shadow camera
 * defaults to a +/-5 unit ortho box centered on the origin, so in this ~800x800m world shadows only
 * ever rendered in a tiny patch near spawn. The camera is re-centered on the player every frame
 * (see Game.updateSunFollow) so this box only needs to cover the player's immediate surroundings,
 * not the whole world.
 *
 * The two MAP_SIZE constants are the shadow depth texture's resolution (pixels per side, not a
 * world-space size) for the Medium/High graphics-quality presets (see settings/graphicsQuality.ts)
 * - the doc's original suggestion of 2048 unconditionally (and even 1024/768) hard-hung this
 * project's sandboxed, software-rendered (SwiftShader) Chromium during e2e runs - confirmed by
 * bisection (512 passes every smoke test cleanly, 768 hangs). MEDIUM (512) is the default so
 * out-of-the-box behavior matches what's actually tested; HIGH (the doc's original 2048) is an
 * opt-in for players on real GPU hardware, which has no reason to share the test sandbox's
 * software-rendering ceiling. */
export const SUN_SHADOW_MAP_SIZE_MEDIUM = 512;
export const SUN_SHADOW_MAP_SIZE_HIGH = 2048;
export const SUN_SHADOW_ORTHO_HALF_EXTENT = 60;
export const SUN_SHADOW_CAMERA_FAR = 200;
/** Raised from -0.0002 / 0.02 for the low dusk sun (render/look.ts): at a 24 degree elevation the
 * old values striped every sunlit wall with shadow acne. */
export const SUN_SHADOW_BIAS = -0.0006;
export const SUN_SHADOW_NORMAL_BIAS = 0.06;
/** How far along the look's sun direction (render/look.ts) the shadow-casting light sits from the
 * player. The dusk sun is low, so the light has to stand well back for hills and towers between it
 * and the player to land inside the shadow camera's depth range (SUN_SHADOW_CAMERA_FAR). */
export const SUN_SHADOW_LIGHT_DISTANCE = 90;

/** Muzzle flash (VISUAL_REALISM.md §7) - a brief PointLight + sprite at the muzzle on every
 * ranged shot. Lifetime is 2-3 frames at 60fps, long enough to read as a flash without lingering
 * into a glow. */
export const MUZZLE_FLASH_LIFETIME = 0.05;
export const MUZZLE_FLASH_LIGHT_INTENSITY = 6;
export const MUZZLE_FLASH_LIGHT_RANGE = 4;

/** Death sequence (VISUAL_REALISM.md §6) - a killed enemy/target now topples and sinks instead of
 * vanishing the instant its health hits 0 (previously the single worst realism-breaking moment in
 * the game per the review). Kept snappy per playtest feedback - the original 2s hold read as "the
 * character just stands there" - total is now ~1s: fall, a brief beat, then sink out of view. Only
 * mesh transform (rotation/position) is animated, deliberately not material opacity: enemy models
 * are SkeletonUtils-cloned, which reuses the source material by reference across every clone (see
 * its own docstring - "materials are reused by reference"), so fading one dying enemy's opacity
 * would fade every other enemy sharing that material too. EntityManager disposes the corpse's
 * physics presence (colliders/rigid body) immediately on death, same tick as before - only the
 * mesh removal is delayed, so nothing can still collide with or shoot through a dead body during
 * this sequence. */
export const DEATH_FALL_DURATION = 0.3;
export const DEATH_HOLD_DURATION = 0.1;
export const DEATH_SINK_DURATION = 0.6;
export const DEATH_FALL_ANGLE = Math.PI / 2;
export const DEATH_SINK_DISTANCE = 1.2;

/** Movement bob (VISUAL_REALISM.md §6) - previously the view model was bolted rigidly to the
 * camera with zero motion of its own. Player computes one shared sin phase from the player's
 * actual per-tick horizontal displacement (not a fixed idle timer, unlike the lobby's bob/sway -
 * this needs to track real movement so it starts/stops with the player, not run continuously) and
 * exposes it (see movementBobPhase/movementBobStrength) so both the camera bob below and
 * WeaponManager's weapon bob apply the exact same phase, matching the doc's framing that one
 * phase drives both. BOB_REFERENCE_SPEED is roughly walk speed - bob reaches full amplitude at or
 * above it and fades out as the player slows to a stop, rather than snapping on/off. */
export const PLAYER_BOB_FREQUENCY = 12;
export const PLAYER_BOB_REFERENCE_SPEED = 4;
export const CAMERA_BOB_AMPLITUDE = 0.02;

/** Weapon sway (lag behind look) and weapon bob (shared phase with the camera bob above) -
 * VISUAL_REALISM.md §6, porting the same "offset by a damped fraction of movement" idea the lobby
 * scene already uses for its idle character, but driven by the camera's actual look/movement
 * instead of a fixed idle timer. */
export const WEAPON_SWAY_LOOK_FACTOR = 0.4;
export const WEAPON_SWAY_MAX = 0.06;
export const WEAPON_SWAY_DAMP = 12;
export const WEAPON_BOB_AMPLITUDE = 0.015;

/** Host-chosen in multiplayer (see CreateRoomScreen), fixed at 'day' in single-player - purely
 * cosmetic/atmospheric, mirrors the gooseDifficulty/gameMode threading pattern exactly (same 4
 * sites: MatchStartMessage, WelcomeMessage.activeMatch, MultiplayerSession,
 * MultiplayerMatchStartParams). Each has a look in render/look.ts (sky, fog, lights, grade); 'day'
 * keeps its id for the network protocol but is the stylised dusk the art direction is built on. */
export type MatchWeather = 'day' | 'night' | 'fog';
export const DEFAULT_MATCH_WEATHER: MatchWeather = 'day';
export const MATCH_WEATHERS: readonly MatchWeather[] = ['day', 'night', 'fog'];
export const MATCH_WEATHER_LABELS: Record<MatchWeather, string> = {
  day: 'Dusk',
  night: 'Night',
  fog: 'Fog',
};

export const MOUSE_SENSITIVITY = 0.0022;
export const MAX_PITCH = Math.PI / 2 - 0.01;

export const GRAVITY = -20;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.4;
export const EYE_OFFSET = 0.75;
export const PLAYER_MOVE_SPEED = 5;
export const SPRINT_MULTIPLIER = 1.6;
export const JUMP_SPEED = 6.5;
export const RECOIL_DECAY = 8;
export const FOOTSTEP_DISTANCE = 2.2;
/** How fast an explosion knockback velocity bleeds off, same exponential-decay shape as
 * RECOIL_DECAY above (Player has no dynamic-body physics to lean on for a real impulse response -
 * the kinematic character controller only ever gets `computeColliderMovement`'d, so knockback is a
 * manually-decaying velocity added on top of normal input movement, not a Rapier impulse). */
export const KNOCKBACK_DECAY_PER_SECOND = 6;

export const ADS_LERP_SPEED = 12;
export const SCOPE_REVEAL_THRESHOLD = 0.92;

export const WEAPON_SWITCH_DURATION = 0.35;
export const WEAPON_HOLSTER_DROP = 0.35;
export const RELOAD_TILT_ANGLE = 0.5;
export const RELOAD_DIP = 0.08;

/** Time between rounds within a single burst (see WeaponDefinition.burstCount, currently only the
 * MP5) - distinct from `fireRate`, which instead gates time between the *start* of one burst and
 * the next. Tuned fast enough to read as one "rrrat" rather than three separate clicks. */
export const WEAPON_BURST_SHOT_INTERVAL_SECONDS = 0.08;

export const TARGET_HEALTH = 40;
export const TARGET_RADIUS = 0.5;
export const TARGET_HEAD_RADIUS = 0.18;
export const HEADSHOT_MULTIPLIER = 3;

// Per-enemy combat/movement numbers (health, chase speed, detection/leash/ranged ranges, ranged
// damage and burst cadence, aim-error cone, melee damage) live in entities/enemies/archetypes.ts,
// not here - the per-archetype loadout refactor moved them, and The Straggler's stat block is the
// old globally-tuned baseline (including the Phase C/E measured tuning notes that used to sit
// here). Only genuinely archetype-independent enemy constants remain below.
export const ENEMY_RADIUS = 0.45;
export const ENEMY_HEIGHT = 1.7;
/** Melee always wins below this range regardless of archetype (Phase D's universal fallback). */
export const ENEMY_ATTACK_RANGE = 3;
export const ENEMY_ATTACK_INTERVAL = 1;

/** Universal melee fallback (Phase D), upgraded from a flat auto-hit tick to a real fan-raycast
 * swing mirroring the player's own knife (WeaponManager.firePellet's spread technique) - requires
 * line-of-sight and can actually miss if none of the swing's rays connect, rather than guaranteeing
 * damage purely from being in range. */
export const ENEMY_MELEE_SWING_COUNT = 3;
export const ENEMY_MELEE_SWING_SPREAD_DEG = 10;

/**
 * Aggro/LOS state transitions (enemy AI overhaul, Phase B). Detection requires a clear
 * line-of-sight raycast in addition to the archetype's detectionRange, not distance alone - an
 * enemy on the far side of a building wall no longer "senses" the player through it. Idle/patrol
 * -> alert (a short reaction beat) -> chase. Losing LOS mid-chase (not just leashing out of range)
 * drops to search, which beelines the last-seen spot for a while before giving up back to patrol -
 * reads as "I saw you go around that corner" instead of instantly forgetting the player the moment
 * a wall gets between them.
 */
// ENEMY_ALERT_REACTION_TIME (a fixed 0.4 s beat between spotting and chasing) was replaced by the
// awareness meter in enemy AI v2 step 1 - see ENEMY_AWARENESS_FILL_TIME below.
export const ENEMY_SEARCH_DURATION = 6;
export const ENEMY_SEARCH_STOP_DISTANCE = 1.5;
/** Re-checking LOS every frame is wasted raycasts once several enemies are chasing at once -
 * this is a per-enemy cadence, not a global one, so it doesn't create a single frame-spike. */
export const ENEMY_LOS_CHECK_INTERVAL = 0.15;

/**
 * Fair enemy ranged combat (enemy AI overhaul, Phase C). Once chasing and within the archetype's
 * rangedRange with a clear line-of-sight, an engaging enemy stops closing distance and fires real
 * hitscan shots with a visible tracer - actual missed shots the player can see and react to, not a
 * hidden hit-chance roll. Aim error is a real angular cone that narrows the longer the enemy holds
 * aim on an unbroken sightline. The per-archetype numbers driving all of this (range, damage,
 * burst cadence, aim-error min/max/settle) live in archetypes.ts - only the match-level pacing
 * knobs below stay global.
 */
/** Global cap (shared across every enemy in the match) on how many can be actively firing at once -
 * without it, every enemy that spots the player opens fire the instant it's in range, which reads
 * as an unfair dogpile rather than a fight fought piece by piece. Since enemy AI v2 step 2 these
 * are the combat coordinator's shooter tokens (entities/enemies/combatCoordinator.ts), dealt to the
 * best-placed enemies rather than first come first served. An enemy without one still tracks/faces
 * the player, it just doesn't shoot yet. */
export const ENEMY_MAX_CONCURRENT_ENGAGERS = 2;

/**
 * Threat perception (2026-07-10 review, enemy AI phase A) - previously an idle/searching enemy had
 * no reaction at all to being shot, to gunfire, or to a nearby comrade dying, which was the single
 * biggest reason combat read as "shooting inert props" rather than a firefight (player weapons
 * out-range every archetype's own detectionRange several times over).
 */
/** How far off an attacker's actual position a hit/hearing-triggered search destination lands -
 * models "I know roughly where that came from," not an exact fix. */
export const ENEMY_THREAT_SEARCH_ERROR_MIN = 5;
export const ENEMY_THREAT_SEARCH_ERROR_MAX = 10;
/** Radius within which a player's own gunshot alerts nearby idle enemies toward the shot's origin -
 * independent of (and typically much larger than) any archetype's own detectionRange, since a real
 * gunshot is unmistakable regardless of line-of-sight. */
export const ENEMY_HEARING_RANGE = 40;
/** Radius within which an idle enemy with line-of-sight to a just-killed comrade's corpse enters
 * alert, facing the killer - the cheapest possible "squad awareness" cue. */
export const ENEMY_DEATH_ALERT_RADIUS = 20;
/** Fair accuracy model (phase D): scales aim error up by this many extra degrees at the player's
 * full sprint speed (Player.movementBobStrength === 1), tapering to 0 while stationary - a moving
 * target is harder to hit, same logic that already makes a *kiting enemy's own movement* widen its
 * aim (see updateRangedFiring's isStationary param), just applied to the player's motion too. */
export const ENEMY_VELOCITY_AIM_PENALTY_MAX_DEG = 4;

/**
 * Enemy AI v2, step 1 (docs/enemy-ai-v2.md): perception and shared squad knowledge. Spotting is an
 * awareness meter (entities/enemies/perception.ts) instead of "one clear ray means spotted, then a
 * fixed ENEMY_ALERT_REACTION_TIME beat": sight fills it, losing sight drains it, and how fast
 * depends on distance, the enemy's view cone and the player's speed. Suspicious reads as the old
 * 'alert' state, detected as 'chase'.
 */
/** Half-angle of the view cone up close: a player 5 m away is hard to miss. */
export const ENEMY_VIEW_HALF_ANGLE_NEAR_DEG = 70;
/** Half-angle at full detection range: only a player near the enemy's gaze line registers. */
export const ENEMY_VIEW_HALF_ANGLE_FAR_DEG = 30;
/** Inside this the cone is a full circle, so nobody walks past an enemy's shoulder unseen. */
export const ENEMY_PERIPHERAL_RANGE = 3;
/** Seconds of full-strength sight to go from oblivious to detected. Kept close to the old 0.4 s
 * alert beat plus one line-of-sight check, so close-range detection is not slower than before. */
export const ENEMY_AWARENESS_FILL_TIME = 0.6;
/** Seconds for a full meter to drain once the player is out of sight - a glimpse fades, not
 * instantly. */
export const ENEMY_AWARENESS_DRAIN_TIME = 3;
/** Fill strength at the very edge of detection range (full strength inside half of it): about
 * 1.5 s of sight at range, rewarding distance. */
export const ENEMY_AWARENESS_FAR_FACTOR = 0.4;
/** Extra fill at full sprint (Player.movementBobStrength 1): a sprinting player is seen 50 percent
 * faster than a still one. */
export const ENEMY_AWARENESS_MOVEMENT_BONUS = 0.5;
/** Meter level that counts as suspicious (the 'alert' state: stop and face the threat). */
export const ENEMY_AWARENESS_SUSPICIOUS = 0.35;
/** Seconds without new evidence before the squad's belief about the player's position is dropped;
 * confidence falls linearly to zero over this time. */
export const ENEMY_KNOWLEDGE_DECAY_TIME = 20;
/** Indirect evidence (a gunshot, a hit, a comrade's death) only replaces a belief this much older
 * (or one that has decayed below the new evidence's confidence). A sighting refreshed every line of
 * sight check therefore always wins. */
export const ENEMY_KNOWLEDGE_OVERRIDE_AGE = 2;
export const ENEMY_KNOWLEDGE_GUNSHOT_CONFIDENCE = 0.6;
/** Being hit or seeing a comrade die is a better fix on the player than hearing a shot. */
export const ENEMY_KNOWLEDGE_EVIDENCE_CONFIDENCE = 0.8;
/** Half-life, in seconds, of a player shot's weight in the "fire is coming from over there"
 * estimate, so recent shots dominate. */
export const ENEMY_FIRE_MEMORY_HALF_LIFE = 3;
export const ENEMY_FIRE_MEMORY_SIZE = 8;
/** A comrade's fresh sighting reaches enemies whose distance to the sighted player is within this -
 * "near enough to hear the shout". Keeps a map-wide squad from converging all at once. */
export const ENEMY_KNOWLEDGE_SHARE_RADIUS = 30;
/** How old (seconds) a sighting may be and still be passed on - only live information is relayed. */
export const ENEMY_KNOWLEDGE_SHARE_MAX_AGE = 1;
/** Hearing range per weapon id (see weapons/definitions.ts). The rifle keeps the old single
 * ENEMY_HEARING_RANGE of 40; quieter and louder weapons scale around it. An id missing here falls
 * back to ENEMY_HEARING_RANGE (perception.ts's hearingRangeFor). */
export const ENEMY_WEAPON_LOUDNESS_RANGE: Readonly<Record<string, number>> = {
  pistol: 30,
  rifle: 40,
  shotgun: 50,
  sniper: 60,
  gooseLauncher: 45,
  knife: 0,
  unarmed: 0,
};

/**
 * Enemy AI v2, step 2 (docs/enemy-ai-v2.md): the combat coordinator
 * (entities/enemies/combatCoordinator.ts) hands out roles to the enemies in a fight - shooters
 * (capped by ENEMY_MAX_CONCURRENT_ENGAGERS), a flanker who works round to the player's side, rushers
 * and reserves.
 */
/** A waiting enemy takes a shooter token only if it scores this much higher than the weakest holder
 * (scores run 0 to about 1.3) - stops tokens ping-ponging between two similar spots. */
export const ENEMY_TOKEN_STEAL_MARGIN = 0.25;
/** Seconds a shooter keeps its token before it can be stolen - at least one burst. */
export const ENEMY_TOKEN_MIN_HOLD = 1.5;
/** A shooter is best placed at this fraction of its own ranged range (9.6 m for the Straggler's
 * 16 m): close enough to hit, far enough to not be on top of the player. */
export const ENEMY_SHOOTER_IDEAL_RANGE_FRACTION = 0.6;
/** Extra shooter score for firing from well off the squad's main line - crossfire is what makes a
 * flank dangerous, so an arrived flanker out-scores a second gun on the same line. */
export const ENEMY_FLANK_SHOT_BONUS = 0.3;
export const ENEMY_FLANK_SHOT_MIN_ANGLE_DEG = 60;
/** One flanker at a time reads as a move; a squad this size or larger gets two. */
export const ENEMY_FLANKER_CAP = 1;
export const ENEMY_FLANKER_CAP_LARGE_SQUAD = 2;
export const ENEMY_LARGE_SQUAD_SIZE = 6;
/** A flank needs someone else doing the pinning. */
export const ENEMY_FLANK_MIN_SQUAD = 2;
/** Seconds before a flank that never paid off is abandoned (back to reserve), and before that
 * enemy may be picked to flank again. */
export const ENEMY_FLANK_MAX_DURATION = 10;
export const ENEMY_FLANK_COOLDOWN = 8;
/** How far from the player the flank point sits: this fraction of the flanker's ranged range,
 * clamped to [ENEMY_FLANK_RADIUS_MIN, ENEMY_FLANK_RADIUS_MAX]. */
export const ENEMY_FLANK_RADIUS_FRACTION = 0.6;
export const ENEMY_FLANK_RADIUS_MIN = 8;
export const ENEMY_FLANK_RADIUS_MAX = 16;
/** Close enough to the flank point to stop moving and wait for a shooter token there. */
export const ENEMY_FLANK_ARRIVE_DISTANCE = 2;

/**
 * Enemy AI v2, step 3 (docs/enemy-ai-v2.md): position picking. Enemies in a fight pick a spot
 * behind a trunk, a house corner or a watch tower (entities/enemies/tactics/), confirm it with
 * rays from a shared per-tick budget, and fight from it: shooters hide, then step out to fire;
 * reserves hide and wait.
 */
/** Rays per tick shared by every enemy's position picking (960 a second at 60 ticks). About a
 * third of what twenty patrolling enemies' whiskers already cost; at 50 engaged enemies the refresh
 * cadence stretches instead of the cost growing. */
export const ENEMY_TACTICAL_RAY_BUDGET_PER_TICK = 16;
/** Seconds between one enemy's spot refreshes, when the budget allows. */
export const ENEMY_TACTICAL_REFRESH_INTERVAL = 0.5;
/** Most rays one refresh may spend (two per candidate, so up to four candidates checked). */
export const ENEMY_TACTICAL_MAX_RAYS_PER_JOB = 8;
/** Only obstacles this close to the enemy are considered - farther cover is not reachable in one
 * refresh anyway. */
export const ENEMY_TACTICAL_OBSTACLE_RADIUS = 14;
/** Longest walk to a spot (spots beyond it are not considered), and how much a long walk counts
 * against a spot (a near spot scores up to 60 percent higher than one at the limit). */
export const ENEMY_TACTICAL_MAX_TRAVEL = 14;
export const ENEMY_TACTICAL_TRAVEL_WEIGHT = 0.6;
/** A path to a spot may not pass nearer the player than this. */
export const ENEMY_TACTICAL_THREAT_CLEARANCE = 4;
/** Two enemies never pick spots closer than this - it spreads the squad out. */
export const ENEMY_TACTICAL_CLAIM_RADIUS = 2.5;
/** Nobody stands within this of another shooter's line of fire (capsule width plus margin). */
export const ENEMY_TACTICAL_FIRE_LINE_CLEARANCE = 1.5;
/** An open spot (no obstacle) counts this much against a covered one, so real cover wins before
 * rays are spent but open ground is still used when there is no cover. */
export const ENEMY_TACTICAL_OPEN_PRIOR = 0.55;
/** Rings of open spots around the enemy, and spots per ring. */
export const ENEMY_TACTICAL_OPEN_RADII: readonly number[] = [4, 8, 12];
export const ENEMY_TACTICAL_OPEN_SAMPLES = 8;
/** Ridge Walkers: height above the player (m) at which a spot's high-ground bonus is full. */
export const ENEMY_TACTICAL_HIGH_GROUND_DELTA = 4;
/** Seconds a confirmed spot stays trusted without a fresh check. */
export const ENEMY_TACTICAL_PICK_TTL = 3;
/** Close enough to a spot to count as there. */
export const ENEMY_TACTICAL_ARRIVE_DISTANCE = 1;
/** A spot is logged unreachable (the navmesh trigger, see docs/enemy-ai-v2.md) when the walk takes
 * longer than factor x straight-line time + grace, or stuck detection fires on the way. */
export const ENEMY_TACTICAL_UNREACHABLE_TIME_FACTOR = 2;
export const ENEMY_TACTICAL_UNREACHABLE_GRACE = 1.5;
/** Gap between an enemy's capsule and the obstacle it hides behind. */
export const ENEMY_COVER_MARGIN = 0.3;
/** House cover sits this far along the hidden wall from the corner. */
export const ENEMY_COVER_FACE_INSET = 1.5;
/** A house wall counts as hidden from the player when it faces at least this much away (cosine). */
export const ENEMY_COVER_FACE_MIN_DOT = 0.3;
/** A shooter in cover alternates: this long stepped out firing, then this long hidden. Exposed two
 * thirds of the time, long enough for a Straggler burst, its pause, and the start of the next.
 * First tuned 1.4 s out and 1.5 s hidden, which left shooters firing under half the time - the
 * checkpoint C death-flow runs took 2.3 to 2.9 min against 1.2 to 2.0 before cover - and a smarter
 * enemy should not be an easier one. */
export const ENEMY_PEEK_EXPOSE_TIME = 2;
export const ENEMY_PEEK_HIDE_TIME = 1;
/** An enemy in cover (or flanking) stays in the fight without its own sightline for this long after
 * the squad last saw the player; after that everyone goes to search, so hiding never turns into a
 * stalemate (The Last of Us needed an Approacher role for this). */
export const ENEMY_COMBAT_BLIND_GRACE = 3;
/** Chest height above the capsule centre, for the "is this spot covered" ray. */
export const ENEMY_CHEST_OFFSET_Y = 0.25;
/** Terrain-height memo for candidate spots: 1 m quantisation, bounded. */
export const ENEMY_TERRAIN_HEIGHT_CACHE_QUANTUM = 1;
export const ENEMY_TERRAIN_HEIGHT_CACHE_MAX = 4096;
/** The firing spot must sit between these fractions of the enemy's own ranged range from the
 * player (Straggler 5.6 to 14.4 m, Ridge Walker 10.5 to 27 m), and never nearer than
 * ENEMY_TACTICAL_MIN_RANGE. */
export const ENEMY_TACTICAL_BAND_NEAR_FRACTION = 0.35;
export const ENEMY_TACTICAL_BAND_FAR_FRACTION = 0.9;
export const ENEMY_TACTICAL_MIN_RANGE = 4;
/** Seconds an enemy avoids a spot it found it could not reach. */
export const ENEMY_TACTICAL_AVOID_TIME = 10;
/** Close enough to the peek or cover spot to stop shuffling and act. */
export const ENEMY_PEEK_STEP_TOLERANCE = 0.3;

/**
 * Enemy AI v2, step 4 (docs/enemy-ai-v2.md): the search grid (entities/enemies/searchGrid.ts). When
 * the squad loses the player, cells around the last known position hold the chance the player is
 * there; it spreads outward over time, searchers wipe what they walk near or can see, and they are
 * sent to the likeliest cells in pairs. Replaces "walk to one point and wait 6 s".
 */
/** Cell edge and grid radius: 4 m cells in a disc of radius 5 cells, 44 m across - the leash range. */
export const ENEMY_SEARCH_GRID_CELL = 4;
export const ENEMY_SEARCH_GRID_RADIUS_CELLS = 5;
/** Probability flow to neighbouring cells per second. The spread after t seconds is about
 * sqrt(rate * t / 2) cells, so 2.5 puts the likely area about 2.5 cells (10 m) out after 5 s, roughly
 * a player slipping away at half walking pace (PLAYER_MOVE_SPEED is 5 m/s). The first value, 0.15,
 * spread only about 2.4 m in 5 s, a tenth of what a walking player covers, so one enemy glancing at
 * the spot ended the whole search (found at checkpoint D, docs/enemy-ai-v2.md). */
export const ENEMY_SEARCH_DIFFUSION_RATE = 2.5;
/** Seconds without a sighting before a grid starts, so a player ducking behind a tree for a moment
 * does not trigger a full search. */
export const ENEMY_SEARCH_GRID_START_DELAY = 1;
/** The search ends when four fifths of the probability has been cleared, but not before
 * ENEMY_SEARCH_GRID_MIN_DURATION (a glance at a spot the player plainly left is not a search), and
 * always by ENEMY_SEARCH_GRID_MAX_DURATION. */
export const ENEMY_SEARCH_GRID_GIVE_UP_MASS = 0.2;
export const ENEMY_SEARCH_GRID_MIN_DURATION = 10;
export const ENEMY_SEARCH_GRID_MAX_DURATION = 30;
/** Rays per tick for clearing cells by sight, from what position picking leaves of the budget. */
export const ENEMY_SEARCH_CLEAR_RAYS_PER_TICK = 4;
/** A searcher clears cells it can see within this range and half-angle of its facing... */
export const ENEMY_SEARCH_CLEAR_RANGE = 12;
export const ENEMY_SEARCH_CLEAR_HALF_ANGLE_DEG = 60;
/** ...and any cell it walks within this of, no ray needed. */
export const ENEMY_SEARCH_PROXIMITY_CLEAR = 2;
/** Seconds between re-sending searchers to the likeliest cells. */
export const ENEMY_SEARCH_ASSIGN_INTERVAL = 0.5;
/** Height above ground of the point checked in each cell - roughly a player's chest. */
export const ENEMY_SEARCH_CELL_CHECK_HEIGHT = 1;

/**
 * Enemy AI v2, step 5 (docs/enemy-ai-v2.md): readable enemies - short synthesised callouts
 * (entities/enemies/calloutDirector.ts decides which are heard), a glint before a Ridge Walker's
 * long shot, and a stagger on heavy hits.
 */
/** One voiced callout of each kind at most this often, and any two at least this far apart - a
 * squad, not a chorus. */
export const ENEMY_CALLOUT_KIND_COOLDOWN = 4;
export const ENEMY_CALLOUT_GLOBAL_COOLDOWN = 1.2;
/** Callouts from farther than this are not heard. */
export const ENEMY_CALLOUT_AUDIBLE_RANGE = 45;
/** Seconds of glint before a telegraphed shot, and how far away a Ridge Walker must be for its shot
 * to be telegraphed - close up, the player can see it aiming anyway. */
export const ENEMY_GLINT_LEAD_TIME = 0.6;
export const ENEMY_GLINT_MIN_DISTANCE = 15;
/** A hit of at least this much damage (after the headshot multiplier) staggers an enemy for
 * ENEMY_STAGGER_DURATION: it neither moves nor fires. Light hits only reset its aim, as before. */
export const ENEMY_STAGGER_DAMAGE_THRESHOLD = 25;
export const ENEMY_STAGGER_DURATION = 0.5;
/** How far a staggered enemy tips back, in radians, at the moment of the hit. */
export const ENEMY_STAGGER_LURCH_RAD = 0.35;

/**
 * Enemy AI v2, step 6 (docs/enemy-ai-v2.md): the pacing director behind the opt-in "Director" solo
 * mode (entities/enemies/director/), Left 4 Dead's build-up, peak, fade and relax cycle.
 */
/** Enemies at the start of a Director match, with no practice targets; the director sends the rest. */
export const ENEMY_DIRECTOR_INITIAL_COUNT = 2;
/** Intensity (0 to 1) per point of damage the player takes, and per enemy they kill within
 * ENEMY_DIRECTOR_KILL_RADIUS: 50 HP lost, or 7 close kills, is a full peak. */
export const ENEMY_DIRECTOR_INTENSITY_PER_DAMAGE = 0.02;
export const ENEMY_DIRECTOR_INTENSITY_PER_KILL = 0.15;
export const ENEMY_DIRECTOR_KILL_RADIUS = 20;
/** Intensity drained per second, only while no enemy is chasing the player. */
export const ENEMY_DIRECTOR_DECAY_PER_SECOND = 0.08;
/** Build-up turns to peak at this intensity; peak holds a random 3 to 5 s; fade ends once intensity
 * is below ENEMY_DIRECTOR_FADE_EXIT; relax lasts a random 30 to 45 s. */
export const ENEMY_DIRECTOR_PEAK_THRESHOLD = 1;
export const ENEMY_DIRECTOR_PEAK_MIN = 3;
export const ENEMY_DIRECTOR_PEAK_MAX = 5;
export const ENEMY_DIRECTOR_FADE_EXIT = 0.3;
export const ENEMY_DIRECTOR_RELAX_MIN = 30;
export const ENEMY_DIRECTOR_RELAX_MAX = 45;
/** Waves of two every 8 s during build-up, never more than 8 enemies alive. */
export const ENEMY_DIRECTOR_MAX_ALIVE = 8;
export const ENEMY_DIRECTOR_WAVE_SIZE = 2;
export const ENEMY_DIRECTOR_WAVE_INTERVAL = 8;
/** Seconds before a wave that found nowhere hidden to come in tries again. */
export const ENEMY_DIRECTOR_RETRY_DELAY = 1;
/** Share of waves that are all Rush Jobs, and share that bring a Ridge Walker; the rest mix. */
export const ENEMY_DIRECTOR_RUSHER_WAVE_SHARE = 0.2;
export const ENEMY_DIRECTOR_SNIPER_WAVE_SHARE = 0.2;
/** Where reinforcements come in: 18 to 30 m out, within 100 degrees of straight behind the player,
 * 6 points drawn and at most 6 sight checks a wave, never closer than 3 m to each other. */
export const ENEMY_DIRECTOR_SPAWN_MIN_RADIUS = 18;
export const ENEMY_DIRECTOR_SPAWN_MAX_RADIUS = 30;
export const ENEMY_DIRECTOR_SPAWN_BEHIND_HALF_ANGLE_DEG = 100;
export const ENEMY_DIRECTOR_SPAWN_CANDIDATES = 6;
export const ENEMY_DIRECTOR_SPAWN_RAYS = 6;
export const ENEMY_DIRECTOR_SPAWN_MIN_SPACING = 3;
/** Added to half the camera's horizontal view: a reinforcement never comes in this close to the
 * edge of the screen either. */
export const ENEMY_DIRECTOR_SPAWN_VIEW_MARGIN_DEG = 15;
export const ENEMY_RANGED_TRACER_COLOR = 0xff5a3c;
/** Distance attenuation for enemy gunshot audio: full volume inside FULL_VOLUME_RANGE, then a
 * linear fade down to MIN_VOLUME at AUDIBLE_RANGE (never fully silent - an inaudible shot that
 * still damages would read as unfair, the opposite of what the tracer/Phase C fairness work is
 * for). Uniform full-volume gunshots undermined that same readability goal from the other
 * direction: a shot from 30 units sounded identical to one at point-blank. No HRTF/panning -
 * plain gain scaling, which is the cheap 90% of the effect. */
export const ENEMY_GUNSHOT_FULL_VOLUME_RANGE = 10;
export const ENEMY_GUNSHOT_AUDIBLE_RANGE = 60;
export const ENEMY_GUNSHOT_MIN_VOLUME = 0.15;

/** Same falloff shape as the ENEMY_GUNSHOT_* trio above, but deliberately separate constants for
 * multiplayer opponent gunshots specifically (see Game.ts's multiplayerGunshotVolume) - per user
 * report, the enemy full-volume inner radius (10 units) is tiny next to real PvP engagement
 * distances (MULTIPLAYER_SPAWN_RADIUS=35, so baseline spawn separation alone is often 35-70
 * units), so most real close-quarters PvP fights already sat in the linear falloff zone and read
 * as "too soft" even at what a player would call close range. Widening the ENEMY_* constants in
 * place would fix this but also change single-player enemy/goose-explosion audio, which nobody
 * asked for - hence a second, independent set instead of touching the shared one. */
export const MULTIPLAYER_GUNSHOT_FULL_VOLUME_RANGE = 25;
export const MULTIPLAYER_GUNSHOT_AUDIBLE_RANGE = 90;
export const MULTIPLAYER_GUNSHOT_MIN_VOLUME = 0.15;

/**
 * Goal-directed patrol (enemy AI overhaul, Phase A - replaces the old tight-radius "wander," which
 * picked random points within only 6 units of spawn every 3s and read as running in small circles
 * rather than actually going anywhere). Enemies now patrol real destinations across a much wider
 * area, biased toward real zone content (towns/forests via ZoneMap) rather than pure noise, with
 * whisker obstacle avoidance and stuck-detection reroute standing in for full pathfinding - no
 * navmesh in this codebase, so an enemy boxed into a concave corner reroutes rather than freezing.
 */
export const ENEMY_ROAM_RADIUS = 55;
/** 60% of the old global chase speed (2.5) - patrol pace is deliberately archetype-independent
 * (an archetype reveals itself in combat, not while wandering at 50m - see archetypes.ts). */
export const ENEMY_PATROL_SPEED = 1.5;
export const ENEMY_PATROL_STOP_DISTANCE = 1.5;
/** Forces a fresh destination even if the current one was never reached, so patrols don't fixate
 * on an unreachable point forever - randomized per-pick within this range. */
export const ENEMY_PATROL_REPATH_MIN = 8;
export const ENEMY_PATROL_REPATH_MAX = 16;
/** Probability of preferring a real zone (town/forest) among the sampled candidate destinations,
 * over a plain random point - see enemySteering.ts's pickDestination. */
export const ENEMY_PATROL_POI_BIAS = 0.6;
export const ENEMY_PATROL_CANDIDATE_COUNT = 6;
/** Whisker obstacle avoidance: three short probe rays (center, +/- angle) ahead of the movement
 * direction, steering toward whichever is clearest - handles convex obstacles (buildings, rocks,
 * tree trunks) without needing real pathfinding. */
export const ENEMY_AVOID_PROBE_LENGTH = ENEMY_RADIUS + 1.5;
export const ENEMY_AVOID_ANGLE_DEG = 40;
/** If an enemy tries to move but covers less than this distance over this time window, it's
 * considered stuck (wedged against a concave obstacle whisker-avoidance can't solve) and picks a
 * fresh destination rather than freezing in place indefinitely. */
export const ENEMY_STUCK_WINDOW = 2;
export const ENEMY_STUCK_EPSILON = 0.5;

/**
 * Goose Dash Buster: a comedic wandering NPC built entirely from THREE primitives (no asset file -
 * matches this project's own precedent for crates/ladders/rocks/the knife weapon). Takes exactly
 * GOOSE_HITS_TO_KILL bullet hits regardless of weapon damage (see entities/Goose.ts's takeDamage,
 * a deliberate divergence from the amount-based Damageable contract Enemy/Target use), then
 * explodes with a distance-based damage falloff (see combat/explosion.ts). Not chunk-tied - like
 * enemies/targets, a goose persists for the whole match once placed via EntityManager's sibling,
 * GooseManager.
 */
export const GOOSE_HITS_TO_KILL = 2;
export const GOOSE_RADIUS = 0.35;
export const GOOSE_HEIGHT = 0.55;
/** Slower than ENEMY_PATROL_SPEED - a goose ambling around should read as harmless until it isn't. */
export const GOOSE_WANDER_SPEED = 1;
export const GOOSE_ROAM_RADIUS = 30;
export const GOOSE_PATROL_STOP_DISTANCE = 1;
export const GOOSE_PATROL_REPATH_MIN = 5;
export const GOOSE_PATROL_REPATH_MAX = 12;
/** How many geese are scattered around the map the instant a match starts. */
export const GOOSE_SPAWN_COUNT_INITIAL = 3;
/** A new goose spawns every time a player dies (any player in multiplayer, the local player in
 * single-player - see Game.ts's deathHandled/playerDied hooks), capped here so a long match doesn't
 * accumulate an unbounded flock. */
export const GOOSE_MAX_CONCURRENT = 8;
/** A freshly spawned goose must land at least this far from the player who triggered the spawn. */
export const GOOSE_SPAWN_MIN_DISTANCE_FROM_PLAYER = 10;

export type GooseExplosionDifficulty = 'easy' | 'normal' | 'extreme' | 'nuke';
/** Host-chosen in multiplayer (see CreateRoomScreen), fixed at 'normal' in single-player (no host
 * to choose it there) - see combat/explosion.ts's computeExplosionDamage. maxDamage is what a
 * player standing exactly at the goose's position would take; it falls off linearly to 0 at
 * `radius`. Rebalanced (all non-nuke tiers bumped ~15-20%) alongside adding 'nuke' itself, per
 * user request. */
export const GOOSE_EXPLOSION_PRESETS: Record<GooseExplosionDifficulty, { radius: number; maxDamage: number }> = {
  easy: { radius: 4, maxDamage: 40 },
  normal: { radius: 7, maxDamage: 85 },
  // Exceeds PLAYER_HEALTH at point-blank, deliberately - "massive," per the original request.
  extreme: { radius: 13, maxDamage: 150 },
  // "Massive explosion... instant death" per user request - computeExplosionDamage's linear
  // falloff means damage only reaches exactly 0 right at the radius boundary, so a radius this
  // large combined with a maxDamage this far past PLAYER_HEALTH reads as "anyone caught in the
  // blast dies" without needing a separate non-distance-based instant-kill code path.
  nuke: { radius: 45, maxDamage: 500 },
};
/** Peak knockback speed (m/s) a player standing exactly at the goose's position would receive from
 * an explosion, falling off linearly to 0 at the same `radius` as damage above (see
 * computeKnockbackStrength in combat/explosion.ts) - paired per-tier so Nuke sends players flying
 * much further than Easy, same spirit as the damage rebalance already applied per tier. */
export const GOOSE_EXPLOSION_KNOCKBACK_STRENGTH: Record<GooseExplosionDifficulty, number> = {
  easy: 4,
  normal: 8,
  extreme: 14,
  nuke: 26,
};
export const DEFAULT_GOOSE_EXPLOSION_DIFFICULTY: GooseExplosionDifficulty = 'normal';
/** Shared ordering/labels for every difficulty selector (single-player Match Setup, multiplayer
 * Create Room, multiplayer rematch settings) so the three don't each invent their own list. */
export const GOOSE_EXPLOSION_DIFFICULTIES: readonly GooseExplosionDifficulty[] = ['easy', 'normal', 'extreme', 'nuke'];
export const GOOSE_EXPLOSION_DIFFICULTY_LABELS: Record<GooseExplosionDifficulty, string> = {
  easy: 'Easy',
  normal: 'Normal',
  extreme: 'Extreme',
  nuke: 'Nuke',
};
/** Host-only broadcast rate for a live goose's wander position (see GooseManager.ts) - much
 * coarser than PLAYER_SNAPSHOT_SEND_INTERVAL since a goose's exact position is cosmetic, not
 * something a shot needs pixel-perfect freshness against the way player hit registration does. */
export const GOOSE_SNAPSHOT_SEND_INTERVAL = 1 / 6;

/** Goose Toss mode (multiplayer only, see core/gameModes.ts) - players carry no weapons, only
 * geese. A much bigger, constantly-replenished flock than the normal spawn-on-death trigger
 * (GOOSE_MAX_CONCURRENT/GOOSE_SPAWN_COUNT_INITIAL), since throwing geese at each other IS the
 * entire game here. */
export const GOOSE_TOSS_MAX_CONCURRENT = 25;
/** Host-only: one new goose lands somewhere on the map at this interval while under the cap above,
 * independent of player deaths - see GooseManager.spawnRandomOnMap. */
export const GOOSE_TOSS_SPAWN_INTERVAL_SECONDS = 2;
/** How close a player must be to a live wandering goose to pick it up with the interact key. */
export const GOOSE_PICKUP_RADIUS = 2.5;
/** A thrown goose's initial speed (m/s) along the thrower's exact aim direction - see
 * ThrownGoose.ts. Deliberately a slow, real ballistic arc (falls under GRAVITY like anything else
 * in this world) rather than a fast, flat, hitscan-like throw: a slower projectile is easier to
 * read and lead than an instant-hit shot, and since it explodes on ANY contact - the ground, not
 * just a direct player hit - a thrown goose that lands a few meters short or long of its target
 * still deals real splash damage via computeExplosionDamage's falloff. That forgiveness (a close
 * miss still hurts) is what actually keeps this mode approachable, more than the exact speed
 * number - per user request, this "mustn't be super difficult." */
export const GOOSE_THROW_SPEED = 20;
/** Goose Toss's own explosion size, deliberately NOT the host-configurable GOOSE_EXPLOSION_PRESETS
 * (per explicit user request - the goose-explosion-difficulty selector still shows in the host
 * settings for other modes, but this mode ignores it entirely) - roughly matches the 'extreme'
 * preset, a serious but not always-instant blast. */
export const GOOSE_TOSS_EXPLOSION_RADIUS = 9;
export const GOOSE_TOSS_EXPLOSION_MAX_DAMAGE = 140;
/** Matches the 'extreme' tier's knockback strength, same reasoning as the radius/damage comment
 * above (roughly matches 'extreme' but is its own fixed constant, ignoring the host's difficulty
 * selector entirely). */
export const GOOSE_TOSS_EXPLOSION_KNOCKBACK_STRENGTH = 14;
/** Safety net for a client that never receives the thrower's gooseThrowExploded broadcast (a
 * dropped message, a relay-hop race) - removes an orphaned cosmetic ThrownGoose after this many
 * seconds regardless, rather than leaving it flying forever. Comfortably longer than any real
 * flight time at GOOSE_THROW_SPEED. */
export const GOOSE_THROW_MAX_LIFETIME_SECONDS = 5;

/** King of the Hill mode (multiplayer only, see core/gameModes.ts) - a single golden goose spawned
 * at the map center (the same point pickMultiplayerSpawnPoints already rings every player equally
 * around, so "spawn equidistant from the goose" needs no new placement math). Reuses
 * GOOSE_PICKUP_RADIUS for the pickup check. */
export const KOTH_POINTS_TO_WIN = 90;
/** Whole seconds of continuous carry time before the carrier's own score increments by 1 (see
 * Game.ts's updateGoldenGoose) - "1 point per second held," per explicit user request. */
export const KOTH_POINT_INTERVAL_SECONDS = 1;

/** Goose Horde: wave-survival mode, single-player (PlaySetupModal toggle) and multiplayer
 * (co-op, see core/gameModes.ts's 'gooseHorde'). 10 waves, each escalating count/speed/aggression -
 * see docs/CHANGELOG.md for the full per-wave design table and rationale. `jumperChance`/
 * `flyerChance` are the probability (0-1) each individual spawn in that wave rolls as that
 * behavior flavor instead of a plain walker - see entities/HordeGoose.ts. */
export interface HordeWaveSpec {
  readonly count: number;
  readonly speedMultiplier: number;
  readonly jumperChance: number;
  readonly flyerChance: number;
}
export const HORDE_WAVE_TABLE: readonly HordeWaveSpec[] = [
  { count: 5, speedMultiplier: 1.0, jumperChance: 0, flyerChance: 0 },
  { count: 7, speedMultiplier: 1.1, jumperChance: 0, flyerChance: 0 },
  { count: 9, speedMultiplier: 1.2, jumperChance: 0.2, flyerChance: 0 },
  { count: 11, speedMultiplier: 1.3, jumperChance: 0.3, flyerChance: 0 },
  { count: 13, speedMultiplier: 1.4, jumperChance: 0.4, flyerChance: 0.1 },
  { count: 15, speedMultiplier: 1.5, jumperChance: 0.4, flyerChance: 0.2 },
  { count: 18, speedMultiplier: 1.6, jumperChance: 0.45, flyerChance: 0.25 },
  { count: 21, speedMultiplier: 1.7, jumperChance: 0.5, flyerChance: 0.3 },
  { count: 25, speedMultiplier: 1.85, jumperChance: 0.55, flyerChance: 0.35 },
  { count: 30, speedMultiplier: 2.0, jumperChance: 0.6, flyerChance: 0.4 },
];
/** Multiplayer's own, harder, 15-wave table (per explicit user request: "much more difficult...
 * and up to 15 waves") - a real co-op squad can bring more sustained firepower to bear than a
 * single player, so this isn't just the single-player table extended, it's steeper at every
 * comparable wave (higher starting count, faster ramp, jumpers/flyers introduced a wave or two
 * earlier) and keeps climbing for 5 more waves past where single-player's finale sits. */
export const HORDE_WAVE_TABLE_MULTIPLAYER: readonly HordeWaveSpec[] = [
  { count: 8, speedMultiplier: 1.1, jumperChance: 0, flyerChance: 0 },
  { count: 11, speedMultiplier: 1.2, jumperChance: 0.1, flyerChance: 0 },
  { count: 14, speedMultiplier: 1.3, jumperChance: 0.25, flyerChance: 0 },
  { count: 17, speedMultiplier: 1.4, jumperChance: 0.35, flyerChance: 0.1 },
  { count: 20, speedMultiplier: 1.5, jumperChance: 0.4, flyerChance: 0.15 },
  { count: 24, speedMultiplier: 1.6, jumperChance: 0.45, flyerChance: 0.2 },
  { count: 28, speedMultiplier: 1.7, jumperChance: 0.5, flyerChance: 0.25 },
  { count: 32, speedMultiplier: 1.8, jumperChance: 0.5, flyerChance: 0.3 },
  { count: 36, speedMultiplier: 1.9, jumperChance: 0.55, flyerChance: 0.35 },
  { count: 40, speedMultiplier: 2.0, jumperChance: 0.6, flyerChance: 0.4 },
  { count: 45, speedMultiplier: 2.1, jumperChance: 0.6, flyerChance: 0.45 },
  { count: 50, speedMultiplier: 2.2, jumperChance: 0.65, flyerChance: 0.5 },
  { count: 55, speedMultiplier: 2.3, jumperChance: 0.65, flyerChance: 0.55 },
  { count: 60, speedMultiplier: 2.4, jumperChance: 0.7, flyerChance: 0.55 },
  { count: 70, speedMultiplier: 2.5, jumperChance: 0.75, flyerChance: 0.6 },
];
/** Caps how many horde geese exist on the map at once regardless of a wave's total `count` - my
 * own addition (not explicitly requested), necessary so wave 10's "A LOT" doesn't tank frame rate.
 * Remaining spawns for a wave queue up and trickle in as earlier ones die/explode, so pressure
 * stays constant rather than dumping the full count on the map at once. Logged via a toast, never
 * a silent cap.
 *
 * Scaled per-wave (M5, 2026-07-10 review), not a flat number - a flat 18 meant every wave past the
 * point where `count` first exceeded it (wave 7 in both tables) presented *identical* on-screen
 * density, so "harder" late waves were only longer and marginally faster, never more intense. Now
 * `min(HORDE_MAX_CONCURRENT_CEILING, HORDE_MAX_CONCURRENT_BASE + waveIndex)` (see
 * HordeGooseManager.beginWave) - wave 1 still starts calm and the ceiling still protects frame rate,
 * but the back half of the table actually gets visibly denser wave over wave instead of flat. */
export const HORDE_MAX_CONCURRENT_BASE = 12;
export const HORDE_MAX_CONCURRENT_CEILING = 24;
/** Breather between waves, long enough to read the "Wave N incoming" toast and catch a breath. */
export const HORDE_WAVE_INTERMISSION_SECONDS = 4;
/** Base chase speed (m/s) before a wave's speedMultiplier - noticeably faster than the passive
 * GOOSE_WANDER_SPEED (1) since a horde goose is actively hunting, not ambling; at wave 10's 2.0x
 * multiplier this reaches player sprint speed (PLAYER_MOVE_SPEED * SPRINT_MULTIPLIER = 8),
 * deliberately climactic for the finale. */
export const HORDE_GOOSE_BASE_SPEED = 4;
/** Distance at which a horde goose counts as having "reached" the player and explodes. */
export const HORDE_GOOSE_CONTACT_RADIUS = 1.2;
/** Jumper flavor: within this range of the player, a jumper does a brief forward speed burst
 * (see HORDE_JUMPER_BURST_MULTIPLIER/SECONDS) instead of its normal chase speed - reads as a
 * "suicide rush" tell the player can watch for. */
export const HORDE_JUMPER_TRIGGER_RADIUS = 6;
export const HORDE_JUMPER_BURST_MULTIPLIER = 2.5;
export const HORDE_JUMPER_BURST_SECONDS = 0.4;
/** Flyer flavor: spawns airborne at this height above its target point and dives straight down
 * toward the player over HORDE_FLYER_DESCENT_SECONDS, overriding the normal ground-snap until it
 * lands/explodes - see HordeGoose.ts. */
export const HORDE_FLYER_SPAWN_HEIGHT = 25;
export const HORDE_FLYER_DESCENT_SECONDS = 1.5;
/** A horde goose dies in exactly one hit from any weapon (unlike the normal wandering goose's
 * GOOSE_HITS_TO_KILL=2) - "shoot or dodge" needs to feel decisive under wave-10 pressure, not add
 * a second layer of bullet-sponge on top of rising count/speed. A one-hit-killed goose just falls
 * over (no explosion) - only a goose that actually reaches the player explodes. */
export const HORDE_GOOSE_EXPLOSION_RADIUS = 5;
export const HORDE_GOOSE_EXPLOSION_MAX_DAMAGE = 60;
export const HORDE_GOOSE_KNOCKBACK_STRENGTH = 10;
/** New horde spawns land on a ring at this radius around the map center, outside the player's
 * immediate view but well within chase range. */
export const HORDE_GOOSE_SPAWN_RADIUS = 30;

/** Bonus "golden goose" - single-player and multiplayer alike (every mode except Goose Toss, whose
 * unarmed loadout has no way to shoot it at all - see Game.ts's isBonusGooseEnabled check). Exactly
 * one lives on the map at a time: spawns at a random point after a random delay, and once it's
 * killed (still GOOSE_HITS_TO_KILL hits, like any wandering goose - no explosion/damage on death,
 * this is a reward not a hazard), a fresh random delay starts before the next one appears. Whoever
 * lands the FINAL hit is rewarded with the Goose Launcher weapon (see the GOOSE_LAUNCHER_* block
 * below and weapons/definitions.ts). */
export const BONUS_GOOSE_MIN_RESPAWN_DELAY_SECONDS = 45;
export const BONUS_GOOSE_MAX_RESPAWN_DELAY_SECONDS = 120;
/** Random spawn point is drawn uniformly within this radius of the map center - deliberately not
 * tied to any player's current position, so it can turn up anywhere already-explored or not. */
export const BONUS_GOOSE_SPAWN_RADIUS = 55;
export const BONUS_GOOSE_TINT = 0xffd54a;

/** Goose Launcher - the reward for landing the killing hit on the bonus goose above. Exactly 4
 * shots and no reload (`disableReload` on its WeaponDefinition - see weapons/Weapon.ts); once
 * empty, WeaponManager automatically reverts to whatever weapon was equipped before the goose was
 * killed (see WeaponManager.grantBonusWeapon). Each shot is a real ballistic projectile (reusing
 * ThrownGoose, tagged with a 'gooseLauncher' source - see Game.ts's updateThrownGeese), not instant
 * hitscan like every other gun - WeaponDefinition.isProjectile routes WeaponManager.fireShot() into
 * a projectile spawn instead of the normal per-pellet hitscan loop. Deliberately powerful (a near-
 * guaranteed kill within its blast radius) since it's a rare, hard-earned, strictly limited reward,
 * not a weapon anyone starts a match with. */
export const GOOSE_LAUNCHER_PROJECTILE_SPEED = 24;
export const GOOSE_LAUNCHER_EXPLOSION_RADIUS = 6;
export const GOOSE_LAUNCHER_EXPLOSION_MAX_DAMAGE = 110;
export const GOOSE_LAUNCHER_EXPLOSION_KNOCKBACK_STRENGTH = 18;

/** Multiplayer Goose Horde's limited-lives rule (per explicit user request): each player gets this
 * many respawns beyond their initial life (so 2 respawns = 3 lives total) before they're
 * permanently eliminated for the rest of the run. Once every currently-connected player has been
 * eliminated, the whole co-op run ends in a loss - see Game.ts's hordeRespawnsRemaining/
 * hordeEliminatedSlots and the 'hordePlayerEliminated' message in protocol.ts. */
export const HORDE_MAX_RESPAWNS = 2;

/** Multiplayer Goose Horde's ammo economy (per explicit user request: "set limited mags and ammo
 * to guns for this mode"). Unlike every other mode (unlimited reloads), each weapon starts with a
 * finite reserve beyond its first magazine - reload draws from this reserve instead of refilling
 * for free (see weapons/Weapon.ts's optional reserveAmmo). Once both the magazine and reserve are
 * empty, the only way to keep fighting with that weapon is an ammo drop. */
export const HORDE_STARTING_RESERVE_MAGAZINES = 3;
/** How much reserve ammo one ammo-drop pickup grants the weapon the player is currently holding
 * (per explicit user request: "refills your ammo for the gun a player is holding," not every
 * weapon they're carrying) - expressed as a multiple of that weapon's own magazine size, so a
 * pickup feels proportionally as generous for a 30-round rifle as a 5-round sniper. */
export const HORDE_AMMO_DROP_REFILL_MAGAZINES = 2;
/** Never more than this many ammo crates live on the map at once. */
export const HORDE_AMMO_DROP_MAX_CONCURRENT = 3;
/** Slow-ish spawn cadence (per explicit user request) - a fresh roll for the next drop's delay
 * happens only once the concurrent count is back under the cap. */
export const HORDE_AMMO_DROP_MIN_SPAWN_DELAY_SECONDS = 30;
export const HORDE_AMMO_DROP_MAX_SPAWN_DELAY_SECONDS = 60;
/** "Not far from players" (per explicit user request) - a drop spawns within this radius of a
 * randomly chosen currently-connected player's current position, not anywhere on the map. */
export const HORDE_AMMO_DROP_SPAWN_RADIUS = 18;
/** How close a player must walk to auto-collect a drop - no interact key needed, just proximity,
 * matching a typical FPS ammo crate rather than requiring a deliberate pickup action. */
export const HORDE_AMMO_DROP_PICKUP_RADIUS = 1.8;

export const PLAYER_HEALTH = 100;

export const HIT_MARKER_DURATION = 0.2;

/** How long the screen-edge red vignette (DamageVignette) stays visible after the player takes
 * damage before fading out - a faded, temporary "you got hit" acknowledgment alongside the health
 * bar, not a replacement for it. Longer than HIT_MARKER_DURATION (that's confirming *you* landed a
 * hit on something else) since this needs to be noticeable enough to register mid-fight rather
 * than flash past in a fifth of a second. */
export const DAMAGE_VIGNETTE_DURATION = 0.4;

/** World units already read as meters throughout this codebase (PLAYER_HEIGHT = 1.8, etc.) - a
 * player hit landing at or beyond this distance gets a quick on-screen callout (see
 * ui/longShotCallout.ts) acknowledging the shot, since a hit that far away is easy to miss amid
 * everything else on screen. */
export const LONG_SHOT_DISTANCE = 50;

/** Visual-only travel speed for tracers - the hit itself is already resolved instantly via raycast.
 * With TRACER_LENGTH it gives an unbroken streak at 60 fps (about 4.3 m a frame against a 4.5 m
 * streak); the old 0.6 m at 150 m/s jumped 2.5 m a frame and read as dots. */
export const TRACER_SPEED = 260;
/** Streak length in metres, head to burnt-out tail (combat/Tracers.ts). */
export const TRACER_LENGTH = 4.5;
/** The player's own tracer glow: warm amber around a white core, the dusk palette's accent light. */
export const TRACER_COLOR = 0xffb45a;

export const TERRAIN_CHUNK_SIZE = 100;
export const TERRAIN_RESOLUTION = 64;

/** World units covered by one tile of the ground texture. Chosen so TERRAIN_CHUNK_SIZE divides
 * evenly into it - an integer repeat count keeps the tiling phase-aligned across chunk seams. */
export const GROUND_TEXTURE_WORLD_SIZE = 10;
export const GROUND_TEXTURE_REPEAT = TERRAIN_CHUNK_SIZE / GROUND_TEXTURE_WORLD_SIZE;
export const GROUND_TEXTURE_URL = '/assets/textures/terrain/aerial_grass_rock_diff_1k.jpg';
/** Same Poly Haven "Aerial Grass Rock" set as GROUND_TEXTURE_URL (VISUAL_REALISM.md §2) - a
 * diffuse-only material renders like paper under grazing light; these give the terrain (the
 * biggest pixel area in every frame) actual surface relief and non-uniform roughness. */
export const GROUND_NORMAL_TEXTURE_URL = '/assets/textures/terrain/aerial_grass_rock_nor_gl_1k.jpg';
export const GROUND_ROUGHNESS_TEXTURE_URL = '/assets/textures/terrain/aerial_grass_rock_rough_1k.jpg';
export const GROUND_AO_TEXTURE_URL = '/assets/textures/terrain/aerial_grass_rock_ao_1k.jpg';
export const TERRAIN_OCTAVES = 4;
export const TERRAIN_BASE_FREQUENCY = 0.015;
export const TERRAIN_LACUNARITY = 2.0;
export const TERRAIN_PERSISTENCE = 0.5;
export const TERRAIN_AMPLITUDE = 8;

export const VIEW_RADIUS_CHUNKS = 2;
export const UNLOAD_RADIUS_CHUNKS = 3;
export const MAX_CHUNK_GENERATIONS_PER_TICK = 2;

/** World is bounded (arena-style), not infinite — see WORLD_PLAN.md §2. Chunk coordinates outside
 * [WORLD_MIN_CHUNK, WORLD_MAX_CHUNK] on either axis are never generated. Shrunk from 12 to 8, then
 * later to 6, per user feedback that the world still felt too large to reach the edges of.
 *
 * MUST STAY EVEN. Briefly set to 7 and shipped, then reverted after a real bug: with chunks
 * indexed as integers around the origin (WORLD_MIN_CHUNK = -floor(n/2), WORLD_MAX_CHUNK =
 * WORLD_MIN_CHUNK + n - 1), an *odd* n generates an asymmetric span - 7 generated x/z from -300 to
 * +400, not a symmetric +/-350, because there's no integer chunk boundary that sits exactly at the
 * true center for an odd count. WORLD_BOUNDARY_RADIUS/WORLD_HARD_CLAMP_RADIUS/
 * WORLD_SOFT_PUSH_START_RADIUS below all assume symmetric coverage in every direction, so a player
 * pushed toward the boundary on the shorted side got clamped to a radius that terrain was never
 * generated to reach at all, and fell through into empty space - caught by
 * e2e/world-bounds.spec.ts sprinting a player toward the edge, not found until a full-suite run
 * happened to include that file. Even n always spans symmetrically (confirmed: 8 -> +/-400 exactly,
 * 6 -> +/-300 exactly), so this must never be set to an odd number again without also reworking the
 * chunk-index-to-world-position mapping itself (a bigger structural change, not a constant tweak).
 *
 * This constant also sets a hard ceiling on how large any flat/forest zone can ever be (see
 * isSiteClear/maxClearRadius in ZoneMap.ts): a site's disc must clear both the world-edge mountain
 * ramp and the spawn/combat ring, and shrinking the world narrows that clearance for every site,
 * everywhere, simultaneously. At 6 chunks with the original zone radii (65-90 flat, 78-92 forest),
 * even the best-positioned site in the entire world couldn't clear enough room - isSiteClear would
 * reject every candidate and towns/forests would stop spawning entirely, not just shrink. Per user
 * decision, the fix leans on the smallest safe ZONE_EDGE_MARGIN (5, down from the original 30)
 * rather than a bigger radius cut, minimizing how much smaller towns/forests actually get - see
 * FLAT_ZONE_RADIUS_MAX/FOREST_ZONE_RADIUS_MAX for the resulting range. Changing WORLD_SIZE_CHUNKS
 * again means re-deriving that ceiling and re-tuning those ranges together, not just this number.
 *
 * Shrunk again, 6 -> 4, per user request for a tighter 1v1 arena. This time the ceiling math
 * (ZONE_EDGE_MARGIN already at its established safe floor of 5) only allows ~17.5-unit zones, a
 * real ~70% cut from the 6-chunk world's 60/65 - flagged to the user with the actual numbers before
 * proceeding (unlike the WORLD_SIZE_CHUNKS=7 mistake, which shipped before its consequence was
 * understood). User chose to accept the smaller zones now rather than block the shrink on a bigger
 * rework. Zones are circular discs by construction (isSiteClear tests a fixed radius against both
 * boundaries) - the user separately suggested growing zones organically outward from a point until
 * hitting a boundary instead, which could pack more usable area into the same tight space than a
 * circle constrained to fit the tightest dimension. Noted as a real, promising idea but out of
 * scope for this pass: it would touch terrain flattening's falloff too, not just placement, so it's
 * a system rework, not a constant tweak - worth a dedicated pass of its own later. */
export const WORLD_SIZE_CHUNKS = 4;
export const WORLD_MIN_CHUNK = -Math.floor(WORLD_SIZE_CHUNKS / 2);
export const WORLD_MAX_CHUNK = WORLD_MIN_CHUNK + WORLD_SIZE_CHUNKS - 1;

/** Edge treatment: terrain rises into a mountain ring as distance from world origin approaches the
 * boundary, so the bound reads as an intentional landform rather than a wall. Radius is the
 * distance from origin to the nearest edge midpoint of the bounded square. */
export const WORLD_BOUNDARY_RADIUS = (WORLD_SIZE_CHUNKS / 2) * TERRAIN_CHUNK_SIZE;
export const WORLD_EDGE_RAMP_START = WORLD_BOUNDARY_RADIUS - 130;
export const WORLD_EDGE_MOUNTAIN_HEIGHT = 45;
/** Low frequency (broad, ~1000-unit wavelength) so the ridge only varies gently across the ~130-unit
 * ramp band - a higher frequency here was verified (see NOTES.md-style empirical check) to fragment
 * the ramp into small alternating steep/shallow patches that wedged the character controller in a
 * slow autostep "climbing in place" loop instead of blocking or sliding cleanly. */
export const TERRAIN_EDGE_RIDGE_FREQUENCY = 0.006;
export const TERRAIN_EDGE_RIDGE_WEIGHT = 0.1;

/**
 * Safety net (WORLD_PLAN.md §2): even a smooth mountain ring will eventually exceed the character
 * controller's max slope-climb angle, which blocks forward progress but doesn't guarantee the
 * player ends up short of WORLD_BOUNDARY_RADIUS. A gentle inward push begins before the ramp's
 * steepest patch (soft, not a wall) and an absolute radial clamp - inscribed inside the generated
 * square so it never crosses into ungenerated terrain - guarantees the player physically cannot
 * fall through regardless of how the terrain collision resolves.
 */
export const WORLD_SOFT_PUSH_START_RADIUS = WORLD_BOUNDARY_RADIUS - 100;
export const WORLD_HARD_CLAMP_RADIUS = WORLD_BOUNDARY_RADIUS - 5;
export const WORLD_EDGE_PUSH_SPEED = 6;

/** Single-player Goose Horde's own player spawn point - a random point on the map rather than the
 * fixed single-player spawn (SPAWN_X/SPAWN_Z, "the middle"), per explicit user request. Min radius
 * keeps it clearly off the exact world center; max stays a comfortable margin inside
 * WORLD_SOFT_PUSH_START_RADIUS so it can never roll into the world-edge push zone. */
export const HORDE_PLAYER_SPAWN_MIN_RADIUS = 15;
export const HORDE_PLAYER_SPAWN_MAX_RADIUS = WORLD_SOFT_PUSH_START_RADIUS - 60;

/**
 * Vegetation scatter (WORLD_PLAN.md §4): per-chunk deterministic placement, density-thresholded
 * against a secondary low-frequency noise field so trees/bushes/rocks cluster into forest patches
 * and clearings instead of being uniformly speckled. Trees need the highest density (deep forest
 * only), rocks the lowest (scattered even in clearings); some ground is left with none of the three
 * so combat sightlines/movement aren't universally obstructed.
 */
export const VEGETATION_CANDIDATES_PER_CHUNK = 24;
export const VEGETATION_DENSITY_NOISE_FREQUENCY = 0.02;
/** Lowered from 0.62 per user request ("masses of trees") - a lower threshold means more of the
 * density-noise field's range reads as "tree" everywhere, not just inside a dedicated forest zone. */
export const VEGETATION_TREE_DENSITY_THRESHOLD = 0.5;
export const VEGETATION_SCALE_VARIANCE = 0.15;
/** Measured from the actual spawn point (SPAWN_X, SPAWN_Z), not world origin - must clear the
 * largest encounter ring (ENEMY_RING_BASE_RADIUS) so a tree's solid trunk collider can never land
 * inside the combat area or on top of the player at spawn. */
export const VEGETATION_SPAWN_CLEARANCE = ENEMY_RING_BASE_RADIUS + 5;
/** Caps worst-case instances per type per chunk (e.g. an entire chunk landing in a dense noise
 * peak/thicket) so the fixed-capacity InstancedMesh pools below always have room for every loaded
 * chunk. Sized for extreme forest packing (see VEGETATION_TREE_MIN_SPACING_DENSE), not just the
 * gentle clustering this cap originally covered. */
/** Doubled per project decision ("spawn even more trees in a forest area, like 2x the amount"),
 * then raised again per a later "masses of trees" request - paired with the raised
 * VEGETATION_FOREST_EXTRA_CANDIDATES below so the per-chunk cap isn't the bottleneck on the higher
 * candidate count actually landing more trees. */
export const VEGETATION_MAX_PER_CHUNK_PER_TYPE = 220;
/** (2*UNLOAD_RADIUS_CHUNKS+1)^2 = 49 chunks can be loaded at once at most; 49 * 220 = 10780 worst
 * case per type - kept comfortably above that for the shared instance pools. InstancedMesh handles
 * thousands of instances cheaply, so this is sized for the worst case, not the average. */
export const VEGETATION_INSTANCE_CAPACITY = 14000;
export const VEGETATION_TRUNK_RADIUS = 0.35;
/** Leaf/canopy hit volume for tree types only (bushes/rocks are unaffected) - a sensor collider
 * (see VegetationManager.placeInstance), not a solid one: sensors are still hit by ordinary
 * hitscan raycasts (Rapier includes them by default; excluding them needs an explicit
 * QueryFilterFlags.EXCLUDE_SENSORS this codebase never passes) but never participate in solid
 * collision resolution, so the player's character controller and enemies' kinematic movement both
 * ignore it completely - shooting into foliage can now plausibly hit a leaf, but walking through
 * the same canopy stays exactly as unobstructed as it already was. Radius/height are a rough
 * approximation of the actual model's canopy, not a measured fit - good enough for "does a shot
 * into the foliage register," not a precise visual match. */
export const VEGETATION_CANOPY_RADIUS = 0.9;
/** Fraction of the tree's total (scaled) height the canopy sensor is centered at - trees' foliage
 * sits in the upper portion of the model, not at the base. */
export const VEGETATION_CANOPY_CENTER_HEIGHT_FRACTION = 0.7;
/** How much a forest zone's membership used to lower the effective tree threshold before the "remove
 * forest spawn and generation restrictions" request below made the drop unconditional (applied to
 * the whole map, not lerped by membership) - still the one knob for how dense that flat threshold
 * ends up. */
export const FOREST_TREE_THRESHOLD_DROP = 0.5;
/**
 * Per project decision ("forests should be extreme - some areas with just enough space for a
 * character to pass, some more sparse"): a second, much finer noise field textures the ground into
 * thicket/clearing patches, on top of the density gating above. Per a later user request ("remove
 * forest spawn and generation restrictions"), this - and the higher per-chunk candidate count
 * below - now applies everywhere rather than being reserved for chunks touching a dedicated forest
 * zone; there's no longer a separate "outside forest" sparse tier at all (see the removed
 * VEGETATION_TREE_OUTSIDE_FOREST_THRESHOLD/VEGETATION_TREE_MIN_SPACING_SPARSE and
 * VegetationManager.ts's pickType/minTreeSpacingFor).
 */
export const VEGETATION_FOREST_TEXTURE_FREQUENCY = 0.15;
/** Doubled from 220 (see project decision above), then raised again per a later "masses of trees"
 * request - alongside the raised per-chunk cap and instance pool above, this is the main lever on
 * how many trees land in a chunk. */
export const VEGETATION_FOREST_EXTRA_CANDIDATES = 700;
/** Minimum trunk-center-to-trunk-center spacing enforced between trees placed in the same chunk.
 * DENSE is a deliberately tight squeeze: with VEGETATION_TRUNK_RADIUS = 0.35 trunks and a player
 * capsule radius of 0.4, 1.8 leaves ~1.1 units of clear gap between trunk surfaces - passable, but
 * a real squeeze, not a comfortable walk-through. */
export const VEGETATION_TREE_MIN_SPACING_DENSE = 1.8;
export const VEGETATION_TREE_MIN_SPACING_NORMAL = 3.5;
/** Bushes/rocks get their own uniform per-candidate roll, independent of the forest density field -
 * per project decision, they should scatter randomly rather than cluster with trees. */
export const VEGETATION_BUSH_PROBABILITY = 0.1;
export const VEGETATION_ROCK_PROBABILITY = 0.06;

/**
 * Zone system (WORLD_PLAN.md, post-buildings user feedback): flat zones (where towns can spawn)
 * and forest zones (where trees cluster densely) are both deterministic jittered hash-grids -
 * "Worley noise" with one candidate site per grid cell, nearest-site-wins membership. Two
 * independent grids since towns and forests want different sizes/densities. See world/ZoneMap.ts.
 * Distinct seed offsets from terrain (the world seed - see worldSeed.ts), the ridge noise (+1),
 * and vegetation density (+2): flat zones use +10, forest zones +11, town layouts +12, watch tower
 * placement +13 (see WATCH_TOWER_SEED_OFFSET below).
 */
export const FLAT_ZONE_SEED_OFFSET = 10;
/** Cell size shrunk 230 -> 50 alongside the WORLD_SIZE_CHUNKS 6 -> 4 cut - stays comfortably above
 * 2x the (now much smaller) max radius below to keep site-overlap rejections rare, same rule as
 * before, just rescaled: the old 230 was sized for a 60-unit max radius, wildly oversized for the
 * new ~16-unit one, and left at 230 would have fit only one or two cells across the whole shrunk
 * world's safe annulus. */
export const FLAT_ZONE_CELL_SIZE = 50;
/** Raised from 0.45 per user request ("masses of houses") - keeping the map small (per user
 * decision) but rolling far more of the non-guaranteed candidate cells into an actual town,
 * mirroring the same lever FOREST_ZONE_DENSITY below already used for the equivalent forest
 * report. */
export const FLAT_ZONE_DENSITY = 0.7;
/** Narrowed from 60-100 to 65-90, then re-tuned to 40-60 at WORLD_SIZE_CHUNKS=6, then to 10-16 when
 * the world shrunk again to 4 (see that constant's comment for the full history and why
 * ZONE_EDGE_MARGIN below took most of the earlier squeeze instead of this range): isSiteClear
 * rejects any site whose radius plus its distance from spawn/world-edge doesn't fit the available
 * annulus, which - given ENEMY_RING_BASE_RADIUS, ZONE_EDGE_MARGIN, and WORLD_EDGE_RAMP_START below
 * - makes radii above ~17.5 always fail regardless of position at the current world size (a real,
 * ~70% cut from the 6-chunk world's 40-60 range, flagged to and accepted by the user before this
 * shrink, not discovered after shipping it). This range stays fully inside that feasible band. */
export const FLAT_ZONE_RADIUS_MIN = 10;
export const FLAT_ZONE_RADIUS_MAX = 16;
/** Raised from 0.6 - a town needs a genuinely large flat plateau to fit 30+ buildings without
 * their footprints creeping onto the smoothstep rim (still-sloping ground near the zone's edge). */
export const FLAT_ZONE_INNER_FRACTION = 0.85;

export const FOREST_ZONE_SEED_OFFSET = 11;
/** Shrunk 200 -> 45 alongside the WORLD_SIZE_CHUNKS 6 -> 4 cut - see the matching
 * FLAT_ZONE_CELL_SIZE comment for why the old value was wildly oversized for the new max radius. */
export const FOREST_ZONE_CELL_SIZE = 45;
/** Raised 0.45 -> 0.7 per playtest report of a seed with almost no visible trees, then 0.7 -> 0.85
 * per a later "masses of trees" request - unlike the radius (below), this doesn't touch the
 * geometric ceiling at all: it only raises the chance any given candidate cell in the density-
 * noise grid actually rolls a site. The 4-chunk world's safe annulus (spawn ring to mountain ramp)
 * only fits ~5 forest-cell-sized candidates total regardless of density, so at the old 0.45 the
 * *expected* count of non-guaranteed forest patches (on top of the always-guaranteed ones - see
 * GUARANTEED_ZONE_COUNT) was only ~2, with real seed-to-seed variance landing some runs at 0 extra
 * - exactly the "seed with no trees" report. Pushing this all the way to 0.95-1.0 was tried and
 * reverted: it started colliding guaranteed sites into the same grid cell often enough to break
 * ZoneMap.test.ts's exact-count invariant and WatchTowerManager.test.ts's zone-avoidance rate (more
 * of the map being "zoned" squeezes the towers' own independent placement) - 0.85 is the highest
 * value that still holds both across the full seed sweep. */
export const FOREST_ZONE_DENSITY = 0.85;
/** Raised from 50-90 per project decision ("forest radius should increase a lot"), re-tuned to
 * 45-65 at WORLD_SIZE_CHUNKS=6, then to 10-16 when the world shrunk again to 4. Nudged 16 -> 17 on
 * the max (min left at 10, unchanged) per a later request to make forests denser-looking: the
 * world's geometric ceiling here is ~17.5 (isSiteClear rejects any site whose radius plus its
 * distance from spawn/world-edge doesn't fit the available annulus, given ENEMY_RING_BASE_RADIUS,
 * ZONE_EDGE_MARGIN, and WORLD_EDGE_RAMP_START) - this is about as far as the max can go without
 * raising the natural (non-guaranteed) rejection rate, since isSiteClear drops a site entirely
 * (not just clamps its radius) when it doesn't fit at its rolled position. The min was left alone
 * deliberately - computeGuaranteedSites' feasibility band for the 2 always-guaranteed forest sites
 * is `WORLD_EDGE_RAMP_START - ZONE_EDGE_MARGIN - radiusMin - spawnOffsetMagnitude` vs.
 * `ENEMY_RING_BASE_RADIUS + ZONE_EDGE_MARGIN + radiusMin` - raising radiusMin narrows that band on
 * both sides at once, and it's already a fairly thin 7-unit band at the current value; the real
 * lever for "more forest, more often" is FOREST_ZONE_DENSITY above, not squeezing this further. */
export const FOREST_ZONE_RADIUS_MIN = 10;
export const FOREST_ZONE_RADIUS_MAX = 17;
export const FOREST_ZONE_INNER_FRACTION = 0.6;

/** Keeps zone sites clear of both the world edge (mountain ring/hard clamp) and the spawn/combat
 * ring, at the zone-presence level so a town or forest can never partially spill into either.
 * Narrowed from 30 to 10, then to 5, per user decision (denser world, more towns/forests over open
 * space - zone-to-zone overlap and zones crowding the spawn ring are both acceptable trade-offs,
 * and when WORLD_SIZE_CHUNKS had to drop from 7 to 6 for the symmetry fix described on that
 * constant, user explicitly chose to squeeze this margin further rather than cut zone radii any
 * more than necessary). A smaller margin means far more candidate sites clear the check at a large
 * radius, which is the main lever on how many towns/forests actually spawn per match, not just how
 * big any one of them can be. Not dropped to zero - buildings have no clearance check of their own
 * (unlike vegetation, see VEGETATION_SPAWN_CLEARANCE), so this is what keeps a town's buildings
 * from touching the actual encounter ring's edge, not just approximately near it. */
export const ZONE_EDGE_MARGIN = 5;

/** At least this many flat-zone (town) and forest-zone sites are force-placed every world,
 * regardless of the density roll below, so a run of bad luck can never generate a world with too
 * few or zero towns/forests - see ZoneMap.ts's guaranteed-cell mechanism. Raised from 2 per user
 * request ("masses of trees... masses of houses"): with the map staying this size (user decision),
 * more *guaranteed* sites is the one lever that doesn't depend on a density roll's luck at all -
 * computeGuaranteedSites spreads them evenly around spawn regardless of count, so this scales
 * cleanly without needing to re-derive anything else. 4 was tried and reverted - the safe annulus
 * is narrow enough relative to a zone's own cell size that computeGuaranteedSites' own dedup-retry
 * budget couldn't always find 4 distinct cells, occasionally silently dropping back to 3 anyway
 * (caught by ZoneMap.test.ts's exact-count assertion, not assumed); 3 is the highest value that
 * holds across the full seed sweep. */
export const GUARANTEED_ZONE_COUNT = 3;

export const TOWN_LAYOUT_SEED_OFFSET = 12;
/** History: raised from 4-8, then to 15-30, then to 30-45 per project decision ("towns must
 * consist of a minimum of 30 buildings"). That decision predates the WORLD_SIZE_CHUNKS 6 -> 4
 * shrink, which cut flat zones to radius 10-16 (see FLAT_ZONE_RADIUS_MIN/MAX) and put the two in
 * direct geometric conflict: with TOWN_BUILD_FRACTION = 0.8 the buildable disc is only radius
 * 8-12.8, and the presets' real measured footprints (half-diagonals ~4.0-4.9 for houses, ~2.5-2.7
 * for towers, plus TOWN_BUILDING_SPACING_MARGIN between each pair) saturate rejection sampling at
 * roughly 4 buildings in a radius-10 zone up to roughly 8 in a radius-16 one - verified by
 * simulating getTownLayout's exact loop with the measured footprints across 2000 seeds. 30-45 was
 * therefore unreachable fiction: every town burned all TOWN_MAX_PLACEMENT_ATTEMPTS and still
 * placed only the saturation count, which is exactly the "very little houses spawn" playtest
 * report. Retuned to 8-12, superseding the "minimum 30" decision for as long as zones stay this
 * small: the range sits at/just above the geometric ceiling for every zone size, so towns stay as
 * dense as the geometry allows (dropping these *below* saturation would actively truncate large
 * towns - simulated cost of 8-12 vs. the old 30-45 is ~0.03 buildings on average, i.e. none).
 * Meaningfully more buildings than this requires bigger zones or smaller building footprints,
 * not a bigger number here.
 *
 * Addendum: the "tower" presets referenced above were later removed entirely (replaced by
 * standalone watch towers - see WatchTowerManager.ts, not part of town layouts at all), leaving
 * only the larger house footprints in the sampling pool - re-checked live after that removal
 * (not just assumed from the old simulation, since houses alone are a different, larger-average
 * footprint mix) to confirm this range still holds; see the watch-tower work's own verification
 * notes in NOTES.md for the actual result. */
export const TOWN_MIN_BUILDINGS = 8;
/** Raised from 12 alongside the tighter TOWN_BUILDING_SPACING_MARGIN below per user request
 * ("masses of houses") - the saturation ceiling documented above still applies (this is a cap on
 * what rejection sampling is *allowed* to reach, not a promise it always will), but a tighter
 * margin genuinely raises that ceiling a bit, so the cap needed to move too or it would truncate
 * towns the looser margin now lets saturate higher. */
export const TOWN_MAX_BUILDINGS = 20;
/** Buildings are only placed within this fraction of the flat zone's radius, keeping the whole
 * footprint inside the flat core (membership ~1, given FLAT_ZONE_INNER_FRACTION above) rather than
 * the smoothstep rim where the terrain is still transitioning back to natural height. */
export const TOWN_BUILD_FRACTION = 0.8;
/** Tightened from 2 per user request ("masses of houses") - still enough gap between footprints
 * (~4.0-4.9 unit house half-diagonals) for a player to walk between buildings, just less wasted
 * space between them, letting more buildings saturate into the same small zone radius. */
export const TOWN_BUILDING_SPACING_MARGIN = 1;
/** Raised from 800 alongside the tighter spacing/higher max above - a tighter packing needs more
 * rejection-sampling attempts to actually find the additional valid spots it now has room for. */
export const TOWN_MAX_PLACEMENT_ATTEMPTS = 1500;
/** A house's collider footprint is sized from its GLTF's raw bounding box (see
 * BuildingManager.measurePreset), which includes roof eaves/overhangs and other decorative
 * geometry that extends past the walls a player actually perceives as "the house" - reported as an
 * invisible barrier a bit past the visible structure (blocking both movement and bullets). Shrunk
 * by this fraction on both footprint axes so the collider sits inside the walls instead of at the
 * outermost roof/eave edge. Modest (15%) so it still fully covers the walkable wall silhouette for
 * any reasonably-proportioned house model, not just a token nudge. */
export const BUILDING_COLLIDER_FOOTPRINT_SHRINK = 0.85;

/**
 * Roads (WORLD_PLAN.md §9 follow-up, per the Opus design already logged there): a minimum spanning
 * tree over a town's building positions, rendered as flat strips - the town's flat core is already
 * genuinely level (see FLAT_ZONE_INNER_FRACTION), so a road just needs to sit slightly above it,
 * not carve its own grade. See RoadManager.ts.
 */
export const ROAD_WIDTH = 3;
/** Small enough to be visually unnoticeable, large enough to avoid z-fighting with the ground mesh. */
export const ROAD_SURFACE_OFFSET = 0.04;
export const ROAD_COLOR = 0x6b5a45;

/**
 * Watch towers (per user request, replacing the generic tower building presets that used to be
 * mixed into town layouts): exactly WATCH_TOWER_COUNT per map, placed independently of towns and
 * forests entirely - see WatchTowerManager.ts. A tall square shaft with a real, walkable
 * switchback staircase wrapping its exterior (a continuous ramp collider per flight, not discrete
 * steps or the crate-jump mechanic used for house roofs - see WatchTowerManager.ts's own docs for
 * why), capped with an open lookout platform.
 */
export const WATCH_TOWER_COUNT = 4;
export const WATCH_TOWER_HALF_WIDTH = 3;
export const WATCH_TOWER_HEIGHT = 16;
/** Comfortably more than 2x PLAYER_RADIUS (0.4) - wide enough that a player can walk up without
 * brushing the rails on either side, per user request ("wide enough for players to navigate"). */
export const WATCH_TOWER_STAIR_WIDTH = 2.4;
/** How far the top lookout deck extends past the shaft's own footprint on each side - must clear
 * the outer stair centerline (HALF_WIDTH + STAIR_WIDTH/2) so a flight's top end lands under the
 * platform with no gap, not just past the shaft's own smaller footprint; kept a bit past that
 * minimum for a visible overhang, not just the bare geometric floor. */
export const WATCH_TOWER_PLATFORM_OVERHANG = 1.5;
/** Solid collider height around both the lookout platform's edge and the staircase's outer edge -
 * climbing 16m up without this would make one misstep near the edge an unfair instant fall. */
export const WATCH_TOWER_RAILING_HEIGHT = 1;
export const WATCH_TOWER_SEED_OFFSET = 13;
/** How far *beyond* the tower's own footprint (WatchTowerManager.ts's WATCH_TOWER_FOOTPRINT_RADIUS)
 * TerrainGenerator.ts's clearing blend keeps easing back toward natural terrain, before it's fully
 * natural again. Everything within the footprint radius itself is forced dead flat, not just
 * blended - discovered necessary by actually testing a tower in the dev server: an earlier version
 * of this clearing used a flat radius *smaller* than the tower's own real footprint (a fixed
 * fraction of a single combined radius, rather than a value keyed to the geometry itself), so the
 * outer switchback flights' own corners - which reach further out from center than the shaft
 * alone - sat inside the *blending* band instead of the guaranteed-flat one. The terrain mesh there
 * faithfully rendered that blend while the flight colliders kept assuming perfectly flat ground at
 * their own fixed local height, so the visible ramp drifted away from the real ground - floating
 * above it or sinking into it depending on which way the local slope happened to run (exactly what
 * the user's manual test screenshots showed: a staircase disconnected from the tower's own base). */
export const WATCH_TOWER_CLEARING_BLEND_MARGIN = 4;

/**
 * Buildings (WORLD_PLAN.md §3, later revised into town clusters per user feedback): not enterable,
 * solid exterior only - real premade structures from Kenney's Modular Buildings kit (CC0), not a
 * plain box. Placement is now town-clustered within flat zones rather than one-per-chunk - see
 * TOWN_* constants near the zone system below, and BuildingManager.ts. Colliders follow the real
 * shape (2026-09-14, see src/world/buildingColliders.ts): a wall box up to the storey top (still
 * shrunk by BUILDING_COLLIDER_FOOTPRINT_SHRINK) plus convex prisms that follow each roof slope,
 * computed at runtime from the loaded model. Previously one box ran all the way to the ridge, so
 * shots stopped in the empty air above sloped roofs and a player on a roof hovered at ridge height.
 */

export const DEFAULT_ENEMY_COUNT = 3;
export const DEFAULT_TARGET_COUNT = 5;
export const MAX_MATCH_ENTITY_COUNT = 50;
