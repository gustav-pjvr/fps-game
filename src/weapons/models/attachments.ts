import * as THREE from 'three';
import { box, disc, merge, revolve, tube, type P3 } from './kit/geometry.ts';

/** Attachments (docs/attachments.md): accessories a player fits to a gun on the Workbench. Each is
 * one designed unit with its own materials, the same on every gun and under every skin, placed on
 * a mount the gun declares below. A gun with no mount for an attachment cannot take it, and the
 * Workbench does not offer it. They change no handling. */
export type AttachmentId = 'laser' | 'torch';

export const ATTACHMENT_IDS: readonly AttachmentId[] = ['laser', 'torch'];

export interface AttachmentDefinition {
  readonly id: AttachmentId;
  readonly name: string;
  readonly description: string;
  /** What it does in a match, in the player's words. */
  readonly effect: string;
}

export const ATTACHMENTS: Readonly<Record<AttachmentId, AttachmentDefinition>> = {
  laser: {
    id: 'laser',
    name: 'Laser sight',
    description: 'A boxed red laser module with windage and elevation screws.',
    effect: 'Puts a red dot where the gun points.',
  },
  torch: {
    id: 'torch',
    name: 'Weapon torch',
    description: 'A knurled alloy torch with a crenellated bezel and a side switch.',
    effect: 'Your torch (F) shines from the gun instead of the shoulder.',
  },
};

export function isAttachmentId(value: unknown): value is AttachmentId {
  return value === 'laser' || value === 'torch';
}

/** Where a unit sits on a gun. `at` is the point on the gun's surface, gun space (x right, y up,
 * f forward), that the back of the unit's clamp touches; the unit runs forward from it and hangs
 * off the given side. `barrel` is the radius of a bare barrel at that point: the unit then rides a
 * ring clamped round it instead of a rail. `scale` shrinks the unit for a pistol's short rail. */
export interface AttachmentMount {
  readonly at: P3;
  readonly side: 'under' | 'left' | 'right';
  readonly scale?: number;
  readonly barrel?: number;
}

interface WeaponMounts {
  readonly mounts: Partial<Record<AttachmentId, AttachmentMount>>;
  /** One rail, one unit: fitting one takes the other off. */
  readonly exclusive?: boolean;
}

/** Every gun that takes attachments, and where. The support hand owns the handguard under and
 * beside its grip, so every mount sits at least 7 cm ahead of it. The revolver, the sawn-off, the
 * sniper rifle, the launcher and the blades take none. */
export const WEAPON_MOUNTS: Readonly<Record<string, WeaponMounts>> = {
  rifle: { mounts: { torch: { at: [0, -0.03, 0.37], side: 'under' }, laser: { at: [-0.023, 0.012, 0.385], side: 'left' } } },
  smg: { mounts: { torch: { at: [0, -0.011, 0.222], side: 'under', scale: 0.8, barrel: 0.011 }, laser: { at: [-0.011, 0, 0.228], side: 'left', scale: 0.8, barrel: 0.011 } } },
  battleRifle: { mounts: { torch: { at: [0, -0.0095, 0.365], side: 'under', barrel: 0.0095 }, laser: { at: [-0.0095, 0, 0.372], side: 'left', barrel: 0.0095 } } },
  lmg: { mounts: { torch: { at: [-0.01, 0, 0.49], side: 'left', barrel: 0.01 } } },
  dmr: { mounts: { laser: { at: [-0.0095, 0, 0.5], side: 'left', barrel: 0.0095 } } },
  shotgun: { mounts: { torch: { at: [-0.012, 0.008, 0.41], side: 'left', barrel: 0.012 } } },
  pistol: { mounts: { torch: { at: [0, -0.012, 0.046], side: 'under', scale: 0.62 }, laser: { at: [0, -0.012, 0.05], side: 'under', scale: 0.7 } }, exclusive: true },
  mp5: { mounts: { torch: { at: [0, -0.01, 0.256], side: 'under', scale: 0.8, barrel: 0.01 }, laser: { at: [-0.01, 0, 0.262], side: 'left', scale: 0.8, barrel: 0.01 } } },
  machinePistol: { mounts: { laser: { at: [0, -0.0145, 0.052], side: 'under', scale: 0.74 } } },
};

/** The attachments `weaponId` can take, in display order. */
export function allowedAttachments(weaponId: string): AttachmentId[] {
  const mounts = WEAPON_MOUNTS[weaponId]?.mounts;
  return mounts ? ATTACHMENT_IDS.filter((id) => mounts[id] !== undefined) : [];
}

/** `ids` cut down to what `weaponId` can carry: known, allowed, each once, and on a one-rail gun
 * only the last one asked for. Anything else is dropped rather than trusted. */
export function sanitizeAttachments(weaponId: string, ids: readonly unknown[]): AttachmentId[] {
  const allowed = allowedAttachments(weaponId);
  const kept: AttachmentId[] = [];
  for (const id of ids) {
    if (isAttachmentId(id) && allowed.includes(id) && !kept.includes(id)) kept.push(id);
  }
  const fitted = WEAPON_MOUNTS[weaponId]?.exclusive ? kept.slice(-1) : kept;
  return ATTACHMENT_IDS.filter((id) => fitted.includes(id));
}

/** `current` with `id` fitted or taken off, kept valid for `weaponId` (see sanitizeAttachments). */
export function toggleAttachment(weaponId: string, current: readonly AttachmentId[], id: AttachmentId): AttachmentId[] {
  return current.includes(id)
    ? sanitizeAttachments(weaponId, current.filter((other) => other !== id))
    : sanitizeAttachments(weaponId, [...current, id]);
}

// --- The units -------------------------------------------------------------------------------

type Slot = 'body' | 'trim' | 'rubber' | 'mark' | 'void' | 'lens';

interface Unit {
  /** Pieces in the unit's own space: the clamp's top face on y = 0, the unit below it, running
   * forward from f = 0. */
  readonly pieces: readonly (readonly [Slot, THREE.BufferGeometry])[];
  /** Where a barrel ring goes (forward range) when the gun has no rail there. */
  readonly ring: readonly [number, number];
  /** The middle of the lens, for the beam and the dot. */
  readonly lens: P3;
}

function torchUnit(): Unit {
  const y = -0.0215;
  const pieces: [Slot, THREE.BufferGeometry][] = [
    // Rail clamp with its cross bolt.
    ['body', box([0.019, 0.008, 0.03], [0, -0.004, 0.031], { bevel: 0.0015 })],
    ['trim', tube([-0.0115, -0.0045, 0.031], [0.0115, -0.0045, 0.031], 0.0032, 0.0032, 8)],
    // Tail cap, body tube, the flare of the head and the bezel.
    ['body', revolve([[0.002, 0.0098], [0.005, 0.012], [0.013, 0.012], [0.015, 0.0104], [0.05, 0.0104], [0.056, 0.0128], [0.06, 0.0148], [0.08, 0.0148], [0.084, 0.0156]], { y, segments: 16 })],
    // Knurled grip bands and the ring where the head unscrews.
    ...[0.02, 0.0265, 0.033, 0.0395].map((f): [Slot, THREE.BufferGeometry] => ['trim', revolve([[f, 0.0111], [f + 0.0035, 0.0111]], { y, bore: 0.0102, segments: 16 })]),
    ['trim', revolve([[0.0585, 0.0153], [0.062, 0.0153]], { y, bore: 0.0146, segments: 16 })],
    // Crenellated bezel: six teeth standing proud of the rim.
    ...Array.from({ length: 6 }, (_, k): [Slot, THREE.BufferGeometry] => {
      const a = (k / 6) * Math.PI * 2;
      return ['trim', box([0.0046, 0.0026, 0.005], [Math.cos(a) * 0.0146, y + Math.sin(a) * 0.0146, 0.0858], { rotate: [0, 0, -(a - Math.PI / 2)] })];
    }),
    ['void', disc([0, y, 0.0838], 0.0146, -1)],
    ['lens', disc([0, y, 0.0842], 0.0118, -1)],
    // Tail switch and the side switch under the thumb.
    ['rubber', tube([0, y, -0.0015], [0, y, 0.0025], 0.0068, 0.0068, 10)],
    ['rubber', box([0.004, 0.008, 0.014], [-0.0112, y, 0.03], { bevel: 0.0015 })],
  ];
  return { pieces, ring: [0.022, 0.04], lens: [0, y, 0.085] };
}

function laserUnit(): Unit {
  const pieces: [Slot, THREE.BufferGeometry][] = [
    // Rail clamp and its thumb screw.
    ['body', box([0.02, 0.007, 0.028], [0, -0.0035, 0.027], { bevel: 0.0015 })],
    ['trim', tube([0.009, -0.0042, 0.027], [0.0165, -0.0042, 0.027], 0.0046, 0.0046, 8)],
    // The housing, stepped down at the back where the pressure pad sits.
    ['body', box([0.027, 0.021, 0.04], [0, -0.0165, 0.034], { bevel: 0.003 })],
    ['body', box([0.022, 0.016, 0.014], [0, -0.0155, 0.009], { bevel: 0.0025 })],
    ['rubber', box([0.014, 0.009, 0.003], [0, -0.0155, 0.0012], { bevel: 0.001 })],
    // Emitter barrel and the second, smaller window beside it.
    ['trim', revolve([[0.05, 0.0068], [0.059, 0.0068], [0.06, 0.006]], { x: -0.0048, y: -0.0165, bore: 0.0044, segments: 14 })],
    ['void', disc([-0.0048, -0.0165, 0.0575], 0.0056, -1)],
    ['lens', disc([-0.0048, -0.0165, 0.0582], 0.0036, -1)],
    ['trim', revolve([[0.052, 0.004], [0.0555, 0.004]], { x: 0.0072, y: -0.0165, bore: 0.0026, segments: 10 })],
    ['void', disc([0.0072, -0.0165, 0.0548], 0.0036, -1)],
    // Windage screw on the side, elevation screw underneath.
    ['trim', tube([-0.013, -0.0165, 0.02], [-0.0168, -0.0165, 0.02], 0.004, 0.004, 8)],
    ['trim', tube([0, -0.0265, 0.02], [0, -0.0302, 0.02], 0.004, 0.004, 8)],
    // The warning label every laser carries, both sides.
    ['mark', box([0.0006, 0.007, 0.013], [-0.0137, -0.0165, 0.038])],
    ['mark', box([0.0006, 0.007, 0.013], [0.0137, -0.0165, 0.038])],
  ];
  return { pieces, ring: [0.018, 0.036], lens: [-0.0048, -0.0165, 0.0585] };
}

const UNITS: Readonly<Record<AttachmentId, () => Unit>> = { laser: laserUnit, torch: torchUnit };

/** Rotation about the barrel axis that swings a unit built hanging down onto the mount's side. */
function sideAngle(side: AttachmentMount['side']): number {
  return side === 'left' ? -Math.PI / 2 : side === 'right' ? Math.PI / 2 : 0;
}

function place(geometry: THREE.BufferGeometry, mount: AttachmentMount, scaled: boolean): THREE.BufferGeometry {
  const placed = geometry.clone();
  if (scaled && mount.scale) placed.scale(mount.scale, mount.scale, mount.scale);
  placed.rotateZ(sideAngle(mount.side));
  placed.translate(mount.at[0], mount.at[1], -mount.at[2]);
  return placed;
}

export interface AttachmentMesh {
  readonly name: string;
  readonly slot: Slot;
  /** Gun space (three axes: x, y, -f), shared by every copy of this gun. */
  readonly geometry: THREE.BufferGeometry;
}

const built = new Map<string, readonly AttachmentMesh[]>();

/** The meshes of one attachment on one gun, one per material; empty when the gun cannot take it. */
export function attachmentMeshes(weaponId: string, id: AttachmentId): readonly AttachmentMesh[] {
  const key = `${weaponId}:${id}`;
  let meshes = built.get(key);
  if (!meshes) {
    const mount = WEAPON_MOUNTS[weaponId]?.mounts[id];
    if (!mount) return [];
    const unit = UNITS[id]();
    const scale = mount.scale ?? 1;
    const bySlot = new Map<Slot, THREE.BufferGeometry[]>();
    const add = (slot: Slot, geometry: THREE.BufferGeometry): void => {
      const list = bySlot.get(slot);
      if (list) list.push(geometry); else bySlot.set(slot, [geometry]);
    };
    for (const [slot, geometry] of unit.pieces) add(slot, place(geometry, mount, true));
    if (mount.barrel !== undefined) {
      // A split ring round the bare barrel, with the unit's clamp bolted to it.
      const [f0, f1] = unit.ring;
      const ring = revolve([[f0 * scale, mount.barrel + 0.0042], [f1 * scale, mount.barrel + 0.0042]], { y: mount.barrel, bore: mount.barrel, segments: 16 });
      add('body', place(ring, mount, false));
    }
    meshes = [...bySlot].map(([slot, geometries]) => ({ name: `attachment-${id}-${slot}`, slot, geometry: merge(geometries) }));
    built.set(key, meshes);
  }
  return meshes;
}

/** The middle of an attachment's lens on `weaponId`, gun space; null when the gun cannot take it. */
export function attachmentLens(weaponId: string, id: AttachmentId): P3 | null {
  const mount = WEAPON_MOUNTS[weaponId]?.mounts[id];
  if (!mount) return null;
  const lens = UNITS[id]().lens;
  const point = new THREE.Vector3(lens[0], lens[1], -lens[2]).multiplyScalar(mount.scale ?? 1).applyAxisAngle(new THREE.Vector3(0, 0, 1), sideAngle(mount.side));
  return [point.x + mount.at[0], point.y + mount.at[1], -point.z + mount.at[2]];
}

// --- Materials: the units' own, never a skin's --------------------------------------------------

const TORCH_GLOW = 1.6;
const LASER_GLOW = 2.4;
export const LASER_COLOR = 0xff2f24;

let materials: { shared: Record<Exclude<Slot, 'lens'>, THREE.Material>; torchLens: THREE.MeshStandardMaterial; laserLens: THREE.MeshStandardMaterial } | null = null;

function getMaterials(): NonNullable<typeof materials> {
  materials ??= {
    shared: {
      body: new THREE.MeshStandardMaterial({ name: 'attachment-body', color: 0x1d2023, metalness: 0.6, roughness: 0.48 }),
      trim: new THREE.MeshStandardMaterial({ name: 'attachment-trim', color: 0x444b50, metalness: 0.88, roughness: 0.3 }),
      rubber: new THREE.MeshStandardMaterial({ name: 'attachment-rubber', color: 0x0d0e0f, metalness: 0, roughness: 0.92 }),
      mark: new THREE.MeshStandardMaterial({ name: 'attachment-mark', color: 0xd8a416, metalness: 0, roughness: 0.6 }),
      void: new THREE.MeshBasicMaterial({ name: 'attachment-void', color: 0x030405 }),
    },
    torchLens: new THREE.MeshStandardMaterial({ name: 'attachment-torch-lens', color: 0x1a1a18, emissive: 0xfff1dc, emissiveIntensity: TORCH_GLOW, roughness: 0.2 }),
    laserLens: new THREE.MeshStandardMaterial({ name: 'attachment-laser-lens', color: 0x1a0504, emissive: LASER_COLOR, emissiveIntensity: LASER_GLOW, roughness: 0.2 }),
  };
  return materials;
}

/** The torch lens glows only while the player's torch is on (render/Flashlight.ts). The menus
 * show it lit. */
export function setTorchLensLit(lit: boolean): void {
  getMaterials().torchLens.emissiveIntensity = lit ? TORCH_GLOW : 0;
}

/** Adds `ids` to a weapon model's body group. The meshes are named `attachment-<id>-<slot>`. */
export function addAttachments(body: THREE.Object3D, weaponId: string, ids: readonly AttachmentId[]): void {
  const { shared, torchLens, laserLens } = getMaterials();
  for (const id of sanitizeAttachments(weaponId, ids)) {
    for (const entry of attachmentMeshes(weaponId, id)) {
      const material = entry.slot === 'lens' ? (id === 'torch' ? torchLens : laserLens) : shared[entry.slot];
      const mesh = new THREE.Mesh(entry.geometry, material);
      mesh.name = entry.name;
      body.add(mesh);
    }
  }
}
