import * as THREE from 'three';
import { ACCENT_AMBER, ACCENT_CYAN, THREAT_RED } from '../render/look.ts';
import {
  PICKUP_BOB_AMPLITUDE,
  PICKUP_BOB_RATE,
  PICKUP_HOVER_HEIGHT,
  PICKUP_SPIN_RATE,
  PICKUP_VISIBLE_RANGE,
  type PickupKind,
} from './pickupConfig.ts';
import type { PickupSite } from './pickupPlacement.ts';

/** The glow colour of each kind's ring, from the HUD accents: mint for health, amber for ammo and
 * the threat red for grenades. */
const RING_COLOUR: Readonly<Record<PickupKind, number>> = { health: ACCENT_CYAN, ammo: ACCENT_AMBER, grenade: THREAT_RED };

/** Ring geometry in metres: the glow disc and the thin rim at its edge. */
const GLOW_RADIUS = 0.95;
const RIM_INNER = 0.8;
const RIM_OUTER = 0.86;
/** Lift above the ground so the ring never z-fights the floor or the grass. */
const RING_LIFT = 0.04;
const LIVE_GLOW_OPACITY = 0.42;
const LIVE_RIM_OPACITY = 0.85;
const FAINT_RIM_OPACITY = 0.22;

interface SiteVisual {
  readonly site: PickupSite;
  readonly root: THREE.Group;
  readonly model: THREE.Group;
  readonly glow: THREE.Mesh;
  readonly rim: THREE.Mesh;
  available: boolean;
}

/** Soft white disc fading to nothing, tinted per kind through the material colour. */
function buildGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The floating models and rings (docs/pickups.md): a small model that turns and bobs over a soft
 * glowing ring on the floor, in the HUD accent colours. While a pickup is away only its faint rim
 * stays, so a player knows where it will come back. Everything is built from primitives, with one
 * shared geometry and material per part, so sixty pickups cost sixty draws at most and only those
 * near the player are drawn at all. */
export class PickupVisuals {
  private readonly visuals: SiteVisual[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly glowTexture = buildGlowTexture();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly glowGeometry = this.track(new THREE.CircleGeometry(GLOW_RADIUS, 40).rotateX(-Math.PI / 2));
  private readonly rimGeometry = this.track(new THREE.RingGeometry(RIM_INNER, RIM_OUTER, 48).rotateX(-Math.PI / 2));
  private readonly glowMaterials = new Map<PickupKind, THREE.MeshBasicMaterial>();
  private readonly rimMaterials = new Map<PickupKind, THREE.MeshBasicMaterial>();
  private readonly templates = new Map<PickupKind, THREE.Group>();
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    sites: readonly PickupSite[],
  ) {
    for (const site of sites) this.visuals.push(this.build(site));
  }

  private track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private material(color: number, options: { emissive?: number; emissiveIntensity?: number; roughness?: number; metalness?: number } = {}): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness: options.roughness ?? 0.6, metalness: options.metalness ?? 0.1, emissive: options.emissive ?? color, emissiveIntensity: options.emissiveIntensity ?? 0.22 });
    this.materials.add(material);
    return material;
  }

  private box(width: number, height: number, depth: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(this.track(new THREE.BoxGeometry(width, height, depth)), material);
    mesh.position.set(x, y, z);
    return mesh;
  }

  /** A health pack: a white first aid case with a red cross raised on both faces and a carry handle. */
  private buildHealthModel(): THREE.Group {
    const group = new THREE.Group();
    const caseMaterial = this.material(0xe9efe9, { roughness: 0.5 });
    const crossMaterial = this.material(0xe0332a, { emissiveIntensity: 0.5 });
    const handleMaterial = this.material(0x9aa6a2, { roughness: 0.4, metalness: 0.5 });
    group.add(this.box(0.52, 0.36, 0.2, caseMaterial));
    for (const side of [1, -1]) {
      group.add(this.box(0.2, 0.06, 0.02, crossMaterial, 0, 0, side * 0.105));
      group.add(this.box(0.06, 0.2, 0.02, crossMaterial, 0, 0, side * 0.105));
    }
    group.add(this.box(0.2, 0.04, 0.05, handleMaterial, 0, 0.2, 0));
    return group;
  }

  /** An ammo box: an olive drab steel box with a lid seam, two latches and a brass stencil stripe. */
  private buildAmmoModel(): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = this.material(0x5b6b2f, { roughness: 0.55, metalness: 0.25 });
    const seamMaterial = this.material(0x3c4720, { roughness: 0.6 });
    const brassMaterial = this.material(0xd9b04a, { emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.5 });
    group.add(this.box(0.54, 0.3, 0.3, bodyMaterial));
    group.add(this.box(0.56, 0.03, 0.32, seamMaterial, 0, 0.06, 0));
    for (const x of [-0.17, 0.17]) group.add(this.box(0.05, 0.1, 0.035, brassMaterial, x, 0.02, 0.165));
    group.add(this.box(0.3, 0.05, 0.01, brassMaterial, 0, -0.06, 0.155));
    group.add(this.box(0.3, 0.05, 0.01, brassMaterial, 0, -0.06, -0.155));
    return group;
  }

  /** A grenade crate: a darker drab box with a red band and two grenades standing in its open top. */
  private buildGrenadeModel(): THREE.Group {
    const group = new THREE.Group();
    const crateMaterial = this.material(0x444a36, { roughness: 0.7 });
    const bandMaterial = this.material(0xe0332a, { emissiveIntensity: 0.5 });
    const grenadeMaterial = this.material(0x6b7a3a, { roughness: 0.45, metalness: 0.3 });
    const pinMaterial = this.material(0xb8bfba, { roughness: 0.35, metalness: 0.7 });
    group.add(this.box(0.52, 0.26, 0.34, crateMaterial));
    group.add(this.box(0.54, 0.05, 0.36, bandMaterial, 0, 0.02, 0));
    const grenadeGeometry = this.track(new THREE.SphereGeometry(0.1, 14, 10));
    const capGeometry = this.track(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 8));
    for (const x of [-0.12, 0.12]) {
      const body = new THREE.Mesh(grenadeGeometry, grenadeMaterial);
      body.position.set(x, 0.2, 0);
      group.add(body);
      const cap = new THREE.Mesh(capGeometry, pinMaterial);
      cap.position.set(x, 0.31, 0);
      group.add(cap);
    }
    return group;
  }

  private template(kind: PickupKind): THREE.Group {
    let template = this.templates.get(kind);
    if (!template) {
      template = kind === 'health' ? this.buildHealthModel() : kind === 'ammo' ? this.buildAmmoModel() : this.buildGrenadeModel();
      this.templates.set(kind, template);
    }
    return template;
  }

  private ringMaterials(kind: PickupKind): { glow: THREE.MeshBasicMaterial; rim: THREE.MeshBasicMaterial } {
    let glow = this.glowMaterials.get(kind);
    let rim = this.rimMaterials.get(kind);
    if (!glow || !rim) {
      const common = { color: RING_COLOUR[kind], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
      glow = new THREE.MeshBasicMaterial({ ...common, map: this.glowTexture, opacity: LIVE_GLOW_OPACITY });
      rim = new THREE.MeshBasicMaterial({ ...common, opacity: LIVE_RIM_OPACITY });
      this.materials.add(glow);
      this.materials.add(rim);
      this.glowMaterials.set(kind, glow);
      this.rimMaterials.set(kind, rim);
    }
    return { glow, rim };
  }

  private build(site: PickupSite): SiteVisual {
    const root = new THREE.Group();
    root.position.set(site.x, site.y, site.z);
    const model = this.template(site.kind).clone();
    model.position.y = PICKUP_HOVER_HEIGHT;
    model.rotation.y = site.id * 1.7;
    const { glow: glowMaterial, rim: rimMaterial } = this.ringMaterials(site.kind);
    const glow = new THREE.Mesh(this.glowGeometry, glowMaterial);
    glow.position.y = RING_LIFT;
    glow.renderOrder = 2;
    const rim = new THREE.Mesh(this.rimGeometry, rimMaterial);
    rim.position.y = RING_LIFT + 0.005;
    rim.renderOrder = 3;
    root.add(glow, rim, model);
    root.visible = false;
    this.scene.add(root);
    return { site, root, model, glow, rim, available: true };
  }

  /** A pickup was taken (false) or came back (true). */
  setAvailable(id: number, available: boolean): void {
    const visual = this.visuals[id];
    if (!visual || visual.available === available) return;
    visual.available = available;
    this.applyAvailability(visual);
  }

  private applyAvailability(visual: SiteVisual): void {
    visual.model.visible = visual.available;
    visual.glow.visible = visual.available;
    // The faint ring is the same rim mesh at a lower opacity, so it gets its own material while away.
    visual.rim.material = visual.available ? this.rimMaterials.get(visual.site.kind)! : this.faintRimMaterial(visual.site.kind);
  }

  private readonly faintMaterials = new Map<PickupKind, THREE.MeshBasicMaterial>();
  private faintRimMaterial(kind: PickupKind): THREE.MeshBasicMaterial {
    let material = this.faintMaterials.get(kind);
    if (!material) {
      material = this.rimMaterials.get(kind)!.clone();
      material.opacity = FAINT_RIM_OPACITY;
      this.materials.add(material);
      this.faintMaterials.set(kind, material);
    }
    return material;
  }

  /** Whether pickup `id` is currently shown as on the map (a test reads it). */
  isShownAvailable(id: number): boolean {
    return this.visuals[id]?.available ?? false;
  }

  /** Turns and bobs the models near the player and hides the rest. */
  update(dt: number, playerX: number, playerZ: number): void {
    this.clock += dt;
    const still = this.reducedMotion.matches;
    const rangeSq = PICKUP_VISIBLE_RANGE * PICKUP_VISIBLE_RANGE;
    for (const visual of this.visuals) {
      const dx = visual.site.x - playerX;
      const dz = visual.site.z - playerZ;
      const near = dx * dx + dz * dz <= rangeSq;
      visual.root.visible = near;
      if (!near || !visual.available) continue;
      if (still) continue;
      visual.model.rotation.y = this.clock * PICKUP_SPIN_RATE + visual.site.id * 1.7;
      visual.model.position.y = PICKUP_HOVER_HEIGHT + Math.sin(this.clock * PICKUP_BOB_RATE + visual.site.id) * PICKUP_BOB_AMPLITUDE;
    }
  }

  dispose(): void {
    for (const visual of this.visuals) this.scene.remove(visual.root);
    this.visuals.length = 0;
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.glowTexture.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}
