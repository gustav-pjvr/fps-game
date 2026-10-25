import { MONO_FONT } from '../theme.ts';
const SVG_NS = 'http://www.w3.org/2000/svg';

export type StatIconKind = 'damage' | 'fireRate' | 'magazine' | 'reload' | 'scope' | 'radius' | 'fuse' | 'blind' | 'reach';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** Small (16x16) monochrome icons built from basic primitives (circle/line/rect/polygon) rather
 * than hand-authored path curves - simple enough to render correctly at a glance without needing
 * pixel-level verification, and they inherit `currentColor` so they match the surrounding text. */
function buildIcon(kind: StatIconKind): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 16 16', width: '14', height: '14', fill: 'none', stroke: 'currentColor' });

  switch (kind) {
    case 'damage': {
      // Hit-mark: circle with an X through it.
      svg.append(
        svgEl('circle', { cx: '8', cy: '8', r: '6', 'stroke-width': '1.3' }),
        svgEl('line', { x1: '5', y1: '5', x2: '11', y2: '11', 'stroke-width': '1.3' }),
        svgEl('line', { x1: '11', y1: '5', x2: '5', y2: '11', 'stroke-width': '1.3' }),
      );
      break;
    }
    case 'fireRate': {
      // Three ascending bars, like a rate/speed meter.
      svg.append(
        svgEl('rect', { x: '2', y: '9', width: '2.5', height: '5', fill: 'currentColor', stroke: 'none' }),
        svgEl('rect', { x: '6.75', y: '6', width: '2.5', height: '8', fill: 'currentColor', stroke: 'none' }),
        svgEl('rect', { x: '11.5', y: '2', width: '2.5', height: '12', fill: 'currentColor', stroke: 'none' }),
      );
      break;
    }
    case 'magazine': {
      // Bullet-stack silhouette: a rounded rect with tick marks.
      svg.append(
        svgEl('rect', { x: '5', y: '1.5', width: '6', height: '13', rx: '1.5', 'stroke-width': '1.3' }),
        svgEl('line', { x1: '5', y1: '6', x2: '11', y2: '6', 'stroke-width': '1' }),
        svgEl('line', { x1: '5', y1: '9.5', x2: '11', y2: '9.5', 'stroke-width': '1' }),
      );
      break;
    }
    case 'reload': {
      // Circular arrow: an open arc with an arrowhead.
      svg.append(
        svgEl('path', { d: 'M 13 8 A 5 5 0 1 1 10.5 3.5', 'stroke-width': '1.3' }),
        svgEl('polygon', { points: '10.5,1 10.5,5 14,3', fill: 'currentColor', stroke: 'none' }),
      );
      break;
    }
    case 'scope': {
      // Crosshair: circle with a cross through the center.
      svg.append(
        svgEl('circle', { cx: '8', cy: '8', r: '6', 'stroke-width': '1.3' }),
        svgEl('line', { x1: '8', y1: '1', x2: '8', y2: '4', 'stroke-width': '1.3' }),
        svgEl('line', { x1: '8', y1: '12', x2: '8', y2: '15', 'stroke-width': '1.3' }),
        svgEl('line', { x1: '1', y1: '8', x2: '4', y2: '8', 'stroke-width': '1.3' }),
        svgEl('line', { x1: '12', y1: '8', x2: '15', y2: '8', 'stroke-width': '1.3' }),
      );
      break;
    }
    case 'radius': {
      // Blast radius: a ring around a solid centre.
      svg.append(
        svgEl('circle', { cx: '8', cy: '8', r: '6', 'stroke-width': '1.3', 'stroke-dasharray': '2.4 1.6' }),
        svgEl('circle', { cx: '8', cy: '8', r: '2', fill: 'currentColor', stroke: 'none' }),
      );
      break;
    }
    case 'fuse': {
      // Stopwatch: a dial with one hand and a crown on top.
      svg.append(
        svgEl('circle', { cx: '8', cy: '9', r: '5.5', 'stroke-width': '1.3' }),
        svgEl('line', { x1: '8', y1: '9', x2: '8', y2: '5.5', 'stroke-width': '1.3' }),
        svgEl('line', { x1: '6', y1: '1.5', x2: '10', y2: '1.5', 'stroke-width': '1.3' }),
        svgEl('line', { x1: '8', y1: '1.5', x2: '8', y2: '3.5', 'stroke-width': '1.3' }),
      );
      break;
    }
    case 'blind': {
      // An eye: two arcs and a pupil.
      svg.append(
        svgEl('path', { d: 'M 1.5 8 Q 8 1.5 14.5 8 Q 8 14.5 1.5 8 Z', 'stroke-width': '1.3' }),
        svgEl('circle', { cx: '8', cy: '8', r: '2', fill: 'currentColor', stroke: 'none' }),
      );
      break;
    }
    case 'reach': {
      // Range: a start tick and an arrow pointing away from it.
      svg.append(
        svgEl('line', { x1: '2', y1: '4.5', x2: '2', y2: '11.5', 'stroke-width': '1.3' }),
        svgEl('line', { x1: '2', y1: '8', x2: '11', y2: '8', 'stroke-width': '1.3' }),
        svgEl('polygon', { points: '10,4.5 14.5,8 10,11.5', fill: 'currentColor', stroke: 'none' }),
      );
      break;
    }
  }

  return svg;
}

/** Small icon + value pair, e.g. for a weapon's damage/fire-rate/magazine/reload/scope stats. */
export function createStatBadge(kind: StatIconKind, label: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.style.cssText = `display:inline-flex; align-items:center; gap:4px; font-family:${MONO_FONT}; font-weight:400;`;
  const icon = buildIcon(kind);
  icon.style.cssText = 'flex-shrink:0; opacity:0.85;';
  const text = document.createElement('span');
  text.textContent = label;
  badge.append(icon, text);
  return badge;
}
