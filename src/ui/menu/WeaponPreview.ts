import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { VIEW_MODEL_FOV } from '../../core/config.ts';
import { addClip, GUN_TRACK, inspectTurn, zeroOffset, type Clip, type PartOffset } from '../../weapons/animation/clips.ts';
import { PartAnimator } from '../../weapons/animation/PartAnimator.ts';
import { updateSkinAnimations } from '../../weapons/models/skinMaterials.ts';
import { SKINS, type SkinId } from '../../weapons/models/skins.ts';
import { buildWeaponViewModel, createWeaponModel } from '../../weapons/models/weaponModels.ts';
import { WEAPON_HIP_POSITION } from '../../weapons/viewModel.ts';
import { loadGLTF } from '../../core/AssetLoader.ts';
import { PLAYER_HEIGHT } from '../../core/config.ts';
import { instantiateCharacter, PLAYER_CHARACTER } from '../../entities/characterModels.ts';
import { HeldWeapon } from '../../entities/heldWeapon.ts';

/** How a weapon is shown: on a turntable with no arms, through the player's eyes at the hip and
 * at full aim (drawn with the same lens the match uses for the view model), or in the hand of the
 * player character, as other players see it. */
export type PreviewView = 'display' | 'hip' | 'aim' | 'held';

const DISPLAY_SPIN = 0.45;

/** Draws one weapon in one skin on a canvas of its own: the Skins screen's preview and the aimed
 * view the aim-point screenshots are taken from (docs/skins.md). It owns a small WebGL context,
 * so one instance is shared rather than one per tile. */
export class WeaponPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(VIEW_MODEL_FOV, 1, 0.01, 20);
  private readonly holder = new THREE.Group();
  private readonly environment: THREE.Texture;
  private animator: PartAnimator | null = null;
  /** The weapon's own part moves during an inspect (first-person views only). */
  private ownInspect: Clip | undefined;
  private aimRetract: Readonly<Record<string, number>> = {};
  /** The held view's character: its mixer and the weapon in its hand. Built on first use. */
  private character: { model: THREE.Object3D; mixer: THREE.AnimationMixer; held: HeldWeapon } | null = null;
  private characterLoading = false;
  private view: PreviewView = 'display';
  private skinId: SkinId = 'service';
  private weaponId = '';
  private aimPosition = new THREE.Vector3();
  private frame = 0;
  private running = false;
  private clock = 0;
  private lastTime = 0;
  /** Seconds into an inspect, or -1 when none is playing. */
  private inspectTime = -1;
  /** Spin of the turntable; held still for a screenshot with `freeze`. */
  private spin = 1.15;
  private frozen = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.4;
    this.scene.add(new THREE.HemisphereLight(0xcfe8e4, 0x1a2426, 0.55));
    const key = new THREE.DirectionalLight(0xfff4e2, 1.5);
    key.position.set(-1.2, 2.2, 1.6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6ff0dc, 0.7);
    rim.position.set(1.6, 0.6, -1.4);
    this.scene.add(rim);
    this.scene.add(this.holder);
    this.scene.add(this.camera);
  }

  /** Shows `weaponId` in `skinId`. Rebuilds the model only when either changes. */
  show(weaponId: string, skinId: SkinId, view: PreviewView): void {
    const changed = weaponId !== this.weaponId || skinId !== this.skinId || view !== this.view;
    this.view = view;
    if (view === 'held') {
      this.weaponId = weaponId;
      this.skinId = skinId;
      this.showHeld();
      return;
    }
    if (changed || this.holder.children.length === 0) {
      this.weaponId = weaponId;
      this.skinId = skinId;
      this.holder.clear();
      this.camera.clear();
      this.inspectTime = -1;
      if (view === 'display') {
        const model = createWeaponModel(weaponId, skinId, { raw: true });
        this.animator = new PartAnimator(model.parts, null);
        this.ownInspect = undefined;
        // Centre the model on its own bounds so every weapon turns about its middle.
        const box = new THREE.Box3().setFromObject(model.root);
        const centre = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        model.root.position.sub(centre);
        const pivot = new THREE.Group();
        pivot.add(model.root);
        // Fit the longest side to the width of the picture, or a tall weapon to its height.
        pivot.scale.setScalar(1 / Math.max(size.x, size.z, size.y * 2.1));
        this.holder.add(pivot);
      } else {
        const viewModel = buildWeaponViewModel(weaponId, skinId);
        this.animator = new PartAnimator(viewModel.parts, viewModel.model);
        this.ownInspect = viewModel.animations.inspect;
        this.aimRetract = viewModel.aimRetract;
        this.aimPosition.copy(viewModel.adsPosition);
        this.camera.add(viewModel.group);
      }
    }
    this.pose();
    this.render();
  }

  private pose(): void {
    if (this.view === 'held') {
      this.camera.fov = 30;
      this.camera.position.set(0, 0.25, 4.1);
      this.camera.lookAt(0, 0.05, 0);
      this.holder.rotation.set(0, this.spin, 0);
    } else if (this.view === 'display') {
      this.camera.fov = 30;
      this.camera.position.set(0, 0.12, 1.5);
      this.camera.lookAt(0, 0, 0);
      this.holder.rotation.set(0, this.spin, 0);
    } else {
      this.camera.fov = VIEW_MODEL_FOV;
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      const group = this.camera.children[0];
      if (group) group.position.copy(this.view === 'aim' ? this.aimPosition : WEAPON_HIP_POSITION);
    }
    this.camera.updateProjectionMatrix();
  }

  /** The player character holding the weapon, as other players see it. The character loads once. */
  private showHeld(): void {
    this.camera.clear();
    this.animator = null;
    if (this.character) {
      this.holder.clear();
      this.holder.add(this.character.model);
      this.character.held.set(this.weaponId, this.skinId);
      this.pose();
      this.render();
      return;
    }
    if (this.characterLoading) return;
    this.characterLoading = true;
    void loadGLTF(PLAYER_CHARACTER.path).then((gltf) => {
      const { model, mixer, actions } = instantiateCharacter(gltf, PLAYER_CHARACTER, PLAYER_HEIGHT);
      // Dev only: ?clip=Run_Shoot&at=0.2 poses the character in another clip of the model.
      const params = new URLSearchParams(location.search);
      const named = gltf.animations.find((clip) => clip.name === params.get('clip'));
      if (named) mixer.clipAction(named).play();
      else (actions.aim ?? actions.idle)?.play();
      mixer.update(Number(params.get('at') ?? 0));
      this.character = { model, mixer, held: new HeldWeapon(model) };
      this.characterLoading = false;
      if (this.view === 'held') this.showHeld();
      this.canvas.dataset.held = 'ready';
    });
  }

  /** How far the sight tip is drawn from the middle of the picture, in CSS pixels, in the hip and
   * aimed views; null on the rack, in the hand view and for a weapon without sights. In the aimed
   * view this is the aim-point check made on the real drawn frame: the middle of the picture is
   * where a shot goes (e2e/skins.spec.ts reads it for every weapon and skin). */
  sightOffsetPixels(): number | null {
    if (this.view !== 'hip' && this.view !== 'aim') return null;
    const dot = this.camera.getObjectByName('sight-dot');
    if (!dot) return null;
    this.camera.updateMatrixWorld(true);
    const centre = new THREE.Box3().setFromObject(dot).getCenter(new THREE.Vector3()).project(this.camera);
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    return Math.hypot(centre.x * width / 2, centre.y * height / 2);
  }

  /** Plays the weapon's inspect (its own part moves plus the skin's turn) in the hip view. */
  inspect(): void {
    this.inspectTime = 0;
  }

  /** Stops the turntable at a fixed angle, for screenshots that must match between runs. */
  freeze(spin = 1.15): void {
    this.frozen = true;
    this.spin = spin;
    this.pose();
    this.render();
  }

  resize(): void {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render(): void {
    updateSkinAnimations(this.clock);
    const offsets = new Map<string, PartOffset>();
    if (this.inspectTime >= 0 && this.view !== 'display' && this.weaponId) {
      const turn = inspectTurn(SKINS[this.skinId].inspect);
      addClip(offsets, turn, this.inspectTime);
      addClip(offsets, this.ownInspect, this.inspectTime);
      if (this.inspectTime >= turn.duration) this.inspectTime = -1;
    }
    if (this.view === 'aim') {
      offsets.delete(GUN_TRACK);
      for (const [part, distance] of Object.entries(this.aimRetract)) {
        const offset = offsets.get(part) ?? zeroOffset();
        offset.pf -= distance;
        offsets.set(part, offset);
      }
    }
    this.animator?.apply(offsets);
    this.renderer.render(this.scene, this.camera);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.clock += dt;
      if (this.inspectTime >= 0) this.inspectTime += dt;
      if (this.view === 'held') this.character?.mixer.update(dt);
      if ((this.view === 'display' || this.view === 'held') && !this.frozen) {
        this.spin += dt * DISPLAY_SPIN;
        this.holder.rotation.y = this.spin;
      }
      this.render();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  dispose(): void {
    this.stop();
    this.holder.clear();
    this.camera.clear();
    this.environment.dispose();
    // Free the context slot now rather than at garbage collection (see Renderer.dispose).
    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }
}
