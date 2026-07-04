export const FIXED_TIMESTEP = 1 / 60;
export const MAX_FRAME_TIME = 0.25;

export const WORLD_SEED = 1337;

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

export const ENEMY_HEALTH = 60;
export const ENEMY_RADIUS = 0.45;
export const ENEMY_HEIGHT = 1.7;
export const ENEMY_SPEED = 2.5;
export const ENEMY_STOP_DISTANCE = 3;
export const ENEMY_ATTACK_RANGE = 3;
export const ENEMY_ATTACK_DAMAGE = 8;
export const ENEMY_ATTACK_INTERVAL = 1;
export const ENEMY_DETECTION_RANGE = 18;
export const ENEMY_LEASH_RANGE = 26;
export const ENEMY_WANDER_RADIUS = 6;
export const ENEMY_WANDER_SPEED = ENEMY_SPEED * 0.4;
export const ENEMY_WANDER_INTERVAL = 3;
export const ENEMY_WANDER_STOP_DISTANCE = 0.4;

export const PLAYER_HEALTH = 100;

export const HIT_MARKER_DURATION = 0.2;

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
export const TERRAIN_OCTAVES = 4;
export const TERRAIN_BASE_FREQUENCY = 0.015;
export const TERRAIN_LACUNARITY = 2.0;
export const TERRAIN_PERSISTENCE = 0.5;
export const TERRAIN_AMPLITUDE = 8;

export const VIEW_RADIUS_CHUNKS = 2;
export const UNLOAD_RADIUS_CHUNKS = 3;
export const MAX_CHUNK_GENERATIONS_PER_TICK = 2;

/** World is bounded (arena-style), not infinite — see WORLD_PLAN.md §2. Chunk coordinates outside
 * [WORLD_MIN_CHUNK, WORLD_MAX_CHUNK] on either axis are never generated. */
export const WORLD_SIZE_CHUNKS = 12;
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
export const VEGETATION_BUSH_DENSITY_THRESHOLD = 0.45;
export const VEGETATION_ROCK_DENSITY_THRESHOLD = 0.3;
export const VEGETATION_SCALE_VARIANCE = 0.15;
/** Measured from the actual spawn point (SPAWN_X, SPAWN_Z), not world origin - must clear the
 * largest encounter ring (ENEMY_RING_BASE_RADIUS) so a tree's solid trunk collider can never land
 * inside the combat area or on top of the player at spawn. */
export const VEGETATION_SPAWN_CLEARANCE = ENEMY_RING_BASE_RADIUS + 5;
/** Caps worst-case instances per type per chunk (e.g. an entire chunk landing in a dense noise
 * peak) so the fixed-capacity InstancedMesh pools below always have room for every loaded chunk. */
export const VEGETATION_MAX_PER_CHUNK_PER_TYPE = 8;
/** (2*UNLOAD_RADIUS_CHUNKS+1)^2 = 49 chunks can be loaded at once at most; 49 * 8 = 392 worst case
 * per type - comfortable margin above that for the shared instance pools. */
export const VEGETATION_INSTANCE_CAPACITY = 500;
export const VEGETATION_TRUNK_RADIUS = 0.35;

/**
 * Buildings (WORLD_PLAN.md §3): not enterable, solid exterior only - real premade structures from
 * Kenney's Modular Buildings kit (CC0), not a plain box, per project decision after seeing the
 * plain-box version look unconvincing. Per-chunk deterministic placement (moderate density) -
 * allowed just outside the encounter ring but never inside it, kept a minimum distance apart so
 * climbing one doesn't put a player inside another's collider. The building's own box collider top
 * face doubles as the rooftop landing surface (see BuildingManager.ts) - no separate platform
 * collider is needed since an axis-aligned box's top is already flat and walkable.
 */
/** Probability any given chunk attempts to place a building at all - most chunks have none. */
export const BUILDING_CHUNK_SPAWN_CHANCE = 0.3;
/** Minimum required gap between two buildings' footprints (beyond their own half-diagonals). */
export const BUILDING_MIN_GAP = 15;
/** Measured from the actual spawn point to the building's nearest possible edge (center distance
 * minus its own half-diagonal) - must clear the largest encounter ring, matching the "just outside
 * the ring, never inside it" placement decision (unlike vegetation, which is excluded with a wider
 * buffer since it has no gameplay reason to hug the ring). */
export const BUILDING_SPAWN_CLEARANCE = ENEMY_RING_BASE_RADIUS;

export const DEFAULT_ENEMY_COUNT = 3;
export const DEFAULT_TARGET_COUNT = 5;
export const MAX_MATCH_ENTITY_COUNT = 50;
