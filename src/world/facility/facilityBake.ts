import { FACILITY_LAMP_FALLOFF_M2, FACILITY_LAMP_HEIGHT_EXPONENT, FACILITY_LAMP_POWER, FACILITY_LAMP_REFERENCE_HEIGHT } from '../../core/config.ts';
import { SOLID, type FacilityLayout } from './facilityLayout.ts';

type RGB = [number, number, number];
interface Lamp { x: number; y: number; z: number; r: number; g: number; b: number; intensity: number; panel: boolean }
type Blocked = (x: number, y: number, z: number, dx: number, dy: number, dz: number) => boolean;
const RADIUS = 14;
const AO_RAYS = Array.from({ length: 12 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 12), angle = i * Math.PI * (3 - Math.sqrt(5));
  return [r * Math.cos(angle), r * Math.sin(angle), Math.sqrt(1 - r * r)] as const;
});

function linear(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function blockers(layout: FacilityLayout): Blocked {
  const { size, cell, kinds, ceiling } = layout, half = size * cell / 2;
  const heights = new Float32Array(kinds.length);
  for (const crate of layout.crates) heights[crate.j * size + crate.i] = crate.height;
  return (x, y, z, dx, dy, dz): boolean => {
    // Move infinitesimally along the ray to choose the correct side of a grid boundary.
    const epsilon = 1e-7;
    let i = Math.floor((x + dx * epsilon + half) / cell), j = Math.floor((z + dz * epsilon + half) / cell);
    const sx = Math.sign(dx), sz = Math.sign(dz);
    const tx = dx === 0 ? Infinity : cell / Math.abs(dx), tz = dz === 0 ? Infinity : cell / Math.abs(dz);
    let nextX = dx === 0 ? Infinity : ((i + (sx > 0 ? 1 : 0)) * cell - half - x) / dx;
    let nextZ = dz === 0 ? Infinity : ((j + (sz > 0 ? 1 : 0)) * cell - half - z) / dz;
    let entry = epsilon;
    while (entry < 1 - epsilon) {
      if (i < 0 || j < 0 || i >= size || j >= size) return true;
      const id = j * size + i, end = Math.min(nextX, nextZ, 1 - epsilon);
      if (kinds[id] === SOLID) return true;
      const y0 = y + dy * entry, y1 = y + dy * end;
      if (Math.min(y0, y1) < -epsilon || Math.max(y0, y1) > ceiling[id]! + epsilon) return true;
      const height = heights[id]!;
      if (height > 0) {
        const cx = (i + 0.5) * cell - half, cz = (j + 0.5) * cell - half;
        let lo = entry, hi = end;
        if (dx === 0) { if (Math.abs(x - cx) > 0.6) hi = -1; }
        else {
          const a = (cx - 0.6 - x) / dx, b = (cx + 0.6 - x) / dx;
          lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
        }
        if (dz === 0) { if (Math.abs(z - cz) > 0.6) hi = -1; }
        else {
          const a = (cz - 0.6 - z) / dz, b = (cz + 0.6 - z) / dz;
          lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
        }
        if (dy === 0) { if (y < 0 || y > height) hi = -1; }
        else {
          const a = -y / dy, b = (height - y) / dy;
          lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
        }
        if (lo <= hi) return true;
      }
      if (end >= 1 - epsilon) return false;
      const crossX = nextX <= nextZ, crossZ = nextZ <= nextX;
      entry = end;
      if (crossX) { i += sx; nextX += tx; }
      if (crossZ) { j += sz; nextZ += tz; }
    }
    return false;
  };
}

function occlusion(blocked: Blocked, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const hash = Math.sin(x * 12.9898 + y * 37.719 + z * 78.233) * 43758.5453;
  const angle = (hash - Math.floor(hash)) * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
  // A stable tangent frame, including horizontal surfaces.
  const length = Math.hypot(nx, nz);
  const tx = length > 1e-6 ? nz / length : 1, ty = 0, tz = length > 1e-6 ? -nx / length : 0;
  const bx = ny * tz, by = nz * tx - nx * tz, bz = -ny * tx;
  let hits = 0;
  for (const ray of AO_RAYS) {
    const u = ray[0] * c - ray[1] * s, v = ray[0] * s + ray[1] * c, w = ray[2];
    if (blocked(x, y, z, 1.2 * (tx * u + bx * v + nx * w),
      1.2 * (ty * u + by * v + ny * w), 1.2 * (tz * u + bz * v + nz * w))) hits++;
  }
  return 1 - 0.75 * hits / AO_RAYS.length;
}

export function bakeFacility(layout: FacilityLayout, positions: Float32Array, normals: Float32Array): {
  light: Float32Array; probes: Float32Array; ms: number;
} {
  const start = performance.now();
  if (positions.length !== normals.length || positions.length % 3 !== 0) throw new Error('Facility positions and normals must be matching vec3 arrays');
  const { size, cell } = layout, half = size * cell / 2, blocked = blockers(layout);
  const lamps: Lamp[] = layout.lamps.map(l => ({ ...l, panel: l.kind === 'panel',
    r: linear((l.color >> 16) & 255), g: linear((l.color >> 8) & 255), b: linear(l.color & 255) }));
  // A cell list bounds work per vertex without changing the exact 14 metre cutoff.
  const nearby: Lamp[][] = Array.from({ length: size * size }, () => []);
  for (const lamp of lamps) {
    const i0 = Math.max(0, Math.floor((lamp.x - RADIUS + half) / cell));
    const i1 = Math.min(size - 1, Math.floor((lamp.x + RADIUS + half) / cell));
    const j0 = Math.max(0, Math.floor((lamp.z - RADIUS + half) / cell));
    const j1 = Math.min(size - 1, Math.floor((lamp.z + RADIUS + half) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) nearby[j * size + i]!.push(lamp);
  }
  const cellIndex = (x: number, z: number): number => {
    const i = Math.max(0, Math.min(size - 1, Math.floor((x + half) / cell)));
    const j = Math.max(0, Math.min(size - 1, Math.floor((z + half) / cell)));
    return j * size + i;
  };
  const direct = (x: number, y: number, z: number, nx: number, ny: number, nz: number, probe: boolean,
    out: Float32Array, offset: number): void => {
    for (const lamp of nearby[cellIndex(x, z)]!) {
      const dx = lamp.x - x, dy = lamp.y - y, dz = lamp.z - z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= RADIUS * RADIUS || d2 < 1e-12) continue;
      const d = Math.sqrt(d2), cosine = probe ? 0.5 : Math.max(0, (nx * dx + ny * dy + nz * dz) / d);
      if (cosine <= 0) continue;
      const fade = Math.max(0, Math.min(1, (RADIUS - d) / 6));
      const cone = lamp.panel ? 0.35 + 0.65 * Math.max(0, dy / d) : 1;
      const strength = lamp.intensity * FACILITY_LAMP_POWER * Math.max(1, (lamp.y / FACILITY_LAMP_REFERENCE_HEIGHT) ** FACILITY_LAMP_HEIGHT_EXPONENT) * cosine * cone * fade * fade * (3 - 2 * fade) / (1 + d2 / FACILITY_LAMP_FALLOFF_M2);
      const push = probe ? 0 : 0.05;
      if (blocked(x + nx * push, y + ny * push, z + nz * push, dx - nx * push, dy - ny * push, dz - nz * push)) continue;
      out[offset] = out[offset]! + lamp.r * strength;
      out[offset + 1] = out[offset + 1]! + lamp.g * strength;
      out[offset + 2] = out[offset + 2]! + lamp.b * strength;
    }
  };
  const probes = new Float32Array(size * size * 3);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const id = j * size + i;
    if (layout.kinds[id] !== SOLID) direct((i + 0.5) * cell - half, 1.4, (j + 0.5) * cell - half, 0, 0, 0, true, probes, id * 3);
  }
  const fill = new Float32Array(probes.length);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const id = (j * size + i) * 3;
    let count = 0;
    for (let b = Math.max(0, j - 1); b <= Math.min(size - 1, j + 1); b++) {
      for (let a = Math.max(0, i - 1); a <= Math.min(size - 1, i + 1); a++) {
        const p = (b * size + a) * 3;
        for (let c = 0; c < 3; c++) fill[id + c] = fill[id + c]! + probes[p + c]!;
        count++;
      }
    }
    for (let c = 0; c < 3; c++) fill[id + c] = fill[id + c]! * 0.12 / count;
  }
  const light = new Float32Array(positions.length);
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v]!, y = positions[v + 1]!, z = positions[v + 2]!;
    const nx = normals[v]!, ny = normals[v + 1]!, nz = normals[v + 2]!;
    direct(x, y, z, nx, ny, nz, false, light, v);
    const px = x + nx * 0.05, py = y + ny * 0.05, pz = z + nz * 0.05;
    const ao = occlusion(blocked, px, py, pz, nx, ny, nz), id = cellIndex(px, pz) * 3;
    for (let c = 0; c < 3; c++) light[v + c] = (light[v + c]! + fill[id + c]!) * ao;
  }
  return { light, probes, ms: performance.now() - start };
}

export function sampleProbe(layout: FacilityLayout, probes: Float32Array, x: number, z: number): RGB {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return [0, 0, 0];
  const { size, cell } = layout;
  const gx = Math.max(0, Math.min(size - 1, x / cell + size / 2 - 0.5));
  const gz = Math.max(0, Math.min(size - 1, z / cell + size / 2 - 0.5));
  const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
  const a = (j * size + i) * 3, b = (j * size + Math.min(size - 1, i + 1)) * 3;
  const c = (Math.min(size - 1, j + 1) * size + i) * 3, d = (Math.min(size - 1, j + 1) * size + Math.min(size - 1, i + 1)) * 3;
  return [0, 1, 2].map(channel =>
    (probes[a + channel]! * (1 - u) + probes[b + channel]! * u) * (1 - v)
    + (probes[c + channel]! * (1 - u) + probes[d + channel]! * u) * v) as RGB;
}
