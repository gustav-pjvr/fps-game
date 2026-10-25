import type * as THREE from 'three';
import { FragExplosion } from './FragExplosion.ts';
import { GrenadeArcPreview } from './GrenadeArcPreview.ts';
import { GrenadeDangerMarkers } from '../../ui/grenadeDangerMarkers.ts';
import type { Hud } from '../../ui/hud.ts';
import { FlashOverlay } from '../../ui/flashOverlay.ts';
import type { SoundEngine } from '../../audio/SoundEngine.ts';
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
  readonly sound: SoundEngine;
}

/**
 * Everything the local player sees of the grenades beyond the grenades themselves (docs/grenades.md):
 * the throwing arm on the view model, the arc preview while cooking, the HUD counts, the danger
 * marker, a frag's explosion (FragExplosion, from the system's detonation listener), and a flash's
 * white-out with its afterimage, muffle and ring. One object so Game wires it with one line in
 * create(), one per render frame and one in dispose.
 */
export class GrenadeEffects {
  private readonly viewModel: GrenadeViewModel | null;
  private readonly arc: GrenadeArcPreview | null;
  private readonly danger: GrenadeDangerMarkers | null;
  private readonly flash: FlashOverlay | null;
  private readonly fragExplosion: FragExplosion | null;
  private readonly stopListening: () => void;
  private lastBlindLevel = 0;
  /** A flash just hit: freeze the next rendered frame as the afterimage. */
  private captureAfterimage = false;

  constructor(private readonly options: GrenadeEffectsOptions) {
    const enabled = options.system.enabled;
    this.viewModel = enabled ? new GrenadeViewModel(options.camera) : null;
    this.arc = enabled ? new GrenadeArcPreview(options.scene) : null;
    this.danger = enabled ? new GrenadeDangerMarkers(options.hudRoot) : null;
    this.flash = enabled ? new FlashOverlay(options.hudRoot) : null;
    const fragExplosion = enabled ? new FragExplosion(options.scene) : null;
    this.fragExplosion = fragExplosion;
    this.stopListening = options.system.addDetonationListener((detonation) => {
      if (detonation.kind === 'frag') fragExplosion?.spawn(detonation.position, detonation.surface);
    });
  }

  /** Per render frame, after the camera is placed. */
  update(dt: number, weapon: GrenadeWeaponPose): void {
    const system = this.options.system;
    if (!system.enabled) {
      this.options.hud.setGrenades(null);
      return;
    }
    this.viewModel?.update(weapon.throwPose, weapon.throwProgress, system.cooking?.kind ?? null, dt);
    this.fragExplosion?.update(dt, this.options.camera);
    this.arc?.update(system.arcPreview);
    this.options.hud.setGrenades({ kind: system.kind, count: system.count });
    this.danger?.update(this.options.camera, system.liveGrenades());
    const blind = system.blindLevel;
    if (blind > this.lastBlindLevel + 0.05) this.captureAfterimage = true;
    this.lastBlindLevel = blind;
    this.flash?.update(dt, blind);
    this.options.sound.setFlashDeafness(blind);
  }

  /** A single-player Restart: every frag's smoke, debris and scorch gone at once. */
  resetMatch(): void {
    this.fragExplosion?.clear();
  }

  /** Straight after the frame rendered (the canvas still holds it): takes the afterimage. */
  afterRender(canvas: HTMLCanvasElement): void {
    if (!this.captureAfterimage) return;
    this.captureAfterimage = false;
    this.flash?.capture(canvas);
  }

  dispose(): void {
    this.stopListening();
    this.fragExplosion?.dispose();
    this.viewModel?.dispose();
    this.arc?.dispose();
    this.danger?.dispose();
    this.flash?.dispose();
    this.options.sound.setFlashDeafness(0);
  }
}
