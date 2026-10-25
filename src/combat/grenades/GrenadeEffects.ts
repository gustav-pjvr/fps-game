import type * as THREE from 'three';
import { GrenadeViewModel } from '../../weapons/GrenadeViewModel.ts';
import type { GrenadeSystem } from './GrenadeSystem.ts';

/** What the effects read from the weapon side each frame (WeaponManager). */
export interface GrenadeWeaponPose {
  readonly throwPose: number;
  readonly throwProgress: number | null;
}

export interface GrenadeEffectsOptions {
  readonly system: GrenadeSystem;
  readonly camera: THREE.PerspectiveCamera;
}

/**
 * Everything the local player sees of the grenades beyond the grenades themselves (docs/grenades.md):
 * the throwing arm on the view model. One object so Game wires it with one line in create(), one
 * per render frame and one in dispose.
 */
export class GrenadeEffects {
  private readonly viewModel: GrenadeViewModel | null;

  constructor(private readonly options: GrenadeEffectsOptions) {
    this.viewModel = options.system.enabled ? new GrenadeViewModel(options.camera) : null;
  }

  /** Per render frame, after the camera is placed. */
  update(_dt: number, weapon: GrenadeWeaponPose): void {
    const system = this.options.system;
    this.viewModel?.update(weapon.throwPose, weapon.throwProgress, system.cooking?.kind ?? null);
  }

  dispose(): void {
    this.viewModel?.dispose();
  }
}
