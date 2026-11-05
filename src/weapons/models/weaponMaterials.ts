import * as THREE from 'three';

import { ACCENT_CYAN } from '../../render/look.ts';
import { bevelRect, each, encode, fbm, grime, makeCanvas, mulCol, setCol, SIZE, texture, type MaterialCanvas } from '../../render/proceduralTexture.ts';

function gunCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((x, y, i, fx, fy) => {
    const n = fbm(fx, fy, 16, 4, 101);
    // Opus shaded this with Blinn-Phong, where a dark albedo still read as blue-grey steel. Under
    // PBR the same value goes near-black, so it is lifted and pushed a little cooler.
    const base = 0.15 + n * 0.05;
    setCol(c, i, base, base * 1.07, base * 1.24);
    let h = 0.4 + n * 0.1;
    if (x > 160 && ((x + y) % 6 < 2 || (x - y + 600) % 6 < 2)) h -= 0.15;
    if (y % 64 < 2) { h -= 0.2; mulCol(c, i, 0.6); }
    c.h[i] = h;
    c.gl[i] = 0.75;
  });
  return c;
}

function sleeveCanvas() {
  const c = makeCanvas();
  const mask = new Uint8Array(SIZE * SIZE * 4);
  const cyan = new THREE.Color(ACCENT_CYAN);
  each((x, y, i, fx, fy) => {
    const variation = 0.94 + fbm(fx, fy, 16, 4, 151) * 0.12;
    setCol(c, i, 0.054 * variation, 0.089 * variation, 0.084 * variation);
    c.h[i] = 0.1;
    const px = x % 128, py = y % 128;
    if (px >= 14 && px <= 113 && py >= 16 && py <= 111) {
      setCol(c, i, 0.030, 0.045, 0.050);
      c.h[i] = 0.08;
    }
    let lit = false;
    if (px >= 18 && px <= 109 && py >= 20 && py <= 107) {
      const bevel = bevelRect(px, py, 18, 20, 109, 107, 6);
      const shade = (0.72 + bevel * 0.28) * variation;
      setCol(c, i, 0.448 * shade, 0.390 * shade, 0.365 * shade);
      c.h[i] = 0.1 + bevel * 0.06;
      const edge = Math.min(px - 18, 109 - px, py - 20, 107 - py);
      lit = edge >= 2 && edge < 5;
      if (lit) setCol(c, i, cyan.r * 0.35, cyan.g * 0.35, cyan.b * 0.35);
    }
    const o = i * 4;
    mask[o] = mask[o + 1] = mask[o + 2] = lit ? 255 : 0;
    mask[o + 3] = 255;
  });
  return { ...encode(c), emissiveMap: texture(mask) };
}

function pipeCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((_x, y, i, fx, fy) => {
    const n = fbm(fx, fy * 0.1, 32, 2, 121);
    const base = 0.4 + n * 0.12;
    setCol(c, i, base, base * 0.98, base * 0.95);
    let h = 0.4 + n * 0.05;
    if (y % 128 < 10) { h += 0.2; mulCol(c, i, 0.7); }
    c.h[i] = h;
    c.gl[i] = 0.7;
  });
  grime(c, 127, 0.35);
  return c;
}

function trimCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((x, y, i, fx, fy) => {
    const n = fbm(fx, fy, 8, 4, 31);
    if ((x + y) % 64 < 32) setCol(c, i, 0.75, 0.55, 0.06);
    else setCol(c, i, 0.05, 0.05, 0.05);
    const band = bevelRect(x, y % 128, 0, 6, 255, 121, 3);
    let h = band * 0.4 + n * 0.05;
    if (band < 1) mulCol(c, i, 0.3 + band * 0.4);
    if (fbm(fx, fy, 16, 4, 37) > 0.62) {
      setCol(c, i, 0.35, 0.35, 0.37);
      h -= 0.05;
      c.gl[i] = 0.7;
    } else c.gl[i] = 0.3;
    c.h[i] = h;
  });
  grime(c, 39, 0.5);
  return c;
}

function glowCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((_x, _y, i) => { setCol(c, i, 1, 1, 1); c.h[i] = 0; c.gl[i] = 1; });
  return c;
}

function metal(name: string, canvas: MaterialCanvas, metalness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, ...encode(canvas), metalness, roughness: 1, envMapIntensity: 0.7 });
}

function buildMaterials() {
  return {
    gunmetal: metal('opus-gunmetal', gunCanvas(), 0.35),
    pipe: metal('opus-pipe', pipeCanvas(), 0.55),
    trim: metal('opus-trim', trimCanvas(), 0.3),
    sleeve: new THREE.MeshStandardMaterial({
      name: 'opus-sleeve', ...sleeveCanvas(), emissive: ACCENT_CYAN, emissiveIntensity: 0.6, roughness: 0.6, metalness: 0,
    }),
    glove: new THREE.MeshStandardMaterial({
      name: 'opus-glove', color: new THREE.Color(ACCENT_CYAN).multiplyScalar(0.35),
      emissive: ACCENT_CYAN, emissiveIntensity: 0.45, roughness: 0.5, metalness: 0,
    }),
    gold: new THREE.MeshStandardMaterial({ name: 'opus-gold', color: 0xd4af37, roughness: 0.3, metalness: 0.8, envMapIntensity: 0.7 }),
    glowMaps: encode(glowCanvas()),
  };
}

let materials: ReturnType<typeof buildMaterials> | undefined;
let environment: THREE.Texture | null = null;

export function getWeaponMaterials(): ReturnType<typeof buildMaterials> {
  if (!materials) {
    materials = buildMaterials();
    applyEnvironment(materials);
  }
  return materials;
}

/** Metal needs something to reflect. scene.environment (the PMREM of the sky) is only on for High,
 * so the weapons carry the same sky map on every tier: they cover a small part of the screen, so
 * the extra envmap sample costs little even on Low. Renderer calls this whenever the look changes. */
export function setWeaponEnvironment(texture: THREE.Texture | null): void {
  environment = texture;
  if (materials) applyEnvironment(materials);
}

function applyEnvironment(set: ReturnType<typeof buildMaterials>): void {
  for (const material of [set.gunmetal, set.pipe, set.trim, set.gold]) {
    material.envMap = environment;
    material.needsUpdate = true;
  }
}

/** Full-charge glow. Low enough that ACES keeps the cyan instead of clipping it to white; bloom
 * (Medium and High) supplies the halo. WeaponManager scales from this by ammo and reload state. */
export const WEAPON_GLOW_INTENSITY = 1.6;

/** Textures are shared, but emissive state belongs to one weapon instance. */
export function createWeaponGlow(sight = false): THREE.MeshStandardMaterial {
  const maps = getWeaponMaterials().glowMaps;
  return new THREE.MeshStandardMaterial({
    name: sight ? 'opus-sight' : 'opus-glow',
    ...maps,
    color: 0x000000,
    emissiveMap: maps.map,
    emissive: sight ? 0xff6a3a : 0x6ff0dc,
    emissiveIntensity: WEAPON_GLOW_INTENSITY,
    toneMapped: true,
    roughness: 1,
    metalness: 0,
  });
}
