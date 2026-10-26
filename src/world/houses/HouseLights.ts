import * as THREE from 'three';
import { rayBoxDistance, type Box3 } from '../doors/doorGeometry.ts';
import { LampBreakEffect } from '../facility/lampBreakEffect.ts';
import { LAMP_PANEL } from '../houseDesigns.ts';

/** Real lights for the nearest lit lamps to the camera. A fixed pool: changing the number of lights
 * in a scene recompiles every material, so the pool is made once and only moved. */
export const HOUSE_LIGHT_POOL = 4;
const LAMP_COLOUR = 0xffd6a0;
/** Candela, decay 2: a floor 2.6 m under the lamp gets about 1 unit, a room's far corner a third. */
const LIGHT_INTENSITY = 7;
/** Past this a pooled light adds nothing (and three skips it). Rooms are at most about 6.5 m long. */
const LIGHT_RANGE = 6;
/** The light hangs this far under its panel, so the ceiling round the lamp catches some of it. */
const LIGHT_DROP = 0.2;
/** The look ray's box round a panel is this much larger on each side. */
const PICK_MARGIN = 0.06;
const START_CAPACITY = 64;

interface Lamp {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  slot: number;
}

/**
 * The houses' ceiling lamps (docs/enterable-buildings.md): one emissive panel per room in a single
 * instanced mesh (FacilityBuilder.addLamps' pattern: the instance colour tints the emitted light too,
 * so a black instance is a dark lamp), lit at night and in fog, and the small pool of point lights
 * moved to the lit lamps nearest the camera. A lamp can be shot out; it stays dead when its house
 * streams out and back in. Lamp ids are world/houses/valleyHouseIds.ts's (house key, room index).
 */
export class HouseLights {
  private readonly lamps = new Map<number, Lamp>();
  private readonly dead = new Set<number>();
  private readonly lights: THREE.PointLight[] = [];
  private readonly geometry = new THREE.BoxGeometry(LAMP_PANEL.width, LAMP_PANEL.height, LAMP_PANEL.depth);
  private readonly material: THREE.MeshStandardMaterial;
  private readonly breakEffect: LampBreakEffect;
  private mesh: THREE.InstancedMesh;
  private readonly freeSlots: number[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly colour = new THREE.Color();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private disposed = false;

  /** `lampsOn` for a Night or Fog match: the panels glow and the light pool exists. */
  constructor(private readonly scene: THREE.Scene, readonly lampsOn: boolean) {
    this.material = new THREE.MeshStandardMaterial({ name: 'house-lamps', color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 5, roughness: 0.6, toneMapped: false });
    // As FacilityBuilder.addLamps: the fragment shader only gets USE_COLOR for instance colours here
    // (USE_INSTANCING_COLOR is a vertex-shader define), and this material has no vertex colours.
    this.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif');
    };
    this.material.customProgramCacheKey = () => 'house-lamp-instance-emissive-v1';
    this.mesh = this.makeMesh(START_CAPACITY);
    this.breakEffect = new LampBreakEffect(scene);
    if (lampsOn) {
      for (let i = 0; i < HOUSE_LIGHT_POOL; i++) {
        const light = new THREE.PointLight(LAMP_COLOUR, 0, LIGHT_RANGE, 2);
        light.name = `house-light-${i}`;
        light.castShadow = false;
        this.lights.push(light);
        scene.add(light);
      }
    }
  }

  private makeMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.name = 'house-lamps';
    // Lamps come and go with their houses all over the loaded world; the bounding sphere is not kept.
    mesh.frustumCulled = false;
    for (let i = capacity - 1; i >= 0; i--) {
      mesh.setMatrixAt(i, this.hidden);
      mesh.setColorAt(i, this.colour.setRGB(0, 0, 0));
      this.freeSlots.push(i);
    }
    this.scene.add(mesh);
    return mesh;
  }

  /** Doubles the instance capacity, keeping every slot's matrix and colour. */
  private grow(): void {
    const old = this.mesh, capacity = old.count * 2;
    this.freeSlots.length = 0;
    const mesh = this.makeMesh(capacity);
    this.freeSlots.splice(0, this.freeSlots.length, ...this.freeSlots.filter((slot) => slot >= old.count));
    for (let i = 0; i < old.count; i++) {
      old.getMatrixAt(i, this.matrix); mesh.setMatrixAt(i, this.matrix);
      old.getColorAt(i, this.colour); mesh.setColorAt(i, this.colour);
    }
    old.removeFromParent();
    old.dispose();
    this.mesh = mesh;
  }

  /** A house streamed in: its lamp `id` at world position (x, y, z), lit or dark. */
  addLamp(id: number, x: number, y: number, z: number): void {
    if (this.disposed || this.lamps.has(id)) return;
    if (!this.freeSlots.length) this.grow();
    const slot = this.freeSlots.pop()!;
    this.lamps.set(id, { x, y, z, slot });
    this.mesh.setMatrixAt(slot, this.matrix.makeTranslation(x, y, z));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.paint(id);
  }

  removeLamp(id: number): void {
    const lamp = this.lamps.get(id);
    if (!lamp) return;
    this.mesh.setMatrixAt(lamp.slot, this.hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.freeSlots.push(lamp.slot);
    this.lamps.delete(id);
  }

  private paint(id: number): void {
    const lamp = this.lamps.get(id);
    if (!lamp) return;
    this.mesh.setColorAt(lamp.slot, this.isLit(id) ? this.colour.setHex(LAMP_COLOUR) : this.colour.setRGB(0, 0, 0));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** On (Night or Fog) and not shot out. */
  isLit(id: number): boolean {
    return this.lampsOn && !this.dead.has(id);
  }

  isDead(id: number): boolean {
    return this.dead.has(id);
  }

  /** Every lamp shot out so far, streamed in or not (for part 2's sync). */
  deadLampIds(): number[] {
    return [...this.dead].sort((a, b) => a - b);
  }

  /** The streamed-in lamp a ray hits before `maxDistance` (a pellet's own physics hit), or -1. */
  rayHitLamp(origin: THREE.Vector3Like, direction: THREE.Vector3Like, maxDistance: number): number {
    let best = -1, nearest = maxDistance;
    for (const [id, lamp] of this.lamps) {
      if (this.dead.has(id)) continue;
      const box: Box3 = { cx: lamp.x, cy: lamp.y, cz: lamp.z,
        hx: LAMP_PANEL.width / 2 + PICK_MARGIN, hy: LAMP_PANEL.height / 2 + PICK_MARGIN, hz: LAMP_PANEL.depth / 2 + PICK_MARGIN };
      const distance = rayBoxDistance(box, origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, nearest);
      if (distance < nearest) { nearest = distance; best = id; }
    }
    return best;
  }

  /** Shoots out lamp `id`: dark from now on, wherever it is; sparks and glass where it hangs when it
   * is streamed in (`effect`). Its position when streamed in, else null; also null when already dead. */
  killLamp(id: number, effect = true): { x: number; y: number; z: number } | null {
    if (this.disposed || this.dead.has(id)) return null;
    this.dead.add(id);
    const lamp = this.lamps.get(id);
    if (!lamp) return null;
    this.paint(id);
    const at = { x: lamp.x, y: lamp.y, z: lamp.z };
    if (effect) this.breakEffect.spawn(at);
    return at;
  }

  /** Per frame: the light pool moves to the lit lamps nearest the camera, and the sparks fall. */
  update(dt: number, camera: THREE.Vector3Like): void {
    if (this.disposed) return;
    this.breakEffect.update(dt);
    if (!this.lights.length) return;
    const nearest: { lamp: Lamp; d: number }[] = [];
    for (const [id, lamp] of this.lamps) {
      if (!this.isLit(id)) continue;
      const d = (lamp.x - camera.x) ** 2 + (lamp.y - camera.y) ** 2 + (lamp.z - camera.z) ** 2;
      if (nearest.length < this.lights.length) nearest.push({ lamp, d });
      else {
        let worst = 0;
        for (let i = 1; i < nearest.length; i++) if (nearest[i]!.d > nearest[worst]!.d) worst = i;
        if (d < nearest[worst]!.d) nearest[worst] = { lamp, d };
      }
    }
    this.lights.forEach((light, i) => {
      const pick = nearest[i];
      if (!pick) { light.intensity = 0; return; }
      light.position.set(pick.lamp.x, pick.lamp.y - LIGHT_DROP, pick.lamp.z);
      light.intensity = LIGHT_INTENSITY;
    });
  }

  /** Debug API: streamed-in lamps, lit ones and where the light pool stands. */
  debug(): { lamps: number; lit: number; dead: number; lights: { x: number; y: number; z: number; on: boolean }[] } {
    let lit = 0;
    for (const id of this.lamps.keys()) if (this.isLit(id)) lit++;
    return { lamps: this.lamps.size, lit, dead: this.dead.size,
      lights: this.lights.map((l) => ({ x: l.position.x, y: l.position.y, z: l.position.z, on: l.intensity > 0 })) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const light of this.lights) light.removeFromParent();
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.breakEffect.dispose();
  }
}
