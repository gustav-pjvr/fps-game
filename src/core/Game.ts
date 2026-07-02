import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Renderer } from './Renderer.ts';
import { InputManager } from '../input/InputManager.ts';
import { Loop } from './Loop.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Player } from '../entities/Player.ts';
import { Chunk } from '../world/Chunk.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { TERRAIN_CHUNK_SIZE, TERRAIN_RESOLUTION } from './config.ts';

const SPAWN_X = 0;
const SPAWN_Z = 8;
const REFERENCE_BOX_COLORS = [0xdd4444, 0x4488dd, 0xddaa22, 0x22ddaa];

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

    Game.buildWorld(renderer.scene, physics);

    const spawnY = sampleHeight(SPAWN_X, SPAWN_Z) + 2;
    const player = new Player(physics, renderer.camera, new THREE.Vector3(SPAWN_X, spawnY, SPAWN_Z));

    return new Game(renderer, input, physics, player);
  }

  start(): void {
    this.loop.start();
  }

  private static buildWorld(scene: THREE.Scene, physics: PhysicsWorld): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 30, 10);
    sun.castShadow = true;
    scene.add(sun);

    const terrainMaterial = new THREE.MeshStandardMaterial({ color: 0x4a7a3a });
    const chunk = new Chunk(physics, terrainMaterial, {
      originX: -TERRAIN_CHUNK_SIZE / 2,
      originZ: -TERRAIN_CHUNK_SIZE / 2,
      size: TERRAIN_CHUNK_SIZE,
      resolution: TERRAIN_RESOLUTION,
    });
    scene.add(chunk.mesh);

    for (let i = 0; i < REFERENCE_BOX_COLORS.length; i++) {
      const size = 2;
      const x = Math.cos((i / REFERENCE_BOX_COLORS.length) * Math.PI * 2) * 10;
      const z = Math.sin((i / REFERENCE_BOX_COLORS.length) * Math.PI * 2) * 10;
      const y = sampleHeight(x, z) + size / 2;

      const box = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({ color: REFERENCE_BOX_COLORS[i] }),
      );
      box.position.set(x, y, z);
      box.castShadow = true;
      scene.add(box);

      const boxBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
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
