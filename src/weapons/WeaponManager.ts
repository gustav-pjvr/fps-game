import * as THREE from 'three';
import { Weapon } from './Weapon.ts';
import { WEAPON_DEFINITIONS } from './definitions.ts';
import { createPlaceholderWeaponMesh, WEAPON_ADS_POSITION, WEAPON_HIP_POSITION } from './viewModel.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { isDamageable } from '../combat/damage.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { Action } from '../input/actions.ts';
import type { Player } from '../entities/Player.ts';
import type { ScopeOverlay } from '../ui/scope.ts';
import {
  ADS_LERP_SPEED,
  CAMERA_FOV,
  SCOPE_REVEAL_THRESHOLD,
  WEAPON_HOLSTER_DROP,
  WEAPON_SWITCH_DURATION,
} from '../core/config.ts';

const HITSCAN_RANGE = 500;

const SLOT_ACTIONS: Action[] = ['weaponSlot1', 'weaponSlot2', 'weaponSlot3', 'weaponSlot4'];

interface WeaponSlot {
  weapon: Weapon;
  viewModel: THREE.Object3D;
}

export class WeaponManager {
  private readonly slots: WeaponSlot[];
  private activeIndex = 0;
  private aimAmount = 0;

  /** 0 = fully drawn, 1 = fully holstered (mid-switch). */
  private switchProgress = 0;
  private switching = false;
  private pendingIndex: number | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
    definitionIds: string[],
    private readonly scopeOverlay: ScopeOverlay,
    private readonly onImpact: (point: THREE.Vector3) => void,
  ) {
    if (definitionIds.length === 0) throw new Error('WeaponManager needs at least one weapon definition');

    this.slots = definitionIds.map((id) => {
      const definition = WEAPON_DEFINITIONS[id];
      if (!definition) throw new Error(`Unknown weapon definition: ${id}`);

      const viewModel = createPlaceholderWeaponMesh();
      viewModel.visible = false;
      camera.add(viewModel);
      return { weapon: new Weapon(definition), viewModel };
    });

    const first = this.slots[0];
    if (first) first.viewModel.visible = true;
  }

  private get active(): WeaponSlot {
    const slot = this.slots[this.activeIndex];
    if (!slot) throw new Error('Active weapon slot missing');
    return slot;
  }

  get ammo(): number {
    return this.active.weapon.ammo;
  }

  get magazineSize(): number {
    return this.active.weapon.definition.magazineSize;
  }

  get isReloading(): boolean {
    return this.active.weapon.isReloading;
  }

  get weaponName(): string {
    return this.active.weapon.definition.name;
  }

  update(dt: number, input: InputManager, player: Player): void {
    this.active.weapon.update(dt);
    this.handleSwitchRequests(input);
    this.updateSwitching(dt);
    this.updateAim(dt, input);

    if (this.switching) return;

    if (input.consumeJustPressed('fire') && this.active.weapon.tryFire()) {
      this.fireHitscan(player);
    }
    if (input.consumeJustPressed('reload')) {
      this.active.weapon.startReload();
    }
  }

  private handleSwitchRequests(input: InputManager): void {
    if (this.switching) return;

    for (let i = 0; i < this.slots.length; i++) {
      const action = SLOT_ACTIONS[i];
      if (action && i !== this.activeIndex && input.consumeJustPressed(action)) {
        this.beginSwitch(i);
        return;
      }
    }

    if (this.slots.length < 2) return;
    if (input.consumeJustPressed('weaponNext')) {
      this.beginSwitch((this.activeIndex + 1) % this.slots.length);
    } else if (input.consumeJustPressed('weaponPrev')) {
      this.beginSwitch((this.activeIndex - 1 + this.slots.length) % this.slots.length);
    }
  }

  private beginSwitch(targetIndex: number): void {
    this.switching = true;
    this.pendingIndex = targetIndex;
    this.scopeOverlay.setVisible(false);
  }

  private updateSwitching(dt: number): void {
    if (!this.switching) return;

    const step = dt / (WEAPON_SWITCH_DURATION / 2);
    if (this.pendingIndex !== null && this.switchProgress < 1) {
      this.switchProgress = Math.min(1, this.switchProgress + step);
      if (this.switchProgress >= 1) {
        this.active.viewModel.visible = false;
        this.activeIndex = this.pendingIndex;
        this.pendingIndex = null;
        this.active.viewModel.visible = true;
        this.aimAmount = 0;
      }
    } else {
      this.switchProgress = Math.max(0, this.switchProgress - step);
      if (this.switchProgress <= 0) {
        this.switching = false;
      }
    }

    this.active.viewModel.position.y = WEAPON_HIP_POSITION.y - WEAPON_HOLSTER_DROP * this.switchProgress;
  }

  private updateAim(dt: number, input: InputManager): void {
    const { adsFov, hasScope } = this.active.weapon.definition;
    const targetAim = !this.switching && input.isActionActive('aim') ? 1 : 0;
    this.aimAmount = THREE.MathUtils.damp(this.aimAmount, targetAim, ADS_LERP_SPEED, dt);

    this.camera.fov = THREE.MathUtils.lerp(CAMERA_FOV, adsFov, this.aimAmount);
    this.camera.updateProjectionMatrix();

    if (!this.switching) {
      this.active.viewModel.position.lerpVectors(WEAPON_HIP_POSITION, WEAPON_ADS_POSITION, this.aimAmount);
    }

    const scopeShouldShow = hasScope && this.aimAmount >= SCOPE_REVEAL_THRESHOLD;
    this.scopeOverlay.setVisible(scopeShouldShow);
    this.active.viewModel.visible = !scopeShouldShow;
  }

  private fireHitscan(player: Player): void {
    const { spreadRadians, adsSpreadMultiplier, recoilKick } = this.active.weapon.definition;
    const effectiveSpread = THREE.MathUtils.lerp(spreadRadians, spreadRadians * adsSpreadMultiplier, this.aimAmount);

    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 2 * effectiveSpread);
    direction.applyAxisAngle(new THREE.Vector3(1, 0, 0), (Math.random() - 0.5) * 2 * effectiveSpread);

    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const hit = castHitscan(this.physics, origin, direction, HITSCAN_RANGE);
    if (hit) {
      this.onImpact(hit.point);
      const target = this.physics.getEntity(hit.colliderHandle);
      if (isDamageable(target)) {
        target.takeDamage(this.active.weapon.definition.damage, hit.colliderHandle);
      }
    }

    player.addRecoil(recoilKick);
  }
}
