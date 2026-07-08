import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ENEMY_MODEL_PATH } from '../entities/enemies/Enemy.ts';
import { buildGooseMesh } from '../entities/Goose.ts';
import { GOOSE_HEIGHT } from '../core/config.ts';

const BOB_SPEED = 1.6;
const BOB_AMPLITUDE = 0.045;
const SWAY_SPEED = 0.35;
const SWAY_AMPLITUDE = 0.25;
const CHARACTER_HEIGHT = 1.75;
/** Left-of-center rather than dead-center, so the lobby's title/readout (left) and action rail
 * (right) - see MainMenu.ts - both get real space instead of competing with a centered figure. */
const CHARACTER_OFFSET_X = -1.1;
/** Kenney's "Mini Characters" bind pose measures ~0.671 units tall, feet at local Y=0. */
const MODEL_BIND_HEIGHT = 0.671;
const MODEL_SCALE = CHARACTER_HEIGHT / MODEL_BIND_HEIGHT;

/** Decorative goose wandering the lobby floor alongside the bobbing character - purely cosmetic, no
 * physics/collision needed. Walks a continuous elliptical loop spanning the whole floor (not just
 * one side), passing behind the character on one leg and in front of it on the other, rather than
 * roaming a small patch next to it. `GOOSE_LOOP_CENTER_X/Z` and the two radii size the ellipse to
 * clear CHARACTER_OFFSET_X on the left and stay within the floor/camera frustum on the right and
 * front/back. */
const GOOSE_LOOP_CENTER_X = 0;
const GOOSE_LOOP_CENTER_Z = -0.3;
const GOOSE_LOOP_RADIUS_X = 2.8;
const GOOSE_LOOP_RADIUS_Z = 2.3;
/** Seconds for one full lap - a leisurely walking pace, not a sprint. */
const GOOSE_LOOP_PERIOD_SECONDS = 22;
/** Increasing angle traces the ellipse counter-clockwise (standard math convention: from the +X
 * axis toward +Z, viewed from above) - per user request ("anti-clockwise rotation"). */
const GOOSE_LOOP_ANGULAR_SPEED = (2 * Math.PI) / GOOSE_LOOP_PERIOD_SECONDS;
const GOOSE_WADDLE_BOB_HEIGHT = 0.035;
const GOOSE_WADDLE_BOB_SPEED = 8;
const GOOSE_WADDLE_ROCK_ANGLE = 0.15;

/** Standalone render loop shown before a match starts: the player's character idling center-screen
 * with a gentle bob/sway, in front of the main menu. Owns its own WebGL context, disposed once the
 * player starts a match so the gameplay Renderer can take over the canvas container cleanly. */
export class LobbyScene {
  private readonly webgl: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private character: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private elapsed = 0;
  private frameHandle = 0;

  private readonly goose: THREE.Group;
  private gooseLoopAngle = 0;
  private gooseWaddlePhase = Math.random() * Math.PI * 2;

  private constructor(container: HTMLElement) {
    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.webgl.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c0f);
    this.scene.fog = new THREE.Fog(0x0a0c0f, 8, 22);

    // Camera aim stays at world origin; the character sits off-center (CHARACTER_OFFSET_X) so it
    // renders left-of-frame, leaving room for the lobby's title/readout (left) and action rail
    // (right) - see MainMenu.ts - rather than fighting a dead-centered figure for the same space.
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 1.65, 4.2);
    this.camera.lookAt(0, 1.1, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff2d6, 1.1);
    key.position.set(3, 6, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x3ecf5f, 0.5);
    rim.position.set(-4, 3, -3);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(6, 48),
      new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Soft accent-tinted ground glow beneath the character - a small signature touch that gives
    // the figure presence without needing extra geometry/lighting complexity. A radial-gradient
    // canvas texture (rather than a flat-color circle) is what actually makes this read as a soft
    // glow instead of a hard-edged puddle.
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const glowCtx = glowCanvas.getContext('2d')!;
    const gradient = glowCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(62, 207, 95, 0.55)');
    gradient.addColorStop(1, 'rgba(62, 207, 95, 0)');
    glowCtx.fillStyle = gradient;
    glowCtx.fillRect(0, 0, 128, 128);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 32),
      new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(CHARACTER_OFFSET_X, 0.01, 0);
    this.scene.add(glow);

    this.goose = buildGooseMesh();
    this.goose.position.set(
      GOOSE_LOOP_CENTER_X + GOOSE_LOOP_RADIUS_X,
      GOOSE_HEIGHT / 2,
      GOOSE_LOOP_CENTER_Z,
    );
    this.scene.add(this.goose);

    window.addEventListener('resize', this.onResize);
  }

  static async create(container: HTMLElement): Promise<LobbyScene> {
    const lobby = new LobbyScene(container);
    await lobby.loadCharacter();
    return lobby;
  }

  private async loadCharacter(): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(ENEMY_MODEL_PATH);
    const model = cloneSkeleton(gltf.scene) as THREE.Group;
    model.scale.setScalar(MODEL_SCALE);

    this.character = new THREE.Group();
    this.character.add(model);
    this.character.position.x = CHARACTER_OFFSET_X;
    this.scene.add(this.character);

    this.mixer = new THREE.AnimationMixer(model);
    const idleClip = gltf.animations.find((clip) => clip.name === 'idle') ?? gltf.animations[0];
    if (idleClip) this.mixer.clipAction(idleClip).play();
  }

  /** Advances the goose continuously around GOOSE_LOOP_CENTER_X/Z's ellipse - no destination-
   * picking/arrival logic needed since it's a closed loop, always walking, never idle. */
  private updateGoose(dt: number): void {
    this.gooseLoopAngle += dt * GOOSE_LOOP_ANGULAR_SPEED;

    this.goose.position.x = GOOSE_LOOP_CENTER_X + Math.cos(this.gooseLoopAngle) * GOOSE_LOOP_RADIUS_X;
    this.goose.position.z = GOOSE_LOOP_CENTER_Z + Math.sin(this.gooseLoopAngle) * GOOSE_LOOP_RADIUS_Z;

    // Tangent of the ellipse at the current angle (derivative of the position formula above) -
    // faces the goose the direction it's actually walking, not just toward the loop's center.
    const tangentX = -Math.sin(this.gooseLoopAngle) * GOOSE_LOOP_RADIUS_X;
    const tangentZ = Math.cos(this.gooseLoopAngle) * GOOSE_LOOP_RADIUS_Z;
    this.goose.rotation.y = Math.atan2(tangentX, tangentZ);

    this.gooseWaddlePhase += dt * GOOSE_WADDLE_BOB_SPEED;
    // The mesh's local origin is the goose's vertical *center*, not its feet (see Goose.ts's own
    // applyPosition, which lifts by this exact same GOOSE_HEIGHT/2 above ground) - without this, the
    // goose's center sits at floor level and it visibly sinks in by about half its height.
    this.goose.position.y = GOOSE_HEIGHT / 2 + Math.sin(this.gooseWaddlePhase) * GOOSE_WADDLE_BOB_HEIGHT;
    this.goose.rotation.z = Math.sin(this.gooseWaddlePhase) * GOOSE_WADDLE_ROCK_ANGLE;
  }

  start(): void {
    this.clock.start();
    const tick = (): void => {
      const dt = this.clock.getDelta();
      this.elapsed += dt;
      this.mixer?.update(dt);
      if (this.character) {
        this.character.position.y = Math.sin(this.elapsed * BOB_SPEED) * BOB_AMPLITUDE;
        this.character.rotation.y = Math.sin(this.elapsed * SWAY_SPEED) * SWAY_AMPLITUDE;
      }
      this.updateGoose(dt);
      this.webgl.render(this.scene, this.camera);
      this.frameHandle = requestAnimationFrame(tick);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.onResize);
    this.webgl.dispose();
    this.webgl.domElement.remove();
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(window.innerWidth, window.innerHeight);
  };
}
