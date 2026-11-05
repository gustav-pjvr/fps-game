import * as THREE from 'three';
import { ACCENT_CYAN } from '../render/look.ts';
import { mulberry32 } from '../utils/rng.ts';
import { box, boxAlong, boxMatrix, PieceCollector, type BoxTransform, type PieceMaterial } from './structureKit.ts';
import type { TowerPart } from './towerDesign.ts';

export const LAB_INTERIOR_SEED_OFFSET = 719;
export type LabInteriorKind = 'full' | 'compact' | 'ground';

interface Detail {
  readonly material: PieceMaterial;
  readonly shape: 'box' | 'sphere' | 'cylinder' | 'ring';
  readonly box: BoxTransform;
  readonly bob: number;
  readonly phase: number;
}

export interface LabInterior {
  readonly kind: LabInteriorKind;
  /** Lab frame: floor y = 0, entrance wall z = 0, far wall at negative z. */
  readonly parts: TowerPart[];
  readonly details: Detail[];
  readonly lamps: THREE.Vector3[];
  readonly rooms: THREE.Vector3[];
  readonly reactorCores: THREE.Vector3[];
  /** Free floor sites, at least 1 m from walls and clear of the interior solids. */
  readonly pickupSites: THREE.Vector3[];
  readonly crackedTank: number;
}

export interface PlacedLabInterior {
  readonly design: LabInterior;
  readonly matrix: THREE.Matrix4;
}

const STEEL: PieceMaterial = 'steel';
const SKIN: PieceMaterial = 'cladding';
const VEIN: PieceMaterial = 'perforated';
const EYE: PieceMaterial = 'inner-cladding';
const LIQUID: PieceMaterial = 'inner-steel';
const BULB: PieceMaterial = 'inner-roof';

/** Only descriptions here: solver candidates do not allocate GPU resources. */
export function buildLabInterior(kind: LabInteriorKind, seed: number): LabInterior {
  const rng = mulberry32(seed + LAB_INTERIOR_SEED_OFFSET);
  const parts: TowerPart[] = [], details: Detail[] = [], lamps: THREE.Vector3[] = [], rooms: THREE.Vector3[] = [];
  const reactorCores: THREE.Vector3[] = [];
  const point = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const solid = (b: BoxTransform, material: PieceMaterial = STEEL, rail = false) => parts.push({ box: b, material, rail });
  const detail = (material: PieceMaterial, b: BoxTransform, shape: Detail['shape'] = 'box', bob = 0, phase = 0) => {
    details.push({ material, box: b, shape, bob, phase });
  };
  const bar = (a: THREE.Vector3, b: THREE.Vector3, size = 0.06, material: PieceMaterial = STEEL) => detail(material, boxAlong(a, b, size, size));
  const rail = (a: THREE.Vector3, b: THREE.Vector3) => solid(boxAlong(a, b, 0.85, 0.08), STEEL, true);

  if (kind === 'ground') {
    // All furniture stays on the side opposite D1, clear of the door and top landing.
    solid(box(1.65, 0.1, -1.85, 1.45, 0.2, 0.7), 'roof');
    for (const x of [1, 1.65, 2.3]) solid(box(x, 0.5, -1.85, 0.06, 0.6, 0.7), 'roof');
    for (const z of [-2.2, -1.5]) detail(STEEL, box(1.65, 0.8, z, 1.47, 0.06, 0.045));
    solid(box(0.4, 0.45, -2, 0.75, 0.9, 0.9), 'roof');
    for (const x of [0.12, 0.68]) detail(STEEL, box(x, 0.45, -1.54, 0.06, 0.9, 0.025));
    detail('roof', box(1.2, 1.9, -2.64, 1.2, 0.65, 0.06));
    // Box strokes form B3 on the rusted plate, without fonts or textures.
    for (const x of [0.88, 1.42]) {
      for (const y of [1.68, 1.9, 2.12]) detail('hazard', box(x + 0.1, y, -2.595, 0.29, 0.045, 0.025));
      detail('hazard', box(x + 0.24, 1.9, -2.595, 0.045, 0.46, 0.025));
    }
    detail('hazard', box(0.84, 1.9, -2.595, 0.045, 0.46, 0.025));
    for (let i = 0; i < 7; i++) {
      bar(point(-0.4 + i * 0.17, 1.1 + i * 0.12, -2.68), point(-0.25 + i * 0.17, 1.25 + i * 0.12, -2.68), 0.025, VEIN);
    }
    detail(STEEL, box(0.6, 2.8, -0.7, 0.3, 0.12, 0.3));
    detail(BULB, box(0.6, 2.59, -0.7, 0.16, 0.3, 0.16), 'sphere');
    for (const dx of [-0.13, 0.13]) for (const dz of [-0.13, 0.13]) {
      bar(point(0.6 + dx, 2.4, -0.7 + dz), point(0.6 + dx, 2.75, -0.7 + dz), 0.025);
    }
    detail(STEEL, box(0.6, 2.4, -0.7, 0.3, 0.025, 0.3));
    return { kind, parts, details, lamps, rooms, reactorCores, pickupSites: [], crackedTank: -1 };
  }

  const full = kind === 'full';
  const tankXs = full ? [-11, -9, -7, -5, -3] : [-3.5, -1.2, 1.2, 3.5];
  const tankZ = full ? -4.1 : -6.7;
  const crackedTank = Math.floor(rng() * tankXs.length);

  const creature = (x: number, y: number, z: number, onTable: boolean) => {
    const phase = rng() * Math.PI * 2, bob = onTable ? 0 : 0.09;
    const width = 0.32 + rng() * 0.12, length = 0.7 + rng() * 0.24;
    const place = (b: BoxTransform) => {
      if (onTable) {
        const turn = new THREE.Quaternion().setFromAxisAngle(point(1, 0, 0), -Math.PI / 2);
        b.center.applyQuaternion(turn);
        b.rotation.premultiply(turn);
      }
      b.center.add(point(x, y, z));
      return b;
    };
    const flesh = (b: BoxTransform) => detail(SKIN, place(b), 'sphere', bob, phase);
    flesh(box(0, 0, 0, width * 1.7, length, 0.52));
    for (let i = 0; i < 4; i++) flesh(box((rng() - 0.5) * width, (rng() - 0.5) * length, 0.12, 0.27, 0.33, 0.3));
    flesh(box(0.06, length * 0.52, 0, 0.36, 0.34, 0.32));
    const eyes = rng() > 0.5 ? 2 : 1;
    for (let i = 0; i < eyes; i++) detail(EYE, place(box(-0.02 + i * 0.14, length * 0.55, 0.15, 0.065, 0.08, 0.04)), 'sphere', bob, phase);
    const limbs = 6 + Math.floor(rng() * 3);
    for (let i = 0; i < limbs; i++) {
      const side = i % 2 ? 1 : -1, h = (i / limbs - 0.5) * length;
      const a = point(side * width * 0.45, h, 0), b = point(side * 0.36, h - 0.17, 0.12);
      const c = point(side * (0.27 + rng() * 0.11), h - 0.37, 0.18);
      detail(SKIN, place(boxAlong(a, b, 0.09, 0.1)), 'box', bob, phase);
      detail(SKIN, place(boxAlong(b, c, 0.055, 0.065)), 'box', bob, phase);
      detail(VEIN, place(boxAlong(point(side * 0.05, h, 0.26), point(side * 0.2, h - 0.12, 0.22), 0.016, 0.016)), 'box', bob, phase);
    }
  };

  tankXs.forEach((x, i) => {
    // The glass box itself blocks shots and players, including the cracked tank.
    solid(box(x, 1.3, tankZ, 1.2, 2.6, 1.2), 'glass');
    for (const y of [0.12, 2.48]) detail(STEEL, box(x, y, tankZ, 1.22, 0.24, 1.22));
    for (const dx of [-0.57, 0.57]) for (const dz of [-0.57, 0.57]) detail(STEEL, box(x + dx, 1.3, tankZ + dz, 0.045, 2.4, 0.045));
    detail('window', box(x, 2.5, tankZ + 0.616, 0.24, 0.09, 0.018));
    if (i === crackedTank) {
      for (let j = 0; j < 5; j++) bar(point(x - 0.35 + j * 0.13, 0.65 + j * 0.27, tankZ + 0.604),
        point(x - 0.1 + j * 0.09, 0.91 + j * 0.25, tankZ + 0.604), 0.022, VEIN);
      detail(LIQUID, box(x, 0.016, tankZ + 0.65, 1.65, 0.025, 1.15), 'sphere');
    } else {
      detail(LIQUID, box(x, 1.22, tankZ, 1.08, 2.1, 1.08), 'cylinder');
      creature(x, 1.3, tankZ, false);
    }
  });

  const tableX = full ? -9.4 : -3.4, tableZ = full ? -7 : -3.9;
  solid(box(tableX, 0.94, tableZ, 1.2, 0.18, 2.1));
  solid(box(tableX, 0.44, tableZ, 0.65, 0.88, 1.25));
  creature(tableX, 1.31, tableZ, true);
  for (const dz of [-0.36, 0.3]) {
    detail(VEIN, box(tableX, 1.61, tableZ + dz, 1.08, 0.055, 0.12));
    for (const dx of [-0.51, 0.51]) detail(VEIN, box(tableX + dx, 1.32, tableZ + dz, 0.055, 0.58, 0.12));
  }
  bar(point(tableX, 5.8, tableZ), point(tableX, 3.4, tableZ), 0.09);
  detail(STEEL, box(tableX, 3.32, tableZ, 1.05, 0.16, 0.7));
  detail('lamp', box(tableX, 3.22, tableZ, 0.9, 0.055, 0.55));
  lamps.push(point(tableX, 3, tableZ));
  rooms.push(point(full ? -6 : 0, 0, full ? -6.5 : -4.3));

  if (full) {
    rooms.push(point(7, 0, -6.5), point(0, 0, -13));
    // The near cross-aisle and central 2.4 m spine stay open for every shell entrance.
    solid(box(8, 0.6, -8.7, 8.6, 1.2, 0.2), 'concrete');
    solid(box(8, 1.8, -8.7, 8.6, 1.2, 0.08), 'glass');
    solid(box(3.7, 1.2, -8.7, 0.12, 2.4, 0.22));
    solid(box(12.3, 1.2, -8.7, 0.12, 2.4, 0.22));
    solid(box(8, 2.43, -8.7, 8.7, 0.06, 0.22));
    for (const x of [5.5, 9.5]) {
      solid(box(x, 0.525, -4.2, 2.7, 1.05, 0.75));
      for (const dx of [-0.9, 0, 0.9]) {
        solid(box(x + dx, 1.25, -4.2, 0.84, 0.45, 0.3));
        detail('window', box(x + dx, 1.25, -4.358, 0.68, 0.32, 0.018));
        detail('lamp', box(x + dx, 1.52, -4.2, 0.12, 0.06, 0.14));
        for (let j = 0; j < 4; j++) detail(VEIN, box(x + dx - 0.24 + j * 0.14, 1.065, -4.48, 0.08, 0.025, 0.12));
      }
    }
    detail('lamp', box(8, 4.8, -6, 1.2, 0.06, 0.45));
    lamps.push(point(8, 4.6, -6));
    for (const x of [-5, 5]) {
      reactorCores.push(point(x, 2.8, -13));
      // Overlapping box columns make a faceted vessel, with identical drawn and solid bounds.
      for (let side = 0; side < 4; side++) {
        const b = box(x, 2.5, -13, 2.12, 5, 2.12);
        b.rotation.setFromAxisAngle(point(0, 1, 0), side * Math.PI / 4);
        solid(b);
        const core = box(x, 2.8, -13, 2.16, 0.48, 2.16);
        core.rotation.copy(b.rotation);
        detail('warning', core);
      }
      for (const y of [0.2, 4.8]) detail('roof', box(x, y, -13, 3.1, 0.4, 3.1), 'cylinder');
      detail('hazard', box(x, 0.025, -13, 4, 0.025, 4), 'ring');
      const wallX = x < 0 ? -12.55 : 12.55;
      solid(boxAlong(point(x, 4.3, -13), point(wallX, 4.3, -13), 0.22, 0.22));
      solid(boxAlong(point(wallX, 1, -13), point(wallX, 4.3, -13), 0.22, 0.22));
      for (let j = 0; j < 5; j++) detail('hazard', box(x + (wallX - x) * j / 5, 4.3, -13, 0.06, 0.27, 0.27));
      lamps.push(point(x, 2.8, -13));
    }
    solid(box(0, 1.4, -16.9, 23.2, 0.2, 1.2), 'grating');
    for (const z of [-16.26, -17.54]) rail(point(-10.3, 1.925, z), point(11.6, 1.925, z));
    rail(point(11.64, 1.925, -17.5), point(11.64, 1.925, -16.3));
    const start = point(-11, 0.18, -12.9), end = point(-11, 1.5, -16.4);
    const ramp = boxAlong(start, end, 0.16, 1.2);
    ramp.center.addScaledVector(point(0, 1, 0).applyQuaternion(ramp.rotation), -0.08);
    solid(ramp, 'grating');
    for (let i = 1; i < 10; i++) {
      const p = start.clone().lerp(end, i / 10);
      detail('hazard', box(p.x, p.y + 0.008, p.z, 1.18, 0.015, 0.055));
    }
    for (const x of [-11.64, -10.36]) rail(point(x, 0.425, -12.9), point(x, 1.925, -16.4));
  }
  const pickupSites = full ? [point(-6, 0, -7), point(8, 0, -6.5), point(0, 0, -13)] : [point(0, 0, -4)];
  return { kind, parts, details, lamps, rooms, reactorCores, pickupSites, crackedTank };
}

function materials(): Map<PieceMaterial, THREE.MeshStandardMaterial> {
  const make = (name: string, color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ name: `lab-${name}`, color, roughness: 0.65, ...extra });
  return new Map<PieceMaterial, THREE.MeshStandardMaterial>([
    [STEEL, make('steel', 0x2b3038, { roughness: 0.55, metalness: 0.6 })],
    ['concrete', make('partition', 0x6a7068)],
    ['roof', make('rust', 0x71452e, { metalness: 0.4 })],
    ['grating', make('catwalk', 0x444d50, { metalness: 0.65 })],
    ['hazard', make('hazard', 0xc5a349)],
    [SKIN, make('skin', 0xc4c5a9, { roughness: 0.4 })],
    [VEIN, make('veins', 0x25322e)],
    [EYE, make('eyes', 0xcbd785, { emissive: 0xd7ff87, emissiveIntensity: 4, toneMapped: false })],
    ['glass', make('glass', 0xa6caba, { transparent: true, opacity: 0.16, roughness: 0.12, depthWrite: false })],
    [LIQUID, make('liquid', 0x4a9c56, { emissive: 0x347744, emissiveIntensity: 0.45, transparent: true, opacity: 0.22, depthWrite: false })],
    ['window', make('screens', 0x173836, { emissive: ACCENT_CYAN, emissiveIntensity: 2, toneMapped: false })],
    ['lamp', make('surgical-lamp', 0xffedc6, { emissive: 0xffedc6, emissiveIntensity: 4, toneMapped: false })],
    ['warning', make('reactor-core', 0x65c7a7, { emissive: 0x65ffc5, emissiveIntensity: 3, toneMapped: false })],
    [BULB, make('caged-bulb', 0xffbe68, { emissive: 0xffbe68, emissiveIntensity: 2, toneMapped: false })],
  ]);
}

/** One collector for both the lab and old room, at most fourteen material batches in total. */
export function createLabInteriorVisual(placements: readonly PlacedLabInterior[]): {
  group: THREE.Group; update: (seconds: number) => void; dispose: () => void;
} {
  const pieces = new PieceCollector(), palette = materials();
  const motion = new Map<PieceMaterial, number[]>();
  const add = (material: PieceMaterial, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, bob = 0, phase = 0) => {
    const values = motion.get(material) ?? [];
    const count = geometry.index?.count ?? geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++) values.push(bob, phase);
    motion.set(material, values);
    // A reflected north-facing room needs its winding reversed as well as its positions.
    if (matrix.determinant() < 0) {
      const indexed = geometry.index;
      if (indexed) for (let i = 0; i < indexed.count; i += 3) {
        const a = indexed.getX(i); indexed.setX(i, indexed.getX(i + 2)); indexed.setX(i + 2, a);
      }
    }
    pieces.add(material, geometry, matrix);
  };
  for (const { design, matrix } of placements) {
    for (const part of design.parts) {
      const h = part.box.halfExtents;
      add(part.material, new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2), matrix.clone().multiply(boxMatrix(part.box)));
    }
    for (const d of design.details) {
      let geometry: THREE.BufferGeometry;
      if (d.shape === 'sphere') geometry = new THREE.SphereGeometry(0.5, 10, 7);
      else if (d.shape === 'cylinder') geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
      else if (d.shape === 'ring') {
        geometry = new THREE.RingGeometry(0.43, 0.5, 32);
        geometry.rotateX(-Math.PI / 2);
      } else geometry = new THREE.BoxGeometry(1, 1, 1);
      const local = new THREE.Matrix4().compose(d.box.center, d.box.rotation, d.box.halfExtents.clone().multiplyScalar(2));
      add(d.material, geometry, matrix.clone().multiply(local), d.bob, d.phase);
    }
  }
  const group = pieces.build();
  group.name = 'lab-interior';
  const time = { value: 0 };
  const update = (seconds: number) => {
    time.value = seconds;
    palette.get('warning')!.emissiveIntensity = 2.8 + Math.sin(seconds * 0.7) * 0.55;
    palette.get(BULB)!.emissiveIntensity = 1.4 + Math.max(0, Math.sin(seconds * 19) * Math.sin(seconds * 7.3)) * 1.8;
  };
  let lastFrame = -1;
  const beforeRender: THREE.Mesh['onBeforeRender'] = renderer => {
    if (lastFrame === renderer.info.render.frame) return;
    lastFrame = renderer.info.render.frame;
    update(performance.now() / 1000);
  };
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    const key = mesh.name.slice('structure-'.length) as PieceMaterial;
    const material = palette.get(key)!;
    mesh.material = material;
    mesh.name = material.name;
    mesh.geometry.setAttribute('labMotion', new THREE.Float32BufferAttribute(motion.get(key)!, 2));
    mesh.geometry.computeBoundingBox();
    mesh.geometry.boundingBox!.expandByScalar(0.1);
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.boundingSphere!.radius += 0.1;
    // Floating specimens use the same time uniform across skin, veins and eyes.
    material.onBeforeCompile = shader => {
      shader.uniforms.labTime = time;
      shader.vertexShader = 'attribute vec2 labMotion; uniform float labTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.y += labMotion.x * sin(labTime * 0.8 + labMotion.y);');
    };
    material.customProgramCacheKey = () => 'lab-interior-bob-v1';
    mesh.castShadow = !material.transparent && key !== SKIN && key !== VEIN && key !== EYE;
    mesh.onBeforeRender = beforeRender;
    if (material.transparent) mesh.renderOrder = key === 'glass' ? 2 : 1;
  }
  return { group, update, dispose: () => {
    for (const child of group.children) (child as THREE.Mesh).geometry.dispose();
    for (const material of palette.values()) material.dispose();
  } };
}
