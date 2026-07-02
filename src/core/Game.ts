import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Renderer } from './Renderer.ts';
import { InputManager } from '../input/InputManager.ts';
import { Loop } from './Loop.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Player } from '../entities/Player.ts';

export class Game {
  private readonly loop: Loop;

  private constructor(
    private readonly renderer: Renderer,
    private readonly input: InputManager,
    private readonly physics: PhysicsWorld,
    private readonly player: Player,
  ) {
    this.loop = new Loop(this.update, this.render);
  }

  static async create(container: HTMLElement, blocker: HTMLElement): Promise<Game> {
    const renderer = new Renderer(container);
    const input = new InputManager(renderer.canvas, blocker);
    const physics = await PhysicsWorld.create();

    Game.buildPlaceholderScene(renderer.scene, physics);

    const player = new Player(physics, renderer.camera, new THREE.Vector3(0, 3, 8));

    return new Game(renderer, input, physics, player);
  }

  start(): void {
    this.loop.start();
  }

  private static buildPlaceholderScene(scene: THREE.Scene, physics: PhysicsWorld): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 30, 10);
    sun.castShadow = true;
    scene.add(sun);

    const groundSize = 200;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundSize, groundSize),
      new THREE.MeshStandardMaterial({ color: 0x4a7a3a }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const groundBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(groundSize / 2, 0.1, groundSize / 2).setTranslation(0, -0.1, 0),
      groundBody,
    );

    const boxColors = [0xdd4444, 0x4488dd, 0xddaa22, 0x22ddaa];
    for (let i = 0; i < boxColors.length; i++) {
      const size = 2;
      const x = Math.cos((i / boxColors.length) * Math.PI * 2) * 10;
      const z = Math.sin((i / boxColors.length) * Math.PI * 2) * 10 - 5;

      const box = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({ color: boxColors[i] }),
      );
      box.position.set(x, size / 2, z);
      box.castShadow = true;
      scene.add(box);

      const boxBody = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, size / 2, z),
      );
      physics.world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2), boxBody);
    }
  }

  private readonly update = (dt: number): void => {
    this.player.update(dt, this.input);
    this.physics.step(dt);
  };

  private readonly render = (_alpha: number): void => {
    this.renderer.render();
  };
}
