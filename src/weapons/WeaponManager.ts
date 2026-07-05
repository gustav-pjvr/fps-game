import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Weapon } from './Weapon.ts';
import { WEAPON_DEFINITIONS } from './definitions.ts';
import {
  createProceduralMeleeViewModel,
  createWeaponViewModel,
  WEAPON_ADS_POSITION,
  WEAPON_HIP_POSITION,
  WEAPON_MODEL_SPECS,
} from './viewModel.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { isDamageable } from '../combat/damage.ts';
import { applySpreadCone } from '../combat/spread.ts';
import { loadGLTF } from '../core/AssetLoader.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { Action } from '../input/actions.ts';
import type { Player } from '../entities/Player.ts';
import type { ScopeOverlay } from '../ui/scope.ts';
import {
  ADS_LERP_SPEED,
  CAMERA_FOV,
  LONG_SHOT_DISTANCE,
  RELOAD_DIP,
  RELOAD_TILT_ANGLE,
  SCOPE_REVEAL_THRESHOLD,
  WEAPON_BOB_AMPLITUDE,
  WEAPON_HOLSTER_DROP,
  WEAPON_SWAY_DAMP,
  WEAPON_SWAY_LOOK_FACTOR,
  WEAPON_SWAY_MAX,
  WEAPON_SWITCH_DURATION,
} from '../core/config.ts';

const HITSCAN_RANGE = 500;

const SLOT_ACTIONS: Action[] = ['weaponSlot1', 'weaponSlot2', 'weaponSlot3', 'weaponSlot4', 'weaponSlot5'];

interface WeaponSlot {
  weapon: Weapon;
  viewModel: THREE.Object3D;
  muzzleLocalOffset: THREE.Vector3;
}

export class WeaponManager {
  private readonly slots: WeaponSlot[];
  private activeIndex = 0;
  private aimAmount = 0;

  /** 0 = fully drawn, 1 = fully holstered (mid-switch). */
  private switchProgress = 0;
  private switching = false;
  private pendingIndex: number | null = null;

  /** Weapon sway (VISUAL_REALISM.md §6) - the view model lags behind the camera's own look
   * rotation instead of being rigidly bolted to it. Tracked as yaw/pitch deltas between ticks
   * (not raw mouse movement) so this only needs the camera WeaponManager already holds, rather
   * than a second read of InputManager's look delta (which Player already consumes once per
   * tick - reading it again here would either double-consume or need new API surface on
   * InputManager for no real benefit). */
  private previousCameraYaw = 0;
  private previousCameraPitch = 0;
  private swayYaw = 0;
  private swayPitch = 0;

  private constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
    slots: WeaponSlot[],
    private readonly scopeOverlay: ScopeOverlay,
    private readonly onImpact: (point: THREE.Vector3, isEntityHit: boolean) => void,
    private readonly onTracer: (start: THREE.Vector3, end: THREE.Vector3) => void,
    private readonly onFire: (weaponId: string) => void,
    private readonly onReloadStart: (weaponId: string) => void,
    private readonly onLongShot: (distance: number) => void,
    private readonly onMuzzleFlash: (point: THREE.Vector3) => void,
  ) {
    this.slots = slots;
    const first = this.slots[0];
    if (first) first.viewModel.visible = true;
  }

  static async create(
    camera: THREE.PerspectiveCamera,
    physics: PhysicsWorld,
    definitionIds: string[],
    scopeOverlay: ScopeOverlay,
    onImpact: (point: THREE.Vector3, isEntityHit: boolean) => void,
    onTracer: (start: THREE.Vector3, end: THREE.Vector3) => void,
    onFire: (weaponId: string) => void,
    onReloadStart: (weaponId: string) => void,
    onLongShot: (distance: number) => void,
    onMuzzleFlash: (point: THREE.Vector3) => void,
  ): Promise<WeaponManager> {
    if (definitionIds.length === 0) throw new Error('WeaponManager needs at least one weapon definition');

    const slots = await Promise.all(
      definitionIds.map(async (id) => {
        const definition = WEAPON_DEFINITIONS[id];
        if (!definition) throw new Error(`Unknown weapon definition: ${id}`);

        const spec = WEAPON_MODEL_SPECS[id];
        // No sourced model for melee weapons (Phase D) - a procedural placeholder stands in rather
        // than blocking on a new asset (see createProceduralMeleeViewModel).
        const { group, muzzleLocalOffset } = spec
          ? createWeaponViewModel(definition, await loadGLTF(spec.path))
          : createProceduralMeleeViewModel(definition);
        group.visible = false;
        camera.add(group);
        return { weapon: new Weapon(definition), viewModel: group, muzzleLocalOffset };
      }),
    );

    return new WeaponManager(
      camera,
      physics,
      slots,
      scopeOverlay,
      onImpact,
      onTracer,
      onFire,
      onReloadStart,
      onLongShot,
      onMuzzleFlash,
    );
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

  /** Instant full refill for every carried weapon, not just the active one - practice-reset feature. */
  resetAllAmmo(): void {
    for (const slot of this.slots) {
      slot.weapon.refillAmmo();
    }
  }

  get weaponName(): string {
    return this.active.weapon.definition.name;
  }

  get weaponDescription(): string {
    return this.active.weapon.definition.description;
  }

  get weaponSlotNames(): string[] {
    return this.slots.map((slot) => slot.weapon.definition.name);
  }

  get activeWeaponIndex(): number {
    return this.activeIndex;
  }

  update(dt: number, input: InputManager, player: Player): void {
    this.active.weapon.update(dt);
    this.handleSwitchRequests(input);
    this.updateSwitching(dt);
    this.updateAim(dt, input, player);

    if (this.switching) return;

    const firePressed = this.active.weapon.definition.automatic
      ? input.isActionActive('fire')
      : input.consumeJustPressed('fire');
    if (firePressed) {
      if (this.active.weapon.tryFire()) {
        this.fireShot(player);
      } else if (this.active.weapon.ammo <= 0 && this.active.weapon.startReload()) {
        // Auto-reload: trying to fire an empty magazine starts a reload without needing manual R.
        this.onReloadStart(this.active.weapon.definition.id);
      }
    }
    if (input.consumeJustPressed('reload') && this.active.weapon.startReload()) {
      this.onReloadStart(this.active.weapon.definition.id);
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

  private updateAim(dt: number, input: InputManager, player: Player): void {
    const { adsFov, hasScope } = this.active.weapon.definition;
    const targetAim = !this.switching && input.isActionActive('aim') ? 1 : 0;
    this.aimAmount = THREE.MathUtils.damp(this.aimAmount, targetAim, ADS_LERP_SPEED, dt);

    this.camera.fov = THREE.MathUtils.lerp(CAMERA_FOV, adsFov, this.aimAmount);
    this.camera.updateProjectionMatrix();

    this.updateWeaponSway(dt);

    if (!this.switching) {
      this.active.viewModel.position.lerpVectors(WEAPON_HIP_POSITION, WEAPON_ADS_POSITION, this.aimAmount);

      // Dip + tilt the weapon while reloading, peaking at the midpoint and settling back to
      // neutral by the time the reload completes - a visual cue beyond the HUD's "RELOADING…" text.
      const reloadCurve = Math.sin(this.active.weapon.reloadProgress * Math.PI);
      this.active.viewModel.position.y -= RELOAD_DIP * reloadCurve;
      this.active.viewModel.rotation.x = RELOAD_TILT_ANGLE * reloadCurve + this.swayPitch;
      this.active.viewModel.rotation.y = this.swayYaw;

      // Same shared phase the camera bob uses (see Player.movementBobPhase) - the weapon and the
      // camera bob together rather than independently, matching the doc's framing of one phase
      // driving both.
      this.active.viewModel.position.y +=
        Math.sin(player.movementBobPhase) * WEAPON_BOB_AMPLITUDE * player.movementBobStrength;
    }

    const scopeShouldShow = hasScope && this.aimAmount >= SCOPE_REVEAL_THRESHOLD;
    this.scopeOverlay.setVisible(scopeShouldShow);
    this.active.viewModel.visible = !scopeShouldShow;
  }

  /** Computes this tick's lag offset from how much the camera itself rotated since last tick -
   * the weapon target-offsets opposite that rotation (dragging behind, as a real weapon's inertia
   * would) and damps back toward neutral over time. Clamped so a big single-tick look snap (e.g.
   * a debug teleport/lookAt) can't fling the view model to an extreme angle. */
  private updateWeaponSway(dt: number): void {
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const yawDelta = euler.y - this.previousCameraYaw;
    const pitchDelta = euler.x - this.previousCameraPitch;
    this.previousCameraYaw = euler.y;
    this.previousCameraPitch = euler.x;

    const targetSwayYaw = THREE.MathUtils.clamp(-yawDelta * WEAPON_SWAY_LOOK_FACTOR, -WEAPON_SWAY_MAX, WEAPON_SWAY_MAX);
    const targetSwayPitch = THREE.MathUtils.clamp(-pitchDelta * WEAPON_SWAY_LOOK_FACTOR, -WEAPON_SWAY_MAX, WEAPON_SWAY_MAX);
    this.swayYaw = THREE.MathUtils.damp(this.swayYaw, targetSwayYaw, WEAPON_SWAY_DAMP, dt);
    this.swayPitch = THREE.MathUtils.damp(this.swayPitch, targetSwayPitch, WEAPON_SWAY_DAMP, dt);
  }

  /** One trigger pull - fires pelletCount independent rays (shotguns; 1 for everything else) but a single recoil kick. */
  private fireShot(player: Player): void {
    const { pelletCount, recoilKick, kind } = this.active.weapon.definition;

    // camera has no parent, so .position IS the world position - avoids reading a stale
    // matrixWorld (only refreshed during render(), which runs after this fires each tick).
    const origin = this.camera.position.clone();
    const muzzleWorld = this.active.viewModel.position
      .clone()
      .add(this.active.muzzleLocalOffset)
      .applyQuaternion(this.camera.quaternion)
      .add(origin);

    for (let i = 0; i < pelletCount; i++) {
      this.firePellet(origin, muzzleWorld, player.ownCollider);
    }

    this.onFire(this.active.weapon.definition.id);
    // Melee has no muzzle - a flash there would be a light spawning out of a knife blade.
    if (kind === 'ranged') this.onMuzzleFlash(muzzleWorld);
    player.addRecoil(recoilKick);
  }

  private firePellet(origin: THREE.Vector3, muzzleWorld: THREE.Vector3, excludeCollider: RAPIER.Collider): void {
    const { spreadRadians, adsSpreadMultiplier, damage, range } = this.active.weapon.definition;
    const effectiveSpread = THREE.MathUtils.lerp(spreadRadians, spreadRadians * adsSpreadMultiplier, this.aimAmount);
    const effectiveRange = range ?? HITSCAN_RANGE;

    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    applySpreadCone(direction, effectiveSpread);

    // camera.position sits inside the player's own capsule (EYE_OFFSET is well within its
    // radius/height), so without excluding it every shot immediately self-hit at distance 0.
    const hit = castHitscan(this.physics, origin, direction, effectiveRange, excludeCollider);

    const tracerEnd = hit ? hit.point : origin.clone().add(direction.clone().multiplyScalar(effectiveRange));
    this.onTracer(muzzleWorld, tracerEnd);

    if (hit) {
      const target = this.physics.getEntity(hit.colliderHandle);
      const isEntityHit = isDamageable(target);
      this.onImpact(hit.point, isEntityHit);
      if (isDamageable(target)) {
        target.takeDamage(damage, hit.colliderHandle);
        if (hit.distance >= LONG_SHOT_DISTANCE) this.onLongShot(hit.distance);
      }
    }
  }
}
