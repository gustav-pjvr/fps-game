export const FIXED_TIMESTEP = 1 / 60;
export const MAX_FRAME_TIME = 0.25;

export const WORLD_SEED = 1337;

export const CAMERA_FOV = 75;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 2000;

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
export const TERRAIN_OCTAVES = 4;
export const TERRAIN_BASE_FREQUENCY = 0.015;
export const TERRAIN_LACUNARITY = 2.0;
export const TERRAIN_PERSISTENCE = 0.5;
export const TERRAIN_AMPLITUDE = 8;

export const VIEW_RADIUS_CHUNKS = 2;
export const UNLOAD_RADIUS_CHUNKS = 3;
export const MAX_CHUNK_GENERATIONS_PER_TICK = 2;

export const DEFAULT_ENEMY_COUNT = 3;
export const DEFAULT_TARGET_COUNT = 5;
export const MAX_MATCH_ENTITY_COUNT = 50;
