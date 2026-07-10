import * as THREE from 'three';
import { ThrownGoose } from '../entities/ThrownGoose.ts';
import type { Player } from '../entities/Player.ts';
import type { GooseManager } from '../entities/GooseManager.ts';
import type { GoldenGooseManager } from '../entities/GoldenGooseManager.ts';
import type { HordeGooseManager } from '../entities/HordeGooseManager.ts';
import type { BonusGooseManager } from '../entities/BonusGooseManager.ts';
import type { AmmoDropManager } from '../entities/AmmoDropManager.ts';
import type { WeaponManager } from '../weapons/WeaponManager.ts';
import type { Tracers } from '../combat/Tracers.ts';
import type { MuzzleFlash } from '../combat/MuzzleFlash.ts';
import type { ExplosionEffect } from '../combat/ExplosionEffect.ts';
import type { KillFeed } from '../ui/killFeed.ts';
import type { GooseAnnouncement } from '../ui/gooseAnnouncement.ts';
import type { SoundEngine } from '../audio/SoundEngine.ts';
import { computeStereoPan, enemyGunshotVolume, multiplayerGunshotVolume } from '../core/positionalAudio.ts';
import { applyPlayerDied } from '../core/multiplayerScoring.ts';
import { pickGunGameUpgrade } from '../core/gameModes.ts';
import { GOOSE_LAUNCHER_EXPLOSION_RADIUS, GOOSE_TOSS_EXPLOSION_RADIUS } from '../core/config.ts';
import { type NetworkMessage, type PlayerSlot } from './protocol.ts';
import type { ActiveMultiplayer } from './multiplayerMatchTypes.ts';
import type { MultiplayerMatchStartParams } from './MultiplayerSession.ts';

/** Message types the host transparently re-broadcasts to every other connected guest, unchanged,
 * tagged with the original sender's own slot - see the doc on routeMatchMessage below.
 * Lobby/roster messages (hello/welcome/rosterUpdate/roomFull) and host-authored broadcasts
 * (matchStart/hostLeftRoom/playerLeft/playerJoinedMatch) are deliberately excluded - the host
 * authors those itself, they never arrive from elsewhere to relay. */
export const RELAYABLE_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'playerSnapshot',
  'fireEvent',
  'damageEvent',
  'playerDied',
  'respawnEvent',
  'footstepEvent',
  'goosePickedUp',
  'gooseThrown',
  'gooseThrowExploded',
  'goldenGoosePickedUp',
  'goldenGooseDropped',
  'kothScoreTick',
  'hordePlayerEliminated',
  'hordeAmmoDropPickedUp',
  'modeExplanationReady',
]);

/** Everything routeMatchMessage needs from the owning Game instance, handed over as an explicit
 * context object so the ~270-line network switch no longer has to live inside Game.create()'s giant
 * closure. Most fields are the exact managers/systems Game already owns; the method-shaped members
 * wrap the handful of Game-private operations a message case has to perform (queueing network damage,
 * healing the local player on a kill, adding/removing opponents, and so on). */
export interface MatchMessageContext {
  readonly multiplayer: ActiveMultiplayer;
  readonly scene: THREE.Scene;
  readonly player: Player;
  readonly sound: SoundEngine;
  readonly tracers: Tracers;
  readonly muzzleFlash: MuzzleFlash;
  readonly explosionEffect: ExplosionEffect;
  readonly killFeed: KillFeed;
  readonly gooseAnnouncement: GooseAnnouncement;
  readonly gooseManager: GooseManager;
  /** Read through a getter on the concrete context - a mid-match Loadout change rebuilds the
   * WeaponManager, so a stale captured reference would target a disposed instance (see Game's own
   * `weaponManager` field comment). */
  readonly weaponManager: WeaponManager;
  readonly isHordeMode: boolean;
  readonly thrownGeese: Map<string, ThrownGoose>;
  readonly scoreboard: Map<PlayerSlot, number>;
  readonly deathCounts: Map<PlayerSlot, number>;
  readonly goldenGooseManager: GoldenGooseManager | null;
  readonly hordeGooseManager: HordeGooseManager | null;
  readonly bonusGooseManager: BonusGooseManager | null;
  readonly ammoDropManager: AmmoDropManager | null;
  /** Queues incoming network damage (applied inside the next update tick, never here directly - see
   * Game.pendingNetworkDamage) and records the payload's own sender as the kill-credit source. */
  applyNetworkDamage(amount: number, sourceSlot: PlayerSlot): void;
  healLocalPlayerToFull(): void;
  checkHordeAllEliminated(): void;
  receiveModeExplanationReady(slot: PlayerSlot): void;
  removeMultiplayerOpponent(slot: PlayerSlot): void;
  addMultiplayerOpponent(slot: PlayerSlot, username: string): Promise<void>;
  onRematchReceived(params: MultiplayerMatchStartParams): void;
  onOpponentLeftRoom(): void;
}

/** Routes one inbound network message to its local side effects. Takes over from the room screen's
 * own connection callbacks (which only knew how to update now-hidden lobby UI) once a match is
 * running - relay (host-only, transparent pass-through of gameplay messages to every other connected
 * guest) happens first, before the slot-aware local-application switch, so it stays unconditional
 * rather than per message type.
 *
 * CRITICAL invariant: `senderSlot` is the TRANSPORT-level sender - always HOST_SLOT on a guest,
 * since a guest only has one connection (to the host). It is NOT the same as `message.senderSlot`,
 * the payload's own embedded field, which is the only thing that correctly identifies the true
 * origin of a message relayed through the host from a third/fourth player. Every case that looks up
 * `ctx.multiplayer.opponents.get(...)` for gameplay purposes uses `message.senderSlot`; only the
 * liveness-timestamp update and the host's own relay decision (`sendExcept(message, senderSlot)`)
 * correctly use the transport `senderSlot`. Keep that distinction explicit. */
export function routeMatchMessage(ctx: MatchMessageContext, message: NetworkMessage, senderSlot: PlayerSlot): void {
  const activeMultiplayer = ctx.multiplayer;

  if (activeMultiplayer.session.role === 'host' && RELAYABLE_MESSAGE_TYPES.has(message.type)) {
    activeMultiplayer.session.connection.sendExcept(message, senderSlot);
  }

  // Host-only liveness signal (see MULTIPLAYER_CONNECTION_TIMEOUT_MS's own comment) - any
  // message at all counts, not just playerSnapshot, so this stays fresh even during a brief
  // gap in position updates.
  const liveOpponent = activeMultiplayer.opponents.get(senderSlot);
  if (liveOpponent) liveOpponent.lastMessageAt = performance.now();

  switch (message.type) {
    case 'matchStart':
      // The initial matchStart is always consumed by the room screen before this handler
      // ever attaches - any matchStart seen here is the host's Rematch signal.
      ctx.onRematchReceived({
        seed: message.seed,
        killLimit: message.killLimit,
        gooseDifficulty: message.gooseDifficulty,
        gameMode: message.gameMode,
        weather: message.weather,
        ownSlot: activeMultiplayer.session.ownSlot,
        spawns: message.spawns.map((s) => ({ slot: s.slot, point: { x: s.x, z: s.z } })),
        roster: message.roster,
        // Room code/HostRoster don't change mid-connection - carry this match's own
        // session forward rather than re-deriving them (the host does the same, see
        // App.ts's handleRematchClick).
        roomCode: activeMultiplayer.session.roomCode,
        initialScoreboard: [],
        hostRoster: activeMultiplayer.hostRoster ?? undefined,
        showModeExplanation: true,
      });
      break;
    case 'playerSnapshot': {
      // message.senderSlot, not the transport-level `senderSlot` param - on a guest, every
      // message (including ones relayed from a 3rd/4th player) arrives over the single
      // connection to the host, so the transport slot is always HOST_SLOT regardless of who
      // actually sent it (see PeerConnection.attachHostConnection). Only the payload's own
      // senderSlot (preserved verbatim through the relay) identifies the real origin - using
      // the transport slot here applied every other guest's position to the host's own
      // RemotePlayer in any 3+ player match. Confirmed bug, fixed in the 2026-07-10 review.
      const opponent = activeMultiplayer.opponents.get(message.senderSlot);
      if (!opponent) break; // disconnected/unknown slot - a relay-hop race, not an error
      opponent.remotePlayer.applySnapshot(message.x, message.y, message.z, message.yaw);
      opponent.health = message.health;
      break;
    }
    case 'fireEvent': {
      // Purely cosmetic - the shooter's own client already resolved whether this shot
      // actually hit anything; this just makes it visible (and, per user request, audible
      // with real positioning) here too.
      const origin = new THREE.Vector3(message.originX, message.originY, message.originZ);
      const end = new THREE.Vector3(message.endX, message.endY, message.endZ);
      ctx.tracers.spawn(origin, end);
      ctx.muzzleFlash.spawn(origin);
      const distance = origin.distanceTo(ctx.player.position);
      const pan = computeStereoPan(ctx.player.position, ctx.player.facingYaw, origin);
      ctx.sound.playGunshot(message.weaponId, multiplayerGunshotVolume(distance), pan);
      break;
    }
    case 'damageEvent':
      // This client is authoritative over its own player's health - the attacker only ever
      // reports "you took N," never "you're dead," and only the actual intended target
      // applies it (everyone else still relays it - see RELAYABLE_MESSAGE_TYPES - but
      // ignores it for health purposes). Queued rather than applied here directly - see
      // pendingNetworkDamage.
      if (message.targetSlot !== activeMultiplayer.session.ownSlot) break;
      // message.senderSlot (payload origin), not the transport `senderSlot` param - see the
      // playerSnapshot comment; a relayed 3rd/4th-player hit must credit its real sender.
      ctx.applyNetworkDamage(message.amount, message.senderSlot);
      break;
    case 'playerDied': {
      // Goose Horde is co-op - per explicit user request, nobody scores off a teammate's
      // death (accidental friendly fire or otherwise); see the matching gate on the local-
      // death broadcast side below for the full reasoning.
      if (activeMultiplayer.gameMode !== 'gooseHorde') {
        applyPlayerDied(ctx.scoreboard, ctx.deathCounts, message);
      }
      if (message.victimSlot !== activeMultiplayer.session.ownSlot) {
        const victimName = activeMultiplayer.usernames.get(message.victimSlot) ?? 'A player';
        const killerName = message.killerSlot !== null ? activeMultiplayer.usernames.get(message.killerSlot) : null;
        ctx.killFeed.show(killerName ? `${victimName} eliminated by ${killerName}` : `${victimName} eliminated`);
      }
      // Per user request: a kill resets the killer's health too, not just the one who
      // died - the dying player's own health already resets via player.respawn() (delayed
      // by MULTIPLAYER_RESPAWN_DELAY); this is the *other* side of that same round-reset,
      // scoped to "only if I'm the one who got this particular kill" now that any of up to
      // 3 other players could have been the actual killer, not always me. Excluded from
      // Goose Horde for the same co-op reasoning as the scoring gate above - a free heal for
      // downing a teammate is exactly the kind of reward accidental friendly fire shouldn't
      // give.
      if (activeMultiplayer.gameMode !== 'gooseHorde' && message.killerSlot === activeMultiplayer.session.ownSlot) {
        ctx.healLocalPlayerToFull();
      }
      // Gun Game's kill-upgrade: only the killer's own client acts on its own kill (each
      // client is already authoritative over its own weapon state, same as every other
      // per-client-authoritative pattern in this protocol) - dying does NOT reset the
      // weapon (per user request), which already falls out of the fact that respawn only
      // ever refills ammo, never touches weapon identity (see Weapon reset comments).
      if (activeMultiplayer.gameMode === 'gunGame' && message.killerSlot === activeMultiplayer.session.ownSlot) {
        void ctx.weaponManager.replaceActiveWeapon(pickGunGameUpgrade(ctx.weaponManager.activeWeaponId));
      }
      // "A goose spawns whenever a player dies" - a dying guest can't spawn its own
      // authoritative goose (see GooseManager's class comment), so the host does it here on
      // that guest's behalf the moment its playerDied arrives. The host's own death instead
      // takes the direct path in update()'s wasDead block (this message never loops back to
      // its own sender, so the host would otherwise never react to its own death here).
      if (!ctx.isHordeMode && activeMultiplayer.session.role === 'host') {
        const victimPosition = activeMultiplayer.opponents.get(message.victimSlot)?.remotePlayer.position;
        if (victimPosition) ctx.gooseManager.spawnNear(victimPosition.x, victimPosition.z);
      }
      break;
    }
    case 'gooseSpawned':
      ctx.gooseManager.applyRemoteSpawn(message.id, message.x, message.y, message.z);
      break;
    case 'gooseSnapshot':
      ctx.gooseManager.applyRemoteSnapshot(message.id, message.x, message.z);
      break;
    case 'gooseHitEvent':
      // Guest -> host only (see protocol.ts) - a guest's own connection never receives this.
      if (activeMultiplayer.session.role === 'host') ctx.gooseManager.registerRemoteHit(message.id);
      break;
    case 'gooseExploded':
      ctx.gooseManager.applyExplosion(
        message.id,
        new THREE.Vector3(message.x, message.y, message.z),
        activeMultiplayer.gooseDifficulty,
        ctx.player,
      );
      break;
    case 'gooseSyncRequest':
      // Guest -> host only (see protocol.ts) - replies with every currently-live goose as
      // an individual gooseSpawned targeted only at the requester (sendTo, not a
      // broadcast), so the other already-synced guests don't get redundant spawns.
      if (activeMultiplayer.session.role === 'host') {
        for (const goose of ctx.gooseManager.listForSync()) {
          activeMultiplayer.session.connection.sendTo(senderSlot, { type: 'gooseSpawned', ...goose });
        }
      }
      break;
    case 'respawnEvent': {
      // message.senderSlot - see playerSnapshot's own comment on why the transport slot is
      // wrong here for a guest receiving a relayed message.
      const opponent = activeMultiplayer.opponents.get(message.senderSlot);
      opponent?.remotePlayer.teleportTo(message.x, message.y, message.z);
      break;
    }
    case 'footstepEvent': {
      const origin = new THREE.Vector3(message.x, message.y, message.z);
      const distance = origin.distanceTo(ctx.player.position);
      const pan = computeStereoPan(ctx.player.position, ctx.player.facingYaw, origin);
      ctx.sound.playFootstep(multiplayerGunshotVolume(distance), pan);
      break;
    }
    case 'goosePickedUp':
      // Removes it from this client's own view of the flock regardless of role - for the
      // host that's the actual authoritative entry (so it stops being offered to anyone
      // else via findNearestWithinRadius/broadcast further snapshots for it); for a guest
      // it's just their own follower mirror. See protocol.ts's own comment on why this is
      // relay-based rather than host-arbitrated.
      ctx.gooseManager.removeById(message.id);
      break;
    case 'gooseThrown': {
      // Only ever received for another player's throw - the thrower's own client already
      // spawned its local copy before sending this (see updateGooseToss).
      const origin = new THREE.Vector3(message.originX, message.originY, message.originZ);
      const velocity = new THREE.Vector3(message.velX, message.velY, message.velZ);
      // message.senderSlot - see playerSnapshot's own comment; the transport slot would
      // misattribute the thrower for a guest receiving another guest's relayed throw.
      const thrown = new ThrownGoose(message.id, message.senderSlot, message.source, origin, velocity);
      ctx.scene.add(thrown.mesh);
      ctx.thrownGeese.set(message.id, thrown);
      break;
    }
    case 'gooseThrowExploded': {
      // VFX/sound only - damage was already applied by the thrower via ordinary
      // damageEvent messages (see resolveThrownGooseExplosion), so this must NOT re-apply it.
      const position = new THREE.Vector3(message.x, message.y, message.z);
      const explosionRadius = message.source === 'gooseLauncher' ? GOOSE_LAUNCHER_EXPLOSION_RADIUS : GOOSE_TOSS_EXPLOSION_RADIUS;
      ctx.explosionEffect.spawn(position, explosionRadius);
      ctx.sound.playExplosion(enemyGunshotVolume(position.distanceTo(ctx.player.position)), computeStereoPan(ctx.player.position, ctx.player.facingYaw, position));
      const thrown = ctx.thrownGeese.get(message.id);
      if (thrown) {
        thrown.dispose(ctx.scene);
        ctx.thrownGeese.delete(message.id);
      }
      break;
    }
    case 'goldenGoosePickedUp':
      // Only ever received for another player's claim - this client's own claim is applied
      // locally at the moment it sends this (see updateGoldenGoose), same self-authoritative
      // pattern as goosePickedUp above.
      // message.senderSlot - see playerSnapshot's own comment on the transport-slot bug.
      ctx.goldenGooseManager?.claim(message.senderSlot);
      break;
    case 'goldenGooseDropped':
      ctx.goldenGooseManager?.drop(new THREE.Vector3(message.x, message.y, message.z));
      break;
    case 'kothScoreTick':
      // message.senderSlot - see playerSnapshot's own comment; using the transport slot let
      // one guest's points overwrite the host's own scoreboard row on every other guest's
      // client, which could crown the wrong King of the Hill winner in a 3+ player match.
      ctx.scoreboard.set(message.senderSlot, message.score);
      break;
    case 'hordeGooseSpawned':
      ctx.hordeGooseManager?.applyRemoteSpawn(message.id, message.x, message.y, message.z, message.flavor);
      break;
    case 'hordeGooseSnapshot':
      ctx.hordeGooseManager?.applyRemoteSnapshot(message.id, message.x, message.y, message.z);
      break;
    case 'hordeGooseHitEvent':
      // Guest -> host only (see protocol.ts) - a guest's own connection never receives this.
      if (activeMultiplayer.session.role === 'host') ctx.hordeGooseManager?.registerRemoteHit(message.id);
      break;
    case 'hordeGooseExploded':
      ctx.hordeGooseManager?.applyExplosion(message.id, new THREE.Vector3(message.x, message.y, message.z));
      break;
    case 'hordeGooseRemoved':
      ctx.hordeGooseManager?.applyRemove(message.id);
      break;
    case 'bonusGooseSpawned':
      ctx.bonusGooseManager?.applyRemoteSpawn(message.id, message.x, message.y, message.z);
      break;
    case 'bonusGooseSnapshot':
      ctx.bonusGooseManager?.applyRemoteSnapshot(message.id, message.x, message.z);
      break;
    case 'bonusGooseHitEvent':
      // Guest -> host only (see protocol.ts) - a guest's own connection never receives this.
      if (activeMultiplayer.session.role === 'host') ctx.bonusGooseManager?.registerRemoteHit(senderSlot);
      break;
    case 'bonusGooseKilled':
      ctx.bonusGooseManager?.applyKilled(message.killerSlot);
      break;
    case 'hordeWaveStarted':
      ctx.hordeGooseManager?.applyWaveStarted(message.wave);
      ctx.gooseAnnouncement.show(`Wave ${message.wave} incoming...`);
      break;
    case 'hordeCleared':
      ctx.gooseAnnouncement.show('The horde has been cleared - you survived!');
      break;
    case 'hordeReset':
      ctx.hordeGooseManager?.applyReset();
      ctx.gooseAnnouncement.show('A player fell - the horde resets to wave 1...');
      break;
    case 'hordePlayerEliminated': {
      activeMultiplayer.hordeEliminatedSlots.add(message.slot);
      const eliminatedName = activeMultiplayer.usernames.get(message.slot) ?? 'A player';
      ctx.killFeed.show(`${eliminatedName} has been eliminated from the horde!`);
      ctx.checkHordeAllEliminated();
      break;
    }
    case 'modeExplanationReady':
      ctx.receiveModeExplanationReady(message.slot);
      break;
    case 'hordeSyncRequest':
      // Guest -> host only (see protocol.ts) - replies with the current wave number plus every
      // currently-live horde goose, individually, targeted only at the requester (sendTo, not a
      // broadcast) so the other already-synced guests don't get redundant spawns. Mirrors
      // gooseSyncRequest's own handling exactly, just for the horde flock/wave.
      if (activeMultiplayer.session.role === 'host' && ctx.hordeGooseManager) {
        activeMultiplayer.session.connection.sendTo(senderSlot, { type: 'hordeSyncState', wave: ctx.hordeGooseManager.currentWave });
        for (const goose of ctx.hordeGooseManager.listForSync()) {
          activeMultiplayer.session.connection.sendTo(senderSlot, { type: 'hordeGooseSpawned', ...goose });
        }
      }
      break;
    case 'hordeSyncState':
      // Guest side only in practice (a host never receives its own targeted sendTo) - just brings
      // the wave HUD indicator up to date; deliberately doesn't also show the "Wave N incoming…"
      // toast the way applyWaveStarted's ordinary hordeWaveStarted caller does (see
      // HordeSyncStateMessage's own comment on why).
      ctx.hordeGooseManager?.applyWaveStarted(message.wave);
      break;
    case 'hordeAmmoDropSpawned':
      ctx.ammoDropManager?.applyRemoteSpawn(message.id, message.x, message.y, message.z);
      activeMultiplayer.minimap.addItemDot(message.id);
      break;
    case 'hordeAmmoDropPickedUp':
      ctx.ammoDropManager?.removeById(message.id);
      activeMultiplayer.minimap.removeItemDot(message.id);
      break;
    case 'hostLeftRoom':
      ctx.onOpponentLeftRoom();
      break;
    case 'playerLeft':
      ctx.removeMultiplayerOpponent(message.slot);
      break;
    case 'playerJoinedMatch':
      if (message.slot !== activeMultiplayer.session.ownSlot) void ctx.addMultiplayerOpponent(message.slot, message.username);
      break;
  }
}
