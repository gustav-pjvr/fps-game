import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { VIEW_MODEL_FOV } from '../../core/config.ts';
import { addClip, defaultMagazineReload, GUN_TRACK, inspectTurn, zeroOffset, type Clip, type PartOffset } from '../../weapons/animation/clips.ts';
import { PartAnimator } from '../../weapons/animation/PartAnimator.ts';
import { setTorchLensLit, type AttachmentId } from '../../weapons/models/attachments.ts';
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

const DISPLAY_SPIN = 0.3;
/** The angle the rack view opens on, and the limits of the hand's turn and zoom. */
const REST_YAW = 1.15;
const REST_PITCH = 0.12;
const PITCH_LIMIT = 1.25;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.6;
/** Radians a pixel of drag turns the weapon. */
const DRAG_TURN = 0.0085;
/** After a drag the weapon rests this long before it starts turning by itself again. */
const IDLE_BEFORE_SPIN = 5;

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
  /** The weapon's reload, and how far through it the first-person views are posed (null: not). */
  private reloadClip: Clip | undefined;
  private reloadAt: number | null = null;
  /** The held view's character: its mixer and the weapon in its hand. Built on first use. */
  private character: { model: THREE.Object3D; mixer: THREE.AnimationMixer; held: HeldWeapon } | null = null;
  private characterLoading = false;
  private view: PreviewView = 'display';
  private skinId: SkinId = 'service';
  private weaponId = '';
  private attachmentKey = '';
  /** The rack view under the hand: tilt, zoom, the glide left over from a drag, the turn being
   * eased to (turnTo), and how long since the player last touched it. */
  private pitch = REST_PITCH;
  private zoom = 1;
  private spinVelocity = 0;
  private pitchVelocity = 0;
  private target: { yaw: number; pitch: number } | null = null;
  private idle = 0;
  private held = false;
  private autoSpin = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** The rack model's half sizes after its fit scale, and the camera distance being eased to. */
  private readonly displayHalf = new THREE.Vector3(0.5, 0.2, 0.05);
  private fitDistance = 0;
  private aimPosition = new THREE.Vector3();
  private frame = 0;
  private running = false;
  private clock = 0;
  private lastTime = 0;
  /** Seconds into an inspect, or -1 when none is playing. */
  private inspectTime = -1;
  /** Spin of the turntable; held still for a screenshot with `freeze`. */
  private spin = REST_YAW;
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

  /** Shows `weaponId` in `skinId` with `attachments` fitted. Rebuilds the model only when one of
   * them or the view changes. */
  show(weaponId: string, skinId: SkinId, view: PreviewView, attachments: readonly AttachmentId[] = []): void {
    const attachmentKey = attachments.join('+');
    const changed = weaponId !== this.weaponId || skinId !== this.skinId || view !== this.view || attachmentKey !== this.attachmentKey;
    // A different weapon starts square to the eye and at full size again; a new skin or a fitted
    // unit keeps the angle the player was looking from.
    if (weaponId !== this.weaponId) this.resetOrbit(false);
    this.view = view;
    this.attachmentKey = attachmentKey;
    // The menus show a fitted torch lit.
    setTorchLensLit(true);
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
        const model = createWeaponModel(weaponId, skinId, { raw: true, attachments });
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
        const scale = 1 / Math.max(size.x, size.z, size.y * 2.1);
        pivot.scale.setScalar(scale);
        this.holder.add(pivot);
        this.displayHalf.copy(size).multiplyScalar(scale / 2);
        this.fitDistance = 0;
      } else {
        const viewModel = buildWeaponViewModel(weaponId, skinId, attachments);
        this.animator = new PartAnimator(viewModel.parts, viewModel.model);
        this.ownInspect = viewModel.animations.inspect;
        this.reloadClip = viewModel.animations.reload ?? (viewModel.parts.has('magazine') ? defaultMagazineReload() : undefined);
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
      // Far enough back that the weapon's length takes about seven tenths of the picture's
      // width, and its height never more than two thirds of the picture's: a wide stage comes
      // closer, a phone's tall one steps back.
      // Turned about its own upright, then tipped toward or away from the eye.
      this.holder.rotation.set(this.pitch, this.spin, 0, 'XYZ');
      // How wide and how tall the turned weapon is on screen (its box's half sizes along the
      // screen's axes), and the distance at which that takes seven tenths of the picture's width
      // and no more than three quarters of its height: tipped up on end it steps back instead of
      // running off the stage. Eased, so the camera never jumps as the weapon turns.
      this.holder.updateMatrix();
      const e = this.holder.matrix.elements, h = this.displayHalf;
      const across = Math.abs(e[0]!) * h.x + Math.abs(e[4]!) * h.y + Math.abs(e[8]!) * h.z;
      const up = Math.abs(e[1]!) * h.x + Math.abs(e[5]!) * h.y + Math.abs(e[9]!) * h.z;
      const tan = Math.tan((30 * Math.PI) / 360);
      const wanted = Math.max(across / (0.7 * tan * this.camera.aspect), up / (0.75 * tan), 0.9);
      this.fitDistance = this.fitDistance === 0 || this.frozen ? wanted : this.fitDistance + (wanted - this.fitDistance) * 0.18;
      const distance = this.fitDistance / this.zoom;
      this.camera.position.set(0, 0.08 * distance, distance);
      this.camera.lookAt(0, 0, 0);
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

  /** A drag on the rack view: `dx`, `dy` in CSS pixels. The weapon follows the hand and, with
   * `glide`, keeps a little of the last move once it lets go (a key press turns it by its step
   * and no more). */
  orbit(dx: number, dy: number, glide = true): void {
    if (this.view !== 'display') return;
    this.target = null;
    this.idle = 0;
    this.spin += dx * DRAG_TURN;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + dy * DRAG_TURN));
    this.spinVelocity = glide ? dx * DRAG_TURN * 60 : 0;
    this.pitchVelocity = glide ? dy * DRAG_TURN * 60 : 0;
    this.pose();
    this.render();
  }

  /** True while a pointer holds the weapon: it neither glides nor turns by itself. */
  setHeld(held: boolean): void {
    this.held = held;
    this.idle = 0;
    if (held) this.spinVelocity = this.pitchVelocity = 0;
  }

  /** Zooms the rack view by `factor` (above 1 comes closer). */
  zoomBy(factor: number): void {
    if (this.view !== 'display') return;
    this.idle = 0;
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * factor));
    this.pose();
    this.render();
  }

  /** Eases the rack view round to `yaw` and `pitch` (the short way), for showing a fitted unit. */
  turnTo(yaw: number, pitch: number): void {
    const turns = Math.round((this.spin - yaw) / (Math.PI * 2));
    this.target = { yaw: yaw + turns * Math.PI * 2, pitch };
    this.spinVelocity = this.pitchVelocity = 0;
    this.idle = 0;
  }

  /** Back to the opening angle and size. `ease` glides there; otherwise it is set at once. */
  resetOrbit(ease = true): void {
    this.zoom = 1;
    this.spinVelocity = this.pitchVelocity = 0;
    this.idle = 0;
    if (ease) {
      this.turnTo(REST_YAW, REST_PITCH);
    } else {
      this.target = null;
      this.spin = REST_YAW;
      this.pitch = REST_PITCH;
    }
    this.pose();
  }

  /** One frame of the rack view's own motion: the eased turn, the glide after a drag, and the slow
   * turn it falls back to when left alone. */
  private stepOrbit(dt: number): void {
    if (this.held) return;
    if (this.target) {
      const blend = 1 - Math.exp(-dt * 7);
      this.spin += (this.target.yaw - this.spin) * blend;
      this.pitch += (this.target.pitch - this.pitch) * blend;
      if (Math.abs(this.target.yaw - this.spin) < 0.002 && Math.abs(this.target.pitch - this.pitch) < 0.002) this.target = null;
      return;
    }
    const decay = Math.exp(-dt * 4.5);
    this.spinVelocity *= decay;
    this.pitchVelocity *= decay;
    this.spin += this.spinVelocity * dt;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + this.pitchVelocity * dt));
    this.idle += dt;
    if (this.autoSpin && this.idle > IDLE_BEFORE_SPIN) this.spin += dt * DISPLAY_SPIN * Math.min(1, (this.idle - IDLE_BEFORE_SPIN) / 1.5);
  }

  /** Plays the weapon's inspect (its own part moves plus the skin's turn) in the hip view. */
  inspect(): void {
    this.inspectTime = 0;
  }

  /** Poses the in-hand view `progress` (0 to 1) of the way through the weapon's reload, for judging
   * it frame by frame (the weapon lab); null goes back to the rest pose. */
  poseReload(progress: number | null): void {
    this.reloadAt = progress;
    this.render();
  }

  /** Stops the turntable at a fixed angle, for screenshots that must match between runs. */
  freeze(spin = REST_YAW, pitch = 0, zoom = 1): void {
    this.frozen = true;
    this.target = null;
    this.spin = spin;
    this.pitch = pitch;
    this.zoom = zoom;
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
    if (this.reloadAt !== null && this.view === 'hip' && this.reloadClip) addClip(offsets, this.reloadClip, this.reloadAt * this.reloadClip.duration);
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
      if (this.view === 'held' && !this.frozen) {
        this.spin += dt * DISPLAY_SPIN;
        this.holder.rotation.y = this.spin;
      } else if (this.view === 'display' && !this.frozen) {
        this.stepOrbit(dt);
        this.pose();
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
