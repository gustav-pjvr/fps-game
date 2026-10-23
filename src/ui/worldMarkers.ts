import * as THREE from 'three';
import { AMBER, MONO_FONT, TEXT_SHADOW } from './theme.ts';

interface Marker {
  position: THREE.Vector3;
  element: HTMLDivElement;
  label: HTMLDivElement;
  range: HTMLDivElement;
  arrow: HTMLDivElement;
  /** Half the marker's rendered size, measured once per label so update() never reads layout. */
  halfWidth: number;
  halfHeight: number;
}

/** Pixels at the top of the screen the compass (docs/visual-overhaul-ui.md, "HUD layout") owns. */
const COMPASS_CLEARANCE = 112;

export class WorldMarkers {
  private readonly element: HTMLDivElement;
  private readonly markers = new Map<string, Marker>();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private readonly viewPosition = new THREE.Vector3();

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText = `position:absolute; inset:0; pointer-events:none; color:${AMBER}; font-family:${MONO_FONT}; font-size:10px; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums;`;
    root.appendChild(this.element);
  }

  set(id: string, worldPos: THREE.Vector3, label: string): void {
    let marker = this.markers.get(id);
    if (!marker) {
      const element = document.createElement('div');
      element.style.cssText = 'position:absolute; transform:translate(-50%, -50%); text-align:center; white-space:nowrap; display:none;';
      const diamond = document.createElement('div');
      diamond.style.cssText = 'width:9px; height:9px; box-sizing:border-box; border:1px solid currentColor; transform:rotate(45deg); margin:0 auto 9px;';
      const labelElement = document.createElement('div');
      labelElement.style.cssText = 'letter-spacing:0.08em; overflow:hidden; text-overflow:ellipsis; max-width:180px;';
      const range = document.createElement('div');
      range.style.cssText = 'margin-top:4px;';
      const arrow = document.createElement('div');
      arrow.textContent = '\u2191';
      arrow.style.cssText = 'position:absolute; left:calc(50% - 6px); top:-18px; width:12px; display:none;';
      element.append(arrow, diamond, labelElement, range);
      this.element.appendChild(element);
      marker = { position: worldPos.clone(), element, label: labelElement, range, arrow, halfWidth: 0, halfHeight: 0 };
      this.markers.set(id, marker);
    }
    marker.position.copy(worldPos);
    if (marker.label.textContent !== label) {
      marker.label.textContent = label;
      marker.halfWidth = 0;
    }
  }

  remove(id: string): void {
    this.markers.get(id)?.element.remove();
    this.markers.delete(id);
  }

  update(camera: THREE.Camera): void {
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this.cameraPosition);
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    for (const marker of this.markers.values()) {
      this.viewPosition.copy(marker.position).applyMatrix4(camera.matrixWorldInverse);
      this.projected.copy(marker.position).project(camera);
      const behind = this.viewPosition.z >= 0;
      // Use camera-space direction for rear targets so perspective division cannot mirror them.
      let dx = behind ? this.viewPosition.x : this.projected.x;
      let dy = behind ? -this.viewPosition.y : -this.projected.y;
      if (behind && Math.abs(dx) + Math.abs(dy) < 0.0001) dy = 1;
      const offscreen = behind || Math.abs(dx) > 1 || Math.abs(dy) > 1 || this.projected.z < -1 || this.projected.z > 1;
      marker.element.style.display = 'block';
      marker.range.textContent = `${Math.round(this.cameraPosition.distanceTo(marker.position))} m`;
      if (marker.halfWidth === 0) {
        marker.halfWidth = marker.element.offsetWidth / 2;
        marker.halfHeight = marker.element.offsetHeight / 2;
      }
      const { halfWidth, halfHeight } = marker;
      const limitX = Math.max(0, width / 2 - 48 - halfWidth);
      const limitY = Math.max(0, height / 2 - 48 - halfHeight - (offscreen ? 18 : 0));
      let x = dx * width / 2;
      let y = dy * height / 2;
      const scale = Math.min(limitX / (Math.abs(x) || 1), limitY / (Math.abs(y) || 1));
      if (offscreen || scale < 1) {
        x *= scale;
        y *= scale;
      }
      // Never under the compass tape: a tall target seen from close by projects onto the top strip.
      y = Math.max(y, COMPASS_CLEARANCE + halfHeight - height / 2);
      marker.element.style.left = `${width / 2 + x}px`;
      marker.element.style.top = `${height / 2 + y}px`;
      marker.arrow.style.display = offscreen ? 'block' : 'none';
      marker.arrow.style.transform = `rotate(${Math.atan2(dx * width, -dy * height) * 180 / Math.PI}deg)`;
    }
  }

  dispose(): void {
    this.markers.clear();
    this.element.remove();
  }
}
