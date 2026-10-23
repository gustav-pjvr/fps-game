import { ACCENT, AMBER, INK_DIM, INK_FAINT, MONO_FONT, TEXT_SHADOW, THREAT } from './theme.ts';

/** World north is -Z; bearings increase clockwise toward +X. */
export function bearingDeg(dx: number, dz: number): number {
  return (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
}

/** Signed clockwise angle from heading, wrapped across north. */
export function relativeAngleDeg(sourceBearing: number, heading: number): number {
  return ((sourceBearing - heading + 180) % 360 + 360) % 360 - 180;
}

const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const HALF_WINDOW = 60;

export class Compass {
  private readonly element: HTMLDivElement;
  private readonly tape: HTMLDivElement;
  private readonly readout: HTMLDivElement;
  private readonly sun: HTMLDivElement;
  private sunBearing = 0;
  private readonly ticks: { element: HTMLDivElement; bearing: number }[] = [];
  private readonly contacts: { element: HTMLDivElement; bearing: number; remaining: number }[] = [];
  private readonly markers = new Map<string, { element: HTMLDivElement; bearingFn: () => number }>();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText = `position:absolute; top:32px; left:50%; transform:translateX(-50%); width:320px; height:58px; pointer-events:none; font-family:${MONO_FONT}; font-size:9px; color:${INK_DIM}; text-shadow:${TEXT_SHADOW}; font-variant-numeric:tabular-nums;`;
    this.readout = document.createElement('div');
    this.readout.style.cssText = `text-align:center; font-size:11px; color:${ACCENT};`;
    this.tape = document.createElement('div');
    this.tape.style.cssText = 'position:absolute; top:22px; width:100%; height:36px; overflow:hidden;';
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const tick = document.createElement('div');
      tick.style.cssText = 'position:absolute; top:0; transform:translateX(-50%); text-align:center;';
      const line = document.createElement('div');
      line.style.cssText = `width:1px; height:${bearing % 45 === 0 ? 8 : 4}px; margin:0 auto 4px; background:${INK_FAINT};`;
      tick.appendChild(line);
      if (bearing % 45 === 0) tick.append(DIRECTIONS[bearing / 45]!);
      this.tape.appendChild(tick);
      this.ticks.push({ element: tick, bearing });
    }
    this.sun = document.createElement('div');
    this.sun.style.cssText = `position:absolute; top:27px; width:5px; height:5px; border-radius:50%; background:${AMBER}; outline:1px solid ${AMBER}; outline-offset:2px; transform:translateX(-50%);`;
    this.tape.appendChild(this.sun);
    const center = document.createElement('div');
    center.style.cssText = `position:absolute; top:19px; left:50%; width:1px; height:10px; background:${ACCENT};`;
    this.element.append(this.readout, this.tape, center);
    root.appendChild(this.element);
    this.update(0, 0);
  }

  setSunDirection(direction: { x: number; z: number }): void {
    this.sunBearing = bearingDeg(direction.x, direction.z);
  }

  addContact(bearing: number): void {
    const element = document.createElement('div');
    element.style.cssText = `position:absolute; top:0; width:2px; height:10px; background:${THREAT}; transform:translateX(-50%); display:none;`;
    this.tape.appendChild(element);
    this.contacts.push({ element, bearing, remaining: 3 });
  }

  addMarker(id: string, bearingFn: () => number): void {
    this.removeMarker(id);
    const element = document.createElement('div');
    element.style.cssText = `position:absolute; top:27px; width:5px; height:5px; border:1px solid ${AMBER}; transform:translateX(-50%) rotate(45deg); display:none;`;
    this.tape.appendChild(element);
    this.markers.set(id, { element, bearingFn });
  }

  removeMarker(id: string): void {
    this.markers.get(id)?.element.remove();
    this.markers.delete(id);
  }

  update(dt: number, heading: number): void {
    const degrees = (Math.round(heading) % 360 + 360) % 360;
    this.readout.textContent = `${DIRECTIONS[Math.round(degrees / 45) % 8]} ${String(degrees).padStart(3, '0')}`;
    for (const tick of this.ticks) this.place(tick.element, tick.bearing, heading);
    this.place(this.sun, this.sunBearing, heading);
    for (let i = this.contacts.length - 1; i >= 0; i--) {
      const contact = this.contacts[i]!;
      contact.remaining -= dt;
      if (contact.remaining <= 0) {
        contact.element.remove();
        this.contacts.splice(i, 1);
      } else {
        this.place(contact.element, contact.bearing, heading);
        contact.element.style.opacity = this.reducedMotion.matches ? '1' : String(contact.remaining / 3);
      }
    }
    for (const marker of this.markers.values()) this.place(marker.element, marker.bearingFn(), heading);
  }

  private place(element: HTMLElement, bearing: number, heading: number): void {
    const angle = relativeAngleDeg(bearing, heading);
    element.style.display = Math.abs(angle) <= HALF_WINDOW ? 'block' : 'none';
    element.style.left = `${50 + angle / (HALF_WINDOW * 2) * 100}%`;
  }

  dispose(): void {
    this.contacts.length = 0;
    this.markers.clear();
    this.element.remove();
  }
}
