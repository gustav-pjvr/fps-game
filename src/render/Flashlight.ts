import * as THREE from 'three';
import { EYE_OFFSET, type MatchMap, type MatchWeather } from '../core/config.ts';

export function torchAvailable(map: MatchMap, weather: MatchWeather): boolean {
  return map === 'facility' || weather !== 'day';
}

export function torchOnByDefault(map: MatchMap, weather: MatchWeather): boolean {
  return map === 'facility' || weather === 'night';
}

/** Camera-local spot of the torch at the front of a ranged gun, near its muzzle at the hip pose. */
export const TORCH_GUN_OFFSET = new THREE.Vector3(0.18, -0.16, -0.35);
/** Camera-local spot of the torch on the shoulder, for the knife and empty hands (no gun to carry it). */
export const TORCH_SHOULDER_OFFSET = new THREE.Vector3(0.25, -0.1, 0);
/** The beam points along the view: the aim point is this far ahead of the light. */
export const TORCH_AIM_DISTANCE = 10;
const TORCH_ANGLE = 0.38;
const TORCH_PENUMBRA = 0.55;
const TORCH_RANGE = 32;
const TORCH_DECAY = 2;
const TORCH_COLOR = 0xfff1dc;
/** Candela. With decay 2 a wall 5 m ahead receives 14 / 25 = 0.56 units of irradiance, about a
 * lamp-lit stretch of the bake, so the beam reads as a clear pool in a dark room without blowing
 * out into the bloom up close (100 did, in the first look at it on 2026-10-24). Tuned by eye. */
export const TORCH_INTENSITY = 14;
const TORCH_SHADOW_MAP_SIZE = 512;
const TORCH_SHADOW_BIAS = -0.0004;
const TORCH_SHADOW_NORMAL_BIAS = 0.02;
/** The lens glow while on: just over the bloom threshold, so it reads as lit without a halo. */
const LENS_GLOW = 1.6;

/** Where a torch sits and what it aims at: `offset` is in the frame of an eye at `eye` turned by
 * `orientation` (a camera's own position and quaternion, or a remote player's eye and look), and the
 * aim point is TORCH_AIM_DISTANCE ahead of the light along that frame's forward (-Z). Pure. */
export function torchPose(
  eye: THREE.Vector3,
  orientation: THREE.Quaternion,
  offset: THREE.Vector3,
  outPosition: THREE.Vector3,
  outTarget: THREE.Vector3,
): void {
  outPosition.copy(offset).applyQuaternion(orientation).add(eye);
  outTarget.set(0, 0, -TORCH_AIM_DISTANCE).applyQuaternion(orientation).add(outPosition);
}

function createTorchLight(): THREE.SpotLight {
  const light = new THREE.SpotLight(TORCH_COLOR, TORCH_INTENSITY, TORCH_RANGE, TORCH_ANGLE, TORCH_PENUMBRA, TORCH_DECAY);
  light.name = 'torch';
  // Lights the world only (see Renderer.syncViewModelLayer): from the front of the gun it would
  // light the gun itself at point-blank range and flare it white through the bloom.
  light.userData.worldOnly = true;
  return light;
}

/** What the torch body hangs on: the active ranged view model and its barrel tip in that model's
 * space (WeaponViewModel.muzzleLocalOffset). */
export interface TorchMount {
  readonly viewModel: THREE.Object3D;
  readonly muzzle: THREE.Vector3;
}

/** The player's torch on the Facility and in Valley night or fog. The SpotLight is a
 * top-level scene object placed from the camera every frame, never a camera child: Renderer moves
 * everything under the camera onto the view-model layer, where a light no longer reaches the world.
 * Toggling only changes the intensity (and whether the shadow map updates): adding, removing or
 * hiding a light changes the light count and recompiles every shader. A small torch body with an
 * emissive lens rides on whichever ranged view model is active, near its muzzle. */
export class Flashlight {
  private readonly light = createTorchLight();
  private readonly body = new THREE.Group();
  private readonly bodyGeometry = new THREE.CylinderGeometry(0.017, 0.019, 0.1, 12);
  private readonly lensGeometry = new THREE.CircleGeometry(0.016, 16);
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({ name: 'torch-body', color: 0x26292c, metalness: 0.8, roughness: 0.42 });
  private readonly lensMaterial = new THREE.MeshStandardMaterial({
    name: 'torch-lens',
    color: 0x1a1a18,
    emissive: TORCH_COLOR,
    emissiveIntensity: LENS_GLOW,
    roughness: 0.2,
  });
  private on = true;

  constructor(private readonly scene: THREE.Scene, castShadow: boolean) {
    this.light.shadow.mapSize.set(TORCH_SHADOW_MAP_SIZE, TORCH_SHADOW_MAP_SIZE);
    this.light.shadow.bias = TORCH_SHADOW_BIAS;
    this.light.shadow.normalBias = TORCH_SHADOW_NORMAL_BIAS;
    this.light.shadow.camera.near = 0.2;
    this.light.shadow.camera.far = TORCH_RANGE;
    this.light.castShadow = castShadow;
    scene.add(this.light);

    // Built along -Z (the view models' forward): the cylinder's axis is its local Y.
    const casing = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial);
    casing.rotation.x = Math.PI / 2;
    const lens = new THREE.Mesh(this.lensGeometry, this.lensMaterial);
    lens.position.z = -0.0505;
    lens.rotation.y = Math.PI;
    this.body.add(casing, lens);
    this.body.name = 'torch-body';
  }

  get isOn(): boolean {
    return this.on;
  }

  setOn(on: boolean): void {
    this.on = on;
    this.light.intensity = on ? TORCH_INTENSITY : 0;
    // Same shader either way; an unlit torch just stops redrawing its shadow map. It still draws it
    // once: every lit material samples this light's shadow map, and a torch that starts off (Fog)
    // would otherwise never create one, so WebGL rejects every lit draw call ("Mismatch between
    // texture format and sampler type") and the whole world goes missing.
    this.light.shadow.autoUpdate = on;
    this.light.shadow.needsUpdate = true;
    this.lensMaterial.emissiveIntensity = on ? LENS_GLOW : 0;
  }

  /** Follows the graphics preset like the sun does (Game.applyGraphicsQuality). A change here does
   * recompile, as a sun shadow change does on the Valley; only the toggle must not. */
  setCastShadow(castShadow: boolean): void {
    this.light.castShadow = castShadow;
  }

  /** Hangs the torch body under the active ranged view model, a little below and behind the barrel
   * tip, or takes it off for the knife and empty hands (`mount` null). Cheap when nothing changed. */
  mountBody(mount: TorchMount | null): void {
    if (!mount) {
      if (this.body.parent) this.body.removeFromParent();
      return;
    }
    if (this.body.parent !== mount.viewModel) mount.viewModel.add(this.body);
    this.body.position.set(mount.muzzle.x, mount.muzzle.y - 0.045, mount.muzzle.z + 0.09);
  }

  /** Every rendered frame, after the camera's interpolation: at the front of the gun when one is
   * held, at the shoulder otherwise, aimed along the camera's forward. */
  update(camera: THREE.Camera, gunMounted: boolean): void {
    torchPose(camera.position, camera.quaternion, gunMounted ? TORCH_GUN_OFFSET : TORCH_SHOULDER_OFFSET, this.light.position, this.light.target.position);
    // The target is not in the scene, so the renderer never updates its matrix itself.
    this.light.target.updateMatrixWorld();
  }

  dispose(): void {
    this.scene.remove(this.light);
    this.light.shadow.map?.dispose();
    this.light.dispose();
    this.body.removeFromParent();
    this.bodyGeometry.dispose();
    this.lensGeometry.dispose();
    this.bodyMaterial.dispose();
    this.lensMaterial.dispose();
  }
}

/** One other player's torch, as RemoteTorches needs it: the body position (the snapshot's
 * position, the capsule centre), their look, and whether the torch is lit. */
export interface RemoteTorchSource {
  readonly position: THREE.Vector3;
  readonly yaw: number;
  readonly pitch: number;
  readonly on: boolean;
}

/** Other players' torches: a fixed pool of shadowless spotlights created at match
 * start, so the light count (and with it every shader) never changes mid-match. Each frame the
 * first sources take the first lights; a light with no source, an unlit torch or a dead player
 * just goes to intensity 0. */
export class RemoteTorches {
  private readonly lights: THREE.SpotLight[] = [];
  private readonly eye = new THREE.Vector3();
  private readonly look = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(private readonly scene: THREE.Scene, count: number) {
    for (let i = 0; i < count; i++) {
      const light = createTorchLight();
      light.intensity = 0;
      this.lights.push(light);
      scene.add(light);
    }
  }

  update(sources: readonly RemoteTorchSource[]): void {
    this.lights.forEach((light, index) => {
      const source = sources[index];
      if (!source || !source.on) {
        light.intensity = 0;
        return;
      }
      light.intensity = TORCH_INTENSITY;
      this.eye.copy(source.position);
      this.eye.y += EYE_OFFSET;
      // The same look Player builds its camera from: Euler(pitch, yaw, 0, 'YXZ').
      this.look.setFromEuler(this.euler.set(source.pitch, source.yaw, 0, 'YXZ'));
      torchPose(this.eye, this.look, TORCH_GUN_OFFSET, light.position, light.target.position);
      light.target.updateMatrixWorld();
    });
  }

  dispose(): void {
    for (const light of this.lights) {
      this.scene.remove(light);
      light.dispose();
    }
    this.lights.length = 0;
  }
}
