import type { WaveBias } from '../../entities/enemies/director/pacingDirector.ts';

// Operation Uplink (docs/uplink.md): the numbers of its four stages.

/** Breach and Defend only advance while a living player stands this close to the terminal or the
 * relay, on the surface; farther out the hack or the upload pauses. */
export const ZONE_RADIUS = 14;
/** Seconds inside the zone to hack the first uplink terminal. */
export const HACK_DURATION = 25;
/** Breach's one wave (light resistance) comes in at this many seconds of hack. */
export const HACK_WAVE_AT = 10;
export const HACK_WAVE_SIZE = 2;
/** Within this many metres of the data core, on its level, interact takes it. */
export const CORE_PICKUP_RADIUS = 3.5;
/** Within this many metres of the relay, on the surface, the carrier's interact plugs the core in. */
export const RELAY_PLUG_RADIUS = 9;
/** A pursuit wave meets the carrier when it first carries the core on the surface, and again every
 * this many seconds of carrying there. */
export const CARRY_WAVE_INTERVAL = 25;
export const CARRY_WAVE_BASE = 2;
/** Seconds of upload at the relay, in three waves. */
export const UPLOAD_DURATION = 75;
/** The upload's waves: when each starts (seconds of upload), its size before the alert level adds
 * to it, its mix, and whether a Warden leads it. */
export const UPLOAD_WAVES: readonly { readonly at: number; readonly base: number; readonly bias: WaveBias; readonly warden: boolean }[] = [
  { at: 0, base: 2, bias: 'mixed', warden: false },
  { at: 25, base: 3, bias: 'rusher', warden: false },
  { at: 50, base: 2, bias: 'sniper', warden: true },
];
/** Seconds to reach the extraction point once the upload is done. */
export const EXTRACTION_SECONDS = 60;
export const EXTRACTION_RADIUS = 6;
/** The pursuit during the extraction: seconds into the countdown, size before the alert level, mix. */
export const EXTRACTION_WAVES: readonly { readonly at: number; readonly base: number; readonly bias: WaveBias }[] = [
  { at: 0, base: 3, bias: 'mixed' },
  { at: 30, base: 2, bias: 'rusher' },
];
/** Solo redeploys: deaths the operation survives. */
export const REDEPLOYS = 2;

/** The alert level runs from 1 to this. */
export const ALERT_MAX = 5;
/** Time alone raises the alert one level in this many seconds. */
export const ALERT_SECONDS_PER_LEVEL = 120;
/** Levels a kill adds, and levels a shot fired adds (noise). */
export const ALERT_PER_KILL = 0.06;
export const ALERT_PER_SHOT = 0.004;

/** How many enemies a wave of `base` brings at this alert level: one more at 3, two more at 5. */
export function waveSize(base: number, alert: number): number {
  return base + Math.floor((alert - 1) / 2);
}

export interface MissionPoint {
  readonly x: number;
  readonly z: number;
}

/** A place of the operation. `underground` marks the Valley's core site, down in a tower's lab: only
 * a player who is below ground too can take the core there. */
export interface MissionSite extends MissionPoint {
  readonly underground: boolean;
}

export interface MissionSites {
  readonly breach: MissionPoint;
  readonly core: MissionSite;
  readonly relay: MissionPoint;
  readonly extraction: MissionPoint;
}

/** One player this tick. Solo passes one; a squad passes everyone, in a fixed order. */
export interface MissionPlayer {
  readonly x: number;
  readonly z: number;
  readonly alive: boolean;
  /** Below ground on the Valley (a tower's lab). Zones and the extraction only count on the surface. */
  readonly underground?: boolean;
}

export type MissionStage = 'breach' | 'fetch' | 'defend' | 'extract';
export type MissionPhase = MissionStage | 'won' | 'lost';
export const MISSION_STAGES: readonly MissionStage[] = ['breach', 'fetch', 'defend', 'extract'];
/** Why the operation was lost: the last redeploy was spent, or the extraction countdown ran out. */
export type MissionLoss = 'signalLost' | 'extractionMissed';

/** Where the data core is: not in play yet, at its site, on the ground where its carrier fell, in a
 * player's hands, or plugged into the relay. */
export type CoreState = 'hidden' | 'home' | 'dropped' | 'carried' | 'plugged';

export type MissionEvent =
  | { readonly kind: 'stageStarted'; readonly stage: MissionStage }
  | { readonly kind: 'waveRequested'; readonly count: number; readonly bias: WaveBias; readonly warden: boolean }
  | { readonly kind: 'corePicked'; readonly player: number }
  | { readonly kind: 'coreDropped'; readonly player: number; readonly x: number; readonly z: number }
  | { readonly kind: 'alertRaised'; readonly level: number }
  | { readonly kind: 'squadDown'; readonly redeploysLeft: number }
  | { readonly kind: 'won' }
  | { readonly kind: 'lost'; readonly reason: MissionLoss };

export interface MissionInput {
  readonly dt: number;
  readonly players: readonly MissionPlayer[];
  /** The index in `players` of the player who pressed interact this tick, or null. */
  readonly interact: number | null;
  /** Enemies killed and shots fired this tick: both raise the alert. */
  readonly kills: number;
  readonly shots: number;
}

/** What the HUD and the world visuals show this frame (docs/uplink.md). */
export interface MissionView {
  readonly phase: MissionPhase;
  /** The stage being played, or the one the operation ended in. */
  readonly stage: MissionStage;
  /** 1 to 4. */
  readonly stageNumber: number;
  readonly sites: MissionSites;
  /** The hack: 0 to 1, and whether nobody is in the zone. */
  readonly hack: { readonly progress: number; readonly paused: boolean };
  readonly core: { readonly state: CoreState; readonly x: number; readonly z: number; readonly underground: boolean; readonly carrier: number | null };
  /** The upload: 0 to 1, whether nobody is in the zone, and the wave it is in (1 to 3). */
  readonly upload: { readonly progress: number; readonly paused: boolean; readonly wave: number };
  /** Seconds left to reach the extraction. */
  readonly extractionLeft: number;
  /** 1 to 5. */
  readonly alert: number;
  readonly redeploys: number;
  /** Everyone is down and a redeploy is left: the operation waits for redeploy(). */
  readonly awaitingRedeploy: boolean;
  /** The interaction prompt for the first player, when interact would do something. */
  readonly prompt: string | null;
  readonly loss: MissionLoss | null;
  /** Seconds the operation has run, not counting time spent down. */
  readonly elapsed: number;
}

/** The four sites from a map's four objective points (the Valley's watch towers, the Facility's
 * objective rooms): the terminal is the point nearest the start, the data core lies at the point
 * farthest from the terminal that `canHoldCore` allows (any of them when none is allowed), the relay
 * is the remaining point farther from the core, so the carry is the long way, and the last is the
 * extraction. Returns indices into `points`. Deterministic: ties keep the points' own order. */
export function planOperation(
  points: readonly MissionPoint[],
  start: MissionPoint,
  canHoldCore: (index: number) => boolean = () => true,
): { breach: number; core: number; relay: number; extraction: number } {
  if (points.length < 4) throw new Error(`Operation Uplink needs 4 points, got ${points.length}`);
  const indices = points.map((_, index) => index);
  const nearestFirst = (to: MissionPoint) => (a: number, b: number) => distance(points[a]!, to) - distance(points[b]!, to);
  const breach = [...indices].sort(nearestFirst(start))[0]!;
  const rest = indices.filter((index) => index !== breach).slice(0, 3);
  const allowed = rest.filter(canHoldCore);
  const core = [...(allowed.length > 0 ? allowed : rest)].sort(nearestFirst(points[breach]!)).reverse()[0]!;
  const [extraction, relay] = rest.filter((index) => index !== core).sort(nearestFirst(points[core]!)) as [number, number];
  return { breach, core, relay, extraction };
}

/** What the minimap marks (the Facility's map, docs/facility-map.md): the place the current stage
 * sends the player to. */
export function missionMapMarkers(view: MissionView): { id: string; x: number; z: number }[] {
  const { sites, core } = view;
  if (view.phase === 'breach') return [{ id: 'terminal', x: sites.breach.x, z: sites.breach.z }];
  if (view.phase === 'fetch') {
    const relay = { id: 'relay', x: sites.relay.x, z: sites.relay.z };
    return core.state === 'carried' ? [relay] : [{ id: 'core', x: core.x, z: core.z }, relay];
  }
  if (view.phase === 'defend') return [{ id: 'relay', x: sites.relay.x, z: sites.relay.z }];
  if (view.phase === 'extract') return [{ id: 'extract', x: sites.extraction.x, z: sites.extraction.z }];
  return [];
}

/**
 * Operation Uplink (docs/uplink.md) as a pure state machine, unit tested like the pacing director:
 * signals in (time, every player's position and whether they live, the interact press, kills and
 * shots), events out (waves to send, stage changes, the core changing hands, the result). Game owns
 * the visuals and the spawning; nothing here touches three.js, physics or the DOM.
 *
 * Four stages. Breach: stand in the terminal's zone until the hack completes. Fetch: take the data
 * core with interact and carry it to the relay; it drops where its carrier falls. Defend: plugging
 * the core in starts the upload, three waves, the last led by a Warden; it pauses while nobody is
 * in the zone. Extract: reach the extraction point before the countdown ends.
 *
 * The alert level rises with time, kills and shots, never falls, and sizes every wave after
 * Breach's. When every player is down the operation waits for redeploy() while one is left, and is
 * lost otherwise.
 */
export class MissionState {
  private phase: MissionPhase = 'breach';
  private stage: MissionStage = 'breach';
  private hackSeconds = 0;
  private hackWaveSent = false;
  private coreState: CoreState = 'hidden';
  private coreAt: MissionSite;
  private carrier: number | null = null;
  /** Seconds the core has been carried on the surface, and the pursuit waves sent for them. */
  private carrySeconds = 0;
  private carryWaves = 0;
  private uploadSeconds = 0;
  private uploadWaves = 0;
  private extractSeconds = 0;
  private extractWaves = 0;
  private heat = 0;
  private alert = 1;
  private redeploys = REDEPLOYS;
  private awaitingRedeploy = false;
  private loss: MissionLoss | null = null;
  private elapsed = 0;

  constructor(readonly sites: MissionSites) {
    this.coreAt = sites.core;
  }

  /** Everyone is down and a redeploy is left: nothing moves until redeploy() is called. */
  get waitingForRedeploy(): boolean {
    return this.awaitingRedeploy;
  }

  update(input: MissionInput): MissionEvent[] {
    if (this.phase === 'won' || this.phase === 'lost' || this.awaitingRedeploy) return [];
    const events: MissionEvent[] = [];
    const { players } = input;

    // The core falls where its carrier does, before anything else reads who holds it.
    if (this.carrier !== null && !players[this.carrier]?.alive) {
      const fallen = players[this.carrier];
      const at = fallen ?? this.coreAt;
      this.coreAt = { x: at.x, z: at.z, underground: fallen ? fallen.underground === true : this.coreAt.underground };
      this.coreState = 'dropped';
      events.push({ kind: 'coreDropped', player: this.carrier, x: this.coreAt.x, z: this.coreAt.z });
      this.carrier = null;
    }

    if (!players.some((player) => player.alive)) {
      if (this.redeploys > 0) {
        this.awaitingRedeploy = true;
        events.push({ kind: 'squadDown', redeploysLeft: this.redeploys });
      } else {
        this.lose('signalLost', events);
      }
      return events;
    }

    const dt = Math.max(0, input.dt);
    this.elapsed += dt;
    this.heat += dt / ALERT_SECONDS_PER_LEVEL + Math.max(0, input.kills) * ALERT_PER_KILL + Math.max(0, input.shots) * ALERT_PER_SHOT;
    const alert = Math.min(ALERT_MAX, 1 + Math.floor(this.heat));
    if (alert > this.alert) {
      this.alert = alert;
      events.push({ kind: 'alertRaised', level: alert });
    }

    if (this.phase === 'breach') this.updateBreach(dt, players, events);
    else if (this.phase === 'fetch') this.updateFetch(dt, input, events);
    else if (this.phase === 'defend') this.updateDefend(dt, players, events);
    else this.updateExtract(dt, players, events);
    return events;
  }

  /** Spends a redeploy after everyone went down: the stage starts over, and the squad stands at the
   * returned point, the site of the last finished stage (null in Breach: the start). The dropped
   * core stays where it fell. No-op (null) unless the operation is waiting for it. */
  redeploy(): MissionPoint | null {
    if (!this.awaitingRedeploy) return null;
    this.awaitingRedeploy = false;
    this.redeploys--;
    if (this.stage === 'breach') {
      this.hackSeconds = 0;
      this.hackWaveSent = false;
      return null;
    }
    if (this.stage === 'fetch') {
      this.carrySeconds = 0;
      this.carryWaves = 0;
      return this.sites.breach;
    }
    if (this.stage === 'defend') {
      // Back to the start of the wave it fell in, which is sent again.
      const wave = Math.max(0, this.uploadWaves - 1);
      this.uploadSeconds = UPLOAD_WAVES[wave]!.at;
      this.uploadWaves = wave;
      return this.sites.relay;
    }
    this.extractSeconds = 0;
    this.extractWaves = 0;
    return this.sites.relay;
  }

  /** Test hook (window.__gameDebug.completeMissionStage): finishes the current stage as if its
   * rule had been met, with the same events. */
  completeStage(): MissionEvent[] {
    const events: MissionEvent[] = [];
    if (this.awaitingRedeploy) return events;
    if (this.phase === 'breach') {
      this.hackSeconds = HACK_DURATION;
      this.startStage('fetch', events);
    } else if (this.phase === 'fetch') {
      this.startStage('defend', events);
    } else if (this.phase === 'defend') {
      this.uploadSeconds = UPLOAD_DURATION;
      this.startStage('extract', events);
    } else if (this.phase === 'extract') {
      this.phase = 'won';
      events.push({ kind: 'won' });
    }
    return events;
  }

  view(players: readonly MissionPlayer[]): MissionView {
    const first = players[0];
    let prompt: string | null = null;
    if (this.phase === 'fetch' && first?.alive && !this.awaitingRedeploy) {
      if (this.carrier === 0) {
        if (this.canPlug(first)) prompt = 'PLUG IN THE DATA CORE';
      } else if (this.carrier === null && this.canTake(first)) {
        prompt = 'TAKE THE DATA CORE';
      }
    }
    const carried = this.carrier === null ? null : players[this.carrier];
    return {
      phase: this.phase,
      stage: this.stage,
      stageNumber: MISSION_STAGES.indexOf(this.stage) + 1,
      sites: this.sites,
      hack: { progress: this.hackSeconds / HACK_DURATION, paused: this.phase === 'breach' && !this.zoneHeld(this.sites.breach, players) },
      core: {
        state: this.coreState,
        x: carried ? carried.x : this.coreAt.x,
        z: carried ? carried.z : this.coreAt.z,
        underground: carried ? carried.underground === true : this.coreAt.underground,
        carrier: this.carrier,
      },
      upload: {
        progress: this.uploadSeconds / UPLOAD_DURATION,
        paused: this.phase === 'defend' && !this.zoneHeld(this.sites.relay, players),
        wave: Math.max(1, this.uploadWaves),
      },
      extractionLeft: Math.max(0, EXTRACTION_SECONDS - this.extractSeconds),
      alert: this.alert,
      redeploys: this.redeploys,
      awaitingRedeploy: this.awaitingRedeploy,
      prompt,
      loss: this.loss,
      elapsed: this.elapsed,
    };
  }

  private updateBreach(dt: number, players: readonly MissionPlayer[], events: MissionEvent[]): void {
    if (!this.zoneHeld(this.sites.breach, players)) return;
    this.hackSeconds = Math.min(HACK_DURATION, this.hackSeconds + dt);
    if (!this.hackWaveSent && this.hackSeconds >= HACK_WAVE_AT) {
      this.hackWaveSent = true;
      events.push({ kind: 'waveRequested', count: HACK_WAVE_SIZE, bias: 'mixed', warden: false });
    }
    if (this.hackSeconds >= HACK_DURATION) this.startStage('fetch', events);
  }

  private updateFetch(dt: number, input: MissionInput, events: MissionEvent[]): void {
    const { players, interact } = input;
    const presser = interact === null ? undefined : players[interact];
    if (interact !== null && presser?.alive) {
      if (this.carrier === null && this.canTake(presser)) {
        this.carrier = interact;
        this.coreState = 'carried';
        events.push({ kind: 'corePicked', player: interact });
      } else if (this.carrier === interact && this.canPlug(presser)) {
        this.startStage('defend', events);
        return;
      }
    }
    const carrier = this.carrier === null ? undefined : players[this.carrier];
    if (!carrier || carrier.underground) return;
    // The pursuit finds the carrier in the open: a wave as it surfaces, then one every interval.
    this.carrySeconds += dt;
    while (this.carryWaves * CARRY_WAVE_INTERVAL < this.carrySeconds) {
      this.carryWaves++;
      events.push({ kind: 'waveRequested', count: waveSize(CARRY_WAVE_BASE, this.alert), bias: this.carryWaves % 2 === 1 ? 'rusher' : 'mixed', warden: false });
    }
  }

  private updateDefend(dt: number, players: readonly MissionPlayer[], events: MissionEvent[]): void {
    if (!this.zoneHeld(this.sites.relay, players)) return;
    // The wave due now is sent before the clock moves, so the first one meets the plug-in itself.
    this.sendDueWaves(events);
    this.uploadSeconds = Math.min(UPLOAD_DURATION, this.uploadSeconds + dt);
    this.sendDueWaves(events);
    if (this.uploadSeconds >= UPLOAD_DURATION) this.startStage('extract', events);
  }

  private sendDueWaves(events: MissionEvent[]): void {
    while (this.uploadWaves < UPLOAD_WAVES.length && UPLOAD_WAVES[this.uploadWaves]!.at <= this.uploadSeconds && UPLOAD_WAVES[this.uploadWaves]!.at < UPLOAD_DURATION) {
      const wave = UPLOAD_WAVES[this.uploadWaves++]!;
      events.push({ kind: 'waveRequested', count: waveSize(wave.base, this.alert), bias: wave.bias, warden: wave.warden });
    }
  }

  private updateExtract(dt: number, players: readonly MissionPlayer[], events: MissionEvent[]): void {
    while (this.extractWaves < EXTRACTION_WAVES.length && EXTRACTION_WAVES[this.extractWaves]!.at <= this.extractSeconds) {
      const wave = EXTRACTION_WAVES[this.extractWaves++]!;
      events.push({ kind: 'waveRequested', count: waveSize(wave.base, this.alert), bias: wave.bias, warden: false });
    }
    if (players.some((player) => player.alive && !player.underground && distance(player, this.sites.extraction) <= EXTRACTION_RADIUS)) {
      this.phase = 'won';
      events.push({ kind: 'won' });
      return;
    }
    this.extractSeconds += dt;
    if (this.extractSeconds >= EXTRACTION_SECONDS) this.lose('extractionMissed', events);
  }

  private startStage(stage: MissionStage, events: MissionEvent[]): void {
    this.phase = stage;
    this.stage = stage;
    if (stage === 'fetch') {
      this.coreState = 'home';
    } else if (stage === 'defend' || stage === 'extract') {
      this.coreState = 'plugged';
      this.carrier = null;
      this.coreAt = { x: this.sites.relay.x, z: this.sites.relay.z, underground: false };
    }
    events.push({ kind: 'stageStarted', stage });
  }

  private lose(reason: MissionLoss, events: MissionEvent[]): void {
    this.phase = 'lost';
    this.loss = reason;
    events.push({ kind: 'lost', reason });
  }

  private zoneHeld(site: MissionPoint, players: readonly MissionPlayer[]): boolean {
    return players.some((player) => player.alive && !player.underground && distance(player, site) <= ZONE_RADIUS);
  }

  private canTake(player: MissionPlayer): boolean {
    if (this.coreState !== 'home' && this.coreState !== 'dropped') return false;
    return (player.underground === true) === this.coreAt.underground && distance(player, this.coreAt) <= CORE_PICKUP_RADIUS;
  }

  private canPlug(player: MissionPlayer): boolean {
    return !player.underground && distance(player, this.sites.relay) <= RELAY_PLUG_RADIUS;
  }
}

function distance(a: MissionPoint, b: MissionPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
