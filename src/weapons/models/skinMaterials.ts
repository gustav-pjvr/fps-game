import * as THREE from 'three';
import { each, encode, fbm, grime, hash2, makeCanvas, mulCol, setCol, SIZE, type MaterialCanvas } from '../../render/proceduralTexture.ts';
import type { MaterialSlot } from './kit/GunBuilder.ts';
import { SKINS, type SkinId } from './skins.ts';
import { getWeaponMaterials } from './weaponMaterials.ts';

type Rgb = readonly [number, number, number];

/** Every slot a weapon mesh can ask for except `glow`, which is one material per weapon instance
 * (createSkinGlow), because it dims with that weapon's own magazine. */
export type SkinMaterialSet = Readonly<Record<Exclude<MaterialSlot, 'glow'>, THREE.Material>>;

/** Light line brightness at rest. Bloom (Medium and High) supplies the halo. */
export const LIGHT_LINE_INTENSITY = 1.5;
/** Full-magazine brightness of the ammo witness light, low enough that ACES keeps its colour. */
export const SKIN_GLOW_INTENSITY = 1.6;

// --- Pattern canvases. Colours are linear; encode() writes sRGB. -------------------------------

/** Steel and coated metal: fine grain, faint machining lines, a little wear. */
function metalCanvas(base: Rgb, gloss: number, seed: number, wear = 0.25): MaterialCanvas {
  const c = makeCanvas();
  each((x, y, i, fx, fy) => {
    const n = fbm(fx, fy, 16, 4, seed);
    const streak = fbm(fx * 0.12, fy, 48, 2, seed + 5);
    const k = 0.82 + n * 0.28 + streak * 0.1;
    setCol(c, i, base[0] * k, base[1] * k, base[2] * k);
    let h = 0.4 + n * 0.08;
    if (y % 96 < 2) { h -= 0.12; mulCol(c, i, 0.72); }
    if ((x + (y >> 6) * 37) % 128 < 1) h -= 0.05;
    c.h[i] = h;
    c.gl[i] = gloss * (0.85 + streak * 0.3);
  });
  if (wear > 0) grime(c, seed + 11, wear);
  return c;
}

/** Moulded polymer and rubber: flat colour with a fine stipple, felt more than seen. */
function polymerCanvas(base: Rgb, gloss: number, seed: number): MaterialCanvas {
  const c = makeCanvas();
  each((x, y, i, fx, fy) => {
    const n = fbm(fx, fy, 8, 3, seed);
    const k = 0.94 + n * 0.12;
    setCol(c, i, base[0] * k, base[1] * k, base[2] * k);
    const dot = hash2(x, y, seed + 3);
    c.h[i] = 0.3 + dot * 0.006;
    c.gl[i] = gloss * (0.92 + dot * 0.12);
  });
  return c;
}

/** Brushed woodland blotches: each colour takes a band of one noise field. */
function blotchCanvas(colors: readonly Rgb[], gloss: number, seed: number): MaterialCanvas {
  const c = makeCanvas();
  each((_x, _y, i, fx, fy) => {
    const n = fbm(fx, fy, 3, 4, seed) * 0.7 + fbm(fx, fy, 7, 2, seed + 19) * 0.3;
    const index = Math.min(colors.length - 1, Math.max(0, Math.floor((n - 0.28) / 0.44 * colors.length)));
    const col = colors[index]!;
    const k = 0.88 + fbm(fx, fy, 24, 2, seed + 7) * 0.24;
    setCol(c, i, col[0] * k, col[1] * k, col[2] * k);
    c.h[i] = 0.3 + fbm(fx, fy, 32, 2, seed + 9) * 0.12;
    c.gl[i] = gloss;
  });
  grime(c, seed + 23, 0.2);
  return c;
}

/** Splinter camouflage: hard-edged shards, each cell one colour. */
function splinterCanvas(colors: readonly Rgb[], gloss: number, seed: number): MaterialCanvas {
  const c = makeCanvas();
  const cells = 6;
  each((_x, _y, i, fx, fy) => {
    // Shear the grid both ways so cell edges run at splinter angles; the grid still tiles.
    const u = (fx + fy * 0.5) * cells, v = (fy - fx * 0.5 + 1) * cells;
    const cu = Math.floor(u), cv = Math.floor(v);
    const upper = (u - cu) + (v - cv) > 1 ? 1 : 0;
    const pick = hash2(((cu % cells) + cells) % cells + upper * 13, ((cv % cells) + cells) % cells, seed);
    const col = colors[Math.min(colors.length - 1, Math.floor(pick * colors.length))]!;
    const k = 0.92 + fbm(fx, fy, 24, 2, seed + 4) * 0.16;
    setCol(c, i, col[0] * k, col[1] * k, col[2] * k);
    c.h[i] = 0.3 + fbm(fx, fy, 32, 2, seed + 6) * 0.1;
    c.gl[i] = gloss;
  });
  return c;
}

/** Twill carbon weave under a clear coat. */
function weaveCanvas(base: Rgb, seed: number): MaterialCanvas {
  const c = makeCanvas();
  const tow = 4;
  each((x, y, i, fx, fy) => {
    const cx = Math.floor(x / tow), cy = Math.floor(y / tow);
    const over = ((cx + cy) & 3) < 2;
    const along = over ? (x % tow) / tow : (y % tow) / tow;
    const across = over ? (y % tow) / tow : (x % tow) / tow;
    const sheen = 0.55 + 0.45 * Math.sin(along * Math.PI);
    const k = (over ? 1 : 0.62) * sheen * (0.9 + fbm(fx, fy, 32, 2, seed) * 0.2);
    setCol(c, i, base[0] * k * 2.2, base[1] * k * 2.2, base[2] * k * 2.2);
    c.h[i] = 0.3 + Math.sin(across * Math.PI) * 0.05;
    c.gl[i] = 0.8;
  });
  return c;
}

/** Oiled walnut: long grain with darker figure. */
function woodCanvas(base: Rgb, seed: number): MaterialCanvas {
  const c = makeCanvas();
  each((_x, _y, i, fx, fy) => {
    const warp = fbm(fx, fy, 3, 3, seed) * 0.35;
    const rings = Math.sin((fy * 9 + warp * 6 + fbm(fx * 0.25, fy, 12, 2, seed + 2) * 1.6) * Math.PI * 2);
    const figure = fbm(fx * 0.2, fy, 28, 3, seed + 5);
    const k = 0.62 + rings * 0.16 + figure * 0.5;
    setCol(c, i, base[0] * k, base[1] * k * 0.96, base[2] * k * 0.9);
    c.h[i] = 0.35 + rings * 0.04 + figure * 0.05;
    c.gl[i] = 0.55 + figure * 0.15;
  });
  return c;
}

/** Plated metal cut with scrollwork: the colour barely moves, the height field does the work. */
function engravedCanvas(base: Rgb, seed: number): MaterialCanvas {
  const c = makeCanvas();
  each((_x, _y, i, fx, fy) => {
    const a = fx * Math.PI * 2, b = fy * Math.PI * 2;
    const scroll = Math.sin(a * 7 + Math.sin(b * 5) * 2.2) * Math.cos(b * 7 + Math.cos(a * 5) * 2.2);
    const vine = Math.sin((fx + fy) * Math.PI * 18 + scroll * 2.5);
    const cut = Math.abs(scroll) < 0.13 || Math.abs(vine) < 0.08;
    const k = (cut ? 0.72 : 1) * (0.9 + fbm(fx, fy, 24, 2, seed) * 0.2);
    setCol(c, i, base[0] * k, base[1] * k, base[2] * k);
    c.h[i] = cut ? 0.36 : 0.5 + scroll * 0.03;
    c.gl[i] = cut ? 0.55 : 0.9;
  });
  return c;
}

/** Woven cloth or wound cord. */
function clothCanvas(base: Rgb, seed: number): MaterialCanvas {
  const c = makeCanvas();
  each((x, y, i, fx, fy) => {
    const warp = Math.sin((x / SIZE) * Math.PI * 2 * 40), weft = Math.sin((y / SIZE) * Math.PI * 2 * 40);
    const k = 0.72 + (warp * weft) * 0.14 + fbm(fx, fy, 16, 3, seed) * 0.3;
    setCol(c, i, base[0] * k, base[1] * k, base[2] * k);
    c.h[i] = 0.4 + warp * 0.12 + weft * 0.12;
    c.gl[i] = 0.08;
  });
  grime(c, seed + 3, 0.3);
  return c;
}

/** Graphite shell with a faint cell pattern. */
function cellCanvas(base: Rgb, gloss: number, seed: number): MaterialCanvas {
  const c = makeCanvas();
  const pitch = 8;
  each((x, y, i, fx, fy) => {
    const row = Math.floor(y / (pitch * 0.5));
    const ox = (x + (row & 1) * pitch * 0.5) % pitch, oy = y % (pitch * 0.5);
    const edge = Math.min(ox, pitch - ox, oy * 2, (pitch * 0.5 - oy) * 2);
    const line = edge < 1;
    const k = (line ? 1.18 : 1) * (0.9 + fbm(fx, fy, 16, 3, seed) * 0.2);
    setCol(c, i, base[0] * k, base[1] * k, base[2] * k);
    c.h[i] = line ? 0.39 : 0.4;
    c.gl[i] = line ? 0.8 : gloss;
  });
  return c;
}

// --- Sets ---------------------------------------------------------------------------------------

function standard(name: string, canvas: MaterialCanvas, metalness: number, envMapIntensity = 0.7): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, ...encode(canvas), metalness, roughness: 1, envMapIntensity });
}

function emissive(name: string, color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1, metalness: 0 });
}

interface Palette {
  metal: THREE.MeshStandardMaterial;
  metalAlt: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  furniture: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  edge: THREE.MeshStandardMaterial;
  wrap: THREE.MeshStandardMaterial;
  gold?: THREE.MeshStandardMaterial;
}

function flat(name: string, color: Rgb, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, color: new THREE.Color(color[0], color[1], color[2]), roughness, metalness, envMapIntensity: 0.7 });
}

const PALETTES: Readonly<Record<SkinId, () => Palette>> = {
  service: () => ({
    metal: standard('service-metal', metalCanvas([0.075, 0.08, 0.092], 0.56, 101), 0.45),
    metalAlt: standard('service-steel', metalCanvas([0.2, 0.2, 0.205], 0.74, 121, 0.15), 0.75),
    polymer: standard('service-polymer', polymerCanvas([0.04, 0.042, 0.046], 0.34, 131), 0),
    furniture: standard('service-furniture', polymerCanvas([0.055, 0.058, 0.062], 0.4, 141), 0),
    accent: flat('service-accent', [0.75, 0.42, 0.06], 0.55),
    rubber: standard('service-rubber', polymerCanvas([0.022, 0.022, 0.024], 0.14, 151), 0),
    edge: standard('service-edge', metalCanvas([0.62, 0.64, 0.66], 0.88, 161, 0.08), 0.9, 1),
    wrap: standard('service-cord', clothCanvas([0.03, 0.03, 0.032], 171), 0),
  }),
  ranger: () => ({
    metal: standard('ranger-metal', metalCanvas([0.16, 0.18, 0.15], 0.38, 201, 0.4), 0.3),
    metalAlt: standard('ranger-steel', metalCanvas([0.2, 0.2, 0.185], 0.5, 211, 0.4), 0.55),
    polymer: standard('ranger-polymer', polymerCanvas([0.12, 0.092, 0.058], 0.3, 221), 0),
    furniture: standard('ranger-camo', blotchCanvas([[0.03, 0.04, 0.03], [0.13, 0.08, 0.04], [0.1, 0.13, 0.05], [0.36, 0.3, 0.18]], 0.28, 231), 0),
    accent: flat('ranger-accent', [0.45, 0.36, 0.2], 0.7),
    rubber: standard('ranger-rubber', polymerCanvas([0.05, 0.045, 0.035], 0.14, 241), 0),
    edge: standard('ranger-edge', metalCanvas([0.36, 0.37, 0.34], 0.66, 251, 0.35), 0.85, 0.9),
    wrap: standard('ranger-burlap', clothCanvas([0.38, 0.31, 0.19], 261), 0),
  }),
  whiteout: () => ({
    metal: standard('whiteout-metal', metalCanvas([0.55, 0.57, 0.6], 0.48, 301, 0.18), 0.15),
    metalAlt: standard('whiteout-steel', metalCanvas([0.3, 0.31, 0.33], 0.7, 311, 0.15), 0.6),
    polymer: standard('whiteout-polymer', polymerCanvas([0.6, 0.61, 0.62], 0.36, 321), 0),
    furniture: standard('whiteout-camo', splinterCanvas([[0.75, 0.77, 0.8], [0.72, 0.74, 0.78], [0.45, 0.48, 0.52], [0.25, 0.3, 0.36]], 0.36, 331), 0),
    accent: flat('whiteout-accent', [0.3, 0.55, 0.85], 0.5),
    rubber: standard('whiteout-rubber', polymerCanvas([0.2, 0.21, 0.22], 0.16, 341), 0),
    edge: standard('whiteout-edge', metalCanvas([0.7, 0.72, 0.75], 0.9, 351, 0.05), 0.9, 1),
    wrap: standard('whiteout-tape', clothCanvas([0.7, 0.7, 0.68], 361), 0),
  }),
  ember: () => ({
    metal: standard('ember-metal', metalCanvas([0.034, 0.032, 0.03], 0.44, 401, 0.1), 0.45),
    metalAlt: standard('ember-bronze', metalCanvas([0.5, 0.22, 0.07], 0.78, 411, 0.3), 0.9, 1),
    polymer: standard('ember-polymer', polymerCanvas([0.03, 0.028, 0.027], 0.3, 421), 0),
    furniture: standard('ember-weave', weaveCanvas([0.03, 0.03, 0.032], 431), 0.2, 0.9),
    accent: flat('ember-accent', [0.9, 0.3, 0.04], 0.45),
    rubber: standard('ember-rubber', polymerCanvas([0.02, 0.019, 0.018], 0.14, 441), 0),
    edge: standard('ember-edge', metalCanvas([0.4, 0.2, 0.1], 0.82, 451, 0.2), 0.9, 1),
    wrap: standard('ember-cord', clothCanvas([0.05, 0.03, 0.02], 461), 0),
  }),
  gilded: () => {
    const gold = standard('gilded-gold', engravedCanvas([0.78, 0.55, 0.16], 501), 1, 1.1);
    return {
      metal: gold,
      metalAlt: standard('gilded-nickel', metalCanvas([0.62, 0.62, 0.6], 0.92, 511, 0.04), 1, 1.1),
      polymer: standard('gilded-walnut-dark', woodCanvas([0.11, 0.048, 0.022], 521), 0),
      furniture: standard('gilded-walnut', woodCanvas([0.17, 0.075, 0.032], 531), 0),
      accent: flat('gilded-accent', [0.85, 0.62, 0.2], 0.3, 1),
      rubber: standard('gilded-leather', polymerCanvas([0.1, 0.045, 0.025], 0.3, 541), 0),
      edge: standard('gilded-edge', metalCanvas([0.75, 0.75, 0.74], 0.96, 551, 0.02), 1, 1.2),
      wrap: standard('gilded-leather-wrap', clothCanvas([0.12, 0.05, 0.03], 561), 0),
      gold,
    };
  },
  pulse: () => ({
    metal: standard('pulse-shell', metalCanvas([0.05, 0.052, 0.068], 0.66, 601, 0.05), 0.55),
    metalAlt: standard('pulse-chrome', metalCanvas([0.13, 0.13, 0.17], 0.92, 611, 0.05), 0.9, 1),
    polymer: standard('pulse-polymer', polymerCanvas([0.035, 0.027, 0.06], 0.4, 621), 0),
    furniture: standard('pulse-furniture', cellCanvas([0.045, 0.036, 0.085], 0.5, 631), 0.2),
    accent: flat('pulse-accent', [0.15, 0.8, 0.9], 0.4),
    rubber: standard('pulse-rubber', polymerCanvas([0.02, 0.018, 0.03], 0.16, 641), 0),
    edge: standard('pulse-edge', metalCanvas([0.3, 0.26, 0.42], 0.94, 651, 0.03), 0.95, 1.1),
    wrap: standard('pulse-cord', clothCanvas([0.03, 0.025, 0.05], 661), 0),
  }),
};

const sets = new Map<SkinId, SkinMaterialSet>();
let environment: THREE.Texture | null = null;
let shared: { voidMaterial: THREE.MeshBasicMaterial; glass: THREE.MeshStandardMaterial; gold: THREE.MeshStandardMaterial } | undefined;

function sharedMaterials(): NonNullable<typeof shared> {
  shared ??= {
    voidMaterial: new THREE.MeshBasicMaterial({ name: 'weapon-void', color: 0x030405 }),
    glass: new THREE.MeshStandardMaterial({
      name: 'weapon-glass', color: 0x7fd4e6, transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0.2,
      depthWrite: false, envMapIntensity: 1.4, side: THREE.DoubleSide,
    }),
    gold: new THREE.MeshStandardMaterial({ name: 'weapon-gold', color: 0xd4af37, roughness: 0.3, metalness: 0.9, envMapIntensity: 0.9 }),
  };
  return shared;
}

/** The materials a skin puts on a weapon, built on first use and shared by every weapon wearing
 * that skin (the view model, other players' copies and the menu previews). */
export function getSkinMaterials(skinId: SkinId): SkinMaterialSet {
  let set = sets.get(skinId);
  if (set) return set;
  const palette = PALETTES[skinId]();
  const common = sharedMaterials();
  const arms = getWeaponMaterials();
  const skin = SKINS[skinId];
  set = {
    metal: palette.metal,
    metalAlt: palette.metalAlt,
    polymer: palette.polymer,
    furniture: palette.furniture,
    accent: palette.accent,
    rubber: palette.rubber,
    edge: palette.edge,
    wrap: palette.wrap,
    gold: palette.gold ?? common.gold,
    void: common.voidMaterial,
    glass: common.glass,
    sight: emissive(`${skinId}-sight`, skin.sightColor, 1.6),
    lightLine: emissive(`${skinId}-light-line`, skin.glow.full, LIGHT_LINE_INTENSITY),
    glove: arms.glove,
    sleeve: arms.sleeve,
  };
  sets.set(skinId, set);
  applyEnvironment(set);
  return set;
}

/** The ammo witness light for one weapon instance: textures are shared, emissive state is not. */
export function createSkinGlow(skinId: SkinId): THREE.MeshStandardMaterial {
  const material = emissive(`${skinId}-glow`, SKINS[skinId].glow.full, SKIN_GLOW_INTENSITY);
  material.toneMapped = true;
  return material;
}

/** Breathes the light lines of every skin that has a pulse. Call once a frame with a running
 * clock; the materials are shared, so every copy of a skin breathes together. */
export function updateSkinAnimations(timeSeconds: number): void {
  for (const [skinId, set] of sets) {
    const pulse = SKINS[skinId].pulse;
    if (!pulse) continue;
    const wave = 0.5 + 0.5 * Math.sin(timeSeconds * pulse.rate * Math.PI * 2);
    (set.lightLine as THREE.MeshStandardMaterial).emissiveIntensity = LIGHT_LINE_INTENSITY * (1 - pulse.depth * wave);
  }
}

/** Metal needs something to reflect; weaponMaterials.setWeaponEnvironment forwards the sky map. */
export function setSkinEnvironment(texture: THREE.Texture | null): void {
  environment = texture;
  for (const set of sets.values()) applyEnvironment(set);
}

function applyEnvironment(set: SkinMaterialSet): void {
  for (const slot of ['metal', 'metalAlt', 'furniture', 'edge', 'gold', 'glass', 'accent'] as const) {
    const material = set[slot] as THREE.MeshStandardMaterial;
    if (material.envMap === environment) continue;
    material.envMap = environment;
    material.needsUpdate = true;
  }
}
