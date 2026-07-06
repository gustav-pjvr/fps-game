import * as THREE from 'three';
import { MINIMAP_WORLD_RADIUS } from '../core/config.ts';

const MAP_DIAMETER_PX = 140;
const MAP_RADIUS_PX = MAP_DIAMETER_PX / 2;
const DOT_SIZE_PX = 10;

/** Opponent-position radar, top-right of the HUD (MULTIPLAYER_PLAN.md §4b) - multiplayer only, a
 * `Hud` sibling rather than part of it (see hitMarker.ts/killFeed.ts for the same
 * one-class-per-widget pattern this project already uses). World-oriented (north/-Z is always "up"
 * on the map, not rotated to face the local player's current look direction) - simpler to get right
 * for a first version; a player-relative rotating map is a documented possible upgrade. */
export class Minimap {
  private readonly root: HTMLDivElement;
  private readonly dot: HTMLDivElement;

  constructor(hudRoot: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      `position:absolute; top:24px; right:24px; width:${MAP_DIAMETER_PX}px; height:${MAP_DIAMETER_PX}px;` +
      ' border-radius:50%; border:2px solid rgba(255,255,255,0.35); background:rgba(0,0,0,0.35);' +
      ' overflow:hidden;';

    this.dot = document.createElement('div');
    this.dot.style.cssText =
      `position:absolute; width:${DOT_SIZE_PX}px; height:${DOT_SIZE_PX}px; border-radius:50%;` +
      ' background:#e0483c; box-shadow:0 0 4px 1px rgba(224,72,60,0.8);' +
      ` left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -50%);`;
    this.root.appendChild(this.dot);

    // A small mark at the map's own center for the local player - purely a visual anchor so the
    // opponent's dot reads as "relative to you," not floating in an otherwise-empty circle.
    const center = document.createElement('div');
    center.style.cssText =
      'position:absolute; width:6px; height:6px; border-radius:50%; background:#fff;' +
      ` left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -50%);`;
    this.root.appendChild(center);

    hudRoot.appendChild(this.root);
  }

  /** `localPosition`/`opponentPosition` are full world positions (Y ignored - this is a top-down
   * XZ projection). Forward in this engine is -Z, +X is right, so world offsets map onto
   * screen-space offsets with no axis inversion needed. */
  update(localPosition: THREE.Vector3, opponentPosition: THREE.Vector3): void {
    const dx = opponentPosition.x - localPosition.x;
    const dz = opponentPosition.z - localPosition.z;
    const distance = Math.hypot(dx, dz);

    const scale = distance <= MINIMAP_WORLD_RADIUS ? MAP_RADIUS_PX / MINIMAP_WORLD_RADIUS : MAP_RADIUS_PX / distance;
    const offsetX = dx * scale;
    const offsetZ = dz * scale;

    this.dot.style.left = `${MAP_RADIUS_PX + offsetX}px`;
    this.dot.style.top = `${MAP_RADIUS_PX + offsetZ}px`;
  }

  dispose(): void {
    this.root.remove();
  }
}
