import type * as THREE from 'three';
import { GrenadeArcPreview } from './GrenadeArcPreview.ts';
import { GrenadeDangerMarkers } from '../../ui/grenadeDangerMarkers.ts';
import type { Hud } from '../../ui/hud.ts';
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
  readonly scene: THREE.Scene;
  readonly hud: Hud;
  readonly hudRoot: HTMLElement;
}

/**
 * Everything the local player sees of the grenades beyond the grenades themselves (docs/grenades.md):
 * the throwing arm on the view model, the arc preview while cooking, the HUD counts and the danger
 * marker. One object so Game wires it with one line in create(), one
 * per render frame and one in dispose.
 */
export class GrenadeEffects {
  private readonly viewModel: GrenadeViewModel | null;
  private readonly arc: GrenadeArcPreview | null;
  private readonly danger: GrenadeDangerMarkers | null;

  constructor(private readonly options: GrenadeEffectsOptions) {
    const enabled = options.system.enabled;
    this.viewModel = enabled ? new GrenadeViewModel(options.camera) : null;
    this.arc = enabled ? new GrenadeArcPreview(options.scene) : null;
    this.danger = enabled ? new GrenadeDangerMarkers(options.hudRoot) : null;
  }

  /** Per render frame, after the camera is placed. */
  update(_dt: number, weapon: GrenadeWeaponPose): void {
    const system = this.options.system;
    this.viewModel?.update(weapon.throwPose, weapon.throwProgress, system.cooking?.kind ?? null);
    this.arc?.update(system.arcPreview);
    this.options.hud.setGrenades(system.enabled ? { frag: system.count('frag'), flash: system.count('flash') } : null);
    this.danger?.update(this.options.camera, system.liveGrenades());
  }

  dispose(): void {
    this.viewModel?.dispose();
    this.arc?.dispose();
    this.danger?.dispose();
  }
}
