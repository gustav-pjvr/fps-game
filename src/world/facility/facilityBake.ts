import { FACILITY_LAMP_FALLOFF_M2, FACILITY_LAMP_HEIGHT_EXPONENT, FACILITY_LAMP_POWER, FACILITY_LAMP_REFERENCE_HEIGHT } from '../../core/config.ts';
import { SOLID, type FacilityLayout } from './facilityLayout.ts';

type RGB = [number, number, number];
interface Lamp { index: number; x: number; y: number; z: number; r: number; g: number; b: number; intensity: number; panel: boolean }
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

/** Everything a partial rebake needs, kept from the full bake. */
export interface FacilityBakeState {
  readonly layout: FacilityLayout;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** Final light per vertex: the array the `bakedLight` attributes view. */
  readonly light: Float32Array;
  /** Bounce probes, rgb per cell. */
  readonly probes: Float32Array;
  /** Direct light per vertex, before fill and AO. */
  readonly direct: Float32Array;
  /** 0.12 times the 3 x 3 probe mean, rgb per cell. */
  readonly fill: Float32Array;
  /** Float64 so the final multiply matches the single pass bake bit for bit. */
  readonly ao: Float64Array;
  /** The fill cell of each vertex (from its position pushed along the normal). */
  readonly vertexCell: Int32Array;
  /** 1 for a lamp excluded from the light. */
  readonly dead: Uint8Array;
  /** Adds the light of every live lamp near the point into out[offset..offset + 2]. */
  readonly lit: (x: number, y: number, z: number, nx: number, ny: number, nz: number, probe: boolean,
    out: Float32Array, offset: number) => void;
  /** Whether lamp `index` adds any light at the point (dead or alive). */
  readonly reaches: (index: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, probe: boolean) => boolean;
}

export interface FacilityBakeResult { light: Float32Array; probes: Float32Array; ms: number; state: FacilityBakeState }

function probeCell(state: FacilityBakeState, i: number, j: number): void {
  const { layout: { size, cell, kinds }, probes } = state, half = size * cell / 2, id = j * size + i;
  probes[id * 3] = 0; probes[id * 3 + 1] = 0; probes[id * 3 + 2] = 0;
  if (kinds[id] !== SOLID) state.lit((i + 0.5) * cell - half, 1.4, (j + 0.5) * cell - half, 0, 0, 0, true, probes, id * 3);
}

function fillCell(state: FacilityBakeState, i: number, j: number): void {
  const { layout: { size }, probes, fill } = state, id = (j * size + i) * 3;
  fill[id] = 0; fill[id + 1] = 0; fill[id + 2] = 0;
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

function finalLight(state: FacilityBakeState, v: number): void {
  const { light, direct, fill } = state, n = v / 3, id = state.vertexCell[n]! * 3, ao = state.ao[n]!;
  for (let c = 0; c < 3; c++) light[v + c] = (direct[v + c]! + fill[id + c]!) * ao;
}

export function bakeFacility(layout: FacilityLayout, positions: Float32Array, normals: Float32Array): FacilityBakeResult {
  const start = performance.now();
  if (positions.length !== normals.length || positions.length % 3 !== 0) throw new Error('Facility positions and normals must be matching vec3 arrays');
  const { size, cell } = layout, half = size * cell / 2, blocked = blockers(layout);
  const lamps: Lamp[] = layout.lamps.map((l, index) => ({ ...l, index, panel: l.kind === 'panel',
    r: linear((l.color >> 16) & 255), g: linear((l.color >> 8) & 255), b: linear(l.color & 255) }));
  const dead = new Uint8Array(lamps.length);
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
  // 0 where the lamp adds nothing: out of range, facing away or shadowed.
  const strengthOf = (lamp: Lamp, x: number, y: number, z: number, nx: number, ny: number, nz: number, probe: boolean): number => {
    const dx = lamp.x - x, dy = lamp.y - y, dz = lamp.z - z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= RADIUS * RADIUS || d2 < 1e-12) return 0;
    const d = Math.sqrt(d2), cosine = probe ? 0.5 : Math.max(0, (nx * dx + ny * dy + nz * dz) / d);
    if (cosine <= 0) return 0;
    const fade = Math.max(0, Math.min(1, (RADIUS - d) / 6));
    const cone = lamp.panel ? 0.35 + 0.65 * Math.max(0, dy / d) : 1;
    const strength = lamp.intensity * FACILITY_LAMP_POWER * Math.max(1, (lamp.y / FACILITY_LAMP_REFERENCE_HEIGHT) ** FACILITY_LAMP_HEIGHT_EXPONENT) * cosine * cone * fade * fade * (3 - 2 * fade) / (1 + d2 / FACILITY_LAMP_FALLOFF_M2);
    const push = probe ? 0 : 0.05;
    return blocked(x + nx * push, y + ny * push, z + nz * push, dx - nx * push, dy - ny * push, dz - nz * push) ? 0 : strength;
  };
  const reaches = (index: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, probe: boolean): boolean =>
    index >= 0 && index < lamps.length && strengthOf(lamps[index]!, x, y, z, nx, ny, nz, probe) !== 0;
  const lit = (x: number, y: number, z: number, nx: number, ny: number, nz: number, probe: boolean,
    out: Float32Array, offset: number): void => {
    for (const lamp of nearby[cellIndex(x, z)]!) {
      if (dead[lamp.index]) continue;
      const strength = strengthOf(lamp, x, y, z, nx, ny, nz, probe);
      if (strength === 0) continue;
      out[offset] = out[offset]! + lamp.r * strength;
      out[offset + 1] = out[offset + 1]! + lamp.g * strength;
      out[offset + 2] = out[offset + 2]! + lamp.b * strength;
    }
  };
  const count = positions.length / 3;
  const state: FacilityBakeState = { layout, positions, normals, lit, reaches, dead,
    light: new Float32Array(positions.length), probes: new Float32Array(size * size * 3),
    direct: new Float32Array(positions.length), fill: new Float32Array(size * size * 3),
    ao: new Float64Array(count), vertexCell: new Int32Array(count) };
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) probeCell(state, i, j);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) fillCell(state, i, j);
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v]!, y = positions[v + 1]!, z = positions[v + 2]!;
    const nx = normals[v]!, ny = normals[v + 1]!, nz = normals[v + 2]!;
    lit(x, y, z, nx, ny, nz, false, state.direct, v);
    const px = x + nx * 0.05, py = y + ny * 0.05, pz = z + nz * 0.05;
    state.ao[v / 3] = occlusion(blocked, px, py, pz, nx, ny, nz);
    state.vertexCell[v / 3] = cellIndex(px, pz);
    finalLight(state, v);
  }
  return { light: state.light, probes: state.probes, ms: performance.now() - start, state };
}

/**
 * Recomputes in place, with the given lamps excluded: the probes within the lamp radius of a point,
 * the fill of the cells around them, the direct term of vertices within the radius and the final
 * light of every vertex whose direct term or fill was recomputed. AO does not depend on the lamps,
 * so it is reused. Returns the recomputed vertex indices (ascending, one per vertex) and the time.
 *
 * `killed`, the lamp at the point that has just joined the dead set, is an exact shortcut: a probe
 * or vertex that lamp never reached keeps its sum, so only the ones it lit are recomputed.
 */
export function rebakeFacilityAround(state: FacilityBakeState, deadLamps: Iterable<number>,
  x: number, y: number, z: number, killed?: number): { vertices: Int32Array; ms: number } {
  const start = performance.now();
  const { layout: { size, cell }, positions, normals, direct } = state, half = size * cell / 2;
  state.dead.fill(0);
  for (const lamp of deadLamps) if (lamp >= 0 && lamp < state.dead.length) state.dead[lamp] = 1;
  // A hair over the radius, so rounding never leaves out a vertex or probe the lamp reached.
  const reach = RADIUS * RADIUS + 1e-6, probeY = 1.4 - y;
  const i0 = Math.max(0, Math.floor((x - RADIUS + half) / cell)), i1 = Math.min(size - 1, Math.floor((x + RADIUS + half) / cell));
  const j0 = Math.max(0, Math.floor((z - RADIUS + half) / cell)), j1 = Math.min(size - 1, Math.floor((z + RADIUS + half) / cell));
  const probed = new Uint8Array(size * size);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const cx = (i + 0.5) * cell - half, cz = (j + 0.5) * cell - half, dx = cx - x, dz = cz - z;
    if (dx * dx + probeY * probeY + dz * dz > reach) continue;
    if (killed !== undefined && !state.reaches(killed, cx, 1.4, cz, 0, 0, 0, true)) continue;
    probeCell(state, i, j); probed[j * size + i] = 1;
  }
  const filled = new Uint8Array(size * size);
  for (let j = Math.max(0, j0 - 1); j <= Math.min(size - 1, j1 + 1); j++) {
    for (let i = Math.max(0, i0 - 1); i <= Math.min(size - 1, i1 + 1); i++) {
      let touched = false;
      for (let b = Math.max(0, j - 1); b <= Math.min(size - 1, j + 1) && !touched; b++) {
        for (let a = Math.max(0, i - 1); a <= Math.min(size - 1, i + 1); a++) if (probed[b * size + a]) { touched = true; break; }
      }
      if (touched) { fillCell(state, i, j); filled[j * size + i] = 1; }
    }
  }
  const changed: number[] = [];
  for (let v = 0, n = 0; v < positions.length; v += 3, n++) {
    const px = positions[v]!, py = positions[v + 1]!, pz = positions[v + 2]!;
    const nx = normals[v]!, ny = normals[v + 1]!, nz = normals[v + 2]!;
    const near = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2 <= reach
      && (killed === undefined || state.reaches(killed, px, py, pz, nx, ny, nz, false));
    if (!near && !filled[state.vertexCell[n]!]) continue;
    if (near) {
      direct[v] = 0; direct[v + 1] = 0; direct[v + 2] = 0;
      state.lit(px, py, pz, nx, ny, nz, false, direct, v);
    }
    finalLight(state, v);
    changed.push(n);
  }
  return { vertices: Int32Array.from(changed), ms: performance.now() - start };
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
