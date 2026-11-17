import * as THREE from 'three';
import type { InputManager } from '../../input/InputManager.ts';
import type { MultiplayerSession } from '../../network/MultiplayerSession.ts';
import type { PlayerSlot } from '../../network/protocol.ts';
import type { DownedOverlay } from '../../ui/downedOverlay.ts';
import type { WorldMarkers } from '../../ui/worldMarkers.ts';
import { REVIVE_RULES, ReviveTracker } from './reviveRules.ts';

/** How long a ping stays up, and the shortest time between two of this player's own (s). */
export const PING_RULES = { seconds: 6, cooldown: 0.6 } as const;

/** What the controller needs from the match (Game.create wires these to its own systems). */
export interface SquadDeps {
  readonly session: MultiplayerSession;
  readonly usernames: ReadonlyMap<PlayerSlot, string>;
  readonly markers: WorldMarkers;
  readonly downed: DownedOverlay;
  /** Whether a fallen player goes down and can be revived in this mode (the co-op modes). */
  readonly revives: boolean;
  /** Whether `slot` is on this player's side: pings are for teammates only. */
  readonly isTeammate: (slot: PlayerSlot) => boolean;
  /** Where another player's avatar is, or null when it is not in the match. */
  readonly positionOf: (slot: PlayerSlot) => THREE.Vector3 | null;
  /** The point in the world under this player's crosshair, or null (the sky). */
  readonly aimPoint: () => THREE.Vector3 | null;
  readonly setPrompt: (text: string | null) => void;
  /** A line in the kill feed. */
  readonly notify: (text: string) => void;
  readonly cue: (kind: 'gain' | 'lose' | 'ping') => void;
  /** The tag on a player's health row ("DOWN 18", "OUT"), or null for its health. */
  readonly setRowTag: (slot: PlayerSlot, tag: string | null) => void;
  /** Stands this player up where it fell with `health` (a teammate's revive). */
  readonly reviveOwn: (health: number) => void;
}

/** What a fallen player is: on its feet, down (a teammate can revive it), or out (until its mode
 * brings it back). */
export type OwnState = 'up' | 'down' | 'out';

/** The shared co-op layer (docs/coop.md), for every multiplayer match: pings a player's side can
 * see, and in the co-op modes the fallen (down, revivable for a while, then out until the mode
 * brings them back). Every client runs its own: a fall and a ping are self-reported and relayed,
 * and only the fallen player itself stands itself up. */
export class SquadController {
  private readonly tracker = new ReviveTracker();
  private own: OwnState = 'up';
  private ownBleed = 0;
  private readonly pings = new Map<PlayerSlot, number>();
  private pingCooldown = 0;
  private promptShown = false;
  private readonly shownTags = new Map<PlayerSlot, string>();

  constructor(private readonly deps: SquadDeps) {}

  get ownState(): OwnState {
    return this.own;
  }

  /** Every slot this client holds to be down or out, its own included. */
  get fallenSlots(): number[] {
    const slots = this.tracker.fallenSlots;
    if (this.own !== 'up') slots.push(this.deps.session.ownSlot);
    return slots;
  }

  /** One tick, on every client. `ownPosition` is this player's body centre. */
  update(dt: number, input: InputManager, ownPosition: THREE.Vector3, ownAlive: boolean): void {
    this.updatePings(dt, input, ownAlive);
    if (!this.deps.revives) return;

    if (this.own === 'down') {
      this.ownBleed -= dt;
      if (this.ownBleed <= 0) {
        this.own = 'out';
        this.deps.downed.showOut();
      } else {
        this.deps.downed.setBleed(this.ownBleed / REVIVE_RULES.bleedOut);
      }
    }

    const tick = this.tracker.update(
      dt,
      ownAlive ? ownPosition : null,
      (slot) => this.deps.positionOf(slot as PlayerSlot),
      input.isActionActive('interact'),
    );
    if (tick.target !== null) {
      const name = this.nameOf(tick.target as PlayerSlot);
      this.deps.setPrompt(tick.progress > 0 ? `REVIVING ${name}  ${Math.round(tick.progress * 100)}%` : `HOLD TO REVIVE ${name}`);
      this.promptShown = true;
    } else if (this.promptShown) {
      this.deps.setPrompt(null);
      this.promptShown = false;
    }
    if (tick.completed !== null) {
      const target = tick.completed as PlayerSlot;
      this.deps.session.connection.send({ type: 'reviveEvent', senderSlot: this.deps.session.ownSlot, targetSlot: target });
      this.deps.notify(`You revived ${this.nameOf(target)}`);
      this.deps.cue('gain');
    }

    for (const slot of this.tracker.fallenSlots as PlayerSlot[]) {
      const left = this.tracker.bleedLeft(slot);
      const at = left > 0 ? this.deps.positionOf(slot) : null;
      if (at) this.deps.markers.set(`down-${slot}`, at, `REVIVE ${this.nameOf(slot)}`);
      else this.deps.markers.remove(`down-${slot}`);
      this.tag(slot, left > 0 ? `DOWN ${Math.ceil(left)}` : 'OUT');
    }
  }

  private updatePings(dt: number, input: InputManager, ownAlive: boolean): void {
    if (this.pingCooldown > 0) this.pingCooldown -= dt;
    // Always consumed, so a press with nobody to see it does not fire late.
    const pressed = input.consumeJustPressed('ping');
    if (pressed && ownAlive && this.pingCooldown <= 0 && this.hasTeammate()) {
      const at = this.deps.aimPoint();
      if (at) {
        const ownSlot = this.deps.session.ownSlot;
        this.pingCooldown = PING_RULES.cooldown;
        this.showPing(ownSlot, at);
        this.deps.session.connection.send({ type: 'ping', senderSlot: ownSlot, x: at.x, y: at.y, z: at.z });
      }
    }
    for (const [slot, left] of this.pings) {
      if (left - dt > 0) {
        this.pings.set(slot, left - dt);
      } else {
        this.pings.delete(slot);
        this.deps.markers.remove(`ping-${slot}`);
      }
    }
  }

  private hasTeammate(): boolean {
    for (const slot of this.deps.usernames.keys()) {
      if (slot !== this.deps.session.ownSlot && this.deps.isTeammate(slot) && this.deps.positionOf(slot)) return true;
    }
    return false;
  }

  private showPing(slot: PlayerSlot, at: THREE.Vector3): void {
    this.pings.set(slot, PING_RULES.seconds);
    this.deps.markers.set(`ping-${slot}`, at, slot === this.deps.session.ownSlot ? 'YOUR PING' : this.nameOf(slot));
    this.deps.cue('ping');
  }

  /** A relayed ping: shown only when it comes from this player's own side. */
  receivePing(slot: PlayerSlot, x: number, y: number, z: number): void {
    if (slot === this.deps.session.ownSlot || !this.deps.isTeammate(slot)) return;
    this.showPing(slot, new THREE.Vector3(x, y, z));
  }

  /** This player just died in a mode with revives: it is down, not dead. */
  ownFell(): void {
    if (!this.deps.revives) return;
    this.own = 'down';
    this.ownBleed = REVIVE_RULES.bleedOut;
    this.deps.downed.showDown();
  }

  /** This player is on its feet again (a revive, or its mode brought it back). */
  ownStoodUp(): void {
    this.own = 'up';
    this.deps.downed.hide();
  }

  teammateFell(slot: PlayerSlot): void {
    if (!this.deps.revives || slot === this.deps.session.ownSlot || this.tracker.isFallen(slot)) return;
    this.tracker.fall(slot);
    this.deps.notify(`${this.nameOf(slot)} is down`);
    this.deps.cue('lose');
  }

  /** A late joiner's catch-up: these slots were already down when this client arrived. */
  adoptFallen(slots: Iterable<PlayerSlot>): void {
    if (!this.deps.revives) return;
    for (const slot of slots) if (slot !== this.deps.session.ownSlot) this.tracker.adopt(slot);
  }

  /** `slot` respawned, or left the match. */
  teammateStoodUp(slot: PlayerSlot): void {
    this.tracker.standUp(slot);
    this.deps.markers.remove(`down-${slot}`);
    this.tag(slot, null);
  }

  /** `slot` left the match: its ping goes with it. */
  forget(slot: PlayerSlot): void {
    this.teammateStoodUp(slot);
    this.pings.delete(slot);
    this.deps.markers.remove(`ping-${slot}`);
  }

  /** A relayed revive. Only its target acts on it, and only while it can still be revived. */
  receiveRevive(senderSlot: PlayerSlot, targetSlot: PlayerSlot): void {
    if (!this.deps.revives) return;
    if (targetSlot !== this.deps.session.ownSlot) {
      if (senderSlot !== this.deps.session.ownSlot) this.deps.notify(`${this.nameOf(senderSlot)} revived ${this.nameOf(targetSlot)}`);
      return;
    }
    if (this.own !== 'down') return;
    this.deps.notify(`${this.nameOf(senderSlot)} revived you`);
    this.deps.cue('gain');
    this.deps.reviveOwn(REVIVE_RULES.health);
  }

  private tag(slot: PlayerSlot, tag: string | null): void {
    if ((this.shownTags.get(slot) ?? null) === tag) return;
    if (tag === null) this.shownTags.delete(slot);
    else this.shownTags.set(slot, tag);
    this.deps.setRowTag(slot, tag);
  }

  private nameOf(slot: PlayerSlot): string {
    return (this.deps.usernames.get(slot) ?? `Player ${slot + 1}`).toUpperCase();
  }

  dispose(): void {
    for (const slot of this.pings.keys()) this.deps.markers.remove(`ping-${slot}`);
    for (const slot of this.tracker.fallenSlots) this.deps.markers.remove(`down-${slot}`);
    if (this.promptShown) this.deps.setPrompt(null);
    this.deps.downed.dispose();
  }
}
