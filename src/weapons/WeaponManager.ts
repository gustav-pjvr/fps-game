import * as THREE from 'three';
import { Weapon } from './Weapon.ts';
import { WEAPON_DEFINITIONS } from './definitions.ts';
import { createPlaceholderWeaponMesh } from './viewModel.ts';
import { castHitscan } from '../combat/hitscan.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { Player } from '../entities/Player.ts';

const HITSCAN_RANGE = 500;

export class WeaponManager {
  private readonly weapon: Weapon;
  private readonly viewModel: THREE.Object3D;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
    definitionId: string,
    private readonly onImpact: (point: THREE.Vector3) => void,
  ) {
    const definition = WEAPON_DEFINITIONS[definitionId];
    if (!definition) throw new Error(`Unknown weapon definition: ${definitionId}`);

    this.weapon = new Weapon(definition);
    this.viewModel = createPlaceholderWeaponMesh();
    camera.add(this.viewModel);
  }

  get ammo(): number {
    return this.weapon.ammo;
  }

  get magazineSize(): number {
    return this.weapon.definition.magazineSize;
  }

  get isReloading(): boolean {
    return this.weapon.isReloading;
  }

  update(dt: number, input: InputManager, player: Player): void {
    this.weapon.update(dt);

    if (input.consumeJustPressed('fire') && this.weapon.tryFire()) {
      this.fireHitscan(player);
    }
    if (input.consumeJustPressed('reload')) {
      this.weapon.startReload();
    }
  }

  private fireHitscan(player: Player): void {
    const { spreadRadians, recoilKick } = this.weapon.definition;

    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 2 * spreadRadians);
    direction.applyAxisAngle(new THREE.Vector3(1, 0, 0), (Math.random() - 0.5) * 2 * spreadRadians);

    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const hit = castHitscan(this.physics, origin, direction, HITSCAN_RANGE);
    if (hit) {
      this.onImpact(hit.point);
    }

    player.addRecoil(recoilKick);
  }
}
