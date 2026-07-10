import type * as THREE from 'three';
import type { GoldenGooseManager } from '../../entities/GoldenGooseManager.ts';
import type { InputManager } from '../../input/InputManager.ts';
import type { MultiplayerSession } from '../../network/MultiplayerSession.ts';
import type { MultiplayerMatchState } from '../../network/MultiplayerMatchState.ts';
import type { PlayerSlot } from '../../network/protocol.ts';
import { GOOSE_PICKUP_RADIUS, KOTH_POINT_INTERVAL_SECONDS } from '../config.ts';

/** King of the Hill's own input handling (claim via 'interact', drop via 'fire') and the
 * continuous points-per-second-held scoring while carrying - split out of Game.ts's update(),
 * which previously kept the hold-time accumulator as a separate Game field alongside this same
 * logic. Multiplayer-only mode (see gameModes.ts) - Game.create() only constructs this when
 * multiplayer.gameMode === 'kingOfTheHill'. */
export class KingOfTheHillController {
  /** Whole seconds of continuous carry time accumulated toward this client's own next point tick -
   * reset to 0 on drop (voluntary or death) so a re-pickup starts counting from zero rather than
   * resuming a stale partial second. */
  private holdSeconds = 0;

  constructor(
    private readonly goldenGooseManager: GoldenGooseManager,
    private readonly session: MultiplayerSession,
    private readonly matchState: MultiplayerMatchState,
  ) {}

  /** Runs before weaponManager.update() so a drop's 'fire' press is consumed here first, mirroring
   * GooseTossController's ordering, but only while actually carrying (see Game.update()'s call
   * site for why this doesn't block ordinary firing the rest of the time - King of the Hill keeps
   * the full arsenal, unlike Goose Toss's unarmed-only loadout). */
  update(dt: number, playerPosition: THREE.Vector3, input: InputManager): void {
    const ownSlot = this.session.ownSlot;
    const goose = this.goldenGooseManager;

    if (goose.carrierSlot === ownSlot) {
      if (input.consumeJustPressed('fire')) {
        this.drop(playerPosition.clone());
        return;
      }
      this.holdSeconds += dt;
      if (this.holdSeconds >= KOTH_POINT_INTERVAL_SECONDS) {
        this.holdSeconds -= KOTH_POINT_INTERVAL_SECONDS;
        const score = (this.matchState.scoreboard.get(ownSlot) ?? 0) + 1;
        this.matchState.scoreboard.set(ownSlot, score);
        this.session.connection.send({ type: 'kothScoreTick', senderSlot: ownSlot, score });
      }
      return;
    }

    if (goose.isHeld) return; // someone else is already carrying it
    if (!input.consumeJustPressed('interact')) return;
    if (playerPosition.distanceTo(goose.position) > GOOSE_PICKUP_RADIUS) return;

    goose.claim(ownSlot);
    this.session.connection.send({ type: 'goldenGoosePickedUp', senderSlot: ownSlot });
  }

  /** Shared by a voluntary drop (fire button, above) and an automatic drop on the carrier's own
   * death (see Game.ts's wasDead block, via dropIfCarrying below) - resets the local hold-time
   * accumulator and broadcasts so every other client relocates/unhides it at the same spot. */
  private drop(position: THREE.Vector3): void {
    this.goldenGooseManager.drop(position);
    this.holdSeconds = 0;
    this.session.connection.send({
      type: 'goldenGooseDropped',
      senderSlot: this.session.ownSlot,
      x: position.x,
      y: position.y,
      z: position.z,
    });
  }

  /** Drops the goose at `position` iff `slot` is the one currently carrying it - the shared guard
   * Game.ts's wasDead death-transition block needs before calling drop() unconditionally (dying
   * while NOT carrying must obviously do nothing). */
  dropIfCarrying(slot: PlayerSlot, position: THREE.Vector3): void {
    if (this.goldenGooseManager.carrierSlot === slot) this.drop(position);
  }

  /** Local-only counterpart to dropIfCarrying, used by Game.removeMultiplayerOpponent - a
   * departing player's own drop must NOT re-broadcast goldenGooseDropped, since every remaining
   * client reacts to the same relayed `playerLeft` message independently instead (see that call
   * site's own comment) - broadcasting here too would be a redundant, harmless-but-wrong message. */
  dropLocallyIfCarrying(slot: PlayerSlot, position: THREE.Vector3): void {
    if (this.goldenGooseManager.carrierSlot === slot) this.goldenGooseManager.drop(position);
  }
}
