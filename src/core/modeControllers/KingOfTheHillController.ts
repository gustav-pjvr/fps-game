import * as THREE from 'three';
import type { HillTone, HillView } from '../../entities/HillView.ts';
import type { InputManager } from '../../input/InputManager.ts';
import type { MultiplayerSession } from '../../network/MultiplayerSession.ts';
import type { MultiplayerMatchState } from '../../network/MultiplayerMatchState.ts';
import type { KothStateMessage, PlayerSlot } from '../../network/protocol.ts';
import type { KothHud } from '../../ui/kothHud.ts';
import type { MinimapMarker } from '../../ui/minimap.ts';
import type { WorldMarkers } from '../../ui/worldMarkers.ts';
import { KOTH_POINTS_TO_WIN, KOTH_STATE_SEND_INTERVAL } from '../config.ts';
import { hillEvents, HILL_RULES, HillState, sideOf, type HillPlayer, type HillSite, type HillSnapshot } from './hillState.ts';

/** What the controller needs from the match (Game.create wires these to its own systems). */
export interface KingOfTheHillDeps {
  readonly session: MultiplayerSession;
  readonly matchState: MultiplayerMatchState;
  readonly view: HillView;
  readonly hud: KothHud;
  readonly markers: WorldMarkers;
  /** Every player in the match, this one included, as the rules see them. */
  readonly players: () => HillPlayer[];
  readonly usernames: ReadonlyMap<PlayerSlot, string>;
  /** A headline in the middle of the screen, and a line in the kill feed. */
  readonly announce: (text: string) => void;
  readonly notify: (text: string) => void;
  readonly cue: (kind: 'gain' | 'lose' | 'alert') => void;
  readonly setPrompt: (text: string | null) => void;
  /** Wearing the crown stops this player sprinting. */
  readonly setSprintAllowed: (allowed: boolean) => void;
}

const scratch = new THREE.Vector3();

/** King of the Hill (docs/king-of-the-hill.md): a hill that moves round the map, held by standing
 * on it alone, and a crown (the golden goose) that doubles its points. The host owns the rules
 * (HillState) and sends everyone the state; this class is the host's driver and every client's
 * presenter: the ring, the markers, the panel, the announcements and the crown key. */
export class KingOfTheHillController {
  /** The host's rules. Null on a guest, and on the host until its sites are known. */
  private readonly rules: HillState | null;
  /** The state on screen: the host's own each tick, a guest's from the last message. */
  private state: HillSnapshot | null = null;
  private sendTimer = 0;
  private lastSentKey = '';
  private promptShown = false;

  /** `sites` and `rng` matter only on the host; a guest passes none and waits for the state. */
  constructor(private readonly deps: KingOfTheHillDeps, sites: readonly HillSite[] | null, rng: () => number, teams: boolean, scale = 1) {
    this.rules = deps.session.role === 'host' && sites ? new HillState(sites, KOTH_POINTS_TO_WIN, teams, rng, scale) : null;
    if (this.rules) this.state = this.rules.snapshot();
  }

  get snapshot(): HillSnapshot | null {
    return this.state;
  }

  /** Whether `slot` is on this player's side: nobody shoots their own team. */
  isTeammate(slot: PlayerSlot): boolean {
    const state = this.state;
    return !!state && state.teams && sideOf(slot, true) === sideOf(this.deps.session.ownSlot, true);
  }

  /** This player's own side wins or loses with the slot the host names as the winner. */
  sharesVictory(winnerSlot: PlayerSlot): boolean {
    return winnerSlot === this.deps.session.ownSlot || this.isTeammate(winnerSlot);
  }

  /** One tick. `interactPressed` is this player's E, already read by the caller. */
  update(dt: number, input: InputManager, ownPosition: THREE.Vector3, ownAlive: boolean): void {
    const { session, view } = this.deps;
    const ownSlot = session.ownSlot;
    const players = this.rules ? this.deps.players() : null;

    // The crown key, before the rules run, so a host's own claim counts this tick.
    const state = this.state;
    const nearCrown = !!state?.crownAt && ownAlive
      && Math.hypot(ownPosition.x - state.crownAt.x, ownPosition.z - state.crownAt.z) <= HILL_RULES.crownReach;
    // Set every tick while near: on the Facility the door prompt clears the same line each tick.
    if (nearCrown) this.deps.setPrompt('TAKE THE CROWN');
    else if (this.promptShown) this.deps.setPrompt(null);
    this.promptShown = nearCrown;
    if (nearCrown && input.consumeJustPressed('interact')) {
      if (this.rules && players) {
        const self = players.find((player) => player.slot === ownSlot);
        if (self) this.rules.claimCrown(self);
      } else {
        session.connection.send({ type: 'kothCrownClaim' });
      }
    }

    if (this.rules && players) {
      this.rules.update(dt, players);
      this.present(this.rules.snapshot());
      // The host's scoreboard is the truth: each slot shows its side's points.
      for (const player of players) this.deps.matchState.scoreboard.set(player.slot, this.rules.scoreOf(player.slot));
      this.broadcast(dt, players);
    }

    const shown = this.state;
    if (!shown) return;
    const tone = this.toneFor(shown);
    view.update(dt, shown, tone);
    this.deps.hud.set({
      tone,
      status: this.statusFor(shown, tone),
      moveIn: shown.moveIn,
      duration: shown.push ? HILL_RULES.pushDuration : HILL_RULES.duration,
      push: shown.push,
    });
    this.updateMarkers(shown);
    this.deps.setSprintAllowed(shown.crown !== ownSlot);
    // A guest's clock runs on between state messages, so the bar drains smoothly.
    if (!this.rules) this.state = { ...shown, moveIn: Math.max(0, shown.moveIn - dt) };
  }

  /** Adopts a new state and tells the player what changed. */
  private present(next: HillSnapshot): void {
    const previous = this.state;
    this.state = next;
    const ownSlot = this.deps.session.ownSlot;
    for (const event of hillEvents(previous, next)) {
      switch (event.kind) {
        case 'hillMoved':
          this.deps.announce('THE HILL HAS MOVED');
          this.deps.cue('alert');
          break;
        case 'movingSoon':
          this.deps.notify(`The hill moves in ${HILL_RULES.warning} seconds`);
          break;
        case 'finalPush':
          this.deps.announce('FINAL PUSH');
          this.deps.cue('alert');
          break;
        case 'crownTaken': {
          const mine = event.slot === ownSlot;
          this.deps.notify(mine ? 'You wear the crown: double points on the hill, no sprinting' : `${this.nameOf(event.slot)} wears the crown`);
          this.deps.cue(mine || this.isTeammate(event.slot) ? 'gain' : 'lose');
          break;
        }
        case 'crownDropped':
          this.deps.notify('The crown has fallen');
          break;
        case 'holdChanged':
          if (event.hold === 'held' && event.holder !== null) this.deps.cue(event.holder === sideOf(ownSlot, next.teams) ? 'gain' : 'lose');
          break;
      }
    }
  }

  private nameOf(slot: PlayerSlot): string {
    return this.deps.usernames.get(slot) ?? 'A player';
  }

  private toneFor(state: HillSnapshot): HillTone {
    if (state.hold === 'contested') return 'contested';
    if (state.hold === 'empty' || state.holder === null) return 'open';
    return state.holder === sideOf(this.deps.session.ownSlot, state.teams) ? 'ours' : 'theirs';
  }

  private statusFor(state: HillSnapshot, tone: HillTone): string {
    const crowned = state.crown !== null && state.holder === sideOf(state.crown, state.teams);
    switch (tone) {
      case 'contested': return 'Contested';
      case 'ours': return `${state.teams ? 'Your team holds' : 'You hold'} the hill${crowned ? ' x2' : ''}`;
      case 'theirs': return `${state.teams ? 'They hold' : `${this.holderName(state)} holds`} the hill${crowned ? ' x2' : ''}`;
      default: return 'The hill is open';
    }
  }

  private holderName(state: HillSnapshot): string {
    return state.holder === null ? 'Nobody' : this.nameOf(state.holder as PlayerSlot);
  }

  private updateMarkers(state: HillSnapshot): void {
    const { markers, view } = this.deps;
    markers.set('hill', view.hillPosition(state.hill, scratch), 'HILL');
    if (state.moveIn <= HILL_RULES.warning) markers.set('hill-next', view.hillPosition(state.next, scratch), 'NEXT HILL');
    else markers.remove('hill-next');
    const crown = view.crownPosition(state, scratch);
    if (crown) markers.set('crown', crown, 'CROWN');
    else markers.remove('crown');
  }

  /** The hill and the free crown on the minimap. */
  minimapMarkers(): MinimapMarker[] {
    const state = this.state;
    if (!state) return [];
    const markers: MinimapMarker[] = [{ id: 'hill', x: state.hill.x, z: state.hill.z }];
    if (state.crownAt) markers.push({ id: 'crown', x: state.crownAt.x, z: state.crownAt.z });
    return markers;
  }

  /** Host: the state to everyone, a few times a second and at once when something changes. */
  private broadcast(dt: number, players: readonly HillPlayer[]): void {
    const state = this.state!;
    const key = `${state.hill.x},${state.hill.z}|${state.hold}|${state.holder}|${state.crown}|${state.crownAt?.x},${state.crownAt?.z}|${state.push}`;
    this.sendTimer -= dt;
    if (this.sendTimer > 0 && key === this.lastSentKey) return;
    this.sendTimer = KOTH_STATE_SEND_INTERVAL;
    this.lastSentKey = key;
    this.deps.session.connection.send(this.stateMessage(players.map((player) => player.slot)));
  }

  private stateMessage(slots: readonly PlayerSlot[]): KothStateMessage {
    const state = this.state!;
    return {
      type: 'kothState',
      hill: [state.hill.x, state.hill.z],
      next: [state.next.x, state.next.z],
      radius: state.radius,
      moveIn: Math.round(state.moveIn * 10) / 10,
      hold: state.hold,
      holder: state.holder,
      crown: state.crown,
      crownAt: state.crownAt ? [state.crownAt.x, state.crownAt.z] : null,
      push: state.push,
      teams: state.teams,
      scores: slots.map((slot) => ({ slot, score: this.rules!.scoreOf(slot) })),
    };
  }

  /** Host: the state for one late joiner (MatchMessageRouter's sendFullSync). */
  syncMessage(): KothStateMessage | null {
    return this.rules && this.state ? this.stateMessage(this.deps.players().map((player) => player.slot)) : null;
  }

  /** Guest: the host's state. The scoreboard follows it. */
  receiveState(message: KothStateMessage): void {
    if (this.rules) return;
    for (const { slot, score } of message.scores) this.deps.matchState.scoreboard.set(slot, score);
    this.present({
      hill: { x: message.hill[0], z: message.hill[1] },
      next: { x: message.next[0], z: message.next[1] },
      radius: message.radius,
      moveIn: message.moveIn,
      hold: message.hold,
      holder: message.holder,
      crown: message.crown,
      crownAt: message.crownAt ? { x: message.crownAt[0], z: message.crownAt[1] } : null,
      push: message.push,
      teams: message.teams,
    });
  }

  /** Host: a guest reaches for the crown. The host judges it by where it sees that guest. */
  receiveClaim(slot: PlayerSlot): void {
    if (!this.rules) return;
    const claimant = this.deps.players().find((player) => player.slot === slot);
    if (claimant) this.rules.claimCrown(claimant, HILL_RULES.crownReachSlack);
  }

  /** Host: a player died or left. If they wore the crown it lies where they were. */
  playerDown(slot: PlayerSlot, at: { x: number; z: number }): void {
    this.rules?.dropCrown(slot, at);
  }

  dispose(): void {
    const { markers } = this.deps;
    for (const id of ['hill', 'hill-next', 'crown']) markers.remove(id);
    this.deps.setPrompt(null);
    this.deps.setSprintAllowed(true);
    this.deps.view.dispose();
    this.deps.hud.dispose();
  }
}
