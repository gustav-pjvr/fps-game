import * as THREE from 'three';
import { MINIMAP_WORLD_RADIUS } from '../core/config.ts';

const MAP_DIAMETER_PX = 140;
const MAP_RADIUS_PX = MAP_DIAMETER_PX / 2;
const DOT_SIZE_PX = 10;

/** Opponent-position radar, top-right of the HUD (MULTIPLAYER_PLAN.md §4b) - multiplayer only, a
 * `Hud` sibling rather than part of it (see hitMarker.ts/killFeed.ts for the same
 * one-class-per-widget pattern this project already uses). Player-relative ("forward" is always
 * "up" on the map, rotating with the local player's current look direction) - per playtest
 * feedback that the map showed distance well but not which way to actually turn to face the
 * opponent. A world-oriented (north-up) map technically already encoded direction, but reading it
 * mid-combat requires knowing your own current heading, which nothing else on screen shows - a
 * player-relative map needs no such translation: the small forward wedge at the map's center is a
 * fixed reference, and the dot's position relative to it directly answers "turn left/right." */
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

    // A fixed forward-facing wedge at the map's own center, standing in for the local player -
    // always points "up" since the whole map rotates around the player instead of the player's
    // marker rotating within a fixed map. Gives the opponent dot's position an actual reference
    // to read "turn left/right" from, not just "they're somewhere over there."
    const forwardWedge = document.createElement('div');
    forwardWedge.style.cssText =
      'position:absolute; width:0; height:0; border-left:5px solid transparent;' +
      ' border-right:5px solid transparent; border-bottom:9px solid #fff;' +
      ` left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -70%);`;
    this.root.appendChild(forwardWedge);

    hudRoot.appendChild(this.root);
  }

  /** `localPosition`/`opponentPosition` are full world positions (Y ignored - this is a top-down
   * XZ projection). `localFacingYaw` is the local player's current yaw (Player.facingYaw) - the
   * opponent's world-space offset is rotated by -yaw so the player's actual forward direction
   * always maps to "up" on the map, regardless of which way they're currently facing. */
  update(localPosition: THREE.Vector3, opponentPosition: THREE.Vector3, localFacingYaw: number): void {
    const dx = opponentPosition.x - localPosition.x;
    const dz = opponentPosition.z - localPosition.z;
    const distance = Math.hypot(dx, dz);

    // Same rotation Player.ts uses to turn its own yaw into a forward vector, applied here to the
    // opponent's relative offset instead - rotating by -yaw undoes the player's own turn, so
    // "forward" always lands at world -Z (which the unrotated map already treated as "up").
    const yawQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -localFacingYaw, 0, 'YXZ'));
    const rotated = new THREE.Vector3(dx, 0, dz).applyQuaternion(yawQuat);

    const scale = distance <= MINIMAP_WORLD_RADIUS ? MAP_RADIUS_PX / MINIMAP_WORLD_RADIUS : MAP_RADIUS_PX / distance;
    const offsetX = rotated.x * scale;
    const offsetZ = rotated.z * scale;

    this.dot.style.left = `${MAP_RADIUS_PX + offsetX}px`;
    this.dot.style.top = `${MAP_RADIUS_PX + offsetZ}px`;
  }

  dispose(): void {
    this.root.remove();
  }
}
