import type { HordeGooseSpawnedMessage, KothStateMessage, NetworkMessage, PlayerSlot, RosterEntry } from './protocol.ts';

interface SyncPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A goose in flight (entities/ThrownGoose.ts), as much of it as a sync needs. */
export interface ThrownGooseSync {
  readonly id: string;
  readonly throwerSlot: PlayerSlot | null;
  readonly source: 'gooseToss' | 'gooseLauncher';
  readonly position: Vector3Like;
  readonly velocity: Vector3Like;
}

/** Everything shared in a running match that a player joining late cannot learn from the live
 * messages alone, read off the host's own managers (MatchMessageRouter's sendFullSync). A part that
 * the match's mode does not use is null or empty. */
export interface MatchSyncSource {
  /** Who is connected now (HostRoster.connectedRoster). */
  readonly roster: readonly RosterEntry[] | null;
  /** King of the Hill: the mode's whole state as the host has it now (KingOfTheHillController.syncMessage). */
  readonly koth: KothStateMessage | null;
  /** The wandering geese (GooseManager.listForSync). */
  readonly geese: readonly (SyncPoint & { readonly killerSlot?: PlayerSlot | null })[];
  /** Goose Horde: the wave, who is out, the result once the run is over, and the live flock. */
  readonly horde: {
    readonly wave: number;
    readonly eliminated: Iterable<PlayerSlot>;
    readonly result: 'cleared' | 'wiped' | undefined;
    readonly geese: readonly Omit<HordeGooseSpawnedMessage, 'type'>[];
  } | null;
  /** Goose Horde's ammo crates (AmmoDropManager.listForSync). */
  readonly ammoDrops: readonly SyncPoint[];
  /** The bonus goose, if one is alive (BonusGooseManager.listForSync). */
  readonly bonusGeese: readonly SyncPoint[];
  /** Geese thrown or launched and still in the air. */
  readonly thrownGeese: Iterable<ThrownGooseSync>;
  /** The running score and death count per slot (MultiplayerMatchState). */
  readonly scoreboard: ReadonlyMap<PlayerSlot, number>;
  readonly deathCounts: ReadonlyMap<PlayerSlot, number>;
  /** The host's announced result, once the scoreboard win condition was met. */
  readonly verdict: { winnerSlot: PlayerSlot; scoreboard: { slot: PlayerSlot; score: number }[] } | null;
}

/** The messages the host sends one late joiner, in order: the roster first (so the opponents the
 * rest refers to exist), then the scoreboard, then the world state, and the result last. Every message is an ordinary
 * type the joiner already handles; each handler ignores an id it already has, so a sync that
 * crosses a live message changes nothing. */
export function buildMatchSync(source: MatchSyncSource): NetworkMessage[] {
  const messages: NetworkMessage[] = [];
  if (source.roster) {
    messages.push({ type: 'rosterSync', roster: [...source.roster] });
    // Every connected slot, a missing entry as 0: a slot a newcomer took over since the joiner's
    // welcome has had its old player's score cleared on the host, and must be cleared here too.
    const scores = source.roster.map(({ slot }) => ({ slot, score: source.scoreboard.get(slot) ?? 0, deaths: source.deathCounts.get(slot) ?? 0 }));
    messages.push({ type: 'scoreboardSync', scores });
  }
  if (source.koth) messages.push(source.koth);
  for (const goose of source.geese) messages.push({ type: 'gooseSpawned', killerSlot: null, ...goose });
  if (source.horde) {
    const { wave, eliminated, result, geese } = source.horde;
    messages.push({ type: 'hordeSyncState', wave, eliminated: [...eliminated], ...(result ? { result } : {}) });
    for (const goose of geese) messages.push({ type: 'hordeGooseSpawned', ...goose });
  }
  for (const drop of source.ammoDrops) messages.push({ type: 'hordeAmmoDropSpawned', id: drop.id, x: drop.x, y: drop.y, z: drop.z });
  for (const goose of source.bonusGeese) messages.push({ type: 'bonusGooseSpawned', id: goose.id, x: goose.x, y: goose.y, z: goose.z });
  for (const thrown of source.thrownGeese) {
    // A throw always has a thrower in a match; one without is single-player only.
    if (thrown.throwerSlot === null) continue;
    messages.push({
      type: 'gooseThrown',
      senderSlot: thrown.throwerSlot,
      id: thrown.id,
      originX: thrown.position.x,
      originY: thrown.position.y,
      originZ: thrown.position.z,
      velX: thrown.velocity.x,
      velY: thrown.velocity.y,
      velZ: thrown.velocity.z,
      source: thrown.source,
    });
  }
  if (source.verdict) messages.push({ type: 'matchEnded', ...source.verdict });
  return messages;
}
