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
