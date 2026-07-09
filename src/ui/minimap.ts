import * as THREE from 'three';
import { MINIMAP_WORLD_RADIUS } from '../core/config.ts';
import type { PlayerSlot } from '../network/protocol.ts';
import { ensureMotionKeyframesInjected } from './menu/menuStyles.ts';

const MAP_DIAMETER_PX = 140;
const MAP_RADIUS_PX = MAP_DIAMETER_PX / 2;
const DOT_SIZE_PX = 10;

/** Opponent-position radar, top-right of the HUD - multiplayer only, a `Hud` sibling rather than
 * part of it (see hitMarker.ts/killFeed.ts for the same one-class-per-widget pattern this project
 * already uses). Player-relative ("forward" is always "up" on the map, rotating with the local
 * player's current look direction) - per playtest feedback that the map showed distance well but
 * not which way to actually turn to face an opponent. A world-oriented (north-up) map technically
 * already encoded direction, but reading it mid-combat requires knowing your own current heading,
 * which nothing else on screen shows - a player-relative map needs no such translation: the small
 * forward wedge at the map's center is a fixed reference, and each dot's position relative to it
 * directly answers "turn left/right." Up to 3 dots (one per opponent), added/removed live as
 * players join/leave a match. */
export class Minimap {
  private readonly root: HTMLDivElement;
  private readonly dots = new Map<PlayerSlot, HTMLDivElement>();
  /** Goose Horde ammo crates (per explicit user request: "shown on the maps of both players with
   * green dot indicators") - string-keyed (crate ids, not player slots) since there can be more
   * than MULTIPLAYER_MAX_PLAYERS of them and they're a different kind of thing entirely. Static
   * once added (crates don't move) but still needs the same per-frame rotate-with-player-facing
   * treatment as an opponent dot, so it lives in update() too, not a one-time placement. */
  private readonly itemDots = new Map<string, HTMLDivElement>();

  constructor(hudRoot: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      `position:absolute; top:24px; right:24px; width:${MAP_DIAMETER_PX}px; height:${MAP_DIAMETER_PX}px;` +
      ' border-radius:50%; border:2px solid rgba(255,255,255,0.35); background:rgba(0,0,0,0.35);' +
      ' overflow:hidden;';

    // A fixed forward-facing wedge at the map's own center, standing in for the local player -
    // always points "up" since the whole map rotates around the player instead of the player's
    // marker rotating within a fixed map. Gives each opponent dot's position an actual reference
    // to read "turn left/right" from, not just "they're somewhere over there."
    const forwardWedge = document.createElement('div');
    forwardWedge.style.cssText =
      'position:absolute; width:0; height:0; border-left:5px solid transparent;' +
      ' border-right:5px solid transparent; border-bottom:9px solid #fff;' +
      ` left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -70%);`;
    this.root.appendChild(forwardWedge);

    hudRoot.appendChild(this.root);
  }

  addDot(slot: PlayerSlot): void {
    if (this.dots.has(slot)) return;
    ensureMotionKeyframesInjected();
    const dot = document.createElement('div');
    // A slow, continuous pulse (opacity, via the shared pulseGlow keyframe) - reads as a live
    // radar blip rather than a static marker. Independent of the per-frame left/top writes in
    // update() below (different CSS properties), so it's set once here and never touched again.
    dot.style.cssText =
      `position:absolute; width:${DOT_SIZE_PX}px; height:${DOT_SIZE_PX}px; border-radius:50%;` +
      ' background:#e0483c; box-shadow:0 0 4px 1px rgba(224,72,60,0.8);' +
      ` left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -50%);` +
      ' animation:pulseGlow 1.6s ease-in-out infinite;';
    this.root.appendChild(dot);
    this.dots.set(slot, dot);
  }

  removeDot(slot: PlayerSlot): void {
    this.dots.get(slot)?.remove();
    this.dots.delete(slot);
  }

  addItemDot(id: string): void {
    if (this.itemDots.has(id)) return;
    const dot = document.createElement('div');
    dot.style.cssText =
      `position:absolute; width:${DOT_SIZE_PX - 2}px; height:${DOT_SIZE_PX - 2}px; border-radius:50%;` +
      ' background:#3ecf5f; box-shadow:0 0 4px 1px rgba(62,207,95,0.8);' +
      ` left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -50%);`;
    this.root.appendChild(dot);
    this.itemDots.set(id, dot);
  }

  removeItemDot(id: string): void {
    this.itemDots.get(id)?.remove();
    this.itemDots.delete(id);
  }

  /** `localPosition`/positions in `opponents` are full world positions (Y ignored - this is a
   * top-down XZ projection). `localFacingYaw` is the local player's current yaw
   * (Player.facingYaw) - each opponent's world-space offset is rotated by -yaw so the player's
   * actual forward direction always maps to "up" on the map, regardless of which way they're
   * currently facing. */
  update(
    localPosition: THREE.Vector3,
    opponents: ReadonlyMap<PlayerSlot, THREE.Vector3>,
    localFacingYaw: number,
    /** Goose Horde ammo crates - see addItemDot's own comment. Absent for every other mode. */
    items?: ReadonlyMap<string, THREE.Vector3>,
  ): void {
    // Same rotation Player.ts uses to turn its own yaw into a forward vector, applied here to each
    // opponent's relative offset instead - rotating by -yaw undoes the player's own turn, so
    // "forward" always lands at world -Z (which the unrotated map already treated as "up").
    const yawQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -localFacingYaw, 0, 'YXZ'));

    for (const [slot, dot] of this.dots) {
      const opponentPosition = opponents.get(slot);
      if (!opponentPosition) continue;
      placeDot(dot, localPosition, opponentPosition, yawQuat);
    }

    if (!items) return;
    for (const [id, dot] of this.itemDots) {
      const itemPosition = items.get(id);
      if (!itemPosition) continue;
      placeDot(dot, localPosition, itemPosition, yawQuat);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/** Shared by both the opponent-dot and item-dot loops in update() above - projects a world-space
 * offset into the map's rotated, distance-clamped screen space and writes it onto one dot element. */
function placeDot(dot: HTMLDivElement, localPosition: THREE.Vector3, targetPosition: THREE.Vector3, yawQuat: THREE.Quaternion): void {
  const dx = targetPosition.x - localPosition.x;
  const dz = targetPosition.z - localPosition.z;
  const distance = Math.hypot(dx, dz);

  const rotated = new THREE.Vector3(dx, 0, dz).applyQuaternion(yawQuat);
  const scale = distance <= MINIMAP_WORLD_RADIUS ? MAP_RADIUS_PX / MINIMAP_WORLD_RADIUS : MAP_RADIUS_PX / distance;

  dot.style.left = `${MAP_RADIUS_PX + rotated.x * scale}px`;
  dot.style.top = `${MAP_RADIUS_PX + rotated.z * scale}px`;
}
