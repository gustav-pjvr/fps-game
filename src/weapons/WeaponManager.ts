import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Weapon } from './Weapon.ts';
import { WEAPON_DEFINITIONS } from './definitions.ts';
import {
  WEAPON_ADS_POSITION,
  WEAPON_HIP_POSITION,
  type WeaponViewModel,
} from './viewModel.ts';
import { buildWeaponViewModel } from './models/arsenal.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { isDamageable } from '../combat/damage.ts';
import { applySpreadCone } from '../combat/spread.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { Action } from '../input/actions.ts';
import type { Player } from '../entities/Player.ts';
import type { ScopeOverlay } from '../ui/scope.ts';
import { Settings } from '../settings/Settings.ts';
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
  WEAPON_BURST_SHOT_INTERVAL_SECONDS,
} from '../core/config.ts';

const HITSCAN_RANGE = 500;

const SLOT_ACTIONS: Action[] = ['weaponSlot1', 'weaponSlot2', 'weaponSlot3', 'weaponSlot4', 'weaponSlot5'];

interface WeaponSlot extends Omit<WeaponViewModel, 'group'> {
  weapon: Weapon;
  viewModel: THREE.Object3D;
  previousAmmo: number;
  shotFlash: number[];
}

export class WeaponManager {
  private readonly slots: WeaponSlot[];
  private activeIndex = 0;
  private aimAmount = 0;

  /** 0 = fully drawn, 1 = fully holstered (mid-switch). */
  private switchProgress = 0;
  private switching = false;
  private pendingIndex: number | null = null;
  /** Guards against a real bug: `switching` flips false on the exact same tick a switch's
   * holster/draw animation finishes, and `update()` immediately checks fire afterward that same
   * tick. If the player was still holding the fire button from before the switch (e.g. scrolling
   * to a new weapon while the mouse button is still down from the last one), `isActionActive
   * ('fire')` reads true for an automatic weapon with no new press at all - a phantom shot that
   * costs ammo the player never intended to spend. Set the instant a switch begins (whenever fire
   * is currently held) and only cleared once fire is actually released, so the newly-drawn weapon
   * always needs a fresh press before it can fire. */
  private fireLockedUntilRelease = false;
  /** Set by grantBonusWeapon (the Goose Launcher reward) - the weapon id to swap back to once the
   * active (disableReload) weapon's magazine hits 0, checked at the end of every update() tick.
   * Cleared the instant the revert is kicked off (before the async rebuild resolves) so a slow
   * asset load can't re-trigger this on a later frame. */
  private pendingRestoreId: string | null = null;
  /** Burst-fire (see WeaponDefinition.burstCount, currently only the MP5): rounds still owed from
   * the burst a trigger pull just kicked off, and the countdown to the next one -
   * WEAPON_BURST_SHOT_INTERVAL_SECONDS apart, distinct from `fireRate`'s between-burst cooldown. */
  private burstShotsRemaining = 0;
  private burstShotTimer = 0;

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
    private readonly onMuzzleFlash: (point: THREE.Vector3, weaponId: string) => void,
    /** Fires instead of the normal per-pellet hitscan loop for a weapon with isProjectile set (see
     * definitions.ts's WeaponDefinition.isProjectile) - currently only the Goose Launcher. */
    private readonly onProjectileFire: (origin: THREE.Vector3, muzzleWorld: THREE.Vector3, direction: THREE.Vector3) => void,
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
    /** `weaponId` lets enemies hear louder weapons from farther away (enemy AI v2 step 1). */
    onMuzzleFlash: (point: THREE.Vector3, weaponId: string) => void,
    onProjectileFire: (origin: THREE.Vector3, muzzleWorld: THREE.Vector3, direction: THREE.Vector3) => void,
    /** Per-match damage overrides keyed by weapon id (see core/gameModes.ts) - e.g. Sniper Duel's
     * sniper or 1 Shot 1 Kill's pistol guaranteeing a 1-hit kill. Absent/undefined for the default
     * mode, which uses every weapon's own base `definition.damage` unmodified. */
    damageOverrides?: Readonly<Record<string, number>>,
    /** Goose Horde multiplayer only (see weapons/Weapon.ts's reserveAmmo) - starting reserve ammo
     * keyed by weapon id. Absent/undefined for every other mode, matching the existing unlimited-
     * reload behavior exactly. */
    initialReserveAmmo?: Readonly<Record<string, number>>,
  ): Promise<WeaponManager> {
    if (definitionIds.length === 0) throw new Error('WeaponManager needs at least one weapon definition');

    const slots = await Promise.all(
      definitionIds.map((id) => WeaponManager.buildSlot(camera, id, damageOverrides?.[id], initialReserveAmmo?.[id])),
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
      onProjectileFire,
    );
  }

  /** Shared by `create()` (initial loadout) and `replaceActiveWeapon` (Gun Game's kill-upgrade) -
   * builds one fully-formed slot (weapon + attached view model) for a single weapon id. */
  private static async buildSlot(
    camera: THREE.PerspectiveCamera,
    id: string,
    damageOverride: number | undefined,
    initialReserveAmmo?: number,
  ): Promise<WeaponSlot> {
    const definition = WEAPON_DEFINITIONS[id];
    if (!definition) throw new Error(`Unknown weapon definition: ${id}`);

    const { group, ...model } = buildWeaponViewModel(id);
    group.visible = false;
    camera.add(group);
    return {
      weapon: new Weapon(definition, damageOverride, initialReserveAmmo),
      viewModel: group,
      ...model,
      previousAmmo: definition.magazineSize,
      shotFlash: model.glowMaterials.map(() => 0),
    };
  }

  /** Gun Game's kill-upgrade: replaces whatever's in the active slot with a fresh instance of
   * `definitionId` - full ammo, no override, matching a normal "this is your new gun" moment
   * rather than reusing the old Weapon's leftover ammo/cooldown state. Only ever meaningful for a
   * single-slot loadout (Gun Game never has more than one weapon), but doesn't assume that -
   * it only ever touches whichever slot is currently active. */
  async replaceActiveWeapon(definitionId: string): Promise<void> {
    const index = this.activeIndex;
    const oldSlot = this.slots[index];
    const newSlot = await WeaponManager.buildSlot(this.camera, definitionId, undefined);
    if (oldSlot) {
      this.camera.remove(oldSlot.viewModel);
    }
    newSlot.viewModel.visible = true;
    this.slots[index] = newSlot;
    // Same phantom-fire guard as beginSwitch - a kill upgrade can land while the player is still
    // holding fire from the kill itself, and the fresh weapon shouldn't inherit that as a press.
    this.fireLockedUntilRelease = true;
    // Same burst reset as beginSwitch, for the same reason: a burst in flight belongs to the weapon
    // that fired it. Without this, if round 1 of an MP5 burst kills the golden goose, rounds 2-3
    // fire from the freshly granted Goose Launcher and spend half its 4 shots (likewise a Gun Game
    // kill-upgrade landing mid-burst).
    this.burstShotsRemaining = 0;
    this.burstShotTimer = 0;
    // A pending bonus restore only means something while a disableReload weapon is held. If
    // anything else replaces the launcher first (a Gun Game kill-upgrade), the recorded target is
    // stale and must not survive into the next grant, which never overwrites a pending restore.
    if (!newSlot.weapon.definition.disableReload) this.pendingRestoreId = null;
  }

  /** The bonus golden-goose reward (see entities/BonusGooseManager.ts) - same hard-swap shape as
   * replaceActiveWeapon, but also remembers `restoreId` so update() can automatically swap back to
   * it the instant the bonus weapon's magazine empties (see the disableReload check there). */
  async grantBonusWeapon(bonusId: string, restoreId: string): Promise<void> {
    // Already holding it (another golden goose killed with the launcher itself): top the magazine
    // up in place. Rebuilding was wasted work, and the old code then recorded `restoreId` (the
    // launcher's own id at that moment) as the restore target, so the auto-revert "restored" an
    // empty launcher that can never reload. restock(), not refillAmmo(): the latter deliberately
    // skips disableReload weapons (see Weapon.refillAmmo). The existing pending restore is kept.
    if (this.activeWeaponId === bonusId) {
      this.active.weapon.restock();
      return;
    }
    await this.replaceActiveWeapon(bonusId);
    // Never record the bonus weapon as its own restore target, and never overwrite a restore that
    // is already pending: the first grant saw the player's real weapon, a later overlapping one
    // may not have.
    if (this.pendingRestoreId === null && restoreId !== bonusId) this.pendingRestoreId = restoreId;
  }

  /** Detaches every slot's view model from the camera - a mid-match Loadout change (see Game.ts's
   * applyPendingLoadoutIfNeeded) rebuilds an entirely fresh WeaponManager rather than mutating this
   * one's slots in place, so the old instance needs a clean way to let go of its view models before
   * being discarded. Does not touch `camera`/`physics` themselves - only what this instance added. */
  dispose(): void {
    for (const slot of this.slots) {
      this.camera.remove(slot.viewModel);
    }
  }

  private get active(): WeaponSlot {
    const slot = this.slots[this.activeIndex];
    if (!slot) throw new Error('Active weapon slot missing');
    return slot;
  }

  get ammo(): number {
    return this.active.weapon.ammo;
  }

  /** Goose Horde multiplayer only - null (unlimited) everywhere else. See weapons/Weapon.ts's
   * reserveAmmo comment. */
  get activeReserve(): number | null {
    return this.active.weapon.reserve;
  }

  get magazineSize(): number {
    return this.active.weapon.definition.magazineSize;
  }

  /** An ammo-drop pickup (Goose Horde multiplayer only) refills reserve for whatever weapon is
   * currently active/held, per explicit user request - not every weapon the player is carrying. */
  addReserveAmmoToActive(amount: number): void {
    this.active.weapon.addReserveAmmo(amount);
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

  /** The active weapon's definition *id* (e.g. `'pistol'`) - distinct from `weaponName`/
   * `weaponSlotNames`, which return the display name. Gun Game's kill-upgrade needs the id to
   * pick a different weapon and to call `replaceActiveWeapon`. */
  get activeWeaponId(): string {
    return this.active.weapon.definition.id;
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

  /** Drops out of ADS instantly: scope overlay hidden, view model shown, camera back at the live
   * base FOV. Game calls this every tick the player is frozen (paused in single-player, or dead),
   * because update(), and with it updateAim, isn't called then, so a scope overlay and zoomed FOV
   * used to stay up behind the pause menu and death screen. Idempotent, and a single comparison
   * once already un-aimed: updateAim only ever shows the scope/hides the view model while
   * aimAmount >= SCOPE_REVEAL_THRESHOLD, so aimAmount === 0 plus an un-zoomed camera means there
   * is nothing left to undo. The view model's pose is left alone; updateAim re-derives it from
   * aimAmount on the first tick after unfreezing. */
  cancelAim(): void {
    const baseFov = Settings.getFov();
    if (this.aimAmount === 0 && this.camera.fov === baseFov) return;
    this.aimAmount = 0;
    this.scopeOverlay.setVisible(false);
    this.active.viewModel.visible = true;
    this.camera.fov = baseFov;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, input: InputManager, player: Player): void {
    this.active.weapon.update(dt);
    this.handleSwitchRequests(input);
    this.updateSwitching(dt);
    this.updateAim(dt, input, player);

    if (this.switching) return;

    if (this.fireLockedUntilRelease) {
      // Drain any queued click so it doesn't fire the instant the lock lifts.
      input.consumeJustPressed('fire');
      if (!input.isActionActive('fire')) this.fireLockedUntilRelease = false;
    }

    // A burst already in flight (see WeaponDefinition.burstCount) finishes resolving before any
    // fresh input is read this tick - the player's trigger pull already committed to the full
    // burst, same as a real gun's mechanism running its course.
    if (this.burstShotsRemaining > 0) {
      this.burstShotTimer -= dt;
      if (this.burstShotTimer <= 0) this.fireBurstShot(player);
      return;
    }

    const firePressed =
      !this.fireLockedUntilRelease &&
      (this.active.weapon.definition.automatic ? input.isActionActive('fire') : input.consumeJustPressed('fire'));
    if (firePressed) {
      if (this.active.weapon.tryFire()) {
        this.fireShot(player);
        const burstCount = this.active.weapon.definition.burstCount ?? 1;
        if (burstCount > 1) {
          this.burstShotsRemaining = burstCount - 1;
          this.burstShotTimer = WEAPON_BURST_SHOT_INTERVAL_SECONDS;
        }
      } else if (this.active.weapon.ammo <= 0 && this.active.weapon.startReload()) {
        // Auto-reload: trying to fire an empty magazine starts a reload without needing manual R.
        this.onReloadStart(this.active.weapon.definition.id);
      }
    }
    if (input.consumeJustPressed('reload') && this.active.weapon.startReload()) {
      this.onReloadStart(this.active.weapon.definition.id);
    }

    // The Goose Launcher (or any future disableReload weapon) disappears the instant its magazine
    // empties - see grantBonusWeapon. Cleared before the async rebuild starts so a slow asset load
    // can't re-trigger this next frame.
    if (this.pendingRestoreId !== null && this.active.weapon.definition.disableReload && this.active.weapon.ammo <= 0) {
      const restoreId = this.pendingRestoreId;
      this.pendingRestoreId = null;
      void this.replaceActiveWeapon(restoreId);
    }
  }

  /** Fires the next round of an in-progress burst (see the WEAPON_BURST_SHOT_INTERVAL_SECONDS
   * check in update()) - same tryFire()/fireShot() pipeline a fresh trigger pull uses, just called
   * again on a short timer instead of waiting for another press. Stops the burst early (rather
   * than erroring) if the magazine runs dry mid-burst. */
  private fireBurstShot(player: Player): void {
    // consumeBurstRound(), not tryFire() - the opening shot's tryFire() already set the
    // fireRate cooldown that gates the *next* burst; reusing it here would block every follow-up
    // round in this same burst (see Weapon.consumeBurstRound's own comment on the bug this fixes).
    if (this.active.weapon.consumeBurstRound()) {
      this.fireShot(player);
      this.burstShotsRemaining--;
      this.burstShotTimer = WEAPON_BURST_SHOT_INTERVAL_SECONDS;
    } else {
      this.burstShotsRemaining = 0;
    }
  }

  private handleSwitchRequests(input: InputManager): void {
    if (this.switching) return;

    for (let i = 0; i < this.slots.length; i++) {
      const action = SLOT_ACTIONS[i];
      if (action && i !== this.activeIndex && input.consumeJustPressed(action)) {
        this.beginSwitch(i, input);
        return;
      }
    }

    if (this.slots.length < 2) return;
    if (input.consumeJustPressed('weaponNext')) {
      this.beginSwitch((this.activeIndex + 1) % this.slots.length, input);
    } else if (input.consumeJustPressed('weaponPrev')) {
      this.beginSwitch((this.activeIndex - 1 + this.slots.length) % this.slots.length, input);
    }
  }

  private beginSwitch(targetIndex: number, input: InputManager): void {
    this.switching = true;
    this.pendingIndex = targetIndex;
    this.scopeOverlay.setVisible(false);
    // See fireLockedUntilRelease's own comment - locks fire on the new weapon until the button is
    // actually released, regardless of whether it's currently held or was just clicked mid-switch.
    this.fireLockedUntilRelease = true;
    input.consumeJustPressed('fire');
    // An in-progress burst (see WeaponDefinition.burstCount) must not bleed into whatever weapon
    // is drawn next - without this, switching away mid-burst would resume firing the *new*
    // weapon once the switch animation completes and update()'s burst check runs again.
    this.burstShotsRemaining = 0;
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
    // The holster/draw pose itself is written by updateAim (runs right after this, same tick), so
    // it shares the FOV compensation there instead of setting an unscaled position of its own.
  }

  private updateAim(dt: number, input: InputManager, player: Player): void {
    const { adsFov, hasScope } = this.active.weapon.definition;
    const targetAim = !this.switching && input.isActionActive('aim') ? 1 : 0;
    this.aimAmount = THREE.MathUtils.damp(this.aimAmount, targetAim, ADS_LERP_SPEED, dt);

    // The user's live FOV setting (see settings/Settings.ts), not the bare CAMERA_FOV constant -
    // read fresh every frame so a mid-match Settings.setFov() change applies on the very next
    // tick, same "just re-read Settings continuously" pattern applyLook's mouse-sensitivity read
    // already uses. Weapons authored with `adsFov: CAMERA_FOV` (see definitions.ts) are the ones
    // that deliberately have no dedicated zoom of their own - that literal value is a sentinel for
    // "same as hip fire," so it needs to track the live setting too, not stay pinned to the old
    // hardcoded default while every other weapon's hip fire already moved.
    const baseFov = Settings.getFov();
    const effectiveAdsFov = adsFov === CAMERA_FOV ? baseFov : adsFov;
    this.camera.fov = THREE.MathUtils.lerp(baseFov, effectiveAdsFov, this.aimAmount);
    this.camera.updateProjectionMatrix();

    this.updateWeaponSway(dt);

    this.active.viewModel.position.lerpVectors(WEAPON_HIP_POSITION, WEAPON_ADS_POSITION, this.aimAmount);

    // The hip/ADS offsets above were hand-tuned at the original fixed CAMERA_FOV (75). Apparent
    // size of a camera-attached object scales with 1/tan(fov/2), so at a wider user FOV the gun
    // renders smaller and reads as floating detached in front of the player instead of held
    // (confirmed via live screenshots at high FOV). Scaling the whole offset vector by the tan
    // ratio pulls the gun proportionally closer, keeping its on-screen size and placement as
    // tuned regardless of the FOV setting. At full ADS a weapon with a real zoom renders at its
    // own authored adsFov (exactly what the ADS offset was tuned against - factor 1), while a
    // sentinel weapon (adsFov === CAMERA_FOV, "no dedicated zoom") renders at the live base FOV
    // and needs the same compensation as hip fire. Applied mid-switch too: the switch animation
    // used to write its own unscaled position.y while this block was skipped, so at any FOV but
    // 75 the gun popped between the two poses at the start and end of every switch.
    const tunedTan = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2);
    const hipScale = tunedTan / Math.tan(THREE.MathUtils.degToRad(baseFov) / 2);
    const adsScale = adsFov === CAMERA_FOV ? hipScale : 1;
    this.active.viewModel.position.multiplyScalar(THREE.MathUtils.lerp(hipScale, adsScale, this.aimAmount));

    if (this.switching) {
      // Holster drop: y slides from the compensated pose above (switchProgress 0, so a switch's
      // first and last frames meet the normal pose exactly) to the same fixed holster height the
      // animation always used (switchProgress 1). That end point is deliberately NOT scaled: it's
      // what puts the gun below the frame for the swap, and a scaled drop at FOV 110 would stop
      // short of the (wider) bottom edge. At FOV 75 the scale is 1 and this is the old animation.
      this.active.viewModel.position.y = THREE.MathUtils.lerp(
        this.active.viewModel.position.y,
        WEAPON_HIP_POSITION.y - WEAPON_HOLSTER_DROP,
        this.switchProgress,
      );
    } else {
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

    const slot = this.active;
    const { weapon, glowMaterials, magazine, magazineRestPosition } = slot;
    const { magazineSize, kind, burstCount } = weapon.definition;
    const ammoFrac = kind === 'melee' || !Number.isFinite(magazineSize) ? 1 : weapon.ammo / magazineSize;
    const reloadCharge = weapon.isReloading ? weapon.reloadProgress : 1;
    // Observe spent rounds in the pose pass, including the follow-up rounds of a burst.
    const fired = weapon.ammo < slot.previousAmmo;
    const burstRound = (magazineSize - weapon.ammo - 1) % (burstCount ?? 1);
    for (let i = 0; i < glowMaterials.length; i++) {
      const material = glowMaterials[i]!;
      const flashThisPip = material.userData.burstPip === undefined || material.userData.burstPip === burstRound;
      const shotFlash = fired && flashThisPip ? 6 : Math.max(0, slot.shotFlash[i]! - dt * 6 / 0.06);
      slot.shotFlash[i] = shotFlash;
      material.emissive.setHex(ammoFrac > 0.25 ? 0x6ff0dc : 0xe8a64a);
      material.emissiveIntensity = 2.5 * (0.3 + 0.7 * ammoFrac) * reloadCharge + shotFlash;
    }
    slot.previousAmmo = weapon.ammo;
    if (magazine) {
      const drop = weapon.isReloading ? Math.min(1, Math.sin(weapon.reloadProgress * Math.PI) * 1.6) : 0;
      magazine.position.copy(magazineRestPosition);
      magazine.position.y -= 0.22 * drop;
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
    // 'YXZ' yaw lives in [-PI, PI], so turning through the +/-180 degree seam reads as a ~2 PI jump
    // between ticks and the gun twitched to the opposite WEAPON_SWAY_MAX clamp. Wrapped back into
    // [-PI, PI]. Pitch needs no wrap: 'YXZ' keeps it within [-PI/2, PI/2].
    const yawDelta = THREE.MathUtils.euclideanModulo(euler.y - this.previousCameraYaw + Math.PI, Math.PI * 2) - Math.PI;
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
    const { pelletCount, recoilKick, kind, isProjectile } = this.active.weapon.definition;

    // camera has no parent, so .position IS the world position - avoids reading a stale
    // matrixWorld (only refreshed during render(), which runs after this fires each tick).
    const origin = this.camera.position.clone();
    const muzzleWorld = this.active.viewModel.position
      .clone()
      .add(this.active.muzzleLocalOffset)
      .applyQuaternion(this.camera.quaternion)
      .add(origin);

    if (isProjectile) {
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.onProjectileFire(origin, muzzleWorld, direction);
    } else {
      for (let i = 0; i < pelletCount; i++) {
        this.firePellet(origin, muzzleWorld, player.ownCollider);
      }
    }

    this.onFire(this.active.weapon.definition.id);
    // Melee has no muzzle - a flash there would be a light spawning out of a knife blade.
    if (kind === 'ranged') this.onMuzzleFlash(muzzleWorld, this.active.weapon.definition.id);
    player.addRecoil(recoilKick);
  }

  private firePellet(origin: THREE.Vector3, muzzleWorld: THREE.Vector3, excludeCollider: RAPIER.Collider): void {
    const { spreadRadians, adsSpreadMultiplier, range } = this.active.weapon.definition;
    const damage = this.active.weapon.effectiveDamage;
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
        target.takeDamage(damage, hit.colliderHandle, origin);
        if (hit.distance >= LONG_SHOT_DISTANCE) this.onLongShot(hit.distance);
      }
    }
  }
}
