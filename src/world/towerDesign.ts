import * as THREE from 'three';
import { CONTACT_SHADOW_LIFT, createContactShadowGeometry, createContactShadowMaterial } from '../render/contactShadows.ts';
import { addRailing, box, boxAlong, PieceCollector, type BoxTransform, type PieceMaterial } from './structureKit.ts';
import {
  WATCH_TOWER_HALF_WIDTH,
  WATCH_TOWER_HEIGHT,
  WATCH_TOWER_RAILING_HEIGHT,
  WATCH_TOWER_ROOF_CLEARANCE,
  WATCH_TOWER_STAIR_WIDTH,
} from '../core/config.ts';

/**
 * The watch tower, rebuilt in the Opus station language (docs/world-redesign.md): a concrete core,
 * five steel stair flights with real treads wrapping it, a grated lookout deck the full width of the
 * stairs, and a roofed lookout with a mast on top. Every solid part is one TowerPart, built as both
 * its collider and its mesh (towerParts); the detail nobody can touch (treads, stringers, braces,
 * lamps, the mast) is drawn on top of it (createTowerVisual).
 *
 * The stairs are a real switchback: a flat landing in each corner and one flight along each face
 * between them, each flight a tilted ramp collider under the treads whose walking surface meets
 * both landings flush. A character controller climbs a smooth ramp every time; it stumbles on
 * discrete steps, which is why the first towers used ramps, kept here. Those first towers ran
 * every ramp to the corner's centre and sat the landing on top, so each landing's edge stood half a
 * metre proud of the ramp arriving at it, right at the autostep limit (towerDesign.test.ts climbs
 * the stairs with the player's own controller settings and stalled there). A face is only 6 m
 * between landings, so the climb takes five flights (one and a quarter turns) at 28 degrees,
 * clear of the 35 degree slide angle.
 *
 * The deck covers the whole tower, and the last flight climbs through a stairwell left open in it
 * along the south face, onto the deck's south-east corner. (The old deck stopped short of the stair
 * lanes, so the last flight ran into its underside, and was then swung 15 degrees off the wall.)
 */

const H = WATCH_TOWER_HEIGHT;
const HW = WATCH_TOWER_HALF_WIDTH;
const W = WATCH_TOWER_STAIR_WIDTH;
const RAIL_HEIGHT = WATCH_TOWER_RAILING_HEIGHT;
const RAMP_HALF_THICKNESS = 0.2;
const LANDING_HALF_THICKNESS = 0.15;
const RAIL_HALF_THICKNESS = 0.1;
/** The deck's walking surface. */
const DECK_TOP = H + LANDING_HALF_THICKNESS;
const FLIGHT_COUNT = 5;
const FLIGHT_RISE = DECK_TOP / FLIGHT_COUNT;
/** Centre line of the stair lanes, flush against the core's faces. */
const STAIR_OFFSET = HW + W / 2;
/** The deck reaches the stairs' outer edge on every side. */
export const TOWER_DECK_HALF = STAIR_OFFSET + W / 2;
/** Farthest any solid part reaches from the tower's centre (the deck's corner), shared by
 * placement, terrain flattening and spawn and vegetation clearance. Unchanged from the old design,
 * whose stair corners reached the same square. */
export const WATCH_TOWER_FOOTPRINT_RADIUS = Math.SQRT2 * TOWER_DECK_HALF;
/** The stairwell over the last flight runs from here east to the top landing. West of it the flight
 * below is under 13.8 m, so a player's head clears the deck's underside. */
const STAIRWELL_WEST_X = -1.5;
const ROOF_THICKNESS = 0.24;
export const WATCH_TOWER_ROOF_TOP = H + WATCH_TOWER_ROOF_CLEARANCE + ROOF_THICKNESS;
const ROOF_POST_SIZE = 0.24;
const STEP_RISE_TARGET = 0.2;
/** How far each ramp runs on under the landings at its ends, so no gap opens at the joint. */
const RAMP_OVERLAP = 0.05;

/** Corner landings by the turn they serve, counter-clockwise from the south-west seen from above:
 * centre and walking-surface height. The ground is landing 0 and the deck's south-east corner the
 * last. */
const CORNER_SIGNS: readonly [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
export const TOWER_LANDINGS: readonly THREE.Vector3[] = Array.from({ length: FLIGHT_COUNT + 1 }, (_, k) => {
  const [sx, sz] = CORNER_SIGNS[k % 4]!;
  return new THREE.Vector3(sx * STAIR_OFFSET, FLIGHT_RISE * k, sz * STAIR_OFFSET);
});

/** Where flight k's walking surface leaves landing k and meets landing k + 1: the landings' facing
 * edges, at their heights. */
function flightSurface(k: number): { start: THREE.Vector3; end: THREE.Vector3 } {
  const from = TOWER_LANDINGS[k]!;
  const to = TOWER_LANDINGS[k + 1]!;
  const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
  return {
    start: from.clone().addScaledVector(direction, W / 2),
    end: to.clone().addScaledVector(direction, -W / 2),
  };
}

export interface TowerPart {
  readonly box: BoxTransform;
  readonly material: PieceMaterial;
  /** Drawn as a guard rail (panel, cap and posts) rather than a plain box. */
  readonly rail?: boolean;
}

/** A flight's ramp: a tilted slab whose top face is the walking surface from start to end,
 * lengthened a little under each landing. */
function rampBox(start: THREE.Vector3, end: THREE.Vector3): BoxTransform {
  const along = new THREE.Vector3().subVectors(end, start).normalize();
  const slab = boxAlong(start.clone().addScaledVector(along, -RAMP_OVERLAP), end.clone().addScaledVector(along, RAMP_OVERLAP), RAMP_HALF_THICKNESS * 2, W);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(slab.rotation);
  return { ...slab, center: slab.center.clone().addScaledVector(up, -RAMP_HALF_THICKNESS) };
}

/** The direction from a flight's lane out away from the core. */
function outwardOf(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3 {
  const horizontal = new THREE.Vector3(end.x - start.x, 0, end.z - start.z).normalize();
  const perpendicular = new THREE.Vector3(-horizontal.z, 0, horizontal.x);
  const middle = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5).setY(0);
  return middle.clone().add(perpendicular).lengthSq() > middle.lengthSq() ? perpendicular : perpendicular.negate();
}

/** A rail along a flight's outer edge, standing on the walking surface, flush against the ramp's
 * side (offset by half the stair width plus its own half thickness, so the two never overlap:
 * overlapping solids under a walking capsule flung players off in the first towers). */
function flightRail(start: THREE.Vector3, end: THREE.Vector3): BoxTransform {
  const outward = outwardOf(start, end);
  const offset = W / 2 + RAIL_HALF_THICKNESS;
  const railStart = start.clone().addScaledVector(outward, offset).setY(start.y + RAIL_HEIGHT / 2);
  const railEnd = end.clone().addScaledVector(outward, offset).setY(end.y + RAIL_HEIGHT / 2);
  return boxAlong(railStart, railEnd, RAIL_HEIGHT, RAIL_HALF_THICKNESS * 2);
}

/** An axis-aligned rail with local X along its run, as addRailing expects. */
function railBox(cx: number, cy: number, cz: number, length: number, height: number, thickness: number, axis: 'x' | 'z'): BoxTransform {
  return axis === 'z'
    ? boxAlong(new THREE.Vector3(cx, cy, cz - length / 2), new THREE.Vector3(cx, cy, cz + length / 2), height, thickness)
    : box(cx, cy, cz, length, height, thickness);
}

/** A corner landing's two outer sides, meeting square at its outer corner. */
function landingRails(corner: THREE.Vector3): BoxTransform[] {
  const sx = Math.sign(corner.x);
  const sz = Math.sign(corner.z);
  const length = W + RAIL_HALF_THICKNESS * 4;
  const offset = W / 2 + RAIL_HALF_THICKNESS;
  const y = corner.y + RAIL_HEIGHT / 2;
  return [
    railBox(corner.x + sx * offset, y, corner.z + sz * RAIL_HALF_THICKNESS, length, RAIL_HEIGHT, RAIL_HALF_THICKNESS * 2, 'z'),
    railBox(corner.x + sx * RAIL_HALF_THICKNESS, y, corner.z + sz * offset, length, RAIL_HEIGHT, RAIL_HALF_THICKNESS * 2, 'x'),
  ];
}

/** Every solid part of a tower, in its local frame. Each one becomes a collider and a mesh. */
export function towerParts(): TowerPart[] {
  const parts: TowerPart[] = [];
  const add = (b: BoxTransform, material: PieceMaterial, rail = false) => parts.push({ box: b, material, rail });

  add(box(0, H / 2, 0, HW * 2, H, HW * 2), 'concrete');

  for (let k = 0; k < FLIGHT_COUNT; k++) {
    const { start, end } = flightSurface(k);
    add(rampBox(start, end), 'steel');
    add(flightRail(start, end), 'perforated', true);
  }
  // The landings between flights: the ground is the first and the deck the last.
  for (let k = 1; k < FLIGHT_COUNT; k++) {
    const corner = TOWER_LANDINGS[k]!;
    add(box(corner.x, corner.y - LANDING_HALF_THICKNESS, corner.z, W, LANDING_HALF_THICKNESS * 2, W), 'grating');
    for (const rail of landingRails(corner)) add(rail, 'perforated', true);
  }

  // The deck in three slabs around the stairwell over the last flight (the south lane, from
  // STAIRWELL_WEST_X east to the core's corner): all of it north of the south lane, the south
  // lane west of the well, and the top landing in the south-east corner.
  const D = TOWER_DECK_HALF;
  const slab = (x0: number, x1: number, z0: number, z1: number) => add(box((x0 + x1) / 2, H, (z0 + z1) / 2, x1 - x0, LANDING_HALF_THICKNESS * 2, z1 - z0), 'grating');
  slab(-D, D, -HW, D);
  slab(-D, STAIRWELL_WEST_X, -D, -HW);
  slab(HW, D, -D, -HW);

  // Guard rails: the deck's edge on all four sides, and the stairwell's north and west sides.
  const railY = H + RAIL_HEIGHT / 2;
  const edge = D + RAIL_HALF_THICKNESS;
  const span = (D + RAIL_HALF_THICKNESS * 2) * 2;
  add(railBox(0, railY, -edge, span, RAIL_HEIGHT, RAIL_HALF_THICKNESS * 2, 'x'), 'perforated', true);
  add(railBox(0, railY, edge, span, RAIL_HEIGHT, RAIL_HALF_THICKNESS * 2, 'x'), 'perforated', true);
  add(railBox(-edge, railY, 0, span, RAIL_HEIGHT, RAIL_HALF_THICKNESS * 2, 'z'), 'perforated', true);
  add(railBox(edge, railY, 0, span, RAIL_HEIGHT, RAIL_HALF_THICKNESS * 2, 'z'), 'perforated', true);
  add(railBox((STAIRWELL_WEST_X + HW) / 2, railY, -HW + RAIL_HALF_THICKNESS, HW - STAIRWELL_WEST_X, RAIL_HEIGHT, RAIL_HALF_THICKNESS * 2, 'x'), 'perforated', true);
  add(railBox(STAIRWELL_WEST_X - RAIL_HALF_THICKNESS, railY, (-D - HW) / 2, D - HW, RAIL_HEIGHT, RAIL_HALF_THICKNESS * 2, 'z'), 'perforated', true);

  // The lookout roof on four corner posts: cover from above for whoever holds the tower.
  const postHeight = WATCH_TOWER_ROOF_CLEARANCE - LANDING_HALF_THICKNESS;
  const postAt = D - ROOF_POST_SIZE / 2;
  for (const [px, pz] of CORNER_SIGNS) {
    add(box(px * postAt, DECK_TOP + postHeight / 2, pz * postAt, ROOF_POST_SIZE, postHeight, ROOF_POST_SIZE), 'steel');
  }
  const roofSide = (D + 0.3) * 2;
  add(box(0, H + WATCH_TOWER_ROOF_CLEARANCE + ROOF_THICKNESS / 2, 0, roofSide, ROOF_THICKNESS, roofSide), 'roof');

  return parts;
}

/** Steel treads along one flight, centred on the ramp's walking surface: a player's feet are
 * never more than half a riser off the tread under them. */
function addTreads(pieces: PieceCollector, start: THREE.Vector3, end: THREE.Vector3): void {
  const delta = new THREE.Vector3().subVectors(end, start);
  const run = Math.hypot(delta.x, delta.z);
  const steps = Math.max(1, Math.round(delta.y / STEP_RISE_TARGET));
  const direction = new THREE.Vector3(delta.x, 0, delta.z).normalize();
  const yaw = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);
  const blockHeight = delta.y / steps + 0.12;
  for (let i = 0; i < steps; i++) {
    const centre = start.clone().addScaledVector(delta, (i + 0.5) / steps);
    centre.y -= blockHeight / 2;
    pieces.addBox('grating', { center: centre, rotation: yaw, halfExtents: new THREE.Vector3(run / steps / 2, blockHeight / 2, W / 2 - 0.08) });
  }
  // A steel stringer along the outer edge, its top just above the treads' nosings.
  const shift = outwardOf(start, end).multiplyScalar(W / 2 - 0.06);
  shift.y = -0.11;
  pieces.addBox('steel', boxAlong(start.clone().add(shift), end.clone().add(shift), 0.42, 0.1));
}

/** The mast on the roof: a steel pole with a cross arm, a small equipment box with a work lamp,
 * and the red aviation light on top that marks a tower across the valley at dusk. */
function addMast(pieces: PieceCollector): void {
  const base = WATCH_TOWER_ROOF_TOP;
  const mastHeight = 3.4;
  pieces.add('steel', new THREE.CylinderGeometry(0.07, 0.09, mastHeight, 8), new THREE.Matrix4().makeTranslation(0, base + mastHeight / 2, 0));
  pieces.addBox('steel', box(0, base + mastHeight * 0.72, 0, 1.6, 0.06, 0.06));
  pieces.addBox('steel', box(1.8, base + 0.35, -1.6, 1.1, 0.7, 0.8));
  pieces.addBox('lamp', box(1.8, base + 0.55, -1.19, 0.18, 0.1, 0.02));
  pieces.add('warning', new THREE.SphereGeometry(0.13, 10, 8), new THREE.Matrix4().makeTranslation(0, base + mastHeight + 0.1, 0));
}

/** Detail on the core and under the deck: hazard bands, windows, a door, braces, deck fascia. */
function addCoreDetail(pieces: PieceCollector): void {
  const D = TOWER_DECK_HALF;
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(nx, nz));
    const onFace = (lateral: number, y: number, out: number) => new THREE.Vector3(nx * (HW + out) + nz * lateral, y, nz * (HW + out) - nx * lateral);
    // A hazard band at the foot of the core and lit slit windows up each face.
    pieces.addBox('hazard', { center: onFace(0, 0.25, 0.015), rotation: yaw, halfExtents: new THREE.Vector3(HW + 0.03, 0.25, 0.015) });
    for (const y of [3.2, 7.2, 11.2]) {
      pieces.addBox('steel', { center: onFace(0, y, 0.02), rotation: yaw, halfExtents: new THREE.Vector3(0.5, 0.8, 0.02) });
      pieces.addBox('window', { center: onFace(0, y, 0.035), rotation: yaw, halfExtents: new THREE.Vector3(0.38, 0.68, 0.01) });
    }
    // Hazard fascia round the deck's edge, under the guard rail.
    pieces.addBox('hazard', { center: new THREE.Vector3(nx * (D + 0.05), H - 0.12, nz * (D + 0.05)), rotation: yaw, halfExtents: new THREE.Vector3(D + 0.1, 0.27, 0.05) });
    // Braces from the core up to the deck's edge, except on the south face, where the last flight
    // climbs through that space.
    if (nz === -1) continue;
    for (const lateral of [-1.5, 1.5]) {
      pieces.addBox('steel', boxAlong(onFace(lateral, H - 2.6, 0), onFace(lateral, H - 0.2, D - HW - 0.1), 0.16, 0.16));
    }
  }
  // A steel door on the east face at ground level, under the second flight, with a lamp over it.
  pieces.addBox('steel', box(HW + 0.04, 1.1, 0, 0.08, 2.2, 1.2));
  pieces.addBox('hazard', box(HW + 0.03, 2.32, 0, 0.06, 0.12, 1.4));
  pieces.addBox('lamp', box(HW + 0.06, 2.55, 0, 0.06, 0.12, 0.4));
  // Steel fascia round the roof's edge and two work lamps under it.
  const roofEdge = D + 0.3;
  const fasciaY = H + WATCH_TOWER_ROOF_CLEARANCE + 0.02;
  pieces.addBox('steel', box(0, fasciaY, -roofEdge, roofEdge * 2, 0.3, 0.06));
  pieces.addBox('steel', box(0, fasciaY, roofEdge, roofEdge * 2, 0.3, 0.06));
  pieces.addBox('steel', box(-roofEdge, fasciaY, 0, 0.06, 0.3, roofEdge * 2));
  pieces.addBox('steel', box(roofEdge, fasciaY, 0, 0.06, 0.3, roofEdge * 2));
  for (const x of [-2, 2]) pieces.addBox('lamp', box(x, H + WATCH_TOWER_ROOF_CLEARANCE - 0.03, 0, 0.6, 0.05, 0.25));
}

/** The whole tower's look: its solid parts (towerParts, the same boxes as its colliders) plus the
 * detail on top. One mesh per material. Also used without colliders for the title screen's valley. */
export function createTowerVisual(): THREE.Group {
  const pieces = new PieceCollector();
  for (const part of towerParts()) {
    if (part.rail) addRailing(pieces, part.box);
    else pieces.addBox(part.material, part.box);
  }
  for (let k = 0; k < FLIGHT_COUNT; k++) {
    const { start, end } = flightSurface(k);
    addTreads(pieces, start, end);
  }
  addCoreDetail(pieces);
  addMast(pieces);
  const group = pieces.build();

  // A soft dark square under the core and stairs, added after the shadow flags so it casts none.
  const contactShadow = new THREE.Mesh(createContactShadowGeometry(), createContactShadowMaterial('rect', 0.6));
  const contactSide = TOWER_DECK_HALF * 2 + 2.4;
  contactShadow.scale.set(contactSide, 1, contactSide);
  contactShadow.position.y = CONTACT_SHADOW_LIFT;
  contactShadow.renderOrder = -1;
  group.add(contactShadow);
  return group;
}
