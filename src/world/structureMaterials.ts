import * as THREE from 'three';
import { bevelRect, each, encode, fbm, grime, hash2, makeCanvas, mulCol, setCol, type MaterialCanvas } from '../render/proceduralTexture.ts';

export type StructureMaterialKey = 'concrete' | 'grating' | 'perforated' | 'roof' | 'cladding' | 'steel' | 'hazard';

export const STRUCTURE_TILE_METRES: Record<StructureMaterialKey, number> = {
  concrete: 2, grating: 1, perforated: 1, roof: 2, cladding: 2, steel: 1, hazard: 1,
};

function concreteCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((x, y, i, fx, fy) => {
    const px = x % 128;
    const variation = 1 + (hash2(Math.floor(x / 128), 0, 201) * 2 - 1) * 0.06;
    const mottle = 1 + (fbm(fx, fy, 8, 4, 203) * 2 - 1) * 0.05;
    setCol(c, i, 0.46 * variation * mottle, 0.44 * variation * mottle, 0.40 * variation * mottle);
    const bevel = bevelRect(px, y, 3, 3, 127, 255, 4);
    c.h[i] = 0.5 - (1 - bevel) * 0.3;
    if (px < 3 || y < 3) mulCol(c, i, 0.55);
    const boltX = Math.min(Math.abs(px - 10), Math.abs(px - 118));
    const boltY = Math.min(Math.abs(y - 10), Math.abs(y - 246));
    if (boltX * boltX + boltY * boltY <= 9) {
      mulCol(c, i, 0.3);
      c.h[i] = c.h[i]! - 0.1;
    }
    mulCol(c, i, 1 - fbm(fx * 40, fy * 2, 4, 4, 205) * 0.15);
    c.gl[i] = 0.15;
  });
  grime(c, 207, 0.15);
  return c;
}

function gratingCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((x, y, i) => {
    const gap = x % 16 < 4 && y % 64 >= 6;
    if (gap) setCol(c, i, 0.04, 0.04, 0.04);
    else setCol(c, i, 0.30, 0.32, 0.35);
    c.h[i] = gap ? 0 : 0.6;
    c.gl[i] = gap ? 0 : 0.45;
  });
  grime(c, 227, 0.4);
  return c;
}

function perforatedCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((x, y, i) => {
    const row = Math.round(y / 24);
    const dx = ((x - (row % 2) * 12) % 24 + 36) % 24 - 12;
    const dy = y - row * 24;
    const hole = dx * dx + dy * dy <= 25;
    if (hole) setCol(c, i, 0.03, 0.03, 0.03);
    else setCol(c, i, 0.22, 0.24, 0.27);
    c.h[i] = hole ? 0 : 0.5;
    c.gl[i] = hole ? 0.1 : 0.5;
  });
  grime(c, 247, 0.3);
  return c;
}

function roofCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((x, _y, i, fx, fy) => {
    const h = 0.5 + 0.5 * Math.sin(2 * Math.PI * x / 32);
    const shade = 0.85 + 0.15 * h;
    const rust = THREE.MathUtils.smoothstep(fbm(fx, fy, 4, 4, 261), 0.6, 0.8);
    setCol(c, i, THREE.MathUtils.lerp(0.30 * shade, 0.35, rust),
      THREE.MathUtils.lerp(0.36 * shade, 0.25, rust), THREE.MathUtils.lerp(0.36 * shade, 0.18, rust));
    mulCol(c, i, 1 - fbm(fx * 40, fy * 2, 4, 4, 263) * 0.15);
    c.h[i] = h;
    c.gl[i] = 0.35;
  });
  return c;
}

function claddingCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((x, y, i, fx, fy) => {
    // Paint varies a little panel to panel and wears through only in small, sparse chips: dense
    // chipping at this scale read as camouflage in the first screenshots.
    const panel = 1 + (hash2(Math.floor(x / 128), Math.floor(y / 128), 283) * 2 - 1) * 0.05;
    const chip = THREE.MathUtils.smoothstep(fbm(fx, fy, 16, 4, 281), 0.74, 0.8) * 0.6;
    setCol(c, i, THREE.MathUtils.lerp(0.36 * panel, 0.25, chip), THREE.MathUtils.lerp(0.40 * panel, 0.25, chip), THREE.MathUtils.lerp(0.34 * panel, 0.26, chip));
    mulCol(c, i, 1 - fbm(fx * 40, fy * 2, 4, 4, 285) * 0.12);
    let h = 0.5;
    if (x % 32 < 4) { h += 0.3; mulCol(c, i, 1.08); }
    if (y % 128 < 2) mulCol(c, i, 0.6);
    c.h[i] = h;
    c.gl[i] = 0.3;
  });
  grime(c, 287, 0.2);
  return c;
}

function steelCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((_x, _y, i, fx, fy) => {
    const brushed = 1 + (fbm(fx, fy * 0.1, 32, 2, 301) * 2 - 1) * 0.08;
    setCol(c, i, 0.20 * brushed, 0.21 * brushed, 0.23 * brushed);
    c.h[i] = 0.5;
    c.gl[i] = 0.5;
  });
  grime(c, 307, 0.25);
  return c;
}

function hazardCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((x, y, i, fx, fy) => {
    if ((x + y) % 64 < 32) setCol(c, i, 0.75, 0.55, 0.06);
    else setCol(c, i, 0.05, 0.05, 0.05);
    const chipped = fbm(fx, fy, 16, 4, 321) > 0.62;
    if (chipped) setCol(c, i, 0.35, 0.35, 0.37);
    c.h[i] = chipped ? 0.45 : 0.5;
    c.gl[i] = 0.3;
  });
  grime(c, 327, 0.5);
  return c;
}

function material(key: StructureMaterialKey, canvas: MaterialCanvas, metalness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name: `structure-${key}`, ...encode(canvas), metalness, roughness: 1, envMapIntensity: 0.5 });
}

export function buildStructureMaterials(): Record<StructureMaterialKey, THREE.MeshStandardMaterial> {
  return {
    concrete: material('concrete', concreteCanvas(), 0),
    grating: material('grating', gratingCanvas(), 0.6),
    perforated: material('perforated', perforatedCanvas(), 0.6),
    roof: material('roof', roofCanvas(), 0.4),
    cladding: material('cladding', claddingCanvas(), 0.25),
    steel: material('steel', steelCanvas(), 0.6),
    hazard: material('hazard', hazardCanvas(), 0.2),
  };
}

let materials: ReturnType<typeof buildStructureMaterials> | undefined;

export function getStructureMaterials(): ReturnType<typeof buildStructureMaterials> {
  return materials ??= buildStructureMaterials();
}
