import * as THREE from 'three';
import { WEAPON_HIP_POSITION, type WeaponViewModel } from '../viewModel.ts';
import { createWeaponGlow, getWeaponMaterials } from './weaponMaterials.ts';

type Point = readonly [number, number, number];
interface ModelTuning { scale: number; offset: Point }

/** Camera-space adjustments for visual tuning, independent of the manager's hip/ADS pose. Scales
 * are about 1.15x the Opus size, because Opus drew its view model at a 60 degree FOV and ours shares
 * the 75 degree world camera, which shrinks it on screen. */
export const WEAPON_MODEL_TUNING = {
  rifle: { scale: 0.977, offset: [-0.07, 0.05, 0.14] },
  pistol: { scale: 1.093, offset: [-0.07, 0.04, 0.1] },
  mp5: { scale: 1.035, offset: [-0.07, 0.05, 0.12] },
  shotgun: { scale: 0.977, offset: [-0.07, 0.04, 0.14] },
  sniper: { scale: 0.92, offset: [-0.07, 0.035, 0.13] },
  knife: { scale: 1.093, offset: [-0.04, 0.03, 0.08] },
  gooseLauncher: { scale: 0.977, offset: [-0.06, 0.04, 0.13] },
} satisfies Record<string, ModelTuning>;

class Parts {
  readonly group = new THREE.Group();
  readonly materials = getWeaponMaterials();
  readonly glowMaterials = [createWeaponGlow()];
  readonly sight = createWeaponGlow(true);
  magazine: THREE.Object3D | null = null;
  muzzle: Point = [0, 0, 0];

  get glow(): THREE.MeshStandardMaterial { return this.glowMaterials[0]!; }

  box(name: string, size: Point, position: Point, material = this.materials.gunmetal, rotation: Point = [0, 0, 0], parent = this.group): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(...size);
    const uv = geometry.getAttribute('uv');
    const [w, h, d] = size;
    const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const repeatSize = material === this.materials.sleeve ? 0.4 : 0.3;
    for (let i = 0; i < uv.count; i++) {
      const face = faces[Math.floor(i / 4)]!;
      uv.setXY(i, uv.getX(i) * face[0]! / repeatSize, uv.getY(i) * face[1]! / repeatSize);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    // Opus's at(x, y, z, ry, rx, rz) composes Y, then X, then Z.
    mesh.rotation.set(rotation[1], rotation[0], rotation[2], 'YXZ');
    parent.add(mesh);
    return mesh;
  }

  tube(name: string, a: Point, b: Point, radius: number, material = this.materials.pipe, endRadius = radius, parent = this.group): THREE.Mesh {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(endRadius, radius, direction.length(), 12);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    parent.add(mesh);
    return mesh;
  }

  ring(name: string, radius: number, thickness: number, position: Point, material: THREE.MeshStandardMaterial): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 6, 16), material);
    mesh.name = name;
    mesh.position.set(...position);
    this.group.add(mesh);
    return mesh;
  }

  mag(position: Point): THREE.Group {
    const magazine = new THREE.Group();
    magazine.name = 'magazine';
    magazine.position.set(...position);
    this.group.add(magazine);
    this.magazine = magazine;
    return magazine;
  }

  hands(support = true, supportZ = -0.33): void {
    this.box('trigger-hand', [0.08, 0.09, 0.1], [0.005, -0.13, 0.08], this.materials.glove, [0, 0.25, 0]);
    this.box('trigger-sleeve', [0.1, 0.1, 0.32], [0.04, -0.2, 0.28], this.materials.sleeve, [0, 0.5, 0]);
    if (support) {
      this.box('support-hand', [0.09, 0.07, 0.1], [-0.02, -0.06, supportZ], this.materials.glove);
      this.box('support-sleeve', [0.1, 0.1, 0.4], [-0.12, -0.16, supportZ + 0.21], this.materials.sleeve, [-0.6, 0, 0]);
    }
  }
}

function rifle(): Parts {
  const p = new Parts();
  const { gunmetal, pipe, trim } = p.materials;
  p.box('receiver', [0.085, 0.11, 0.42], [0, 0, 0]);
  p.box('handguard', [0.07, 0.075, 0.28], [0, 0.015, -0.33]);
  for (let k = 0; k < 4; k++) p.box(`heat-fin-${k}`, [0.075, 0.012, 0.03], [0, 0.055, -0.24 - k * 0.055], pipe);
  p.tube('barrel', [0, 0, -0.46], [0, 0, -0.62], 0.019);
  p.tube('muzzle', [0, 0, -0.6], [0, 0, -0.66], 0.027, gunmetal);
  p.box('sight-rail', [0.035, 0.045, 0.2], [0, 0.085, -0.02]);
  p.box('rear-sight', [0.05, 0.05, 0.05], [0, 0.1, 0.07]);
  p.box('front-sight', [0.05, 0.05, 0.04], [0, 0.1, -0.11]);
  p.box('grip', [0.05, 0.13, 0.065], [0, -0.1, 0.08], gunmetal, [0, 0.25, 0]);
  p.box('stock', [0.055, 0.09, 0.17], [0, -0.01, 0.28]);
  p.box('stock-pad', [0.06, 0.12, 0.04], [0, -0.04, 0.37]);
  p.box('hazard-plate', [0.09, 0.03, 0.12], [0, -0.06, -0.3], trim);
  p.hands();
  for (const x of [-0.044, 0.044]) p.box(`energy-strip-${x}`, [0.012, 0.035, 0.14], [x, 0, -0.06], p.glow);
  p.box('top-energy-strip', [0.06, 0.008, 0.2], [0, 0.054, -0.33], p.glow);
  p.box('sight-dot', [0.012, 0.012, 0.005], [0, 0.112, 0.09], p.sight);
  p.box('magazine-body', [0.05, 0.12, 0.07], [0, 0, 0], gunmetal, [0, 0, 0], p.mag([0, -0.1, -0.08]));
  p.muzzle = [0, 0, -0.66];
  return p;
}

function pistol(): Parts {
  const p = new Parts();
  const { gunmetal, pipe, trim } = p.materials;
  p.box('slab-slide', [0.07, 0.085, 0.27], [0, 0.02, -0.055]);
  p.box('lower-frame', [0.06, 0.045, 0.21], [0, -0.04, -0.025]);
  p.tube('barrel-shroud', [0, 0.02, -0.18], [0, 0.02, -0.28], 0.025);
  p.ring('muzzle', 0.025, 0.006, [0, 0.02, -0.28], gunmetal);
  p.box('grip', [0.05, 0.13, 0.065], [0, -0.1, 0.08], gunmetal, [0, 0.25, 0]);
  const magazine = p.mag([0, -0.16, 0.065]);
  p.box('flush-magazine', [0.045, 0.025, 0.06], [0, 0, 0], pipe, [0, 0.25, 0], magazine);
  p.box('trigger-guard', [0.025, 0.015, 0.08], [0, -0.092, -0.005]);
  p.box('rear-sight', [0.05, 0.025, 0.025], [0, 0.073, 0.055]);
  p.box('front-sight', [0.012, 0.02, 0.02], [0, 0.07, -0.165]);
  p.box('sight-dot', [0.009, 0.009, 0.005], [0, 0.077, 0.07], p.sight);
  for (const x of [-0.037, 0.037]) p.box(`energy-strip-${x}`, [0.008, 0.016, 0.12], [x, 0.02, -0.05], p.glow);
  p.box('hazard-plate', [0.062, 0.015, 0.05], [0, -0.064, -0.08], trim);
  p.hands(false);
  p.muzzle = [0, 0.02, -0.286];
  return p;
}

function mp5(): Parts {
  const p = new Parts();
  const { gunmetal, pipe, trim } = p.materials;
  p.box('receiver', [0.075, 0.09, 0.28], [0, 0, -0.01]);
  p.box('handguard', [0.065, 0.065, 0.17], [0, 0, -0.23], pipe);
  for (let k = 0; k < 4; k++) p.box(`handguard-rib-${k}`, [0.075, 0.075, 0.014], [0, 0, -0.17 - k * 0.04]);
  p.tube('muzzle', [0, 0, -0.31], [0, 0, -0.42], 0.021);
  const magazine = p.mag([0, -0.085, -0.065]);
  p.box('magazine-upper', [0.035, 0.09, 0.05], [0, 0, 0], gunmetal, [0, 0, 0], magazine);
  p.box('magazine-curved', [0.035, 0.085, 0.05], [0, -0.075, -0.02], gunmetal, [0, 0.4, 0], magazine);
  for (const x of [-0.03, 0.03]) p.tube(`wire-stock-${x}`, [x, 0.015, 0.1], [x, 0.015, 0.3], 0.008);
  p.box('stock-pad', [0.075, 0.1, 0.025], [0, -0.02, 0.3]);
  p.box('grip', [0.045, 0.13, 0.06], [0, -0.1, 0.08], gunmetal, [0, 0.25, 0]);
  p.box('sight-rail', [0.035, 0.025, 0.2], [0, 0.06, -0.025]);
  p.box('sight-dot', [0.01, 0.01, 0.005], [0, 0.078, 0.065], p.sight);
  p.box('hazard-plate', [0.077, 0.02, 0.05], [0, -0.03, -0.025], trim);
  for (let k = 0; k < 3; k++) {
    const glow = k === 0 ? p.glow : createWeaponGlow();
    if (k > 0) p.glowMaterials.push(glow);
    glow.userData.burstPip = k;
    p.box(`burst-pip-${k}`, [0.079, 0.018, 0.022], [0, 0.015, -0.08 + k * 0.04], glow);
  }
  p.hands(true, -0.25);
  p.muzzle = [0, 0, -0.42];
  return p;
}

function shotgun(): Parts {
  const p = new Parts();
  const { gunmetal, pipe, trim } = p.materials;
  p.box('heavy-receiver', [0.105, 0.13, 0.3], [0, 0, 0]);
  for (const y of [-0.035, 0.035]) p.tube(`stacked-barrel-${y}`, [0, y, -0.12], [0, y, -0.64], 0.026);
  for (const x of [-0.043, 0.043]) p.box(`shroud-rail-${x}`, [0.018, 0.12, 0.4], [x, 0, -0.37]);
  for (let k = 0; k < 3; k++) p.box(`shroud-bridge-${k}`, [0.1, 0.018, 0.035], [0, 0.065, -0.22 - k * 0.14], pipe);
  p.box('pump', [0.12, 0.065, 0.17], [0, -0.08, -0.32]);
  p.box('pump-hazard', [0.124, 0.028, 0.09], [0, -0.08, -0.32], trim);
  p.box('wide-energy-band', [0.11, 0.035, 0.04], [0, 0.01, -0.07], p.glow);
  p.box('grip', [0.055, 0.13, 0.07], [0, -0.1, 0.08], gunmetal, [0, 0.25, 0]);
  p.box('stock', [0.065, 0.09, 0.22], [0, -0.02, 0.24]);
  p.box('stock-pad', [0.075, 0.14, 0.035], [0, -0.04, 0.36]);
  p.box('sight-rail', [0.025, 0.025, 0.25], [0, 0.08, -0.01]);
  p.box('sight-dot', [0.012, 0.012, 0.006], [0, 0.097, 0.09], p.sight);
  p.box('shell-magazine', [0.065, 0.08, 0.085], [0, 0, 0], gunmetal, [0, 0, 0], p.mag([0, -0.085, -0.035]));
  p.hands(true, -0.32);
  p.muzzle = [0, 0.035, -0.64];
  return p;
}

function sniper(): Parts {
  const p = new Parts();
  const { gunmetal, pipe, trim } = p.materials;
  p.box('bolt-housing', [0.085, 0.1, 0.33], [0, 0, -0.01]);
  p.tube('barrel', [0, 0.015, -0.17], [0, 0.015, -0.83], 0.023);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    p.tube(`barrel-flute-${k}`, [Math.cos(a) * 0.023, 0.015 + Math.sin(a) * 0.023, -0.26],
      [Math.cos(a) * 0.023, 0.015 + Math.sin(a) * 0.023, -0.74], 0.006, pipe);
  }
  p.box('muzzle-brake', [0.07, 0.065, 0.09], [0, 0.015, -0.85]);
  p.box('scope-mount', [0.035, 0.05, 0.2], [0, 0.065, -0.015]);
  p.tube('scope-tube', [0, 0.115, 0.14], [0, 0.115, -0.23], 0.032, gunmetal);
  p.tube('scope-objective', [0, 0.115, -0.21], [0, 0.115, -0.29], 0.043);
  p.ring('scope-lens-ring', 0.028, 0.006, [0, 0.115, 0.145], p.glow);
  p.box('sight-dot', [0.008, 0.008, 0.004], [0, 0.115, 0.15], p.sight);
  p.tube('bolt-handle', [0.04, 0, 0.045], [0.1, -0.025, 0.045], 0.012);
  for (const x of [-0.048, 0.048]) p.tube(`bipod-knuckle-${x}`, [x, -0.025, -0.4], [x, -0.065, -0.25], 0.015);
  for (const y of [0.025, -0.065]) p.tube(`skeleton-stock-${y}`, [0, y, 0.12], [0, y, 0.37], 0.012);
  p.box('stock-pad', [0.065, 0.14, 0.03], [0, -0.03, 0.38]);
  p.box('grip', [0.05, 0.13, 0.065], [0, -0.1, 0.08], gunmetal, [0, 0.25, 0]);
  p.box('hazard-plate', [0.088, 0.025, 0.06], [0, -0.025, -0.075], trim);
  p.box('magazine-body', [0.055, 0.09, 0.08], [0, 0, 0], gunmetal, [0, 0, 0], p.mag([0, -0.085, -0.06]));
  p.hands(true, -0.24);
  p.muzzle = [0, 0.015, -0.895];
  return p;
}

function knife(): Parts {
  const p = new Parts();
  const { gunmetal, pipe } = p.materials;
  p.box('handle', [0.045, 0.04, 0.17], [0, -0.06, 0.06]);
  for (let k = 0; k < 3; k++) p.box(`grip-band-${k}`, [0.05, 0.046, 0.018], [0, -0.06, 0.01 + k * 0.05], pipe);
  p.box('guard-front', [0.1, 0.025, 0.025], [0.025, -0.06, -0.04]);
  p.box('guard-back', [0.1, 0.025, 0.025], [0.025, -0.06, 0.15]);
  p.tube('knuckle-guard', [0.07, -0.06, -0.04], [0.07, -0.06, 0.15], 0.012, gunmetal);
  p.box('blade', [0.055, 0.012, 0.22], [0, -0.06, -0.16], pipe);
  const tip = p.box('blade-tip', [0.055, 0.012, 0.08], [0, -0.06, -0.31], pipe);
  const positions = tip.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    if (positions.getZ(i) < 0) positions.setX(i, 0);
  }
  tip.geometry.computeVertexNormals();
  p.box('edge-glow', [0.004, 0.014, 0.22], [0.027, -0.06, -0.16], p.glow);
  p.hands(false);
  p.muzzle = [0, -0.06, -0.35];
  return p;
}

function gooseLauncher(): Parts {
  const p = new Parts();
  const { gunmetal, pipe, trim, gold } = p.materials;
  p.box('receiver', [0.13, 0.12, 0.28], [0, 0, 0.015]);
  const magazine = p.mag([0, -0.04, -0.12]);
  p.tube('drum', [-0.105, 0, 0], [0.105, 0, 0], 0.105, gunmetal, 0.105, magazine);
  for (const x of [-0.107, 0.107]) p.tube(`drum-gold-${x}`, [x - 0.008, 0, 0], [x + 0.008, 0, 0], 0.108, gold, 0.108, magazine);
  for (let k = 0; k < 4; k++) p.box(`drum-window-${k}`, [0.218, 0.024, 0.032], [0, 0.045 - k * 0.03, -0.045], p.glow, [0, 0, 0], magazine);
  p.tube('barrel-shroud', [0, 0.015, -0.2], [0, 0.015, -0.43], 0.058);
  p.tube('flared-muzzle', [0, 0.015, -0.42], [0, 0.015, -0.54], 0.058, gunmetal, 0.09);
  p.ring('gold-muzzle-lip', 0.087, 0.008, [0, 0.015, -0.54], gold);
  p.box('hazard-plate', [0.135, 0.025, 0.065], [0, 0.025, 0.03], trim);
  p.box('grip', [0.055, 0.13, 0.07], [0, -0.1, 0.08], gunmetal, [0, 0.25, 0]);
  p.box('stock-arm', [0.065, 0.065, 0.2], [0, -0.01, 0.23], pipe);
  p.box('stock-pad', [0.08, 0.14, 0.035], [0, -0.045, 0.34]);
  p.box('gold-stock-band', [0.085, 0.03, 0.04], [0, -0.015, 0.34], gold);
  p.box('sight-rail', [0.04, 0.03, 0.18], [0, 0.075, 0.015]);
  p.box('sight-dot', [0.012, 0.012, 0.005], [0, 0.095, 0.09], p.sight);
  p.hands(true, -0.3);
  p.muzzle = [0, 0.015, -0.548];
  return p;
}

const builders = { rifle, pistol, mp5, shotgun, sniper, knife, gooseLauncher };

export function buildWeaponViewModel(id: string): WeaponViewModel {
  const group = new THREE.Group();
  group.name = `weapon-${id}`;
  group.position.copy(WEAPON_HIP_POSITION);
  if (id === 'unarmed') {
    return { group, muzzleLocalOffset: new THREE.Vector3(), glowMaterials: [], magazine: null, magazineRestPosition: new THREE.Vector3() };
  }
  if (!Object.hasOwn(builders, id)) throw new Error(`Unknown weapon model: ${id}`);
  const key = id as keyof typeof builders;
  const parts = builders[key]();
  const tuning = WEAPON_MODEL_TUNING[key];
  parts.group.name = 'model-tuning';
  parts.group.scale.setScalar(tuning.scale);
  parts.group.position.set(...tuning.offset);
  group.add(parts.group);
  return {
    group,
    muzzleLocalOffset: new THREE.Vector3(...parts.muzzle).multiplyScalar(tuning.scale).add(parts.group.position),
    glowMaterials: parts.glowMaterials,
    magazine: parts.magazine,
    magazineRestPosition: parts.magazine?.position.clone() ?? new THREE.Vector3(),
  };
}
