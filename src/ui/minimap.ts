import * as THREE from 'three';
import { MINIMAP_WORLD_RADIUS } from '../core/config.ts';
import type { PlayerSlot } from '../network/protocol.ts';
import { ACCENT, AMBER, HAIRLINE, SURFACE, THREAT } from './theme.ts';
import type { PickupKind } from '../pickups/pickupConfig.ts';

const MAP_DIAMETER_PX = 140;
const MAP_RADIUS_PX = MAP_DIAMETER_PX / 2;
const DOT_SIZE_PX = 10;
/** An enemy blip stays up this long after the enemy stops, so a stop-start walk does not flicker. */
const BLIP_LINGER_MS = 500;

/** Something drawn under the dots (docs/facility-map.md, section 8): the Facility's plan, or the
 * Valley houses' plans once entered (ui/valleyHouseMapLayer.ts). */
export interface MinimapLayer {
  /** data-testid of the canvas the layer is drawn on. */
  readonly testId: string;
  /** Called with the player's position every update, before draw. */
  update(x: number, z: number): void;
  /** Draws in world metres (x to the right, z down the image); the minimap has already set the
   * transform that puts the player at the centre with their forward up (see minimapTransform). */
  draw(context: CanvasRenderingContext2D): void;
  /** A closer world radius the map should show for now (inside a Valley house, whose plan is a
   * few pixels at the Valley's radius), or null for the map's own. Asked after update. */
  zoomRadius?(): number | null;
}

/** A mode's objective on the map (the King of the Hill goose, an uplink, the extraction). */
export interface MinimapMarker {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

export interface MinimapPlayerDot {
  readonly x: number;
  readonly z: number;
  readonly underground: boolean;
}

/** Keep the dot's colour and footprint while changing a buried player into a ring. */
export function minimapDotStyle(underground: boolean, colour: string): { background: string; border: string } {
  return { background: underground ? 'transparent' : colour, border: underground ? '2px solid ' + colour : '2px solid transparent' };
}

export interface MinimapOptions {
  /** World metres from the centre to the rim; MINIMAP_WORLD_RADIUS by default. */
  readonly worldRadius?: number;
  readonly layer?: MinimapLayer;
}

/** A pickup icon's shape (a plus for health, a square for ammo, a diamond for a grenade crate) and
 * colour (the HUD mint, amber and threat red, as the pickup's ring). */
const PICKUP_ICON: Readonly<Record<PickupKind, { colour: string; clip: string; radius: string }>> = {
  health: { colour: ACCENT, radius: '0', clip: 'polygon(35% 0, 65% 0, 65% 35%, 100% 35%, 100% 65%, 65% 65%, 65% 100%, 35% 100%, 35% 65%, 0 65%, 0 35%, 35% 35%)' },
  ammo: { colour: AMBER, radius: '2px', clip: 'none' },
  grenade: { colour: THREAT, radius: '0', clip: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' },
};

/** A pickup the minimap draws (docs/pickups.md): the caller passes only those near enough to show. */
export interface MinimapPickup {
  readonly id: number;
  readonly kind: PickupKind;
  readonly x: number;
  readonly z: number;
}

/** A live enemy as the minimap sees it (EntityManager.liveEnemyMotion). */
export interface MinimapBlip {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly moving: boolean;
}

/** The 2D canvas transform (a, b, c, d, e, f) taking world (x, z) to map pixels: the player at
 * (centrePx, centrePx), their forward (yaw, Player.facingYaw) up, `pxPerMetre` scale. The same
 * mapping placeDot applies to the dots: rotate the offset by -yaw about Y, then scale. Pure. */
export function minimapTransform(
  playerX: number,
  playerZ: number,
  yaw: number,
  pxPerMetre: number,
  centrePx: number,
): [number, number, number, number, number, number] {
  const cos = Math.cos(yaw) * pxPerMetre;
  const sin = Math.sin(yaw) * pxPerMetre;
  // Screen x = cos * dx - sin * dz, screen y = sin * dx + cos * dz (plus the centre).
  return [cos, sin, -sin, cos, centrePx - cos * playerX + sin * playerZ, centrePx - sin * playerX - cos * playerZ];
}

/** Opponent-position radar, top-right of the HUD - multiplayer, plus single-player on the Facility (which draws its plan
 * under the dots through a MinimapLayer, docs/facility-map.md section 8) - a `Hud` sibling rather than
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
  private readonly localDot: HTMLDivElement;
  private readonly dots = new Map<PlayerSlot, { dot: HTMLDivElement; style: CSSStyleDeclaration; underground: boolean }>();
  private localUnderground = false;
  /** Goose Horde ammo crates (per explicit user request: "shown on the maps of both players with
   * green dot indicators") - string-keyed (crate ids, not player slots) since there can be more
   * than MULTIPLAYER_MAX_PLAYERS of them and they're a different kind of thing entirely. Static
   * once added (crates don't move) but still needs the same per-frame rotate-with-player-facing
   * treatment as an opponent dot, so it lives in update() too, not a one-time placement. */
  private readonly itemDots = new Map<string, HTMLDivElement>();
  /** Pickup icons (docs/pickups.md), keyed by pickup id; only the ones near the player exist. */
  private readonly pickupIcons = new Map<number, HTMLDivElement>();
  /** Single-player Facility enemies (docs/facility-map.md, section 8), keyed by entity id. */
  private readonly enemyDots = new Map<number, { dot: HTMLDivElement; lastMovedAt: number }>();
  /** Mode objectives (setMarkers), keyed by marker id. */
  private readonly markers = new Map<string, { dot: HTMLDivElement; x: number; z: number }>();
  private readonly worldRadius: number;
  /** This update's radius: the map's own, or the layer's zoom. */
  private radius: number;
  private readonly layer: MinimapLayer | null;
  private readonly layerCanvas: HTMLCanvasElement | null = null;
  private readonly layerContext: CanvasRenderingContext2D | null = null;
  private readonly forwardWedge: HTMLDivElement;

  constructor(hudRoot: HTMLElement, options: MinimapOptions = {}) {
    this.worldRadius = options.worldRadius ?? MINIMAP_WORLD_RADIUS;
    this.radius = this.worldRadius;
    this.layer = options.layer ?? null;
    this.root = document.createElement('div');
    this.root.style.cssText =
      `position:absolute; top:24px; right:24px; width:${MAP_DIAMETER_PX}px; height:${MAP_DIAMETER_PX}px;` +
      ` border-radius:50%; border:1px solid ${HAIRLINE}; background:${SURFACE}; backdrop-filter:blur(10px);` +
      ' overflow:hidden; pointer-events:none;';

    // The layer's canvas fills the circle under everything else (the root clips it round).
    if (this.layer) {
      const canvas = document.createElement('canvas');
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(MAP_DIAMETER_PX * pixelRatio);
      canvas.height = Math.round(MAP_DIAMETER_PX * pixelRatio);
      canvas.dataset.testid = this.layer.testId;
      canvas.style.cssText = `position:absolute; left:0; top:0; width:${MAP_DIAMETER_PX}px; height:${MAP_DIAMETER_PX}px;`;
      this.root.appendChild(canvas);
      this.layerCanvas = canvas;
      this.layerContext = canvas.getContext('2d');
    }

    // A fixed forward-facing wedge at the map's own center, standing in for the local player -
    // always points "up" since the whole map rotates around the player instead of the player's
    // marker rotating within a fixed map. Gives each opponent dot's position an actual reference
    // to read "turn left/right" from, not just "they're somewhere over there."
    const forwardWedge = document.createElement('div');
    this.forwardWedge = forwardWedge;
    forwardWedge.style.cssText =
      'position:absolute; width:0; height:0; border-left:5px solid transparent;' +
      ` border-right:5px solid transparent; border-bottom:9px solid ${ACCENT};` +
      ` left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -70%);`;
    this.root.appendChild(forwardWedge);
    this.localDot = document.createElement('div');
    const ring = minimapDotStyle(true, ACCENT);
    this.localDot.style.cssText =
      'position:absolute; width:10px; height:10px; border-radius:50%; box-sizing:border-box;' +
      ' background:' + ring.background + '; border:' + ring.border + '; display:none;' +
      ' left:' + MAP_RADIUS_PX + 'px; top:' + MAP_RADIUS_PX + 'px; transform:translate(-50%, -50%);';
    this.root.insertBefore(this.localDot, this.forwardWedge);

    hudRoot.appendChild(this.root);
  }

  addDot(slot: PlayerSlot): void {
    if (this.dots.has(slot)) return;
    const dot = document.createElement('div');
    dot.style.cssText =
      `position:absolute; width:${DOT_SIZE_PX}px; height:${DOT_SIZE_PX}px; border-radius:50%;` +
      ` box-sizing:border-box; background:${THREAT}; border:2px solid transparent; left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -50%);`;
    this.root.appendChild(dot);
    this.dots.set(slot, { dot, style: dot.style, underground: false });
  }

  removeDot(slot: PlayerSlot): void {
    this.dots.get(slot)?.dot.remove();
    this.dots.delete(slot);
  }

  addItemDot(id: string): void {
    if (this.itemDots.has(id)) return;
    const dot = document.createElement('div');
    dot.style.cssText =
      `position:absolute; width:${DOT_SIZE_PX - 2}px; height:${DOT_SIZE_PX - 2}px; border-radius:50%;` +
      ` background:${AMBER};` +
      ` left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -50%);`;
    this.root.appendChild(dot);
    this.itemDots.set(id, dot);
  }

  removeItemDot(id: string): void {
    this.itemDots.get(id)?.remove();
    this.itemDots.delete(id);
  }

  /** The mode's objectives, replacing the last set: a cyan diamond each, held at the rim like the
   * other dots while out of range, placed by update(). */
  setMarkers(markers: readonly MinimapMarker[]): void {
    const seen = new Set<string>();
    for (const { id, x, z } of markers) {
      seen.add(id);
      let entry = this.markers.get(id);
      if (!entry) {
        const dot = document.createElement('div');
        dot.dataset.testid = `minimap-marker-${id}`;
        dot.style.cssText =
          `position:absolute; width:${DOT_SIZE_PX - 1}px; height:${DOT_SIZE_PX - 1}px; background:${ACCENT};` +
          ` border:1px solid ${SURFACE}; left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -50%) rotate(45deg);`;
        this.root.insertBefore(dot, this.forwardWedge);
        entry = { dot, x, z };
        this.markers.set(id, entry);
      }
      entry.x = x;
      entry.z = z;
    }
    for (const [id, entry] of this.markers) {
      if (seen.has(id)) continue;
      entry.dot.remove();
      this.markers.delete(id);
    }
  }

  /** `localPosition`/positions in `opponents` are full world positions (Y ignored - this is a
   * top-down XZ projection). `localFacingYaw` is the local player's current yaw
   * (Player.facingYaw) - each opponent's world-space offset is rotated by -yaw so the player's
   * actual forward direction always maps to "up" on the map, regardless of which way they're
   * currently facing. */
  update(
    localPosition: THREE.Vector3,
    opponents: ReadonlyMap<PlayerSlot, MinimapPlayerDot>,
    localFacingYaw: number,
    /** Goose Horde ammo crates - see addItemDot's own comment. Absent for every other mode. */
    items?: ReadonlyMap<string, THREE.Vector3>,
    /** Single-player Facility enemies: shown inside the radius while they move. */
    enemies?: readonly MinimapBlip[],
    localUnderground = false,
  ): void {
    if (this.localUnderground !== localUnderground) {
      this.localUnderground = localUnderground;
      this.localDot.style.display = localUnderground ? '' : 'none';
    }
    // Same rotation Player.ts uses to turn its own yaw into a forward vector, applied here to each
    // opponent's relative offset instead - rotating by -yaw undoes the player's own turn, so
    // "forward" always lands at world -Z (which the unrotated map already treated as "up").
    const yawQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -localFacingYaw, 0, 'YXZ'));

    if (this.layer && this.layerCanvas && this.layerContext) {
      this.layer.update(localPosition.x, localPosition.z);
      this.radius = this.layer.zoomRadius?.() ?? this.worldRadius;
      const context = this.layerContext;
      const pixelRatio = this.layerCanvas.width / MAP_DIAMETER_PX;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, this.layerCanvas.width, this.layerCanvas.height);
      const [a, b, c, d, e, f] = minimapTransform(localPosition.x, localPosition.z, localFacingYaw, MAP_RADIUS_PX / this.radius, MAP_RADIUS_PX);
      context.setTransform(a * pixelRatio, b * pixelRatio, c * pixelRatio, d * pixelRatio, e * pixelRatio, f * pixelRatio);
      this.layer.draw(context);
    }

    if (enemies) this.updateEnemyDots(localPosition, enemies, yawQuat);

    for (const [slot, entry] of this.dots) {
      const opponentPosition = opponents.get(slot);
      if (!opponentPosition) continue;
      if (entry.underground !== opponentPosition.underground) {
        entry.underground = opponentPosition.underground;
        entry.style.background = entry.underground ? 'transparent' : THREAT;
        entry.style.border = entry.underground ? '2px solid ' + THREAT : '2px solid transparent';
      }
      placeDot(entry.dot, localPosition, opponentPosition, yawQuat, this.radius);
    }

    for (const marker of this.markers.values()) placeDot(marker.dot, localPosition, marker, yawQuat, this.radius);

    if (!items) return;
    for (const [id, dot] of this.itemDots) {
      const itemPosition = items.get(id);
      if (!itemPosition) continue;
      placeDot(dot, localPosition, itemPosition, yawQuat, this.radius);
    }
  }

  /** Draws `pickups` (the ones within range) as small icons and removes the icons of any no longer
   * listed (taken, or out of range). Call after update(), with the same position and yaw. */
  updatePickups(localPosition: THREE.Vector3, localFacingYaw: number, pickups: readonly MinimapPickup[]): void {
    const yawQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -localFacingYaw, 0, 'YXZ'));
    const listed = new Set<number>();
    for (const pickup of pickups) {
      listed.add(pickup.id);
      let icon = this.pickupIcons.get(pickup.id);
      if (!icon) {
        const style = PICKUP_ICON[pickup.kind];
        icon = document.createElement('div');
        icon.dataset.testid = 'minimap-pickup';
        icon.dataset.kind = pickup.kind;
        icon.style.cssText =
          `position:absolute; width:${DOT_SIZE_PX - 1}px; height:${DOT_SIZE_PX - 1}px; background:${style.colour}; border-radius:${style.radius};` +
          ` clip-path:${style.clip}; opacity:0.9; left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -50%);`;
        this.root.insertBefore(icon, this.forwardWedge);
        this.pickupIcons.set(pickup.id, icon);
      }
      placeDot(icon, localPosition, pickup, yawQuat, this.radius);
    }
    for (const [id, icon] of this.pickupIcons) {
      if (listed.has(id)) continue;
      icon.remove();
      this.pickupIcons.delete(id);
    }
  }

  /** One red dot per live enemy (the opponent dot style), shown while it moves within the radius
   * and for BLIP_LINGER_MS after it stops; dots of enemies no longer listed (dead) are removed. */
  private updateEnemyDots(localPosition: THREE.Vector3, enemies: readonly MinimapBlip[], yawQuat: THREE.Quaternion): void {
    const now = performance.now();
    const seen = new Set<number>();
    for (const enemy of enemies) {
      seen.add(enemy.id);
      let entry = this.enemyDots.get(enemy.id);
      if (!entry) {
        const dot = document.createElement('div');
        dot.style.cssText =
          `position:absolute; width:${DOT_SIZE_PX - 2}px; height:${DOT_SIZE_PX - 2}px; border-radius:50%;` +
          ` background:${THREAT}; left:${MAP_RADIUS_PX}px; top:${MAP_RADIUS_PX}px; transform:translate(-50%, -50%); display:none;`;
        this.root.insertBefore(dot, this.forwardWedge);
        entry = { dot, lastMovedAt: Number.NEGATIVE_INFINITY };
        this.enemyDots.set(enemy.id, entry);
      }
      if (enemy.moving) entry.lastMovedAt = now;
      const inRange = Math.hypot(enemy.x - localPosition.x, enemy.z - localPosition.z) <= this.radius;
      const shown = inRange && now - entry.lastMovedAt <= BLIP_LINGER_MS;
      entry.dot.style.display = shown ? '' : 'none';
      if (shown) placeDot(entry.dot, localPosition, enemy, yawQuat, this.radius);
    }
    for (const [id, entry] of this.enemyDots) {
      if (seen.has(id)) continue;
      entry.dot.remove();
      this.enemyDots.delete(id);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/** Shared by both the opponent-dot and item-dot loops in update() above - projects a world-space
 * offset into the map's rotated, distance-clamped screen space and writes it onto one dot element. */
function placeDot(
  dot: HTMLDivElement,
  localPosition: THREE.Vector3,
  targetPosition: { readonly x: number; readonly z: number },
  yawQuat: THREE.Quaternion,
  worldRadius: number,
): void {
  const dx = targetPosition.x - localPosition.x;
  const dz = targetPosition.z - localPosition.z;
  const distance = Math.hypot(dx, dz);

  const rotated = new THREE.Vector3(dx, 0, dz).applyQuaternion(yawQuat);
  const scale = distance <= worldRadius ? MAP_RADIUS_PX / worldRadius : MAP_RADIUS_PX / distance;

  dot.style.left = `${MAP_RADIUS_PX + rotated.x * scale}px`;
  dot.style.top = `${MAP_RADIUS_PX + rotated.z * scale}px`;
}
