export const FIXED_TIMESTEP = 1 / 60;
export const MAX_FRAME_TIME = 0.25;

// World seed lives in core/worldSeed.ts (not here) - it's mutable at runtime so each new match
// generates a different world, unlike every other constant in this file.

/** Match spawn point and the largest encounter ring drawn around it (enemies use a bigger ring
 * than targets - see Game.ringRadius) - shared with VegetationManager so placement can keep world
 * content out of the actual spawn/combat area, not just world origin (0,0). */
export const SPAWN_X = 0;
export const SPAWN_Z = 8;
export const ENEMY_RING_BASE_RADIUS = 25;

export const CAMERA_FOV = 75;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 2000;

/** Shared between Game's shadow-casting DirectionalLight and Renderer's Sky shader, so the visible
 * bright spot in the sky and the direction shadows fall match instead of contradicting each other. */
export const SUN_DIRECTION_X = 20;
export const SUN_DIRECTION_Y = 30;
export const SUN_DIRECTION_Z = 10;

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
export const SUN_SHADOW_BIAS = -0.0002;
export const SUN_SHADOW_NORMAL_BIAS = 0.02;

/** ACES filmic tone mapping (VISUAL_REALISM.md §3) reads darker than the default NoToneMapping at
 * the same light intensities - this compensates without needing to retune every light. */
export const TONE_MAPPING_EXPOSURE = 1.1;

/** Muzzle flash (VISUAL_REALISM.md §7) - a brief PointLight + sprite at the muzzle on every
 * ranged shot. Lifetime is 2-3 frames at 60fps, long enough to read as a flash without lingering
 * into a glow. */
export const MUZZLE_FLASH_LIFETIME = 0.05;
export const MUZZLE_FLASH_LIGHT_INTENSITY = 6;
export const MUZZLE_FLASH_LIGHT_RANGE = 4;

/** Death sequence (VISUAL_REALISM.md §6) - a killed enemy/target now topples, holds, and sinks
 * instead of vanishing the instant its health hits 0 (previously the single worst
 * realism-breaking moment in the game per the review). Only mesh transform (rotation/position) is
 * animated, deliberately not material opacity: enemy models are SkeletonUtils-cloned, which reuses
 * the source material by reference across every clone (see its own docstring - "materials are
 * reused by reference"), so fading one dying enemy's opacity would fade every other enemy sharing
 * that material too. EntityManager disposes the corpse's physics presence (colliders/rigid body)
 * immediately on death, same tick as before - only the mesh removal is delayed, so nothing can
 * still collide with or shoot through a dead body during this sequence. */
export const DEATH_FALL_DURATION = 0.4;
export const DEATH_HOLD_DURATION = 2;
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

/** Retuned for the bounded world (WORLD_PLAN.md §2/§5): far sits just past WORLD_HARD_CLAMP_RADIUS
 * so the boundary is concealed by haze rather than visible as a sharp cutoff against clear sky. */
export const FOG_NEAR = 35;
export const FOG_FAR = 650;
export const FOG_COLOR = 0xbfd3e0;

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

export const ADS_LERP_SPEED = 12;
export const SCOPE_REVEAL_THRESHOLD = 0.92;

export const WEAPON_SWITCH_DURATION = 0.35;
export const WEAPON_HOLSTER_DROP = 0.35;
export const RELOAD_TILT_ANGLE = 0.5;
export const RELOAD_DIP = 0.08;

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
export const ENEMY_ALERT_REACTION_TIME = 0.4;
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
/** Global cap (shared across every enemy in the match, see engagementSlots.ts) on how many can be
 * actively firing at once - without it, every enemy that spots the player opens fire the instant
 * it's in range, which reads as an unfair dogpile rather than a fight fought piece by piece. An
 * enemy that can't get a slot still tracks/faces the player, it just doesn't shoot yet. */
export const ENEMY_MAX_CONCURRENT_ENGAGERS = 2;
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

export const PLAYER_HEALTH = 100;

export const HIT_MARKER_DURATION = 0.2;

/** World units already read as meters throughout this codebase (PLAYER_HEIGHT = 1.8, etc.) - a
 * player hit landing at or beyond this distance gets a quick on-screen callout (see
 * ui/longShotCallout.ts) acknowledging the shot, since a hit that far away is easy to miss amid
 * everything else on screen. */
export const LONG_SHOT_DISTANCE = 50;

/** Visual-only travel speed for tracers - the hit itself is already resolved instantly via raycast. */
export const TRACER_SPEED = 150;
export const TRACER_LENGTH = 0.6;
export const TRACER_COLOR = 0xfff2a8;

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
 * later to 7, per user feedback that the world still felt too large to reach the edges of.
 *
 * This constant sets a hard ceiling on how large any flat/forest zone can ever be (see
 * isSiteClear/maxClearRadius in ZoneMap.ts): a site's disc must clear both the world-edge mountain
 * ramp and the spawn/combat ring, and shrinking the world narrows that clearance for every site,
 * everywhere, simultaneously. At 6 chunks, even the best-positioned site in the entire world can't
 * clear enough room for the original zone radii (65-90 flat, 78-92 forest) - isSiteClear would
 * reject every candidate and towns/forests would stop spawning entirely, not just shrink. 7 chunks
 * plus the reduced ZONE_EDGE_MARGIN below keeps that ceiling comfortably above both ranges (with a
 * small trim - see FLAT_ZONE_RADIUS_MAX/FOREST_ZONE_RADIUS_MAX). Shrinking this further requires
 * re-deriving that ceiling and re-tuning those ranges together again, not just changing this one
 * number. */
export const WORLD_SIZE_CHUNKS = 7;
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

/**
 * Vegetation scatter (WORLD_PLAN.md §4): per-chunk deterministic placement, density-thresholded
 * against a secondary low-frequency noise field so trees/bushes/rocks cluster into forest patches
 * and clearings instead of being uniformly speckled. Trees need the highest density (deep forest
 * only), rocks the lowest (scattered even in clearings); some ground is left with none of the three
 * so combat sightlines/movement aren't universally obstructed.
 */
export const VEGETATION_CANDIDATES_PER_CHUNK = 24;
export const VEGETATION_DENSITY_NOISE_FREQUENCY = 0.02;
export const VEGETATION_TREE_DENSITY_THRESHOLD = 0.62;
export const VEGETATION_SCALE_VARIANCE = 0.15;
/** Measured from the actual spawn point (SPAWN_X, SPAWN_Z), not world origin - must clear the
 * largest encounter ring (ENEMY_RING_BASE_RADIUS) so a tree's solid trunk collider can never land
 * inside the combat area or on top of the player at spawn. */
export const VEGETATION_SPAWN_CLEARANCE = ENEMY_RING_BASE_RADIUS + 5;
/** Caps worst-case instances per type per chunk (e.g. an entire chunk landing in a dense noise
 * peak/thicket) so the fixed-capacity InstancedMesh pools below always have room for every loaded
 * chunk. Sized for extreme forest packing (see VEGETATION_TREE_MIN_SPACING_DENSE), not just the
 * gentle clustering this cap originally covered. */
/** Doubled per project decision ("spawn even more trees in a forest area, like 2x the amount") -
 * paired with the doubled VEGETATION_FOREST_EXTRA_CANDIDATES below so the per-chunk cap isn't the
 * bottleneck on the higher candidate count actually landing more trees. */
export const VEGETATION_MAX_PER_CHUNK_PER_TYPE = 160;
/** (2*UNLOAD_RADIUS_CHUNKS+1)^2 = 49 chunks can be loaded at once at most; 49 * 160 = 7840 worst
 * case per type - comfortable margin above that for the shared instance pools. InstancedMesh
 * handles thousands of instances cheaply, so this is sized for the worst case, not the average. */
export const VEGETATION_INSTANCE_CAPACITY = 10000;
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
/** Outside any forest zone, trees are rare stragglers rather than absent entirely - reads more
 * natural than a hard cutoff at the forest boundary. */
export const VEGETATION_TREE_OUTSIDE_FOREST_THRESHOLD = 0.95;
/** How much a forest zone's membership (0..1, 1 at its core) lowers the effective tree threshold -
 * at full membership, threshold drops to TREE_DENSITY_THRESHOLD - this, making forest cores dense. */
export const FOREST_TREE_THRESHOLD_DROP = 0.5;
/**
 * Per project decision ("forests should be extreme - some areas with just enough space for a
 * character to pass, some more sparse"): a second, much finer noise field textures the *interior*
 * of a forest zone into thicket/clearing patches, on top of the broad forest-vs-not gating above.
 * Chunks touching a forest zone also draw far more candidates, since packing a thicket this tight
 * needs many more placement attempts than gentle clustering did.
 */
export const VEGETATION_FOREST_TEXTURE_FREQUENCY = 0.15;
/** Doubled from 220 (see project decision above) - roughly doubles the number of trees that
 * actually land in a forest chunk, alongside the doubled per-chunk cap and instance pool above. */
export const VEGETATION_FOREST_EXTRA_CANDIDATES = 440;
/** Minimum trunk-center-to-trunk-center spacing enforced between trees placed in the same chunk.
 * DENSE is a deliberately tight squeeze: with VEGETATION_TRUNK_RADIUS = 0.35 trunks and a player
 * capsule radius of 0.4, 1.8 leaves ~1.1 units of clear gap between trunk surfaces - passable, but
 * a real squeeze, not a comfortable walk-through. SPARSE is open ground outside any forest texture. */
export const VEGETATION_TREE_MIN_SPACING_DENSE = 1.8;
export const VEGETATION_TREE_MIN_SPACING_NORMAL = 3.5;
export const VEGETATION_TREE_MIN_SPACING_SPARSE = 6;
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
 * and vegetation density (+2): flat zones use +10, forest zones +11, town layouts +12.
 */
export const FLAT_ZONE_SEED_OFFSET = 10;
/** Bumped from 140/35-60 per project decision ("towns must consist of a lot more buildings") -
 * cell size stays comfortably above 2x the max radius to keep site-overlap rejections rare. */
export const FLAT_ZONE_CELL_SIZE = 230;
export const FLAT_ZONE_DENSITY = 0.45;
/** Narrowed from 60-100 to 65-90, then trimmed to 65-85 when the world shrank to
 * WORLD_SIZE_CHUNKS=7: isSiteClear rejects any site whose radius plus its distance from
 * spawn/world-edge doesn't fit the available annulus, which - given ENEMY_RING_BASE_RADIUS,
 * ZONE_EDGE_MARGIN, and WORLD_EDGE_RAMP_START below - makes radii above ~87.5 always fail
 * regardless of position at the current world size. This range stays fully inside that feasible
 * band (with a few units of headroom) so no roll is wasted. */
export const FLAT_ZONE_RADIUS_MIN = 65;
export const FLAT_ZONE_RADIUS_MAX = 85;
/** Raised from 0.6 - a town needs a genuinely large flat plateau to fit 30+ buildings without
 * their footprints creeping onto the smoothstep rim (still-sloping ground near the zone's edge). */
export const FLAT_ZONE_INNER_FRACTION = 0.85;

export const FOREST_ZONE_SEED_OFFSET = 11;
/** Raised from 160 to stay comfortably above 2x the max radius below (avoids frequent site-overlap
 * rejections at the larger radius - see the matching FLAT_ZONE_CELL_SIZE comment). */
export const FOREST_ZONE_CELL_SIZE = 200;
export const FOREST_ZONE_DENSITY = 0.45;
/** Raised from 50-90 per project decision ("forest radius should increase a lot"), then trimmed
 * from a 78-92 max of 92 down to 85 when the world shrank to WORLD_SIZE_CHUNKS=7 - pushed right up
 * to the world's current geometric ceiling: isSiteClear (see below) rejects any site whose radius
 * plus its distance from spawn/world-edge doesn't fit the available annulus, which given
 * ENEMY_RING_BASE_RADIUS, ZONE_EDGE_MARGIN, and WORLD_EDGE_RAMP_START makes radii above ~87.5
 * always fail regardless of position - this is the largest a forest zone can ever be without
 * enlarging the world itself (WORLD_BOUNDARY_RADIUS) or narrowing ZONE_EDGE_MARGIN further. */
export const FOREST_ZONE_RADIUS_MIN = 78;
export const FOREST_ZONE_RADIUS_MAX = 85;
export const FOREST_ZONE_INNER_FRACTION = 0.6;

/** Keeps zone sites clear of both the world edge (mountain ring/hard clamp) and the spawn/combat
 * ring, at the zone-presence level so a town or forest can never partially spill into either.
 * Narrowed from 30 to 10 per user decision (denser world, more towns/forests over open space -
 * zone-to-zone overlap and zones crowding the spawn ring are both acceptable trade-offs): a smaller
 * margin means far more candidate sites clear the check at a large radius, which is the main lever
 * on how many towns/forests actually spawn per match, not just how big any one of them can be. Not
 * dropped to zero - buildings have no clearance check of their own (unlike vegetation, see
 * VEGETATION_SPAWN_CLEARANCE), so this is what keeps a town's buildings from touching the actual
 * encounter ring's edge, not just approximately near it. */
export const ZONE_EDGE_MARGIN = 10;

/** At least this many flat-zone (town) and forest-zone sites are force-placed every world,
 * regardless of the density roll below, so a run of bad luck can never generate a world with too
 * few or zero towns/forests - see ZoneMap.ts's guaranteed-cell mechanism. */
export const GUARANTEED_ZONE_COUNT = 2;

export const TOWN_LAYOUT_SEED_OFFSET = 12;
/** Raised from 4-8, then again from 15-30, per project decision ("towns must consist of a
 * minimum of 30 buildings") - paired with the larger flat-zone plateau above and a much higher
 * placement-attempt budget below, since packing this many buildings via rejection sampling needs
 * many more tries to succeed. */
export const TOWN_MIN_BUILDINGS = 30;
export const TOWN_MAX_BUILDINGS = 45;
/** Buildings are only placed within this fraction of the flat zone's radius, keeping the whole
 * footprint inside the flat core (membership ~1, given FLAT_ZONE_INNER_FRACTION above) rather than
 * the smoothstep rim where the terrain is still transitioning back to natural height. */
export const TOWN_BUILD_FRACTION = 0.8;
/** Tighter than the original 6 - a town with 30-45 buildings should read as a dense, real town,
 * not the same spacing stretched thin over more buildings. */
export const TOWN_BUILDING_SPACING_MARGIN = 2;
export const TOWN_MAX_PLACEMENT_ATTEMPTS = 800;

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
 * Buildings (WORLD_PLAN.md §3, later revised into town clusters per user feedback): not enterable,
 * solid exterior only - real premade structures from Kenney's Modular Buildings kit (CC0), not a
 * plain box. Placement is now town-clustered within flat zones rather than one-per-chunk - see
 * TOWN_* constants near the zone system below, and BuildingManager.ts. The building's own box
 * collider top face doubles as the rooftop landing surface - no separate platform collider is
 * needed since an axis-aligned box's top is already flat and walkable.
 */

/**
 * Ladder / climb-by-contact mechanic (WORLD_PLAN.md §3): one fixed local face of each building
 * (before its per-building rotation) gets a procedural low-poly rung ladder plus a sensor
 * collider spanning that face. See BuildingManager.ts (ladder creation) and Player.ts (the
 * climbing movement state).
 */
/** Widened from 1.2 (±0.6 tolerance) after confirming via playtesting that a band that narrow was
 * nearly impossible to walk into deliberately - pressing forward into a flat wall gives zero
 * sideways slide (no tangential movement component to slide along), so a player can't "feel
 * along" the wall to find a narrow ladder the way they could slide along an angled surface. */
export const LADDER_WIDTH = 2.6;
/** How far the sensor protrudes outward from the wall face - must comfortably exceed
 * PLAYER_RADIUS so a player standing flush against the wall (blocked by its solid collider) is
 * already intersecting the sensor, without needing to clip into the wall to reach it. */
export const LADDER_SENSOR_DEPTH = PLAYER_RADIUS + 0.3;
/** Extends the sensor above the building's actual roof height, so climbing continues a bit past
 * roof level before contact is lost and the mantle (a direct teleport to the roof's center - see
 * registerClimbable/Player.ts) fires - without this margin, exiting right at the roof edge would
 * trigger the mantle before the player is even clear of the wall's own solid collider. */
export const LADDER_TOP_MARGIN = 2;
export const LADDER_CLIMB_SPEED = 4;
/** Extra clearance above the roof surface the mantle teleport targets, so the player's capsule
 * doesn't spawn exactly flush with the roof (risking a jittery floating-point contact) - settles
 * onto the roof from a hair above it instead. */
export const LADDER_ROOF_CLEARANCE = 0.05;

export const DEFAULT_ENEMY_COUNT = 3;
export const DEFAULT_TARGET_COUNT = 5;
export const MAX_MATCH_ENTITY_COUNT = 50;
