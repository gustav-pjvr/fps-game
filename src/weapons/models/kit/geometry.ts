import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Gun space, the space every weapon is authored in: x to the shooter's right, y up, f forward
 * along the barrel. Three's own -z is forward, so a gun-space point (x, y, f) is the three point
 * (x, y, -f). Authoring in "forward is positive" keeps the model files free of sign slips. */
export type P3 = readonly [x: number, y: number, f: number];
/** A side-profile point: forward and up, with an optional corner radius. */
export type P2 = readonly [f: number, y: number, radius?: number];

/** Metres of surface one texture tile covers, so every part has the same texel density. */
const TEXEL = 0.3;

export function toThree(p: P3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(p[0], p[1], -p[2]);
}

/** Texture coordinates by projection along the dominant axis of each vertex normal, in metres over
 * TEXEL. Run after a geometry is in gun space, so tiling does not depend on how a part was built. */
function projectUv(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const ax = Math.abs(normal.getX(i)), ay = Math.abs(normal.getY(i)), az = Math.abs(normal.getZ(i));
    let u: number, v: number;
    if (ax >= ay && ax >= az) { u = position.getZ(i); v = position.getY(i); }
    else if (ay >= az) { u = position.getX(i); v = position.getZ(i); }
    else { u = position.getX(i); v = position.getY(i); }
    uv[i * 2] = u / TEXEL;
    uv[i * 2 + 1] = v / TEXEL;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** Every kit geometry leaves as position, normal and uv, non-indexed, so any two can be merged. */
function finish(geometry: THREE.BufferGeometry, project = true): THREE.BufferGeometry {
  const plain = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(plain.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') plain.deleteAttribute(name);
  }
  return project ? projectUv(plain) : plain;
}

function outline(points: readonly P2[], radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [f, y, own] = points[i]!;
    const prev = points[(i + n - 1) % n]!, next = points[(i + 1) % n]!;
    const toPrev = Math.hypot(prev[0] - f, prev[1] - y), toNext = Math.hypot(next[0] - f, next[1] - y);
    const r = Math.min(own ?? radius, toPrev / 2, toNext / 2);
    if (r <= 1e-5) {
      if (i === 0) shape.moveTo(f, y); else shape.lineTo(f, y);
      continue;
    }
    const ax = f + (prev[0] - f) / toPrev * r, ay = y + (prev[1] - y) / toPrev * r;
    const bx = f + (next[0] - f) / toNext * r, by = y + (next[1] - y) / toNext * r;
    if (i === 0) shape.moveTo(ax, ay); else shape.lineTo(ax, ay);
    shape.quadraticCurveTo(f, y, bx, by);
  }
  shape.closePath();
  return shape;
}

export interface PlateOptions {
  /** Edge chamfer in metres (default 0.003), the thing that makes a slab read as machined. */
  bevel?: number;
  /** Corner radius applied to every profile point that does not carry its own. */
  round?: number;
  /** Cut-outs (a trigger guard opening, a skeleton stock), each a closed profile. */
  holes?: readonly (readonly P2[])[];
  /** Sideways offset of the plate's centre plane (default 0, the gun's centre line). */
  x?: number;
}

/** A side profile extruded across the gun: the receiver, a grip, a stock, a magazine. The
 * silhouette is exact (the bevel is cut inward) and `width` is the full thickness. */
export function plate(points: readonly P2[], width: number, options: PlateOptions = {}): THREE.BufferGeometry {
  const bevel = Math.max(0, Math.min(options.bevel ?? 0.003, width / 2 - 1e-4));
  const shape = outline(points, options.round ?? 0);
  for (const hole of options.holes ?? []) shape.holes.push(outline(hole, options.round ?? 0));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    steps: 1,
    curveSegments: 5,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -(width / 2 - bevel));
  // Shape space (forward, up, across) to three space (across, up, -forward): a pure rotation.
  geometry.applyMatrix4(new THREE.Matrix4().set(
    0, 0, 1, options.x ?? 0,
    0, 1, 0, 0,
    -1, 0, 0, 0,
    0, 0, 0, 1,
  ));
  return finish(geometry);
}

export interface RevolveOptions {
  x?: number;
  y?: number;
  segments?: number;
  /** Radius of a bore through the whole length: the part becomes a tube (a scope body, a muzzle
   * device, a suppressor), open at both ends. */
  bore?: number;
}

/** A solid of revolution about an axis parallel to the barrel: barrels, suppressors, scope tubes,
 * a revolver cylinder. `stations` are [forward, radius] pairs with forward not decreasing; two
 * stations at the same forward make a step. Ends are capped (or ringed when `bore` is set). */
export function revolve(stations: readonly (readonly [number, number])[], options: RevolveOptions = {}): THREE.BufferGeometry {
  const segments = options.segments ?? 14;
  const cx = options.x ?? 0, cy = options.y ?? 0, bore = options.bore ?? 0;
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  const cos: number[] = [], sin: number[] = [];
  for (let k = 0; k <= segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    cos.push(Math.cos(a));
    sin.push(Math.sin(a));
  }
  const push = (r: number, k: number, f: number, nx: number, ny: number, nz: number, u: number, v: number): void => {
    positions.push(cx + r * cos[k]!, cy + r * sin[k]!, -f);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
  };
  /** One band between two rings. `flip` turns it inside out (the wall of a bore). */
  const band = (f0: number, r0: number, f1: number, r1: number, flip: boolean): void => {
    const df = f1 - f0, dr = r1 - r0;
    const length = Math.hypot(df, dr);
    if (length < 1e-7) return;
    const sign = flip ? -1 : 1;
    const radial = (df / length) * sign, axial = (dr / length) * sign;
    const circumference = Math.PI * (r0 + r1) / TEXEL;
    for (let k = 0; k < segments; k++) {
      const u0 = (k / segments) * circumference, u1 = ((k + 1) / segments) * circumference;
      const v0 = f0 / TEXEL, v1 = (f0 + length) / TEXEL;
      const corner = (r: number, kk: number, f: number, u: number, v: number): void =>
        push(r, kk, f, cos[kk]! * radial, sin[kk]! * radial, axial, u, v);
      if (flip) {
        corner(r0, k, f0, u0, v0); corner(r0, k + 1, f0, u1, v0); corner(r1, k, f1, u0, v1);
        corner(r0, k + 1, f0, u1, v0); corner(r1, k + 1, f1, u1, v1); corner(r1, k, f1, u0, v1);
      } else {
        corner(r0, k, f0, u0, v0); corner(r1, k, f1, u0, v1); corner(r0, k + 1, f0, u1, v0);
        corner(r0, k + 1, f0, u1, v0); corner(r1, k, f1, u0, v1); corner(r1, k + 1, f1, u1, v1);
      }
    }
  };
  /** An end face: a disc, or a ring from the bore out. `facing` is +1 for the rear end. */
  const cap = (f: number, r: number, facing: 1 | -1): void => {
    if (r <= bore + 1e-7) return;
    for (let k = 0; k < segments; k++) {
      const a = facing === 1 ? k : k + 1, b = facing === 1 ? k + 1 : k;
      const corner = (rr: number, kk: number): void =>
        push(rr, kk, f, 0, 0, facing, (cx + rr * cos[kk]!) / TEXEL, (cy + rr * sin[kk]!) / TEXEL);
      if (bore > 0) {
        corner(bore, a); corner(r, a); corner(r, b);
        corner(bore, a); corner(r, b); corner(bore, b);
      } else {
        corner(0, a); corner(r, a); corner(r, b);
      }
    }
  };
  for (let i = 0; i < stations.length - 1; i++) {
    const [f0, r0] = stations[i]!, [f1, r1] = stations[i + 1]!;
    band(f0, r0, f1, r1, false);
  }
  const first = stations[0]!, last = stations[stations.length - 1]!;
  cap(first[0], first[1], 1);
  cap(last[0], last[1], -1);
  if (bore > 0) band(first[0], bore, last[0], bore, true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

/** A round bar between any two points (a bolt handle, a sling loop leg, a forearm). */
export function tube(a: P3, b: P3, radius: number, endRadius = radius, segments = 10): THREE.BufferGeometry {
  const start = toThree(a), end = toThree(b);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(endRadius, radius, length, segments);
  const uv = geometry.getAttribute('uv');
  const around = Math.PI * (radius + endRadius) / TEXEL;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * length / TEXEL);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  geometry.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
  return finish(geometry, false);
}

export interface BoxOptions {
  /** Rotation in radians about the box centre: pitch (positive tips the front up), yaw (positive
   * swings the front to the right) and roll (positive tips the top to the right). */
  rotate?: readonly [pitch: number, yaw: number, roll: number];
  /** Rounded edge radius. 0 (the default) is a sharp box. */
  bevel?: number;
}

/** A block: `size` is [across, up, along], `center` is a gun-space point. */
export function box(size: P3, center: P3, options: BoxOptions = {}): THREE.BufferGeometry {
  const [w, h, l] = size;
  const bevel = Math.min(options.bevel ?? 0, w / 2, h / 2, l / 2);
  const geometry = bevel > 1e-5 ? new RoundedBoxGeometry(w, h, l, 2, bevel) : new THREE.BoxGeometry(w, h, l);
  if (options.rotate) {
    const [pitch, yaw, roll] = options.rotate;
    // Forward is three's -z: pitch keeps its sign about x, yaw and roll flip theirs about y and z.
    geometry.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, -yaw, -roll, 'YXZ')));
  }
  geometry.translate(center[0], center[1], -center[2]);
  return finish(geometry);
}

/** A ring standing across the line of the barrel (a peep sight, a sling swivel, a lens bezel). */
export function ring(center: P3, radius: number, thickness: number, segments = 18): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(radius, thickness, 6, segments);
  geometry.translate(center[0], center[1], -center[2]);
  return finish(geometry, false);
}

/** A flat disc facing backward or forward (a lens, a bore plug, a medallion face). */
export function disc(center: P3, radius: number, facing: 1 | -1 = 1, segments = 16): THREE.BufferGeometry {
  const geometry = new THREE.CircleGeometry(radius, segments);
  if (facing === -1) geometry.rotateY(Math.PI);
  geometry.translate(center[0], center[1], -center[2]);
  return finish(geometry, false);
}

export function merge(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 1) return geometries[0]!;
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error('Weapon kit: geometries could not be merged');
  return merged;
}

export function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
}
