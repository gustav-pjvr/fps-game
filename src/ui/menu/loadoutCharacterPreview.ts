import { INK, ACCENT } from '../theme.ts';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGLTF } from '../../core/AssetLoader.ts';
import { ENEMY_MODEL_PATH } from '../../entities/enemies/Enemy.ts';
import { PLAYER_HEIGHT } from '../../core/config.ts';

/** Slow, continuous turntable spin - fast enough to read as alive, slow enough not to distract
 * from actually picking a loadout. */
const ROTATION_RADIANS_PER_SECOND = 0.5;

/** Same scale-to-real-world-height math RemotePlayer.ts already uses for this exact model (its own
 * `MODEL_BIND_HEIGHT` comment explains the raw export's bind-pose height) - keeps this preview's
 * proportions consistent with how the character actually looks in-match rather than whatever tiny
 * scale the .glb happens to export at. */
const MODEL_BIND_HEIGHT = 0.671;
const MODEL_SCALE = PLAYER_HEIGHT / MODEL_BIND_HEIGHT;

/** The Loadout page's rotating character, standing inside the slotted rim (see LoadoutScreen.ts).
 * Unlike weaponThumbnail.ts's deliberate one-shot render, this keeps its own WebGL context and
 * requestAnimationFrame loop alive once the page has been opened - a live turntable, not a static
 * image. The context itself is only created on the first `start()` (the page's first show), not
 * at construction: Game.ts builds a LoadoutScreen every match and most are never opened, so an
 * eager context here was one more live context per match for nothing (see weaponThumbnail.ts's
 * sharedRenderer comment on Chrome's ~16-context cap). Reuses the same Kenney "Mini Characters"
 * model and idle-animation lookup RemotePlayer.ts already uses for opponents (the only downloaded
 * character skin this project has) - no in-hand weapon attachment (no bone-attachment precedent
 * exists anywhere in this codebase; equipped weapons are instead shown via the slot sockets' own
 * icons, a deliberate scope decision made when this was planned). */
export class LoadoutCharacterPreview {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly turntable: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private rafHandle: number | null = null;
  private lastFrameMs: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%; height:100%; display:block;';
    root.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(INK, 0.65));
    const key = new THREE.DirectionalLight(INK, 1.3);
    key.position.set(1.5, 2.5, 2.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(ACCENT, 0.4);
    rim.position.set(-2, 1, -1.5);
    this.scene.add(rim);

    // Pulled back 3.6 -> 4.5 (2026-07-17, live feedback): at 3.6 the character overflowed the
    // rim's edges (head/arms clipped by the canvas bounds). Framing is fixed by camera distance,
    // not model scale, so the idle animation's proportions/amplitude stay identical to in-match.
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, 0.15, 4.5);
    this.camera.lookAt(0, 0.05, 0);

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);

    this.resizeObserver = new ResizeObserver(() => this.syncSizeToContainer());
    this.resizeObserver.observe(root);
    this.syncSizeToContainer();

    void this.loadModel();
  }

  private async loadModel(): Promise<void> {
    const gltf = await loadGLTF(ENEMY_MODEL_PATH);
    const model = cloneSkeleton(gltf.scene) as THREE.Group;
    model.scale.setScalar(MODEL_SCALE);
    model.position.y = -PLAYER_HEIGHT / 2; // model origin is at its feet; group origin is capsule-center
    this.turntable.add(model);

    const mixer = new THREE.AnimationMixer(model);
    const idleClip = gltf.animations.find((clip) => clip.name === 'idle');
    if (idleClip) mixer.clipAction(idleClip).play();
    this.mixer = mixer;
  }

  /** Camera aspect always tracks the container; the drawing buffer only once a renderer exists
   * (ensureRenderer re-runs this right after creating one, so it never starts at a stale size). */
  private syncSizeToContainer(): void {
    const width = Math.max(1, this.root.clientWidth);
    const height = Math.max(1, this.root.clientHeight);
    this.renderer?.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Lazily creates the WebGL context on first use - see the class comment. */
  private ensureRenderer(): THREE.WebGLRenderer {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.syncSizeToContainer();
    }
    return this.renderer;
  }

  /** Starts (or resumes) the render loop - a no-op if already running, so repeated `show()` calls
   * on the same LoadoutScreen instance don't stack multiple loops. */
  start(): void {
    if (this.rafHandle !== null) return;
    const renderer = this.ensureRenderer();
    this.lastFrameMs = null;
    const tick = (nowMs: number): void => {
      const lastMs = this.lastFrameMs;
      this.lastFrameMs = nowMs;
      const dt = lastMs === null ? 0 : Math.min(0.1, (nowMs - lastMs) / 1000);
      this.mixer?.update(dt);
      this.turntable.rotation.y += ROTATION_RADIANS_PER_SECOND * dt;
      renderer.render(this.scene, this.camera);
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  /** Pauses the render loop without tearing down the loaded model/GL context - reopening the
   * Loadout page is then free (no reload, no GPU re-upload). */
  stop(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.renderer) {
      // After the last frame (the loop was just stopped above); explicit context loss before
      // dispose() so the context slot is freed now, not whenever the canvas is garbage collected.
      this.renderer.forceContextLoss();
      this.renderer.dispose();
      this.renderer = null;
    }
    this.canvas.remove();
  }
}
