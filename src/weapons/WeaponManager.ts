import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Weapon } from './Weapon.ts';
import { meleePose, type MeleeVariant } from './meleeSwing.ts';
import { falloffMultiplier, WEAPON_DEFINITIONS, type MeleeAttack } from './definitions.ts';
import {
  WEAPON_HIP_POSITION,
  type WeaponViewModel,
} from './viewModel.ts';
import { addClip, defaultMagazineReload, GUN_TRACK, inspectTurn, zeroOffset, type Clip, type PartOffset } from './animation/clips.ts';
import { PartAnimator } from './animation/PartAnimator.ts';
import { buildWeaponViewModel } from './models/weaponModels.ts';
import { SKIN_GLOW_INTENSITY } from './models/skinMaterials.ts';
import type { AttachmentId } from './models/attachments.ts';
import { DEFAULT_SKIN, SKINS, type SkinId } from './models/skins.ts';
import { castHitscan } from '../combat/hitscan.ts';
import { GRENADE_THROW_ANIMATION_SECONDS } from '../combat/grenades/grenadeTuning.ts';
import { isDamageable, type Damageable } from '../combat/damage.ts';
import { applySpreadCone } from '../combat/spread.ts';
import { recoilForShot, spreadForShot, SprayState } from './gunHandling.ts';

/** What one shot's handling came to (docs/gun-handling.md): its place in the burst, how far the
 * weapon was aimed, the cone it was drawn from and the kick it gave. */
export interface ShotRecord {
  readonly weaponId: string;
  readonly shotIndex: number;
  readonly aim: number;
  readonly spread: number;
  readonly bloom: number;
  readonly kick: number;
  readonly side: number;
}
const SHOT_LOG_LENGTH = 64;
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { Action } from '../input/actions.ts';
import type { Player } from '../entities/Player.ts';
import type { ScopeOverlay } from '../ui/scope.ts';
import { Settings } from '../settings/Settings.ts';
import { viewModelPointToWorldLens } from '../render/viewModelCamera.ts';
import {
  ADS_LERP_SPEED,
  ADS_MOTION_DAMPING,
  CAMERA_FOV,
  MELEE_SWING_DURATION,
  LONG_SHOT_DISTANCE,
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
  /** Poses the model's moving parts from the clips below (animation/clips.ts). */
  animator: PartAnimator;
  /** The weapon's reload clip, or the stock one for a magazine-fed model that defines none. */
  reloadClip: Clip | undefined;
  previousAmmo: number;
  /** Extra witness-light brightness from the last shot, decaying. */
  shotFlash: number;
  /** Seconds since this weapon last fired: the time base of its fire clip. */
  fireClock: number;
}

/** A blade strike that has started swinging and has yet to connect. */
interface PendingStrike {
  attack: MeleeAttack;
  /** Seconds until the next strike of this attack lands. */
  timer: number;
  /** Strikes still to come after that one (a flurry). */
  repeats: number;
}

/** How fast the view model blends into and out of the sprint tuck. */
const SPRINT_POSE_DAMP = 8;
/** The gun drops for a grenade at this damp rate, and starts back up this long before the throw ends. */
const THROW_POSE_DAMP = 18;
const THROW_RAISE_SECONDS = 0.15;
/** Sentinel for "has not fired": past the end of any fire clip. */
const IDLE_FIRE_CLOCK = 1000;
/** The whole-gun dip and roll of a reload for a weapon with neither a reload clip nor a magazine. */
const PLAIN_RELOAD: Clip = {
  duration: 1,
  tracks: {
    [GUN_TRACK]: [{ t: 0 }, { t: 0.5, p: [0, -0.08, 0], r: [0.5, 0, 0.35] }, { t: 1, p: [0, 0, 0], r: [0, 0, 0] }],
  },
};

const scratchForward = new THREE.Vector3();
const scratchUp = new THREE.Vector3();

export class WeaponManager {
  private readonly slots: WeaponSlot[];
  private activeIndex = 0;
  private aimAmount = 0;
  /** The burst the gun in hand is in: its shot count and the bloom it has built (gunHandling.ts). */
  private readonly spray = new SprayState();
  /** The cone this trigger pull's rounds are drawn from, set by fireShot for firePellet. */
  private shotSpread = 0;
  /** The last shots fired, newest last, for the browser tests (gameDebugApi getShotLog). */
  private readonly shotLog: ShotRecord[] = [];

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
  /** Burst-fire (see WeaponDefinition.burstCount, currently only the S5): rounds still owed from
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
  /** 0 to 1 blend into the sprint tuck (see updateAim). */
  private sprintPose = 0;
  /** Grenades (combat/grenades/GrenadeSystem.ts): a grenade cooking in the hand, then the throw's
   * GRENADE_THROW_ANIMATION_SECONDS. Either lowers the gun and blocks fire, aim and reload. */
  private grenadeInHand = false;
  private throwLowerTime = 0;
  /** 0 to 1 blend into the lowered pose (see updateAim). */
  private throwPoseAmount = 0;
  private meleeVariant: MeleeVariant = 'draw';
  private meleeProgress = 1;
  private meleeDuration = MELEE_SWING_DURATION;
  /** How many primary and alternate attacks have been made, so each attack walks its pose list. */
  private meleeCombo = { primary: 0, alt: 0 };
  private pendingStrike: PendingStrike | null = null;
  /** Seconds into a weapon inspect (G), or -1 when none is playing. */
  private inspectTime = -1;
  /** Reused every tick: this tick's clip offsets by part. */
  private readonly offsets = new Map<string, PartOffset>();

  private constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
    slots: WeaponSlot[],
    private readonly scopeOverlay: ScopeOverlay,
    private readonly onImpact: (point: THREE.Vector3, isEntityHit: boolean) => void,
    private readonly onTracer: (start: THREE.Vector3, end: THREE.Vector3) => void,
    private readonly onMeleeSwing: (origin: THREE.Vector3, weaponId: string) => void,
    private readonly onFire: (weaponId: string) => void,
    private readonly onReloadStart: (weaponId: string) => void,
    private readonly onLongShot: (distance: number) => void,
    private readonly onMuzzleFlash: (point: THREE.Vector3, weaponId: string) => void,
    /** Fires instead of the normal per-pellet hitscan loop for a weapon with isProjectile set (see
     * definitions.ts's WeaponDefinition.isProjectile) - currently only the Goose Launcher. */
    private readonly onProjectileFire: (origin: THREE.Vector3, muzzleWorld: THREE.Vector3, direction: THREE.Vector3) => void,
    /** Every ranged hitscan pellet's ray, with the distance to its physics hit (or its range). */
    private readonly onHitscanRay: ((origin: THREE.Vector3, direction: THREE.Vector3, distance: number, melee?: boolean) => void) | undefined,
    /** The player's skin per weapon id (core/skins.ts); a weapon with no entry wears the default. */
    private readonly skins: Readonly<Record<string, SkinId>>,
    /** What the player fitted to each gun (core/attachments.ts); a gun with no entry is bare. */
    private readonly attachments: Readonly<Record<string, readonly AttachmentId[]>>,
  ) {
    this.slots = slots;
    const first = this.slots[0];
    if (first) first.viewModel.visible = true;
    this.startMeleeDraw();
  }

  static async create(
    camera: THREE.PerspectiveCamera,
    physics: PhysicsWorld,
    definitionIds: string[],
    scopeOverlay: ScopeOverlay,
    onImpact: (point: THREE.Vector3, isEntityHit: boolean) => void,
    onTracer: (start: THREE.Vector3, end: THREE.Vector3) => void,
    onMeleeSwing: (origin: THREE.Vector3, weaponId: string) => void,
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
    /** Per ranged hitscan pellet: its origin, unit direction and the distance to its physics hit
     * or, on a miss, its range. Lets the Facility test the ray against its lamps
     * (docs/facility-map.md, section 11). A blade's strike rays call it too, with `melee` set, so a
     * window's glass (no collider) can be struck (docs/glass.md). The Goose Launcher never calls it. */
    onHitscanRay?: (origin: THREE.Vector3, direction: THREE.Vector3, distance: number, melee?: boolean) => void,
    /** The skin each weapon wears, by weapon id (core/skins.ts). */
    skins: Readonly<Record<string, SkinId>> = {},
    /** What is fitted to each gun, by weapon id (core/attachments.ts). */
    attachments: Readonly<Record<string, readonly AttachmentId[]>> = {},
  ): Promise<WeaponManager> {
    if (definitionIds.length === 0) throw new Error('WeaponManager needs at least one weapon definition');

    const slots = await Promise.all(
      definitionIds.map((id) => WeaponManager.buildSlot(camera, id, damageOverrides?.[id], initialReserveAmmo?.[id], skins[id] ?? DEFAULT_SKIN, attachments[id])),
    );

    return new WeaponManager(
      camera,
      physics,
      slots,
      scopeOverlay,
      onImpact,
      onTracer,
      onMeleeSwing,
      onFire,
      onReloadStart,
      onLongShot,
      onMuzzleFlash,
      onProjectileFire,
      onHitscanRay,
      skins,
      attachments,
    );
  }

  /** Shared by `create()` (initial loadout) and `replaceActiveWeapon` (Gun Game's kill-upgrade) -
   * builds one fully-formed slot (weapon + attached view model) for a single weapon id. */
  private static async buildSlot(
    camera: THREE.PerspectiveCamera,
    id: string,
    damageOverride: number | undefined,
    initialReserveAmmo: number | undefined,
    skinId: SkinId,
    attachments: readonly AttachmentId[] = [],
  ): Promise<WeaponSlot> {
    const definition = WEAPON_DEFINITIONS[id];
    if (!definition) throw new Error(`Unknown weapon definition: ${id}`);

    const { group, ...model } = buildWeaponViewModel(id, skinId, attachments);
    group.visible = false;
    camera.add(group);
    const reloads = definition.kind === 'ranged' && !definition.disableReload;
    return {
      weapon: new Weapon(definition, damageOverride, initialReserveAmmo),
      viewModel: group,
      ...model,
      animator: new PartAnimator(model.parts, model.model),
      reloadClip: reloads ? model.animations.reload ?? (model.parts.has('magazine') ? defaultMagazineReload() : PLAIN_RELOAD) : undefined,
      previousAmmo: definition.magazineSize,
      shotFlash: 0,
      fireClock: IDLE_FIRE_CLOCK,
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
    const newSlot = await WeaponManager.buildSlot(this.camera, definitionId, undefined, undefined, this.skins[definitionId] ?? DEFAULT_SKIN, this.attachments[definitionId]);
    if (oldSlot) {
      this.camera.remove(oldSlot.viewModel);
    }
    newSlot.viewModel.visible = true;
    this.slots[index] = newSlot;
    this.startMeleeDraw();
    // Same phantom-fire guard as beginSwitch - a kill upgrade can land while the player is still
    // holding fire from the kill itself, and the fresh weapon shouldn't inherit that as a press.
    this.fireLockedUntilRelease = true;
    // Same burst reset as beginSwitch, for the same reason: a burst in flight belongs to the weapon
    // that fired it. Without this, if round 1 of an S5 burst kills the golden goose, rounds 2-3
    // fire from the freshly granted Goose Launcher and spend half its 4 shots (likewise a Gun Game
    // kill-upgrade landing mid-burst).
    this.burstShotsRemaining = 0;
    this.burstShotTimer = 0;
    this.pendingStrike = null;
    this.inspectTime = -1;
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

  /** Whether an ammo box (pickups) would give any carried weapon anything (see Weapon.ammoPickupWouldGive). */
  ammoPickupWouldGive(maxReserveMagazines: number): boolean {
    return this.slots.some((slot) => slot.weapon.ammoPickupWouldGive(maxReserveMagazines));
  }

  /** An ammo box: stocks every carried weapon, not just the held one. True when any got something. */
  grantAmmoPickup(magazines: number, maxReserveMagazines: number): boolean {
    let gave = false;
    for (const slot of this.slots) gave = slot.weapon.grantAmmoPickup(magazines, maxReserveMagazines) || gave;
    return gave;
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

  /** The skin the held weapon wears: sent to the other players with the snapshot. */
  get activeSkinId(): SkinId {
    return this.active.skinId;
  }

  /** True while the held weapon is being looked over (G). */
  get isInspecting(): boolean {
    return this.inspectTime >= 0;
  }

  /** True while the gun in hand carries the weapon torch (docs/attachments.md): the player's torch
   * then shines from its front, and from the shoulder otherwise. */
  get torchOnGun(): boolean {
    return this.active.attachments.includes('torch');
  }

  /** True while the gun in hand carries a laser sight and is up: not mid-switch, and not replaced
   * by the scope picture. */
  get laserOn(): boolean {
    return this.active.attachments.includes('laser') && this.active.viewModel.visible && !this.switching;
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

  private get meleeBusy(): boolean {
    return this.active.weapon.definition.kind === 'melee' && (this.meleeProgress < 1 || this.pendingStrike !== null);
  }

  /** Whether a grenade throw may start: not while reloading, switching, mid blade swing or mid
   * burst, and not while one is already in the hand. */
  get canStartThrow(): boolean {
    return !this.active.weapon.isReloading && !this.switching && !this.meleeBusy && this.burstShotsRemaining === 0 && !this.handsBusy;
  }

  /** GrenadeSystem: a grenade is cooking in the hand (true), or a cook was dropped (false). */
  setGrenadeInHand(inHand: boolean): void {
    this.grenadeInHand = inHand;
    if (inHand) this.inspectTime = -1;
  }

  /** GrenadeSystem: the grenade just left the hand; the gun stays down for the throw. */
  beginThrowLower(): void {
    this.grenadeInHand = false;
    this.throwLowerTime = GRENADE_THROW_ANIMATION_SECONDS;
  }

  /** 0 to 1: how far the gun is lowered for a grenade, for the throw-arm view model. */
  get throwPose(): number {
    return this.throwPoseAmount;
  }

  /** 0 to 1 through the throw animation after a grenade leaves the hand, or null when none plays. */
  get throwProgress(): number | null {
    return this.throwLowerTime > 0 ? 1 - this.throwLowerTime / GRENADE_THROW_ANIMATION_SECONDS : null;
  }

  private get handsBusy(): boolean {
    return this.grenadeInHand || this.throwLowerTime > 0;
  }

  update(dt: number, input: InputManager, player: Player): void {
    const slot = this.active;
    slot.weapon.update(dt);
    if (slot.weapon.definition.spread) this.spray.update(dt, slot.weapon.definition.spread);
    slot.fireClock = Math.min(IDLE_FIRE_CLOCK, slot.fireClock + dt);
    if (this.inspectTime >= 0) this.inspectTime += dt;
    this.throwLowerTime = Math.max(0, this.throwLowerTime - dt);
    this.handleSwitchRequests(input);
    this.updateSwitching(dt);
    this.updatePendingStrike(dt, player);
    this.updateAim(dt, input, player);
    player.setMobility(this.active.weapon.definition.mobility ?? 1);

    if (this.switching) return;

    if (this.handsBusy) {
      // A grenade in hand or just thrown: no fire, no reload. A trigger still held when the gun
      // comes back up needs a fresh press, like after a switch.
      input.consumeJustPressed('fire');
      input.consumeJustPressed('reload');
      input.consumeJustPressed('inspect');
      if (input.isActionActive('fire')) this.fireLockedUntilRelease = true;
      return;
    }

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

    const definition = this.active.weapon.definition;
    if (input.consumeJustPressed('inspect')) this.tryStartInspect(input);
    // Anything the hands do ends a look at the weapon.
    if (this.inspectTime >= 0 && (input.isActionActive('fire') || input.isActionActive('aim'))) this.inspectTime = -1;

    if (definition.kind === 'melee') {
      // A blade strikes from its attack table: fire is the primary attack, fire while holding aim
      // the alternate one. The empty hands (no table) do nothing.
      if (definition.melee && !this.fireLockedUntilRelease && input.consumeJustPressed('fire')) {
        const alt = input.isActionActive('aim');
        const attack = alt ? definition.melee.alt : definition.melee.primary;
        if (this.active.weapon.tryFire(attack.cooldown)) this.startMeleeAttack(attack, alt);
      }
      return;
    }

    const firePressed =
      !this.fireLockedUntilRelease &&
      (definition.automatic ? input.isActionActive('fire') : input.consumeJustPressed('fire'));
    if (firePressed) {
      if (this.active.weapon.tryFire()) {
        this.fireShot(player);
        const burstCount = definition.burstCount ?? 1;
        if (burstCount > 1) {
          this.burstShotsRemaining = burstCount - 1;
          this.burstShotTimer = WEAPON_BURST_SHOT_INTERVAL_SECONDS;
        }
      } else if (this.active.weapon.ammo <= 0 && this.active.weapon.startReload()) {
        // Auto-reload: trying to fire an empty magazine starts a reload without needing manual R.
        this.beginReload();
      }
    }
    if (input.consumeJustPressed('reload') && this.active.weapon.startReload()) {
      this.beginReload();
    }

    // The Goose Launcher (or any future disableReload weapon) disappears the instant its magazine
    // empties - see grantBonusWeapon. Cleared before the async rebuild starts so a slow asset load
    // can't re-trigger this next frame.
    if (this.pendingRestoreId !== null && definition.disableReload && this.active.weapon.ammo <= 0) {
      const restoreId = this.pendingRestoreId;
      this.pendingRestoreId = null;
      void this.replaceActiveWeapon(restoreId);
    }
  }

  private beginReload(): void {
    this.inspectTime = -1;
    this.onReloadStart(this.active.weapon.definition.id);
  }

  /** G: look the weapon over. Only from rest: not aiming, reloading, mid swing or mid burst. */
  private tryStartInspect(input: InputManager): void {
    if (this.active.weapon.definition.id === 'unarmed') return;
    if (this.inspectTime >= 0 || this.active.weapon.isReloading || this.meleeBusy || input.isActionActive('aim')) return;
    this.inspectTime = 0;
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
    this.meleeProgress = 1;
    this.pendingStrike = null;
    this.inspectTime = -1;
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
        this.spray.reset();
        this.startMeleeDraw();
      }
    } else {
      this.switchProgress = Math.max(0, this.switchProgress - step);
      if (this.switchProgress <= 0) {
        this.switching = false;
      }
    }
    // The holster/draw pose itself is written by updateAim (runs right after this, same tick), so
    // it starts and ends exactly on the normal pose there.
  }

  private updateAim(dt: number, input: InputManager, player: Player): void {
    const slot = this.active;
    const { weapon } = slot;
    const { adsFov, hasScope, adsSpeed } = weapon.definition;
    const isMelee = weapon.definition.kind === 'melee';
    const targetAim = !isMelee && !this.switching && !this.handsBusy && input.isActionActive('aim') ? 1 : 0;
    this.aimAmount = THREE.MathUtils.damp(this.aimAmount, targetAim, adsSpeed ?? ADS_LERP_SPEED, dt);
    if (isMelee) this.aimAmount = 0;

    // The user's live FOV setting (see settings/Settings.ts), not the bare CAMERA_FOV constant -
    // read fresh every frame so a mid-match Settings.setFov() change applies on the very next
    // tick, same "just re-read Settings continuously" pattern applyLook's mouse-sensitivity read
    // already uses. Weapons authored with `adsFov: CAMERA_FOV` (see definitions.ts) are the ones
    // that deliberately have no dedicated zoom of their own - that literal value is a sentinel for
    // "same as hip fire," so it needs to track the live setting too, not stay pinned to the old
    // hardcoded default while every other weapon's hip fire already moved.
    const baseFov = Settings.getFov();
    const effectiveAdsFov = isMelee || adsFov === CAMERA_FOV ? baseFov : adsFov;
    this.camera.fov = THREE.MathUtils.lerp(baseFov, effectiveAdsFov, this.aimAmount);
    this.camera.updateProjectionMatrix();

    this.updateWeaponSway(dt);

    // The view model draws with its own fixed lens (VIEW_MODEL_FOV, see render/viewModelCamera.ts),
    // so neither the FOV setting nor the aim zoom above changes how the gun looks: the poses are
    // plain camera-space positions. Full aim puts this model's own sight on the screen centre.
    slot.viewModel.position.lerpVectors(WEAPON_HIP_POSITION, slot.adsPosition, this.aimAmount);
    // Bob and sway fade out while aiming so the sight stays steady on the centre.
    const handMotion = 1 - ADS_MOTION_DAMPING * this.aimAmount;

    // The hands' own lag behind the look, every tick: a weapon being put away keeps no tilt from
    // the sprint it was drawn out of.
    slot.viewModel.rotation.set(this.swayPitch * handMotion, this.swayYaw * handMotion, 0);

    if (this.switching) {
      // Holster drop: y slides from the pose above (switchProgress 0, so a switch's first and last
      // frames meet the normal pose exactly) to the fixed holster height below the frame
      // (switchProgress 1).
      slot.viewModel.position.y = THREE.MathUtils.lerp(
        slot.viewModel.position.y,
        WEAPON_HIP_POSITION.y - WEAPON_HOLSTER_DROP,
        this.switchProgress,
      );
    } else {
      // Same shared phase the camera bob uses (see Player.movementBobPhase) - the weapon and the
      // camera bob together rather than independently, matching the doc's framing of one phase
      // driving both.
      slot.viewModel.position.y +=
        Math.sin(player.movementBobPhase) * WEAPON_BOB_AMPLITUDE * player.movementBobStrength * handMotion;

      // Sprint carry: the weapon comes down and across the body a little, muzzle to the left and
      // canted, with both hands still on it. A harder swing (it was 0.55 rad of yaw) put the gun
      // across the middle of the view and left the support hand hanging in mid-screen.
      const sprinting = this.aimAmount < 0.05 && input.isActionActive('sprint') && player.movementBobStrength > 0.5;
      this.sprintPose = THREE.MathUtils.damp(this.sprintPose, sprinting ? 1 : 0, SPRINT_POSE_DAMP, dt);
      const sp = this.sprintPose;
      slot.viewModel.position.x += 0.015 * sp;
      slot.viewModel.position.y -= 0.055 * sp;
      slot.viewModel.rotation.x -= 0.1 * sp;
      slot.viewModel.rotation.y += 0.22 * sp;
      slot.viewModel.rotation.z = 0.2 * sp;
    }

    if (isMelee) {
      const pose = meleePose(this.meleeProgress, this.meleeVariant);
      slot.viewModel.position.x += pose.px;
      slot.viewModel.position.y += pose.py;
      slot.viewModel.position.z += pose.pz;
      slot.viewModel.rotation.x += pose.rx;
      slot.viewModel.rotation.y += pose.ry;
      slot.viewModel.rotation.z += pose.rz;
      this.meleeProgress = Math.min(1, this.meleeProgress + dt / this.meleeDuration);
    }

    this.poseParts(slot);
    this.updateWitnessLight(slot, dt);

    // Grenade: the gun drops out of the way while one is in hand, and comes back up at the end of
    // the throw.
    this.throwPoseAmount = THREE.MathUtils.damp(this.throwPoseAmount, this.grenadeInHand || this.throwLowerTime > THROW_RAISE_SECONDS ? 1 : 0, THROW_POSE_DAMP, dt);
    slot.viewModel.position.y -= WEAPON_HOLSTER_DROP * this.throwPoseAmount;

    const scopeShouldShow = hasScope && this.aimAmount >= SCOPE_REVEAL_THRESHOLD;
    this.scopeOverlay.setVisible(scopeShouldShow);
    slot.viewModel.visible = !scopeShouldShow;
  }

  /** Poses the model's moving parts for this tick: the reload, the cycling action after a shot, an
   * inspect, and the stock sliding out of view as the weapon is aimed. */
  private poseParts(slot: WeaponSlot): void {
    const offsets = this.offsets;
    offsets.clear();
    const { weapon, animations } = slot;
    if (weapon.isReloading) addClip(offsets, slot.reloadClip, weapon.reloadProgress);
    if (animations.fire && slot.fireClock < animations.fire.duration) {
      addClip(offsets, animations.fire, slot.fireClock);
      // The gun's own kick fades out with aim: at full aim the sights stay exactly on the aim
      // point (the camera's recoil still moves the view).
      const kick = offsets.get(GUN_TRACK);
      if (kick && !weapon.isReloading) {
        const keep = 1 - this.aimAmount;
        kick.px *= keep; kick.py *= keep; kick.pf *= keep;
        kick.pitch *= keep; kick.yaw *= keep; kick.roll *= keep;
      }
    }
    if (this.inspectTime >= 0) {
      const turn = inspectTurn(SKINS[slot.skinId].inspect);
      if (this.inspectTime >= turn.duration) {
        this.inspectTime = -1;
      } else {
        addClip(offsets, turn, this.inspectTime);
        addClip(offsets, animations.inspect, this.inspectTime);
      }
    }
    if (this.aimAmount > 0.001) {
      for (const part in slot.aimRetract) {
        let offset = offsets.get(part);
        if (!offset) {
          offset = zeroOffset();
          offsets.set(part, offset);
        }
        offset.pf -= slot.aimRetract[part]! * this.aimAmount;
      }
    }
    slot.animator.apply(offsets);
  }

  /** The ammo witness light: dims as the magazine empties, turns to the skin's warning colour on
   * the last quarter, recharges through a reload and flashes on each shot. */
  private updateWitnessLight(slot: WeaponSlot, dt: number): void {
    const { weapon, glowMaterials } = slot;
    const fired = weapon.ammo < slot.previousAmmo;
    slot.previousAmmo = weapon.ammo;
    slot.shotFlash = fired ? 6 : Math.max(0, slot.shotFlash - dt * 6 / 0.06);
    if (glowMaterials.length === 0) return;
    const { magazineSize, kind } = weapon.definition;
    const ammoFrac = kind === 'melee' || !Number.isFinite(magazineSize) ? 1 : weapon.ammo / magazineSize;
    const reloadCharge = weapon.isReloading ? weapon.reloadProgress : 1;
    const glow = SKINS[slot.skinId].glow;
    for (const material of glowMaterials) {
      material.emissive.setHex(ammoFrac > 0.25 ? glow.full : glow.low);
      material.emissiveIntensity = SKIN_GLOW_INTENSITY * (0.3 + 0.7 * ammoFrac) * reloadCharge + slot.shotFlash;
    }
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

  private startMeleeDraw(): void {
    this.meleeProgress = this.active.weapon.definition.kind === 'melee' ? 0 : 1;
    this.meleeVariant = 'draw';
    this.meleeDuration = MELEE_SWING_DURATION;
    this.pendingStrike = null;
  }

  /** Starts a blade attack: the swing shows at once, the blade connects `hitAt` seconds in. */
  private startMeleeAttack(attack: MeleeAttack, alt: boolean): void {
    const which = alt ? 'alt' : 'primary';
    this.meleeVariant = attack.poses[this.meleeCombo[which] % attack.poses.length]!;
    this.meleeCombo[which]++;
    this.meleeProgress = 0;
    this.meleeDuration = attack.duration;
    this.inspectTime = -1;
    this.pendingStrike = { attack, timer: attack.hitAt, repeats: attack.repeats ?? 0 };
    const id = this.active.weapon.definition.id;
    // camera has no parent, so .position IS the world position.
    this.onMeleeSwing(this.camera.position.clone(), id);
    this.onFire(id);
  }

  private updatePendingStrike(dt: number, player: Player): void {
    const strike = this.pendingStrike;
    if (!strike) return;
    strike.timer -= dt;
    if (strike.timer > 0) return;
    this.resolveMeleeStrike(strike.attack, player.ownCollider);
    if (strike.repeats > 0) {
      strike.repeats--;
      strike.timer += strike.attack.repeatInterval ?? 0.15;
    } else {
      this.pendingStrike = null;
    }
  }

  /** The moment a blade connects: a fan of rays across the strike. Each target takes the attack's
   * damage once, however many rays find it. The centre ray is cast first, so a strike aimed at a
   * head counts as one. */
  private resolveMeleeStrike(attack: MeleeAttack, excludeCollider: RAPIER.Collider): void {
    const origin = this.camera.position.clone();
    const damage = this.active.weapon.damageOverride ?? attack.damage;
    scratchForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    scratchUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const struck = new Set<Damageable>();
    for (let i = 0; i < attack.rays; i++) {
      // Centre first, then alternating outward: 0, +1, -1, +2, -2 steps of the fan.
      const step = Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
      const steps = Math.max(1, Math.floor(attack.rays / 2));
      const angle = attack.rays === 1 ? 0 : (step / steps) * attack.spread;
      const direction = scratchForward.clone().applyAxisAngle(scratchUp, angle);
      const hit = castHitscan(this.physics, origin, direction, attack.range, excludeCollider);
      // Things that are not physics colliders (a window's glass) are struck along the same ray.
      this.onHitscanRay?.(origin, direction, hit ? hit.distance : attack.range, true);
      if (!hit) continue;
      const target = this.physics.getEntity(hit.colliderHandle);
      if (isDamageable(target)) {
        if (struck.has(target)) continue;
        struck.add(target);
        this.onImpact(hit.point, true);
        target.takeDamage(damage, hit.colliderHandle, origin);
      } else if (i === 0) {
        this.onImpact(hit.point, false);
      }
    }
  }

  /** One trigger pull of a gun: independent hit rays and one visual shot. */
  /** Test hook: the last shots' handling, oldest first. */
  get recentShots(): readonly ShotRecord[] {
    return this.shotLog;
  }

  private fireShot(player: Player): void {
    const slot = this.active;
    const { pelletCount, recoilKick, recoilSide, isProjectile, id, spread, recoil, spreadRadians, adsSpreadMultiplier } = slot.weapon.definition;
    slot.fireClock = 0;
    this.inspectTime = -1;
    // Where this pull's rounds may go: the gun's own error when aimed, the hip's and the feet's
    // when not, plus what the burst so far has shaken loose (docs/gun-handling.md).
    this.shotSpread = spread
      ? spreadForShot(spread, this.aimAmount, this.spray.bloom, player.movementBobStrength)
      : THREE.MathUtils.lerp(spreadRadians, spreadRadians * adsSpreadMultiplier, this.aimAmount);

    // camera has no parent, so .position IS the world position - avoids reading a stale
    // matrixWorld (only refreshed during render(), which runs after this fires each tick).
    const origin = this.camera.position.clone();
    const muzzleWorld = slot.viewModel.position
      .clone()
      .add(slot.muzzleLocalOffset)
      .applyQuaternion(this.camera.quaternion)
      .add(origin);

    if (isProjectile) {
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.onProjectileFire(origin, muzzleWorld, direction);
    } else {
      // The tracer is drawn by the world camera, whose FOV differs from the gun's fixed lens (the
      // setting, the aim zoom), so it starts from the point the world camera shows where the
      // player sees the muzzle. The flash stays at muzzleWorld: it draws with the gun.
      const tracerStart = viewModelPointToWorldLens(
        slot.viewModel.position.clone().add(slot.muzzleLocalOffset),
        this.camera.fov,
      ).applyQuaternion(this.camera.quaternion).add(origin);
      for (let i = 0; i < pelletCount; i++) {
        this.firePellet(origin, tracerStart, player.ownCollider);
      }
    }

    this.onFire(id);
    this.onMuzzleFlash(muzzleWorld, id);
    if (recoil && spread) {
      // The kick follows the burst: full climb for its first rounds, then a smaller one that weaves.
      const kick = recoilForShot(recoil, this.spray.shotIndex, this.aimAmount, Math.random() * 2 - 1);
      player.addRecoil(kick.kick, kick.side);
      this.shotLog.push({ weaponId: id, shotIndex: this.spray.shotIndex, aim: this.aimAmount, spread: this.shotSpread, bloom: this.spray.bloom, kick: kick.kick, side: kick.side });
      if (this.shotLog.length > SHOT_LOG_LENGTH) this.shotLog.shift();
      this.spray.shot(spread);
    } else {
      player.addRecoil(recoilKick, (Math.random() * 2 - 1) * (recoilSide ?? 0));
    }
  }

  private firePellet(origin: THREE.Vector3, tracerStart: THREE.Vector3, excludeCollider: RAPIER.Collider): void {
    const { weapon } = this.active;
    const { falloff } = weapon.definition;

    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    applySpreadCone(direction, this.shotSpread);

    // camera.position sits inside the player's own capsule (EYE_OFFSET is well within its
    // radius/height), so without excluding it every shot immediately self-hit at distance 0.
    const hit = castHitscan(this.physics, origin, direction, HITSCAN_RANGE, excludeCollider);

    const tracerEnd = hit ? hit.point : origin.clone().add(direction.clone().multiplyScalar(HITSCAN_RANGE));
    this.onTracer(tracerStart, tracerEnd);
    this.onHitscanRay?.(origin, direction, hit ? hit.distance : HITSCAN_RANGE);

    if (hit) {
      const target = this.physics.getEntity(hit.colliderHandle);
      const isEntityHit = isDamageable(target);
      this.onImpact(hit.point, isEntityHit);
      if (isDamageable(target)) {
        // A mode's damage override (a guaranteed one-hit kill) holds at any range.
        const damage = weapon.damageOverride ?? weapon.definition.damage * falloffMultiplier(falloff, hit.distance);
        target.takeDamage(damage, hit.colliderHandle, origin);
        if (hit.distance >= LONG_SHOT_DISTANCE) this.onLongShot(hit.distance);
      }
    }
  }
}
