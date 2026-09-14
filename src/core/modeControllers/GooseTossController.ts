import * as THREE from 'three';
import { ThrownGoose } from '../../entities/ThrownGoose.ts';
import { buildGooseMesh, disposeProceduralMesh } from '../../entities/Goose.ts';
import type { GooseManager } from '../../entities/GooseManager.ts';
import type { InputManager } from '../../input/InputManager.ts';
import type { MultiplayerSession } from '../../network/MultiplayerSession.ts';
import { WEAPON_HIP_POSITION } from '../../weapons/viewModel.ts';
import { GOOSE_PICKUP_RADIUS, GOOSE_THROW_SPEED } from '../config.ts';

/** Goose Toss mode's own input handling (pickup via 'interact', throw via 'fire') - split out of
 * Game.ts's update(), which previously kept the held-goose state (heldGooseId/heldGooseViewModel)
 * as two separate Game fields alongside this same pickup/throw logic. Multiplayer-only mode (see
 * gameModes.ts) - Game.create() only constructs this when multiplayer.gameMode === 'gooseToss'. */
export class GooseTossController {
  /** The id of the wandering goose currently held in this player's own hands, or null if
   * empty-handed. Distinct from WeaponManager's "unarmed" placeholder slot, which never actually
   * changes regardless of this. */
  private heldGooseId: string | null = null;
  /** The held-goose view model attached to the camera, shown/hidden alongside heldGooseId - built
   * once here at construction (Goose Toss match start), not per-pickup, so there's no per-pickup
   * asset work. */
  private readonly viewModel: THREE.Group;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly scene: THREE.Scene,
    private readonly gooseManager: GooseManager,
    /** Game's own thrownGeese map, passed by reference (not owned here) - Goose Toss shares this
     * plumbing with the Goose Launcher weapon's own projectile throws (see ThrownGoose.ts's class
     * comment on why the two share one flight/explosion path), so Game still owns and updates it. */
    private readonly thrownGeese: Map<string, ThrownGoose>,
    private readonly session: MultiplayerSession,
  ) {
    this.viewModel = buildGooseMesh();
    this.viewModel.scale.setScalar(0.55);
    this.viewModel.position.copy(WEAPON_HIP_POSITION);
    this.viewModel.visible = false;
    camera.add(this.viewModel);
  }

  /** Whether this player is currently holding a goose - Game's HUD reads this instead of a real
   * weapon name (see gameModes.ts's 'unarmed' placeholder for this mode). */
  get isHolding(): boolean {
    return this.heldGooseId !== null;
  }

  /** Runs once per tick before weaponManager.update() so a throw's 'fire' press is consumed here
   * first - WeaponManager never sees it, so the harmless 'unarmed' placeholder weapon never has
   * anything to (not) do with it either (see Game.update()'s call site). */
  update(playerPosition: THREE.Vector3, input: InputManager): void {
    const ownSlot = this.session.ownSlot;

    if (this.heldGooseId === null) {
      if (!input.consumeJustPressed('interact')) return;
      const nearestId = this.gooseManager.findNearestWithinRadius(playerPosition, GOOSE_PICKUP_RADIUS);
      if (nearestId === null || !this.gooseManager.removeById(nearestId)) return;
      this.heldGooseId = nearestId;
      this.viewModel.visible = true;
      this.session.connection.send({ type: 'goosePickedUp', senderSlot: ownSlot, id: nearestId });
      return;
    }

    if (!input.consumeJustPressed('fire')) return;
    // A fresh id per throw, not the picked-up goose's id: two players can win the same pickup race
    // (see GoosePickedUpMessage), and both then threw under one id, so the second gooseThrown
    // overwrote the first in every client's thrownGeese map and orphaned a goose mid-air.
    const id = crypto.randomUUID();
    this.heldGooseId = null;
    this.viewModel.visible = false;

    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    // A small forward offset so the goose doesn't immediately register as hitting the thrower's
    // own position on its very first physics tick.
    origin.addScaledVector(direction, 0.6);
    const velocity = direction.clone().multiplyScalar(GOOSE_THROW_SPEED);

    const thrown = new ThrownGoose(id, ownSlot, 'gooseToss', origin, velocity);
    this.scene.add(thrown.mesh);
    this.thrownGeese.set(id, thrown);

    this.session.connection.send({
      type: 'gooseThrown',
      senderSlot: ownSlot,
      id,
      originX: origin.x,
      originY: origin.y,
      originZ: origin.z,
      velX: velocity.x,
      velY: velocity.y,
      velZ: velocity.z,
      source: 'gooseToss',
    });
  }

  dispose(): void {
    this.camera.remove(this.viewModel);
    disposeProceduralMesh(this.viewModel);
  }
}
