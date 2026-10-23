/** Cells sampled beyond a chunk's edge, so shading near a border sees the neighbouring chunk's
 * ground instead of a cliff, and normals on both sides of a border come out identical. */
const PAD = 6;
/** Horizon search distances, in cells (each about 1.56 m at the default resolution). */
const HORIZON_STEPS = [1, 2, 3, 5];
const DIRECTIONS = 8;
/** How dark a fully enclosed spot gets: a gully or the foot of a steep bank, not black. */
const OCCLUSION_STRENGTH = 0.75;
const MIN_AO = 0.4;

export interface TerrainShading {
  /** Per-vertex normals, xyz interleaved, row-major like the heightfield. */
  readonly normals: Float32Array;
  /** Per-vertex ambient occlusion, rgb interleaved (grey), 1 = open ground. */
  readonly colors: Float32Array;
}

/**
 * Horizon-based ambient occlusion and smooth normals for one terrain chunk (docs/visual-overhaul.md,
 * phase 5). The same idea as the Opus 5.5 test build's baked per-vertex AO
 * (reference/model-test/opus-5.5/NOTES.md, "Baked lighting"), cut down to what an open heightfield
 * needs: for each vertex, how far the surrounding ground rises above it in eight directions. Valley
 * floors, gullies and the feet of banks darken; ridges and open slopes stay lit. The result goes in
 * the vertex colour, which the ground material multiplies in.
 *
 * `sample` is the terrain's own height function, so the padding outside the chunk is real ground.
 * Rows run along world Z and columns along world X, matching generateHeightfield.
 */
export function shadeTerrain(sample: (x: number, z: number) => number, originX: number, originZ: number, resolution: number, size: number): TerrainShading {
  const step = size / resolution;
  const side = resolution + 1 + PAD * 2;
  const padded = new Float32Array(side * side);
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      padded[row * side + col] = sample(originX + (col - PAD) * step, originZ + (row - PAD) * step);
    }
  }
  const at = (row: number, col: number): number => padded[row * side + col]!;

  const verticesPerSide = resolution + 1;
  const normals = new Float32Array(verticesPerSide * verticesPerSide * 3);
  const colors = new Float32Array(verticesPerSide * verticesPerSide * 3);
  const dirs: [number, number][] = [];
  for (let d = 0; d < DIRECTIONS; d++) {
    const angle = (d / DIRECTIONS) * Math.PI * 2;
    dirs.push([Math.cos(angle), Math.sin(angle)]);
  }

  for (let row = 0; row < verticesPerSide; row++) {
    for (let col = 0; col < verticesPerSide; col++) {
      const pr = row + PAD;
      const pc = col + PAD;
      const h = at(pr, pc);

      // Central differences: identical on both sides of a chunk border.
      const dx = (at(pr, pc + 1) - at(pr, pc - 1)) / (2 * step);
      const dz = (at(pr + 1, pc) - at(pr - 1, pc)) / (2 * step);
      const length = Math.hypot(dx, 1, dz);
      const index = row * verticesPerSide + col;
      normals[index * 3] = -dx / length;
      normals[index * 3 + 1] = 1 / length;
      normals[index * 3 + 2] = -dz / length;

      let occlusion = 0;
      for (const [cx, cz] of dirs) {
        let maxSlope = 0;
        for (const s of HORIZON_STEPS) {
          const r = Math.round(pr + cz * s);
          const c = Math.round(pc + cx * s);
          const rise = at(r, c) - h;
          if (rise > 0) maxSlope = Math.max(maxSlope, rise / (s * step));
        }
        occlusion += Math.atan(maxSlope) / (Math.PI / 2);
      }
      occlusion /= DIRECTIONS;
      const ao = Math.max(MIN_AO, 1 - OCCLUSION_STRENGTH * Math.sqrt(occlusion));
      colors[index * 3] = ao;
      colors[index * 3 + 1] = ao;
      colors[index * 3 + 2] = ao;
    }
  }
  return { normals, colors };
}
