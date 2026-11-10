/** Wire format for the multiplayer DataChannel - a discriminated union so every message every
 * client sends/receives is typed in one place. Host-relay star topology (up to
 * MULTIPLAYER_MAX_PLAYERS, see config.ts): every non-host client holds exactly one connection, to
 * the host; the host relays gameplay messages between guests (see PeerConnection.ts/Game.ts's
 * relay logic) transparently, unchanged, tagged with the ORIGINAL sender's own slot. */

import { KOTH_POINTS_TO_WIN, type GooseExplosionDifficulty, type MatchMap, type MatchWeather } from '../core/config.ts';
import type { GameMode } from '../core/gameModes.ts';
import { isGrenadeKind, type GrenadeKind } from '../combat/grenades/grenadeTuning.ts';

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
  /** A guest's PeerJS id, which other guests dial for a direct link (see network/GuestMesh.ts).
   * Missing for the host's own entry and from older hosts; a guest with none is reached through the
   * host only, as before. */
  peerId?: string;
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
  /** The weapon the sender is holding (a weapon id) and the skin it wears (a skin id), so every
   * other player sees it in their hands (entities/heldWeapon.ts). Both optional: an older build
   * sends neither and is drawn empty-handed; an id this build does not know is ignored. */
  w?: string;
  k?: string;
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
  /** Sender's clock, as on PlayerSnapshotMessage. A guest's shot can reach another guest twice for a
   * moment (over their direct link and through the host, see network/directLinks.ts); this is what
   * the second copy is recognised by. Stamped by PeerConnection; older builds send none. */
  t?: number;
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
  /** The weapon that dealt it ('gooseLauncher' for a launcher blast, 'frag' for a frag grenade). The
   * victim passes it on as PlayerDiedMessage.killerWeaponId, which Gun Game's finisher rule reads.
   * Missing on older builds. */
  weaponId?: string;
}

/** Grenades (docs/grenades.md, design: docs/squad-arsenal-night.md section 3). Relayed like
 * gooseThrown: the thrower is authoritative. `senderSlot` threw grenade `id` (unique per thrower):
 * every other client flies its own copy from `origin` at `velocity` (the game's gravity, the same
 * sweep), purely for visuals, with `fuseLeft` seconds left (it may have been cooked). `t` is the
 * sender's performance.now() when sent. The same message is re-sent for each still-live grenade
 * when an opponent is first seen in the match (late joiners), from where it is at that moment. */
export interface GrenadeThrownMessage {
  type: 'grenadeThrown';
  senderSlot: PlayerSlot;
  id: string;
  kind: GrenadeKind;
  origin: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  fuseLeft: number;
  t: number;
}

/** The thrower's copy of grenade `id` went off at `position`: receivers move their copy there and
 * play the effect. A frag's damage to other players travels separately as damageEvent (weaponId
 * 'frag'); a flash is judged by each client for its own player. */
export interface GrenadeDetonatedMessage {
  type: 'grenadeDetonated';
  senderSlot: PlayerSlot;
  id: string;
  kind: GrenadeKind;
  position: { x: number; y: number; z: number };
}

/** Longest grenade id accepted from the network. */
export const GRENADE_ID_MAX_LENGTH = 48;
/** Longest fuse a grenadeThrown may carry, in seconds. */
export const GRENADE_MESSAGE_MAX_FUSE = 10;

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
  /** The weapon of the damage that gave `killerSlot` the kill (DamageEventMessage.weaponId). Gun
   * Game only credits the winning kill when it is the Goose Launcher (core/multiplayerScoring.ts).
   * Missing on older builds, which are credited as before. */
  killerWeaponId?: string;
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
  /** Sender's clock, for the duplicate check FireEventMessage.t describes. */
  t?: number;
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
  /** The player's PeerJS id (RosterEntry.peerId); a rejoin usually comes back with a new one. */
  peerId?: string;
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
  /** Slots already out of the run (respawns used up), so a late joiner counts them when it checks
   * whether everyone is eliminated. Missing on older hosts. */
  eliminated?: PlayerSlot[];
  /** Set when the run is already over on the host: a joiner adopts the same result. */
  result?: 'cleared' | 'wiped';
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

// ---- Pickups (docs/pickups.md): host-authoritative health, ammo and grenade pickups -----------
// Where each pickup stands is a pure function of the match seed, so every message names one by its
// index in that list. Never relayed: a guest talks to the host, the host answers everyone.

/** Guest -> host only: this player walked onto pickup `id` and would gain from it. The host
 * grants the first claim for a pickup that is on the map and whose claimant it sees close by; the
 * claimant is the transport sender, never a field of the payload. */
export interface PickupClaimMessage {
  type: 'pickupClaim';
  id: number;
}

/** Host -> everyone: pickup `id` was taken by `slot` and returns in `respawnIn` seconds. Only
 * `slot` applies the effect (when it receives this, its own grant); everyone else hides the pickup
 * and shows its faint ring. `respawnIn` is relative because the clients' clocks differ. */
export interface PickupTakenMessage {
  type: 'pickupTaken';
  id: number;
  slot: PlayerSlot;
  respawnIn: number;
}

/** Host -> everyone: pickup `id` is back on the map. */
export interface PickupRespawnedMessage {
  type: 'pickupRespawned';
  id: number;
}

/** Guest -> host: asks for the whole pickup state. Sent when the guest's match starts (the first
 * broadcasts may have been lost while it loaded, and a late joiner missed every one) and repeated
 * until a pickupState answers. */
export interface PickupSyncRequestMessage {
  type: 'pickupSyncRequest';
  senderSlot: PlayerSlot;
}

/** Host -> the one guest that asked: the whole pickup state, one character per pickup in site
 * order, '1' on the map and '0' away. */
export interface PickupStateMessage {
  type: 'pickupState';
  available: string;
}

// ---- Squad (v4.4.0, docs/squad-arsenal-night.md section 1) --------------------------------------

/** Guest <-> guest, on a direct link only (network/GuestMesh.ts): the dialer sends it when the link
 * opens, the answerer replies once it accepts, and both repeat it as the link's heartbeat. A link
 * whose hello names another room, or a slot the roster does not have on that peer, is closed. */
export interface MeshHelloMessage {
  type: 'meshHello';
  slot: PlayerSlot;
  roomCode: string;
}

/** Guest -> host, whenever the set of this guest's live direct links changes. The host stops
 * relaying DIRECT_MESSAGE_TYPES (network/directLinks.ts) between two guests while each lists the
 * other, and resumes the moment either drops it. Never relayed. */
export interface MeshStatusMessage {
  type: 'meshStatus';
  senderSlot: PlayerSlot;
  linked: PlayerSlot[];
}

/** Host -> the one guest that just asked for a sync (gooseSyncRequest or hordeSyncRequest): who is
 * in the match right now. A guest that joined mid-match missed every playerJoinedMatch and
 * playerLeft sent while it was still loading; this brings its opponents up to date. */
export interface RosterSyncMessage {
  type: 'rosterSync';
  roster: RosterEntry[];
}

/** Host -> guests, after each connection poll: the host's measured round trip to each guest. A guest
 * adds its own link to the host to get the round trip to another guest it has no direct link to. */
export interface LinkQualityMessage {
  type: 'linkQuality';
  links: { slot: PlayerSlot; rttMs: number | null; relay: boolean }[];
}

/** Host -> a late joiner, King of the Hill only: who carries the golden goose, or where it lies.
 * Applied as is (unlike goldenGooseDropped, which only counts from the carrier). */
export interface GoldenGooseStateMessage {
  type: 'goldenGooseState';
  carrierSlot: PlayerSlot | null;
  x: number;
  y: number;
  z: number;
}

/** Host -> the one guest that just asked for a sync (see RosterSyncMessage): every connected slot's
 * score and death count now. A late joiner's welcome carried the scoreboard from before it started
 * loading; kills made while it loaded went past unheard. Applied as is: the host's count is the truth. */
export interface ScoreboardSyncMessage {
  type: 'scoreboardSync';
  scores: { slot: PlayerSlot; score: number; deaths: number }[];
}

export type NetworkMessage =
  | MatchEndedMessage
  | ScoreboardSyncMessage
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
  | GrenadeThrownMessage
  | GrenadeDetonatedMessage
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
  | HordeSyncStateMessage
  | PickupClaimMessage
  | PickupTakenMessage
  | PickupRespawnedMessage
  | PickupSyncRequestMessage
  | PickupStateMessage
  | MeshHelloMessage
  | MeshStatusMessage
  | RosterSyncMessage
  | LinkQualityMessage
  | GoldenGooseStateMessage;

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
  'grenadeThrown',
  'grenadeDetonated',
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
  'pickupClaim',
  'pickupTaken',
  'pickupRespawned',
  'pickupSyncRequest',
  'pickupState',
  'meshHello',
  'meshStatus',
  'rosterSync',
  'linkQuality',
  'goldenGooseState',
  'scoreboardSync',
]);

function isPlayerSlot(value: unknown): value is PlayerSlot {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isRosterEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as { slot?: unknown; username?: unknown; peerId?: unknown };
  return isPlayerSlot(entry.slot) && typeof entry.username === 'string' && (entry.peerId === undefined || typeof entry.peerId === 'string');
}

function isLinkEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as { slot?: unknown; rttMs?: unknown; relay?: unknown };
  return isPlayerSlot(entry.slot) && (entry.rttMs === null || typeof entry.rttMs === 'number') && typeof entry.relay === 'boolean';
}

/** Shape checks for the v4.4.0 types: their fields steer connections and the roster, so a malformed
 * one is dropped here rather than half applied. Every other type passes on its `type` alone. */
function hasValidSquadShape(value: Record<string, unknown>): boolean {
  switch (value.type) {
    case 'meshHello':
      return isPlayerSlot(value.slot) && typeof value.roomCode === 'string';
    case 'meshStatus':
      return isPlayerSlot(value.senderSlot) && Array.isArray(value.linked) && value.linked.every(isPlayerSlot);
    case 'rosterSync':
      return Array.isArray(value.roster) && value.roster.every(isRosterEntry);
    case 'linkQuality':
      return Array.isArray(value.links) && value.links.every(isLinkEntry);
    case 'goldenGooseState':
      return (value.carrierSlot === null || isPlayerSlot(value.carrierSlot)) && [value.x, value.y, value.z].every((n) => typeof n === 'number');
    case 'hordeSyncState':
      return (
        typeof value.wave === 'number' &&
        (value.eliminated === undefined || (Array.isArray(value.eliminated) && value.eliminated.every(isPlayerSlot))) &&
        (value.result === undefined || value.result === 'cleared' || value.result === 'wiped')
      );
    case 'scoreboardSync':
      return Array.isArray(value.scores) && value.scores.length <= 4 && value.scores.every(isScoreEntry);
    default:
      return true;
  }
}

function isScoreEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as { slot?: unknown; score?: unknown; deaths?: unknown };
  return isPlayerSlot(entry.slot) && isCount(entry.score) && isCount(entry.deaths);
}

const isCount = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;

/** Largest coordinate a position may carry. The Valley's edge is a few hundred metres out, so this
 * only turns away junk, and the Infinity or 1e300 that would poison every sum it enters. */
export const NETWORK_MAX_COORD = 10_000;
/** Largest velocity component a thrown goose or grenade may carry, in metres a second. A throw is
 * about 17 and a long fall a few tens; 1e200 squared is Infinity, and the whole flight turns NaN. */
export const NETWORK_MAX_SPEED = 200;
/** Most damage one damageEvent may carry: a headshot with a one-shot mode's weapon is 300. */
export const DAMAGE_EVENT_MAX_AMOUNT = 1000;
/** Longest weapon or skin id a message may carry.
 * The longest real one is 13 characters. */
export const NETWORK_MAX_ID_LENGTH = 24;
/** Highest score a kothScoreTick may report: the win, plus the few ticks a carrier may send before
 * the host's matchEnded reaches it. */
export const KOTH_SCORE_TICK_MAX = KOTH_POINTS_TO_WIN + 10;
/** hello's limits. The name field takes 16 characters and the rejoin token is a UUID (36). */
export const HELLO_USERNAME_MAX_LENGTH = 32;
export const HELLO_TOKEN_MAX_LENGTH = 64;
export const HELLO_MAX_FEATURES = 16;
export const HELLO_FEATURE_MAX_LENGTH = 32;

const isCoord = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= NETWORK_MAX_COORD;
const isFiniteNumber = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);
const isOptionalFinite = (value: unknown): boolean => value === undefined || isFiniteNumber(value);
const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';
/** An optional short identifier (a weapon or skin id): bounded so a snapshot cannot carry a payload. */
const isOptionalId = (value: unknown): boolean => value === undefined || (typeof value === 'string' && value.length <= NETWORK_MAX_ID_LENGTH);
const areCoords = (...values: unknown[]): boolean => values.every(isCoord);
const isSpeed = (value: unknown): boolean => isFiniteNumber(value) && Math.abs(value as number) <= NETWORK_MAX_SPEED;

function isShortString(value: unknown, maxLength: number): boolean {
  return typeof value === 'string' && value.length <= maxLength;
}

/** Numbers a peer reports about itself that every receiver feeds into positions, health or the
 * scoreboard: finite and in range, or the message is dropped whole. A NaN damage amount used to make
 * the target immune to every later hit (it poisoned the pending damage sum), and a huge
 * kothScoreTick won King of the Hill outright. */
function hasValidGameplayFields(value: Record<string, unknown>): boolean {
  switch (value.type) {
    case 'hello':
      return isShortString(value.username, HELLO_USERNAME_MAX_LENGTH)
        && (value.rejoinToken === null || isShortString(value.rejoinToken, HELLO_TOKEN_MAX_LENGTH))
        && (value.features === undefined || (Array.isArray(value.features) && value.features.length <= HELLO_MAX_FEATURES
          && value.features.every((feature) => isShortString(feature, HELLO_FEATURE_MAX_LENGTH))));
    case 'playerSnapshot':
      return areCoords(value.x, value.y, value.z) && isFiniteNumber(value.yaw) && isFiniteNumber(value.pitch)
        && isFiniteNumber(value.health) && (value.health as number) >= 0 && (value.health as number) <= DAMAGE_EVENT_MAX_AMOUNT
        && isOptionalFinite(value.t) && isOptionalId(value.w) && isOptionalId(value.k);
    case 'fireEvent':
      return areCoords(value.originX, value.originY, value.originZ, value.endX, value.endY, value.endZ) && isOptionalFinite(value.t);
    case 'footstepEvent':
    case 'respawnEvent':
      return areCoords(value.x, value.y, value.z) && isOptionalFinite(value.t);
    case 'goldenGooseDropped':
    case 'gooseThrowExploded':
      return areCoords(value.x, value.y, value.z);
    case 'gooseThrown':
      return areCoords(value.originX, value.originY, value.originZ) && [value.velX, value.velY, value.velZ].every(isSpeed);
    case 'damageEvent':
      return isPlayerSlot(value.targetSlot) && isFiniteNumber(value.amount)
        && (value.amount as number) >= 0 && (value.amount as number) <= DAMAGE_EVENT_MAX_AMOUNT && isOptionalString(value.weaponId);
    case 'playerDied':
      return isPlayerSlot(value.victimSlot) && (value.killerSlot === null || isPlayerSlot(value.killerSlot))
        && isOptionalFinite(value.t) && isOptionalString(value.killerWeaponId);
    case 'kothScoreTick':
      return Number.isInteger(value.score) && (value.score as number) >= 0 && (value.score as number) <= KOTH_SCORE_TICK_MAX;
    case 'playerReady':
    case 'hordePlayerEliminated':
    case 'modeExplanationReady':
      return isPlayerSlot(value.slot);
    default:
      return true;
  }
}

/** `DataConnection.on('data', ...)` hands back `unknown` (see peerjs's own types) - this is the one
 * place that boundary gets narrowed, so nothing downstream has to re-check message shape. */
export function isNetworkMessage(value: unknown): value is NetworkMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !MESSAGE_TYPES.has(type as NetworkMessage['type'])) return false;
  // A message that names its sender names a real slot (senderAuthority.ts compares it to the link).
  if ('senderSlot' in value && !isPlayerSlot((value as { senderSlot?: unknown }).senderSlot)) return false;
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
  if (type === 'grenadeThrown') return isValidGrenadeThrown(value as Record<string, unknown>);
  if (type === 'grenadeDetonated') return isValidGrenadeDetonated(value as Record<string, unknown>);
  if (type.startsWith('pickup')) return hasValidPickupFields(value as Record<string, unknown>);
  return hasValidSquadShape(value as Record<string, unknown>) && hasValidGameplayFields(value as Record<string, unknown>);
}

/** Most pickups a state string may describe: far above any map's count, so a junk string is cheap to drop. */
const PICKUP_STATE_MAX_LENGTH = 256;

const isSlot = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 3;
const isPickupId = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0 && (value as number) < PICKUP_STATE_MAX_LENGTH;

/** The pickup messages are the ones whose fields are checked here, at the boundary (the older types
 * are read defensively where used): an id is a small non-negative integer, a slot is 0 to 3, the
 * respawn time a finite number of seconds, the state string only '0' and '1'. */
function hasValidPickupFields(message: Record<string, unknown>): boolean {
  switch (message.type) {
    case 'pickupClaim':
    case 'pickupRespawned':
      return isPickupId(message.id);
    case 'pickupTaken':
      return isPickupId(message.id) && isSlot(message.slot) && typeof message.respawnIn === 'number' && Number.isFinite(message.respawnIn) && message.respawnIn >= 0 && message.respawnIn <= 600;
    case 'pickupSyncRequest':
      return isSlot(message.senderSlot);
    case 'pickupState':
      return typeof message.available === 'string' && message.available.length <= PICKUP_STATE_MAX_LENGTH && /^[01]*$/.test(message.available);
    default:
      return false;
  }
}

/** A position: finite and within NETWORK_MAX_COORD on each axis. */
function isPositionVec3(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return areCoords(v.x, v.y, v.z);
}

/** A velocity: finite and no faster than NETWORK_MAX_SPEED on each axis. */
function isVelocityVec3(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return [v.x, v.y, v.z].every(isSpeed);
}

function isValidGrenadeId(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= GRENADE_ID_MAX_LENGTH;
}

/** Grenade messages drive physics and damage on every client, so their fields are checked here
 * rather than trusted: a known kind, a position in range and a sane speed, a short id and a fuse of
 * 0 to 10 seconds. */
function isValidGrenadeThrown(m: Record<string, unknown>): boolean {
  return isValidGrenadeId(m.id) && isGrenadeKind(m.kind) && isPositionVec3(m.origin) && isVelocityVec3(m.velocity)
    && Number.isFinite(m.fuseLeft) && (m.fuseLeft as number) >= 0 && (m.fuseLeft as number) <= GRENADE_MESSAGE_MAX_FUSE
    && Number.isFinite(m.t);
}

function isValidGrenadeDetonated(m: Record<string, unknown>): boolean {
  return isValidGrenadeId(m.id) && isGrenadeKind(m.kind) && isPositionVec3(m.position);
}
