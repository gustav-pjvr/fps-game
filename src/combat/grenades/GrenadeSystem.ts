import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../../physics/PhysicsWorld.ts';
import type { Player } from '../../entities/Player.ts';
import type { InputManager } from '../../input/InputManager.ts';
import type { SoundEngine } from '../../audio/SoundEngine.ts';
import type { DamageEventMessage, GrenadeDetonatedMessage, GrenadeThrownMessage, PlayerSlot } from '../../network/protocol.ts';
import type { GrenadeMessageReceiver } from '../../network/MatchMessageRouter.ts';
import { computeKnockbackStrength } from '../explosion.ts';
import { computeStereoPan, enemyGunshotVolume, grenadeBounceVolume } from '../../core/positionalAudio.ts';
import { GRAVITY } from '../../core/config.ts';
import { FlashBlindness, flashSeconds, flashStrength } from './flashStrength.ts';
import { predictArc, stepGrenade, type ArcPrediction, type FlightParams, type GrenadeBody, type Sweep, type Vec3 } from './grenadeFlight.ts';
import { blastReaches, CameraShake, flashCosAngle, yawViewDirection } from './grenadeBlast.ts';
import { GrenadeHand } from './grenadeHand.ts';
import { buildGrenadeModel } from './grenadeModels.ts';
import {
  computeFragDamage,
  FLASH_ENEMY_MAX_SECONDS,
  FLASH_LIGHT_INTENSITY,
  FLASH_LIGHT_RANGE,
  FLASH_LIGHT_SECONDS,
  FLASH_PLAYER_MAX_SECONDS,
  FRAG_KNOCKBACK_STRENGTH,
  FRAG_LAMP_RADIUS,
  FRAG_LIGHT_INTENSITY,
  FRAG_LIGHT_RANGE,
  FRAG_LIGHT_SECONDS,
  FRAG_RADIUS,
  fragShakeAmplitude,
  GRENADE_FRICTION,
  GRENADE_FUSE,
  GRENADE_HAND_OFFSET,
  GRENADE_ORPHAN_GRACE_SECONDS,
  GRENADE_RADIUS,
  GRENADE_REST_SPEED,
  GRENADE_RESTITUTION,
  GRENADE_THROW_ANIMATION_SECONDS,
  GRENADE_THROW_SPEED,
  type GrenadeKind,
} from './grenadeTuning.ts';
import { GRENADE_LEAVES_HAND_AT } from '../../weapons/grenadeThrowPose.ts';

/**
 * Frag and flash grenades in play (docs/grenades.md, design: docs/squad-arsenal-night.md section 3):
 * the carry and the cook (GrenadeHand), every live grenade's flight (grenadeFlight.ts against a
 * Rapier shape cast), and what happens when one goes off.
 *
 * Authority is the thrower's, like the Goose Launcher: the thrower's copy decides where and when it
 * goes off, deals the frag's damage (its own player and enemies directly, opponents through
 * damageEvent with weaponId 'frag') and shoots out Facility lamps; every other client flies a copy
 * from grenadeThrown for the visuals and plays the effect on grenadeDetonated. A flash is judged by
 * each client for its own player. Knockback is applied by each client to its own player (in co-op
 * only from its own frags). The frag's fireball, smoke and scorch are FragExplosion's, spawned by
 * GrenadeEffects from the detonation listener; this system only lights it.
 *
 * The read-only getters at the bottom are the seams the HUD, view model and effects draw from.
 */

/** Another player, as the frag's damage and the late-joiner resend see them. */
export interface GrenadeOpponent {
  readonly slot: PlayerSlot;
  readonly position: THREE.Vector3;
  /** Their RemotePlayer: a wall-check ray that hits their own collider has reached them. */
  readonly entity: object;
  readonly isDead: boolean;
}

export interface GrenadeNetwork {
  readonly ownSlot: PlayerSlot;
  send(message: GrenadeThrownMessage | GrenadeDetonatedMessage | DamageEventMessage): void;
  opponents(): Iterable<GrenadeOpponent>;
}

/** The single-player enemies' side (EntityManager). */
export interface GrenadeTargets {
  applyBlast(
    position: THREE.Vector3,
    damageAt: (distance: number) => number,
    reaches: (center: THREE.Vector3, entity: object, exclude?: RAPIER.RigidBody) => boolean,
  ): void;
  applyFlash(judge: (eye: THREE.Vector3, yaw: number, entity: object, exclude?: RAPIER.RigidBody) => number): number;
  notifyGunshot(origin: THREE.Vector3, weaponId?: string): void;
}

/** What the hand is doing, for WeaponManager: a cook started (gun down, no fire or aim), the
 * grenade left the hand (the 0.45 s throw), or a cook was dropped. */
export type GrenadeHandState = 'cooking' | 'thrown' | 'empty';

export interface GrenadeSystemOptions {
  readonly scene: THREE.Scene;
  readonly physics: PhysicsWorld;
  readonly camera: THREE.Camera;
  readonly player: Player;
  /** gameModes.ts grenadesEnabled for this match: off, the player carries none. */
  readonly enabled: boolean;
  /** The loadout's grenade, read once at match start: the only kind the player carries and throws
   * this match. Other players' kinds arrive in grenadeThrown. */
  readonly kind: GrenadeKind;
  readonly sound: SoundEngine;
  readonly targets: GrenadeTargets;
  /** Null in single-player. */
  readonly network: GrenadeNetwork | null;
  /** False in co-op (Goose Horde): a frag hurts and pushes no other player, only enemies, geese and
   * the thrower. Default true. */
  readonly friendlyFire?: boolean;
  /** The terrain height, where a world has one (the Valley): a last floor under streamed-out ground. */
  readonly floor?: (x: number, z: number) => number;
  /** False while WeaponManager refuses a throw (a reload, a knife swing). */
  canStartThrow(): boolean;
  onHandChange(state: GrenadeHandState): void;
  /** Facility only: shoot out every live lamp within `radius` (through the lampDestroyed path). */
  shootLampsNear(position: THREE.Vector3, radius: number): void;
}

/** A live grenade as the visuals see it. */
export interface LiveGrenadeView {
  readonly id: string;
  readonly kind: GrenadeKind;
  /** Thrown by this client's player. */
  readonly own: boolean;
  readonly position: Readonly<Vec3>;
  readonly fuseLeft: number;
  readonly resting: boolean;
}

export interface GrenadeDetonation {
  readonly id: string;
  readonly kind: GrenadeKind;
  readonly position: Readonly<Vec3>;
  readonly own: boolean;
  /** GrenadeSystem's clock (seconds of play) when it went off. */
  readonly at: number;
  /** A frag's: the surface it went off on or against (for the scorch and the dust ring), or null in
   * the air. Always null for a flash. */
  readonly surface: GrenadeSurface | null;
}

export interface GrenadeSurface {
  readonly point: Readonly<Vec3>;
  /** Unit normal, out of the surface. */
  readonly normal: Readonly<Vec3>;
}

export interface GrenadeDebug {
  readonly enabled: boolean;
  /** The kind the player carries (the loadout's) and how many. */
  readonly kind: GrenadeKind;
  readonly count: number;
  readonly cooking: { kind: GrenadeKind; fuseLeft: number } | null;
  readonly live: LiveGrenadeView[];
  readonly blindLevel: number;
  readonly cameraShake: number;
  readonly lastDetonation: GrenadeDetonation | null;
  readonly detonations: number;
}

interface LiveGrenade {
  readonly id: string;
  readonly kind: GrenadeKind;
  readonly own: boolean;
  /** Who threw a copy (grenadeThrown.senderSlot); null for this client's own. Only they may resend
   * or detonate it. */
  readonly thrower: PlayerSlot | null;
  body: GrenadeBody;
  fuseLeft: number;
  /** A copy's sender clock (grenadeThrown.t): a later resend replaces its state. */
  sentAt: number;
  /** Its model (grenadeModels.ts), from the per-kind pool. */
  readonly mesh: THREE.Object3D;
  /** The world axis it tumbles about in flight, and how fast (radians a second, halved per bounce). */
  readonly spinAxis: THREE.Vector3;
  spinRate: number;
  /** What liveViews() hands out for it: one object for its whole life, refreshed on each call. */
  readonly view: { id: string; kind: GrenadeKind; own: boolean; position: Vec3; fuseLeft: number; resting: boolean };
  /** This system's clock at its last bounce clink, so a rattle on the floor is not a buzz. */
  lastClinkAt: number;
  /** Seconds the model stays hidden: an own throw is still in the view-model hand until then. */
  hiddenFor: number;
}

/** The blast's rays and the flash's sight line start this far above the grenade, clear of the floor. */
const BLAST_LIFT = 0.1;
/** A blast point found inside a fixed collider has its rays start this far outside its nearest face. */
const OUTSIDE_SOLID_MARGIN = 0.03;
/** A frag's surface: looked for this far below it, and this far in the other five directions. */
const SURFACE_PROBE_DOWN = 0.5;
const SURFACE_PROBE_SIDE = 0.35;
const SURFACE_PROBE_DIRECTIONS = [
  { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 },
] as const;
/** The frag lights the scene from this far off its surface, so the ground round it catches it. */
const FRAG_LIGHT_LIFT = 0.6;
const FRAG_LIGHT_COLOR = 0xffa850;
const FLASH_LIGHT_COLOR = 0xf4f6ff;
/** An own throw's world copy shows once the view-model hand has let go of it (grenadeThrowPose). */
const OWN_THROW_HIDDEN_SECONDS = GRENADE_LEAVES_HAND_AT * GRENADE_THROW_ANIMATION_SECONDS;
/** Copies of other players' grenades at once; more grenadeThrown than this are ignored. */
const MAX_REMOTE_GRENADES = 32;
/** Grenade ids remembered after going off, so a late resend does not fly one again. */
const FINISHED_ID_MEMORY = 64;
const RECENT_DETONATIONS = 8;
/** The arc preview: sampled every ARC_STEP seconds for at most ARC_MAX_TIME. */
const ARC_STEP = 1 / 20;
const ARC_MAX_TIME = 3;
/** The preview's arc is recomputed this often while cooking (a 60-cast prediction per tick is too much). */
const ARC_REFRESH_SECONDS = 1 / 15;
/** A player moving faster than this between ticks teleported (a respawn): no throw momentum. */
const MAX_THROWER_SPEED = 15;
/** A thrown grenade tumbles end over end this fast (radians a second); each bounce halves it. */
const SPIN_RATE = 14;
/** Live grenades are drawn this much bigger than life (the view-model hand's copy is not): at true
 * size one was a speck a few metres off. */
const WORLD_MODEL_SCALE = 1.35;
/** Bounce clinks: none for a contact slower than this (m/s, a grenade rolling or settling), and at
 * most one per grenade per CLINK_INTERVAL seconds. */
const CLINK_MIN_SPEED = 1.2;
const CLINK_INTERVAL = 0.09;
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const UP = new THREE.Vector3(0, 1, 0);

export class GrenadeSystem implements GrenadeMessageReceiver {
  private readonly hand: GrenadeHand;
  private readonly live = new Map<string, LiveGrenade>();
  private readonly finished: string[] = [];
  private readonly blindness = new FlashBlindness();
  private readonly shake = new CameraShake();
  private readonly seenOpponents = new Set<PlayerSlot>();
  private readonly detonations: GrenadeDetonation[] = [];
  private detonationCount = 0;
  private readonly detonationListeners: ((detonation: GrenadeDetonation) => void)[] = [];
  /** Models of grenades that went off, kept for the next throw of the same kind. */
  private readonly modelPool: Record<GrenadeKind, THREE.Object3D[]> = { frag: [], flash: [] };
  /** The flash's and the frag's light. Made once and only ever brightened: the Facility's lit
   * materials compile for a fixed light count, so a light added mid-match would recompile every
   * one of them. */
  private readonly blastLight: THREE.PointLight | null;
  private blastLightTime = 0;
  private blastLightSeconds = FLASH_LIGHT_SECONDS;
  private blastLightPeak = FLASH_LIGHT_INTENSITY;
  private readonly ball = new RAPIER.Ball(GRENADE_RADIUS);
  private readonly params: FlightParams;
  /** The own grenades' sweep and the copies' (which also meet the local player's capsule). */
  private readonly sweep: Sweep;
  private readonly remoteSweep: Sweep;
  private readonly idPrefix: string;
  private nextId = 0;
  private clock = 0;
  private arc: ArcPrediction | null = null;
  private arcAge = 0;
  private readonly viewList: LiveGrenadeView[] = [];
  private readonly lastPlayerPosition = new THREE.Vector3();
  private hasLastPlayerPosition = false;
  private readonly playerVelocity = new THREE.Vector3();

  constructor(private readonly options: GrenadeSystemOptions) {
    this.hand = new GrenadeHand(options.kind, options.enabled);
    this.params = {
      gravity: GRAVITY,
      restitution: GRENADE_RESTITUTION,
      friction: GRENADE_FRICTION,
      restSpeed: GRENADE_REST_SPEED,
      radius: GRENADE_RADIUS,
      floor: options.floor,
    };
    this.sweep = (from, displacement) => this.castSweep(from, displacement, true);
    this.remoteSweep = (from, displacement) => this.castSweep(from, displacement, false);
    this.idPrefix = `${options.network?.ownSlot ?? 0}${Math.floor(Math.random() * 36 ** 4).toString(36)}-`;
    if (options.enabled) {
      this.blastLight = new THREE.PointLight(FLASH_LIGHT_COLOR, 0, FLASH_LIGHT_RANGE, 2);
      options.scene.add(this.blastLight);
    } else {
      this.blastLight = null;
    }
  }

  /** One simulation tick. `input` is null while the local player is frozen (dead, paused, mission
   * won): a cook in progress is dropped. Live grenades carry on regardless. The screen effects
   * (shake, white-out, blast light) are tickEffects', which Game calls on every tick, simulating or not. */
  update(dt: number, input: InputManager | null): void {
    this.clock += dt;
    this.trackPlayerVelocity(dt);
    this.updateHand(dt, input);

    for (const grenade of Array.from(this.live.values())) {
      const step = stepGrenade(grenade.body, dt, grenade.own ? this.sweep : this.remoteSweep, this.params);
      grenade.mesh.position.set(grenade.body.position.x, grenade.body.position.y, grenade.body.position.z);
      if (grenade.hiddenFor > 0) {
        grenade.hiddenFor -= dt;
        grenade.mesh.visible = grenade.hiddenFor <= 0;
      }
      if (step.impactSpeed > 0) grenade.spinRate *= 0.5;
      if (step.impactSpeed >= CLINK_MIN_SPEED && this.clock - grenade.lastClinkAt >= CLINK_INTERVAL) {
        grenade.lastClinkAt = this.clock;
        const { distance, pan } = this.hearing(grenade.mesh.position);
        const volume = grenadeBounceVolume(distance, step.impactSpeed);
        if (volume > 0.01) this.options.sound.playGrenadeBounce(volume, pan);
      }
      if (!grenade.body.resting) grenade.mesh.rotateOnWorldAxis(grenade.spinAxis, grenade.spinRate * dt);
      grenade.fuseLeft -= dt;
      if (grenade.own && grenade.fuseLeft <= 0) {
        this.detonateOwn(grenade.id, grenade.kind, grenade.mesh.position.clone());
      } else if (!grenade.own && grenade.fuseLeft <= -GRENADE_ORPHAN_GRACE_SECONDS) {
        // Its grenadeDetonated never came (a lost message, the thrower left): dropped quietly.
        this.removeLive(grenade.id);
      }
    }

  }

  /** Decays the camera shake, the white-out (and so the muffle and ring) and the blast light. Game
   * calls it on every tick, also while the simulation is frozen (dead, paused, mission won, match
   * ended): the render frame keeps drawing these, and they must run out rather than hang on. */
  tickEffects(dt: number): void {
    this.blindness.update(dt);
    this.shake.update(dt);
    if (this.blastLight && this.blastLightTime > 0) {
      this.blastLightTime = Math.max(0, this.blastLightTime - dt);
      const left = this.blastLightTime / this.blastLightSeconds;
      this.blastLight.intensity = this.blastLightPeak * left * left;
    }
  }

  /** Spawn and respawn: a full carry, nothing in the hand, eyes and camera clear. Grenades already
   * thrown stay where they are. */
  resetForSpawn(): void {
    this.hand.reset();
    this.blindness.reset();
    this.shake.reset();
    this.arc = null;
    this.hasLastPlayerPosition = false;
    this.options.onHandChange('empty');
  }

  /** A single-player match reset: as a respawn, and every live grenade is gone. */
  resetMatch(): void {
    for (const id of Array.from(this.live.keys())) this.removeLive(id);
    this.resetForSpawn();
  }

  /** Offsets `camera` by the frags' shake. Called per render frame after the camera's own
   * interpolation, which rewrites its position, so the offset never accumulates. */
  applyCameraShake(camera: THREE.Camera, seconds: number): void {
    const offset = this.shake.offset(seconds);
    camera.position.x += offset.x;
    camera.position.y += offset.y;
    camera.position.z += offset.z;
  }

  /** Test hook (gameDebugApi.ts throwGrenade): throws one of the carried kind at once with a full
   * fuse, along `direction` (default: the aim). Spends it from the carry; the id, or null with none
   * left. */
  debugThrow(direction?: Vec3): string | null {
    if (!this.hand.take()) return null;
    const kind = this.hand.kind;
    return this.spawnOwn(kind, GRENADE_FUSE[kind], direction);
  }

  dispose(): void {
    for (const grenade of this.live.values()) this.options.scene.remove(grenade.mesh);
    this.live.clear();
    if (this.blastLight) this.options.scene.remove(this.blastLight);
    this.modelPool.frag.length = 0;
    this.modelPool.flash.length = 0;
    this.detonationListeners.length = 0;
  }

  // ---- network (GrenadeMessageReceiver) ----

  receiveThrown(message: GrenadeThrownMessage): void {
    if (message.senderSlot === this.options.network?.ownSlot || this.finished.includes(message.id)) return;
    const existing = this.live.get(message.id);
    if (existing) {
      // A late joiner's resend also reaches everyone else: a newer one re-syncs the copy.
      if (existing.own || existing.thrower !== message.senderSlot || !(message.t > existing.sentAt)) return;
      existing.body = { position: { ...message.origin }, velocity: { ...message.velocity }, resting: false };
      existing.fuseLeft = message.fuseLeft;
      existing.sentAt = message.t;
      return;
    }
    let remote = 0;
    for (const grenade of this.live.values()) if (!grenade.own) remote++;
    if (remote >= MAX_REMOTE_GRENADES) return;
    this.addLive(message.id, message.kind, message.senderSlot, message.origin, message.velocity, message.fuseLeft, message.t, 0);
    const { distance, pan } = this.hearing(message.origin);
    this.options.sound.playGrenadeThrow(enemyGunshotVolume(distance), pan);
  }

  /** Only a copy this client is flying, thrown by the same sender, goes off: a detonation out of
   * nowhere (no throw first, someone else's id) would be a free blast and knockback anywhere. One
   * whose throw never arrived (a full copy limit, a join mid-flight before the resend) is missed. */
  receiveDetonated(message: GrenadeDetonatedMessage): void {
    const copy = this.live.get(message.id);
    if (!copy || copy.own || copy.thrower !== message.senderSlot) return;
    this.removeLive(message.id);
    this.rememberFinished(message.id);
    const position = new THREE.Vector3(message.position.x, message.position.y, message.position.z);
    this.goOff(message.id, copy.kind, position, false);
  }

  /** The first playerSnapshot from `slot` (they are in the match and listening now): re-send every
   * grenade of ours still live, from where it is, so a late joiner sees and can dodge it. */
  opponentInMatch(slot: PlayerSlot): void {
    const network = this.options.network;
    if (!network || this.seenOpponents.has(slot)) return;
    this.seenOpponents.add(slot);
    for (const grenade of this.live.values()) {
      if (grenade.own) this.sendThrown(grenade.id, grenade.kind, grenade.body.position, grenade.body.velocity, grenade.fuseLeft);
    }
  }

  /** A slot left: should it come back, its first snapshot triggers a resend again. */
  forgetOpponent(slot: PlayerSlot): void {
    this.seenOpponents.delete(slot);
  }

  // ---- read-only seams for the HUD, view model and effects ----

  get enabled(): boolean {
    return this.options.enabled;
  }

  /** The one kind this player carries and throws, from the loadout. */
  get kind(): GrenadeKind {
    return this.hand.kind;
  }

  /** How many of that kind are carried. */
  get count(): number {
    return this.hand.count;
  }

  /** Tops up the carry (pickups). Returns how many were added. */
  addGrenades(amount: number): number {
    return this.hand.add(amount);
  }

  /** The grenade in hand, or null. `elapsed` counts from the pin. */
  get cooking(): { kind: GrenadeKind; fuseLeft: number; elapsed: number } | null {
    const kind = this.hand.cookingKind;
    return kind ? { kind, fuseLeft: this.hand.fuseLeft ?? 0, elapsed: this.hand.cookElapsed } : null;
  }

  /** While cooking: the throw's predicted path to its first contact and the landing point. */
  get arcPreview(): ArcPrediction | null {
    return this.arc;
  }

  liveGrenades(): LiveGrenadeView[] {
    return Array.from(this.live.values(), (g) => ({
      id: g.id,
      kind: g.kind,
      own: g.own,
      position: { ...g.body.position },
      fuseLeft: g.fuseLeft,
      resting: g.body.resting,
    }));
  }

  /** The live grenades for per-frame readers (the danger markers): the same array and the same view
   * objects every call, refreshed in place. Read them at once; never keep them. */
  liveViews(): readonly LiveGrenadeView[] {
    const list = this.viewList;
    list.length = 0;
    for (const g of this.live.values()) {
      const view = g.view;
      view.position.x = g.body.position.x;
      view.position.y = g.body.position.y;
      view.position.z = g.body.position.z;
      view.fuseLeft = g.fuseLeft;
      view.resting = g.body.resting;
      list.push(view);
    }
    return list;
  }

  /** 0 to 1: the local player's white-out (and muffled hearing) right now. */
  get blindLevel(): number {
    return this.blindness.level;
  }

  /** Seconds until the white-out starts to clear. */
  get blindHoldRemaining(): number {
    return this.blindness.holdRemaining;
  }

  /** Metres of camera shake right now. */
  get cameraShake(): number {
    return this.shake.amplitude;
  }

  /** The last few grenades that went off, oldest first. */
  get recentDetonations(): readonly GrenadeDetonation[] {
    return this.detonations;
  }

  /** Seconds of play on this system's clock, the timebase of GrenadeDetonation.at. */
  get now(): number {
    return this.clock;
  }

  /** Called for every grenade that goes off, own and others'. Returns an unsubscribe. */
  addDetonationListener(listener: (detonation: GrenadeDetonation) => void): () => void {
    this.detonationListeners.push(listener);
    return () => {
      const index = this.detonationListeners.indexOf(listener);
      if (index >= 0) this.detonationListeners.splice(index, 1);
    };
  }

  debugState(): GrenadeDebug {
    const cooking = this.cooking;
    return {
      enabled: this.options.enabled,
      kind: this.hand.kind,
      count: this.hand.count,
      cooking: cooking ? { kind: cooking.kind, fuseLeft: cooking.fuseLeft } : null,
      live: this.liveGrenades(),
      blindLevel: this.blindness.level,
      cameraShake: this.shake.amplitude,
      lastDetonation: this.detonations[this.detonations.length - 1] ?? null,
      detonations: this.detonationCount,
    };
  }

  // ---- internals ----

  private updateHand(dt: number, input: InputManager | null): void {
    const player = this.options.player;
    if (!input || player.isDead || !this.options.enabled) {
      if (this.hand.cookingKind) {
        this.hand.cancel();
        this.options.onHandChange('empty');
      }
      this.arc = null;
      return;
    }
    const held = input.consumeJustPressed('grenade') || input.isActionActive('grenade');
    for (const event of this.hand.update(dt, held, this.options.canStartThrow())) {
      if (event.type === 'cook') {
        this.options.sound.playGrenadePin();
        this.options.onHandChange('cooking');
      } else if (event.type === 'throw') {
        this.spawnOwn(event.kind, event.fuseLeft, undefined, OWN_THROW_HIDDEN_SECONDS);
        this.options.onHandChange('thrown');
      } else {
        // Cooked too long: it goes off in the hand.
        this.detonateOwn(`${this.idPrefix}${this.nextId++}`, event.kind, this.handPosition());
        this.options.onHandChange('thrown');
      }
    }
    if (this.hand.cookingKind) {
      this.arcAge += dt;
      if (!this.arc || this.arcAge >= ARC_REFRESH_SECONDS) {
        this.arcAge = 0;
        const { origin, velocity } = this.throwStart();
        this.arc = predictArc(origin, velocity, this.sweep, this.params, ARC_MAX_TIME, ARC_STEP);
      }
    } else {
      this.arc = null;
    }
  }

  private trackPlayerVelocity(dt: number): void {
    const position = this.options.player.position;
    if (this.hasLastPlayerPosition && dt > 0) {
      this.playerVelocity.copy(position).sub(this.lastPlayerPosition).divideScalar(dt);
      if (this.playerVelocity.length() > MAX_THROWER_SPEED) this.playerVelocity.set(0, 0, 0);
    } else {
      this.playerVelocity.set(0, 0, 0);
    }
    this.lastPlayerPosition.copy(position);
    this.hasLastPlayerPosition = true;
  }

  /** Where a throw leaves the hand (GRENADE_HAND_OFFSET in the camera's frame), pulled back toward
   * the eye if that would be inside a wall. */
  private handPosition(): THREE.Vector3 {
    const camera = this.options.camera;
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const quaternion = camera.getWorldQuaternion(new THREE.Quaternion());
    const hand = new THREE.Vector3(GRENADE_HAND_OFFSET.right, GRENADE_HAND_OFFSET.up, -GRENADE_HAND_OFFSET.forward)
      .applyQuaternion(quaternion)
      .add(eye);
    const reach = hand.clone().sub(eye);
    const hit = this.castSweep(eye, reach, true);
    if (hit) hand.copy(eye).addScaledVector(reach, Math.max(0, hit.fraction - 0.05));
    return hand;
  }

  private throwStart(direction?: Vec3): { origin: THREE.Vector3; velocity: THREE.Vector3 } {
    const aim = direction
      ? new THREE.Vector3(direction.x, direction.y, direction.z)
      : this.options.camera.getWorldDirection(new THREE.Vector3());
    if (aim.lengthSq() < 1e-9) aim.set(0, 0, -1);
    aim.normalize();
    const velocity = aim.multiplyScalar(GRENADE_THROW_SPEED).add(this.playerVelocity);
    return { origin: this.handPosition(), velocity };
  }

  /** `hiddenFor`: seconds the world copy stays hidden while the view-model hand still holds it. */
  private spawnOwn(kind: GrenadeKind, fuseLeft: number, direction?: Vec3, hiddenFor = 0): string {
    const { origin, velocity } = this.throwStart(direction);
    const id = `${this.idPrefix}${this.nextId++}`;
    this.addLive(id, kind, null, origin, velocity, fuseLeft, 0, hiddenFor);
    this.sendThrown(id, kind, origin, velocity, fuseLeft);
    this.options.sound.playGrenadeThrow();
    return id;
  }

  private sendThrown(id: string, kind: GrenadeKind, origin: Vec3, velocity: Vec3, fuseLeft: number): void {
    const network = this.options.network;
    if (!network) return;
    network.send({
      type: 'grenadeThrown',
      senderSlot: network.ownSlot,
      id,
      kind,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      fuseLeft: Math.max(0, fuseLeft),
      t: performance.now(),
    });
  }

  /** `thrower`: null for this client's own grenade, else the copy's sender. */
  private addLive(id: string, kind: GrenadeKind, thrower: PlayerSlot | null, origin: Vec3, velocity: Vec3, fuseLeft: number, sentAt: number, hiddenFor: number): void {
    const mesh = this.modelPool[kind].pop() ?? buildGrenadeModel(kind);
    mesh.scale.setScalar(WORLD_MODEL_SCALE);
    mesh.visible = hiddenFor <= 0;
    mesh.position.set(origin.x, origin.y, origin.z);
    // Pin end first along the throw, tumbling end over end about the horizontal axis across it.
    const spinAxis = new THREE.Vector3(velocity.x, velocity.y, velocity.z).cross(UP);
    if (spinAxis.lengthSq() < 1e-6) spinAxis.set(1, 0, 0);
    spinAxis.normalize();
    mesh.quaternion.setFromUnitVectors(UP, new THREE.Vector3(velocity.x, velocity.y, velocity.z).normalize());
    if (!Number.isFinite(mesh.quaternion.x)) mesh.quaternion.identity();
    this.options.scene.add(mesh);
    this.live.set(id, {
      id,
      kind,
      own: thrower === null,
      thrower,
      body: { position: { x: origin.x, y: origin.y, z: origin.z }, velocity: { x: velocity.x, y: velocity.y, z: velocity.z }, resting: false },
      fuseLeft,
      sentAt,
      mesh,
      spinAxis,
      spinRate: SPIN_RATE,
      lastClinkAt: -Infinity,
      hiddenFor,
      view: { id, kind, own: thrower === null, position: { x: origin.x, y: origin.y, z: origin.z }, fuseLeft, resting: false },
    });
  }

  private removeLive(id: string): void {
    const grenade = this.live.get(id);
    if (!grenade) return;
    this.options.scene.remove(grenade.mesh);
    this.modelPool[grenade.kind].push(grenade.mesh);
    this.live.delete(id);
  }

  private rememberFinished(id: string): void {
    this.finished.push(id);
    if (this.finished.length > FINISHED_ID_MEMORY) this.finished.shift();
  }

  /** The thrower's own grenade goes off: everything it does, then tell everyone else. */
  private detonateOwn(id: string, kind: GrenadeKind, position: THREE.Vector3): void {
    this.removeLive(id);
    this.rememberFinished(id);
    this.goOff(id, kind, position, true);
    const network = this.options.network;
    if (network) {
      network.send({ type: 'grenadeDetonated', senderSlot: network.ownSlot, id, kind, position: { x: position.x, y: position.y, z: position.z } });
    }
  }

  /** A grenade goes off at `position`. `own`: this client threw it and decides its damage. */
  private goOff(id: string, kind: GrenadeKind, position: THREE.Vector3, own: boolean): void {
    const blast = position.clone();
    blast.y += BLAST_LIFT;
    const surface = kind === 'frag' ? this.findSurface(position) : null;
    if (kind === 'frag') this.goOffFrag(blast, position, own, surface);
    else this.goOffFlash(blast, own);

    const detonation: GrenadeDetonation = { id, kind, position: { x: position.x, y: position.y, z: position.z }, own, at: this.clock, surface };
    this.detonations.push(detonation);
    if (this.detonations.length > RECENT_DETONATIONS) this.detonations.shift();
    this.detonationCount++;
    for (const listener of [...this.detonationListeners]) listener(detonation);
  }

  private goOffFrag(blast: THREE.Vector3, position: THREE.Vector3, own: boolean, surface: GrenadeSurface | null): void {
    const { player, sound, network, targets } = this.options;
    const lightAt = surface
      ? new THREE.Vector3(surface.point.x, surface.point.y, surface.point.z).addScaledVector(new THREE.Vector3(surface.normal.x, surface.normal.y, surface.normal.z), FRAG_LIGHT_LIFT)
      : position;
    this.lightBlast(lightAt, FRAG_LIGHT_COLOR, FRAG_LIGHT_INTENSITY, FRAG_LIGHT_RANGE, FRAG_LIGHT_SECONDS);
    const eye = this.options.camera.getWorldPosition(new THREE.Vector3());
    const heard = this.hearing(position);
    sound.playFragExplosion(enemyGunshotVolume(heard.distance), heard.pan);
    this.shake.add(fragShakeAmplitude(eye.distanceTo(blast)));

    // The local player: damage only from its own frag (others' arrives as damageEvent); knockback
    // from any frag, since each client moves its own player, except a teammate's in co-op.
    if (!player.isDead && (own || this.options.friendlyFire !== false)) {
      const center = player.position;
      const distance = center.distanceTo(blast);
      if (distance < FRAG_RADIUS && blastReaches(blast, center, (from, to) => this.rayClear(from, to, player))) {
        if (own) {
          const damage = computeFragDamage(distance);
          if (damage > 0) player.takeDamage(damage, position);
        }
        const knockback = computeKnockbackStrength(distance, FRAG_RADIUS, FRAG_KNOCKBACK_STRENGTH);
        if (knockback > 0) player.applyKnockback(center.clone().sub(blast), knockback);
      }
    }
    if (!own) return;

    targets.applyBlast(blast, computeFragDamage, (center, entity, exclude) =>
      blastReaches(blast, center, (from, to) => this.rayClear(from, to, entity, exclude)),
    );
    if (network && this.options.friendlyFire !== false) {
      for (const opponent of network.opponents()) {
        if (opponent.isDead) continue;
        const amount = computeFragDamage(opponent.position.distanceTo(blast));
        if (amount <= 0 || !blastReaches(blast, opponent.position, (from, to) => this.rayClear(from, to, opponent.entity))) continue;
        network.send({ type: 'damageEvent', senderSlot: network.ownSlot, targetSlot: opponent.slot, amount, weaponId: 'frag' });
      }
    }
    this.options.shootLampsNear(position, FRAG_LAMP_RADIUS);
    targets.notifyGunshot(position, 'frag');
  }

  private goOffFlash(blast: THREE.Vector3, own: boolean): void {
    const { player, sound, camera, targets } = this.options;
    this.lightBlast(blast, FLASH_LIGHT_COLOR, FLASH_LIGHT_INTENSITY, FLASH_LIGHT_RANGE, FLASH_LIGHT_SECONDS);
    const heard = this.hearing(blast);
    sound.playFlashBang(enemyGunshotVolume(heard.distance), heard.pan);

    if (!player.isDead) {
      const eye = camera.getWorldPosition(new THREE.Vector3());
      const view = camera.getWorldDirection(new THREE.Vector3());
      const lineOfSight = this.rayClear(blast, eye, player);
      this.blindness.apply(flashStrength(eye.distanceTo(blast), flashCosAngle(eye, view, blast), lineOfSight), FLASH_PLAYER_MAX_SECONDS);
    }
    if (!own) return;
    // Blinded first, then heard: an enemy judges whether it "had a target" from its state before
    // the bang, and the bang would put every idle one into a search. A blinded enemy ignores the
    // bang itself (EnemyBrain.onHeardGunshot), so the blindness still decides what it does next.
    targets.applyFlash((eye, yaw, entity, exclude) => {
      const lineOfSight = this.rayClear(blast, eye, entity, exclude);
      const strength = flashStrength(eye.distanceTo(blast), flashCosAngle(eye, yawViewDirection(yaw), blast), lineOfSight);
      return flashSeconds(strength, FLASH_ENEMY_MAX_SECONDS);
    });
    targets.notifyGunshot(blast, 'flash');
  }

  /** Turns the one blast light on at `position`; update() fades it out over `seconds`. */
  private lightBlast(position: THREE.Vector3, color: number, intensity: number, range: number, seconds: number): void {
    const light = this.blastLight;
    if (!light) return;
    light.position.copy(position);
    light.color.setHex(color);
    light.distance = range;
    light.intensity = intensity;
    this.blastLightPeak = intensity;
    this.blastLightSeconds = seconds;
    this.blastLightTime = seconds;
  }

  /** The world surface a frag at `position` lies on or against: the nearest fixed collider within
   * a short reach (down first), else the terrain floor under it, else null (it went off in the air). */
  private findSurface(position: THREE.Vector3): GrenadeSurface | null {
    let best: GrenadeSurface | null = null;
    let bestDistance = Infinity;
    for (const direction of SURFACE_PROBE_DIRECTIONS) {
      const reach = direction.y < 0 ? SURFACE_PROBE_DOWN : SURFACE_PROBE_SIDE;
      const hit = this.options.physics.world.castRayAndGetNormal(
        new RAPIER.Ray({ x: position.x, y: position.y, z: position.z }, direction),
        reach,
        false,
        RAPIER.QueryFilterFlags.ONLY_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      if (!hit || hit.timeOfImpact >= bestDistance) continue;
      const n = hit.normal;
      const length = Math.hypot(n.x, n.y, n.z);
      // Started inside the collider: no usable normal.
      if (length < 0.5) continue;
      bestDistance = hit.timeOfImpact;
      best = {
        point: { x: position.x + direction.x * hit.timeOfImpact, y: position.y + direction.y * hit.timeOfImpact, z: position.z + direction.z * hit.timeOfImpact },
        normal: { x: n.x / length, y: n.y / length, z: n.z / length },
      };
    }
    const floor = this.options.floor;
    if (!best && floor) {
      const height = floor(position.x, position.z);
      if (position.y - height <= SURFACE_PROBE_DOWN) {
        // The terrain's normal from its slope either side.
        const step = 0.5;
        const dx = floor(position.x + step, position.z) - floor(position.x - step, position.z);
        const dz = floor(position.x, position.z + step) - floor(position.x, position.z - step);
        const normal = new THREE.Vector3(-dx, 2 * step, -dz).normalize();
        best = { point: { x: position.x, y: height, z: position.z }, normal: { x: normal.x, y: normal.y, z: normal.z } };
      }
    }
    return best;
  }

  /** How far `position` is from the local player and its stereo pan, for a positional sound. */
  private hearing(position: Vec3): { distance: number; pan: number } {
    const { player } = this.options;
    const source = new THREE.Vector3(position.x, position.y, position.z);
    return { distance: source.distanceTo(player.position), pan: computeStereoPan(player.position, player.facingYaw, source) };
  }

  /** Nothing solid between `from` and `to`, or the first thing hit is `target` itself (its own
   * colliders count as reaching it). `exclude` skips a body altogether. Sensors (a tree's canopy
   * ball) are not solid, and a `from` inside a fixed collider (a door that shut on the grenade)
   * starts just outside it, so a blast is not shut in by the shape it lies in. */
  private rayClear(from: Vec3, to: Vec3, target: object | null, exclude?: RAPIER.RigidBody): boolean {
    const start = this.outsideFixedSolid(from);
    const direction = new THREE.Vector3(to.x - start.x, to.y - start.y, to.z - start.z);
    const length = direction.length();
    if (length < 1e-4) return true;
    direction.divideScalar(length);
    const hit = this.options.physics.world.castRayAndGetNormal(
      new RAPIER.Ray(start, direction),
      length,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      exclude,
    );
    if (!hit) return true;
    return target !== null && this.options.physics.getEntity(hit.collider.handle) === target;
  }

  /** `point`, or where it leaves the fixed solid collider it lies inside: the nearest surface point
   * pushed OUTSIDE_SOLID_MARGIN further out. */
  private outsideFixedSolid(point: Vec3): Vec3 {
    let inside: RAPIER.Collider | null = null;
    this.options.physics.world.intersectionsWithPoint(
      point,
      (collider) => {
        inside = collider;
        return false;
      },
      RAPIER.QueryFilterFlags.ONLY_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    if (!inside) return point;
    const projection = (inside as RAPIER.Collider).projectPoint(point, false);
    if (!projection) return point;
    const surface = projection.point;
    const out = new THREE.Vector3(surface.x - point.x, surface.y - point.y, surface.z - point.z);
    const distance = out.length();
    if (distance < 1e-6) out.set(0, 1, 0);
    else out.divideScalar(distance);
    return { x: surface.x + out.x * OUTSIDE_SOLID_MARGIN, y: surface.y + out.y * OUTSIDE_SOLID_MARGIN, z: surface.z + out.z * OUTSIDE_SOLID_MARGIN };
  }

  /** The world sweep for grenadeFlight: a GRENADE_RADIUS ball cast along `displacement`, past every
   * sensor. `ownGrenade`: also past the local player's own capsule (its own throw starts at its
   * hand); another player's grenade meets that capsule like any other body. */
  private castSweep(from: Vec3, displacement: Vec3, ownGrenade: boolean): { fraction: number; normal: Vec3 } | null {
    const hit = this.options.physics.world.castShape(
      from,
      IDENTITY_ROTATION,
      displacement,
      this.ball,
      0,
      1,
      false,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      ownGrenade ? this.options.player.ownCollider : undefined,
    );
    if (!hit) return null;
    // normal1 is the ball's own outward normal at the contact (the ball is never rotated, so local
    // is world): the surface's normal is its opposite.
    const n = hit.normal1;
    const length = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
    if (length < 0.5) {
      // Starting inside something: push back along the motion.
      const d = Math.sqrt(displacement.x ** 2 + displacement.y ** 2 + displacement.z ** 2) || 1;
      return { fraction: hit.time_of_impact, normal: { x: -displacement.x / d, y: -displacement.y / d, z: -displacement.z / d } };
    }
    return { fraction: hit.time_of_impact, normal: { x: -n.x / length, y: -n.y / length, z: -n.z / length } };
  }
}
