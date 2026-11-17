import * as THREE from 'three';
import { ADS_SIGHT_DISTANCE } from '../../../core/config.ts';
import type { SkinFeatures } from '../skins.ts';
import type { WeaponAnimations } from '../../animation/clips.ts';
import {
  box, disc, merge, plate, revolve, ring, toThree, tube,
  type BoxOptions, type P2, type P3, type PlateOptions, type RevolveOptions,
} from './geometry.ts';

/** What a surface is made of. A skin maps each slot to a material (models/skinMaterials.ts), so a
 * weapon file never names a colour. */
export type MaterialSlot =
  /** Receiver, slide, frame: the dark structural metal. */
  | 'metal'
  /** Barrel, bolt, pins, controls: the second metal, usually lighter or coloured by the skin. */
  | 'metalAlt'
  /** Moulded parts: pistol grips, magazines, trigger guards. */
  | 'polymer'
  /** Stock, handguard, grip panels: the part a skin repaints most (wood, camouflage, white). */
  | 'furniture'
  /** Small painted marks and trim. */
  | 'accent'
  /** Recoil pads and grip inserts. */
  | 'rubber'
  /** Holes: a bore, an ejection port, a vent slot. Unlit black. */
  | 'void'
  /** Lenses. Transparent. */
  | 'glass'
  /** The ammo witness light. One material per weapon instance (it dims as the magazine empties). */
  | 'glow'
  /** Sight dots. Emissive. */
  | 'sight'
  /** A blade's ground steel. */
  | 'edge'
  /** Cloth and cord wraps. */
  | 'wrap'
  /** Gold parts on the reward weapon and the gilded skin. */
  | 'gold'
  /** The pulse skin's light lines. Emissive, animated. */
  | 'lightLine'
  | 'glove'
  | 'sleeve';

/** Parts whose names start with this are the shooter's arms: left out of thumbnails, the Skins
 * preview and the copy other players see. */
export const ARM_PART_PREFIX = 'arm-';

export interface PartSpec {
  readonly name: string;
  /** Rest position of the part's own origin, in gun space: what it turns about. */
  readonly pivot: P3;
  readonly parent: string;
}

export interface BlueprintMesh {
  readonly part: string;
  readonly slot: MaterialSlot;
  readonly name: string;
  /** Part-local geometry, shared by every instance of this weapon and skin. */
  readonly geometry: THREE.BufferGeometry;
  /** A sight's thin frame: the one thing besides the sight tip allowed above the line of aim. */
  readonly opticFrame: boolean;
}

export interface ModelTuning {
  /** Uniform scale of the whole model in the view. */
  readonly scale: number;
  /** Camera-space offset of the model inside the view-model group, as a three vector. */
  readonly offset: readonly [number, number, number];
  /** How a blade is held at rest: [pitch, yaw, roll] in radians (pitch tips the point up, yaw
   * swings it right, roll tips the top right). Blades only: a gun's aim pose assumes no rotation,
   * and the model test rejects one. */
  readonly rotation?: readonly [pitch: number, yaw: number, roll: number];
}

/** Everything about one weapon in one skin that does not change between instances. */
export interface WeaponBlueprint {
  readonly weaponId: string;
  readonly parts: readonly PartSpec[];
  readonly meshes: readonly BlueprintMesh[];
  /** Barrel tip, gun space. */
  readonly muzzle: P3;
  /** The point the aim pose puts on the screen centre, gun space; null for a weapon that never aims. */
  readonly aimPoint: P3 | null;
  /** How far in front of the eye the aim point sits at full aim. */
  readonly aimDistance: number;
  /** A scope overlay replaces the model at full aim, so nothing about it can block the view. */
  readonly scoped: boolean;
  readonly tuning: ModelTuning;
  readonly animations: WeaponAnimations;
  /** Parts that slide back along the barrel as the weapon comes up to the eye, by this many
   * metres at full aim (see GunBuilder.retractWhenAimed). */
  readonly aimRetract: Readonly<Record<string, number>>;
}

interface Piece {
  part: string;
  slot: MaterialSlot;
  geometry: THREE.BufferGeometry;
  /** Pieces with a name stay their own mesh; the rest merge per part and slot. */
  name: string | null;
  opticFrame: boolean;
}

export const BODY = 'body';

/** Collects a weapon's geometry part by part and material by material, then merges it so a detailed
 * model still costs one draw call per part and material. All coordinates are gun space
 * (kit/geometry.ts): x right, y up, f forward. */
export class GunBuilder {
  private readonly parts = new Map<string, PartSpec>([[BODY, { name: BODY, pivot: [0, 0, 0], parent: '' }]]);
  private readonly pieces: Piece[] = [];
  /** Barrel tip. Set by the weapon file (muzzleDevice returns the forward position to use). */
  muzzle: P3 = [0, 0, 0];
  aimPoint: P3 | null = null;
  aimDistance = ADS_SIGHT_DISTANCE;
  scoped = false;
  tuning: ModelTuning = { scale: 1, offset: [-0.07, 0.04, 0.12] };
  animations: WeaponAnimations = {};
  private readonly aimRetract: Record<string, number> = {};

  constructor(readonly weaponId: string, readonly skin: SkinFeatures) {}

  /** Declares a moving part and what it turns about. Geometry is still given in gun space. */
  part(name: string, pivot: P3 = [0, 0, 0], parent: string = BODY): string {
    if (this.parts.has(name)) throw new Error(`Weapon kit: part ${name} declared twice on ${this.weaponId}`);
    if (!this.parts.has(parent)) throw new Error(`Weapon kit: part ${name} has an unknown parent ${parent}`);
    this.parts.set(name, { name, pivot, parent });
    return name;
  }

  /** The aim pose holds the rear sight at arm's length (ADS_SIGHT_DISTANCE), further out than a
   * real cheek weld, so a shoulder stock would sit in front of the eye and fill the lower middle of
   * the view. A stock is therefore a part of its own that slides straight back out of sight as the
   * weapon is raised: `distance` metres at full aim, enough to put it behind the camera. */
  retractWhenAimed(part: string, distance: number): void {
    if (!this.parts.has(part)) throw new Error(`Weapon kit: unknown part ${part} on ${this.weaponId}`);
    this.aimRetract[part] = distance;
  }

  hasPart(name: string): boolean {
    return this.parts.has(name);
  }

  /** Adds any geometry already in three space (x, y, -f). The helpers below all end here. */
  add(part: string, slot: MaterialSlot, geometry: THREE.BufferGeometry, options: { name?: string; opticFrame?: boolean } = {}): void {
    if (!this.parts.has(part)) throw new Error(`Weapon kit: unknown part ${part} on ${this.weaponId}`);
    this.pieces.push({ part, slot, geometry, name: options.name ?? null, opticFrame: options.opticFrame ?? false });
  }

  /** Re-tags the piece just added: its own mesh (found by name), or a sight frame. */
  relabelLast(options: { name?: string; opticFrame?: boolean }): void {
    const piece = this.pieces[this.pieces.length - 1];
    if (!piece) throw new Error(`Weapon kit: nothing to relabel on ${this.weaponId}`);
    if (options.name !== undefined) piece.name = options.name;
    if (options.opticFrame !== undefined) piece.opticFrame = options.opticFrame;
  }

  plate(part: string, slot: MaterialSlot, points: readonly P2[], width: number, options?: PlateOptions): void {
    this.add(part, slot, plate(points, width, options));
  }

  /** A plate on each side of the centre line (grip panels, handguard cheeks). */
  plates(part: string, slot: MaterialSlot, points: readonly P2[], width: number, x: number, options?: PlateOptions): void {
    this.add(part, slot, plate(points, width, { ...options, x }));
    this.add(part, slot, plate(points, width, { ...options, x: -x }));
  }

  revolve(part: string, slot: MaterialSlot, stations: readonly (readonly [number, number])[], options?: RevolveOptions): void {
    this.add(part, slot, revolve(stations, options));
  }

  tube(part: string, slot: MaterialSlot, a: P3, b: P3, radius: number, endRadius = radius, segments = 10): void {
    this.add(part, slot, tube(a, b, radius, endRadius, segments));
  }

  box(part: string, slot: MaterialSlot, size: P3, center: P3, options?: BoxOptions): void {
    this.add(part, slot, box(size, center, options));
  }

  ring(part: string, slot: MaterialSlot, center: P3, radius: number, thickness: number): void {
    this.add(part, slot, ring(center, radius, thickness));
  }

  disc(part: string, slot: MaterialSlot, center: P3, radius: number, facing: 1 | -1 = 1): void {
    this.add(part, slot, disc(center, radius, facing));
  }

  /** A cross pin or screw head showing on both sides of the gun. */
  pin(part: string, slot: MaterialSlot, f: number, y: number, halfWidth: number, radius = 0.004): void {
    this.add(part, slot, tube([-halfWidth, y, f], [halfWidth, y, f], radius, radius, 8));
  }

  /** An accessory rail: a base strip with cross slots, from `f0` forward to `f1`, top at `y`. */
  rail(part: string, slot: MaterialSlot, f0: number, f1: number, y: number, width = 0.021): void {
    const height = 0.009;
    this.add(part, slot, box([width * 0.72, height * 0.55, f1 - f0], [0, y - height * 0.725, (f0 + f1) / 2]));
    const pitch = 0.01;
    const count = Math.max(1, Math.floor((f1 - f0) / pitch));
    const start = f0 + ((f1 - f0) - (count - 1) * pitch) / 2;
    for (let i = 0; i < count; i++) {
      this.add(part, slot, box([width, height * 0.45, pitch * 0.55], [0, y - height * 0.225, start + i * pitch]));
    }
  }

  /** A row of dark slots along a surface (handguard vents, slide serrations). `normal` picks the
   * face: 'side' cuts both sides at |x| = `offset`, 'top' the top at y = `offset`. */
  slots(part: string, f0: number, f1: number, count: number, size: readonly [along: number, across: number], at: number, offset: number, normal: 'side' | 'top' = 'side', slot: MaterialSlot = 'void'): void {
    for (let i = 0; i < count; i++) {
      const f = count === 1 ? (f0 + f1) / 2 : f0 + ((f1 - f0) * i) / (count - 1);
      if (normal === 'side') {
        for (const x of [-offset, offset]) this.add(part, slot, box([0.0016, size[1], size[0]], [x, at, f]));
      } else {
        this.add(part, slot, box([size[1], 0.0016, size[0]], [at, offset, f]));
      }
    }
  }

  /** The end of the barrel. Returns the forward position of the tip, for `muzzle`. The ember skin
   * swaps a plain device for a ported brake, which is longer. */
  muzzleDevice(part: string, f: number, y: number, radius: number, kind: 'flash' | 'brake' | 'crown' | 'plain' = 'flash', x = 0): number {
    const style = kind !== 'plain' && this.skin.muzzle === 'ported' ? 'ported' : kind;
    const bore = radius * 0.55;
    if (style === 'plain' || style === 'crown') {
      this.revolve(part, 'metalAlt', [[f - 0.004, radius], [f + 0.004, radius * 0.92]], { x, y, bore });
      this.disc(part, 'void', [x, y, f + 0.001], bore, -1);
      return f + 0.004;
    }
    if (style === 'flash') {
      const r = radius * 1.35;
      this.revolve(part, 'metalAlt', [[f - 0.006, radius], [f, r], [f + 0.038, r], [f + 0.046, r * 0.86]], { x, y, bore });
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        this.add(part, 'void', box([0.0035, 0.0035, 0.024], [x + Math.cos(a) * r, y + Math.sin(a) * r, f + 0.02]));
      }
      this.disc(part, 'void', [x, y, f + 0.03], bore, -1);
      return f + 0.046;
    }
    if (style === 'brake') {
      const w = radius * 3.1, h = radius * 2.3;
      this.box(part, 'metalAlt', [w, h, 0.05], [x, y, f + 0.025], { bevel: 0.003 });
      for (const ff of [f + 0.014, f + 0.036]) this.box(part, 'void', [w + 0.002, h * 0.42, 0.012], [x, y, ff]);
      this.disc(part, 'void', [x, y, f + 0.051], bore, -1);
      return f + 0.05;
    }
    // Ported: a long sleeve with three rows of gas ports, the ember family's signature.
    const r = radius * 1.55;
    this.revolve(part, 'metalAlt', [[f - 0.008, radius], [f - 0.002, r], [f + 0.07, r], [f + 0.078, r * 0.8]], { x, y, bore, segments: 12 });
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + row * 0.5;
        this.add(part, 'void', box([0.005, 0.005, 0.011], [x + Math.cos(a) * r, y + Math.sin(a) * r, f + 0.014 + row * 0.022]));
      }
    }
    this.add(part, 'accent', revolve([[f + 0.066, r * 1.02], [f + 0.071, r * 1.02]], { x, y, bore: r * 0.98, segments: 12 }));
    this.disc(part, 'void', [x, y, f + 0.06], bore, -1);
    return f + 0.078;
  }

  /** Cloth or cord wound round a part: only the skins that carry wraps draw it. `radius` is the
   * wrapped part's outer radius about the axis at (x, y). */
  wrap(part: string, f0: number, f1: number, y: number, radius: number, x = 0): void {
    if (!this.skin.wraps) return;
    const turns = Math.max(2, Math.round((f1 - f0) / 0.016));
    const step = (f1 - f0) / turns;
    for (let i = 0; i < turns; i++) {
      const a = f0 + i * step;
      this.revolve(part, 'wrap', [[a, radius + 0.0015], [a + step * 0.2, radius + 0.004], [a + step * 0.8, radius + 0.004], [a + step, radius + 0.0015]], { x, y, segments: 10 });
    }
  }

  /** The same wrap around a flat-sided part (a stock, a blade handle): a banded sleeve of the
   * given cross-section. */
  wrapBox(part: string, f0: number, f1: number, center: readonly [x: number, y: number], size: readonly [across: number, up: number]): void {
    if (!this.skin.wraps) return;
    const turns = Math.max(2, Math.round((f1 - f0) / 0.018));
    const step = (f1 - f0) / turns;
    for (let i = 0; i < turns; i++) {
      this.box(part, 'wrap', [size[0] + 0.007, size[1] + 0.007, step * 0.82], [center[0], center[1], f0 + (i + 0.5) * step], { bevel: 0.003 });
    }
  }

  /** An engraved side plate on both sides: the gilded skin's raised panel. `points` is its outline. */
  engraving(part: string, points: readonly P2[], halfWidth: number): void {
    if (!this.skin.engraving) return;
    this.plates(part, 'gold', points, 0.0022, halfWidth + 0.0006, { bevel: 0.0008, round: 0.004 });
  }

  /** The golden goose medallion set into both sides of a grip or stock (gilded skin). */
  medallion(part: string, f: number, y: number, halfWidth: number, radius = 0.011): void {
    if (!this.skin.medallion) return;
    for (const side of [-1, 1] as const) {
      const x = side * (halfWidth + 0.0012);
      this.add(part, 'gold', tube([x - side * 0.002, y, f], [x, y, f], radius, radius, 14));
      this.add(part, 'metal', tube([x, y, f], [x + side * 0.0008, y, f], radius * 0.62, radius * 0.62, 10));
    }
  }

  /** A thin light line along both sides (pulse skin): from one profile point to the next. */
  lightLine(part: string, points: readonly (readonly [f: number, y: number])[], halfWidth: number): void {
    if (!this.skin.lightLines) return;
    for (let i = 0; i < points.length - 1; i++) {
      const [f0, y0] = points[i]!, [f1, y1] = points[i + 1]!;
      for (const x of [-halfWidth - 0.0008, halfWidth + 0.0008]) {
        this.add(part, 'lightLine', tube([x, y0, f0], [x, y1, f1], 0.0016, 0.0016, 5));
      }
    }
  }

  /** The ammo witness light: a strip on both sides that dims as the magazine empties. */
  witness(part: string, f0: number, f1: number, y: number, halfWidth: number, height = 0.006): void {
    for (const x of [-halfWidth - 0.0004, halfWidth + 0.0004]) {
      this.add(part, 'glow', box([0.0016, height, f1 - f0], [x, y, (f0 + f1) / 2]));
    }
  }

  finish(): WeaponBlueprint {
    const groups = new Map<string, Piece[]>();
    for (const piece of this.pieces) {
      const key = piece.name !== null ? `${piece.part}|${piece.slot}|${piece.name}` : `${piece.part}|${piece.slot}|${piece.opticFrame ? 'frame' : ''}`;
      const list = groups.get(key);
      if (list) list.push(piece); else groups.set(key, [piece]);
    }
    const meshes: BlueprintMesh[] = [];
    const offset = new THREE.Vector3();
    for (const list of groups.values()) {
      const head = list[0]!;
      const geometry = merge(list.map((piece) => piece.geometry));
      toThree(this.parts.get(head.part)!.pivot, offset);
      geometry.translate(-offset.x, -offset.y, -offset.z);
      meshes.push({
        part: head.part,
        slot: head.slot,
        name: head.name ?? `${head.part}-${head.slot}${head.opticFrame ? '-frame' : ''}`,
        geometry,
        opticFrame: head.opticFrame,
      });
    }
    return {
      weaponId: this.weaponId,
      parts: [...this.parts.values()],
      meshes,
      muzzle: this.muzzle,
      aimPoint: this.aimPoint,
      aimDistance: this.aimDistance,
      scoped: this.scoped,
      tuning: this.tuning,
      animations: this.animations,
      aimRetract: this.aimRetract,
    };
  }
}
