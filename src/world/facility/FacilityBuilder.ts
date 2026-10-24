import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import type { ObstacleRegistry } from '../../entities/enemies/tactics/obstacleRegistry.ts';
import { mulberry32 } from '../../utils/rng.ts';
import { getStructureMaterials } from '../structureMaterials.ts';
import { box, createBoxCollider } from '../structureKit.ts';
import type { FacilityLayout } from './facilityLayout.ts';
import { buildFacilityGeometry, type FacilityGeometry } from './facilityGeometry.ts';
import { bakeFacility, rebakeFacilityAround, sampleProbe, type FacilityBakeState } from './facilityBake.ts';
import { withBakedLight } from './bakedLightMaterial.ts';

/** Ray hit boxes for lamps, a little larger than the visible lamp so they are fair to hit. */
const LAMP_HIT_HALF = { panel: [0.5, 0.1, 0.2], emergency: [0.175, 0.125, 0.2] } as const;

/** One material's slice of the shared light array, in vertices. */
interface LightRange { attribute: THREE.BufferAttribute; first: number; count: number }

interface FacilityOptions {
  scene: THREE.Scene;
  physics: PhysicsWorld;
  obstacles: ObstacleRegistry;
  lightShafts: boolean;
  dust: boolean;
}

export class FacilityWorld {
  private readonly group = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly cameraPosition = new THREE.Vector3();
  private body: RAPIER.RigidBody | null = null;
  private dustPoints: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private dustStarted = false;
  private registered = false;
  private disposed = false;
  private readonly probes: Float32Array;
  private readonly lightRanges: LightRange[] = [];
  /** The light, probes, direct and fill of the full bake, so relightAll restores them exactly. */
  private readonly original: { light: Float32Array; probes: Float32Array; direct: Float32Array; fill: Float32Array };
  private readonly dead = new Set<number>();
  /** Dead lamps whose light is still in the bake: update rebakes one per frame, oldest first. */
  private readonly rebakeQueue: number[] = [];
  private lampMesh: THREE.InstancedMesh | null = null;
  private shaftMesh: THREE.InstancedMesh | null = null;
  private shafts: FacilityGeometry['shafts'] = [];
  /** Milliseconds the last lamp rebake took, attribute updates included. */
  lastKillMs = 0;

  private constructor(
    private readonly layout: FacilityLayout,
    private readonly options: FacilityOptions,
    private readonly bake: FacilityBakeState,
    readonly bakeMs: number,
    readonly vertexCount: number,
  ) {
    this.group.name = 'facility';
    this.probes = bake.probes;
    this.original = { light: bake.light.slice(), probes: bake.probes.slice(), direct: bake.direct.slice(), fill: bake.fill.slice() };
  }

  static build(layout: FacilityLayout, options: FacilityOptions): FacilityWorld {
    const geometry = buildFacilityGeometry(layout);
    const vertexCount = [...geometry.byMaterial.values()].reduce((sum, g) => sum + g.getAttribute('position').count, 0);
    const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3);
    let offset = 0;
    for (const g of geometry.byMaterial.values()) {
      positions.set(g.getAttribute('position').array, offset);
      normals.set(g.getAttribute('normal').array, offset);
      offset += g.getAttribute('position').array.length;
    }
    const baked = bakeFacility(layout, positions, normals);
    const facility = new FacilityWorld(layout, options, baked.state, baked.ms, vertexCount);
    for (const g of geometry.byMaterial.values()) facility.geometries.add(g);
    try {
      const shared = getStructureMaterials();
      offset = 0;
      for (const [key, g] of geometry.byMaterial) {
        const count = g.getAttribute('position').array.length;
        const attribute = new THREE.BufferAttribute(baked.light.subarray(offset, offset + count), 3);
        g.setAttribute('bakedLight', attribute);
        facility.lightRanges.push({ attribute, first: offset / 3, count: count / 3 });
        offset += count;
        const material = withBakedLight(shared[key]);
        facility.materials.add(material);
        const mesh = new THREE.Mesh(g, material);
        mesh.name = `facility-${key}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        facility.group.add(mesh);
      }
      facility.addLamps(geometry.lampPanels);
      if (options.lightShafts) facility.addShafts(geometry.shafts);
      if (options.dust) facility.addDust();
      facility.body = options.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      for (const b of geometry.colliderBoxes) createBoxCollider(options.physics.world, facility.body,
        box(b.cx, b.cy, b.cz, b.hx * 2, b.hy * 2, b.hz * 2));
      facility.registered = true;
      for (const footprint of geometry.coverFootprints) options.obstacles.add('facility', { kind: 'house', footprint });
      options.scene.add(facility.group);
      return facility;
    } catch (error) {
      facility.dispose();
      throw error;
    }
  }

  private addLamps(panels: FacilityGeometry['lampPanels']): void {
    if (!panels.length) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ name: 'facility-lamps', color: 0xffffff,
      emissive: 0xffffff, emissiveIntensity: 6, roughness: 0.6, toneMapped: false });
    // Three's instance colour normally affects diffuse only. Tint the emitted light as well, so a
    // dead lamp's black instance colour turns its glow off. The fragment shader only gets USE_COLOR
    // for instance colours (USE_INSTANCING_COLOR is a vertex-shader define), and this material has
    // no vertex colours, so USE_COLOR here means the instance colour.
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif');
    };
    material.customProgramCacheKey = () => 'facility-lamp-instance-emissive-v2';
    this.geometries.add(geometry); this.materials.add(material);
    const mesh = new THREE.InstancedMesh(geometry, material, panels.length);
    mesh.name = 'facility-lamps';
    const matrix = new THREE.Matrix4(), color = new THREE.Color();
    panels.forEach((lamp, i) => {
      matrix.makeScale(lamp.kind === 'panel' ? 0.9 : 0.24, lamp.kind === 'panel' ? 0.08 : 0.16, 0.3);
      matrix.setPosition(lamp.x, lamp.y, lamp.z);
      mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, color.setHex(lamp.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    this.lampMesh = mesh;
  }

  private addShafts(shafts: FacilityGeometry['shafts']): void {
    if (!shafts.length) return;
    const geometry = new THREE.CylinderGeometry(0.3, 1.6, 1, 24, 8, true);
    const position = geometry.getAttribute('position'), colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const fade = Math.max(0, position.getY(i) + 0.5);
      colors.set([fade, fade, fade], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshBasicMaterial({ name: 'facility-shafts', vertexColors: true,
      transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      depthWrite: false, fog: false, toneMapped: false });
    this.geometries.add(geometry); this.materials.add(material);
    const mesh = new THREE.InstancedMesh(geometry, material, shafts.length);
    mesh.name = 'facility-shafts';
    const color = new THREE.Color();
    this.shafts = shafts;
    this.shaftMesh = mesh;
    shafts.forEach((shaft, i) => { this.setShaft(i, true); mesh.setColorAt(i, color.setHex(shaft.color)); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  /** A shaft under a dead lamp is scaled to nothing. */
  private setShaft(i: number, visible: boolean): void {
    const shaft = this.shafts[i]!, matrix = new THREE.Matrix4();
    if (visible) matrix.makeScale(1, shaft.yTop, 1).setPosition(shaft.x, shaft.yTop / 2, shaft.z);
    else matrix.makeScale(0, 0, 0).setPosition(shaft.x, shaft.yTop / 2, shaft.z);
    this.shaftMesh!.setMatrixAt(i, matrix);
  }

  private setLampLit(index: number, lit: boolean): void {
    const lamps = this.lampMesh;
    if (lamps) {
      lamps.setColorAt(index, new THREE.Color(lit ? this.layout.lamps[index]!.color : 0x000000));
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    }
    if (!this.shaftMesh) return;
    let changed = false;
    this.shafts.forEach((shaft, i) => { if (shaft.lamp === index) { this.setShaft(i, lit); changed = true; } });
    if (changed) this.shaftMesh.instanceMatrix.needsUpdate = true;
  }

  get lampCount(): number { return this.layout.lamps.length; }

  lampPosition(index: number): { x: number; y: number; z: number } | null {
    const lamp = Number.isInteger(index) ? this.layout.lamps[index] : undefined;
    return lamp ? { x: lamp.x, y: lamp.y, z: lamp.z } : null;
  }

  isLampDead(index: number): boolean { return this.dead.has(index); }

  deadLampIndices(): number[] { return [...this.dead].sort((a, b) => a - b); }

  /**
   * Shoots out a lamp: its panel goes black and its light shaft disappears at once, and it counts as
   * dead from now on; its light leaves the bake (walls, floor and the probes that light moving
   * things) on a later frame, one queued rebake per update, so a shotgun breaking several lamps or a
   * late joiner's whole dead set never stacks rebakes into one frame. Returns the lamp position, or
   * null when the index is not a live lamp.
   */
  killLamp(index: number): { x: number; y: number; z: number } | null {
    const position = this.lampPosition(index);
    if (this.disposed || !position || this.dead.has(index)) return null;
    this.dead.add(index);
    this.setLampLit(index, false);
    this.rebakeQueue.push(index);
    return position;
  }

  /** Kills every listed lamp that is still lit (a late joiner's dead set, a resync). Returns those. */
  killLamps(indices: Iterable<number>): number[] {
    const killed: number[] = [];
    for (const index of indices) if (this.killLamp(index)) killed.push(index);
    return killed;
  }

  /** Dead lamps whose rebake has not run yet. */
  get pendingRebakes(): number { return this.rebakeQueue.length; }

  /** Runs every queued rebake now (tests, and anything that must see the final light at once). */
  flushLampRebakes(): void {
    while (this.rebakeNext());
  }

  /** Takes one lamp's light out of the bake. False when the queue was empty. */
  private rebakeNext(): boolean {
    const index = this.rebakeQueue.shift();
    if (index === undefined) return false;
    const position = this.lampPosition(index);
    if (this.disposed || !position || !this.dead.has(index)) return true;
    const start = performance.now();
    const { vertices } = rebakeFacilityAround(this.bake, this.dead, position.x, position.y, position.z, index);
    // Changed vertices are ascending and the materials are in order, so one walk finds each range.
    let k = 0;
    for (const range of this.lightRanges) {
      const end = range.first + range.count;
      while (k < vertices.length && vertices[k]! < range.first) k++;
      if (k >= vertices.length || vertices[k]! >= end) continue;
      const low = vertices[k]!;
      let high = low;
      while (k < vertices.length && vertices[k]! < end) high = vertices[k++]!;
      range.attribute.addUpdateRange((low - range.first) * 3, (high - low + 1) * 3);
      range.attribute.needsUpdate = true;
    }
    this.lastKillMs = performance.now() - start;
    return true;
  }

  /** Relights every lamp and restores the full bake exactly. */
  relightAll(): void {
    if (this.disposed || !this.dead.size) return;
    this.rebakeQueue.length = 0;
    const { bake, original } = this;
    bake.light.set(original.light); bake.probes.set(original.probes);
    bake.direct.set(original.direct); bake.fill.set(original.fill);
    for (const range of this.lightRanges) {
      range.attribute.clearUpdateRanges();
      range.attribute.needsUpdate = true;
    }
    for (const index of this.dead) this.setLampLit(index, true);
    this.dead.clear();
  }

  /**
   * The nearest live lamp whose hit box the ray crosses within maxDistance, or -1. Lamps are not
   * physics colliders, so hitscan weapons test them here.
   */
  rayHitLamp(origin: THREE.Vector3Like, direction: THREE.Vector3Like, maxDistance: number): number {
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (this.disposed || !(length > 0) || !(maxDistance > 0)) return -1;
    const d = [direction.x / length, direction.y / length, direction.z / length];
    const o = [origin.x, origin.y, origin.z];
    let best = -1, nearest = maxDistance;
    this.layout.lamps.forEach((lamp, index) => {
      if (this.dead.has(index)) return;
      const centre = [lamp.x, lamp.y, lamp.z], extent = LAMP_HIT_HALF[lamp.kind];
      let lo = 0, hi = nearest;
      for (let axis = 0; axis < 3 && lo <= hi; axis++) {
        const min = centre[axis]! - extent[axis]!, max = centre[axis]! + extent[axis]!;
        if (Math.abs(d[axis]!) < 1e-12) {
          if (o[axis]! < min || o[axis]! > max) hi = -1;
          continue;
        }
        const a = (min - o[axis]!) / d[axis]!, b = (max - o[axis]!) / d[axis]!;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      }
      if (lo <= hi && lo < nearest) { nearest = lo; best = index; }
    });
    return best;
  }

  private addDust(): void {
    const rng = mulberry32(this.layout.seed + 593), positions = new Float32Array(300 * 3);
    for (let i = 0; i < positions.length; i += 3) {
      const y = rng() * 2 - 1, angle = rng() * Math.PI * 2, radius = 10 * Math.cbrt(rng());
      const ring = Math.sqrt(1 - y * y) * radius;
      positions.set([Math.cos(angle) * ring, y * radius, Math.sin(angle) * ring], i);
    }
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const radius = Math.hypot((x + 0.5 - 16) / 16, (y + 0.5 - 16) / 16);
      pixels.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - radius) ** 2)], (y * 32 + x) * 4);
    }
    const texture = new THREE.DataTexture(pixels, 32, 32, THREE.RGBAFormat);
    texture.needsUpdate = true;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.PointsMaterial({ name: 'facility-dust', color: 0xffd2a0, size: 0.035,
      map: texture, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false,
      fog: false, toneMapped: false });
    this.textures.add(texture); this.geometries.add(geometry); this.materials.add(material);
    this.dustPoints = new THREE.Points(geometry, material);
    this.dustPoints.name = 'facility-dust';
    this.dustPoints.frustumCulled = false;
    this.group.add(this.dustPoints);
  }

  probeAt(x: number, z: number): [number, number, number] {
    return sampleProbe(this.layout, this.probes, x, z);
  }

  /** Per frame: at most one queued lamp rebake (see killLamp), then the dust drifts. */
  update(camera: THREE.Camera, dt: number): void {
    if (this.disposed) return;
    this.rebakeNext();
    if (!this.dustPoints) return;
    camera.getWorldPosition(this.cameraPosition);
    const cameraPoint = this.cameraPosition, attribute = this.dustPoints.geometry.getAttribute('position');
    const positions = attribute.array as Float32Array, step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    for (let i = 0; i < positions.length; i += 3) {
      let x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
      if (!this.dustStarted) { x += cameraPoint.x; y += cameraPoint.y; z += cameraPoint.z; }
      x += Math.sin(i * 1.7) * 0.035 * step;
      y += (0.025 + (i % 7) * 0.004) * step;
      z += Math.cos(i * 2.3) * 0.035 * step;
      const dx = x - cameraPoint.x, dy = y - cameraPoint.y, dz = z - cameraPoint.z, distance = Math.hypot(dx, dy, dz);
      if (distance > 10) {
        const wrap = -9.9 / distance;
        x = cameraPoint.x + dx * wrap; y = cameraPoint.y + dy * wrap; z = cameraPoint.z + dz * wrap;
      }
      positions[i] = x; positions[i + 1] = y; positions[i + 2] = z;
    }
    this.dustStarted = true;
    attribute.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    if (this.registered) this.options.obstacles.removeChunk('facility');
    // Removing the fixed body also removes all of its attached colliders.
    if (this.body) this.options.physics.world.removeRigidBody(this.body);
    this.body = null;
    this.group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.clear(); this.materials.clear(); this.textures.clear();
    this.group.clear(); this.dustPoints = null;
  }
}
