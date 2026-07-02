import * as THREE from 'three';
import { Renderer } from './Renderer.ts';
import { InputManager } from '../input/InputManager.ts';
import { Loop } from './Loop.ts';
import { FREE_FLY_SPEED, MAX_PITCH, MOUSE_SENSITIVITY } from './config.ts';

export class Game {
  private readonly renderer: Renderer;
  private readonly input: InputManager;
  private readonly loop: Loop;

  private yaw = 0;
  private pitch = 0;

  constructor(container: HTMLElement, blocker: HTMLElement) {
    this.renderer = new Renderer(container);
    this.input = new InputManager(this.renderer.canvas, blocker);
    this.buildPlaceholderScene();

    this.renderer.camera.position.set(0, 2, 8);

    this.loop = new Loop(this.update, this.render);
  }

  start(): void {
    this.loop.start();
  }

  private buildPlaceholderScene(): void {
    const { scene } = this.renderer;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 30, 10);
    sun.castShadow = true;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x4a7a3a }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const boxColors = [0xdd4444, 0x4488dd, 0xddaa22, 0x22ddaa];
    for (let i = 0; i < boxColors.length; i++) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 2),
        new THREE.MeshStandardMaterial({ color: boxColors[i] }),
      );
      box.position.set(Math.cos((i / boxColors.length) * Math.PI * 2) * 10, 1, Math.sin((i / boxColors.length) * Math.PI * 2) * 10 - 5);
      box.castShadow = true;
      scene.add(box);
    }
  }

  private readonly update = (dt: number): void => {
    const { dx, dy } = this.input.consumeLookDelta();
    this.yaw -= dx * MOUSE_SENSITIVITY;
    this.pitch -= dy * MOUSE_SENSITIVITY;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));

    const camera = this.renderer.camera;
    camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const speed = FREE_FLY_SPEED * (this.input.isActionActive('sprint') ? 2.5 : 1) * dt;

    const move = new THREE.Vector3();
    if (this.input.isActionActive('moveForward')) move.add(forward);
    if (this.input.isActionActive('moveBackward')) move.sub(forward);
    if (this.input.isActionActive('moveRight')) move.add(right);
    if (this.input.isActionActive('moveLeft')) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      camera.position.add(move);
    }
  };

  private readonly render = (_alpha: number): void => {
    this.renderer.render();
  };
}
