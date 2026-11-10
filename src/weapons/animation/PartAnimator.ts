import * as THREE from 'three';
import { GUN_TRACK, type PartOffset } from './clips.ts';

interface Rest {
  readonly object: THREE.Object3D;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

const euler = new THREE.Euler();
const turn = new THREE.Quaternion();

/** Applies sampled clip offsets (animation/clips.ts) to a weapon model's parts, always from their
 * rest pose, so clips never drift and a part no clip names returns to rest by itself. */
export class PartAnimator {
  private readonly rest = new Map<string, Rest>();

  /** `parts` are the model's named parts; `model` is the whole model, moved by the `gun` track. */
  constructor(parts: ReadonlyMap<string, THREE.Object3D>, model: THREE.Object3D | null) {
    for (const [name, object] of parts) this.remember(name, object);
    if (model) this.remember(GUN_TRACK, model);
  }

  private remember(name: string, object: THREE.Object3D): void {
    this.rest.set(name, { object, position: object.position.clone(), quaternion: object.quaternion.clone() });
  }

  /** Poses every part: rest plus its offset, or rest alone when `offsets` has no entry for it.
   * Offsets are gun space (x right, y up, f forward; pitch, yaw, roll). */
  apply(offsets: ReadonlyMap<string, PartOffset>): void {
    for (const [name, rest] of this.rest) {
      const offset = offsets.get(name);
      if (!offset) {
        rest.object.position.copy(rest.position);
        rest.object.quaternion.copy(rest.quaternion);
        continue;
      }
      // Forward is three's -z: pitch keeps its sign, yaw and roll flip (as in kit/geometry.ts box).
      rest.object.position.set(rest.position.x + offset.px, rest.position.y + offset.py, rest.position.z - offset.pf);
      euler.set(offset.pitch, -offset.yaw, -offset.roll, 'YXZ');
      rest.object.quaternion.copy(rest.quaternion).multiply(turn.setFromEuler(euler));
    }
  }
}
