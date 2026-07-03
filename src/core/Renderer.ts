import * as THREE from 'three';
import { CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR } from './config.ts';

export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  constructor(container: HTMLElement) {
    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    this.webgl.shadowMap.enabled = true;
    container.appendChild(this.webgl.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 50, CAMERA_FAR);

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

    window.addEventListener('resize', this.onResize);
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
    this.webgl.dispose();
  }
}
