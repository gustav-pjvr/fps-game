import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  FOG_COLOR,
  FOG_FAR,
  FOG_NEAR,
  SUN_DIRECTION_X,
  SUN_DIRECTION_Y,
  SUN_DIRECTION_Z,
  TONE_MAPPING_EXPOSURE,
} from './config.ts';
import type { GraphicsQualityPreset } from '../settings/graphicsQuality.ts';

function createSky(): Sky {
  const sky = new Sky();
  sky.scale.setScalar(CAMERA_FAR);

  const uniforms = sky.material.uniforms;
  uniforms.turbidity!.value = 3;
  uniforms.rayleigh!.value = 1.2;
  uniforms.mieCoefficient!.value = 0.004;
  uniforms.mieDirectionalG!.value = 0.8;
  // Same direction as Game's shadow-casting sun (see config.ts) so the sky's bright spot and the
  // direction shadows fall agree with each other.
  (uniforms.sunPosition!.value as THREE.Vector3).set(SUN_DIRECTION_X, SUN_DIRECTION_Y, SUN_DIRECTION_Z);

  return sky;
}

export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  /** Generated once (see the constructor) from the sky alone, regardless of the initial quality
   * tier - the sky's shader uniforms never change at runtime (fixed sun direction), so there's
   * nothing to regenerate later. Toggling environment lighting on/off (applyQuality) just assigns
   * or clears scene.environment against this cached texture, which is instant and leak-free -
   * cheaper and simpler than re-running PMREMGenerator every time the setting changes. */
  private readonly skyEnvironmentTexture: THREE.Texture;

  constructor(container: HTMLElement, quality: GraphicsQualityPreset) {
    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    // This three.js version has deprecated PCFSoftShadowMap - it silently downgrades to
    // PCFShadowMap at render time anyway (with a console warning), so setting it directly avoids
    // the noise for the same actual behavior.
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    // Filmic rolloff instead of the default hard clip to white (VISUAL_REALISM.md §3) - the
    // exposure compensates for ACES reading darker than NoToneMapping at the same light intensities.
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    container.appendChild(this.webgl.domElement);

    this.scene = new THREE.Scene();
    this.scene.add(createSky());
    this.scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

    // Image-based lighting from the sky itself (VISUAL_REALISM.md §5) - without this every
    // MeshStandardMaterial in the game only ever sees the flat AmbientLight fill, so upward and
    // downward-facing surfaces read identically lit. Generated here, while the scene still only
    // contains the sky (nothing else has been added to it yet), matching the standard "Sky + PMREM"
    // recipe from the three.js examples - whether or not it's actually enabled at this exact
    // moment (see applyQuality below and the class comment above).
    const pmremGenerator = new THREE.PMREMGenerator(this.webgl);
    this.skyEnvironmentTexture = pmremGenerator.fromScene(this.scene, 0, CAMERA_NEAR, CAMERA_FAR).texture;
    pmremGenerator.dispose();

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      window.innerWidth / window.innerHeight,
      CAMERA_NEAR,
      CAMERA_FAR,
    );
    // Weapon view models are parented to the camera (camera.add(...)) so they move/rotate with
    // it for free. render(scene, camera) only traverses the scene graph, so without this the
    // camera - and everything attached to it - sits outside that graph and never renders, even
    // though it's used for the view/projection matrices. Scene has no transform of its own, so
    // this doesn't change camera.position's meaning (still equals world position).
    this.scene.add(this.camera);

    this.applyQuality(quality);
    window.addEventListener('resize', this.onResize);
  }

  /** Everything Renderer owns that a Graphics Quality change affects - safe to call at any time,
   * not just construction, so changing the setting mid-match takes effect on the very next frame
   * rather than requiring a fresh match. Gated to High for real GPU hardware (see
   * GraphicsQualityPreset.environmentLighting) - the software-rendered (SwiftShader) e2e sandbox
   * can't afford the per-fragment envmap sample this adds to every PBR surface. */
  applyQuality(quality: GraphicsQualityPreset): void {
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
    this.webgl.shadowMap.enabled = quality.shadowsEnabled;
    this.scene.environment = quality.environmentLighting ? this.skyEnvironmentTexture : null;
    this.scene.environmentIntensity = quality.environmentIntensity;
  }

  get canvas(): HTMLCanvasElement {
    return this.webgl.domElement;
  }

  render(): void {
    this.webgl.render(this.scene, this.camera);
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.skyEnvironmentTexture.dispose();
    this.webgl.dispose();
    this.webgl.domElement.remove();
  }
}
