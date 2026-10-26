/**
 * Ids for the Valley houses' doors and ceiling lamps (docs/enterable-buildings.md), pure. A house is
 * named by its town's flat-zone cell (gx, gz) and its index in that town's layout, which every
 * client derives identically from the seed (BuildingManager.getTownLayout), streamed in or not. The
 * ids are plain non-negative integers so they ride the existing worldInteract message unchanged.
 */

import { FLAT_ZONE_CELL_SIZE, FLAT_ZONE_RADIUS_MAX, WORLD_BOUNDARY_RADIUS } from '../../core/config.ts';

/** Cells are offset by this so they pack as non-negative numbers (50 m cells: +-100 km). */
const CELL_OFFSET = 2048;
const CELL_SPAN = CELL_OFFSET * 2;
/** Towns hold at most TOWN_MAX_BUILDINGS (20) houses. */
const INDEX_SPAN = 64;
/** Doors per house and lamps (rooms) per house each get this many slots. */
const SLOT_SPAN = 4;

export interface HouseRef {
  readonly gx: number;
  readonly gz: number;
  readonly index: number;
}

const inCellRange = (cell: number): boolean => Number.isInteger(cell) && cell >= -CELL_OFFSET && cell < CELL_OFFSET;

/** One number per house, or -1 when the reference is out of range. */
export function houseKey(ref: HouseRef): number {
  if (!inCellRange(ref.gx) || !inCellRange(ref.gz) || !Number.isInteger(ref.index) || ref.index < 0 || ref.index >= INDEX_SPAN) return -1;
  return ((ref.gx + CELL_OFFSET) * CELL_SPAN + (ref.gz + CELL_OFFSET)) * INDEX_SPAN + ref.index;
}

export function houseFromKey(key: number): HouseRef | null {
  if (!Number.isSafeInteger(key) || key < 0 || key >= CELL_SPAN * CELL_SPAN * INDEX_SPAN) return null;
  const index = key % INDEX_SPAN, cells = Math.floor(key / INDEX_SPAN);
  return { gx: Math.floor(cells / CELL_SPAN) - CELL_OFFSET, gz: (cells % CELL_SPAN) - CELL_OFFSET, index };
}

/** A house's door (`door` 0 is its front door) or ceiling lamp (`slot` is the room's index). */
export function houseObjectId(key: number, slot: number): number {
  if (key < 0 || !Number.isInteger(slot) || slot < 0 || slot >= SLOT_SPAN) return -1;
  return key * SLOT_SPAN + slot;
}

/** The house and slot an id names, or null for anything that is not a well-formed id. */
export function parseHouseObjectId(id: number): { house: HouseRef; key: number; slot: number } | null {
  if (!Number.isSafeInteger(id) || id < 0) return null;
  const key = Math.floor(id / SLOT_SPAN), house = houseFromKey(key);
  return house ? { house, key, slot: id % SLOT_SPAN } : null;
}

/** The farthest flat-zone cell from the centre on either axis that can hold a town inside the world
 * (the same reach as BuildingManager.getWorldTowns over WORLD_BOUNDARY_RADIUS). */
export const HOUSE_CELL_REACH = Math.ceil((WORLD_BOUNDARY_RADIUS + FLAT_ZONE_RADIUS_MAX) / FLAT_ZONE_CELL_SIZE);

/** Whether `ref`'s town can lie inside the world. The id format reaches 2048 cells each way, and
 * looking a house up builds and caches its town's whole layout, so an id from a peer is checked with
 * this first: a stream of far ids would otherwise cost every receiver thousands of layout builds and
 * grow those caches without bound. */
export function isHouseInWorld(ref: HouseRef): boolean {
  return Math.abs(ref.gx) <= HOUSE_CELL_REACH && Math.abs(ref.gz) <= HOUSE_CELL_REACH;
}

/** The same house's string id BuildingManager keys its placed houses by. */
export const houseRefName = (ref: HouseRef): string => `${ref.gx},${ref.gz}:${ref.index}`;
