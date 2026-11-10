import type { PlayerSlot } from '../../network/protocol.ts';

/** King of the Hill's rules, as numbers (docs/king-of-the-hill.md). */
export const HILL_RULES = {
  /** Radius of the hill, and of the smaller hill of the Final Push, in metres. */
  radius: 8,
  pushRadius: 6,
  /** Seconds a hill stays before it moves, normally and in the Final Push. */
  duration: 60,
  pushDuration: 40,
  /** Seconds of warning before a move: the next hill is marked. */
  warning: 8,
  /** How close a player must be to the crown to take it. */
  crownReach: 2.5,
  /** Extra reach allowed on a guest's claim, whose position the host knows a snapshot late. */
  crownReachSlack: 2,
  /** The share of the point target at which the Final Push starts. */
  pushAt: 0.75,
} as const;

/** Who has the hill: nobody on it, one side alone on it (it scores), or more than one (nobody scores). */
export type HillHold = 'empty' | 'held' | 'contested';

export interface HillSite {
  readonly x: number;
  readonly z: number;
}

export interface HillPlayer {
  readonly slot: PlayerSlot;
  readonly x: number;
  readonly z: number;
  /** Alive and on the surface: a dead player, or one below ground, holds nothing. */
  readonly counts: boolean;
}

/** Everything a client needs to draw the mode, and everything the host sends (protocol.ts
 * KothStateMessage carries exactly this). */
export interface HillSnapshot {
  /** Where the hill is, and where it goes next. */
  readonly hill: HillSite;
  readonly next: HillSite;
  readonly radius: number;
  /** Seconds until it moves. */
  readonly moveIn: number;
  readonly hold: HillHold;
  /** The side holding it while `hold` is 'held'. */
  readonly holder: number | null;
  /** Who wears the crown, or where it lies when nobody does. */
  readonly crown: PlayerSlot | null;
  readonly crownAt: HillSite | null;
  readonly push: boolean;
  /** Two against two (four players at the start) or every player for themselves. */
  readonly teams: boolean;
}

/** A player's side: in a team match slots 0 and 2 against 1 and 3, otherwise their own slot. */
export function sideOf(slot: PlayerSlot, teams: boolean): number {
  return teams ? slot % 2 : slot;
}

/** Four players at the start make it two against two; fewer play every player for themselves. */
export function playsInTeams(playerCount: number): boolean {
  return playerCount >= 4;
}

/** The host's King of the Hill: where the hill is, who holds it, who wears the crown and what each
 * side has scored. Pure: the host feeds it every player's position each tick; guests only ever see
 * its snapshot. */
export class HillState {
  private hillIndex: number;
  private nextIndex: number;
  private moveIn: number = HILL_RULES.duration;
  private hold: HillHold = 'empty';
  private holder: number | null = null;
  private crown: PlayerSlot | null = null;
  private crownAt: HillSite | null;
  private push = false;
  private readonly points = new Map<number, number>();

  /** `rng` picks the order the hill visits its sites in; it never visits one twice running. */
  constructor(
    private readonly sites: readonly HillSite[],
    private readonly pointsToWin: number,
    readonly teams: boolean,
    private readonly rng: () => number,
    /** Shrinks the hill for a map of rooms (the Facility), where 8 m would reach through walls. */
    private readonly scale = 1,
  ) {
    if (sites.length < 2) throw new Error('King of the Hill needs at least two hill sites');
    this.hillIndex = Math.min(sites.length - 1, Math.floor(rng() * sites.length));
    this.nextIndex = this.pickNext(this.hillIndex);
    this.crownAt = sites[this.hillIndex]!;
  }

  private pickNext(current: number): number {
    const step = 1 + Math.min(this.sites.length - 2, Math.floor(this.rng() * (this.sites.length - 1)));
    return (current + step) % this.sites.length;
  }

  private get radius(): number {
    return (this.push ? HILL_RULES.pushRadius : HILL_RULES.radius) * this.scale;
  }

  private inHill(player: HillPlayer): boolean {
    const site = this.sites[this.hillIndex]!;
    return player.counts && Math.hypot(player.x - site.x, player.z - site.z) <= this.radius;
  }

  /** One tick: the hill's clock, who stands on it, and the points for a side holding it alone
   * (one a second, two while one of that side wears the crown on the hill). */
  update(dt: number, players: readonly HillPlayer[]): void {
    this.moveIn -= dt;
    if (this.moveIn <= 0) this.moveHill();

    // The crown falls where its wearer was if they are no longer in the match.
    if (this.crown !== null && !players.some((player) => player.slot === this.crown)) {
      this.crown = null;
      this.crownAt = this.sites[this.hillIndex]!;
    }

    const sides = new Set<number>();
    let crownOnHill = false;
    for (const player of players) {
      if (!this.inHill(player)) continue;
      sides.add(sideOf(player.slot, this.teams));
      if (player.slot === this.crown) crownOnHill = true;
    }
    if (sides.size === 1) {
      const side = sides.values().next().value as number;
      this.hold = 'held';
      this.holder = side;
      const crowned = crownOnHill && this.crown !== null && sideOf(this.crown, this.teams) === side;
      this.points.set(side, Math.min(this.pointsToWin, (this.points.get(side) ?? 0) + dt * (crowned ? 2 : 1)));
    } else {
      this.hold = sides.size === 0 ? 'empty' : 'contested';
      this.holder = null;
    }

    if (!this.push && this.leadingPoints() >= this.pointsToWin * HILL_RULES.pushAt) {
      this.push = true;
      this.moveIn = Math.min(this.moveIn, HILL_RULES.pushDuration);
    }
  }

  private leadingPoints(): number {
    let best = 0;
    for (const value of this.points.values()) best = Math.max(best, value);
    return best;
  }

  private moveHill(): void {
    this.hillIndex = this.nextIndex;
    this.nextIndex = this.pickNext(this.hillIndex);
    this.moveIn = this.push ? HILL_RULES.pushDuration : HILL_RULES.duration;
    // The golden goose flies to the new hill: nobody keeps the crown across a move.
    this.crown = null;
    this.crownAt = this.sites[this.hillIndex]!;
  }

  /** A player reaches for the crown. `slack` widens the reach for a guest's claim. */
  claimCrown(player: HillPlayer, slack = 0): boolean {
    if (this.crown !== null || !this.crownAt || !player.counts) return false;
    if (Math.hypot(player.x - this.crownAt.x, player.z - this.crownAt.z) > HILL_RULES.crownReach + slack) return false;
    this.crown = player.slot;
    this.crownAt = null;
    return true;
  }

  /** The wearer died, or left: the crown lies where they were until someone takes it or the hill moves. */
  dropCrown(slot: PlayerSlot, at: HillSite): void {
    if (this.crown !== slot) return;
    this.crown = null;
    this.crownAt = { x: at.x, z: at.z };
  }

  /** Whole points a player's side has scored. */
  scoreOf(slot: PlayerSlot): number {
    // The small allowance keeps sixty ticks of a sixtieth from reading as one short of a second.
    return Math.floor((this.points.get(sideOf(slot, this.teams)) ?? 0) + 1e-6);
  }

  snapshot(): HillSnapshot {
    return {
      hill: this.sites[this.hillIndex]!,
      next: this.sites[this.nextIndex]!,
      radius: this.radius,
      moveIn: Math.max(0, this.moveIn),
      hold: this.hold,
      holder: this.holder,
      crown: this.crown,
      crownAt: this.crownAt,
      push: this.push,
      teams: this.teams,
    };
  }
}

/** What changed between two snapshots that players should be told about. */
export type HillEvent =
  | { readonly kind: 'hillMoved' }
  | { readonly kind: 'movingSoon' }
  | { readonly kind: 'crownTaken'; readonly slot: PlayerSlot }
  | { readonly kind: 'crownDropped' }
  | { readonly kind: 'finalPush' }
  | { readonly kind: 'holdChanged'; readonly hold: HillHold; readonly holder: number | null };

/** The events between `previous` (null for the first snapshot a client sees) and `next`. Every
 * client derives its announcements this way, so a late joiner and a guest that missed a state
 * message still hear what matters from the next one. */
export function hillEvents(previous: HillSnapshot | null, next: HillSnapshot): HillEvent[] {
  const events: HillEvent[] = [];
  if (!previous) return events;
  const moved = previous.hill.x !== next.hill.x || previous.hill.z !== next.hill.z;
  if (moved) events.push({ kind: 'hillMoved' });
  else if (previous.moveIn > HILL_RULES.warning && next.moveIn <= HILL_RULES.warning) events.push({ kind: 'movingSoon' });
  if (!previous.push && next.push) events.push({ kind: 'finalPush' });
  if (previous.crown !== next.crown) {
    if (next.crown !== null) events.push({ kind: 'crownTaken', slot: next.crown });
    else if (!moved) events.push({ kind: 'crownDropped' });
  }
  if (previous.hold !== next.hold || previous.holder !== next.holder) events.push({ kind: 'holdChanged', hold: next.hold, holder: next.holder });
  return events;
}

/** The hill's sites from candidate points: the first candidate, then each time the candidate
 * farthest from every site already chosen, so the hills are spread across the map. */
export function spreadSites(candidates: readonly HillSite[], count: number): HillSite[] {
  const chosen: HillSite[] = [];
  if (candidates.length === 0) return chosen;
  chosen.push(candidates[0]!);
  while (chosen.length < Math.min(count, candidates.length)) {
    let best: HillSite | null = null;
    let bestDistance = -1;
    for (const candidate of candidates) {
      let nearest = Infinity;
      for (const site of chosen) nearest = Math.min(nearest, Math.hypot(candidate.x - site.x, candidate.z - site.z));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = candidate;
      }
    }
    if (!best || bestDistance <= 0) break;
    chosen.push(best);
  }
  return chosen;
}
