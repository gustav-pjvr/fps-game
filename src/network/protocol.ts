/** Wire format for the multiplayer DataChannel - a discriminated union so every message every
 * client sends/receives is typed in one place. Host-relay star topology (up to
 * MULTIPLAYER_MAX_PLAYERS, see config.ts): every non-host client holds exactly one connection, to
 * the host; the host relays gameplay messages between guests (see PeerConnection.ts/Game.ts's
 * relay logic) transparently, unchanged, tagged with the ORIGINAL sender's own slot. */

import type { GooseExplosionDifficulty, MatchMap, MatchWeather } from '../core/config.ts';
import type { GameMode } from '../core/gameModes.ts';

/** Stable small identity for up to MULTIPLAYER_MAX_PLAYERS players in one room - slot 0 is always
 * the host, slots 1-3 are assigned to guests in join order by the host (see HostRoster.ts) and are
 * the one identity primitive threaded through every message and every per-opponent data structure
 * (RemotePlayer, HUD row, minimap dot, scoreboard entry) instead of a singular "opponent" field. */
export type PlayerSlot = 0 | 1 | 2 | 3;
export const HOST_SLOT: PlayerSlot = 0;

/** Sent guest -> host the moment a guest's connection opens, before it knows anything about the
 * room (no senderSlot - it doesn't have one yet, that's what WelcomeMessage grants).
 * `rejoinToken`, if present, lets the host recognize this as the same player reconnecting after a
 * mid-match drop (see HostRoster.ts's grace-period reservation) rather than a brand new player -
 * null on a guest's very first connection to a given room code (see core/multiplayerRejoin.ts). */
export interface HelloMessage {
  type: 'hello';
  username: string;
  rejoinToken: string | null;
  /** What this build can play (CLIENT_FEATURES). Missing on older builds, which know no Facility
   * and would silently load the Valley inside a Facility room, so the host turns them away. */
  features?: string[];
}

/** Sent in every hello by this build. */
export const CLIENT_FEATURES: readonly string[] = ['facility'];

/** Host side: whether a guest whose hello carried `features` can play `map`. */
export function helloSupportsMap(features: unknown, map: MatchMap): boolean {
  return map !== 'facility' || (Array.isArray(features) && features.includes('facility'));
}

/** One entry in the room roster - the same shape whether it's carried in a pre-match
 * WelcomeMessage/RosterUpdateMessage or a mid-match MatchStartMessage, so roster-rendering code
 * doesn't need two parsers. */
export interface RosterEntry {
  slot: PlayerSlot;
  username: string;
}

/** Host -> the one guest that just sent HelloMessage (targeted, not broadcast - see
 * PeerConnection.sendTo). Assigns that guest's slot and hands back the current full roster, so a
 * 3rd/4th joiner immediately sees who else is already there, not just the host. */
export interface WelcomeMessage {
  type: 'welcome';
  yourSlot: PlayerSlot;
  isRejoin: boolean;
  hostUsername: string;
  roster: RosterEntry[];
  /** Present only if the host was already mid-match when this hello resolved (a rejoin, or a
   * brand-new player joining after Start Match was clicked) - lets the joining client skip the
   * lobby-wait screen entirely and jump straight into the already-running match, since the host
   * only ever sends MatchStartMessage once, at the moment the match actually starts/restarts. */
  activeMatch?: {
    seed: number;
    killLimit: number;
    gooseDifficulty: GooseExplosionDifficulty;
    gameMode: GameMode;
    weather: MatchWeather;
    /** Missing on older builds, defaults to Valley. */
    map?: MatchMap;
    scoreboard: { slot: PlayerSlot; score: number }[];
    spawnPoint: { x: number; z: number };
    /** The lamps already shot out, so a late joiner sees the same dark rooms: on the Facility
     * indices into the layout's lamps, on the Valley house lamp ids (world/houses/valleyHouseIds.ts).
     * Missing means none (and on older builds). */
    deadLamps?: number[];
    /** Facility only: which doors are open and which breakers are on (docs/facility-map.md,
     * section 12), so a late joiner starts with the same ones; on the Valley the open house doors
     * (`valleyDoors`, docs/enterable-buildings.md). Missing means the match's start. */
    worldObjects?: { doors: string; breakers: string; valleyDoors?: number[] };
  };
}

/** Host -> every already-connected guest (broadcast), sent whenever the pre-match lobby roster
 * changes (a new guest joined, or one disconnected before Start Match was ever clicked).
 * Deliberately distinct from the mid-match PlayerLeftMessage/PlayerJoinedMatchMessage pair below -
 * lobby roster UI and mid-match roster/scoreboard removal are different enough screens/logic that
 * reusing one shape would force one of them to carry fields the other never uses. */
export interface RosterUpdateMessage {
  type: 'rosterUpdate';
  roster: RosterEntry[];
}

/** Guest -> host only, sent from the pre-match lobby (CreateRoomScreen/JoinRoomScreen) whenever a
 * guest toggles the lobby's "Ready" button - never relayed/broadcast peer-to-peer the way
 * ModeExplanationReadyMessage is, because the lobby has no generic relay mechanism at all (unlike
 * mid-match, which routes everything through MatchMessageRouter's RELAYABLE_MESSAGE_TYPES) - a
 * guest's one connection only ever reaches the host, so only the host can even see this. The host
 * aggregates every slot's readiness and rebroadcasts the full picture via LobbyReadyUpdateMessage,
 * the same "host owns the authoritative view, rebroadcasts it on every change" shape
 * RosterUpdateMessage already uses for the roster itself. The host's own slot auto-readies (see
 * CreateRoomScreen) rather than requiring a matching click - the host is already the one who clicks
 * Start Match, so gating Start Match on the host separately readying up first would just be an
 * extra click with no real signal behind it. */
export interface PlayerReadyMessage {
  type: 'playerReady';
  slot: PlayerSlot;
  ready: boolean;
}

/** Host -> everyone (broadcast), sent whenever the pre-match lobby's aggregate readiness changes
 * (a guest (un)readied, or the roster itself changed - a join/leave/reservation-expiry shrinks or
 * grows the set of slots that need to be ready) - mirrors RosterUpdateMessage's own
 * "host-authoritative, rebroadcast the whole picture on every change" shape rather than a
 * self-converging relay (see PlayerReadyMessage's own comment on why a relay isn't available here).
 * `readySlots` is deliberately the full current set, not a delta - the same reasoning
 * RosterUpdateMessage's own comment gives for carrying the whole roster each time. */
export interface LobbyReadyUpdateMessage {
  type: 'lobbyReadyUpdate';
  readySlots: PlayerSlot[];
}

/** Host -> a guest connection it is closing immediately because the room already has
 * MULTIPLAYER_MAX_PLAYERS - 1 guests (and no reserved/rejoinable slot matched this hello) - sent
 * once, right before that one DataConnection is closed; never reaches the room's other, already-
 * accepted parties. */
export interface RoomFullMessage {
  type: 'roomFull';
  /** 'outdated': not full, but the guest's build cannot play this room's map (helloSupportsMap).
   * Older builds ignore it and say the room is full, which still turns them away. */
  reason?: 'outdated';
}

/** Host -> guests, right before everyone calls Game.create() (or, for a rematch, re-calls it on
 * the same still-open connections) - the seed/killLimit/spawn data needed for every client's world
 * to generate identically. `spawns` has one entry per roster slot in this match, looked up by
 * `slot` rather than array position, so it stays correct even if slot numbers aren't contiguous
 * (e.g. slot 2 left the lobby before slot 3 joined - the host never reuses a freed slot within one
 * room's lifetime). */
export interface MatchStartMessage {
  type: 'matchStart';
  seed: number;
  killLimit: number;
  gooseDifficulty: GooseExplosionDifficulty;
  gameMode: GameMode;
  weather: MatchWeather;
  /** Missing on older builds, defaults to Valley. */
  map?: MatchMap;
  spawns: { slot: PlayerSlot; x: number; z: number }[];
  roster: RosterEntry[];
}

/** Broadcast periodically by each client for its own player - the only state a RemotePlayer needs
 * to look right: where it is, which way it's facing, and its current health (piggybacked here
 * rather than a separate message - already sent at PLAYER_SNAPSHOT_SEND_INTERVAL, plenty fresh for
 * a live health display). `senderSlot` is required now that a client may have up to 3 possible
 * remote senders instead of exactly one. */
export interface PlayerSnapshotMessage {
  type: 'playerSnapshot';
  senderSlot: PlayerSlot;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  /** The sender's performance.now() when sent. Snapshots travel on the unreliable fast channel
   * (network/fastChannel.ts), so they can arrive late or out of order; the receiver drops any not
   * newer than the last it applied, or than the sender's last death or respawn. Optional because a
   * browser still on an older build sends none. */
  t?: number;
  /** Facility only (docs/facility-map.md, section 7): whether the sender's torch is lit. Missing
   * means on, so an older build's players still carry a light. */
  torch?: boolean;
}

/** Sent by the shooter on every shot - purely cosmetic (tracer/muzzle flash/positional gunshot
 * audio), the hit itself (if any) is reported separately via DamageEventMessage. Not gated on
 * whether the shot actually hit anything - a miss still needs to show a tracer/play a sound on
 * every other receiving client. */
export interface FireEventMessage {
  type: 'fireEvent';
  senderSlot: PlayerSlot;
  originX: number;
  originY: number;
  originZ: number;
  endX: number;
  endY: number;
  endZ: number;
  weaponId: string;
}

/** Self-reported, relayed (see MatchMessageRouter's RELAYABLE_MESSAGE_TYPES): `senderSlot` shot out
 * a Facility lamp (docs/facility-map.md, section 11). `lamp` indexes the layout's lamps, whose order
 * is identical on every client; on the Valley it is a house lamp id (house key and room,
 * world/houses/valleyHouseIds.ts). Receivers kill that lamp the same way, if it is still lit. Older
 * builds drop the unknown type. */
export interface LampDestroyedMessage {
  type: 'lampDestroyed';
  senderSlot: PlayerSlot;
  lamp: number;
}

/** Relayed like lampDestroyed: `senderSlot`'s whole set of shot-out lamps (Facility indices or Valley
 * house lamp ids), re-broadcast
 * so a client that was still loading when a lampDestroyed went past catches up (see
 * network/lampSync.ts for when it is sent). Receivers kill any listed lamp still lit, quietly. */
export interface LampSyncMessage {
  type: 'lampSync';
  senderSlot: PlayerSlot;
  lamps: number[];
}

/** Guest -> host only, never relayed: this guest pressed interact on a Facility door or breaker
 * panel (docs/facility-map.md, section 12). `id` indexes the layout's doors or zones, identical on
 * every client. The host is the authority: it flips the object if the id is valid and the guest
 * stands within reach of it, then broadcasts the result as worldObjectState. Older hosts drop it. */
export interface WorldInteractMessage {
  type: 'worldInteract';
  kind: 'door' | 'breaker';
  id: number;
}

/** Host -> everyone (host-authored broadcast, never relayed): every Facility door ('1' open) and
 * breaker ('1' on) in id order, sent on each change and to each guest on its first playerSnapshot
 * (it may have been loading when a change went past). Guests adopt it whole. On the Valley both
 * strings are empty and `valleyDoors` lists the open house doors' ids (world/houses/valleyHouseIds.ts,
 * docs/enterable-buildings.md); worldInteract carries those same ids. */
export interface WorldObjectStateMessage {
  type: 'worldObjectState';
  doors: string;
  breakers: string;
  valleyDoors?: number[];
}

/** Sent by the shooter (`senderSlot`, the attacker) when their own hitscan registers a hit on a
 * specific victim's RemotePlayer collider (`targetSlot`). Every client receives every
 * damageEvent (host relay is transparent - see Game.ts), but only the client whose own slot equals
 * `targetSlot` applies it to its own Player.takeDamage; everyone else ignores it for health
 * purposes. The *receiving* (targeted) client is what decides when it dies - each client stays
 * authoritative over its own health, the attacker never tells the victim's client "you're dead,"
 * only "you took N damage." */
export interface DamageEventMessage {
  type: 'damageEvent';
  senderSlot: PlayerSlot;
  targetSlot: PlayerSlot;
  amount: number;
}

/** Sent by a client to everyone the moment its own player's health reaches 0 - `victimSlot` is
 * always the sender's own slot (kept explicit/named for readability at every call site that reads
 * this for scoreboard purposes, even though it's redundant with `senderSlot`). `killerSlot` is the
 * dying client's own best-effort "who last damaged me" tracking (see Game.ts's
 * lastDamageSourceSlot) - null if untracked (e.g. died with no recorded attacker). Self-reported,
 * not host-adjudicated - consistent with the existing no-anti-cheat trust model (each client is
 * already authoritative over its own health, this just extends that to "who gets kill credit"). */
export interface PlayerDiedMessage {
  type: 'playerDied';
  senderSlot: PlayerSlot;
  victimSlot: PlayerSlot;
  killerSlot: PlayerSlot | null;
  /** Sender's clock, as on PlayerSnapshotMessage: a snapshot sent before this death must not
   * bring the body back to life when it arrives after it. */
  t?: number;
}

/** Sent once a dying player actually respawns - lets every other client's RemotePlayer for that
 * slot snap straight to the new spot instead of interpolating what would otherwise look like an
 * instant teleport-speed slide across the map. */
export interface RespawnEventMessage {
  type: 'respawnEvent';
  senderSlot: PlayerSlot;
  x: number;
  y: number;
  z: number;
  /** Sender's clock, as on PlayerSnapshotMessage: a snapshot from before the respawn must not drag
   * the player back to where they died. */
  t?: number;
}

/** Sent by a client each time its own player takes a footstep (per user request: other players
 * should hear each other's footsteps, not just gunfire) - carries the shooter's position so the
 * receiving end can position/attenuate it the same way opponent gunshots already are. Discrete
 * per-step events on the sending side already (not a tick-rate stream), so this adds negligible
 * bandwidth on top of everything else. */
export interface FootstepEventMessage {
  type: 'footstepEvent';
  senderSlot: PlayerSlot;
  x: number;
  y: number;
  z: number;
}

/** Sent by the host when they click "Return to Lobby" from the podium/match-end screen - every
 * remaining guest's own client returns itself to the lobby on receiving this (see Game.ts's
 * onOpponentLeftRoom), since without it a guest would be stuck on that screen forever once the
 * host's connection just silently closes, with no signal to explain why. Now a real broadcast
 * (fans out to every currently-connected guest) rather than a single send. */
export interface HostLeftRoomMessage {
  type: 'hostLeftRoom';
}

/** Host -> everyone, the instant a guest's connection closes mid-match. Every remaining client
 * removes that slot's RemotePlayer/HUD row/minimap dot immediately and the match continues (per
 * user decision) - score/death-count entries are deliberately NOT deleted, so a later rejoin or
 * the final podium still reflects them. */
export interface PlayerLeftMessage {
  type: 'playerLeft';
  slot: PlayerSlot;
}

/** Host -> everyone, when a rejoin or a brand-new mid-match join completes - the same mechanism
 * serves both (a rejoin is just a hello whose token matched a still-reserved slot within its grace
 * period), which is why this carries `isRejoin` as a flag rather than being two message types.
 * Mirrors PlayerLeftMessage: every other client adds a fresh RemotePlayer/HUD row/minimap dot for
 * this slot. */
export interface PlayerJoinedMatchMessage {
  type: 'playerJoinedMatch';
  slot: PlayerSlot;
  username: string;
  isRejoin: boolean;
}

/** Host -> everyone (broadcast, never relayed - it's host-authored, not forwarded from a guest):
 * a new goose exists. Every guest builds a local "follower" mirror at this exact position (see
 * GooseManager.applyRemoteSpawn/Goose.ts's class comment) - the host is the sole simulation
 * authority for every goose, matching how it already owns the match seed/spawn points. */
export interface GooseSpawnedMessage {
  type: 'gooseSpawned';
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Host -> everyone (broadcast), sent on a coarse interval (GOOSE_SNAPSHOT_SEND_INTERVAL) per live
 * goose so a guest's follower copy tracks the host's own wander AI - a goose's position is
 * cosmetic, so this deliberately doesn't need PlayerSnapshotMessage's freshness. */
export interface GooseSnapshotMessage {
  type: 'gooseSnapshot';
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Guest -> host only (a guest's one connection already only ever reaches the host - never
 * relayed, never broadcast). A guest's own local hitscan can still land a hit on its follower
 * goose (it has a real collider), but only the host's authoritative copy decides whether that hit
 * kills it - this is how that hit gets reported upward for adjudication (see
 * GooseManager.registerRemoteHit). */
export interface GooseHitEventMessage {
  type: 'gooseHitEvent';
  senderSlot: PlayerSlot;
  id: string;
}

/** Guest -> host only, sent once by a guest right after its own connection callbacks are wired up
 * (see Game.ts's create()) - covers two distinct timing gaps with one mechanism: (1) a guest whose
 * own Game.create() is still loading assets when the host's initial-batch gooseSpawned broadcasts
 * go out would otherwise simply miss them (nothing was listening yet); (2) a guest that joins or
 * rejoins mid-match has never seen any goose that spawned before it connected at all. Either way,
 * "ask the host for the current list" is a strictly additive resync - GooseManager.applyRemoteSpawn
 * is idempotent (a goose id it already knows about is a no-op), so a spawn this guest already
 * received (via the normal broadcast) arriving again here causes no harm. */
export interface GooseSyncRequestMessage {
  type: 'gooseSyncRequest';
  senderSlot: PlayerSlot;
}

/** Host -> everyone (broadcast): this goose just died (its GOOSE_HITS_TO_KILL'th hit landed,
 * whether that hit was the host's own or reported via GooseHitEventMessage). Every client removes
 * its own copy and independently computes/applies explosion damage to its OWN player only, using
 * the match's shared gooseDifficulty - each client stays authoritative over its own health, same
 * as every other damage path in this protocol. */
export interface GooseExplodedMessage {
  type: 'gooseExploded';
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Goose Toss mode only (senderSlot's own client just picked up a wandering goose with the
 * interact key). Added to the transparent-relay set (see Game.ts's RELAYABLE_MESSAGE_TYPES) rather
 * than host-arbitrated - the sender already removed the goose from its own local view before
 * sending this, and every receiving client (including the host, whose GooseManager IS the
 * authoritative flock) removes it from theirs too on receipt. A genuine simultaneous double-pickup
 * race is possible but tolerated (GooseManager.removeById silently no-ops if already gone), same
 * spirit as this project's other self-reported multiplayer interactions. */
export interface GoosePickedUpMessage {
  type: 'goosePickedUp';
  senderSlot: PlayerSlot;
  id: string;
}

/** Goose Toss mode only: `senderSlot` just threw the goose they were holding. Every client
 * (including the thrower) spawns an identical local ThrownGoose from `originX/Y/Z` +
 * `velX/Y/Z` - GRAVITY is a fixed world constant, so every client's flight simulation matches
 * without needing further position sync. Only the thrower's own client is authoritative for
 * deciding when/where it lands (see Game.ts's updateGooseToss) - everyone else's copy is purely
 * cosmetic until a matching GooseThrowExplodedMessage arrives. */
export interface GooseThrownMessage {
  type: 'gooseThrown';
  senderSlot: PlayerSlot;
  id: string;
  originX: number;
  originY: number;
  originZ: number;
  velX: number;
  velY: number;
  velZ: number;
  /** Which balance/explosion constants and reward path this projectile uses on landing (see
   * Game.ts's updateThrownGeese/resolveThrownGooseExplosion) - 'gooseLauncher' for the bonus-goose
   * reward weapon's shots, reusing this same message/entity rather than duplicating a whole second
   * ballistic-projectile plumbing for what is mechanically the same "a goose flies and explodes"
   * shape. */
  source: 'gooseToss' | 'gooseLauncher';
}

/** Goose Toss mode only: the thrower's own client decided this thrown goose just made contact
 * (ground or a player) at (x, y, z) - every client explodes its own local copy there (VFX
 * everywhere; damage is handled separately via ordinary DamageEventMessages the thrower sends to
 * whoever it determined was in range, exactly like a normal weapon hit, so kill credit flows
 * through the existing playerDied pipeline unchanged). */
export interface GooseThrowExplodedMessage {
  type: 'gooseThrowExploded';
  id: string;
  x: number;
  y: number;
  z: number;
  source: 'gooseToss' | 'gooseLauncher';
}

/** King of the Hill mode only: `senderSlot` just claimed the (unheld) golden goose with the
 * interact key. Same self-reported/relayed pattern as GoosePickedUpMessage - every client
 * (including the host, whose GoldenGooseManager owns the authoritative "who's carrying it" state)
 * marks it carried by senderSlot on receipt; a genuine simultaneous double-claim race is tolerated
 * the same way, same spirit as every other self-reported interaction in this protocol. */
export interface GoldenGoosePickedUpMessage {
  type: 'goldenGoosePickedUp';
  senderSlot: PlayerSlot;
}

/** King of the Hill mode only: `senderSlot` dropped the golden goose (voluntarily via the fire
 * button, or automatically on death) at (x, y, z) - every client marks it unheld and relocates it
 * there, making it claimable again. */
export interface GoldenGooseDroppedMessage {
  type: 'goldenGooseDropped';
  senderSlot: PlayerSlot;
  x: number;
  y: number;
  z: number;
}

/** King of the Hill mode only: `senderSlot`'s own client just crossed another whole second of
 * continuous carry time and is self-reporting its own new total (same self-authoritative-over-
 * your-own-state trust model as health/kills elsewhere) - every other client updates that slot's
 * point bar to match. Sent at most once per second per carrier, negligible bandwidth. */
export interface KothScoreTickMessage {
  type: 'kothScoreTick';
  senderSlot: PlayerSlot;
  score: number;
}

/** Goose Horde mode only (multiplayer co-op, see core/gameModes.ts) - host -> everyone, mirrors
 * GooseSpawnedMessage exactly, plus `flavor` (walker/jumper/flyer, see HordeGoose.ts) since a
 * follower needs it to render the right descent/lunge behavior locally. */
export interface HordeGooseSpawnedMessage {
  type: 'hordeGooseSpawned';
  id: string;
  x: number;
  y: number;
  z: number;
  flavor: 'walker' | 'jumper' | 'flyer';
}

export interface HordeGooseSnapshotMessage {
  type: 'hordeGooseSnapshot';
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Guest -> host only, mirrors GooseHitEventMessage exactly - a horde goose dies in exactly one
 * hit, so there's nothing to count, just "this hit landed, host decides." */
export interface HordeGooseHitEventMessage {
  type: 'hordeGooseHitEvent';
  senderSlot: PlayerSlot;
  id: string;
}

/** Host -> everyone: this goose reached a player and exploded - every client applies
 * damage/knockback to its OWN player only if it's the one who got hit (each client stays
 * authoritative over its own health, same as every other explosion in this protocol). */
export interface HordeGooseExplodedMessage {
  type: 'hordeGooseExploded';
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Host -> everyone: this goose was shot dead (no explosion) - distinct from
 * HordeGooseExplodedMessage so followers know not to spawn a blast VFX for it. */
export interface HordeGooseRemovedMessage {
  type: 'hordeGooseRemoved';
  id: string;
}

/** Host -> everyone: a new wave just started - drives the "Wave N incoming" toast on every
 * client, mirroring how the authoritative side's own onWaveStart callback drives it locally. */
export interface HordeWaveStartedMessage {
  type: 'hordeWaveStarted';
  wave: number;
}

/** Host -> everyone: all HORDE_WAVE_COUNT waves survived - the co-op win condition. */
export interface HordeClearedMessage {
  type: 'hordeCleared';
}

/** Host -> everyone: any player's death restarts the whole co-op run from wave 1 (per explicit
 * user request, matching single-player's identical "dying resets to wave 1" behavior) - every
 * client immediately clears its own view of the current horde flock (see
 * HordeGooseManager.applyReset) rather than waiting for stray geese to be individually cleaned up
 * one at a time. Always followed by a `hordeWaveStarted{wave:1}` broadcast as the host's own
 * `resetToWaveOne` begins the fresh wave 1. */
export interface HordeResetMessage {
  type: 'hordeReset';
}

/** Self-reported, relayed (see Game.ts's RELAYABLE_MESSAGE_TYPES) - `senderSlot` has just used its
 * final HORDE_MAX_RESPAWNS respawn and is permanently out for the rest of this co-op run. Every
 * client tracks the same set of eliminated slots this way and independently ends the match in a
 * loss once it covers every currently-connected player - see Game.ts's checkHordeAllEliminated. */
export interface HordePlayerEliminatedMessage {
  type: 'hordePlayerEliminated';
  slot: PlayerSlot;
}

/** Host -> everyone (broadcast, never relayed - host-authored): a new ammo crate exists at a fixed
 * world position (drops don't move, unlike geese) - mirrors GooseSpawnedMessage's shape. */
export interface HordeAmmoDropSpawnedMessage {
  type: 'hordeAmmoDropSpawned';
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Self-reported, relayed - `senderSlot` just walked over and collected this crate. Every client
 * (including the host, whose own local pickup uses this exact same path) removes it from its own
 * view on receipt; a genuine simultaneous double-pickup race is possible but tolerated, same spirit
 * as this project's other self-reported pickups (e.g. GoosePickedUpMessage). Only the picker's own
 * client applies the actual ammo refill - see Game.ts's updateHordeAmmoDrops. */
export interface HordeAmmoDropPickedUpMessage {
  type: 'hordeAmmoDropPickedUp';
  senderSlot: PlayerSlot;
  id: string;
}

/** Bonus goose (single-player and multiplayer, every mode except Goose Toss - see config.ts's
 * BONUS_GOOSE_* comment). Host -> everyone (broadcast, never relayed - host-authored): a new bonus
 * goose exists. Mirrors GooseSpawnedMessage exactly. */
export interface BonusGooseSpawnedMessage {
  type: 'bonusGooseSpawned';
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface BonusGooseSnapshotMessage {
  type: 'bonusGooseSnapshot';
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Guest -> host only, mirrors GooseHitEventMessage - a guest's own local hitscan can land a hit on
 * its follower copy, but only the host decides when the goose actually dies and who gets credit for
 * the final hit. */
export interface BonusGooseHitEventMessage {
  type: 'bonusGooseHitEvent';
  senderSlot: PlayerSlot;
  id: string;
}

/** Host -> everyone: the bonus goose just died - `killerSlot` is whoever landed the final hit (the
 * host's own slot if it was the host's shot), null only in the theoretically-unreachable case of no
 * attribution. Every client removes its own copy and, if `killerSlot` is its own slot, immediately
 * equips the Goose Launcher (see Game.ts's onMessage handling and WeaponManager.grantBonusWeapon). */
export interface BonusGooseKilledMessage {
  type: 'bonusGooseKilled';
  killerSlot: PlayerSlot | null;
}

/** Guest -> host only, mirrors GooseSyncRequestMessage exactly (see its own comment for the full
 * two-timing-gap rationale) but for Goose Horde mode's own live flock/wave - covers a documented,
 * known gap called out in HordeGooseManager's own class comment ("no late-join sync"): a guest
 * joining or rejoining mid-horde-match previously had no way to learn the current wave number or
 * any goose that spawned before it connected. Sent once, right after a Horde guest's own connection
 * callbacks are wired up (see Game.ts's create()), same call site gooseSyncRequest already uses. */
export interface HordeSyncRequestMessage {
  type: 'hordeSyncRequest';
  senderSlot: PlayerSlot;
}

/** Host -> the one guest that sent HordeSyncRequestMessage (targeted, sendTo - not a broadcast) -
 * just the current wave number. Deliberately a distinct message from HordeWaveStartedMessage rather
 * than reusing it: that one also drives the "Wave N incoming…" toast (see Game.ts's handler), which
 * would misleadingly announce a wave that's already well underway, not actually starting, to a
 * player who just joined mid-wave. The live goose flock itself piggybacks on the ordinary
 * HordeGooseSpawnedMessage, sent individually per goose right after this (see
 * MatchMessageRouter's hordeSyncRequest handler) - mirrors gooseSyncRequest's own handling of
 * GooseSpawnedMessage exactly, just for HordeGooseManager.listForSync(). */
export interface HordeSyncStateMessage {
  type: 'hordeSyncState';
  wave: number;
}

/** Self-reported, relayed (see Game.ts's RELAYABLE_MESSAGE_TYPES) - `slot` has clicked Skip on the
 * pre-match mode-briefing screen (see ui/modeExplanationScreen.ts). Every client tracks the same
 * set of ready slots and independently dismisses its own briefing (unfreezing world simulation -
 * see Game.ts's worldBriefingActive) once it covers every currently-connected player, same
 * "self-reported, no host adjudication" convergence pattern as hordePlayerEliminated. */
export interface ModeExplanationReadyMessage {
  type: 'modeExplanationReady';
  slot: PlayerSlot;
}

/** Host -> everyone (host-authored broadcast, never relayed): the scoreboard win condition was met
 * (kill limit, or King of the Hill's points). The host is the ONLY client that decides this. Every
 * client used to scan its own scoreboard independently, and since each applies its own death credit
 * immediately but learns about everyone else's one network hop later, two players reaching the limit
 * at the same moment could each see the other win (both podiums showing DEFEAT, or both VICTORY).
 * The host sees every playerDied/kothScoreTick in one order, so its answer is the single truth.
 * `scoreboard` is the host's final scoreboard, which guests adopt so every podium is identical. */
export interface MatchEndedMessage {
  type: 'matchEnded';
  winnerSlot: PlayerSlot;
  scoreboard: { slot: PlayerSlot; score: number }[];
}

export type NetworkMessage =
  | MatchEndedMessage
  | HelloMessage
  | WelcomeMessage
  | RosterUpdateMessage
  | PlayerReadyMessage
  | LobbyReadyUpdateMessage
  | RoomFullMessage
  | MatchStartMessage
  | PlayerSnapshotMessage
  | FireEventMessage
  | LampDestroyedMessage
  | LampSyncMessage
  | WorldInteractMessage
  | WorldObjectStateMessage
  | DamageEventMessage
  | PlayerDiedMessage
  | RespawnEventMessage
  | FootstepEventMessage
  | HostLeftRoomMessage
  | PlayerLeftMessage
  | PlayerJoinedMatchMessage
  | GooseSpawnedMessage
  | GooseSnapshotMessage
  | GooseHitEventMessage
  | GooseExplodedMessage
  | GooseSyncRequestMessage
  | GoosePickedUpMessage
  | GooseThrownMessage
  | GooseThrowExplodedMessage
  | GoldenGoosePickedUpMessage
  | GoldenGooseDroppedMessage
  | KothScoreTickMessage
  | HordeGooseSpawnedMessage
  | HordeGooseSnapshotMessage
  | HordeGooseHitEventMessage
  | HordeGooseExplodedMessage
  | HordeGooseRemovedMessage
  | HordeWaveStartedMessage
  | HordeClearedMessage
  | HordeResetMessage
  | HordePlayerEliminatedMessage
  | HordeAmmoDropSpawnedMessage
  | HordeAmmoDropPickedUpMessage
  | BonusGooseSpawnedMessage
  | BonusGooseSnapshotMessage
  | BonusGooseHitEventMessage
  | BonusGooseKilledMessage
  | ModeExplanationReadyMessage
  | HordeSyncRequestMessage
  | HordeSyncStateMessage;

const MESSAGE_TYPES: ReadonlySet<NetworkMessage['type']> = new Set([
  'matchEnded',
  'hello',
  'welcome',
  'rosterUpdate',
  'playerReady',
  'lobbyReadyUpdate',
  'roomFull',
  'matchStart',
  'playerSnapshot',
  'fireEvent',
  'lampDestroyed',
  'lampSync',
  'worldInteract',
  'worldObjectState',
  'damageEvent',
  'playerDied',
  'respawnEvent',
  'footstepEvent',
  'hostLeftRoom',
  'playerLeft',
  'playerJoinedMatch',
  'gooseSpawned',
  'gooseSnapshot',
  'gooseHitEvent',
  'gooseExploded',
  'gooseSyncRequest',
  'goosePickedUp',
  'gooseThrown',
  'gooseThrowExploded',
  'goldenGoosePickedUp',
  'goldenGooseDropped',
  'kothScoreTick',
  'hordeGooseSpawned',
  'hordeGooseSnapshot',
  'hordeGooseHitEvent',
  'hordeGooseExploded',
  'hordeGooseRemoved',
  'hordeWaveStarted',
  'hordeCleared',
  'hordeReset',
  'hordePlayerEliminated',
  'hordeAmmoDropSpawned',
  'hordeAmmoDropPickedUp',
  'bonusGooseSpawned',
  'bonusGooseSnapshot',
  'bonusGooseHitEvent',
  'bonusGooseKilled',
  'modeExplanationReady',
  'hordeSyncRequest',
  'hordeSyncState',
]);

/** `DataConnection.on('data', ...)` hands back `unknown` (see peerjs's own types) - this is the one
 * place that boundary gets narrowed, so nothing downstream has to re-check message shape. */
export function isNetworkMessage(value: unknown): value is NetworkMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !MESSAGE_TYPES.has(type as NetworkMessage['type'])) return false;
  // The Facility's doors and breakers (section 12) are checked whole here, so a malformed one never
  // reaches the host's authority or a guest's world.
  if (type === 'worldInteract') {
    const { kind, id } = value as { kind?: unknown; id?: unknown };
    return (kind === 'door' || kind === 'breaker') && Number.isInteger(id) && (id as number) >= 0;
  }
  if (type === 'worldObjectState') {
    const { doors, breakers, valleyDoors } = value as { doors?: unknown; breakers?: unknown; valleyDoors?: unknown };
    const validDoors = valleyDoors === undefined ||
      (Array.isArray(valleyDoors) && valleyDoors.length <= 4096 && valleyDoors.every(id => Number.isSafeInteger(id) && (id as number) >= 0));
    return validDoors && [doors, breakers].every(bits => typeof bits === 'string' && bits.length <= 4096 && /^[01]*$/.test(bits));
  }
  return true;
}
