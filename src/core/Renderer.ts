import * as THREE from 'three';
import { CAMERA_FAR, CAMERA_NEAR, type MatchWeather } from './config.ts';
import type { GraphicsQualityPreset } from '../settings/graphicsQuality.ts';
import { Settings } from '../settings/Settings.ts';
import { lookFor, type LookPreset } from '../render/look.ts';
import { installLookFog, StylizedSky } from '../render/StylizedSky.ts';
import { PostStack } from '../render/PostStack.ts';
import { setWeaponEnvironment } from '../weapons/models/weaponMaterials.ts';
import { setWindowGlow } from '../render/materialGrade.ts';

/** Layer the weapon view models (everything parented to the camera) render on, so the post stack
 * can draw them in their own depth-cleared pass (see PostStack). */
export const VIEW_MODEL_LAYER = 1;

export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Copies `camera` every frame but sees only VIEW_MODEL_LAYER. */
  private readonly viewModelCamera = new THREE.PerspectiveCamera();

  /** The stylised dusk sky (render/StylizedSky.ts). It is also the source of scene.environment on
   * High, regenerated whenever the look changes (setMatchWeather). */
  private readonly sky: StylizedSky;
  private skyEnvironmentTexture: THREE.Texture | null = null;
  private look: LookPreset = lookFor('day');
  private quality: GraphicsQualityPreset;
  private post: PostStack | null = null;

  constructor(container: HTMLElement, quality: GraphicsQualityPreset) {
    this.quality = quality;
    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    // This three.js version has deprecated PCFSoftShadowMap - it silently downgrades to
    // PCFShadowMap at render time anyway (with a console warning), so setting it directly avoids
    // the noise for the same actual behavior.
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    // The composer renders through several passes per frame, so the per-frame counters the perf
    // logger reads are reset by render() itself instead of by every internal render call.
    this.webgl.info.autoReset = false;
    container.appendChild(this.webgl.domElement);

    this.scene = new THREE.Scene();
    this.sky = new StylizedSky(this.look);
    this.scene.add(this.sky);

    // The user's own saved FOV (see settings/Settings.ts), not the bare CAMERA_FOV default -
    // WeaponManager.updateAim re-derives this same value every frame once gameplay starts (so a
    // mid-match settings change applies live), but this is what a fresh match's very first
    // rendered frame - before update() has run even once - actually shows.
    this.camera = new THREE.PerspectiveCamera(Settings.getFov(), window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR);
    // Weapon view models are parented to the camera (camera.add(...)) so they move/rotate with
    // it for free. render(scene, camera) only traverses the scene graph, so without this the
    // camera - and everything attached to it - sits outside that graph and never renders, even
    // though it's used for the view/projection matrices. Scene has no transform of its own, so
    // this doesn't change camera.position's meaning (still equals world position).
    this.scene.add(this.camera);

    this.applyLook(this.look);
    this.applyQuality(quality);
    window.addEventListener('resize', this.onResize);
  }

  /** Everything Renderer owns that a Graphics Quality change affects - safe to call at any time,
   * not just construction, so changing the setting mid-match takes effect on the very next frame
   * rather than requiring a fresh match. Image-based lighting and the post stack are gated by the
   * preset (see GraphicsQualityPreset): the software-rendered (SwiftShader) e2e sandbox can't
   * afford them at the cost real GPUs pay. */
  applyQuality(quality: GraphicsQualityPreset): void {
    this.quality = quality;
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
    this.webgl.shadowMap.enabled = quality.shadowsEnabled;
    this.scene.environment = quality.environmentLighting ? this.skyEnvironmentTexture : null;
    this.scene.environmentIntensity = this.look.environmentIntensity;
    this.rebuildPostStack();
  }

  /** Applies the host-chosen (or single-player default 'day') match weather - see MatchWeather in
   * config.ts. Called once, right after construction, at match setup, before anything compiles;
   * not a live-toggleable setting like graphics quality. Game.ts separately sets the sun and fill
   * lights from the same look (render/look.ts) since it owns those objects. */
  setMatchWeather(weather: MatchWeather): void {
    this.applyLook(lookFor(weather));
    this.applyQuality(this.quality);
  }

  get currentLook(): LookPreset {
    return this.look;
  }

  private applyLook(look: LookPreset): void {
    this.look = look;
    installLookFog(look);
    this.sky.applyLook(look);
    this.scene.fog = new THREE.Fog(look.sky.haze, look.fog.near, look.fog.far);
    this.webgl.toneMappingExposure = look.exposure;
    setWindowGlow(look.windowGlow);

    // Image-based lighting from the sky itself, rendered from a scene holding only a copy of the
    // sky so nothing already added to the match scene leaks into the environment.
    const envScene = new THREE.Scene();
    const envSky = new StylizedSky(look);
    envScene.add(envSky);
    const pmremGenerator = new THREE.PMREMGenerator(this.webgl);
    this.skyEnvironmentTexture?.dispose();
    this.skyEnvironmentTexture = pmremGenerator.fromScene(envScene, 0, CAMERA_NEAR, CAMERA_FAR).texture;
    pmremGenerator.dispose();
    setWeaponEnvironment(this.skyEnvironmentTexture);
    envSky.geometry.dispose();
    envSky.material.dispose();
    this.post?.applyLook(look);
  }

  private rebuildPostStack(): void {
    const wantsPost = this.quality.postProcessing;
    const wantsAo = this.quality.ambientOcclusion;
    if (this.post && wantsPost && this.post.ambientOcclusion === wantsAo) return;
    this.post?.dispose();
    this.post = null;
    // Low renders straight to the screen, so three applies ACES itself; with the composer the grade
    // pass owns tone mapping (see PostStack's GradeEffect).
    this.webgl.toneMapping = wantsPost ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    // Without the composer the view model shares the world pass.
    if (wantsPost) this.camera.layers.disable(VIEW_MODEL_LAYER);
    else this.camera.layers.enable(VIEW_MODEL_LAYER);
    if (!wantsPost) return;
    this.post = new PostStack(this.webgl, this.scene, this.camera, this.viewModelCamera, this.look, { ambientOcclusion: wantsAo });
    this.post.setSize(window.innerWidth, window.innerHeight);
  }

  get canvas(): HTMLCanvasElement {
    return this.webgl.domElement;
  }

  render(): void {
    this.webgl.info.reset();
    this.sky.follow(this.camera);
    if (!this.post) {
      this.webgl.render(this.scene, this.camera);
      return;
    }
    this.syncViewModelLayer();
    this.post.render();
  }

  /** Puts everything parented to the camera on the view-model layer and lets every top-level light
   * reach that layer too (three filters lights by camera layers as well), then mirrors the main
   * camera. Cheap: the camera has a handful of children and the scene's top level is small. */
  private syncViewModelLayer(): void {
    for (const child of this.camera.children) child.traverse(setViewModelLayer);
    for (const child of this.scene.children) {
      if ((child as THREE.Light).isLight) child.layers.enable(VIEW_MODEL_LAYER);
    }
    this.viewModelCamera.copy(this.camera, false);
    this.viewModelCamera.layers.set(VIEW_MODEL_LAYER);
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    this.post?.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.post?.dispose();
    setWeaponEnvironment(null);
    this.skyEnvironmentTexture?.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    // three's WebGLRenderer.dispose() frees its own caches but never releases the context itself,
    // which then lingers until the canvas is garbage collected - and every lobby/match cycle opens
    // fresh contexts, so repeated cycles creep toward Chrome's ~16 live-context cap, past which it
    // silently kills the oldest one and a canvas goes blank. Losing it explicitly frees the slot
    // right now. Always after the last render: Game.dispose stops the loop before calling this.
    this.webgl.forceContextLoss();
    this.webgl.dispose();
    this.webgl.domElement.remove();
  }
}

function setViewModelLayer(object: THREE.Object3D): void {
  object.layers.set(VIEW_MODEL_LAYER);
}
