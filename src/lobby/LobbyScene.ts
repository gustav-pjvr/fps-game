import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ENEMY_MODEL_PATH } from '../entities/enemies/Enemy.ts';

const BOB_SPEED = 1.6;
const BOB_AMPLITUDE = 0.045;
const SWAY_SPEED = 0.35;
const SWAY_AMPLITUDE = 0.25;
const CHARACTER_HEIGHT = 1.75;
/** Kenney's "Mini Characters" bind pose measures ~0.671 units tall, feet at local Y=0. */
const MODEL_BIND_HEIGHT = 0.671;
const MODEL_SCALE = CHARACTER_HEIGHT / MODEL_BIND_HEIGHT;

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

  private constructor(container: HTMLElement) {
    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.webgl.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x11151c);
    this.scene.fog = new THREE.Fog(0x11151c, 8, 22);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 1.65, 4.2);
    this.camera.lookAt(0, 1.1, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff2d6, 1.1);
    key.position.set(3, 6, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x4fa0ff, 0.45);
    rim.position.set(-4, 3, -3);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(6, 48),
      new THREE.MeshStandardMaterial({ color: 0x1c222c, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

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
    this.scene.add(this.character);

    this.mixer = new THREE.AnimationMixer(model);
    const idleClip = gltf.animations.find((clip) => clip.name === 'idle') ?? gltf.animations[0];
    if (idleClip) this.mixer.clipAction(idleClip).play();
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
