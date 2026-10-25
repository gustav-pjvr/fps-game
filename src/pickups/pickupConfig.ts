/** Pickup tuning (docs/squad-arsenal-night.md section 5, docs/pickups.md). Kept here, not in
 * core/config.ts, so the pickup branch stays out of that file's merge path. */

export type PickupKind = 'health' | 'ammo' | 'grenade';

export const PICKUP_KINDS: readonly PickupKind[] = ['health', 'ammo', 'grenade'];

/** Health a health pack restores (capped at the player's maximum). */
export const PICKUP_HEALTH_AMOUNT = 40;
/** Magazines an ammo box adds to every gun's reserve, and the reserve it stops giving at (a gun
 * whose reserve already holds this many magazines counts as full). */
export const PICKUP_AMMO_MAGAZINES = 1;
export const PICKUP_AMMO_RESERVE_CAP_MAGAZINES = 6;
/** What a grenade crate adds, and the most of each kind a player carries (section 3). */
export const PICKUP_GRENADE_FRAG = 1;
export const PICKUP_GRENADE_FLASH = 1;
export const PICKUP_GRENADE_CAP = 3;

/** Walk-over reach in metres (horizontal), and how far the player's centre may differ in height
 * from the pickup's centre so a pickup under a tower stair is not taken from the stair. */
export const PICKUP_RADIUS = 1.4;
export const PICKUP_VERTICAL_REACH = 1.6;
/** A guest's claim is only granted while the host sees that guest's avatar within this many metres
 * (the snapshot lag allowance on top of PICKUP_RADIUS). */
export const PICKUP_CLAIM_TOLERANCE = 4;
/** A guest does not re-send a claim for the same pickup sooner than this. */
export const PICKUP_CLAIM_RESEND_SECONDS = 0.6;

/** Seconds until a taken pickup returns. */
export const PICKUP_RESPAWN_SECONDS: Readonly<Record<PickupKind, number>> = { health: 30, ammo: 25, grenade: 45 };

/** The share of each kind among the placed pickups (about 45 / 40 / 15). A kind a mode does not
 * allow gives its share to the others in proportion. */
export const PICKUP_MIX: Readonly<Record<PickupKind, number>> = { health: 0.45, ammo: 0.4, grenade: 0.15 };

/** Offsets the match seed for placement, clear of every other seed offset in the game. */
export const PICKUP_SEED_OFFSET = 617;

/** Facility: expected pickups per room by room kind (one per room on average). */
export const PICKUP_FACILITY_PER_ROOM: Readonly<Record<'hall' | 'storage' | 'plant' | 'office', number>> = {
  hall: 1.3,
  storage: 1,
  plant: 1,
  office: 0.7,
};
/** Facility: pickups keep this far apart (metres), and this far clear of the walls' centre line. */
export const PICKUP_FACILITY_MIN_SPACING = 3;
export const PICKUP_FACILITY_CLEARANCE = 0.6;

/** Valley: pickups per map, how far a building pickup stands outside its footprint, and the other
 * clearances in metres. */
export const PICKUP_VALLEY_COUNT = 16;
export const PICKUP_VALLEY_BUILDING_OFFSET = 2;
export const PICKUP_VALLEY_BUILDING_MARGIN = 1;
export const PICKUP_VALLEY_ROAD_MARGIN = 1;
export const PICKUP_VALLEY_TOWER_OFFSET = 2.2;
export const PICKUP_VALLEY_TOWER_MARGIN = 1.5;
export const PICKUP_VALLEY_MIN_SPACING = 12;
/** Valley: the steepest ground (metres of rise over 3 m) a pickup may stand on. */
export const PICKUP_VALLEY_MAX_RISE = 1.2;

/** Visuals: how high the model floats above the ring on the ground, spin and bob, and how far from
 * the player pickups are drawn at all. */
export const PICKUP_HOVER_HEIGHT = 0.7;
export const PICKUP_SPIN_RATE = 1.1;
export const PICKUP_BOB_AMPLITUDE = 0.06;
export const PICKUP_BOB_RATE = 2;
export const PICKUP_VISIBLE_RANGE = 75;

/** Minimap: a pickup shows as an icon only within this many metres of the player. */
export const PICKUP_MINIMAP_RANGE = 25;
