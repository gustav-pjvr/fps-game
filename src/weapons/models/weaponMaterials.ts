import * as THREE from 'three';

const SIZE = 256;
const { clamp, lerp } = THREE.MathUtils;

// Opus's seeded permutation keeps the material noise repeatable and tileable.
function makePermutation(): Uint8Array {
  let seed = 1337;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const j = Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return Uint8Array.from({ length: 512 }, (_, i) => p[i & 255]!);
}

let permutation: Uint8Array | undefined;
function hash2(x: number, y: number, seed: number): number {
  const p = permutation ??= makePermutation();
  return p[(p[(x + seed * 17) & 255]! + y) & 255]! / 255;
}

function vnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  return lerp(lerp(hash2(x0, y0, seed), hash2(x1, y0, seed), u),
    lerp(hash2(x0, y1, seed), hash2(x1, y1, seed), u), v);
}

function fbm(fx: number, fy: number, frequency: number, octaves: number, seed: number): number {
  let sum = 0, amplitude = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(fx * frequency, fy * frequency, frequency, seed + o) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

function makeCanvas() {
  return {
    r: new Float32Array(SIZE * SIZE), g: new Float32Array(SIZE * SIZE), b: new Float32Array(SIZE * SIZE),
    h: new Float32Array(SIZE * SIZE), gl: new Float32Array(SIZE * SIZE),
  };
}
type MaterialCanvas = ReturnType<typeof makeCanvas>;

function each(fn: (x: number, y: number, i: number, fx: number, fy: number) => void): void {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) fn(x, y, y * SIZE + x, x / SIZE, y / SIZE);
  }
}

function setCol(c: MaterialCanvas, i: number, r: number, g: number, b: number): void {
  c.r[i] = r; c.g[i] = g; c.b[i] = b;
}

function mulCol(c: MaterialCanvas, i: number, k: number): void {
  c.r[i] = c.r[i]! * k; c.g[i] = c.g[i]! * k; c.b[i] = c.b[i]! * k;
}

function bevelRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number, bevel: number): number {
  if (x < x0 || x > x1 || y < y0 || y > y1) return 0;
  return clamp(Math.min(x - x0, x1 - x, y - y0, y1 - y) / bevel, 0, 1);
}

function grime(c: MaterialCanvas, seed: number, amount: number): void {
  each((_x, _y, i, fx, fy) => {
    const n = fbm(fx, fy, 4, 5, seed);
    mulCol(c, i, 1 - amount * THREE.MathUtils.smoothstep(n, 0.45, 0.75));
    mulCol(c, i, 0.92 + fbm(fx, fy, 16, 3, seed + 9) * 0.16);
  });
}

function gunCanvas(): MaterialCanvas {
  const c = makeCanvas();
  each((x, y, i, fx, fy) => {
    const n = fbm(fx, fy, 16, 4, 101);
    const base = 0.13 + n * 0.06;
    setCol(c, i, base, base * 1.02, base * 1.06);
    let h = 0.4 + n * 0.1;
    if (x > 160 && ((x + y) % 6 < 2 || (x - y + 600) % 6 < 2)) h -= 0.15;
    if (y % 64 < 2) { h -= 0.2; mulCol(c, i, 0.6); }
    c.h[i] = h;
    c.gl[i] = 0.75;
  });
  return c;
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

function texture(data: Uint8Array, srgb = false): THREE.DataTexture {
  const result = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  result.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.generateMipmaps = true;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.magFilter = THREE.LinearFilter;
  // Match the image-downward height field used by Opus's normal encoder.
  result.flipY = true;
  result.needsUpdate = true;
  return result;
}

function encode(c: MaterialCanvas) {
  const albedo = new Uint8Array(SIZE * SIZE * 4);
  const normal = new Uint8Array(albedo.length);
  const roughness = new Uint8Array(albedo.length);
  each((x, y, i) => {
    const xl = y * SIZE + (x + SIZE - 1) % SIZE, xr = y * SIZE + (x + 1) % SIZE;
    const yu = ((y + SIZE - 1) % SIZE) * SIZE + x, yd = ((y + 1) % SIZE) * SIZE + x;
    const nx = -(c.h[xr]! - c.h[xl]!) * 10, ny = (c.h[yd]! - c.h[yu]!) * 10;
    const length = Math.hypot(nx, ny, 1);
    const o = i * 4;
    albedo[o] = Math.round(Math.pow(clamp(c.r[i]!, 0, 1), 1 / 2.2) * 255);
    albedo[o + 1] = Math.round(Math.pow(clamp(c.g[i]!, 0, 1), 1 / 2.2) * 255);
    albedo[o + 2] = Math.round(Math.pow(clamp(c.b[i]!, 0, 1), 1 / 2.2) * 255);
    albedo[o + 3] = 255;
    normal[o] = Math.round((nx / length * 0.5 + 0.5) * 255);
    normal[o + 1] = Math.round((ny / length * 0.5 + 0.5) * 255);
    normal[o + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
    normal[o + 3] = 255;
    const value = Math.round((1 - clamp(c.gl[i]!, 0, 1)) * 255);
    roughness[o] = roughness[o + 1] = roughness[o + 2] = value;
    roughness[o + 3] = 255;
  });
  return { map: texture(albedo, true), normalMap: texture(normal), roughnessMap: texture(roughness) };
}

function metal(name: string, canvas: MaterialCanvas, metalness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, ...encode(canvas), metalness, roughness: 1 });
}

function buildMaterials() {
  return {
    gunmetal: metal('opus-gunmetal', gunCanvas(), 0.6),
    pipe: metal('opus-pipe', pipeCanvas(), 0.8),
    trim: metal('opus-trim', trimCanvas(), 0.3),
    sleeve: new THREE.MeshStandardMaterial({ name: 'opus-sleeve', color: 0x3b4a42, roughness: 0.9, metalness: 0 }),
    glove: new THREE.MeshStandardMaterial({ name: 'opus-glove', color: 0x2a2a28, roughness: 0.35, metalness: 0 }),
    gold: new THREE.MeshStandardMaterial({ name: 'opus-gold', color: 0xd4af37, roughness: 0.3, metalness: 0.8 }),
    glowMaps: encode(glowCanvas()),
  };
}

let materials: ReturnType<typeof buildMaterials> | undefined;

export function getWeaponMaterials(): ReturnType<typeof buildMaterials> {
  return materials ??= buildMaterials();
}

/** Textures are shared, but emissive state belongs to one weapon instance. */
export function createWeaponGlow(sight = false): THREE.MeshStandardMaterial {
  const maps = getWeaponMaterials().glowMaps;
  return new THREE.MeshStandardMaterial({
    name: sight ? 'opus-sight' : 'opus-glow',
    ...maps,
    color: 0x000000,
    emissiveMap: maps.map,
    emissive: sight ? 0xff6a3a : 0x6ff0dc,
    emissiveIntensity: 2.5,
    toneMapped: true,
    roughness: 1,
    metalness: 0,
  });
}
