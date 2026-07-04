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
 * [WORLD_MIN_CHUNK, WORLD_MAX_CHUNK] on either axis are never generated. Shrunk from 12 to 8 per
 * user feedback that the 1200x1200 world still felt too large to reach the edges of. */
export const WORLD_SIZE_CHUNKS = 8;
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
/** Narrowed from 60-100 to 65-90: isSiteClear rejects any site whose radius plus its distance from
 * spawn/world-edge doesn't fit the available annulus, which - given ENEMY_RING_BASE_RADIUS,
 * ZONE_EDGE_MARGIN, and WORLD_EDGE_RAMP_START below - makes radii above ~92 always fail regardless
 * of position. The old 60-100 range wasted roughly a third of its rolls on sites that could never
 * pass; this range stays fully inside the feasible band so no roll is wasted. */
export const FLAT_ZONE_RADIUS_MIN = 65;
export const FLAT_ZONE_RADIUS_MAX = 90;
/** Raised from 0.6 - a town needs a genuinely large flat plateau to fit 30+ buildings without
 * their footprints creeping onto the smoothstep rim (still-sloping ground near the zone's edge). */
export const FLAT_ZONE_INNER_FRACTION = 0.85;

export const FOREST_ZONE_SEED_OFFSET = 11;
/** Raised from 160 to stay comfortably above 2x the max radius below (avoids frequent site-overlap
 * rejections at the larger radius - see the matching FLAT_ZONE_CELL_SIZE comment). */
export const FOREST_ZONE_CELL_SIZE = 200;
export const FOREST_ZONE_DENSITY = 0.45;
/** Raised from 50-90 per project decision ("forest radius should increase a lot"), pushed right up
 * to the world's geometric ceiling: isSiteClear (see below) rejects any site whose radius plus its
 * distance from spawn/world-edge doesn't fit the available annulus, which given
 * ENEMY_RING_BASE_RADIUS, ZONE_EDGE_MARGIN, and WORLD_EDGE_RAMP_START makes radii above ~92 always
 * fail regardless of position - this is the largest a forest zone can ever be without enlarging the
 * world itself (WORLD_BOUNDARY_RADIUS). */
export const FOREST_ZONE_RADIUS_MIN = 78;
export const FOREST_ZONE_RADIUS_MAX = 92;
export const FOREST_ZONE_INNER_FRACTION = 0.6;

/** Keeps zone sites clear of both the world edge (mountain ring/hard clamp) and the spawn/combat
 * ring, at the zone-presence level so a town or forest can never partially spill into either. */
export const ZONE_EDGE_MARGIN = 30;

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
 * Buildings (WORLD_PLAN.md §3, later revised into town clusters per user feedback): not enterable,
 * solid exterior only - real premade structures from Kenney's Modular Buildings kit (CC0), not a
 * plain box. Placement is now town-clustered within flat zones rather than one-per-chunk - see
 * TOWN_* constants near the zone system below, and BuildingManager.ts. The building's own box
 * collider top face doubles as the rooftop landing surface - no separate platform collider is
 * needed since an axis-aligned box's top is already flat and walkable.
 */

export const DEFAULT_ENEMY_COUNT = 3;
export const DEFAULT_TARGET_COUNT = 5;
export const MAX_MATCH_ENTITY_COUNT = 50;
