# Multiplayer and game modes: how it works and where to change it (v4.5.0)

Hunter 'n Goose is a browser FPS in TypeScript. Up to 4 players (1 host, up to 3 guests) play over PeerJS
and WebRTC. There is no game server: the host's browser tab is the authority for shared world state, and
every player is authoritative over their own body. This file is the map. It was written from the source
on 2026-11-04; `docs/multiplayer.md` is the long history (see section 9 for what in it is stale).

Names are given as `path` plus the class or function. Line numbers are left out on purpose.

## 1. Topology

### 1.1 The star, the room code and the broker

- **Host-relay star.** A guest holds one reliable connection, to the host. The host holds one per guest.
  Anything with authority or ordering goes through the host, which relays guest messages to the other
  guests (`PeerConnection.relay`, called from `routeMatchMessage` in `src/network/MatchMessageRouter.ts`).
- **Room code.** `generateRoomCode` in `src/network/PeerConnection.ts`: 6 characters from a 31 character
  alphabet without 0/O/1/I/L. The PeerJS id is `fpsgame-` + code (`ROOM_ID_PREFIX`); the guest joins by
  calling `peer.connect` on that id. The PeerJS public broker is used only for each connection's handshake.
- **Entry points.** `PeerConnection.hostRoom(code, callbacks)` and `PeerConnection.joinRoom(code,
  username, rejoinToken, callbacks)`. Both are async because they first fetch ICE servers.
- **Capacity.** `MULTIPLAYER_MAX_PLAYERS = 4` in `src/core/config.ts`. Slots are `0 | 1 | 2 | 3`
  (`PlayerSlot` in `src/network/protocol.ts`); slot 0 is always the host (`HOST_SLOT`).
- **Roster policy.** `HostRoster` (`src/network/HostRoster.ts`) is the host's pure state machine: lowest
  free guest slot, rejoin by token, `full` when 4 slots are held, `sweepExpiredReservations`. A slot whose
  guest dropped stays reserved for `MULTIPLAYER_REJOIN_GRACE_PERIOD_MS` (90 s) and still counts against
  capacity. `currentRoster()` includes reserved slots, `connectedRoster()` does not; matches start from
  `connectedRoster()`.

### 1.2 ICE and the TURN fallback

- `DEFAULT_ICE_SERVERS` in `PeerConnection.ts` is STUN only (Google x2, Cloudflare). Passing `config` to
  `new Peer` replaces PeerJS's own list, so everything wanted must be listed.
- `buildIceServers` fetches `/api/turn-credentials` (timeout `TURN_FETCH_TIMEOUT_MS`, 2 s) and appends the
  result. Any failure falls back to STUN only, so room creation never waits on it.
- `functions/api/turn-credentials.ts` (Cloudflare Pages Function, `onRequestGet`) proxies Metered.ca using
  the env vars `METERED_API_KEY` and `METERED_APP_NAME`. Unset or failing, it returns `{ iceServers: [] }`.
  Check the live endpoint first when joins regress: an empty list means no relay.
- `classifyPeerError` maps PeerJS errors to `PeerErrorKind` (`brokerLost`, `roomNotFound`, `roomCodeTaken`,
  `networkBlocked`, `other`). `brokerLost` never ends a running match. The host re-registers its room code
  after a dropped broker socket (`scheduleBrokerReconnect`, backoff 1 s to 15 s).
- A guest that has no welcome after 25 s gives up (`JOIN_TIMEOUT_MS` in `src/ui/menu/JoinRoomScreen.ts`).

### 1.3 Two channels per link

| Channel | Created by | Carries | Notes |
|---|---|---|---|
| Reliable, ordered | PeerJS (`peer.connect(..., { reliable: true })`) | Everything | Ordered on purpose: `gooseExploded` must not overtake `gooseSpawned`. |
| Fast (unordered, no retransmit) | `FastChannel.open` in `src/network/fastChannel.ts` | `playerSnapshot` only (`FAST_MESSAGE_TYPES`) | Negotiated channel id 100 on the same `RTCPeerConnection`. |

The fast channel is used for a snapshot only when it is confirmed (both sides answered a probe, `FAST_PROBE_INTERVAL_MS`
500 ms, at most `FAST_MAX_PROBES` 20), not congested (64 KiB buffered), and the message carries a clock `t`
(`PeerConnection.deliver`). Otherwise the snapshot goes on the reliable channel. Receivers drop a snapshot
that is not newer than the last applied one (`acceptsSnapshot` in `src/network/stateOrder.ts`).

### 1.4 Direct guest links

Without them a guest's snapshot reaches another guest in two hops through the host's upload. `GuestMesh`
(`src/network/GuestMesh.ts`) opens one link per guest pair:

- The lower slot dials the higher one, using the `peerId` carried by every `RosterEntry`.
- The dialer sends `meshHello { slot, roomCode }`; the answerer checks room, slot and peer id against its
  roster, or closes the link. Both repeat it every `MESH_HEARTBEAT_MS` (1 s); a link is down after
  `MESH_LINK_TIMEOUT_MS` (3 s) of silence. Failed dials retry with growing delay up to
  `MESH_MAX_DIAL_ATTEMPTS`.
- Only `DIRECT_MESSAGE_TYPES` travel on a link: `playerSnapshot`, `fireEvent`, `footstepEvent`
  (`src/network/directLinks.ts`). Damage, deaths, respawns, mode state and world objects always take the host path.
- Each guest tells the host its live links (`meshStatus`). `MeshRelayPolicy` makes the host stop relaying
  those three types between two guests only while both list each other. A guest that never reports is
  relayed to as before. Nothing depends on a link.
- Duplicates: until the host has seen both sides, a guest's shot arrives twice. `PeerConnection.stampDirectEvent`
  gives each guest `fireEvent` and `footstepEvent` a never-repeating clock `t` (`createSendClock`), and
  `DuplicateEventFilter` drops the second copy per (sender slot, `t`).

### 1.5 Quality and ping

`PeerConnection.connectionQuality` reads `RTCPeerConnection.getStats` (`readConnectionQuality` in
`src/network/connectionStats.ts`) every `MULTIPLAYER_CONNECTION_POLL_INTERVAL` (2 s, from
`Game.updateMultiplayer`). The host shares its measured round trips as `linkQuality`; a guest adds them to
reach a guest it has no direct link to (`combineRelayedQuality`). The result drives the HUD ping and each
`RemotePlayer`'s lead time (`setLeadSeconds`).

## 2. Messages

All messages are one discriminated union, `NetworkMessage` in `src/network/protocol.ts`. Each is JSON.

### 2.1 Families

| Family | Types | Direction and authority |
|---|---|---|
| Handshake and lobby | `hello`, `welcome`, `roomFull`, `rosterUpdate`, `playerReady`, `lobbyReadyUpdate`, `matchStart` | `hello` guest to host. The rest are host-authored, except `playerReady` (guest to host, names its own slot). The host aggregates readiness and rebroadcasts the whole set. |
| Player state | `playerSnapshot`, `respawnEvent`, `playerDied`, `footstepEvent` | Owner-authoritative, relayed. Snapshot rate `PLAYER_SNAPSHOT_SEND_INTERVAL` = 1/30 s (`config.ts`). |
| Combat | `fireEvent`, `damageEvent` | `fireEvent` cosmetic (tracer, flash, sound). `damageEvent` is sent by the shooter, relayed to all, applied only by `targetSlot`. |
| Scoreboard and end | `matchEnded`, `scoreboardSync`, `kothScoreTick` | `matchEnded` and `scoreboardSync` host-authored. Tick is carrier self-reported and relayed. |
| Membership and rejoin | `playerJoinedMatch`, `playerLeft`, `rosterSync`, `hostLeftRoom`, `welcome.activeMatch` | Host-authored. |
| Wandering geese | `gooseSpawned`, `gooseSnapshot`, `gooseExploded`, `gooseSyncRequest`, `gooseHitEvent`, `goosePickedUp`, `gooseThrown`, `gooseThrowExploded` | The first three are host-authored (host simulates every goose). `gooseHitEvent` and `gooseSyncRequest` are guest to host. The last three are Goose Toss and launcher events, thrower-authoritative and relayed. |
| King of the Hill | `goldenGoosePickedUp`, `goldenGooseDropped`, `goldenGooseState`, `kothScoreTick` | Claims and drops relayed and self-reported; `goldenGooseState` is the host's catch-up. |
| Goose Horde | `hordeGoose*`, `hordeWaveStarted`, `hordeCleared`, `hordeReset`, `hordeAmmoDrop*`, `hordePlayerEliminated`, `hordeSyncRequest`, `hordeSyncState` | Host simulates the flock and waves. `hordePlayerEliminated` and `hordeAmmoDropPickedUp` are self-reported and relayed. |
| Bonus goose | `bonusGooseSpawned`, `bonusGooseSnapshot`, `bonusGooseHitEvent`, `bonusGooseKilled` | Host-authoritative. The guest reports its hit; the host credits the killer. |
| Grenades | `grenadeThrown`, `grenadeDetonated` | Thrower-authoritative, relayed. Frag damage travels as `damageEvent` with `weaponId: 'frag'`. |
| World objects | `worldInteract`, `worldObjectState`, `lampDestroyed`, `lampSync` | Doors and breakers are host-authoritative (guest asks, host checks reach and broadcasts the whole state). Lamps are self-reported and relayed. |
| Pickups | `pickupClaim`, `pickupTaken`, `pickupRespawned`, `pickupSyncRequest`, `pickupState` | Host-authoritative, never relayed (`src/pickups/PickupSystem.ts`, `docs/pickups.md`). |
| Direct links | `meshHello`, `meshStatus`, `linkQuality` | Connection layer only. `meshStatus` is consumed in `PeerConnection` and never routed. |
| Briefing | `modeExplanationReady` | Self-reported, relayed; every client dismisses the briefing when all slots are ready. |

### 2.2 Three validation layers

1. **Shape and bounds: `isNetworkMessage` in `src/network/protocol.ts`.** The type must be in `MESSAGE_TYPES`;
   a `senderSlot` must be a real slot; then per-type checks: `hasValidGameplayFields` (coordinates within
   `NETWORK_MAX_COORD` = 10000, `damageEvent.amount` 0 to `DAMAGE_EVENT_MAX_AMOUNT` = 1000, speeds within
   `NETWORK_MAX_SPEED`, `kothScoreTick.score` within `KOTH_SCORE_TICK_MAX`, hello string lengths),
   `hasValidSquadShape` (mesh, roster, link, scoreboard, horde sync), `isValidGrenadeThrown` and
   `isValidGrenadeDetonated` (id length, kind, fuse 0 to `GRENADE_MESSAGE_MAX_FUSE`), `hasValidPickupFields`
   and the inline checks for `worldInteract` and `worldObjectState`. Types with no entry pass on `type` alone.
2. **Who may send it: `acceptsFromSender` in `src/network/senderAuthority.ts`.** Called by
   `PeerConnection` for every inbound message on a host link, a host connection, a direct link and the fast
   channel. Host-authored types (`HOST_AUTHORED_MESSAGE_TYPES`) are accepted by a guest only from
   `HOST_SLOT`, and dropped by the host from anyone. A message that carries `senderSlot` must name the link it
   came in on; messages whose `slot` is the sender itself are listed in `SELF_SLOT_MESSAGE_TYPES`
   (`playerReady`, `hordePlayerEliminated`, `modeExplanationReady`, `meshHello`); a `playerDied` must have
   `victimSlot === senderSlot`. The one exception: a guest trusts what comes from its host, which relays other
   guests' messages unchanged after checking them.
3. **Match state: `acceptsInMatch` in `MatchMessageRouter.ts`**, run before the host relays. `kothScoreTick`
   is accepted only from the slot this client sees carrying the golden goose, and only upwards; grenade
   messages only when the mode has grenades. The router also clamps a tick to at most `KOTH_SCORE_STEP_MAX` (2)
   above the score held.

### 2.3 Who decides what

| Thing | Authority | Where |
|---|---|---|
| World seed, spawn points, settings, slots | Host | `CreateRoomScreen.startMatch`, `HostRoster` |
| Hit detection and damage amount (headshot included) | Shooter | `RemotePlayer.takeDamage` sends `damageEvent` |
| Health, death, kill credit | Victim | `applyNetworkDamage` queues damage; the death path sends `playerDied` with the last damager inside `MULTIPLAYER_KILL_CREDIT_WINDOW_MS` (8 s) |
| Match end by kills or points | Host decides, then sends `matchEnded` | `Game.updateMultiplayer`, `MultiplayerMatchState.findWinner` |
| Goose Horde end | Every client, from host-authoritative wave state and the relayed eliminated set | `Game.update`, `Game.checkHordeAllEliminated` |
| Wandering, horde and bonus geese | Host simulates; guests mirror | `GooseManager`, `HordeGooseManager`, `BonusGooseManager` in `src/entities/` |
| Pickups, doors, breakers | Host, with a reach check on the claimant | `PickupSystem.handleMessage`, `FacilityInteraction.receiveInteract` in `src/core/facilityInteraction.ts` |
| Grenades and thrown geese | Thrower flies and detonates; others fly a visual copy | `src/combat/grenades/GrenadeSystem.ts`, `src/combat/grenades/grenadeNetwork.ts`, `ThrownGoose` |
| Golden goose carrier | Lowest slot wins a claim race, on every client | `acceptsGoldenGooseClaim`, `acceptsGoldenGooseDrop` |
| Own position, respawn point, Gun Game weapon | Owner | `respawnEvent`, `GunGameController` |

### 2.4 MatchMessageRouter

`routeMatchMessage(ctx, message, senderSlot)` in `src/network/MatchMessageRouter.ts` is the match's one inbound
switch. It takes a `MatchMessageContext` that `Game.create()` builds (`routerContext`) from the managers it owns.

1. `acceptsInMatch` gate.
2. If this client is the host and the type is in `RELAYABLE_MESSAGE_TYPES`: `connection.relay(message, senderSlot)`.
3. Stamp liveness on the transport sender (`lastMessageAt`, and `firstSnapshotAt` on its first snapshot).
4. The switch applies the local effect. Cases use `message.senderSlot` (the true origin) for gameplay, and
   the transport `senderSlot` only for liveness and the relay.

`sendFullSync` (same file) answers `gooseSyncRequest` and `hordeSyncRequest` with the ordered list from
`buildMatchSync` (`src/network/matchSync.ts`), sent to that one guest with `sendTo`.

## 3. Lifecycle

1. **Create room.** `CreateRoomScreen.show` makes a `HostRoster`, a code, and calls `hostRoom`. Its `onHostHello`
   answers each `hello` with `welcome` (or `full`, or `outdated` when `helloSupportsMap` says an older build
   cannot play the Facility). Roster changes go out as `rosterUpdate`, readiness as `lobbyReadyUpdate`.
2. **Join room.** `JoinRoomScreen.attemptJoin` uses `getOrCreateRejoinToken(code)` (`src/core/multiplayerRejoin.ts`,
   `sessionStorage`, one UUID per room code), sends `hello`, shows the lobby on `welcome`, and toggles Ready.
3. **Start.** The host's Start Match is enabled only when every connected slot is ready.
   `CreateRoomScreen.startMatch` calls `HostRoster.startMatch`, picks a seed (`generateMultiplayerSeed` in
   `src/core/worldSeed.ts`), clamps the kill limit to `MULTIPLAYER_KILL_LIMIT_MIN` to `MAX` (1 to 100), picks ring
   spawns (`pickMultiplayerSpawnPoints`), sends `matchStart`, and hands the connection and `HostRoster` to
   `App.startMultiplayerMatch`. Guests do the same from their `matchStart`.
4. **Loading.** `App.createMultiplayerGame` shows `LoadingScreen` and calls `Game.create` with a
   `MultiplayerSession` (`src/network/MultiplayerSession.ts`). `Game.create` calls `setWorldSeed(seed)` so every
   client builds the same world, builds `ActiveMultiplayer` (`src/network/multiplayerMatchTypes.ts`), then replaces
   the connection callbacks (`setCallbacks`) with the router. Each guest sends `gooseSyncRequest` (or
   `hordeSyncRequest` in Goose Horde) and `pickupSyncRequest`, which catch it up on what it missed while loading.
5. **Briefing.** Every mode except `default` has an entry in `MODE_EXPLANATIONS` (`src/core/modeExplanations.ts`).
   The world stays frozen (`worldBriefingActive`) until every participant has sent `modeExplanationReady`.
   Readiness is resent periodically; a leaver is removed from the frozen participant set.
6. **Settle and silence rules (host only).** `Game.updateMultiplayer` runs a once-a-second sweep.
   `isOpponentSilent` (`src/core/opponentLiveness.ts`): a player that has sent snapshots for at least
   `MULTIPLAYER_SETTLE_MS` (30 s) is dropped after `MULTIPLAYER_CONNECTION_TIMEOUT_MS` (8 s) of silence. A player
   with no snapshot yet, a recent first snapshot, or who is dead gets `MULTIPLAYER_LOADING_TIMEOUT_MS` (120 s).
   Only a `playerSnapshot` starts the "playing" clock. A dropped player is marked disconnected in `HostRoster`,
   its connection is closed (`disconnectGuest`), and `playerLeft` is broadcast. Eliminated Goose Horde players
   are exempt. `restartOpponentForRejoin` resets an opponent entry when a rejoin takes over its slot.
7. **Death and respawn.** A dead client waits `MULTIPLAYER_RESPAWN_DELAY` (3 s), then `Game.multiplayerRespawn`
   picks a ring point (`pickRandomRespawnPoint`) and sends `respawnEvent`. In Goose Horde a player has
   `HORDE_MAX_RESPAWNS` (2) and is then eliminated.
8. **Mid-match join and rejoin.** A `hello` during a match reaches `onHostHello` in `Game.create`. The host adds the
   `RemotePlayer`, broadcasts `playerJoinedMatch`, and answers `welcome` with `activeMatch` (seed, settings,
   scoreboard, a spawn point, dead lamps, doors). `JoinRoomScreen` then starts the match directly with
   `showModeExplanation: false`. A token match is a rejoin and keeps its score; a new player gets a cleared score.
   `HostRoster.isMatchInProgress` stays true on the podium, so a joiner there is also welcomed into the finished
   match and replayed `matchEnded` by `sendFullSync`.
9. **End.** The host scans the scoreboard (`MultiplayerMatchState.findWinner`: `killLimit` kills, or
   `KOTH_POINTS_TO_WIN` points in King of the Hill, nothing in Goose Horde), sends `matchEnded` with its
   scoreboard, and every guest adopts it (`Game.applyHostMatchEnd`). `Game.endMultiplayerMatch` freezes the world
   and calls App's `MatchEndScreen` (`src/ui/matchEndScreen.ts`) with the result.
10. **Rematch.** Only the host sees Rematch (and may change kill limit, mode, map, weather, difficulty).
    `App.handleRematchClick` builds a fresh seed and spawns from `connectedRoster()`, sends `matchStart` over the
    same connection, then `restartMultiplayerMatch` disposes the old `Game` with `keepConnectionAlive`. A guest
    gets that `matchStart` in the router and calls `onRematchReceived`.
11. **Return to lobby and the host leaving.** From the podium the host's Return to Lobby sends `hostLeftRoom`
    and tears the room down. A guest whose host connection closes ends its match (`opponentDisconnected`),
    or, if already on the podium, goes back to the lobby. A guest leaving never ends the match for the others:
    the host removes the slot, sends `playerLeft`, and keeps the slot reserved for the grace period.
    There is no host migration.

## 4. Game modes

`src/core/gameModes.ts` defines `GameMode` (the host picks one in Create Room; single-player has none). It also holds
`GAME_MODE_LABELS`, `resolveWeaponLoadout` (`FIXED_LOADOUTS`, Gun Game pool), `GRENADES_ENABLED` and
`modeUsesCustomLoadout`. Per-mode input and scoring logic lives in `src/core/modeControllers/`; `Game.create`
builds at most one controller per match.

| Mode (`GameMode`) | Loadout and rules | Controller or owner | Win |
|---|---|---|---|
| Default (`default`) | Player's own loadout, grenades on. Bonus golden goose (Valley only) grants the Goose Launcher | `BonusGooseManager` | Kill limit |
| 1 Shot 1 Kill (`oneShotOneKill`) | Pistol only, damage override = `PLAYER_HEALTH`, no grenades | `FIXED_LOADOUTS` | Kill limit |
| Sniper Duel (`sniperDuel`) | Sniper only, damage override = `PLAYER_HEALTH`, no grenades | `FIXED_LOADOUTS` | Kill limit |
| Gun Game (`gunGame`) | One random weapon from `GUN_GAME_POOL` (no knife); each credited kill swaps to a different random one; the kill that would reach the limit must be made with the Goose Launcher | `GunGameController` (finisher grant), router `playerDied` case (upgrade), `creditsKill` (rule) | Kill limit |
| Knife Only (`knifeOnly`) | Knife only, no grenades | `FIXED_LOADOUTS` | Kill limit |
| Goose Toss (`gooseToss`) | Placeholder `unarmed` weapon; E picks up a wandering goose, fire throws it; the thrower detonates and sends `damageEvent`s | `GooseTossController`, `ThrownGoose` | Kill limit |
| King of the Hill (`kingOfTheHill`) | Own loadout, grenades on; one golden goose at map centre (0, 0); carrying it scores 1 point per `KOTH_POINT_INTERVAL_SECONDS` | `KingOfTheHillController`, `GoldenGooseManager` | `KOTH_POINTS_TO_WIN` (90) points |
| Goose Horde, co-op (`gooseHorde`) | Own loadout, grenades on with no friendly fire; nobody scores; 15 waves (`HORDE_WAVE_TABLE_MULTIPLAYER`) | `HordeGooseManager`, `AmmoDropManager` | Survive all waves; loss when everyone is eliminated |

Details that are easy to miss:

- **Scoring.** Every client keeps `scoreboard` and `deathCounts` in `MultiplayerMatchState`. A death goes through
  `applyMatchDeath` in `src/core/multiplayerScoring.ts`: Goose Horde scores nothing; in Gun Game `creditsKill`
  withholds the winning kill unless `killerWeaponId` is `gooseLauncher`. The victim applies its own death
  locally and sends `playerDied`; everyone else applies the same function on receipt. The killer is also healed
  to full (except in Goose Horde).
- **Spawns.** `pickMultiplayerSpawnPoints` places N points evenly on a ring of `MULTIPLAYER_SPAWN_RADIUS` (35)
  at a random angle, so the minimum separation is guaranteed in closed form. Respawns and late-join points use
  `pickRandomRespawnPoint`, up to 20 tries for a point at least `MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT`
  (35) from every other player. `findClearSpawnPoint` steps a spawn off a building (Valley) or wall (Facility)
  using the map's `isSpawnBlocked` check.
- **Maps.** `MatchMap` is `valley | facility` (`config.ts`). Every mode runs on both: the map gates were removed
  (`docs/facility-map.md`, section 13). Map differences: the ambient goose flock and the bonus golden goose exist
  on the Valley only (Goose Toss keeps its ambient geese on the Facility, placed by `facilityGoosePlacement`); weather
  does not apply on the Facility; the Facility's horde geese enter through rooms (`src/world/facility/facilityModes.ts`).
- **Grenades.** `grenadesEnabled(mode)`: on in Default, King of the Hill, Goose Horde and the solo modes; off in
  Knife Only, Gun Game, Sniper Duel, 1 Shot 1 Kill and Goose Toss.
- **Single-player modes** (`SinglePlayerMode`, chosen in `PlaySetupModal`, mutually exclusive): elimination (default
  enemies and targets), Director (`PacingDirector` in `src/entities/enemies/director/pacingDirector.ts` runs the
  enemy pacing), Mission (`src/core/mission/missionState.ts`: three uplinks then an extraction, on the Director),
  and Horde (`HordeGooseManager`, 10 waves). All four work on both maps. They have no network code; `Game.create`
  only builds `ActiveMultiplayer` when a `MultiplayerSession` is passed, and multiplayer never spawns the enemy roster.

## 5. Positional audio and remote presentation

- **RemotePlayer** (`src/entities/RemotePlayer.ts`) is a character model with a head and a body collider that is never
  simulated locally. It implements `Damageable`, but `takeDamage` only calls `onHit`, which `Game.addMultiplayerOpponent`
  wires to send `damageEvent`. `applySnapshot` damps toward the latest position; `src/entities/remoteMotion.ts`
  (`RemoteMotion`) extrapolates from recent speed, capped at `MAX_LEAD_SECONDS` (0.12 s) and stopped after
  `STALE_MS` (250 ms). A snapshot that jumps further than `MAX_PREDICT_SPEED` allows, or the first one after a death,
  snaps with `teleportTo`. `setTorch` shows the Facility torch lens; `setLeadSeconds` takes the ping-based lead.
- **Positional audio** (`src/core/positionalAudio.ts`): `computeStereoPan` (horizontal only) and distance falloff
  functions (`multiplayerGunshotVolume`, `knifeSwingVolume`, `lampBreakVolume`, `facilityObjectVolume`,
  `grenadeBounceVolume`) driven by constants in `config.ts` (`MULTIPLAYER_GUNSHOT_*`, `KNIFE_SWING_*`,
  `FACILITY_OBJECT_*`). Remote gunshots never go fully silent. The router's `fireEvent` and `footstepEvent` cases
  call them with the listener's `facingYaw`.
- **HUD and minimap.** `src/ui/multiplayerHud.ts` (rows from the roster, scoreboard, ping) and `src/ui/minimap.ts`
  (one dot per opponent, pickups, King of the Hill marker).

## 6. Where do I change X

| Change | Files and pattern to copy |
|---|---|
| Add a message type | Follow the checklist below. Copy `kothScoreTick` for a relayed self-reported event, `worldInteract` plus `worldObjectState` for a guest request with a host answer. |
| Add a host-authored broadcast | Add the type to `HOST_AUTHORED_MESSAGE_TYPES` (`senderAuthority.ts`); send it from `Game.ts` with `connection.send`; guard the router case with `session.role === 'guest'`. Copy `matchEnded`. |
| Add a guest request the host answers (a host-authoritative feature) | Copy `src/pickups/PickupSystem.ts`: the claimant is the transport slot (never a payload field), the host checks plausibility (position near the site), answers with `sendTo` or `send`, and handles a `*SyncRequest` for late joiners. Do not add it to `RELAYABLE_MESSAGE_TYPES`. |
| Add a game mode | Add the id to `GameMode`, `GAME_MODES` and `GAME_MODE_LABELS`, plus `GRENADES_ENABLED` and a loadout rule (`FIXED_LOADOUTS` or `UNRESTRICTED_GAME_MODES`) in `gameModes.ts`; a briefing in `modeExplanations.ts`; a win threshold in `MultiplayerMatchState.winThreshold` if it is not kills; a controller in `src/core/modeControllers/` built in `Game.create` (copy `GunGameController`); its messages as above; late-join state in `matchSync.ts`; tests in `gameModes.test.ts` and the controller's own test. Check both maps. |
| Change the kill limit rules | Bounds and default: `MULTIPLAYER_KILL_LIMIT_MIN`, `MAX`, `DEFAULT_MULTIPLAYER_KILL_LIMIT` in `config.ts`, clamp in `CreateRoomScreen.startMatch`. Threshold and winner scan: `MultiplayerMatchState.winThreshold` and `findWinner`. Who declares it: the host block in `Game.updateMultiplayer`. |
| Change how a kill is credited | `applyMatchDeath`, `creditsKill` in `multiplayerScoring.ts` (shared by the victim's own death path and the router), and the damage window `MULTIPLAYER_KILL_CREDIT_WINDOW_MS`. Update `multiplayerScoring.test.ts`. |
| Make something host-authoritative | Pattern above (pickups, doors). The host simulates in its manager (`GooseManager` for geese), broadcasts spawn, snapshot and result, and guests mirror through `applyRemote*` methods; a guest's hit goes up as a `*HitEvent`. |
| Add or change a host-picked match option (like weather or map) | Thread it through every site that already carries `weather`: `MatchStartMessage` and `WelcomeMessage.activeMatch` (`protocol.ts`), `MultiplayerSession` and `MultiplayerMatchStartParams`, `ActiveMultiplayer`, `CreateRoomScreen` (control and `startMatch`), `JoinRoomScreen`, `App.handleRematchClick`, `RematchSettings` in `matchEndScreen.ts`, the router's `matchStart` case, and the `onHostHello` welcome in `Game.create`. Keep it optional on the wire so older builds still parse it. |
| Change snapshot contents or rate | `PlayerSnapshotMessage`, `PLAYER_SNAPSHOT_SEND_INTERVAL`, the send in `Game.updateMultiplayer`, the router's `playerSnapshot` case, `hasValidGameplayFields`, `RemotePlayer.applySnapshot`. |
| Move a message to the fast channel or a direct link | `FAST_MESSAGE_TYPES` (`fastChannel.ts`) or `DIRECT_MESSAGE_TYPES` and `DIRECT_EVENT_TYPES` (`directLinks.ts`). It must carry the sender clock `t` and tolerate loss, reorder and duplication. |
| Change liveness, grace or timeouts | `MULTIPLAYER_CONNECTION_TIMEOUT_MS`, `MULTIPLAYER_LOADING_TIMEOUT_MS`, `MULTIPLAYER_SETTLE_MS`, `MULTIPLAYER_REJOIN_GRACE_PERIOD_MS` in `config.ts`; logic in `opponentLiveness.ts` and `HostRoster.ts`; tests in `opponentLiveness.test.ts`, `HostRoster.test.ts`. |
| Change spawns or respawns | `multiplayerSpawn.ts`, `MULTIPLAYER_SPAWN_RADIUS`, the map's `isSpawnBlocked` in `Game.create`. |
| Give a late joiner more state | Add a part to `MatchSyncSource` and `buildMatchSync` (`matchSync.ts`), fill it in `sendFullSync` (router), and keep every message an ordinary idempotent type the joiner already handles. |
| Change a mode's weapons or grenades | `FIXED_LOADOUTS`, `GUN_GAME_POOL`, `UNRESTRICTED_GAME_MODES`, `GRENADES_ENABLED` in `gameModes.ts`; custom loadout storage in `src/core/loadout.ts`. |
| Change TURN or ICE setup | `DEFAULT_ICE_SERVERS`, `buildIceServers` in `PeerConnection.ts`; `functions/api/turn-credentials.ts`; the env vars live in the Cloudflare Pages project. |
| Change audio falloff | `positionalAudio.ts` and the matching constants in `config.ts`. |
| Change the Goose Horde waves | `HORDE_WAVE_TABLE_MULTIPLAYER`, `HORDE_MAX_RESPAWNS` in `config.ts`; `HordeGooseManager`. |

### Checklist: every place a new message must be added

1. `protocol.ts`: the interface, the `NetworkMessage` union member, and the string in `MESSAGE_TYPES`
   (a type missing from `MESSAGE_TYPES` is dropped without any error).
2. `protocol.ts` validation: bound every number, string and array it carries in `hasValidGameplayFields`,
   `hasValidSquadShape` or a dedicated checker called from `isNetworkMessage`. A type whose name starts with
   `pickup` is routed to `hasValidPickupFields`, whose default returns `false`, so a new one must be added there.
3. `senderAuthority.ts`: host-authored goes in `HOST_AUTHORED_MESSAGE_TYPES`; a message about its own sender uses a
   `senderSlot` field (checked automatically) or, if the field is `slot`, an entry in `SELF_SLOT_MESSAGE_TYPES`.
4. `MatchMessageRouter.ts`: `RELAYABLE_MESSAGE_TYPES` if guests send it to each other; a `case` in
   `routeMatchMessage` using `message.senderSlot` for the origin and a role check where only host or guest
   may act; `acceptsInMatch` if it depends on match state; a new `MatchMessageContext` member wired in `Game.create`.
5. If it is cosmetic and latency sensitive, `directLinks.ts`; if it is periodic full state, `fastChannel.ts`.
6. If a late joiner needs the state, `matchSync.ts` and `sendFullSync`.
7. Tests: `protocol.test.ts` (accepts valid, rejects bad bounds), `senderAuthority.test.ts` (who may send),
   `MatchMessageRouter.test.ts` (the effect and the relay), and `matchSync.test.ts` if synced.
8. New fields on an existing message stay optional, as `t`, `torch` and `weaponId` do, so an older build keeps working.

## 7. Gotchas

- **Two sender slots.** `routeMatchMessage`'s `senderSlot` argument is the transport link (always `HOST_SLOT` on a
  guest). The true origin of a relayed message is `message.senderSlot`. Using the transport slot once applied every
  guest's position to the host's avatar. `bonusGooseHitEvent` is the rare case that credits the transport slot, since
  it is guest to host only.
- **Sender stamps.** `t` is the sender's `performance.now()` made strictly increasing by `createSendClock`
  (`stateOrder.ts`): some browsers coarsen the clock. Snapshots, deaths and respawns share the floor
  (`afterStateEvent`), so a late snapshot cannot undo a death. A clock more than `SENDER_RESTART_GAP_MS` (10 s)
  behind means the sender reloaded, not a late packet. A snapshot without `t` never uses the fast channel.
- **Duplicate filtering is per (slot, `t`) and only on events.** `DuplicateEventFilter` covers `fireEvent` and
  `footstepEvent`; snapshots rely on the ordering rule instead. The filter is forgotten on `playerJoinedMatch` and
  `playerLeft` because a rejoined page restarts its clock near zero.
- **Test fakes.** In `MatchMessageRouter.test.ts` the fake `connection` needs `relay` and `sendTo` (not
  `sendExcept`); a fake opponent's `remotePlayer` needs `setTorch` because the router calls it whenever
  `torchAvailable(map, weather)`; the fake context must provide `opponentInMatch`, `grenades` (or `null`) and the
  mode fields it reads. The test helper round-trips every message through JSON and `isNetworkMessage`, so a message the
  validator rejects fails the test at that line.
- **Damage is trusted, within bounds.** A modified client can send any `damageEvent.amount` up to 1000 or a false
  `playerDied.killerSlot`. The design is self-reported with bounds, not anti-cheat. Bounds exist so a NaN or
  1e300 cannot poison sums.
- **The first `matchStart` never reaches the router.** The room screen consumes it. Any `matchStart` the router sees
  is a rematch.
- **King of the Hill kills also score.** `applyMatchDeath` only skips Goose Horde, so in King of the Hill a kill adds a
  point to the killer's scoreboard entry besides the carry points, and the briefing does not say so. Read from the
  code, not run; check with Gustav before relying on it.
- **Catch-up has one entry point.** `gooseSyncRequest` and `hordeSyncRequest` both end in `sendFullSync`, which also
  replays the host's `matchEnded`. A guest in a mode must send the request that matches it.
- **Reservations count.** A reserved slot (grace period) blocks capacity but is excluded from `connectedRoster()`, so it
  does not delay Start Match, rematch spawns or a late joiner's roster.
- **A token match counts even while the slot reads connected.** `HostRoster.handleHello` takes over the slot, and
  `PeerConnection` closes the old connection; the old connection's later close event is ignored.
- **The silence sweep is host only.** Guests never drop anyone; the host closes the silent guest's connection and tells
  the others with `playerLeft`.
- **Pause and death do not freeze the multiplayer world.** `Game.update` keeps physics and the host's goose
  simulation running while this client is paused or dead, so other players are not stalled, and queued damage still
  lands. Single-player freezes fully. The mode briefing and the match end are the exceptions: `update` returns
  early, so a client sitting in the briefing sends no snapshots, which the host's 120 s loading allowance
  (`isOpponentSilent`) tolerates because that client has no first snapshot yet.
- **Stale comments in code.** `MultiplayerMatchState.findWinner` and `Game.endMultiplayerMatch` say every client
  decides the winner with no host adjudication; since the `matchEnded` fix only the host does. The
  `BonusGooseSpawnedMessage` comment says every mode but Goose Toss; the code (`isBonusGooseEnabled` in `Game.create`)
  allows Default on the Valley only.

## 8. Tests and debug hooks

- Unit tests sit beside the code (`*.test.ts`); run them on every change. Network files with e2e groups: `mp`
  (six `multiplayer*.spec.ts`) and `mp4` (`multiplayer-four.spec.ts`, four contexts). See `docs/testing.md` and
  `scripts/e2eGroups.mjs` for which group a file triggers.
- `getNetworkDebug()` (`src/core/gameDebugApi.ts`) reports `fastChannelsReady`, `pingLabel` and `directLinksReady`.

## 9. Status of older docs

- `docs/multiplayer.md` is a dated diary, not a spec. Later entries correct earlier ones. Wrong today: the Phase 4
  win condition (decided by the host with `matchEnded`, not by each client), kill limit options 10/15/25 (now a
  number input 1 to 100), "18Hz" (it is 30 Hz), the 2026-07-06 TURN entry (`netlify/functions`, `PEERJS_DEFAULT_ICE_SERVERS`;
  now `functions/api/turn-credentials.ts` and STUN only plus Metered), and the 2-player wording throughout. Its
  v4.4.0 section (three and four players, direct links, silence rules) matches the code.
- `docs/MULTIPLAYER_PLAN.md` is marked historical at its top.
- Deeper design for what is outlined here: `docs/squad-arsenal-night.md` (squad, arsenal, night),
  `docs/facility-map.md` (map, doors, lamps, modes on the Facility), `docs/pickups.md`, `docs/grenades.md`.
