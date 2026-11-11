import * as THREE from 'three';
import { MAX_HOLES, type HitOutcome, type PaneState, type WorldPane } from './glassPane.ts';

/**
 * How the Valley houses' glass is drawn (docs/glass.md). Two draw calls for every window in the
 * world, however many there are and whatever state they are in:
 *
 * - `panes`: one instanced quad per streamed-in window, one shader. A pane's bullet holes travel as
 *   instance attributes and the shader draws each hole, its crushed rim and the cracks running from
 *   it at exactly that spot, the same from both sides. A broken pane keeps only a jagged rim in the
 *   frame. Nothing is added to the scene and nothing compiles when a shot lands.
 * - `shards`: one instanced triangle, a pool. The first FLYING slots are the pieces of a pane
 *   bursting; the rest lie on the sill and the floor under each broken window.
 *
 * Both meshes are in the scene from the first frame. No lights are added.
 */

/** Streamed-in windows drawn at once. About 60 houses of up to 11 windows. */
const MAX_PANES = 768;
/** Pieces in the air at once: three panes bursting together. */
const FLYING = 72;
/** Pieces thrown by one pane. */
const BURST = 24;
/** Pieces left lying under one broken window. */
const LYING = 6;
/** Broken windows whose lying pieces are drawn at once. */
const MAX_LYING_PANES = 96;
const SHARDS = FLYING + LYING * MAX_LYING_PANES;
/** Seconds a flying piece lives; it shrinks away over the last part. */
const SHARD_LIFE = 1.6;
const SHARD_FADE = 0.35;
const GRAVITY = 20;

const paneVertex = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec4 aAxis;
  attribute vec4 aHoles0;
  attribute vec4 aHoles1;
  attribute vec4 aHoles2;
  attribute vec4 aHoles3;
  attribute vec3 aInfo;
  varying vec2 vP;
  varying vec2 vHalf;
  varying vec4 vHoles0;
  varying vec4 vHoles1;
  varying vec4 vHoles2;
  varying vec4 vHoles3;
  varying vec3 vInfo;
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <fog_pars_vertex>
  void main() {
    vec3 along = vec3(aAxis.x, 0.0, aAxis.y);
    vHalf = aAxis.zw;
    vP = position.xy * 2.0 * vHalf;
    vHoles0 = aHoles0;
    vHoles1 = aHoles1;
    vHoles2 = aHoles2;
    vHoles3 = aHoles3;
    vInfo = aInfo;
    vNormal = cross(along, vec3(0.0, 1.0, 0.0));
    vWorld = aCenter + along * vP.x + vec3(0.0, vP.y, 0.0);
    vec4 mvPosition = viewMatrix * vec4(vWorld, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const paneFragment = /* glsl */ `
  uniform float uReflect;
  uniform vec3 uTint;
  varying vec2 vP;
  varying vec2 vHalf;
  varying vec4 vHoles0;
  varying vec4 vHoles1;
  varying vec4 vHoles2;
  varying vec4 vHoles3;
  varying vec3 vInfo;
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <fog_pars_fragment>

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  // One bullet hole at h (metres from the pane's centre): the hole itself (gone), the crushed white
  // rim and the cracks running out from it (white). grow lengthens the cracks as the pane weakens.
  void hole(vec2 h, float grow, inout float gone, inout float white) {
    vec2 d = vP - h;
    float r = length(d);
    if (r > 0.4 * grow) return;
    // Seeded by where the hole is, not by its place in the list: two players who received the same
    // hits in a different order still see the same cracks.
    float seed = vInfo.z * 31.0 + dot(h, vec2(127.1, 311.7));
    gone = max(gone, 1.0 - smoothstep(0.008, 0.012, r));
    white = max(white, (1.0 - smoothstep(0.014, 0.032, r)) * 0.9);
    float spokes = 7.0 + floor(hash(seed) * 4.0);
    float a = atan(d.y, d.x) / 6.2831853 * spokes + hash(seed + 1.0) + 0.06 * sin(r * 55.0 + seed);
    float cell = mod(floor(a), spokes);
    float arc = abs(fract(a) - 0.5) / spokes * 6.2831853 * r;
    float reach = (0.06 + 0.2 * hash(cell * 3.1 + seed)) * grow;
    float line = (1.0 - smoothstep(0.0009, 0.003, arc)) * (1.0 - smoothstep(reach * 0.75, reach, r));
    float ringAt = 0.04 + 0.035 * hash(seed + 2.0);
    float ring = (1.0 - smoothstep(0.0009, 0.0026, abs(r - ringAt))) * step(0.5, hash(cell * 5.7 + seed + 3.0));
    white = max(white, max(line, ring) * 0.8);
  }

  void main() {
    float count = vInfo.x;
    float gone = 0.0;
    float white = 0.0;
    float grow = 1.0 + 0.16 * count;
    if (count > 0.5) hole(vHoles0.xy, grow, gone, white);
    if (count > 1.5) hole(vHoles0.zw, grow, gone, white);
    if (count > 2.5) hole(vHoles1.xy, grow, gone, white);
    if (count > 3.5) hole(vHoles1.zw, grow, gone, white);
    if (count > 4.5) hole(vHoles2.xy, grow, gone, white);
    if (count > 5.5) hole(vHoles2.zw, grow, gone, white);
    if (count > 6.5) hole(vHoles3.xy, grow, gone, white);
    if (count > 7.5) hole(vHoles3.zw, grow, gone, white);
    if (gone > 0.5) discard;

    vec2 toEdge = vHalf - abs(vP);
    float edge = min(toEdge.x, toEdge.y);
    if (vInfo.y > 0.5) {
      // Broken: only teeth of glass left in the frame, longer in some places than others.
      float run = (toEdge.x < toEdge.y ? vP.y : vP.x) * 17.0 + vInfo.z * 91.0;
      float tooth = abs(fract(run) - 0.5) * 2.0;
      float size = hash(floor(run) + vInfo.z * 13.0);
      if (edge > 0.006 + 0.085 * size * size * (1.0 - tooth)) discard;
      white = max(white, 0.3);
    }

    #ifdef USE_FOG
      vec3 sky = fogColor;
    #else
      vec3 sky = vec3(0.62, 0.72, 0.8);
    #endif
    float light = dot(sky, vec3(0.3, 0.6, 0.1));
    vec3 view = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normalize(vNormal), view));
    float fresnel = pow(1.0 - facing, 3.0);
    // A faint slanting sheen, so the pane reads as a surface even seen square on.
    float sheen = pow(0.5 + 0.5 * sin((vP.x * 0.9 + vP.y * 1.3) * 3.1 + vInfo.z * 6.0), 10.0);
    vec3 color = mix(uTint * (0.18 + 0.82 * light), sky * 1.12, uReflect * (0.22 + 0.78 * fresnel));
    // Without the reflection (Low) the tint alone must show there is a pane: a little more of it.
    float alpha = mix(0.26 - 0.09 * uReflect, 0.52, fresnel * uReflect) + sheen * 0.07 * uReflect;
    // A dark line where the pane meets the frame seats it in the wall.
    alpha = max(alpha, (1.0 - smoothstep(0.0, 0.012, edge)) * 0.45);
    color = mix(color, vec3(0.9, 0.95, 0.96) * (0.3 + 0.7 * light), white);
    alpha = max(alpha, white * 0.86);

    gl_FragColor = vec4(color, 1.0);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.a = alpha;
  }
`;

interface FlyingShard {
  life: number;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly axis: THREE.Vector3;
  angle: number;
  spin: number;
  size: number;
  floor: number;
  resting: boolean;
}

/** A small deterministic generator: a window's lying pieces are the same on every client and every
 * time its house streams back in. */
function seeded(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export class GlassView {
  private readonly panes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly shards: THREE.InstancedMesh;
  private readonly centers = new Float32Array(MAX_PANES * 3);
  private readonly axes = new Float32Array(MAX_PANES * 4);
  private readonly holes: Float32Array[] = [0, 1, 2, 3].map(() => new Float32Array(MAX_PANES * 4));
  private readonly info = new Float32Array(MAX_PANES * 3);
  private readonly attributes: THREE.InstancedBufferAttribute[] = [];
  private readonly slotOf = new Map<number, number>();
  private readonly freeSlots: number[] = [];
  private used = 0;
  private warnedFull = false;
  private readonly flying: FlyingShard[] = [];
  private nextFlying = 0;
  private airborne = 0;
  /** Which block of lying slots each broken window holds. */
  private readonly lyingOf = new Map<number, number>();
  private readonly freeLying: number[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private readonly scene: THREE.Scene, reflections: boolean) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    const attribute = (name: string, array: Float32Array, size: number): void => {
      const instanced = new THREE.InstancedBufferAttribute(array, size);
      instanced.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, instanced);
      this.attributes.push(instanced);
    };
    attribute('aCenter', this.centers, 3);
    attribute('aAxis', this.axes, 4);
    this.holes.forEach((array, index) => attribute(`aHoles${index}`, array, 4));
    attribute('aInfo', this.info, 3);
    geometry.instanceCount = 0;
    this.panes = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      name: 'window-glass',
      vertexShader: paneVertex,
      fragmentShader: paneFragment,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uReflect: { value: reflections ? 1 : 0 },
        uTint: { value: new THREE.Color(0x9fc4c9) },
      },
      fog: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // One draw, not three's default two (back faces, then front) for a see-through double-sided
      // material: a flat pane has nothing behind itself to sort.
      forceSinglePass: true,
    }));
    this.panes.name = 'window-glass';
    this.panes.frustumCulled = false;
    this.panes.renderOrder = 2;

    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.35, 0.55, 0, -0.2, -0.1, 0, 0.6], 3));
    triangle.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    this.shards = new THREE.InstancedMesh(triangle,
      new THREE.MeshLambertMaterial({ name: 'window-shards', color: 0xc4e2e6, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true }), SHARDS);
    this.shards.name = 'window-shards';
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shards.frustumCulled = false;
    this.shards.renderOrder = 2;
    for (let i = 0; i < SHARDS; i++) this.shards.setMatrixAt(i, this.zero);
    for (let i = 0; i < FLYING; i++) {
      this.flying.push({ life: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), angle: 0, spin: 0, size: 0, floor: 0, resting: false });
    }
    for (let i = MAX_LYING_PANES - 1; i >= 0; i--) this.freeLying.push(i);
    scene.add(this.panes, this.shards);
  }

  /** Low draws flat tinted glass; Medium and High add the sky's reflection at grazing angles. */
  setReflections(on: boolean): void {
    this.panes.material.uniforms.uReflect!.value = on ? 1 : 0;
  }

  /** GlassStore's listener: a pane appeared, changed or left. */
  readonly onPane = (id: number, pane: WorldPane | null, state: PaneState, outcome: HitOutcome, side: 1 | -1 | 0): void => {
    if (!pane) {
      this.release(id);
      return;
    }
    this.write(id, pane, state);
    if (state.broken) this.layDown(pane);
    if (outcome === 'broke' && side !== 0) this.burst(pane, side);
  };

  private write(id: number, pane: WorldPane, state: PaneState): void {
    let slot = this.slotOf.get(id);
    if (slot === undefined) {
      slot = this.freeSlots.pop() ?? (this.used < MAX_PANES ? this.used++ : -1);
      if (slot < 0) {
        // The Valley has about 110 windows; a world that outgrows the pool must say so, because an
        // undrawn pane would still stop grenades and muffle sound.
        if (!this.warnedFull) console.warn(`More than ${MAX_PANES} windows are streamed in: some glass is not drawn (GlassView.MAX_PANES)`);
        this.warnedFull = true;
        return;
      }
      this.slotOf.set(id, slot);
      this.panes.geometry.instanceCount = this.used;
    }
    this.centers.set([pane.x, pane.y, pane.z], slot * 3);
    this.axes.set([pane.ux, pane.uz, pane.halfWidth, pane.halfHeight], slot * 4);
    const count = Math.min(MAX_HOLES, Math.floor(state.holes.length / 2));
    for (let hole = 0; hole < MAX_HOLES; hole++) {
      const array = this.holes[hole >> 1]!, at = slot * 4 + (hole & 1) * 2;
      array[at] = hole < count ? state.holes[hole * 2]! : 0;
      array[at + 1] = hole < count ? state.holes[hole * 2 + 1]! : 0;
    }
    this.info.set([count, state.broken ? 1 : 0, (id % 9973) / 9973], slot * 3);
    for (const attribute of this.attributes) attribute.needsUpdate = true;
  }

  private release(id: number): void {
    const slot = this.slotOf.get(id);
    if (slot !== undefined) {
      this.slotOf.delete(id);
      this.freeSlots.push(slot);
      // A zero-sized quad draws nothing until the slot is taken again.
      this.axes.set([1, 0, 0, 0], slot * 4);
      for (const attribute of this.attributes) attribute.needsUpdate = true;
    }
    const block = this.lyingOf.get(id);
    if (block !== undefined) {
      this.lyingOf.delete(id);
      this.freeLying.push(block);
      for (let i = 0; i < LYING; i++) this.shards.setMatrixAt(FLYING + block * LYING + i, this.zero);
      this.shards.instanceMatrix.needsUpdate = true;
    }
  }

  /** The pieces that stay under a broken window: two on the sill, two on the floor inside, two on
   * the ground outside. The same pieces for the same window, always. */
  private layDown(pane: WorldPane): void {
    if (this.lyingOf.has(pane.id)) return;
    const block = this.freeLying.pop();
    if (block === undefined) return;
    this.lyingOf.set(pane.id, block);
    const random = seeded(pane.id + 17);
    for (let i = 0; i < LYING; i++) {
      const along = (random() * 2 - 1) * pane.halfWidth * 0.85;
      // 0 and 1 on the sill, 2 and 3 inside, 4 and 5 outside.
      const across = i < 2 ? (random() - 0.5) * 0.12 : (i < 4 ? -1 : 1) * (0.22 + random() * 0.5);
      const y = i < 2 ? pane.y - pane.halfHeight + 0.006 : (i < 4 ? pane.floorInside : pane.floorOutside) + 0.012;
      this.position.set(pane.x + pane.ux * along + pane.nx * across, y, pane.z + pane.uz * along + pane.nz * across);
      this.quaternion.setFromAxisAngle(this.up, random() * Math.PI * 2);
      const size = 0.05 + random() * 0.07;
      this.scale.set(size, size, size * (0.6 + random() * 0.8));
      this.shards.setMatrixAt(FLYING + block * LYING + i, this.matrix.compose(this.position, this.quaternion, this.scale));
    }
    this.shards.instanceMatrix.needsUpdate = true;
  }

  /** A pane gives way: its pieces fly the way the force travelled and fall. */
  private burst(pane: WorldPane, side: 1 | -1): void {
    for (let i = 0; i < BURST; i++) {
      const shard = this.flying[this.nextFlying]!;
      this.nextFlying = (this.nextFlying + 1) % FLYING;
      if (shard.life <= 0) this.airborne++;
      const u = (Math.random() * 2 - 1) * pane.halfWidth, v = (Math.random() * 2 - 1) * pane.halfHeight;
      // Most of the sheet goes with the force; a few pieces drop back on the near side.
      const out = (i % 5 === 0 ? -0.4 : 1) * side * (0.5 + Math.random() * 2.6);
      const sideways = (Math.random() - 0.5) * 1.6;
      shard.position.set(pane.x + pane.ux * u, pane.y + v, pane.z + pane.uz * u);
      shard.velocity.set(pane.nx * out + pane.ux * sideways, -0.2 + Math.random() * 1.6, pane.nz * out + pane.uz * sideways);
      shard.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      shard.angle = Math.random() * Math.PI * 2;
      shard.spin = (Math.random() - 0.5) * 22;
      shard.size = 0.05 + Math.random() * 0.11;
      shard.floor = (out > 0 ? pane.floorOutside : pane.floorInside) + 0.012;
      shard.resting = false;
      shard.life = SHARD_LIFE * (0.75 + Math.random() * 0.25);
    }
  }

  /** Per frame. Costs nothing unless pieces are in the air. */
  update(dt: number): void {
    if (this.airborne === 0 || dt <= 0) return;
    for (let i = 0; i < FLYING; i++) {
      const shard = this.flying[i]!;
      if (shard.life <= 0) continue;
      shard.life -= dt;
      if (shard.life <= 0) {
        this.airborne--;
        this.shards.setMatrixAt(i, this.zero);
        continue;
      }
      if (!shard.resting) {
        shard.velocity.y -= GRAVITY * dt;
        shard.position.addScaledVector(shard.velocity, dt);
        shard.angle += shard.spin * dt;
        if (shard.position.y <= shard.floor) {
          // Landed: it lies flat where it fell until it fades.
          shard.position.y = shard.floor;
          shard.resting = true;
          shard.axis.set(0, 1, 0);
        }
      }
      const size = shard.size * Math.min(1, shard.life / SHARD_FADE);
      this.quaternion.setFromAxisAngle(shard.axis, shard.angle);
      this.scale.set(size, size, size);
      this.shards.setMatrixAt(i, this.matrix.compose(shard.position, this.quaternion, this.scale));
    }
    this.shards.instanceMatrix.needsUpdate = true;
  }

  /** For tests and the performance report: panes drawn, pieces in the air, windows with lying pieces. */
  counts(): { panes: number; airborne: number; lying: number } {
    return { panes: this.slotOf.size, airborne: this.airborne, lying: this.lyingOf.size };
  }

  dispose(): void {
    this.scene.remove(this.panes, this.shards);
    this.panes.geometry.dispose();
    this.panes.material.dispose();
    this.shards.geometry.dispose();
    (this.shards.material as THREE.Material).dispose();
  }
}
