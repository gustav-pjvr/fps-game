import * as THREE from 'three';

export const SIZE = 256;
const { clamp, lerp } = THREE.MathUtils;

// Opus's seeded permutation keeps the material noise repeatable and tileable.
export function makePermutation(): Uint8Array {
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
export function hash2(x: number, y: number, seed: number): number {
  const p = permutation ??= makePermutation();
  return p[(p[(x + seed * 17) & 255]! + y) & 255]! / 255;
}

export function vnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  return lerp(lerp(hash2(x0, y0, seed), hash2(x1, y0, seed), u),
    lerp(hash2(x0, y1, seed), hash2(x1, y1, seed), u), v);
}

export function fbm(fx: number, fy: number, frequency: number, octaves: number, seed: number): number {
  let sum = 0, amplitude = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(fx * frequency, fy * frequency, frequency, seed + o) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

export function makeCanvas() {
  return {
    r: new Float32Array(SIZE * SIZE), g: new Float32Array(SIZE * SIZE), b: new Float32Array(SIZE * SIZE),
    h: new Float32Array(SIZE * SIZE), gl: new Float32Array(SIZE * SIZE),
  };
}
export type MaterialCanvas = ReturnType<typeof makeCanvas>;

export function each(fn: (x: number, y: number, i: number, fx: number, fy: number) => void): void {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) fn(x, y, y * SIZE + x, x / SIZE, y / SIZE);
  }
}

export function setCol(c: MaterialCanvas, i: number, r: number, g: number, b: number): void {
  c.r[i] = r; c.g[i] = g; c.b[i] = b;
}

export function mulCol(c: MaterialCanvas, i: number, k: number): void {
  c.r[i] = c.r[i]! * k; c.g[i] = c.g[i]! * k; c.b[i] = c.b[i]! * k;
}

export function bevelRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number, bevel: number): number {
  if (x < x0 || x > x1 || y < y0 || y > y1) return 0;
  return clamp(Math.min(x - x0, x1 - x, y - y0, y1 - y) / bevel, 0, 1);
}

export function grime(c: MaterialCanvas, seed: number, amount: number): void {
  each((_x, _y, i, fx, fy) => {
    const n = fbm(fx, fy, 4, 5, seed);
    mulCol(c, i, 1 - amount * THREE.MathUtils.smoothstep(n, 0.45, 0.75));
    mulCol(c, i, 0.92 + fbm(fx, fy, 16, 3, seed + 9) * 0.16);
  });
}

export function texture(data: Uint8Array, srgb = false): THREE.DataTexture {
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

export function encode(c: MaterialCanvas) {
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

