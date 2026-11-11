import * as THREE from 'three';
import { castHitscan } from '../combat/hitscan.ts';
import type { SoundEngine } from '../audio/SoundEngine.ts';
import type { Player } from '../entities/Player.ts';
import type { InputManager } from '../input/InputManager.ts';
import type { ActiveMultiplayer } from '../network/multiplayerMatchTypes.ts';
import type { PlayerSlot } from '../network/protocol.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { Hud } from '../ui/hud.ts';
import type { InteractiveWorldObjects } from '../world/doors/interactiveObjects.ts';
import { EnemyDoorWaits } from '../world/facility/facilityDoors.ts';
import { towerIndexFromDoorId } from '../world/houses/valleyHouseIds.ts';
import {
  interactPrompt, type WorldObjectChanges, type WorldObjectKind, type WorldObjectWire,
} from '../world/facility/facilityObjectState.ts';
import { ENEMY_RADIUS, FACILITY_INTERACT_REACH, GOOSE_RADIUS, PLAYER_RADIUS } from './config.ts';
import { LOUDNESS } from '../audio/spatial.ts';

/** The host checks a guest's reach against where it sees that guest, which trails the guest's own
 * view by the network delay, so it allows this much more (m). */
const GUEST_REACH_SLACK = 1.5;
/** A door's look box may sit this far behind the physics hit (m): the closed door's own collider. */
const PICK_TOLERANCE = 0.2;

interface InteractionDeps {
  /** The Facility's doors and breakers, or the Valley houses' doors. */
  readonly objects: InteractiveWorldObjects;
  readonly physics: PhysicsWorld;
  readonly camera: THREE.Camera;
  readonly player: Player;
  readonly hud: Hud;
  readonly sound: SoundEngine;
  /** Null in single-player. */
  readonly multiplayer: ActiveMultiplayer | null;
  /** Where the living enemies and geese stand (this client's, the deciding one's): a door does not
   * close on them either. */
  readonly others?: () => { enemies: Iterable<{ x: number; z: number }>; geese: Iterable<{ x: number; z: number }> };
}

/**
 * Facility doors and breaker switches as gameplay (docs/facility-map.md, section 12): the look-at
 * prompt and the interact press, who decides (solo applies locally; in multiplayer the host is the
 * authority and broadcasts worldObjectState, a guest asks with worldInteract), enemies opening doors,
 * and the positional sounds. The world side (meshes, colliders, light) is FacilityObjects, or on the
 * Valley the houses' doors (world/houses/ValleyDoors.ts, docs/enterable-buildings.md), through the
 * same InteractiveWorldObjects interface and the same worldInteract / worldObjectState messages.
 */
export class FacilityInteraction {
  private readonly waits = new EnemyDoorWaits();
  /** Slots the host has sent the full state to since they appeared (see opponentInMatch). */
  private readonly synced = new Set<PlayerSlot>();
  private promptShown = false;
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(private readonly deps: InteractionDeps) {}

  /** Whether this client decides: single-player, or the multiplayer host. */
  private get authority(): boolean {
    return !this.deps.multiplayer || this.deps.multiplayer.session.role === 'host';
  }

  /**
   * Per tick: the doors slide, and while the local player can act (`input` set) the door or panel
   * they look at within reach shows its prompt and takes the interact press. The press is consumed
   * only then, so a mode's own use of interact (a pickup) still gets every other press.
   */
  update(dt: number, input: InputManager | null): void {
    this.deps.objects.update(dt);
    const target = input ? this.lookTarget() : null;
    if (target) {
      this.deps.hud.setPrompt('interact', interactPrompt(target.kind, this.deps.objects.state.isActive(target.kind, target.id)));
      this.promptShown = true;
      if (input!.consumeJustPressed('interact')) this.request(target.kind, target.id);
    } else if (this.promptShown) {
      this.deps.hud.setPrompt('interact', null);
      this.promptShown = false;
    }
  }

  /** The door or panel straight ahead of the camera within reach, unless a wall or player is nearer. */
  lookTarget(): { kind: WorldObjectKind; id: number } | null {
    const { camera, objects, physics, player } = this.deps;
    camera.getWorldPosition(this.origin);
    camera.getWorldDirection(this.direction);
    const target = objects.pick(this.origin, this.direction, FACILITY_INTERACT_REACH);
    if (!target) return null;
    const hit = castHitscan(physics, this.origin, this.direction, FACILITY_INTERACT_REACH, player.ownCollider);
    return !hit || target.distance <= hit.distance + PICK_TOLERANCE ? { kind: target.kind, id: target.id } : null;
  }

  /** The local player flips a door or breaker: applied here when this client decides, else asked of
   * the host. Also the debug API's path, so tests exercise the same rules. */
  request(kind: WorldObjectKind, id: number): void {
    const multiplayer = this.deps.multiplayer;
    if (this.authority) this.apply(kind, id, !this.deps.objects.state.isActive(kind, id));
    else multiplayer?.session.connection.send({ type: 'worldInteract', kind, id });
  }

  /** The debug API's way in: asks for an object to be open or on (`active`) through request, so a
   * test runs the same rules as a key press. False when it already is so or does not exist; on a
   * guest, true once asked. */
  requestState(kind: WorldObjectKind, id: number, active: boolean): boolean {
    const state = this.deps.objects.state;
    if (!state.has(kind, id) || state.isActive(kind, id) === active) return false;
    this.request(kind, id);
    return !this.authority || state.isActive(kind, id) === active;
  }

  /** Sets one object if this client decides, with its sound, and tells the guests. A door does not
   * close on a player, an enemy or a goose standing in it. True when it changed. */
  private apply(kind: WorldObjectKind, id: number, active: boolean): boolean {
    const { objects } = this.deps;
    if (kind === 'door' && !active && this.doorwayOccupied(id)) return false;
    if (!objects.set(kind, id, active)) return false;
    this.playSounds(kind === 'door' ? { doors: [id], breakers: [] } : { doors: [], breakers: [id] });
    this.broadcast();
    return true;
  }

  private broadcast(): void {
    const multiplayer = this.deps.multiplayer;
    if (multiplayer?.session.role === 'host') multiplayer.session.connection.send({ type: 'worldObjectState', ...this.deps.objects.wire() });
  }

  private doorwayOccupied(id: number): boolean {
    const { objects, others } = this.deps;
    if (objects.doorwayOccupied(id, this.playerBodies(), PLAYER_RADIUS)) return true;
    const rest = others?.();
    return !!rest && (objects.doorwayOccupied(id, rest.enemies, ENEMY_RADIUS) || objects.doorwayOccupied(id, rest.geese, GOOSE_RADIUS));
  }

  /** Where every living player stands, as this client sees them. */
  private playerBodies(): { x: number; z: number }[] {
    const { player, multiplayer } = this.deps, bodies: { x: number; z: number }[] = [];
    if (!player.isDead) bodies.push(player.position);
    for (const opponent of multiplayer?.opponents.values() ?? []) if (!opponent.isDead) bodies.push(opponent.remotePlayer.position);
    return bodies;
  }

  /** Host: guest `slot` pressed interact on an object. Applied when the id is real and the host sees
   * that guest within reach of it. */
  receiveInteract(slot: PlayerSlot, kind: WorldObjectKind, id: number): void {
    const { objects, multiplayer } = this.deps;
    const guest = multiplayer?.opponents.get(slot);
    if (!this.authority || !guest || guest.isDead || !objects.state.has(kind, id)) return;
    const at = guest.remotePlayer.position;
    if (objects.distanceTo(kind, id, at.x, at.z) > FACILITY_INTERACT_REACH + GUEST_REACH_SLACK) return;
    this.apply(kind, id, !objects.state.isActive(kind, id));
  }

  /** Guest: the host's doors and breakers (and on the Valley the list of open house doors).
   * Changes slide and sound as if seen happening. */
  receiveState(doors: string, breakers: string, valleyDoors?: readonly number[]): void {
    if (this.authority) return;
    const { objects } = this.deps;
    const wire = objects.parseWire(valleyDoors ? { doors, breakers, valleyDoors } : { doors, breakers });
    if (wire) this.playSounds(objects.applyWire(wire));
  }

  /** A late joiner's state from the welcome, applied at once and quietly. */
  applyInitial(value: unknown): void {
    const { objects } = this.deps;
    const wire = objects.parseWire(value);
    if (wire) objects.applyWire(wire, true);
  }

  /** Host: a playerSnapshot from `slot` arrived. The first one after it appeared gets the full state,
   * which it may have missed while loading. */
  opponentInMatch(slot: PlayerSlot): void {
    const multiplayer = this.deps.multiplayer;
    if (multiplayer?.session.role !== 'host' || this.synced.has(slot)) return;
    this.synced.add(slot);
    multiplayer.session.connection.sendTo(slot, { type: 'worldObjectState', ...this.deps.objects.wire() });
  }

  /** A slot left; if it rejoins, its first snapshot gets the state again. */
  forget(slot: PlayerSlot): void {
    this.synced.delete(slot);
  }

  wire(): WorldObjectWire {
    return this.deps.objects.wire();
  }

  /** Single-player Restart: doors and breakers back to the match's start (FacilityWorld.relightAll
   * has already put every lamp back). */
  reset(): void {
    this.waits.clear();
    this.deps.objects.reset();
  }

  /** The enemy door gate (entities/enemies/enemyNavigator.ts): holds an enemy at a closed door and,
   * after its wait, opens the door the way a player would. Enemies never close doors. */
  readonly enemyGate = (enemyId: number, x: number, z: number, dirX: number, dirZ: number, dt: number, reach?: number, feetY?: number): boolean => {
    if (!this.authority) return false;
    const door = this.deps.objects.closedDoorAhead(x, z, dirX, dirZ, reach, feetY);
    if (towerIndexFromDoorId(door) !== null) {
      this.waits.forget(enemyId);
      return true;
    }
    const step = this.waits.step(enemyId, door, dt);
    if (step === 'open') this.apply('door', door, true);
    return step !== 'walk';
  };

  /** An enemy or horde goose is gone: drops its door wait. */
  readonly forgetEnemy = (enemyId: number): void => this.waits.forget(enemyId);

  private playSounds(changes: WorldObjectChanges): void {
    const { objects, player, sound } = this.deps;
    const play = (kind: WorldObjectKind, id: number): void => {
      const at = objects.position(kind, id);
      if (!at) return;
      // Out of earshot: nothing to place. Nearer, the engine places it and muffles it by walls.
      if (at.distanceTo(player.position) >= LOUDNESS.world.maxDistance) return;
      const active = objects.state.isActive(kind, id);
      if (kind === 'door') sound.playDoorSlide(!active, at);
      else sound.playBreakerSwitch(active, at);
    };
    for (const id of changes.doors) play('door', id);
    for (const id of changes.breakers) play('breaker', id);
  }

  dispose(): void {
    if (this.promptShown) this.deps.hud.setPrompt('interact', null);
    this.promptShown = false;
  }
}
