import * as THREE from 'three';
import { Weapon } from './Weapon.ts';
import { WEAPON_DEFINITIONS } from './definitions.ts';
import { createPlaceholderWeaponMesh, WEAPON_ADS_POSITION, WEAPON_HIP_POSITION } from './viewModel.ts';
import { castHitscan } from '../combat/hitscan.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { Player } from '../entities/Player.ts';
import type { ScopeOverlay } from '../ui/scope.ts';
import { ADS_LERP_SPEED, CAMERA_FOV, SCOPE_REVEAL_THRESHOLD } from '../core/config.ts';

const HITSCAN_RANGE = 500;

export class WeaponManager {
  private readonly weapon: Weapon;
  private readonly viewModel: THREE.Object3D;
  private aimAmount = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
    definitionId: string,
    private readonly scopeOverlay: ScopeOverlay,
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
    this.updateAim(dt, input);

    if (input.consumeJustPressed('fire') && this.weapon.tryFire()) {
      this.fireHitscan(player);
    }
    if (input.consumeJustPressed('reload')) {
      this.weapon.startReload();
    }
  }

  private updateAim(dt: number, input: InputManager): void {
    const { adsFov, hasScope } = this.weapon.definition;
    const targetAim = input.isActionActive('aim') ? 1 : 0;
    this.aimAmount = THREE.MathUtils.damp(this.aimAmount, targetAim, ADS_LERP_SPEED, dt);

    this.camera.fov = THREE.MathUtils.lerp(CAMERA_FOV, adsFov, this.aimAmount);
    this.camera.updateProjectionMatrix();

    this.viewModel.position.lerpVectors(WEAPON_HIP_POSITION, WEAPON_ADS_POSITION, this.aimAmount);

    const scopeShouldShow = hasScope && this.aimAmount >= SCOPE_REVEAL_THRESHOLD;
    this.scopeOverlay.setVisible(scopeShouldShow);
    this.viewModel.visible = !scopeShouldShow;
  }

  private fireHitscan(player: Player): void {
    const { spreadRadians, adsSpreadMultiplier, recoilKick } = this.weapon.definition;
    const effectiveSpread = THREE.MathUtils.lerp(spreadRadians, spreadRadians * adsSpreadMultiplier, this.aimAmount);

    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 2 * effectiveSpread);
    direction.applyAxisAngle(new THREE.Vector3(1, 0, 0), (Math.random() - 0.5) * 2 * effectiveSpread);

    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const hit = castHitscan(this.physics, origin, direction, HITSCAN_RANGE);
    if (hit) {
      this.onImpact(hit.point);
    }

    player.addRecoil(recoilKick);
  }
}
