import { BufferGeometry, Float32BufferAttribute } from 'three';
import { STRUCTURE_TILE_METRES, type StructureMaterialKey } from '../structureMaterials.ts';
import type { HouseFootprint } from '../houseFootprint.ts';
import { SOLID, type FacilityLayout, type FacilityLamp } from './facilityLayout.ts';

export interface ColliderBox { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number }
export interface FacilityGeometry {
  byMaterial: Map<StructureMaterialKey, BufferGeometry>;
  lampPanels: Pick<FacilityLamp, 'x' | 'y' | 'z' | 'color' | 'kind'>[];
  shafts: { x: number; yTop: number; z: number; color: number }[];
  colliderBoxes: ColliderBox[];
  coverFootprints: HouseFootprint[];
}

type Vec3 = [number, number, number];
interface Surface { positions: number[]; normals: number[]; uvs: number[]; indices: number[] }
interface Rectangle { i: number; j: number; width: number; depth: number; value: number }

// A zero value is empty; matching positive values may merge.
function rectangles(size: number, values: Float32Array): Rectangle[] {
  const used = new Uint8Array(values.length), result: Rectangle[] = [];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const id = j * size + i, value = values[id]!;
    if (!value || used[id]) continue;
    let width = 1, depth = 1;
    while (i + width < size && !used[id + width] && values[id + width] === value) width++;
    outer: while (j + depth < size) {
      for (let dx = 0; dx < width; dx++) {
        const next = (j + depth) * size + i + dx;
        if (used[next] || values[next] !== value) break outer;
      }
      depth++;
    }
    for (let dz = 0; dz < depth; dz++) used.fill(1, (j + dz) * size + i, (j + dz) * size + i + width);
    result.push({ i, j, width, depth, value });
  }
  return result;
}

export function buildFacilityGeometry(layout: FacilityLayout): FacilityGeometry {
  const { size, cell, kinds, ceiling } = layout, half = size * cell / 2;
  const surfaces = new Map<StructureMaterialKey, Surface>();
  const colliderBoxes: ColliderBox[] = [], coverFootprints: HouseFootprint[] = [];
  const edge = (i: number): number => i * cell - half;
  const solid = (i: number, j: number): boolean => i < 0 || j < 0 || i >= size || j >= size || kinds[j * size + i] === SOLID;

  // u cross v defines the outward normal. Vertices are shared within each subdivided face.
  const quad = (key: StructureMaterialKey, p: Vec3, u: Vec3, v: Vec3, nu: number, nv: number): void => {
    let s = surfaces.get(key);
    if (!s) { s = { positions: [], normals: [], uvs: [], indices: [] }; surfaces.set(key, s); }
    const base = s.positions.length / 3, tile = STRUCTURE_TILE_METRES[key];
    const ul = Math.hypot(...u), vl = Math.hypot(...v);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n);
    for (let b = 0; b <= nv; b++) for (let a = 0; a <= nu; a++) {
      const x = p[0] + u[0] * a / nu + v[0] * b / nv;
      const y = p[1] + u[1] * a / nu + v[1] * b / nv;
      const z = p[2] + u[2] * a / nu + v[2] * b / nv;
      s.positions.push(x, y, z);
      s.normals.push(n[0]! / length, n[1]! / length, n[2]! / length);
      s.uvs.push((x * u[0] + y * u[1] + z * u[2]) / ul / tile,
        (x * v[0] + y * v[1] + z * v[2]) / vl / tile);
    }
    for (let b = 0; b < nv; b++) for (let a = 0; a < nu; a++) {
      const q = base + b * (nu + 1) + a;
      s.indices.push(q, q + 1, q + nu + 2, q, q + nu + 2, q + nu + 1);
    }
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number,
    side: StructureMaterialKey, top: StructureMaterialKey, splits: number): void => {
    const x0 = x - w / 2, z0 = z - d / 2;
    quad(side, [x0, y, z0], [0, 0, d], [0, h, 0], splits, splits);
    quad(side, [x0 + w, y, z0 + d], [0, 0, -d], [0, h, 0], splits, splits);
    quad(side, [x0 + w, y, z0], [-w, 0, 0], [0, h, 0], splits, splits);
    quad(side, [x0, y, z0 + d], [w, 0, 0], [0, h, 0], splits, splits);
    quad(top, [x0, y + h, z0 + d], [w, 0, 0], [0, 0, -d], splits, splits);
    quad(side, [x0, y, z0], [w, 0, 0], [0, 0, d], splits, splits);
    colliderBoxes.push({ cx: x, cy: y + h / 2, cz: z, hx: w / 2, hy: h / 2, hz: d / 2 });
  };
  const wall = (i: number, j: number, di: number, dj: number, low: number, high: number, key: StructureMaterialKey): void => {
    if (high <= low) return;
    const x = edge(i), z = edge(j);
    const p: Vec3 = di === 1 ? [x + cell, low, z] : di === -1 ? [x, low, z + cell]
      : dj === 1 ? [x + cell, low, z + cell] : [x, low, z];
    const u: Vec3 = di ? [0, 0, di * cell] : [-dj * cell, 0, 0];
    quad(key, p, u, [0, high - low, 0], Math.ceil(cell / 0.75), Math.ceil((high - low) / 0.75));
  };

  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const id = j * size + i;
    if (kinds[id] === SOLID) continue;
    const h = ceiling[id]!, x = edge(i), z = edge(j), region = layout.region[id]!;
    const plant = layout.rooms[region]?.kind === 'plant';
    quad(plant ? 'grating' : 'concrete', [x, 0, z + cell], [cell, 0, 0], [0, 0, -cell], 2, 2);
    // PROP is open air above its crate, so it keeps its ceiling and surrounding walls.
    quad(plant || region === -1 ? 'perforated' : 'concrete', [x, h, z], [cell, 0, 0], [0, 0, cell], 2, 2);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (solid(i + di, j + dj)) {
        wall(i, j, di, dj, 0, Math.min(1.1, h), 'cladding');
        wall(i, j, di, dj, Math.min(1.1, h), h, 'concrete');
      } else wall(i, j, di, dj, ceiling[(j + dj) * size + i + di]!, h, 'concrete');
    }
  }

  for (const doorway of layout.doorways) {
    const { i, j, axis } = doorway, id = j * size + i;
    if (kinds[id] === SOLID) continue;
    for (const sign of [-1, 1]) {
      const ni = i + (axis === 'x' ? sign : 0), nj = j + (axis === 'z' ? sign : 0);
      if (solid(ni, nj) || layout.region[nj * size + ni]! < 0) continue;
      const x = edge(i) + cell / 2 + (axis === 'x' ? sign * cell / 2 : 0);
      const z = edge(j) + cell / 2 + (axis === 'z' ? sign * cell / 2 : 0);
      const h = Math.min(ceiling[id]!, ceiling[nj * size + ni]!);
      for (const end of [-1, 1]) {
        // Adjacent doorway cells share an opening, with posts only at its outer ends.
        const ti = i + (axis === 'z' ? end : 0), tj = j + (axis === 'x' ? end : 0);
        if (layout.doorways.some(d => d.i === ti && d.j === tj && d.axis === axis)) continue;
        box(x + (axis === 'z' ? end * (cell / 2 - 0.06) : 0), 0,
          z + (axis === 'x' ? end * (cell / 2 - 0.06) : 0), 0.12, h, 0.12, 'steel', 'steel', 1);
      }
      box(x, h - 0.12, z, axis === 'x' ? 0.16 : cell, 0.12, axis === 'x' ? cell : 0.16, 'steel', 'steel', 1);
      const w = axis === 'x' ? 0.3 : cell, d = axis === 'x' ? cell : 0.3;
      quad('hazard', [x - w / 2, 0.006, z + d / 2], [w, 0, 0], [0, 0, -d], 2, 2);
    }
  }
  for (const crate of layout.crates) {
    const x = edge(crate.i) + cell / 2, z = edge(crate.j) + cell / 2;
    if (crate.height === 1.8) {
      box(x, 0, z, 1.2, 0.9, 1.2, 'cladding', 'steel', 2);
      box(x, 0.9, z, 1.2, 0.9, 1.2, 'cladding', 'steel', 2);
      colliderBoxes.splice(colliderBoxes.length - 2, 2, { cx: x, cy: 0.9, cz: z, hx: 0.6, hy: 0.9, hz: 0.6 });
    } else box(x, 0, z, 1.2, crate.height, 1.2, 'cladding', 'steel', 2);
  }

  const solids = Float32Array.from(kinds, kind => Number(kind === SOLID));
  const ceilings = Float32Array.from(ceiling, (h, id) => kinds[id] === SOLID ? 0 : h);
  for (const r of rectangles(size, solids)) colliderBoxes.push({
    cx: edge(r.i) + r.width * cell / 2, cy: 4, cz: edge(r.j) + r.depth * cell / 2,
    hx: r.width * cell / 2, hy: 4, hz: r.depth * cell / 2,
  });
  colliderBoxes.push({ cx: 0, cy: -0.1, cz: 0, hx: half, hy: 0.1, hz: half });
  for (const r of rectangles(size, ceilings)) colliderBoxes.push({
    cx: edge(r.i) + r.width * cell / 2, cy: r.value + 0.1, cz: edge(r.j) + r.depth * cell / 2,
    hx: r.width * cell / 2, hy: 0.1, hz: r.depth * cell / 2,
  });

  const cover = new Float32Array(kinds.length);
  for (const room of layout.rooms) for (let j = room.j0 + 1; j < room.j1 - 1; j++) {
    for (let i = room.i0 + 1; i < room.i1 - 1; i++) if (solid(i, j)) cover[j * size + i] = 1;
  }
  for (const crate of layout.crates) cover[crate.j * size + crate.i] = 2;
  // Rectangular pieces of a cluster avoid claiming empty space inside an L-shaped cluster.
  for (const r of rectangles(size, cover)) {
    const inset = r.value === 2 ? (cell - 1.2) / 2 : 0;
    coverFootprints.push({ originX: edge(r.i) + r.width * cell / 2, originZ: edge(r.j) + r.depth * cell / 2,
      offsetX: 0, offsetZ: 0, halfWidth: r.width * cell / 2 - inset, halfDepth: r.depth * cell / 2 - inset, rotationY: 0 });
  }
  const byMaterial = new Map<StructureMaterialKey, BufferGeometry>();
  for (const [key, s] of surfaces) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(s.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(s.normals, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(s.uvs, 2));
    geometry.setIndex(s.indices);
    geometry.computeBoundingSphere();
    byMaterial.set(key, geometry);
  }
  return { byMaterial, colliderBoxes, coverFootprints,
    lampPanels: layout.lamps.map(({ x, y, z, color, kind }) => ({ x, y, z, color, kind })),
    shafts: layout.lamps.filter(lamp => {
      const i = Math.floor((lamp.x + half) / cell), j = Math.floor((lamp.z + half) / cell), id = j * size + i;
      return lamp.kind === 'panel' && layout.region[id]! >= 0 && ceiling[id]! >= 5.5;
    }).map(({ x, y, z, color }) => ({ x, yTop: y - 0.04, z, color })),
  };
}
