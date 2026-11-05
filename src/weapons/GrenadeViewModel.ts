import * as THREE from 'three';
import { buildGrenadeModel } from '../combat/grenades/grenadeModels.ts';
import type { GrenadeKind } from '../combat/grenades/grenadeTuning.ts';
import { grenadeArmPose } from './grenadeThrowPose.ts';
import { getWeaponMaterials } from './models/weaponMaterials.ts';

type Point = readonly [number, number, number];

/** Where the grenade's centre sits in the hand (arm space: the palm faces up, the fingers curl up
 * round the front, -z, the thumb is on the right, +x, and the forearm hangs down and back). */
const GRENADE_IN_HAND: Point = [0, 0.056, -0.004];
/** The wrist, at the back of the palm, and the way the forearm runs from it toward the elbow. */
const WRIST: Point = [0.004, -0.014, 0.05];
const FOREARM_DIRECTION: Point = [0.05, -0.93, 0.35];
/** Fingers, index to little: across the palm (x), thickness, and how far each curls. */
const FINGERS: readonly { x: number; radius: number; reach: number }[] = [
  { x: 0.026, radius: 0.0096, reach: 1 },
  { x: 0.009, radius: 0.0099, reach: 1.04 },
  { x: -0.008, radius: 0.0094, reach: 1 },
  { x: -0.024, radius: 0.0084, reach: 0.88 },
];
/** Each finger joint's bend once the hand has let go (radians toward the front, the first from
 * straight up off the palm, the others from the segment before): nearly straight, pointing on. */
const FINGER_OPEN = [1.25, -0.2, -0.12] as const;
/** The pulled pin's ring swings on the little finger this far (radians) at this rate. */
const RING_SWING = 0.35;
const RING_SWING_RATE = 7;

/**
 * The throwing arm on the view model: a gloved right hand holding a frag or flash model, a wrist
 * cuff and a sleeve that tapers away off the bottom of the frame, built from primitives in the
 * arsenal's style (weapons/models/arsenal.ts) and lit by its own glove and sleeve materials.
 * Parented to the camera like the guns, so Renderer draws it in the view-model pass with the fixed
 * lens. Posed by grenadeThrowPose.ts from WeaponManager's throwPose and throw progress.
 */
export class GrenadeViewModel {
  private readonly arm = new THREE.Group();
  /** The hand and the grenade, pivoting at the wrist (wristPivot) off the forearm. */
  private readonly wristPivot = new THREE.Group();
  private readonly hand = new THREE.Group();
  private readonly models: Record<GrenadeKind, THREE.Group>;
  /** The pin pulled out of the grenade in hand, hanging by its ring from the little finger. */
  private readonly pin = new THREE.Group();
  /** The fingers' joints, with their bend round the grenade and once open. */
  private readonly fingerJoints: { joint: THREE.Group; grip: number; open: number }[] = [];
  /** The last kind cooked, still shown through its throw after the hand state clears. */
  private kind: GrenadeKind = 'frag';
  private time = 0;
  /** Geometry and materials this class made (the grenade models' and the arsenal's are shared and
   * never disposed). */
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(private readonly camera: THREE.Camera) {
    this.arm.name = 'grenade-arm';
    // The hand's parts are laid out in arm space; the pivot sits at the wrist and the hand group
    // undoes that offset, so turning the pivot bends the hand about the wrist.
    this.wristPivot.name = 'wrist';
    this.wristPivot.position.set(...WRIST);
    this.hand.name = 'hand';
    this.hand.position.set(-WRIST[0], -WRIST[1], -WRIST[2]);
    this.wristPivot.add(this.hand);
    this.arm.add(this.wristPivot);
    this.buildHand();
    this.buildForearm();
    this.models = { frag: buildGrenadeModel('frag'), flash: buildGrenadeModel('flash') };
    for (const model of Object.values(this.models)) {
      model.position.set(...GRENADE_IN_HAND);
      // Fuse up and a little back, spoon toward the thumb, so the top and the spoon show.
      model.rotation.set(0.12, 0.35, -0.08);
      // The pin is out: its ring hangs from the hand instead (this.pin).
      const ring = model.getObjectByName('ring');
      if (ring) ring.visible = false;
      model.visible = false;
      this.hand.add(model);
    }
    this.arm.visible = false;
    camera.add(this.arm);
  }

  /** Per render frame. `throwPose`, `throwProgress`: WeaponManager's; `cookingKind`: the grenade in
   * hand (GrenadeSystem.cooking), or null. */
  update(throwPose: number, throwProgress: number | null, cookingKind: GrenadeKind | null, dt = 0): void {
    if (cookingKind) this.kind = cookingKind;
    const { pose, wrist, visible, holding, open } = grenadeArmPose(throwPose, throwProgress);
    this.arm.visible = visible;
    if (!visible) return;
    this.time += Math.max(0, dt);
    this.arm.position.set(pose.px, pose.py, pose.pz);
    this.arm.rotation.set(pose.rx, pose.ry, pose.rz);
    this.wristPivot.rotation.x = wrist;
    this.models.frag.visible = holding && this.kind === 'frag';
    this.models.flash.visible = holding && this.kind === 'flash';
    this.pin.visible = holding;
    for (const { joint, grip, open: straight } of this.fingerJoints) joint.rotation.x = -(grip + (straight - grip) * open);
    this.pin.rotation.set(Math.sin(this.time * RING_SWING_RATE) * RING_SWING, 0, 0.3 + Math.sin(this.time * RING_SWING_RATE * 0.7) * RING_SWING * 0.5);
  }

  dispose(): void {
    this.camera.remove(this.arm);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  private buildHand(): void {
    const { glove, pipe } = getWeaponMaterials();
    const pad = this.material('grenade-glove-pad', 0xb3a8a3, 0.85, 0);
    const guard = this.material('grenade-glove-guard', 0x303c3f, 0.45, 0.2);
    const hand = this.hand;

    // Palm, heel and the thumb's mound under the grenade; a padded patch where it rests.
    this.box(hand, 'palm', [0.078, 0.026, 0.084], [0.002, -0.008, 0.006], glove);
    this.box(hand, 'palm-pad', [0.06, 0.006, 0.05], [-0.004, 0.006, 0.012], pad);
    this.box(hand, 'heel', [0.068, 0.024, 0.03], [0, -0.012, 0.044], glove, [0.2, 0, 0]);
    this.ball(hand, 'thumb-mound', 0.022, [0.03, -0.002, 0.024], glove, [1, 0.8, 1.2]);
    // The back of the hand (it faces down): a hard knuckle guard and a raised ridge across it.
    this.box(hand, 'knuckle-guard', [0.074, 0.01, 0.046], [0.002, -0.025, -0.006], guard);
    this.box(hand, 'knuckle-ridge', [0.07, 0.008, 0.012], [0.002, -0.031, -0.02], guard);

    // Four fingers, each a chain of three jointed segments curled up round the front of the
    // grenade (the grip), with a guard plate on the first and a padded tip. They open after the
    // release (FINGER_OPEN).
    for (const [index, finger] of FINGERS.entries()) {
      const { x, radius: r, reach } = finger;
      const points: Point[] = [
        [x, 0.002, -0.036],
        [x, 0.03 * reach, -0.059],
        [x, 0.068 * reach, -0.054],
        [x, 0.087 * reach, -0.036],
      ];
      let parent: THREE.Object3D = hand;
      let lean = 0;
      let length = 0;
      for (let s = 0; s < 3; s++) {
        const [, ay, az] = points[s]!;
        const [, by, bz] = points[s + 1]!;
        // How far this segment leans from straight up toward the front (-z), from the last one.
        const absolute = Math.atan2(az - bz, by - ay);
        const joint = new THREE.Group();
        joint.name = `finger-${index}-joint-${s}`;
        if (s === 0) joint.position.set(...points[0]!);
        else joint.position.set(0, length, 0);
        parent.add(joint);
        this.fingerJoints.push({ joint, grip: absolute - lean, open: FINGER_OPEN[s]! });
        joint.rotation.x = lean - absolute;
        lean = absolute;
        length = Math.hypot(by - ay, bz - az);
        this.tube(joint, `finger-${index}-${s}`, [0, 0, 0], [0, length, 0], r * (1 - s * 0.06), r * (1 - (s + 1) * 0.06), glove);
        this.ball(joint, `knuckle-${index}-${s}`, r * (1.08 - s * 0.06), [0, 0, 0], glove);
        if (s === 0) this.box(joint, `finger-guard-${index}`, [r * 1.9, length * 0.55, 0.006], [0, length * 0.5, -r * 0.95], guard);
        parent = joint;
      }
      this.ball(parent, `fingertip-${index}`, r * 0.85, [0, length, 0], pad);
    }

    // The thumb, up the right side and over the top toward the fuse.
    const thumb: Point[] = [[0.034, -0.004, 0.02], [0.054, 0.022, 0.004], [0.054, 0.05, -0.01], [0.04, 0.074, -0.018]];
    for (let s = 0; s < 3; s++) {
      this.tube(hand, `thumb-${s}`, thumb[s]!, thumb[s + 1]!, 0.0125 - s * 0.0012, 0.0115 - s * 0.0012, glove);
      this.ball(hand, `thumb-joint-${s}`, 0.0128 - s * 0.0012, thumb[s]!, glove);
    }
    this.ball(hand, 'thumb-tip', 0.0095, thumb[3]!, pad);

    // The pin: a short split pin hanging from the little finger with the ring on its end.
    this.pin.name = 'pulled-pin';
    this.pin.position.set(-0.043, 0, -0.03);
    this.tube(this.pin, 'pin-wire', [0, 0, 0], [0, -0.03, 0.003], 0.0016, 0.0016, pipe);
    const ring = new THREE.Mesh(this.own(new THREE.TorusGeometry(0.0125, 0.0024, 6, 16)), pipe);
    ring.name = 'pin-ring';
    ring.position.set(0, -0.044, 0.003);
    ring.rotation.y = Math.PI / 2;
    this.pin.add(ring);
    hand.add(this.pin);
  }

  /** Wrist cuff and sleeve in a group whose -Y runs along the forearm from the wrist. */
  private buildForearm(): void {
    const { glove, sleeve, trim } = getWeaponMaterials();
    const strap = this.material('grenade-cuff-strap', 0x1d1e1c, 0.7, 0);
    const hem = this.material('grenade-sleeve-hem', 0x303c3f, 0.95, 0);
    const forearm = new THREE.Group();
    forearm.name = 'forearm';
    forearm.position.set(...WRIST);
    forearm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(...FOREARM_DIRECTION).normalize());
    this.arm.add(forearm);

    // Glove cuff over the wrist with a strap and a hazard tab, like the guns' trim.
    this.tube(forearm, 'cuff', [0, 0.012, 0], [0, -0.06, 0], 0.033, 0.039, glove, 10);
    this.tube(forearm, 'cuff-strap', [0, -0.026, 0], [0, -0.044, 0], 0.0385, 0.0405, strap, 10);
    this.box(forearm, 'cuff-tab', [0.006, 0.022, 0.026], [0.04, -0.035, 0], trim);
    // The sleeve: a hem, then a taper toward the elbow, with a pocket on the outside.
    this.tube(forearm, 'sleeve-hem', [0, -0.05, 0], [0, -0.078, 0], 0.044, 0.046, hem, 10);
    this.tube(forearm, 'sleeve', [0, -0.07, 0], [0, -0.44, 0], 0.043, 0.056, sleeve, 10);
    this.box(forearm, 'sleeve-pocket', [0.012, 0.085, 0.056], [-0.05, -0.18, 0.004], sleeve, [0, 0, -0.06]);
    this.box(forearm, 'sleeve-pocket-flap', [0.014, 0.022, 0.06], [-0.052, -0.13, 0.004], hem, [0, 0, -0.06]);
    for (const y of [-0.24, -0.33]) this.tube(forearm, `sleeve-fold-${y}`, [0, y, 0], [0, y - 0.012, 0], 0.047 - y * 0.024, 0.047 - y * 0.024, hem, 10);
  }

  /** Plain lit materials like the arsenal's glove and sleeve: the same shader, so no new compile. */
  private material(name: string, color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ name, color, roughness, metalness });
    this.materials.push(material);
    return material;
  }

  private own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private box(parent: THREE.Object3D, name: string, size: Point, position: Point, material: THREE.Material, rotation: Point = [0, 0, 0]): THREE.Mesh {
    const mesh = new THREE.Mesh(this.own(new THREE.BoxGeometry(...size)), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    parent.add(mesh);
    return mesh;
  }

  private ball(parent: THREE.Object3D, name: string, radius: number, position: Point, material: THREE.Material, scale: Point = [1, 1, 1]): THREE.Mesh {
    const mesh = new THREE.Mesh(this.own(new THREE.IcosahedronGeometry(radius, 1)), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    parent.add(mesh);
    return mesh;
  }

  /** A tapered cylinder from `a` (radius `ra`) to `b` (radius `rb`). */
  private tube(parent: THREE.Object3D, name: string, a: Point, b: Point, ra: number, rb: number, material: THREE.Material, sides = 7): THREE.Mesh {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const mesh = new THREE.Mesh(this.own(new THREE.CylinderGeometry(rb, ra, direction.length(), sides)), material);
    mesh.name = name;
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    parent.add(mesh);
    return mesh;
  }
}
