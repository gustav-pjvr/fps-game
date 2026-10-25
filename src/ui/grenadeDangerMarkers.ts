import * as THREE from 'three';
import type { LiveGrenadeView } from '../combat/grenades/GrenadeSystem.ts';
import { GRENADE_DANGER_RANGE } from '../combat/grenades/grenadeTuning.ts';
import { TEXT_SHADOW, THREAT } from './theme.ts';

/** Pixels kept clear at the screen edge for a marker pinned there. */
const EDGE_MARGIN = 64;
/** Pixels at the top the compass owns (as worldMarkers.ts). */
const COMPASS_CLEARANCE = 112;
const MAX_MARKERS = 6;

export interface MarkerPlacement {
  /** Pixels from the screen centre, +y down. */
  readonly x: number;
  readonly y: number;
  readonly offscreen: boolean;
  /** Degrees, clockwise from up: the direction an edge arrow points. */
  readonly angle: number;
}

/** Where a marker for a point goes, from its camera-space position `view` (-z forward) and its
 * projected NDC `ndc`: on the point when it is on screen, else pinned to the screen edge in its
 * direction (a point behind uses its camera-space direction so it cannot mirror, as worldMarkers). */
export function placeMarker(view: THREE.Vector3, ndc: THREE.Vector3, width: number, height: number): MarkerPlacement {
  const behind = view.z >= 0;
  let dx = behind ? view.x : ndc.x;
  let dy = behind ? -view.y : -ndc.y;
  if (behind && Math.abs(dx) + Math.abs(dy) < 1e-4) dy = 1;
  const offscreen = behind || Math.abs(dx) > 1 || Math.abs(dy) > 1;
  let x = dx * width / 2;
  let y = dy * height / 2;
  const limitX = Math.max(0, width / 2 - EDGE_MARGIN);
  const limitY = Math.max(0, height / 2 - EDGE_MARGIN);
  const scale = Math.min(limitX / (Math.abs(x) || 1), limitY / (Math.abs(y) || 1));
  if (offscreen || scale < 1) {
    x *= scale;
    y *= scale;
  }
  y = Math.max(y, COMPASS_CLEARANCE - height / 2);
  return { x, y, offscreen, angle: Math.atan2(dx * width, -dy * height) * 180 / Math.PI };
}

/** The live frags that warrant a marker: someone else's, within GRENADE_DANGER_RANGE of `eye`. */
export function dangerousFrags(live: readonly LiveGrenadeView[], eye: THREE.Vector3): LiveGrenadeView[] {
  return live.filter((g) => g.kind === 'frag' && !g.own
    && Math.hypot(g.position.x - eye.x, g.position.y - eye.y, g.position.z - eye.z) <= GRENADE_DANGER_RANGE);
}

const GLYPH = `<svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true">
<ellipse cx="11" cy="15.5" rx="7.5" ry="9" fill="currentColor"/>
<rect x="8" y="3.5" width="6" height="4" fill="currentColor"/>
<path d="M14 5 L19 6.5 L17.5 15" stroke="currentColor" stroke-width="1.6" fill="none"/>
<circle cx="5.5" cy="5" r="2.6" stroke="currentColor" stroke-width="1.3" fill="none"/>
</svg>`;

/**
 * The grenade danger marker (docs/squad-arsenal-night.md section 3): a small grenade glyph in the
 * threat colour for each frag near the player that is not their own, on the frag where it is on
 * screen, else at the screen edge in its direction with an arrow. Reused elements, no layout reads.
 */
export class GrenadeDangerMarkers {
  private readonly element: HTMLDivElement;
  private readonly markers: { element: HTMLDivElement; arrow: HTMLDivElement }[] = [];
  private readonly eye = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly ndc = new THREE.Vector3();

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText = `position:absolute; inset:0; pointer-events:none; color:${THREAT}; filter:drop-shadow(${TEXT_SHADOW});`;
    for (let i = 0; i < MAX_MARKERS; i++) {
      const element = document.createElement('div');
      element.style.cssText = 'position:absolute; width:22px; height:26px; transform:translate(-50%, -50%); display:none;';
      element.innerHTML = GLYPH;
      const arrow = document.createElement('div');
      arrow.textContent = '↑';
      arrow.style.cssText = 'position:absolute; left:5px; top:-18px; width:12px; text-align:center; font-size:12px; display:none; transform-origin:6px 31px;';
      element.appendChild(arrow);
      this.element.appendChild(element);
      this.markers.push({ element, arrow });
    }
    root.appendChild(this.element);
  }

  update(camera: THREE.Camera, live: readonly LiveGrenadeView[]): void {
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this.eye);
    const frags = dangerousFrags(live, this.eye);
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i]!;
      const frag = frags[i];
      if (!frag) {
        marker.element.style.display = 'none';
        continue;
      }
      this.view.set(frag.position.x, frag.position.y, frag.position.z).applyMatrix4(camera.matrixWorldInverse);
      this.ndc.set(frag.position.x, frag.position.y, frag.position.z).project(camera);
      const place = placeMarker(this.view, this.ndc, width, height);
      marker.element.style.display = 'block';
      marker.element.style.left = `${width / 2 + place.x}px`;
      marker.element.style.top = `${height / 2 + place.y}px`;
      marker.arrow.style.display = place.offscreen ? 'block' : 'none';
      marker.arrow.style.transform = `rotate(${place.angle}deg)`;
    }
  }

  dispose(): void {
    this.element.remove();
  }
}
