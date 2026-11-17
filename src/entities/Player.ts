import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { allocateEntityId, type Entity } from './Entity.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { InputManager } from '../input/InputManager.ts';
import { Settings } from '../settings/Settings.ts';
import { inCutZone, isTerrainCollider } from '../world/underground.ts';
import {
  CAMERA_BOB_AMPLITUDE,
  EYE_OFFSET,
  FOOTSTEP_DISTANCE,
  GRAVITY,
  JUMP_SPEED,
  KNOCKBACK_DECAY_PER_SECOND,
  MAX_PITCH,
  MOUSE_SENSITIVITY,
  PLAYER_BOB_FREQUENCY,
  PLAYER_BOB_REFERENCE_SPEED,
  PLAYER_HEALTH,
  PLAYER_HEIGHT,
  PLAYER_MOVE_SPEED,
  PLAYER_RADIUS,
  RECOIL_DECAY,
  RECOIL_DECAY_FIRING,
  RECOIL_HOLD_SECONDS,
  RECOIL_MAX_CLIMB,
  RECOIL_MAX_SIDE,
  SPRINT_MULTIPLIER,
  WORLD_EDGE_PUSH_SPEED,
  WORLD_HARD_CLAMP_RADIUS,
  WORLD_SOFT_PUSH_START_RADIUS,
} from '../core/config.ts';

export interface PlayerSoundHooks {
  onDamaged: (sourcePosition?: THREE.Vector3) => void;
  /** `sprinting` while the sprint is held: a run lands harder than a walk. */
  onFootstep: (sprinting: boolean) => void;
}

export class Player implements Entity {
  readonly id = allocateEntityId();

  private readonly rigidBody: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  private yaw = 0;
  private pitch = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  /** Seconds since the last shot during which the recoil settles slowly (a burst is going). */
  private recoilHold = 0;
  private mobility = 1;
  private sprintAllowed = true;
  private verticalVelocity = 0;
  private grounded = false;
  private health = PLAYER_HEALTH;
  private footstepAccumulator = 0;

  /** Shared movement-bob phase/strength (see the PLAYER_BOB_* comment in config.ts) - advances only
   * while grounded and actually displacing, so it starts and fades with real movement rather than
   * running continuously like the lobby's idle bob. WeaponManager reads both via the getters below
   * to drive the weapon's own bob from this exact phase, not a second independent one. */
  private bobPhase = 0;
  private bobStrength = 0;

  /** Horizontal-only knockback velocity (m/s), added on top of normal input-driven movement each
   * tick and exponentially decayed toward zero - see KNOCKBACK_DECAY_PER_SECOND. The kinematic
   * character controller has no dynamic-body physics to apply a real Rapier impulse to, so this is
   * a manual stand-in, same shape as how recoilPitch layers a temporary kick on top of aim without
   * fighting normal look input. */
  private readonly knockbackVelocity = new THREE.Vector3();

  /** Render interpolation (Loop's fixed-timestep accumulator already computes `alpha`, but it went
   * unused - Game.render(_alpha) ignored it, so camera motion visibly stepped at 60Hz on
   * higher-refresh displays). previous/current are captured independently of camera.position
   * itself (not derived from it) so interpolateCamera's writes to camera.position never feed back
   * into the next tick's "previous" - only applyMovement's authoritative result does. */
  private readonly previousCameraPosition = new THREE.Vector3();
  private readonly previousCameraQuaternion = new THREE.Quaternion();
  private readonly currentCameraPosition = new THREE.Vector3();
  private readonly currentCameraQuaternion = new THREE.Quaternion();

  constructor(
    physics: PhysicsWorld,
    private readonly camera: THREE.PerspectiveCamera,
    spawnPosition: THREE.Vector3,
    private readonly sounds: PlayerSoundHooks,
  ) {
    const cylinderHalfHeight = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawnPosition.x,
      spawnPosition.y,
      spawnPosition.z,
    );
    this.rigidBody = physics.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(cylinderHalfHeight, PLAYER_RADIUS);
    this.collider = physics.world.createCollider(colliderDesc, this.rigidBody);
    physics.registerCollider(this.collider, this);

    this.controller = physics.world.createCharacterController(0.05);
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.controller.enableAutostep(0.5, 0.2, true);
    this.controller.enableSnapToGround(0.3);

    this.currentCameraPosition.set(spawnPosition.x, spawnPosition.y + EYE_OFFSET, spawnPosition.z);
    this.previousCameraPosition.copy(this.currentCameraPosition);
    this.camera.position.copy(this.currentCameraPosition);
  }

  update(dt: number, input: InputManager): void {
    this.previousCameraPosition.copy(this.currentCameraPosition);
    this.previousCameraQuaternion.copy(this.currentCameraQuaternion);
    this.applyLook(input);
    this.applyMovement(dt, input);
    if (this.shieldSeconds > 0) this.shieldSeconds -= dt;
    // While a burst is going the sights come back slowly, so its shots stack into a climb; once the
    // firing stops they settle at the usual rate.
    const recoilDecay = this.recoilHold > 0 ? RECOIL_DECAY_FIRING : RECOIL_DECAY;
    if (this.recoilHold > 0) this.recoilHold -= dt;
    this.recoilPitch *= Math.max(0, 1 - recoilDecay * dt);
    this.recoilYaw *= Math.max(0, 1 - recoilDecay * dt);
    this.knockbackVelocity.multiplyScalar(Math.max(0, 1 - KNOCKBACK_DECAY_PER_SECOND * dt));
    if (this.knockbackVelocity.lengthSq() < 0.0001) this.knockbackVelocity.set(0, 0, 0);
  }

  /** Blends the camera's on-screen transform between the last two fixed-timestep ticks by `alpha`
   * (Loop's fractional tick progress) - call once per rendered frame, after every fixed update for
   * that frame has already run. Smooths camera motion on displays faster than the 60Hz simulation
   * without changing simulation timing. Firing/hitscan always reads camera.position from inside
   * update() (via WeaponManager.fireShot, which runs before render()), so it always sees the
   * authoritative tick position, never an interpolated one - this only affects what's drawn. */
  interpolateCamera(alpha: number): void {
    this.camera.position.lerpVectors(this.previousCameraPosition, this.currentCameraPosition, alpha);
    this.camera.quaternion.slerpQuaternions(this.previousCameraQuaternion, this.currentCameraQuaternion, alpha);
  }

  /** Temporary camera kick that decays back to the player's held aim over time: `kick` upward,
   * `side` to the left (positive) or right. */
  addRecoil(kick: number, side = 0): void {
    this.recoilPitch = Math.min(RECOIL_MAX_CLIMB, this.recoilPitch + kick);
    this.recoilYaw = Math.max(-RECOIL_MAX_SIDE, Math.min(RECOIL_MAX_SIDE, this.recoilYaw + side));
    this.recoilHold = RECOIL_HOLD_SECONDS;
  }

  /** Walking and sprinting speed as a fraction of normal: the held weapon's weight
   * (WeaponDefinition.mobility), set by WeaponManager each tick. */
  setMobility(multiplier: number): void {
    this.mobility = multiplier;
  }

  /** False while a mode forbids sprinting (King of the Hill's crown): the sprint key does nothing. */
  setSprintAllowed(allowed: boolean): void {
    this.sprintAllowed = allowed;
  }

  /** Pushes the player away from an explosion (or any other knockback source) along `direction`
   * (need not be normalized - only its direction matters) at `strength` m/s, layered on top of
   * whatever knockback is already decaying rather than replacing it, so two near-simultaneous
   * blasts compound instead of one silently overwriting the other. */
  applyKnockback(direction: THREE.Vector3, strength: number): void {
    if (strength <= 0) return;
    const horizontal = new THREE.Vector3(direction.x, 0, direction.z);
    if (horizontal.lengthSq() < 1e-6) return;
    horizontal.normalize().multiplyScalar(strength);
    this.knockbackVelocity.add(horizontal);
  }

  get currentHealth(): number {
    return this.health;
  }

  get maxHealth(): number {
    return PLAYER_HEALTH;
  }

  get isDead(): boolean {
    return this.health <= 0;
  }

  /** Test-only (window.__gameDebug.setPlayerInvulnerable): lets the perf log spec watch a long
   * fight without the player dying and freezing the simulation. Never set by gameplay code. */
  debugInvulnerable = false;

  /** Seconds of protection left after a revive or a Second Wind: no damage lands while it runs. */
  private shieldSeconds = 0;

  takeDamage(amount: number, sourcePosition?: THREE.Vector3): void {
    if (this.isDead || this.debugInvulnerable || this.shieldSeconds > 0) return;
    this.health = Math.max(0, this.health - amount);
    this.sounds.onDamaged(sourcePosition);
  }

  /** Restores up to `amount` health (never past the maximum, and never for a dead player: a health
   * pack does not revive). Returns how much was actually restored. */
  heal(amount: number): number {
    if (this.isDead || !(amount > 0)) return 0;
    const before = this.health;
    this.health = Math.min(PLAYER_HEALTH, this.health + amount);
    return this.health - before;
  }

  /** Stands a fallen player up where they are with `health` (a teammate's revive, a Second Wind),
   * shielded for `shield` seconds so the blast that felled them does not do it again. */
  revive(health: number, shield: number): void {
    this.health = Math.max(1, Math.min(PLAYER_HEALTH, health));
    this.shieldSeconds = shield;
    this.knockbackVelocity.set(0, 0, 0);
  }

  respawn(position: THREE.Vector3): void {
    this.shieldSeconds = 0;
    this.health = PLAYER_HEALTH;
    this.verticalVelocity = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilHold = 0;
    this.bobPhase = 0;
    this.bobStrength = 0;
    this.knockbackVelocity.set(0, 0, 0);
    const target = { x: position.x, y: position.y, z: position.z };
    this.clampToWorldBounds(target);
    this.rigidBody.setNextKinematicTranslation(target);
    this.rigidBody.setTranslation(target, true);
    this.snapCameraPositionTo(target);
  }

  /** Instantly repositions the player. Resets vertical velocity like respawn() does, but
   * deliberately leaves health/ammo untouched - used both as a debug/test helper (e.g. for e2e
   * tests to reach a known world feature without needing to navigate blindly) and by the
   * multiplayer pause menu's "Respawn" button (Game.ts's manualRespawn()), which is an unstuck
   * button for a player glitched into geometry, not a full respawn - it must not give a free
   * health/ammo reset. */
  debugTeleport(position: THREE.Vector3): void {
    this.verticalVelocity = 0;
    this.knockbackVelocity.set(0, 0, 0);
    const target = { x: position.x, y: position.y, z: position.z };
    this.clampToWorldBounds(target);
    this.rigidBody.setNextKinematicTranslation(target);
    this.rigidBody.setTranslation(target, true);
    this.snapCameraPositionTo(target);
  }

  /** Resets both interpolation endpoints to the same instantaneous position - without this, a
   * teleport/respawn would leave `previousCameraPosition` at the pre-teleport spot, and the next
   * render's interpolateCamera would draw a brief streak crossing the whole jump instead of an
   * instant cut. */
  private snapCameraPositionTo(target: { x: number; y: number; z: number }): void {
    this.currentCameraPosition.set(target.x, target.y + EYE_OFFSET, target.z);
    this.previousCameraPosition.copy(this.currentCameraPosition);
    this.camera.position.copy(this.currentCameraPosition);
  }

  /** Debug/test helper - snaps yaw/pitch to face a world point directly, bypassing mouse input. */
  debugLookAt(target: THREE.Vector3): void {
    const eye = this.position.clone();
    eye.y += EYE_OFFSET;
    const dx = target.x - eye.x;
    const dz = target.z - eye.z;
    const dy = target.y - eye.y;
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(dy, horizontalDistance)));
  }

  private applyLook(input: InputManager): void {
    // Scale sensitivity by the current zoom ratio so aiming feels consistent while ADS narrows the
    // FOV. Settings.getFov() (the user's own hip-fire baseline), not the bare CAMERA_FOV constant -
    // otherwise this ratio would read as something other than 1 at hip fire for anyone who's
    // changed the FOV slider away from the hardcoded default, silently scaling ordinary look
    // sensitivity even while not aiming at all.
    const sensitivity = MOUSE_SENSITIVITY * Settings.getMouseSensitivity() * (this.camera.fov / Settings.getFov());
    const { dx, dy } = input.consumeLookDelta();
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  private applyMovement(dt: number, input: InputManager): void {
    const yawQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(yawQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(yawQuat);

    const move = input.getMoveVector();

    const currentBeforeMove = this.rigidBody.translation();

    const moveDir = forward.multiplyScalar(-move.y).addScaledVector(right, move.x);

    const speed = PLAYER_MOVE_SPEED * this.mobility * (this.sprintAllowed && input.isActionActive('sprint') ? SPRINT_MULTIPLIER : 1);
    moveDir.multiplyScalar(speed * dt);

    this.applyWorldEdgePush(moveDir, currentBeforeMove, dt);

    if (this.knockbackVelocity.lengthSq() > 0) {
      moveDir.x += this.knockbackVelocity.x * dt;
      moveDir.z += this.knockbackVelocity.z * dt;
    }

    if (this.grounded && input.isActionActive('jump')) {
      this.verticalVelocity = JUMP_SPEED;
    }
    this.verticalVelocity += GRAVITY * dt;

    const desiredMovement = { x: moveDir.x, y: this.verticalVelocity * dt, z: moveDir.z };

    const insideCut = inCutZone(currentBeforeMove.x, currentBeforeMove.z, PLAYER_RADIUS);
    this.controller.computeColliderMovement(this.collider, desiredMovement, undefined, undefined,
      insideCut ? (collider) => !isTerrainCollider(collider.handle) : undefined);

    const computed = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalVelocity < 0) {
      this.verticalVelocity = 0;
    }

    const horizontalMoveDistance = Math.sqrt(computed.x * computed.x + computed.z * computed.z);
    if (this.grounded) {
      this.footstepAccumulator += horizontalMoveDistance;
      if (this.footstepAccumulator >= FOOTSTEP_DISTANCE) {
        this.footstepAccumulator -= FOOTSTEP_DISTANCE;
        this.sounds.onFootstep(this.sprintAllowed && input.isActionActive('sprint'));
      }
    }

    // Bob strength (and therefore visible amplitude) reaches 0 exactly when the phase stops
    // advancing, so the bob always settles back through its own neutral point when the player
    // slows to a stop instead of freezing mid-swing.
    this.bobStrength = this.grounded
      ? Math.min(1, horizontalMoveDistance / dt / PLAYER_BOB_REFERENCE_SPEED)
      : 0;
    this.bobPhase += dt * PLAYER_BOB_FREQUENCY * this.bobStrength;

    const next = {
      x: currentBeforeMove.x + computed.x,
      y: currentBeforeMove.y + computed.y,
      z: currentBeforeMove.z + computed.z,
    };

    this.clampToWorldBounds(next);
    this.rigidBody.setNextKinematicTranslation(next);

    const effectivePitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + this.recoilPitch));
    const lookQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(effectivePitch, this.yaw + this.recoilYaw, 0, 'YXZ'));
    const cameraBobOffset = Math.sin(this.bobPhase) * CAMERA_BOB_AMPLITUDE * this.bobStrength;
    this.currentCameraPosition.set(next.x, next.y + EYE_OFFSET + cameraBobOffset, next.z);
    this.currentCameraQuaternion.copy(lookQuat);
    // Camera stays authoritative (not interpolated) for the rest of this tick - firing reads it
    // synchronously later in the same Game.update() call, and interpolateCamera() overwrites it
    // again next render() anyway.
    this.camera.position.copy(this.currentCameraPosition);
    this.camera.quaternion.copy(this.currentCameraQuaternion);
  }

  /** Gentle inward nudge as the player nears the world boundary - see WORLD_PLAN.md §2 / config.ts. */
  private applyWorldEdgePush(moveDir: THREE.Vector3, current: RAPIER.Vector, dt: number): void {
    const horizontalDistance = Math.sqrt(current.x * current.x + current.z * current.z);
    if (horizontalDistance <= WORLD_SOFT_PUSH_START_RADIUS) return;

    const pushT = Math.min(
      1,
      (horizontalDistance - WORLD_SOFT_PUSH_START_RADIUS) / (WORLD_HARD_CLAMP_RADIUS - WORLD_SOFT_PUSH_START_RADIUS),
    );
    const pushMagnitude = WORLD_EDGE_PUSH_SPEED * pushT * dt;
    moveDir.x += (-current.x / horizontalDistance) * pushMagnitude;
    moveDir.z += (-current.z / horizontalDistance) * pushMagnitude;
  }

  /** Absolute last-resort clamp so the player can never end up past generated terrain. */
  private clampToWorldBounds(next: { x: number; y: number; z: number }): void {
    const horizontalDistance = Math.sqrt(next.x * next.x + next.z * next.z);
    if (horizontalDistance <= WORLD_HARD_CLAMP_RADIUS) return;

    const scale = WORLD_HARD_CLAMP_RADIUS / horizontalDistance;
    next.x *= scale;
    next.z *= scale;
  }

  get position(): THREE.Vector3 {
    const t = this.rigidBody.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** Multiplayer (MULTIPLAYER_PLAN.md §3) - broadcast in this client's own outgoing snapshots so
   * the opponent's RemotePlayer can face the right way, not just stand at the right position. */
  get facingYaw(): number {
    return this.yaw;
  }

  get facingPitch(): number {
    return this.pitch;
  }

  /** So hitscan can exclude the shooter's own capsule - camera.position sits inside it, which was self-hitting. */
  get ownCollider(): RAPIER.Collider {
    return this.collider;
  }

  /** Shared movement-bob phase (see the PLAYER_BOB_* comment in config.ts) - WeaponManager reads
   * this alongside movementBobStrength to drive the weapon view model's own bob from the exact
   * same phase the camera bob uses, rather than tracking a second independent one. */
  get movementBobPhase(): number {
    return this.bobPhase;
  }

  /** 0..1 - how much of the bob amplitude should currently show, ramping with horizontal ground
   * speed and dropping to 0 while airborne/climbing/stationary. */
  get movementBobStrength(): number {
    return this.bobStrength;
  }
}
