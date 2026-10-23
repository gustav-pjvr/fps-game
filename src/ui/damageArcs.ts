import { relativeAngleDeg } from './compass.ts';
import { THREAT } from './theme.ts';

const DURATION = 1.2;

/** Six reusable arcs, with north at the top and positive angles clockwise. */
export class DamageArcs {
  private readonly element: SVGSVGElement;
  private readonly arcs: { element: SVGPathElement; bearing: number; remaining: number }[] = [];
  private next = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(root: HTMLElement) {
    this.element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.element.setAttribute('viewBox', '-124 -124 248 248');
    this.element.style.cssText = 'position:absolute; top:50%; left:50%; width:248px; height:248px; transform:translate(-50%, -50%); pointer-events:none;';
    const corner = 120 / Math.sqrt(2);
    for (let i = 0; i < 6; i++) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      element.setAttribute('d', `M ${-corner} ${-corner} A 120 120 0 0 1 ${corner} ${-corner}`);
      element.setAttribute('fill', 'none');
      element.setAttribute('stroke', THREAT);
      element.setAttribute('stroke-width', '2');
      element.style.opacity = '0';
      this.element.appendChild(element);
      this.arcs.push({ element, bearing: 0, remaining: 0 });
    }
    root.appendChild(this.element);
  }

  trigger(sourceBearing: number): void {
    const arc = this.arcs[this.next]!;
    arc.bearing = sourceBearing;
    arc.remaining = DURATION;
    this.next = (this.next + 1) % this.arcs.length;
  }

  update(dt: number, heading: number): void {
    for (const arc of this.arcs) {
      arc.remaining = Math.max(0, arc.remaining - dt);
      arc.element.setAttribute('transform', `rotate(${relativeAngleDeg(arc.bearing, heading)})`);
      arc.element.style.opacity = String(arc.remaining > 0 ? 0.85 * (this.reducedMotion.matches ? 1 : arc.remaining / DURATION) : 0);
    }
  }

  dispose(): void {
    this.element.remove();
  }
}
