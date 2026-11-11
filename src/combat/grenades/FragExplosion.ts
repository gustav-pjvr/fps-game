import * as THREE from 'three';
import type { Vec3 } from './grenadeFlight.ts';
import type { GrenadeSurface } from './GrenadeSystem.ts';

/** Particle pools, shared by every frag at once: a burst past these reuses the oldest particles, so
 * four or five frags together cost the same as the caps. */
export const FRAG_MAX_PUFFS = 168;
export const FRAG_MAX_SPARKS = 160;
export const FRAG_MAX_DEBRIS = 96;
export const FRAG_MAX_SCORCHES = 8;
/** Per frag: 42 puffs in all (the core, the fireball, the smoke column, the dirt fountain and the
 * dust ring), so four frags at once fit the pool. */
const FIRE_PUFFS = 6;
const SMOKE_PUFFS = 10;
const DIRT_PUFFS = 9;
const DUST_PUFFS = 16;
const SPARKS = 38;
const DEBRIS = 22;

const GRAVITY = 9.8;
/** The white-orange flash at the core: under a tenth of a second, and wider than the fireball. */
const CORE_SECONDS = 0.09;
const CORE_SIZE = [1.8, 5] as const;
const CORE_COLOR = new THREE.Color(7.5, 5.2, 2.8);
/** The fireball: a frag is high explosive, not fuel, so it is hot for a moment only and then it is
 * smoke. */
const FIRE_HOT_SECONDS = 0.2;
const FIRE_HOT = new THREE.Color(2.4, 0.85, 0.19);
const FIRE_EMBER = new THREE.Color(0.95, 0.27, 0.05);
const SMOKE = new THREE.Color(0.075, 0.07, 0.065);
/** The column thins to this paler grey as it spreads. */
const SMOKE_THIN = new THREE.Color(0.2, 0.195, 0.19);
const SMOKE_RISE = 1.4;
const DUST = new THREE.Color(0.155, 0.13, 0.098);
/** The dirt thrown up out of the ground: darker and browner than the dust that hangs after it. */
const DIRT = new THREE.Color(0.085, 0.066, 0.046);
/** The dirt fountain falls back at this rate (m/s2): heavier than smoke, lighter than a stone. */
const DIRT_FALL = 13;
/** Dust puffs ride this share of their size above the surface, so the ground does not cut them. */
const DUST_LIFT = 0.28;
/** Spark colour above 1 so it blooms, as the Facility's lamp sparks (lampBreakEffect.ts). */
const SPARK = new THREE.Color(5, 2.6, 0.9);
/** The scorch: this wide, fully dark for SCORCH_SECONDS less the fade, then fading. */
const SCORCH_SIZE = 3.8;
const SCORCH_SECONDS = 25;
const SCORCH_FADE_SECONDS = 6;
/** Off the surface, so the scorch never fights the floor for depth. */
const SCORCH_LIFT = 0.05;
/** And drawn this much nearer the eye than it is (metres along the view ray, which does not move
 * it on screen), so rendered ground a little above the collider does not hide it. */
const SCORCH_DEPTH_PULL = 0.3;

const NOISE_GLSL = /* glsl */ `
  float fragHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fragNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(fragHash(i), fragHash(i + vec2(1.0, 0.0)), u.x), mix(fragHash(i + vec2(0.0, 1.0)), fragHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

const puffVertex = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec4 aColor;
  attribute vec4 aParams;
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec2 vMix;
  varying float vBottom;
  #include <fog_pars_vertex>
  void main() {
    float size = aParams.x;
    float angle = aParams.z * 6.2831853;
    vUv = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * position.xy;
    vColor = aColor;
    vMix = aParams.yz;
    // 1 at the bottom edge of a puff that fades out low (aParams.w), 0 elsewhere.
    vBottom = aParams.w * clamp(-position.y, 0.0, 1.0);
    vec4 mvPosition = viewMatrix * vec4(aCenter, 1.0);
    mvPosition.xy += position.xy * size * 0.5;
    // Drawn a little toward the eye, so a big puff near the ground is not cut by it.
    float eye = length(mvPosition.xyz);
    mvPosition.xyz *= max(eye - size * 0.5, min(eye, 0.3)) / max(eye, 1e-4);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const puffFragment = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec2 vMix;
  varying float vBottom;
  #include <fog_pars_fragment>
  ${NOISE_GLSL}
  void main() {
    float r = length(vUv);
    if (r >= 1.0) discard;
    vec2 seed = vec2(vMix.y * 37.0, vMix.y * 91.0);
    float n = fragNoise(vUv * 2.6 + seed) * 0.62 + fragNoise(vUv * 5.3 - seed) * 0.38;
    float shape = 1.0 - smoothstep(0.2, 1.0, r + (n - 0.5) * 0.6);
    // A ground-hugging puff thins out toward its bottom, so where the ground cuts it there is no edge.
    float alpha = shape * vColor.a * (1.0 - smoothstep(0.2, 0.95, vBottom));
    gl_FragColor = vec4(vColor.rgb * (0.7 + 0.6 * n), 1.0);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Premultiplied: an additive puff (vMix.x = 1) only adds light, a smoke puff covers what is behind.
    gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha * (1.0 - vMix.x));
  }
`;

const scorchVertex = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aNormal;
  attribute vec2 aParams;
  varying vec2 vUv;
  varying vec2 vParams;
  #include <fog_pars_vertex>
  void main() {
    vec3 n = normalize(aNormal);
    vec3 tangent = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 bitangent = cross(n, tangent);
    float angle = aParams.y * 6.2831853;
    vec2 corner = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * position.xy;
    vUv = position.xy;
    vParams = aParams;
    vec3 world = aCenter + (tangent * corner.x + bitangent * corner.y) * ${(SCORCH_SIZE / 2).toFixed(3)};
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    float eye = length(mvPosition.xyz);
    mvPosition.xyz *= max(eye - ${SCORCH_DEPTH_PULL.toFixed(2)}, eye * 0.5) / max(eye, 1e-4);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const scorchFragment = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vParams;
  #include <fog_pars_fragment>
  ${NOISE_GLSL}
  void main() {
    float r = length(vUv);
    if (r >= 1.0) discard;
    vec2 seed = vec2(vParams.y * 53.0, vParams.y * 17.0);
    float n = fragNoise(vUv * 3.0 + seed) * 0.6 + fragNoise(vUv * 7.0 - seed) * 0.4;
    // Soot thrown out in streaks from the middle (noise round the direction, so no seam).
    vec2 around = vUv / max(r, 1e-3);
    float streaks = fragNoise(around * 2.2 + seed) * 0.65 + fragNoise(around * 5.0 - seed) * 0.35;
    streaks *= streaks;
    float reach = 0.42 + 0.6 * streaks;
    float mask = 1.0 - smoothstep(reach * 0.4, reach, r + (n - 0.5) * 0.35);
    float core = 1.0 - smoothstep(0.0, 0.4, r);
    float alpha = clamp(mask * (0.7 + 0.3 * n) + core * 0.25, 0.0, 0.96) * vParams.x;
    vec3 soot = mix(vec3(0.028, 0.022, 0.016), vec3(0.007, 0.006, 0.005), core) * (0.7 + 0.6 * n);
    gl_FragColor = vec4(soot, 1.0);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.a = alpha;
  }
`;

type PuffKind = 'core' | 'fire' | 'smoke' | 'dirt' | 'dust';

interface Puff {
  kind: PuffKind;
  age: number;
  life: number;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  /** Diameter at birth and fully grown (metres). */
  size0: number;
  size1: number;
  drag: number;
  seed: number;
}

interface Bit {
  age: number;
  life: number;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  /** The surface it bounces off (a point and the normal out of it). */
  readonly planePoint: THREE.Vector3;
  readonly planeNormal: THREE.Vector3;
  hasPlane: boolean;
  size: number;
  readonly rotation: THREE.Euler;
  readonly spin: THREE.Vector3;
  resting: boolean;
}

interface Scorch {
  age: number;
  seed: number;
}

function puffPool(count: number): Puff[] {
  return Array.from({ length: count }, () => ({ kind: 'fire' as PuffKind, age: 1, life: 0, position: new THREE.Vector3(),
    velocity: new THREE.Vector3(), size0: 0, size1: 0, drag: 0, seed: 0 }));
}

function bitPool(count: number): Bit[] {
  return Array.from({ length: count }, () => ({ age: 1, life: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    planePoint: new THREE.Vector3(), planeNormal: new THREE.Vector3(0, 1, 0), hasPlane: false, size: 0,
    rotation: new THREE.Euler(), spin: new THREE.Vector3(), resting: false }));
}

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * The frag's explosion (docs/grenades.md), in the order the eye gets it: a white-orange flash wider
 * than the fireball, for under a tenth of a second; a short fireball that is smoke within a fifth
 * of a second; a fountain of dirt thrown up out of the ground and falling back; a ring of dust
 * racing out along the surface to about the blast's lethal radius and hanging there; hot fragments
 * streaking out and clods of earth tumbling down; a column of dark smoke that rises and thins over
 * four or five seconds; and a scorch on the surface that fades after a while. GrenadeSystem lights
 * it with its one blast light.
 *
 * Everything is made up front and kept in the scene from the first frame (empty draws), so a frag
 * never compiles a shader or adds a light mid-match; the pools have fixed caps and reuse their
 * oldest entries. Unlit, so the Facility's light count is untouched. The Goose Launcher keeps
 * ExplosionEffect.
 */
export class FragExplosion {
  private readonly puffs = puffPool(FRAG_MAX_PUFFS);
  private readonly sparks = bitPool(FRAG_MAX_SPARKS);
  private readonly debris = bitPool(FRAG_MAX_DEBRIS);
  private readonly scorches: Scorch[] = Array.from({ length: FRAG_MAX_SCORCHES }, () => ({ age: SCORCH_SECONDS, seed: 0 }));
  private nextPuff = 0;
  private nextSpark = 0;
  private nextDebris = 0;
  private nextScorch = 0;

  private readonly puffMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly puffCenters: THREE.InstancedBufferAttribute;
  private readonly puffColors: THREE.InstancedBufferAttribute;
  private readonly puffParams: THREE.InstancedBufferAttribute;
  private readonly scorchMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly scorchCenters: THREE.InstancedBufferAttribute;
  private readonly scorchNormals: THREE.InstancedBufferAttribute;
  private readonly scorchParams: THREE.InstancedBufferAttribute;
  private readonly sparkMesh: THREE.InstancedMesh;
  private readonly debrisMesh: THREE.InstancedMesh;

  private readonly order: number[] = [];
  private readonly depth = new Float32Array(FRAG_MAX_PUFFS);
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly forward = new THREE.Vector3(0, 0, 1);

  constructor(private readonly scene: THREE.Scene) {
    // A quad from -1 to 1, shared shape for the puffs and the scorches.
    const quad = (): THREE.InstancedBufferGeometry => {
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.instanceCount = 0;
      return geometry;
    };
    const dynamic = (count: number, size: number): THREE.InstancedBufferAttribute =>
      new THREE.InstancedBufferAttribute(new Float32Array(count * size), size).setUsage(THREE.DynamicDrawUsage);

    const puffGeometry = quad();
    this.puffCenters = dynamic(FRAG_MAX_PUFFS, 3);
    this.puffColors = dynamic(FRAG_MAX_PUFFS, 4);
    this.puffParams = dynamic(FRAG_MAX_PUFFS, 4);
    puffGeometry.setAttribute('aCenter', this.puffCenters);
    puffGeometry.setAttribute('aColor', this.puffColors);
    puffGeometry.setAttribute('aParams', this.puffParams);
    this.puffMesh = new THREE.Mesh(puffGeometry, new THREE.ShaderMaterial({
      name: 'frag-puffs',
      vertexShader: puffVertex,
      fragmentShader: puffFragment,
      uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.puffMesh.name = 'frag-puffs';
    this.puffMesh.renderOrder = 2;

    const scorchGeometry = quad();
    this.scorchCenters = dynamic(FRAG_MAX_SCORCHES, 3);
    this.scorchNormals = dynamic(FRAG_MAX_SCORCHES, 3);
    this.scorchParams = dynamic(FRAG_MAX_SCORCHES, 2);
    scorchGeometry.setAttribute('aCenter', this.scorchCenters);
    scorchGeometry.setAttribute('aNormal', this.scorchNormals);
    scorchGeometry.setAttribute('aParams', this.scorchParams);
    this.scorchMesh = new THREE.Mesh(scorchGeometry, new THREE.ShaderMaterial({
      name: 'frag-scorch',
      vertexShader: scorchVertex,
      fragmentShader: scorchFragment,
      uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      fog: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }));
    this.scorchMesh.name = 'frag-scorch';
    this.scorchMesh.renderOrder = 1;

    this.sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ name: 'frag-sparks', toneMapped: false, fog: false }), FRAG_MAX_SPARKS);
    this.debrisMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ name: 'frag-debris', color: 0x2e2a25, roughness: 0.95, metalness: 0, flatShading: true }), FRAG_MAX_DEBRIS);
    this.sparkMesh.name = 'frag-sparks';
    this.debrisMesh.name = 'frag-debris';
    for (const mesh of [this.sparkMesh, this.debrisMesh]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
    }
    this.sparkMesh.setColorAt(0, this.color.setRGB(0, 0, 0));

    for (const mesh of [this.puffMesh, this.scorchMesh, this.sparkMesh, this.debrisMesh]) {
      // Empty draws from the first frame: compiled at match start, never culled by a stale bound.
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
  }

  /** A frag went off at `position`, on or against `surface` (null: in the air). */
  spawn(position: Readonly<Vec3>, surface: GrenadeSurface | null): void {
    const normal = surface ? new THREE.Vector3(surface.normal.x, surface.normal.y, surface.normal.z) : new THREE.Vector3(0, 1, 0);
    const ground = surface ? new THREE.Vector3(surface.point.x, surface.point.y, surface.point.z) : null;
    // The fireball's centre sits a little off the surface.
    const center = ground ? ground.clone().addScaledVector(normal, 0.35) : new THREE.Vector3(position.x, position.y, position.z);

    this.addPuff('core', center, this.v.set(0, 0, 0), CORE_SECONDS, CORE_SIZE[0], CORE_SIZE[1], 0);
    for (let i = 0; i < FIRE_PUFFS; i++) {
      // Out over the hemisphere above the surface (the whole sphere in the air), mostly sideways and up.
      const direction = this.hemisphere(normal, surface ? 0.25 : -1);
      const speed = 5 + Math.random() * 4;
      const start = this.w.copy(center).addScaledVector(direction, 0.15 + Math.random() * 0.25);
      this.addPuff('fire', start, direction.multiplyScalar(speed), 1.5 + Math.random() * 0.8, 0.8 + Math.random() * 0.3, 2 + Math.random() * 0.8, 6);
    }
    // The smoke column: thrown out and up, then carried up by its own heat as it spreads.
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const direction = this.hemisphere(normal, surface ? 0.35 : -1);
      const speed = 3 + Math.random() * 4.5;
      const start = this.w.copy(center).addScaledVector(direction, 0.2 + Math.random() * 0.4);
      this.addPuff('smoke', start, direction.multiplyScalar(speed), 3.4 + Math.random() * 1.6, 1 + Math.random() * 0.4, 3 + Math.random() * 1.2, 2.6);
    }
    if (ground) {
      const tangent = new THREE.Vector3().crossVectors(normal, Math.abs(normal.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent);
      // The dirt fountain: jets straight out of the ground in a narrow cone, falling back.
      for (let i = 0; i < DIRT_PUFFS; i++) {
        const angle = Math.random() * Math.PI * 2;
        const lean = Math.random() * 0.45;
        const out = this.v.copy(tangent).multiplyScalar(Math.cos(angle) * lean).addScaledVector(bitangent, Math.sin(angle) * lean).add(normal).normalize();
        const start = this.w.copy(ground).addScaledVector(normal, 0.25);
        this.addPuff('dirt', start, out.multiplyScalar(8 + Math.random() * 7), 0.9 + Math.random() * 0.6, 0.5 + Math.random() * 0.2, 1.4 + Math.random() * 0.7, 1.6);
      }
      // The dust ring: out along the surface fast, slowing to a stop about three metres out, so
      // with its own growth it marks the ground out to the blast's lethal radius.
      for (let i = 0; i < DUST_PUFFS; i++) {
        const angle = (i / DUST_PUFFS + Math.random() * 0.05) * Math.PI * 2;
        const out = this.v.copy(tangent).multiplyScalar(Math.cos(angle)).addScaledVector(bitangent, Math.sin(angle));
        const start = this.w.copy(ground).addScaledVector(normal, 0.2).addScaledVector(out, 0.4);
        const speed = 13 + Math.random() * 5;
        out.multiplyScalar(speed).addScaledVector(normal, 0.6 + Math.random() * 0.8);
        this.addPuff('dust', start, out, 1.9 + Math.random() * 1.1, 0.7 + Math.random() * 0.3, 2.2 + Math.random() * 0.8, 5);
      }
      const scorch = this.nextScorch;
      this.nextScorch = (this.nextScorch + 1) % FRAG_MAX_SCORCHES;
      this.scorches[scorch]!.age = 0;
      this.scorches[scorch]!.seed = Math.random();
      this.scorchCenters.setXYZ(scorch, ground.x + normal.x * SCORCH_LIFT, ground.y + normal.y * SCORCH_LIFT, ground.z + normal.z * SCORCH_LIFT);
      this.scorchNormals.setXYZ(scorch, normal.x, normal.y, normal.z);
      this.scorchCenters.needsUpdate = true;
      this.scorchNormals.needsUpdate = true;
    }
    for (let i = 0; i < SPARKS; i++) {
      const bit = this.sparks[this.nextSpark]!;
      this.nextSpark = (this.nextSpark + 1) % FRAG_MAX_SPARKS;
      this.launch(bit, center, normal, ground, 14 + Math.random() * 16, surface ? 0.08 : -1);
      bit.life = 0.3 + Math.random() * 0.45;
      bit.size = 0.026 + Math.random() * 0.02;
    }
    for (let i = 0; i < DEBRIS; i++) {
      const bit = this.debris[this.nextDebris]!;
      this.nextDebris = (this.nextDebris + 1) % FRAG_MAX_DEBRIS;
      this.launch(bit, center, normal, ground, 5 + Math.random() * 7, surface ? 0.4 : -1);
      bit.life = 2 + Math.random() * 1.4;
      bit.size = 0.03 + Math.random() * 0.055;
      bit.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      bit.spin.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
    }
  }

  /** Per render frame. `camera`: to draw the puffs back to front. */
  update(dt: number, camera: THREE.Object3D): void {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    this.updatePuffs(step, camera);
    this.updateSparks(step);
    this.updateDebris(step);
    this.updateScorches(step);
  }

  /** Live counts, for tests. */
  get activeCounts(): { puffs: number; sparks: number; debris: number; scorches: number } {
    return {
      puffs: this.puffMesh.geometry.instanceCount,
      sparks: this.sparkMesh.count,
      debris: this.debrisMesh.count,
      scorches: this.scorchMesh.geometry.instanceCount,
    };
  }

  /** Ends every burst and scorch at once (a single-player Restart). */
  clear(): void {
    for (const puff of this.puffs) puff.age = puff.life;
    for (const bit of [...this.sparks, ...this.debris]) bit.age = bit.life;
    for (const scorch of this.scorches) scorch.age = SCORCH_SECONDS;
    this.update(0, this.scene);
  }

  dispose(): void {
    for (const mesh of [this.puffMesh, this.scorchMesh, this.sparkMesh, this.debrisMesh]) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.sparkMesh.dispose();
    this.debrisMesh.dispose();
  }

  private addPuff(kind: PuffKind, position: THREE.Vector3, velocity: THREE.Vector3, life: number, size0: number, size1: number, drag: number): void {
    const puff = this.puffs[this.nextPuff]!;
    this.nextPuff = (this.nextPuff + 1) % FRAG_MAX_PUFFS;
    puff.kind = kind;
    puff.age = 0;
    puff.life = life;
    puff.position.copy(position);
    puff.velocity.copy(velocity);
    puff.size0 = size0;
    puff.size1 = size1;
    puff.drag = drag;
    puff.seed = Math.random();
  }

  /** A random unit vector round `normal`, at least `minUp` along it (-1: anywhere). */
  private hemisphere(normal: THREE.Vector3, minUp: number): THREE.Vector3 {
    const out = new THREE.Vector3();
    for (let tries = 0; tries < 8; tries++) {
      out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      const length = out.length();
      if (length < 0.2 || length > 1) continue;
      out.divideScalar(length);
      const up = out.dot(normal);
      if (up < 0 && minUp > -1) out.addScaledVector(normal, -2 * up);
      if (out.dot(normal) >= minUp) return out;
    }
    return out.copy(normal);
  }

  private launch(bit: Bit, center: THREE.Vector3, normal: THREE.Vector3, ground: THREE.Vector3 | null, speed: number, minUp: number): void {
    bit.age = 0;
    bit.resting = false;
    bit.position.copy(center);
    bit.velocity.copy(this.hemisphere(normal, minUp)).multiplyScalar(speed);
    bit.hasPlane = ground !== null;
    if (ground) {
      bit.planePoint.copy(ground);
      bit.planeNormal.copy(normal);
    }
  }

  private updatePuffs(step: number, camera: THREE.Object3D): void {
    const eye = this.v.setFromMatrixPosition(camera.matrixWorld);
    const order = this.order;
    order.length = 0;
    for (let i = 0; i < this.puffs.length; i++) {
      const puff = this.puffs[i]!;
      if (puff.age >= puff.life) continue;
      puff.age += step;
      if (puff.age >= puff.life) continue;
      puff.velocity.multiplyScalar(Math.exp(-puff.drag * step));
      if (puff.kind === 'fire' || puff.kind === 'smoke') puff.velocity.y += SMOKE_RISE * smooth(0.1, 0.6, puff.age) * step;
      else if (puff.kind === 'dirt') puff.velocity.y -= DIRT_FALL * step;
      puff.position.addScaledVector(puff.velocity, step);
      this.depth[i] = puff.position.distanceToSquared(eye);
      order.push(i);
    }
    // Back to front: the smoke covers what is behind it.
    order.sort((a, b) => this.depth[b]! - this.depth[a]!);
    for (let slot = 0; slot < order.length; slot++) {
      const puff = this.puffs[order[slot]!]!;
      const { age, life } = puff;
      const t = age / life;
      let size: number, alpha: number, additive: number, low = 0, lift = 0;
      if (puff.kind === 'core') {
        size = puff.size0 + (puff.size1 - puff.size0) * (1 - (1 - t) * (1 - t));
        this.color.copy(CORE_COLOR).multiplyScalar((1 - t) ** 1.5);
        alpha = 1;
        additive = 1;
      } else if (puff.kind === 'fire') {
        const heat = Math.max(0, 1 - age / FIRE_HOT_SECONDS);
        size = puff.size0 + (puff.size1 - puff.size0) * (1 - Math.exp(-age * 5)) + age * 0.3;
        this.color.copy(FIRE_EMBER).lerp(FIRE_HOT, heat * heat).lerp(SMOKE, smooth(0.12, 0.65, age));
        alpha = Math.min(1, 0.85 + heat) * (1 - smooth(0.45, 1, t));
        additive = 1 - smooth(0.04, 0.28, age);
      } else if (puff.kind === 'smoke') {
        size = puff.size0 + (puff.size1 - puff.size0) * (1 - Math.exp(-age * 2.2)) + age * 0.35;
        // Lit orange from inside while the fireball lasts, then dark, then paler as it thins.
        this.color.copy(SMOKE).lerp(FIRE_EMBER, 0.6 * Math.max(0, 1 - age / FIRE_HOT_SECONDS)).lerp(SMOKE_THIN, smooth(0.25, 1, t));
        alpha = 0.82 * smooth(0, 0.08, age) * (1 - smooth(0.4, 1, t));
        additive = 0;
        low = 0.5;
      } else if (puff.kind === 'dirt') {
        size = puff.size0 + (puff.size1 - puff.size0) * (1 - Math.exp(-age * 5));
        this.color.copy(DIRT);
        alpha = 0.9 * smooth(0, 0.04, age) * (1 - smooth(0.55, 1, t));
        additive = 0;
        low = 0.4;
      } else {
        size = puff.size0 + (puff.size1 - puff.size0) * (1 - Math.exp(-age * 4)) + age * 0.25;
        this.color.copy(DUST);
        alpha = 0.62 * smooth(0, 0.05, age) * (1 - smooth(0.3, 1, t));
        additive = 0;
        low = 1;
        lift = size * DUST_LIFT;
      }
      if (puff.kind === 'fire') low = 0.6;
      this.puffCenters.setXYZ(slot, puff.position.x, puff.position.y + lift, puff.position.z);
      this.puffColors.setXYZW(slot, this.color.r, this.color.g, this.color.b, alpha);
      this.puffParams.setXYZW(slot, size, additive, puff.seed, low);
    }
    this.puffMesh.geometry.instanceCount = order.length;
    if (order.length > 0) {
      this.puffCenters.needsUpdate = true;
      this.puffColors.needsUpdate = true;
      this.puffParams.needsUpdate = true;
    }
  }

  /** Gravity, a little drag, and a bounce off the surface the frag went off on. */
  private moveBit(bit: Bit, step: number, drag: number, bounce: number): void {
    bit.velocity.y -= GRAVITY * step;
    bit.velocity.multiplyScalar(Math.exp(-drag * step));
    bit.position.addScaledVector(bit.velocity, step);
    if (!bit.hasPlane) return;
    const height = this.w.copy(bit.position).sub(bit.planePoint).dot(bit.planeNormal);
    if (height >= 0.005) return;
    bit.position.addScaledVector(bit.planeNormal, 0.005 - height);
    const into = bit.velocity.dot(bit.planeNormal);
    if (into < 0) {
      bit.velocity.addScaledVector(bit.planeNormal, -into * (1 + bounce));
      bit.velocity.multiplyScalar(0.55);
    }
  }

  private updateSparks(step: number): void {
    let count = 0;
    for (const bit of this.sparks) {
      if (bit.age >= bit.life) continue;
      bit.age += step;
      if (bit.age >= bit.life) continue;
      this.moveBit(bit, step, 1.2, 0.3);
      const fade = 1 - bit.age / bit.life;
      const speed = bit.velocity.length();
      // A streak along its flight, longer the faster it goes.
      if (speed > 1e-3) this.quaternion.setFromUnitVectors(this.forward, this.v.copy(bit.velocity).divideScalar(speed));
      const width = bit.size * (0.5 + 0.5 * fade);
      this.matrix.compose(bit.position, this.quaternion, this.scale.set(width, width, width + speed * 0.014));
      this.sparkMesh.setMatrixAt(count, this.matrix);
      this.sparkMesh.setColorAt(count, this.color.copy(SPARK).multiplyScalar(fade));
      count++;
    }
    this.sparkMesh.count = count;
    if (count > 0) {
      this.sparkMesh.instanceMatrix.needsUpdate = true;
      if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
    }
  }

  private updateDebris(step: number): void {
    let count = 0;
    for (const bit of this.debris) {
      if (bit.age >= bit.life) continue;
      bit.age += step;
      if (bit.age >= bit.life) continue;
      if (!bit.resting) {
        this.moveBit(bit, step, 0.4, 0.35);
        bit.rotation.set(bit.rotation.x + bit.spin.x * step, bit.rotation.y + bit.spin.y * step, bit.rotation.z + bit.spin.z * step);
        // Settled on the surface: it stays there until it shrinks away.
        if (bit.hasPlane && bit.velocity.lengthSq() < 0.09 && this.w.copy(bit.position).sub(bit.planePoint).dot(bit.planeNormal) < 0.02) bit.resting = true;
        // Fell past the edge of the surface it bounced on (or there was none): falls on.
      }
      const size = bit.size * Math.min(1, (bit.life - bit.age) / 0.4);
      this.matrix.compose(bit.position, this.quaternion.setFromEuler(bit.rotation), this.scale.set(size, size * 0.7, size));
      this.debrisMesh.setMatrixAt(count, this.matrix);
      count++;
    }
    this.debrisMesh.count = count;
    if (count > 0) this.debrisMesh.instanceMatrix.needsUpdate = true;
  }

  private updateScorches(step: number): void {
    // Fixed slots (a new scorch overwrites the oldest), drawn in slot order; a faded one draws
    // nothing (alpha 0), so the draw always covers every slot that was ever used.
    let used = 0;
    for (let i = 0; i < this.scorches.length; i++) {
      const scorch = this.scorches[i]!;
      if (scorch.age < SCORCH_SECONDS) scorch.age += step;
      const fade = 1 - smooth(SCORCH_SECONDS - SCORCH_FADE_SECONDS, SCORCH_SECONDS, scorch.age);
      // Burnt in over the first moment, under the fireball.
      const burn = smooth(0, 0.12, scorch.age);
      this.scorchParams.setXY(i, fade * burn, scorch.seed);
      if (scorch.age < SCORCH_SECONDS) used = i + 1;
    }
    this.scorchMesh.geometry.instanceCount = used;
    if (used > 0) this.scorchParams.needsUpdate = true;
  }
}
