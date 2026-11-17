import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { allocateEntityId, type Entity } from './Entity.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { Damageable } from '../combat/damage.ts';
import { sampleHeight } from '../world/TerrainGenerator.ts';
import { steerWithAvoidance } from './enemies/enemySteering.ts';
import { buildingEntranceAt, enemyFloorAt, forgetDoorWait, heldAtDoor, resolveMoveTarget } from './enemies/enemyNavigator.ts';
import { buildGooseMesh, disposeProceduralMesh } from './Goose.ts';
import {
  ENEMY_HEIGHT,
  GOOSE_HEIGHT,
  GOOSE_RADIUS,
  HORDE_FLYER_DESCENT_SECONDS,
  HORDE_FLYER_SPAWN_HEIGHT,
  HORDE_JUMPER_BURST_MULTIPLIER,
  HORDE_JUMPER_BURST_SECONDS,
  HORDE_JUMPER_TRIGGER_RADIUS,
  PLAYER_HEIGHT,
} from '../core/config.ts';

import { HORDE_BOSSES, HORDE_FLAVORS, type HordeBossId, type HordeFlavorStats, type HordeGooseFlavor } from './hordeRules.ts';

export type { HordeGooseFlavor } from './hordeRules.ts';

/** Seconds a brute or a boss shows the flash of a hit. */
const HIT_FLASH_SECONDS = 0.09;

const WADDLE_BOB_SPEED = 11;
const WADDLE_ROCK_ANGLE = 0.22;
/** Indoors a flyer dives from its flight height onto its target over this last stretch (m). */
const INDOOR_DIVE_DISTANCE = 5;
/** How fast an indoor flyer climbs or sinks toward the height it wants (m/s). */
const INDOOR_CLIMB_SPEED = 3;

/** A player standing this far above the house floor under them (m) is on its roof, not in it. */
const ROOF_CLEARANCE = 1.5;

/** Whether a horde goose centred at `goose` has reached a player whose body centre is `target`.
 * Contact is horizontal (within `reach`, the flavor's contact radius) outdoors, so a player on a watch tower or
 * a house roof is still reached by the geese gathering below. For a player standing on a Valley
 * house's floor it is also vertical (within that radius of the player's body, its upright axis from
 * feet to head), so a goose on the ground floor never reaches a player upstairs above it. */
export function hordeGooseReaches(goose: THREE.Vector3Like, target: THREE.Vector3Like, reach: number = HORDE_FLAVORS.walker.contactRadius): boolean {
  const across = Math.hypot(goose.x - target.x, goose.z - target.z);
  if (across > reach) return false;
  const feetY = target.y - PLAYER_HEIGHT / 2;
  const floorY = enemyFloorAt(target.x, target.z, feetY);
  if (floorY === null || feetY - floorY > ROOF_CLEARANCE) return true;
  const above = Math.max(0, Math.abs(goose.y - target.y) - PLAYER_HEIGHT / 2);
  return Math.hypot(across, above) <= reach;
}

/** How far a horde goose must move horizontally before its ground height is resampled - same
 * value and reasoning as Goose.ts/Enemy.ts's identical constant (`sampleHeight` is a 4-octave fBm
 * plus a 9-cell Worley scan per call, and a late wave can have dozens of these chasing at once). */
const HEIGHT_RESAMPLE_DISTANCE_SQ = 0.25 * 0.25;

/** Goose Horde's aggressive, always-chasing goose - a parallel to (not a subclass of) both the
 * passive wandering Goose and the GLTF/archetype-coupled Enemy, reusing each's relevant piece:
 * Goose's procedural mesh (buildGooseMesh) and Enemy's chase-steering primitive
 * (steerWithAvoidance, same function Enemy itself uses). Always heads straight for whichever
 * target position it's given each tick (Game.ts/HordeGooseManager pick the nearest player) and
 * explodes on contact - no idle/alert/search states, a horde goose aggros immediately on spawn.
 *
 * The three small flavors die in exactly one hit from any weapon (see takeDamage); a brute and a
 * boss have real health (entities/hordeRules.ts). A killed goose just falls over (`dead` without
 * `reachedTarget`), only a goose that actually reaches its target explodes (see HordeGooseManager's
 * own update loop for where that distinction is read). A boss never dies of reaching a player: it
 * stomps (`consumeStomp`) and keeps coming. */
export class HordeGoose implements Entity, Damageable {
  readonly id = allocateEntityId();
  readonly isDamageableTarget = true;
  readonly mesh: THREE.Group;
  readonly flavor: HordeGooseFlavor;
  readonly stats: HordeFlavorStats;
  readonly maxHealth: number;
  /** The slot whose hit was the last to land, for the kill count. Null in single-player. */
  lastHitSlot: number | null = null;

  private health: number;
  /** Half the goose's height at its scale: its centre sits this far above the ground. */
  private readonly halfHeight: number;
  private readonly tinted: THREE.MeshStandardMaterial[] = [];
  private flashRemaining = 0;
  /** Boss only: seconds until it may stomp again, and whether a stomp is waiting to be read. */
  private stompCooldown = 0;
  private stompPending = false;
  private dead = false;
  private reachedTarget = false;
  private disposed = false;
  private readonly rigidBody: RAPIER.RigidBody;
  private readonly bodyCollider: RAPIER.Collider;
  private waddlePhase = Math.random() * Math.PI * 2;

  /** Jumper only: counts down once triggered (see HORDE_JUMPER_TRIGGER_RADIUS) - while positive,
   * chase speed is multiplied by HORDE_JUMPER_BURST_MULTIPLIER instead of the normal per-wave
   * speed, reading as a sudden rush tell. */
  private jumperBurstRemaining = 0;

  /** Flyer only: seconds since spawn - drives the straight-down descent until it either lands
   * (converts to a normal ground chase for any remaining life) or reaches its target mid-descent
   * (explodes in the air, right on top of whatever it was diving at). */
  private flyerAge = 0;
  private flyerLanded = false;
  /** The nearest player's position the *first* time this flyer ticks (effectively "at spawn," a
   * few ms later) - not the goose's own spawn point. Previously initialized from `position` (the
   * spawn point itself), so a flyer dove straight down onto the fixed spawn ring instead of at a
   * player, only ever hitting someone who happened to be standing on that exact ring - the config
   * comment's own "dives straight down toward the player" was never actually true. Confirmed bug
   * (M1), fixed in the 2026-07-10 review. Mutable rather than readonly-from-constructor because
   * the constructor only knows the spawn position, not yet the live nearest-player target
   * HordeGooseManager computes fresh each tick. */
  private flyerTargetX: number;
  private flyerTargetZ: number;
  private flyerTargetCaptured = false;
  /** Ground height (plus half a goose) under flyerTargetX/Z, sampled once when the target is
   * captured - see updateFlyerDescent. */
  private flyerGroundY = 0;

  /** Chase-path terrain height cache - initialized to NaN so the first groundHeightAt call always
   * resamples, exactly like Goose.ts's identical fields. */
  private heightSampleX = Number.NaN;
  private heightSampleZ = Number.NaN;
  private cachedGroundHeight = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    position: THREE.Vector3,
    flavor: HordeGooseFlavor,
    /** m/s, already includes the current wave's speedMultiplier (see HordeGooseManager). */
    private readonly chaseSpeed: number,
    /** Stable id shared across every client's copy of this same goose - see Goose.ts's identical
     * field for the full reasoning (assigned by the authoritative HordeGooseManager). */
    public readonly networkId: string = '',
    /** Presence selects follower mode (multiplayer guest): no local AI, position driven externally
     * via snapTo, and a local hit reports itself here instead of self-adjudicating - same pattern
     * as Goose.ts's onRemoteHitReport. */
    private readonly onRemoteHitReport?: (amount: number) => void,
    /** Indoors (the Facility): the flight height over a point, under the local ceiling. A flyer then
     * flies in through the rooms instead of dropping from the sky (see updateIndoorFlight). */
    private readonly indoorFlightHeight?: (x: number, z: number) => number,
    /** Hit points for a brute or a boss, already scaled to the squad. Small geese ignore it. */
    health?: number,
    /** Which boss, when the flavor is one: its colour and how often it stomps. */
    private readonly boss?: HordeBossId,
  ) {
    this.flavor = flavor;
    this.stats = HORDE_FLAVORS[flavor];
    this.maxHealth = health ?? this.stats.health;
    this.health = this.maxHealth;
    this.halfHeight = (GOOSE_HEIGHT / 2) * this.stats.scale;
    this.flyerTargetX = position.x;
    this.flyerTargetZ = position.z;

    this.mesh = buildGooseMesh();
    const tint = boss ? HORDE_BOSSES[boss].tint : this.stats.tint;
    if (this.stats.scale !== 1) this.mesh.scale.setScalar(this.stats.scale);
    if (tint !== null) {
      // The white parts take the tint (the beak and legs stay orange), so a brute or a boss reads
      // at a glance in a flock of white geese.
      const seen = new Set<THREE.Material>();
      this.mesh.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const material: THREE.Material = child.material;
        if (seen.has(material) || !(material instanceof THREE.MeshStandardMaterial)) return;
        seen.add(material);
        if (material.color.r > 0.7 && material.color.b > 0.7) {
          material.color.setHex(tint);
          material.emissive.setHex(tint);
          material.emissiveIntensity = 0.18;
          this.tinted.push(material);
        }
      });
    }
    // A big goose stands on the ground: its centre is higher than the small goose's the spawn point assumed.
    const groundedY = position.y + (this.halfHeight - GOOSE_HEIGHT / 2);
    const spawnY = flavor !== 'flyer'
      ? groundedY
      : indoorFlightHeight
        ? indoorFlightHeight(position.x, position.z)
        : sampleHeight(position.x, position.z) + HORDE_FLYER_SPAWN_HEIGHT;
    this.mesh.position.set(position.x, spawnY, position.z);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, spawnY, position.z);
    this.rigidBody = physics.world.createRigidBody(bodyDesc);
    this.bodyCollider = physics.world.createCollider(RAPIER.ColliderDesc.ball(GOOSE_RADIUS * this.stats.scale), this.rigidBody);
    physics.registerCollider(this.bodyCollider, this);
  }

  get currentHealth(): number {
    return this.health;
  }

  /** Which boss this is, or undefined for every other goose. */
  get bossId(): HordeBossId | undefined {
    return this.boss;
  }

  /** Boss only: true once per stomp, when it has just gone off (HordeGooseManager reads it each tick). */
  consumeStomp(): boolean {
    const pending = this.stompPending;
    this.stompPending = false;
    return pending;
  }

  /** Follower side: the host's count of a boss's health, for nothing but a local read. */
  setHealth(health: number): void {
    this.health = Math.max(0, Math.min(this.maxHealth, health));
  }

  get isDead(): boolean {
    return this.dead;
  }

  /** True only once this goose has actually reached its target and should explode - a one-hit
   * weapon kill (`dead` alone) never sets this. */
  get hasReachedTarget(): boolean {
    return this.reachedTarget;
  }

  /** Its full height at its scale, for a blast judging how much of it shows. */
  get height(): number {
    return this.halfHeight * 2;
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  /** A small goose dies to one hit from any weapon, whatever its amount; a brute or a boss loses
   * `amount` health. A follower only flashes and reports the hit: the host decides. */
  takeDamage(amount: number, _hitColliderHandle: number): void {
    if (this.dead) return;
    this.flash();
    if (this.onRemoteHitReport) {
      this.onRemoteHitReport(amount);
      return;
    }
    this.applyHit(amount, null);
  }

  /** Authoritative side: a hit of `amount` by `slot` (null for single-player's own). Used directly
   * for a hit a guest reported (HordeGooseManager.registerRemoteHit) and by takeDamage above. */
  applyHit(amount: number, slot: number | null): void {
    if (this.dead) return;
    this.lastHitSlot = slot;
    this.health = this.stats.health <= 1 ? 0 : Math.max(0, this.health - Math.max(0, amount));
    if (this.health <= 0) this.dead = true;
  }

  /** Authoritative side: removes it outright (a Second Wind's blast, a reset). */
  kill(): void {
    this.dead = true;
  }

  private flash(): void {
    if (this.tinted.length === 0) return;
    this.flashRemaining = HIT_FLASH_SECONDS;
    for (const material of this.tinted) material.emissiveIntensity = 1.4;
  }

  /** Fades the hit flash. Runs on every client (a follower's goose never runs `update`). */
  tickEffects(dt: number): void {
    if (this.flashRemaining <= 0) return;
    this.flashRemaining -= dt;
    if (this.flashRemaining <= 0) for (const material of this.tinted) material.emissiveIntensity = 0.18;
  }

  /** Follower mode only: snaps directly to a host-reported position, mirroring Goose.ts's
   * identical method - only the host's copy runs real AI/decides death. */
  snapTo(x: number, y: number, z: number): void {
    this.rigidBody.setNextKinematicTranslation({ x, y, z });
    this.mesh.position.set(x, y, z);
  }

  update(dt: number, targetPosition: THREE.Vector3): void {
    if (this.dead || this.onRemoteHitReport) return;
    if (this.stompCooldown > 0) this.stompCooldown -= dt;

    if (this.flavor === 'flyer' && this.indoorFlightHeight) {
      this.updateIndoorFlight(dt, targetPosition, this.indoorFlightHeight);
      return;
    }
    if (this.flavor === 'flyer' && !this.flyerLanded) {
      this.updateFlyerDescent(dt, targetPosition);
      return;
    }

    this.updateChase(dt, targetPosition);
  }

  private updateFlyerDescent(dt: number, targetPosition: THREE.Vector3): void {
    if (!this.flyerTargetCaptured) {
      this.flyerTargetCaptured = true;
      // A target inside a Valley house: land on the street in front of its door and walk in from
      // there (through the door gate), never down through the roof.
      const entrance = buildingEntranceAt(targetPosition.x, targetPosition.z);
      this.flyerTargetX = entrance ? entrance.x : targetPosition.x;
      this.flyerTargetZ = entrance ? entrance.z : targetPosition.z;
      // The descent never leaves this x/z, so its ground height is sampled exactly once here rather
      // than re-running the same expensive sampleHeight call at the same point every tick.
      this.flyerGroundY = sampleHeight(this.flyerTargetX, this.flyerTargetZ) + this.halfHeight;
    }
    this.flyerAge += dt;
    const groundY = this.flyerGroundY;
    const startY = groundY + HORDE_FLYER_SPAWN_HEIGHT;
    const t = Math.min(1, this.flyerAge / HORDE_FLYER_DESCENT_SECONDS);
    const y = startY + (groundY - startY) * t;
    this.rigidBody.setNextKinematicTranslation({ x: this.flyerTargetX, y, z: this.flyerTargetZ });
    this.mesh.position.set(this.flyerTargetX, y, this.flyerTargetZ);
    this.mesh.rotation.x = -Math.PI / 2.4;

    if (this.arrivedAt(this.position, targetPosition)) return;
    if (t >= 1) {
      this.flyerLanded = true;
      this.mesh.rotation.x = 0;
    }
  }

  /** Indoors a flyer follows the enemies' navigation through the rooms and doors at its flight
   * height (never above the local ceiling minus its gap), then dives onto its target over the last
   * INDOOR_DIVE_DISTANCE. No avoidance steering: the waypoints already keep it off the walls, and
   * it flies over everything a walker would have to go around. */
  private updateIndoorFlight(dt: number, targetPosition: THREE.Vector3, flightHeight: (x: number, z: number) => number): void {
    const current = this.rigidBody.translation();
    const distance = Math.hypot(targetPosition.x - current.x, targetPosition.z - current.z);
    if (this.arrivedAt(current, targetPosition)) return;
    const waypoint = resolveMoveTarget(current.x, current.z, targetPosition.x, targetPosition.z);
    const wx = waypoint.x - current.x;
    const wz = waypoint.z - current.z;
    const waypointDistance = Math.hypot(wx, wz);
    // A closed door ahead (it flies under the header): it waits there and opens it, as enemies do.
    if (waypointDistance > 1e-4 && this.heldAtDoor(current, wx / waypointDistance, wz / waypointDistance, waypointDistance, dt)) return;
    const step = Math.min(waypointDistance, this.chaseSpeed * dt);
    const nextX = waypointDistance > 1e-4 ? current.x + (wx / waypointDistance) * step : current.x;
    const nextZ = waypointDistance > 1e-4 ? current.z + (wz / waypointDistance) * step : current.z;
    const ceilingY = flightHeight(nextX, nextZ);
    const lowY = Math.max(targetPosition.y, this.halfHeight);
    const wantY = lowY + (ceilingY - lowY) * Math.min(1, distance / INDOOR_DIVE_DISTANCE);
    const climb = INDOOR_CLIMB_SPEED * dt;
    const y = Math.min(ceilingY, current.y + Math.max(-climb, Math.min(climb, wantY - current.y)));
    this.rigidBody.setNextKinematicTranslation({ x: nextX, y, z: nextZ });
    this.mesh.position.set(nextX, y, nextZ);
    if (waypointDistance > 1e-4) this.mesh.rotation.y = Math.atan2(wx, wz);
    this.mesh.rotation.x = distance < INDOOR_DIVE_DISTANCE ? -Math.PI / 5 : 0;
  }

  private updateChase(dt: number, targetPosition: THREE.Vector3): void {
    const current = this.rigidBody.translation();
    const dx = targetPosition.x - current.x;
    const dz = targetPosition.z - current.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (this.arrivedAt(current, targetPosition)) return;

    if (this.flavor === 'jumper' && this.jumperBurstRemaining <= 0 && distance <= HORDE_JUMPER_TRIGGER_RADIUS) {
      this.jumperBurstRemaining = HORDE_JUMPER_BURST_SECONDS;
    }
    let speed = this.chaseSpeed * this.stats.speed;
    if (this.jumperBurstRemaining > 0) {
      this.jumperBurstRemaining -= dt;
      speed *= HORDE_JUMPER_BURST_MULTIPLIER;
    }

    // Through the doors on the Facility and into the Valley houses (the enemies' navigator, told both
    // heights so a house's floors are told apart); straight at the target outdoors. The navigator
    // reads heights as an enemy's body centre, so the goose passes its feet plus that.
    const feetY = current.y - this.halfHeight;
    const waypoint = resolveMoveTarget(current.x, current.z, targetPosition.x, targetPosition.z, feetY + ENEMY_HEIGHT / 2, targetPosition.y);
    const wx = waypoint.x - current.x;
    const wz = waypoint.z - current.z;
    const waypointDistance = Math.hypot(wx, wz);
    const reach = waypointDistance > 1e-4 ? waypointDistance : distance;
    if (reach < 1e-4) return;
    const desiredDir = waypointDistance > 1e-4
      ? new THREE.Vector3(wx / waypointDistance, 0, wz / waypointDistance)
      : new THREE.Vector3(dx / distance, 0, dz / distance);
    // A closed door ahead: it waits there and opens it, as enemies do.
    if (this.heldAtDoor(current, desiredDir.x, desiredDir.z, reach, dt)) return;
    const chestPos = new THREE.Vector3(current.x, current.y, current.z);
    // A waypoint the navigator knows is clear (a house's walk grid) is walked straight, like an enemy.
    const steeredDir = waypoint.direct ? desiredDir : steerWithAvoidance(this.physics, chestPos, desiredDir, this.bodyCollider);

    const step = Math.min(reach, speed * dt);
    const nextX = current.x + steeredDir.x * step;
    const nextZ = current.z + steeredDir.z * step;
    const groundY = this.groundHeightAt(nextX, nextZ, feetY) + this.halfHeight;

    this.rigidBody.setNextKinematicTranslation({ x: nextX, y: groundY, z: nextZ });
    this.waddlePhase += dt * WADDLE_BOB_SPEED;
    this.mesh.position.set(nextX, groundY + Math.sin(this.waddlePhase) * 0.05, nextZ);
    this.mesh.rotation.y = Math.atan2(steeredDir.x, steeredDir.z);
    this.mesh.rotation.z = Math.sin(this.waddlePhase) * WADDLE_ROCK_ANGLE;
  }

  /** Whether the goose at `current` has reached its target, and what that does: every goose but a
   * boss goes off and dies (true: its tick is over); a boss stomps, at most once per its cooldown,
   * and keeps moving (false). */
  private arrivedAt(current: THREE.Vector3Like, targetPosition: THREE.Vector3Like): boolean {
    if (!hordeGooseReaches(current, targetPosition, this.stats.contactRadius)) return false;
    if (this.flavor === 'boss') {
      if (this.stompCooldown <= 0) {
        this.stompCooldown = this.boss ? HORDE_BOSSES[this.boss].stompEvery : 2.5;
        this.stompPending = true;
      }
      return false;
    }
    this.reachedTarget = true;
    this.dead = true;
    return true;
  }

  /** The door gate (enemyNavigator.ts) for a goose about to move along (dirX, dirZ) with its waypoint
   * `reach` m on: true while a closed door holds it, facing the door (the gate opens it after the
   * wait, synced like an enemy's opening). */
  private heldAtDoor(current: THREE.Vector3Like, dirX: number, dirZ: number, reach: number, dt: number): boolean {
    if (!heldAtDoor(this.id, current.x, current.z, dirX, dirZ, dt, reach, current.y - this.halfHeight)) return false;
    this.mesh.rotation.y = Math.atan2(dirX, dirZ);
    this.mesh.rotation.z = 0;
    return true;
  }

  /** Cached terrain height, resampled only after HEIGHT_RESAMPLE_DISTANCE_SQ of horizontal movement
   * - a straight port of Goose.ts's groundHeightAt (same perf bug, fixed there first: this used to
   * call sampleHeight uncached every tick for every chasing goose). NaN-initialized sample point
   * means the first call always resamples, including right after a flyer lands. In a Valley house it
   * is the floor under the feet (ground floor, stair or upper floor), as for enemies. */
  private groundHeightAt(x: number, z: number, feetY: number): number {
    const floor = enemyFloorAt(x, z, feetY);
    if (floor !== null) {
      this.heightSampleX = Number.NaN;
      return floor;
    }
    const dx = x - this.heightSampleX;
    const dz = z - this.heightSampleZ;
    if (!(dx * dx + dz * dz < HEIGHT_RESAMPLE_DISTANCE_SQ)) {
      this.cachedGroundHeight = sampleHeight(x, z);
      this.heightSampleX = x;
      this.heightSampleZ = z;
    }
    return this.cachedGroundHeight;
  }

  /** Guarded against a second call - same reasoning as Goose.ts/RemotePlayer.ts's identical guard
   * (re-entering Rapier's removal path for an already-removed collider isn't guaranteed safe). Also
   * frees the mesh's GPU resources (buildGooseMesh allocates per goose): every HordeGooseManager
   * path removes the mesh from the scene right before this and reads only position/networkId
   * afterwards, so nothing shows it again. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    forgetDoorWait(this.id);
    this.physics.unregisterCollider(this.bodyCollider);
    this.physics.world.removeCollider(this.bodyCollider, true);
    this.physics.world.removeRigidBody(this.rigidBody);
    disposeProceduralMesh(this.mesh);
  }
}
