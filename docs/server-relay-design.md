# Server relay design (Phase A): Milestone 1 built, release pending

Status: written 2026-11-05 against v4.6.1. Built up to Milestone 1 on `feature/server-relay`; see section 13.1 for what is built and how it differs.
Claims about current behaviour cite `path` plus class or function, read from the code. Anything not
checked in this repository or that depends on a third party is marked UNVERIFIED.

## 1. Goal, non-goals, constraints

**Goal.** Move multiplayer traffic off the host's browser onto a small Node.js relay in Johannesburg: less
lag, loss and ping, reliable lobby joins, and room to grow past 4 players later. **Phase A:** the server
owns rooms, codes, slots, rejoin tokens, relay and quality measurement; the host client keeps simulating
geese, hordes, pickups, doors and scoring exactly as today.

**Non-goals.** No headless simulation (Phase B, section 14), no anti-cheat (client-reported hits stay trusted
within today's bounds), no accounts or database, no host migration, no payload changes beyond the transport.

**Constraints (decided with Gustav).** Players all in South Africa; 4 now, but the server reads capacity from
config, never a literal 4; zero budget; private and invite-only; client stays on Cloudflare Pages; target
host an Oracle Always Free Ampere A1 VM in Johannesburg (2 OCPU, 12 GB, Ubuntu, public IP); plain Node.js
with few dependencies so it can move.

### 1.1 Decisions recorded with Gustav (2026-11-05)

| Question (section 12.3) | Answer | Effect on this design |
|---|---|---|
| Oracle account and home region | None yet | WP 0 starts from sign-up. Pick **Johannesburg** as the home region at sign-up; it cannot be changed later. |
| Domain on Cloudflare | **Changed (2026-11-05, builder session):** neither session recorded the domain; Gustav prefers a generic free name | **DuckDNS + Caddy with Let's Encrypt** (section 8.1) is the plan again; a Cloudflare subdomain stays possible later. |
| Host drop ends the match in release 1, resume (F1) after | **Resume (2026-11-05, builder session):** play resumes if the host returns within **30 s** | F1 moves into release 1, built right after Milestone 1, with a 30 s window (not 10 s) for the host and for guests. Sizes in 5.6 scale to 30 s. |
| Card at Oracle sign-up | Yes | Stay on the Always Free account. No Pay As You Go unless Gustav decides after a first reclaim (section 8.4). |
| Who gets the access code, rotation | Anyone Gustav chooses; no rotation planned | One shared code in `HNG_ACCESS_CODES`. Rotation stays possible (add a code, then remove the old one) but is not part of the plan. If the code leaks, change it by editing the env file and restarting. |
| Comparison telemetry (10.3) | Gustav: yes, bind it (2026-11-05) | The `MATCH_TELEMETRY` KV namespace is bound to the Pages project (production and preview); the multiplayer beacon gains the ping fields ahead of the relay, so P2P matches record the baseline (WP 12 moved first). |

## 2. Current behaviour and the transport seam

### 2.1 What the game uses today

`PeerConnection` (`src/network/PeerConnection.ts`) wraps PeerJS. It is a host-relay star: the host holds
one `DataConnection` per guest; a guest holds one to the host keyed `HOST_SLOT`. Beside each reliable
ordered channel it opens a `FastChannel` (`src/network/fastChannel.ts`, negotiated id 100, unordered,
`maxRetransmits: 0`) that carries `playerSnapshot` only, after a probe confirms the far side listens. A
guest also opens direct links to other guests (`GuestMesh`, `src/network/GuestMesh.ts`) for
`playerSnapshot`, `fireEvent` and `footstepEvent` (`DIRECT_MESSAGE_TYPES` in `src/network/directLinks.ts`).

Public surface of `PeerConnection` and who calls it (from a grep of `src/`, tests excluded):

| Member | Callers | Notes |
|---|---|---|
| `static hostRoom(code, callbacks)` | `CreateRoomScreen.show` | Async (fetches ICE servers first). Code is generated on the client by `generateRoomCode`. |
| `static joinRoom(code, username, rejoinToken, callbacks)` | `JoinRoomScreen.attemptJoin` | Sends `hello` when the channel opens. |
| `send(message)` | Game.ts (44 call lines with `sendTo`), `CreateRoomScreen`, `JoinRoomScreen`, `App.handleRematchClick`, `App.handleReturnToLobbyFromMatchEnd`, `facilityInteraction.ts`, `KingOfTheHillController`, `GooseTossController`, `createMatchPickups.ts`, `grenadeNetwork.ts` | Host: to every guest. Guest: to the host (and the mesh). |
| `sendTo(slot, message)` | `sendFullSync` in `MatchMessageRouter.ts`, `FacilityInteraction` (worldObjectState catch-up), `createMatchPickups.ts` | Host to one guest. |
| `relay(message, fromSlot)` | `routeMatchMessage` only | Host passes a guest's relayable message to the other guests. |
| `sendExcept(message, slot)` | none outside the class | Dead API; drop it from the interface. |
| `disconnectGuest(slot)` | `Game.updateMultiplayer` silence sweep | Host only. |
| `connectionQuality()` | `Game.updateMultiplayer` every `MULTIPLAYER_CONNECTION_POLL_INTERVAL` (2 s) | Reads `RTCPeerConnection.getStats` through `readConnectionQuality` (`connectionStats.ts`). Host also sends `linkQuality`. |
| `isConnectedTo(slot)` | `Game.start` (guest checks the host is still there) | |
| `setCallbacks(callbacks)` | `Game.create` (hands control to the router), `App.restartMultiplayerMatch`, `App.returnToLobby` (silencing) | Full handoff, not a merge. |
| `dispose()` | Create and Join screens, `Game.dispose` path, `debugDisconnect` | |
| `fastChannelReadyCount()`, `directLinksReady()` | `Game.installDebugApi` (`getNetworkDebug`) | e2e contract: `multiplayer-match.spec.ts` expects `fastChannelsReady` 1; `multiplayer-four.spec.ts` reads `directLinksReady`. |
| `ownRole()`, `ownSlot()` | none outside the class | Callers use `session.role` and `session.ownSlot`. |

Callbacks (`PeerConnectionCallbacks`): `onConnected(slot)`, `onPeerDisconnected(slot)`, `onError(message,
kind: PeerErrorKind)`, `onBrokerReconnected?()`, `onMessage(message, transportSlot)`, and `onHostHello?(username,
rejoinToken, features, peerId)` returning `WelcomeMessage | 'full' | 'outdated'` or a Promise of it (a
mid-match join loads a `RemotePlayer` model first, `Game.create`). The type also appears in
`MultiplayerSession.connection`, `MultiplayerMatchEndResult.connection` (`matchEndScreen.ts`), three `App`
methods (`startMultiplayerMatch`, `createMultiplayerGame`, `restartMultiplayerMatch`) and the room screens.

Inbound path: `isNetworkMessage` (shape, bounds), `acceptsFromSender(message, transportSlot, role)`
(`senderAuthority.ts`) inside `PeerConnection`, then `routeMatchMessage`, which runs `acceptsInMatch`,
relays `RELAYABLE_MESSAGE_TYPES` on the host, stamps liveness on the transport slot, and applies the effect
using `message.senderSlot` as the true origin.

### 2.2 The seam

`MultiplayerSession.connection` is the seam: the match uses a dozen methods and one callback object, so a
second implementation behind an interface leaves Game.ts and the managers almost untouched. Only the room
screens construct a connection.

Proposed interface (design only; names final unless a builder finds a clash):

```ts
// src/network/transport.ts
export type TransportKind = 'p2p' | 'server';
export type TransportErrorKind = PeerErrorKind | 'serverLost' | 'accessDenied' | 'versionMismatch'; // PeerErrorKind: today's five
/** `assigned`: null on P2P (the host's HostRoster decides, as today); set on the server (it decided). */
export interface HostHelloRequest { username: string; rejoinToken: string | null; features: unknown; peerId: string; assigned: HelloOutcome | null }
export type HostHelloResult = WelcomeMessage | 'full' | 'outdated';

export interface TransportCallbacks {
  onConnected(slot: PlayerSlot): void;
  onPeerDisconnected(slot: PlayerSlot): void;
  onError(message: string, kind: TransportErrorKind): void;
  onMessage(message: NetworkMessage, transportSlot: PlayerSlot): void;
  onBrokerReconnected?(): void;                                   // P2P only
  onHostHello?(request: HostHelloRequest): HostHelloResult | Promise<HostHelloResult>;
  onReservationExpired?(slot: PlayerSlot): void;                  // server only: replaces the host's sweep
}

export interface Transport {
  readonly kind: TransportKind;
  readonly roomCode: string;
  send(message: NetworkMessage): void;
  sendTo(slot: PlayerSlot, message: NetworkMessage): void;
  relay(message: NetworkMessage, fromSlot: PlayerSlot): void;   // server: no-op, the server fanned it out
  disconnectGuest(slot: PlayerSlot): void;                      // server: sends a kick
  connectionQuality(): Promise<Map<PlayerSlot, ConnectionQuality>>;
  isConnectedTo(slot: PlayerSlot): boolean;
  ownRole(): MultiplayerRole;
  ownSlot(): PlayerSlot;
  setCallbacks(callbacks: TransportCallbacks): void;
  dispose(): void;
  fastChannelReadyCount(): number;                              // server: 0 until a WebRTC leg exists
  directLinksReady(): number;                                   // server: always 0
}
export function hostRoom(kind: TransportKind, opts: HostRoomOptions, cb: TransportCallbacks): Promise<Transport>;
export function joinRoom(code: string, opts: JoinRoomOptions, cb: TransportCallbacks): Promise<Transport>;
```

**What stays in PeerConnection:** everything PeerJS, ICE and TURN (`buildIceServers`, `DEFAULT_ICE_SERVERS`),
`classifyPeerError`, `FastChannel` use, `GuestMesh`, `MeshRelayPolicy`, `DuplicateEventFilter`,
`generateRoomCode`, broker reconnect. It becomes `class PeerConnection implements Transport` with
`onHostHello` called with `assigned: null`.

**What moves:** `HostHelloResult` and `NETWORK_BLOCKED_MESSAGE` to `transport.ts`; `PeerErrorKind` becomes
an alias of `TransportErrorKind`; `RELAYABLE_MESSAGE_TYPES` from `MatchMessageRouter.ts` (which imports
Three.js) to a new shared `src/network/routing.ts`, re-exported from the router so imports and tests keep
working. New `src/network/ServerTransport.ts` implements the interface over a WebSocket.

## 3. Server responsibilities and routing

### 3.1 Responsibilities

The server owns: room create and close, room codes, membership (which socket holds which slot), slot
assignment, rejoin tokens and the 90 s reservation, admission (with the host's answer), fan-out of
every game message, sender checks, rate and size limits, liveness of sockets, and RTT measurement.

The host client keeps: deciding `outdated` (map support), building the `welcome` (including
`activeMatch` for a mid-match join), `rosterUpdate`, `lobbyReadyUpdate`, `matchStart`, `playerJoinedMatch`,
`playerLeft`, every world simulation broadcast, `matchEnded`, the silence sweep (`isOpponentSilent`),
pickups, doors and catch-up (`sendFullSync`).

### 3.2 Routing rules

One rule per type. **R**: relay to every other live member, host included (exactly today's
`RELAYABLE_MESSAGE_TYPES`, but one server hop instead of two residential ones). **H**: a guest's request, to
the host only. **B**: accepted only from the host, to every live guest, or to one when the frame has `to`.
**S**: server handled, replaced by a control op (section 5), refused inside a game frame. **D**: P2P mesh
connection types, dropped.

| Family | Type: class |
|---|---|
| Handshake and lobby | `hello`: S (op `join`). `welcome`: S (op `joinAnswer`). `roomFull`: S (op `rejected`, translated client side). `rosterUpdate`: B. `playerReady`: H. `lobbyReadyUpdate`: B. `matchStart`: B. |
| Player state | `playerSnapshot`: R. `respawnEvent`: R. `playerDied`: R. `footstepEvent`: R. |
| Combat | `fireEvent`: R. `damageEvent`: R (every client gets it; only `targetSlot` applies it, as today). |
| Scoreboard and end | `matchEnded`: B. `scoreboardSync`: B with `to`. `kothScoreTick`: R. |
| Membership and rejoin | `playerJoinedMatch`: B. `playerLeft`: B. `rosterSync`: B with `to`. `hostLeftRoom`: B (the server then closes the room when the host socket leaves). |
| Wandering geese | `gooseSpawned`, `gooseSnapshot`, `gooseExploded`: B. `gooseSyncRequest`, `gooseHitEvent`: H. `goosePickedUp`, `gooseThrown`, `gooseThrowExploded`: R. |
| King of the Hill | `goldenGoosePickedUp`, `goldenGooseDropped`: R. `goldenGooseState`: B with `to`. |
| Goose Horde | `hordeGooseSpawned`, `hordeGooseSnapshot`, `hordeGooseExploded`, `hordeGooseRemoved`, `hordeWaveStarted`, `hordeCleared`, `hordeReset`, `hordeAmmoDropSpawned`: B. `hordeSyncState`: B with `to`. `hordeGooseHitEvent`, `hordeSyncRequest`: H. `hordePlayerEliminated`, `hordeAmmoDropPickedUp`: R. |
| Bonus goose | `bonusGooseSpawned`, `bonusGooseSnapshot`, `bonusGooseKilled`: B. `bonusGooseHitEvent`: H (the host credits the transport slot, `routeMatchMessage`, so the server must stamp `from` truthfully). |
| Grenades | `grenadeThrown`, `grenadeDetonated`: R. |
| World objects | `worldInteract`: H. `worldObjectState`: B (broadcast or `to`). `lampDestroyed`, `lampSync`: R. |
| Pickups | `pickupClaim`, `pickupSyncRequest`: H. `pickupTaken`, `pickupRespawned`: B. `pickupState`: B with `to`. |
| Direct links | `meshHello`, `meshStatus`, `linkQuality`: D. |
| Briefing | `modeExplanationReady`: R. |

Totals: 63 types (`MESSAGE_TYPES` in `protocol.ts`): R 19, H 9, B 29, S 3, D 3. A type not allowed for the
sender's role is dropped and counted. A unit test fails if any type has no class, so a future message
cannot be forgotten (the checklist in `docs/architecture/multiplayer-and-modes.md` section 6 gains a step 9).
Only the host may use `to`, and only towards a live, admitted guest.

**Order.** One event loop handles frames one at a time over TCP-ordered sockets, so every recipient sees one
room-wide order (server arrival order) instead of the host's. The one thing that ran on the host before
relaying, the `acceptsInMatch` gate, also runs on every client in `routeMatchMessage`, so effects are unchanged.

### 3.3 Shared module, and keeping Three.js and the DOM out of the server

The server imports, at runtime: `src/network/protocol.ts`, `senderAuthority.ts`, `routing.ts` (new),
`serverEnvelope.ts` (new), `HostRoster.ts`, `glassWire.ts` (since v5.2.0: the glass message checks, kept apart
from the world code in `world/glass/glassPane.ts`), and through them `src/core/config.ts`, `src/core/version.ts`
and `src/combat/grenades/grenadeTuning.ts`. Verified: `config.ts` imports only `version.ts`; `grenadeTuning.ts`
imports only `config.ts`; `protocol.ts` imports `GameMode` from `gameModes.ts` as a type only (erased);
`HostRoster.ts` imports `config.ts` and `protocol.ts`. None imports Three.js, Rapier or the DOM, and none
uses `window`, `document` or `import.meta`.

Rules that keep it that way: (1) the server never imports `MatchMessageRouter.ts`, `PeerConnection.ts`,
`fastChannel.ts` or anything in `src/core/` besides `config.ts` and `version.ts` (hence the move of
`RELAYABLE_MESSAGE_TYPES`); (2) `server/tsconfig.json` uses `lib: ["ES2022"]` without DOM and
`types: ["node"]`, so a DOM type in a shared file fails `tsc -p server`; (3) a unit test (`server/importGraph.test.ts`)
walks the static import graph from `server/main.ts` and fails on any file outside that allowlist, on any
bare import other than `ws` and `node:*`, and on a server source file the walk does not reach. The repo already imports with `.ts` extensions (`allowImportingTsExtensions`), which
is what Node's type stripping needs, so the server runs the TypeScript directly with no bundler (7.2).

Small shared edits: export `ALL_MESSAGE_TYPES` (today `MESSAGE_TYPES` is module private) and
`PLAYER_SLOT_COUNT = 4` from `protocol.ts`, and use the constant in `isPlayerSlot`, `isSlot` and the
`scoreboardSync` length check, so the slot domain has one source.

### 3.4 What the server validates and what it trusts

Validated on every frame: size (section 7.4), JSON parse, envelope shape (`serverEnvelope.ts`),
`isNetworkMessage`, sender authority, routing class, `to` target, rate limits. Sender authority on the
server reuses `acceptsFromSender` through a small wrapper added to `senderAuthority.ts`:

```ts
/** Server side: may the member in `fromSlot` send this? The host may author host-authored types;
 *  everything else must name its own slot, exactly as today's host checked its guests. */
export function serverAccepts(message: NetworkMessage, fromSlot: PlayerSlot): boolean {
  if (fromSlot === HOST_SLOT && HOST_AUTHORED_MESSAGE_TYPES.has(message.type)) return true;
  return acceptsFromSender(message, fromSlot, 'host');
}
```

That gives the server today's host rules for free: host-authored types refused from guests, `senderSlot`
equal to the member's slot, `SELF_SLOT_MESSAGE_TYPES` naming the sender, `playerDied.victimSlot` equal to
`senderSlot`. Handshake fields reuse the `hello` limits (`HELLO_USERNAME_MAX_LENGTH` and friends in
`protocol.ts`); a `joinAnswer` welcome must pass `isWelcomeFor` (`serverEnvelope.ts`): `isNetworkMessage`,
`yourSlot` equal to the assigned slot, a boolean `isRejoin`, a string `hostUsername` and an array `roster`.

Deliberately trusted (private game, as today): damage and hits within `hasValidGameplayFields` bounds, deaths
and kill credit, positions, King of the Hill ticks, every host decision (welcome, seed, scoreboard, match
end), username content. `isNetworkMessage` does not strip unknown fields, so extras pass through, capped by
the frame size. Clients keep running `isNetworkMessage` and `acceptsFromSender` on everything (defence in depth).

## 4. Room lifecycle

### 4.1 Create

Host client connects, completes the handshake, sends `create { username, maxPlayers }`. The server clamps
`maxPlayers` to `min(config.maxPlayersPerRoom, PLAYER_SLOT_COUNT)`, generates a code, builds a
`HostRoster(hostUsername, { capacity, graceMs })` with the host in slot 0, and answers
`created { code }`. `CreateRoomScreen` shows the code when it arrives instead of generating it locally.

**Codes.** Today's format (6 characters, `generateRoomCode`'s 31-letter alphabet): players read them aloud
and the e2e specs match `/^[A-Z2-9]{6}$/`. The server draws them with `crypto.randomInt` (a server code is a
join secret, so not `Math.random`), retries on a clash with a live or tombstoned room, and after 20 tries
answers `rejected { reason: 'busy' }`. 31^6 is about 887 million codes, so clashes are a non-event.

### 4.2 Join, slot assignment and rejoin tokens

1. Guest sends `join { code, username, rejoinToken, features }` (the token is today's per-code UUID from
   `getOrCreateRejoinToken`, unchanged; the client uppercases the code, the server matches it exactly).
   Unknown or tombstoned code: `rejected { reason: 'notFound' }`,
   shown as today's "No room found with that code." (asserted by `e2e/multiplayer.spec.ts`).
2. The server runs `HostRoster.handleHello(...)`; `full` gives `rejected { reason: 'full' }`. Otherwise the
   slot is held and the member is **pending**: it gets no game frames and no `quality`, and its own game
   frames are dropped; it does get `pong` (so a long wait for the host's answer does not read as a lost
   server), `rejected` and `roomClosed`.
3. The server sends the host `joinRequest { slot, outcome, username, rejoinToken, features, peerId }`
   (`peerId` is a synthetic `srv-<slot>-<n>`, kept because `RosterEntry.peerId` exists; nothing dials it).
4. The host transport calls `onHostHello({ ..., assigned })`. The host adopts the outcome into its own
   `HostRoster` mirror (new `adopt`) instead of calling `handleHello`, then runs today's logic unchanged:
   `outdated` check, score reset for `joined`, mid-match `addMultiplayerOpponent`, `playerJoinedMatch`,
   and the welcome with `activeMatch`.
5. The host answers `joinAnswer { slot, welcome }` or `{ slot, reject: 'full' | 'outdated' }`. The server
   validates it, sends the welcome to the guest as a game frame from slot 0, marks the member live, then
   sends the host `admitted { slot }` (its transport calls `onConnected(slot)`). Same order as today:
   `CreateRoomScreen`'s `onConnected` sends `lobbyReadyUpdate`, which must reach the new guest.
6. A rejection sends `rejected` (then close 1000). No answer within 30 s (`JoinRoomScreen` gives up at
   25 s, `JOIN_TIMEOUT_MS`) does the same with `busy`, and so does a pending member whose socket closes
   (without the `rejected`). The slot then goes back to what it was, and the host is told which:
   - a new player (`joined`): the slot is released (`HostRoster.release`) and the host gets `expired { slot }`;
   - a rejoin (`rejoined`): the slot returns to a reservation with a **fresh** 90 s from that moment
     (`handleDisconnect`), and the host gets `memberLeft { slot }`;
   - a takeover that never finished (the old member is still live in the slot): nothing changed, so the
     slot is left alone and the host is told nothing.

**Two joins waiting on one slot** (the same rejoin token from a reload or a second tab): the newer one
replaces the older, which is closed with 4011, and the host's answer for that slot applies to the newer one.

**Token takeover.** `HostRoster.handleHello` lets a token take over a slot that still reads connected; the
server closes the old socket (4011) once the new member is admitted and ignores its later close, as
`PeerConnection.attachIncomingGuestConnection` does today.

### 4.3 The 90 s reservation

Reuse `HostRoster` as is, shared by client and server, with two additions: a constructor option
`{ capacity, graceMs }` (defaults from `MULTIPLAYER_MAX_PLAYERS` and `MULTIPLAYER_REJOIN_GRACE_PERIOD_MS`,
so the P2P host is unchanged) with `GUEST_SLOTS` derived from capacity, and `adopt` and `release`.

A guest socket that closes or is kicked (`disconnectGuest`) gets `handleDisconnect(slot, now)`, and the host
gets `memberLeft { slot }` (its transport calls `onPeerDisconnected`, so `Game.create` sends `playerLeft` as
today). The server sweeps reservations each second and sends the host `expired { slot }`
(`onReservationExpired`). In server mode the host's own sweeps (`CreateRoomScreen`'s interval and
`sweepExpiredReservations` in `Game.updateMultiplayer`) are off; the expiry callback runs the same
follow-up (prune ready state, `rosterUpdate`, `playerLeft`). One sweeper, one truth.

### 4.4 What "host" means, and the host leaving

The host is slot 0: it created the room and still simulates the world. Today every guest's match ends when
the host connection closes (`onPeerDisconnected` in `Game.create`, `opponentDisconnected`; no host migration).

**Recommended policy: the room closes when the host leaves.** The server sends every guest
`roomClosed { reason: 'hostLeft' }` and closes their sockets; the guest transport fires
`onPeerDisconnected(HOST_SLOT)`, so Game.ts and the room screens behave exactly as today. As built, a host
whose socket drops abnormally is first held for 30 s and closes the room only if it does not resume
(section 5.6). The runner-up,
promoting another client to simulator, wins only once a host drop mid-match becomes the most common
complaint after the server is live, and is best folded into Phase B, because a promoted guest would be
missing: every wandering goose's authoritative state (ids, hit counts, wander targets; guests hold
follower copies in `GooseManager`); the horde wave timer, spawn queue and flock (`HordeGooseManager`) and
ammo drops (`AmmoDropManager`); the bonus goose and its hit attribution (`BonusGooseManager`); pickup
availability and respawn timers (`PickupSystem`); door and breaker state newer than the last
`worldObjectState`; `endedMatchVerdict` and the host's single ordering of deaths. (The roster is solved:
the server has it.) Each manager would need a "promote followers to authority" path: L work, many edge cases.

### 4.5 Collisions, cleanup, limits

- A closed room's code is tombstoned for 10 minutes, so a late rejoin attempt reads "room closed" instead
  of joining a stranger's new room.
- Empty room (no live or pending members): closed at once. Idle rooms: closed once the host has been
  alone (no live or pending guest) and no `matchStart` was relayed for 2 hours (measured from the later
  of the two). Any room older than 12 hours: closed. All three send `roomClosed` first.
- `HNG_MAX_ROOMS` (default 50): above it `create` gets `rejected { reason: 'busy' }`.

## 5. Wire protocol

### 5.1 Frames

All frames are JSON text over one WebSocket (`wss://<host>/ws`). Two kinds, told apart by a top-level key:

- **Control:** `{ "op": "...", ... }`.
- **Game:** client to server `{ "m": <NetworkMessage>, "to"?: slot }`; server to client
  `{ "f": slot, "m": <NetworkMessage> }`, where `f` is the true sender slot stamped by the server.

The transport passes `f` as `onMessage`'s `transportSlot`, so existing checks hold: a guest's
`acceptsFromSender` still needs `HOST_SLOT` for host-authored types, as do the router's guards on
`goldenGooseState`, `scoreboardSync` and `rosterSync`. Relayed guest messages now carry their real origin
instead of `HOST_SLOT`; gameplay already reads `message.senderSlot`, so only the guest-side liveness stamp
changes (unused: the silence sweep is host only). Update the "two sender slots" gotcha when built.

### 5.2 Operations

| Op | Direction | Fields | Effect |
|---|---|---|---|
| `hello` | C to S, first frame | `proto`, `build`, `access`, `features` | Within 5 s of connect, else close 4003. |
| `ready` | S to C | `proto`, `serverTime`, `sessionToken` | Handshake accepted. The token (section 5.6) is for whatever this socket creates or joins. |
| `create` | C to S | `username`, `maxPlayers` | New room, sender is slot 0. |
| `created` | S to C | `code`, `slot: 0` | |
| `join` | C to S | `code`, `username`, `rejoinToken`, `features` | Section 4.2. |
| `joinRequest` | S to host | `slot`, `outcome`, `username`, `rejoinToken`, `features`, `peerId` | Host transport calls `onHostHello`. |
| `joinAnswer` | host to S | `slot`, `welcome` or `reject` | |
| `admitted` | S to host | `slot` | Host transport calls `onConnected(slot)`. |
| `rejected` | S to C | `reason`: `notFound`, `full`, `outdated`, `busy` | Then close 1000. Guest transport turns `full` and `outdated` into today's `roomFull` message plus close, `notFound` into `onError(..., 'roomNotFound')`. |
| `kick` | host to S | `slot` | Close that member (4010), mark reserved. |
| `memberLeft` | S to host | `slot` | `onPeerDisconnected(slot)`. |
| `expired` | S to host | `slot` | `onReservationExpired(slot)`. |
| `ping` | C to S | `n`, `t`, `rtt` (last measured, or null) | Echoed at once as `pong`. |
| `pong` | S to C | `n`, `t` | Client RTT = now minus `t`. |
| `quality` | S to C, every 2 s | `members: [{ slot, rttMs }]` | Section 6. |
| `roomClosed` | S to C | `reason`: `hostLeft`, `idle`, `expired`, `shutdown` | Then close 4004. |
| `leave` | C to S | | Graceful leave (a close the client chooses, 1000, 1001 or no code, does the same). |
| `resume` | C to S, in place of `create` or `join` | `sessionToken`, `lastSeq` | Take back an away member (section 5.6). |
| `resumed` | S to C | `sessionToken` | The resume worked: the next token, then the replay. |
| `ack` | C to S | `seq` | Every reliable frame up to `seq` arrived; the server forgets them. |
| `away` | S to C | `slot` | That member's socket dropped; the server holds its slot for a resume. |
| `back` | S to C | `slot` | It resumed (or a rejoin took its slot over). |

Reliable frames from the server carry `s`, their number for that member from 1, as the first key: every
game frame except the superseded state types (`playerSnapshot`, `gooseSnapshot`, `hordeGooseSnapshot`,
`bonusGooseSnapshot`), and every op except the ones bound to one socket (`ready`, `created`, `rejected`,
`pong`, `quality`, `roomClosed`, `resumed`).

Close codes: 4001 access denied, 4002 version mismatch, 4003 handshake timeout, 4004 room closed,
4008 rate limited, 4009 slow consumer, 4010 kicked, 4011 replaced by a rejoin, 4012 resume refused (one
code for every refusal), 4013 resume later (the right token, but the member still counts as connected); 1000
after `rejected` or a `leave`. The client closes a socket it gives up on to resume with 4000. The shell (`Member.ts`) also uses the standard ones: 1001 server shutting down (sockets not in a
room), 1003 a binary frame, 1008 a first frame that is not a hello, or a malformed hello, 1009 a frame
over the sender's size cap (7.4). A hello is checked in this order: protocol version (4002), the IP's
access block (4001; the code is not compared while blocked), the code (4001, counted as a failure).

### 5.3 Access control for an invite-only game

**Recommended: a shared access code**, typed once per player in the Multiplayer menu, kept in
`localStorage`, sent as `hello.access` (the client trims it; the server trims each configured code too). The server compares SHA-256 hashes with `crypto.timingSafeEqual`
against `HNG_ACCESS_CODES`, a comma-separated list in `/etc/hng-relay.env` (root, mode 600), so Gustav
rotates by adding a code, telling friends, then removing the old one. No database; never in the repo or
bundle (both public). Around it: the room code is a second secret; the `Origin` header must match
`HNG_ALLOWED_ORIGINS` (the Pages site, its previews, `http://localhost:5173` in dev), which stops other
websites but is no security boundary (comma separated exact origins; `https://*.hunter-n-goose.pages.dev`
matches one subdomain label, so previews pass; unset means the Pages site and its previews; a missing
`Origin` is refused); failed attempts are limited per IP (5 a minute, then 10 minutes
blocked). The runner-up, per-player tokens, wins only if a code keeps leaking or one person must be revoked.

### 5.4 Versioning

`hello.proto` (`SERVER_PROTOCOL_VERSION = 1` in `serverEnvelope.ts`) changes only when the envelope or a
server rule breaks compatibility; a mismatch closes with 4002 and the client says "The game was updated.
Refresh the page." `hello.build` (`GAME_VERSION`) is for logs. Compatibility inside a room stays with
`hello.features` and `helloSupportsMap`. Server and client ship from one repo, so a bump deploys both.

### 5.5 Heartbeat and liveness

- **Server side:** WebSocket protocol ping every 5 s through `ws`; no pong for 15 s terminates the socket.
  Browsers answer protocol pings below JavaScript, so a backgrounded tab is not dropped by this; game-level
  silence stays the host's job (`isOpponentSilent`), as today.
- **Client side:** application `ping` every 1 s for RTT; no frame at all for 6 s while visible means
  `serverLost` before the client is in a room, and starts a resume once it is (5.6).

### 5.6 Reconnection and resume (F1, as built 2026-11-17)

The initial connect retries 3 times (0.5 s, 1 s, 2 s, each plus up to 30 percent jitter), then the room
screens say "Couldn't reach the game server". Once in a room, a dropped socket is **resumed** within
**30 s**, for the host and for guests (section 1.1), and the game on every side never sees a disconnect. A
member that cannot resume still has today's rejoin path (Join with the same code: same rejoin token, same
slot, `welcome.activeMatch`).

**Session token.** `ready.sessionToken` is 16 bytes of `crypto.randomBytes` in base64url (22 characters),
one per socket. A `create` or `join` hands it to the room's member and the shell keeps no copy. It
authorises a resume of that member and nothing else. The server compares it with `timingSafeEqual` on
equal-length buffers (the token's 22 bytes) against each admitted member, never logs it, and replaces it on
every successful resume (`resumed.sessionToken`): the old one is dead at once.

**Numbering and keeping.** The server numbers each member's reliable frames (`s`, from 1; section 5.2) and
keeps each one until the member acknowledges it. Superseded state (`playerSnapshot` and the three goose
snapshots) is neither numbered nor kept: the next copy replaces it, and up to 24 horde geese at 6 a second
would fill the buffer in about ten seconds. `pong`, `quality` and the other one-socket ops are not kept
either. The client acknowledges with `ack { seq }` after every 64 numbered frames and once a second when
anything new arrived; an ack beyond the last frame sent is dropped and counted (`badAck`).

**Bounds.** At most **1536 frames or 768 KiB** of frame text kept per member (`RESUME_BUFFER_MAX_FRAMES`,
`RESUME_BUFFER_MAX_BYTES` in `serverEnvelope.ts`; about 30 s at 50 reliable frames a second). Past either,
the oldest kept frames go. For a live member that only limits how far back a resume can reach (one from
before the kept frames is refused); for an away member it **ends the resume window** at once.

**Away.** A live member with a token whose socket closes abnormally is away: no close frame (1006: a
dropped network, a missed heartbeat, a failed probe), or a client close code other than 1000, 1001 or none
(1005), and not a close the server chose (kick 4010, replacement 4011, rate limit, slow consumer, a frame
too big). It keeps its slot, role, token and kept frames; frames for it are kept, not sent; the others get
`away { slot }`. A `leave`, a kick, a replacement, a chosen close and a pending member leave as before.
After 30 s away a guest leaves as before (`memberLeft`, then the 90 s reservation and `expired`), and the
host leaving closes the room (`roomClosed hostLeft`, section 4.4). While the host is away the room stays
open: guests get `away { slot: 0 }` and play on (their world stands still, which Gustav accepted), the
guests still reach each other, and their frames for the host are kept for it.

**The resume.** A new socket sends `hello` (version, IP block and access code checked as for any socket),
then `resume { sessionToken, lastSeq }` in place of `create` or `join`, `lastSeq` being the highest frame
number it processed. The server answers `resumed { sessionToken }` with the next token, then the kept
frames after `lastSeq` in order, and tells the others `back { slot }`. The member keeps its slot, role,
room and rate limiter (reconnecting does not refill it); the guest 64 KiB and host 128 KiB frame caps apply
by slot as before, and the new socket counts against the per-IP connection limit and the lobby rate limit.

**Refusals.** An unknown, stale or reused token is refused with **4012**, which says nothing about whether
the room or slot exists, and counts as a failure for the IP under the access-failure policy (5 a minute,
then a 10 minute block) under its own key, so a right access code does not wipe failed resumes; a blocked
IP is refused 4012 before any token is compared. A right token whose `lastSeq` is before the kept frames
or beyond the last one sent ends the member (`memberLeft`) and is refused 4012, not counted. A right token
whose member still counts as connected (a half-open connection after a network change that the server has
not noticed yet) is refused **4013**, and the old socket is probed: a protocol ping, and no pong within 2 s
ends it as abnormal, so the client's next attempt succeeds. Two resumes racing for one slot: the first
replaces the token, so the second is an unknown token. A pending member's token resumes nothing.

**Client.** Once in a room (the host after `created`, a guest after its welcome) with a token, a socket
closed with a code that is not final, or 6 s of silence, starts a resume: the old socket is closed with
4000 and attempts follow after 250 ms doubling to 4 s, each shortened by up to 30 percent jitter, each with
4 s to reach `resumed`. Final codes never start one and are reported as before: 1000, 1003, 1008, 1009,
4001, 4002, 4004, 4008, 4009, 4010, 4011 and 4012 (an attempt closed with one gives up at once); 4013 and
anything else is retried. While reconnecting the silence rule and pings are off, `isConnectedTo` stays true
and `isReconnecting()` is true; game frames (superseded state aside) and the host's `joinAnswer` and `kick`
are queued within the same bounds (past them the resume ends) and sent after `resumed`. Numbered frames at
or below `lastSeq` are dropped as duplicates. After 30 s without success, or on a final refusal, the game
hears what a lost socket meant before: `onError(serverLost)` for the host, and for a guest too (the guest
cannot tell its own network from the host's; a `roomClosed` it receives still reads as the host leaving).

**Game.** `onPeerAway` and `onPeerBack` show "<name> reconnecting…" and "<name> is back" in the kill feed
and in the lobby screens' status line. The host's silence sweep skips away slots, and every slot while its
own transport reconnects, restarting their clock each sweep so the moment they are back counts from then.

**Known gap.** Client to server is not numbered: what a client wrote into a socket that was already dead
(until it noticed: at once on a close event, up to 6 s on silence) is lost; what it sends while
reconnecting is queued. Numbering the client's frames the same way (the server acknowledging, `resumed`
carrying the server's own last number) would close it, for the WP 11 audit to weigh.

### 5.7 JSON now, binary later: bandwidth

Measured with Node on this machine: a realistic `playerSnapshot` (`PlayerSnapshotMessage`: `type`,
`senderSlot`, `x`, `y`, `z`, `yaw`, `pitch`, `health`, `t`, `torch`; 8 numeric fields at full double
precision) is **201 bytes** of JSON; 207 bytes in a client frame, 213 in a server frame. Per message on the
wire add TLS 1.3 record (22), WebSocket header (2 down, 6 up with the mask) and TCP/IPv4 with timestamps
(52): about **287 bytes up and 289 down**. Snapshots go at `PLAYER_SNAPSHOT_SEND_INTERVAL` = 1/30 s.

| Players | Each client up | Each client down | Server in | Server out | Server sends a second | Server out per hour |
|---|---|---|---|---|---|---|
| 4 | 8.6 KB/s (69 kbit/s) | 26 KB/s (208 kbit/s) | 34 KB/s | 104 KB/s (0.83 Mbit/s) | 360 | 0.37 GB |
| 8 | 8.6 KB/s | 61 KB/s (486 kbit/s) | 69 KB/s | 486 KB/s (3.9 Mbit/s) | 1,680 | 1.75 GB |
| 16 | 8.6 KB/s | 130 KB/s (1.04 Mbit/s) | 138 KB/s | 2.08 MB/s (16.6 Mbit/s) | 7,200 | 7.5 GB |

Snapshots only. On top come `fireEvent` (241 bytes, about 10 a second while an automatic weapon fires),
footsteps, and the host's world traffic: `gooseSnapshot` is 109 bytes per live goose every
`GOOSE_SNAPSHOT_SEND_INTERVAL` (1/6 s); a big horde can outweigh the player snapshots (live goose count not
measured: UNVERIFIED). Today at 4 players without direct links the host's home upload carries 270 snapshot
messages a second (its own to 3 guests, each guest's to 2 others) plus every goose snapshot 3 times; with
the server every client uploads 30 and a datacenter fans out. Removing the host's uplink as the bottleneck
is the main reason to expect less lag and loss. Oracle's free egress (10 TB a month, UNVERIFIED) is ample.

**Decision: JSON in release 1.** Cheap steps first: (a) rounding on the sender (1 cm, 1 mrad, `t` to 0.1 ms)
gives **137 bytes** with no protocol change; (b) per-recipient batching per 16 ms tick removes most of the
76-byte per-message overhead for up to one tick of delay. A binary snapshot (about 24 bytes) plus batching
brings 16 players to about 14 KB/s down per client instead of 130: do it only with the rooms-over-8 work.

## 6. Latency and quality

### 6.1 Replacing connectionStats

`readConnectionQuality` (`connectionStats.ts`) reads `RTCPeerConnection.getStats`; server mode has no peer
connection. Replacement:

1. Each client measures its RTT to the server from `ping`/`pong` (weighted average, alpha 0.2, plus mean
   absolute deviation as jitter) and reports it in its next `ping`; the server clamps it (0 to 5000) and
   broadcasts `quality` every 2 s.
2. `ServerTransport.connectionQuality()` returns, per other slot, `combineRelayedQuality(own, theirs)` (it
   already sums two legs) with a new route `'server'`; `formatConnection` and `formatOpponentPings` print no
   suffix for it, so the HUD still reads "Ping 42 ms" and the e2e regex `/^Ping \d+ ms/` holds.
3. `summarizeConnection` is unchanged: lead = RTT / 2000, which for opponent B seen by A is
   (rttA + rttB) / 2000, the one-way delay of B's snapshot through the server: what
   `RemotePlayer.setLeadSeconds` wants (capped at `MAX_LEAD_SECONDS`, 0.12 s). The poll in
   `Game.updateMultiplayer` and the HUD wiring do not change.

### 6.2 GuestMesh and direct links

**Recommendation: unused in server mode, deleted when P2P retires** (stage 3, section 10).
`ServerTransport` never builds `GuestMesh`; the server drops mesh types. `directLinks.ts` (`MeshRelayPolicy`,
`DuplicateEventFilter`) and `stampDirectEvent` exist only because an event could arrive twice; one server
path removes that. `fastChannel.ts` stays if the WebRTC follow-up (7.1) goes ahead: its probe logic is the pattern.

**Cost of the lost direct path.** Two Johannesburg players lose almost nothing; two Cape Town players go
via Johannesburg and back. Rough RTTs to a Johannesburg datacenter, UNVERIFIED estimates to measure in
stage 1: Gauteng 5 to 15 ms, Durban 10 to 20 ms, Cape Town 20 to 35 ms, so two Cape Town players might see
40 to 70 ms instead of 10 to 20 ms direct. Against that, today's guest traffic often crossed the host's home
line (no mesh link), and blocked networks went through Metered TURN, likely outside South Africa (UNVERIFIED).

## 7. Server internals

### 7.1 Transport decision: WebSocket only in release 1

**Decision: release 1 is reliable WebSocket on 443 for everything. The unreliable WebRTC leg for
snapshots is follow-up F2, built only if measurements call for it.**

Why defer it:
- **Complexity.** A server WebRTC peer needs a native library: `node-datachannel` (libdatachannel bindings)
  or geckos.io (built on it). ARM64 Linux prebuilds are likely but UNVERIFIED; a source build needs CMake on
  the VM. A native addon in a public, input-facing process also widens the security audit.
- **Networking.** A UDP port range must open in the Oracle security list and the host firewall, and the VM
  sits behind Oracle's 1:1 NAT, so the server must advertise its public IP in ICE candidates. TLS is not the
  issue: WebRTC uses DTLS with self-signed certificates checked by fingerprint, signalled over the wss socket.
- **Value is uncertain.** TCP's weakness is head-of-line blocking: one lost packet holds later messages
  until resent. On a 20 to 40 ms path with a steady 30 Hz stream, fast retransmit usually recovers in about
  60 to 120 ms; the worst case is the 200 ms minimum retransmission timeout. `RemoteMotion` extrapolates
  for up to `STALE_MS` (250 ms), so a rare stall is a small correction, not a freeze. Stage 1 measures how rare.
- **Mitigation in WebSocket mode:** latest-wins skipping: above 64 KiB buffered for a recipient (the
  `FastChannel` threshold) the server skips `playerSnapshot` frames to it and keeps reliable ones.
  `TCP_NODELAY` must be on. Checked in `ws` 8.22.0 (the pinned version): `lib/websocket.js`, `setSocket`,
  calls `socket.setNoDelay()` on every socket it takes over. `server/main.ts` also calls
  `socket.setNoDelay(true)` on upgrade, so a future `ws` cannot silently drop it. Caddy is Go, whose TCP
  sockets default to no delay.

**When the runner-up wins:** stage 1 telemetry shows over 1 percent of snapshot gaps above 150 ms on real
connections, or mobile and Wi-Fi players report stutter the TCP path explains. Then F2 adds a
`FastChannel`-style leg (offer and answer over the wss socket, negotiated unordered channel,
`maxRetransmits: 0`, probe then use, snapshots only, automatic fallback). The `Transport` interface stays.

### 7.2 Process layout and libraries

- One Node.js process, one thread: 7,200 small sends a second at 16 players fits one core; rooms live in
  memory, so clustering would only add cross-process routing.
- Node with TypeScript type stripping on by default (from 22.18 and 23.6 as far as I know: UNVERIFIED;
  else `--experimental-strip-types`). This laptop runs Node 24.13.0. The shared files use only erasable
  syntax (no enums or namespaces found); `server/` keeps that rule (no enums, no parameter properties).
- Dependencies: `ws` only (pure JavaScript, fine on ARM64; skip optional native `bufferutil`); dev
  `@types/node`, `@types/ws`. Pinned in `server/package.json`: `ws` 8.22.0, `@types/node` 24.19.2,
  `@types/ws` 8.18.2 (8.22.1 was five days old when built; the rule is versions at least two weeks old).
  `server/tsconfig.json` checks the server and the shared files without DOM (`npm run typecheck` runs it).
- Layout, with a socket-free core so it is unit testable and portable:

| File | Role |
|---|---|
| `server/main.ts` | Reads config, starts `http` on `127.0.0.1:${HNG_PORT}` (default 8080), upgrades `/ws`, serves `GET /healthz`. |
| `server/config.ts` | Parses env vars, fails fast on a missing `HNG_ACCESS_CODES`. |
| `server/RoomRegistry.ts` | Codes, create, lookup, tombstones, cleanup timer. |
| `server/Room.ts` | Members, `HostRoster`, admission flow, routing (`routing.ts`), `serverAccepts`, quality broadcast. Talks to members through a `MemberSocket` interface `{ send(text), close(code, reason), bufferedAmount }`. |
| `server/Member.ts` | Wraps a `ws` socket: handshake (hello deadline, version, access block and code), one room per socket, the guest frame cap, lobby rate limit, protocol ping and pong. |
| `server/clientIp.ts` | The client address: the socket's, or the last `X-Forwarded-For` entry only when the peer is 127.0.0.1 (Caddy); IPv6 grouped by /64 for the per-IP limits. |
| `server/limits.ts` | Token buckets, per-IP counters. |
| `server/log.ts` | JSON lines to stdout. |
| `server/*.test.ts` | Vitest, Node environment. |

### 7.3 Logging

JSON lines on stdout into journald (`SystemMaxUse=200M`): connect (IP), handshake result, room open and
close (code, reason, lifetime), join, admit, reject, leave, kick, rate-limit drops (per minute), slow-consumer
closes, errors. Never payloads or the access code: `log.ts` takes only flat fields, redacts keys that
would carry a payload or a secret (`access`, `token`, `m`, `payload`, `welcome` and the like) and cuts every
string at 120 characters; `server/log.test.ts` and `server/main.test.ts` check it. `/healthz` returns `{ ok, version, uptimeS, rooms, members }`.

### 7.4 Limits per connection

| Limit | Value | Why |
|---|---|---|
| Frame size | guest 64 KiB, host 128 KiB (`ws` `maxPayload` is 128 KiB; `Member.ts` refuses a frame above 64 KiB from anyone but a room's host, close 1009) | The largest legitimate frame is the host's `joinAnswer` with a mid-match welcome: roster, scoreboard, 4096-character door and breaker strings, and up to 4096 `valleyDoors` and 4096 `deadLamps` ids (`isNetworkMessage` bounds both lists at `WORLD_WIRE_MAX_ENTRIES`, 4096, in a `welcome` as in a `worldObjectState`). With ten-digit ids that is about 100 KiB, above 64 KiB, hence the host's cap. `serverEnvelope.test.ts` builds the largest legal welcome and checks it fits 128 KiB (and not 64 KiB). |
| Handshake deadline | 5 s | Close 4003. |
| Guest rate | 150 frames/s sustained, burst 300; 64 KB/s | 30 snapshots, about 10 shots, footsteps, events. |
| Host rate | 800 frames/s sustained, burst 1600; 512 KB/s | Goose and horde snapshots per live goose, sync bursts (`sendFullSync`). |
| Over the rate | drop and count; over for 10 s in a row: close 4008 | "10 s in a row" means 10 consecutive whole seconds (counted from the member's start), each with at least one dropped frame. Byte buckets hold 2 s of the byte rate as their burst. "KB" in this table is read as KiB. Release 1 enforces generous caps and logs any member above 50 percent, to tighten after real matches. |
| Slow consumer | skip snapshots above 64 KiB buffered; close 4009 above 4 MiB | Snapshots here are the superseded state types of section 5.6. |
| Resume buffer | 1536 frames or 768 KiB of frame text per member, unacknowledged reliable frames only | Section 5.6. Overflow while away ends the 30 s window. A reconnecting client queues within the same bounds. |
| Failed resumes per IP | the access-failure policy below, counted under its own key | A right access code does not clear them. |
| Connections per IP | 8 | A household behind one address. |
| Access failures per IP | 5 a minute, then 10 minute block | |
| Rooms | `HNG_MAX_ROOMS`, default 50 | |

### 7.5 Memory per room

Per room: at most `capacity` members, a `HostRoster` (hundreds of bytes), limiter and RTT state, and socket
buffers (normally a few KB, capped at 4 MiB). Well under 100 KB per room plus Node's baseline of about 50 MB;
even Oracle's 1 GB AMD micro instance would do. `MemoryMax=512M` in systemd guards against a leak.
Resume (5.6) adds each member's unacknowledged reliable frames: about a second's worth while connected
(acknowledged every second or 64 frames), at most 768 KiB of frame text while away or when a client never
acknowledges. JSON frames are ASCII, which V8 keeps one byte a character, so the worst case is about 3 MB
per 4-player room and 150 MB at 50 rooms, all members away at once; inside `MemoryMax`.

### 7.6 Crash and restart

systemd restarts within 1 s; in-memory rooms are lost. Every socket closes, without a close frame, so
clients in a room try to resume (5.6): the restarted relay refuses their tokens (4012) and they give up at
once, or after 30 s if it stays down. Then every transport fires `onError(..., 'serverLost')` and Game.ts
ends the match, the host's too (a small new branch: the host ignored `onError` before); lobbies say "Lost the game server. Create or join the room again." A new
`MultiplayerMatchEndReason` `'serverLost'` words the podium. Deploys wait for zero rooms (8.3).

## 8. Deployment on the Oracle free VM

### 8.1 Hostname and TLS (the page is https, so the socket must be wss)

| Option | Cost | Gustav provides | Verdict |
|---|---|---|---|
| **DuckDNS subdomain + Caddy with Let's Encrypt on the VM** | free | DuckDNS login (GitHub or Google), a subdomain name, the DuckDNS token (stays on the VM) | **Fallback** (Gustav owns a Cloudflare domain, decided 2026-11-05). No domain to buy, automatic certificates and renewal, IP changes handled by a 5-minute update job. |
| Own domain on Cloudflare, proxied, with a Cloudflare Origin CA certificate on the VM (or Caddy with Let's Encrypt; choose in WP 0) | free (domain already owned) | the domain and a relay subdomain name (to be confirmed in the other session) | **Recommended since 2026-11-05.** Hides the VM's IP behind Cloudflare and adds DDoS shielding. Adds a Cloudflare hop (local Johannesburg presence, small cost). WebSockets work through the free proxy (UNVERIFIED for long-lived sockets during Cloudflare edge restarts). |
| `sslip.io` name (IP embedded) + Let's Encrypt | free | nothing | Fallback if DuckDNS is down at setup. The name changes with the IP. Let's Encrypt rate limits for this shared domain are UNVERIFIED. |
| Cloudflare quick tunnel (`trycloudflare.com`) | free | nothing | No: random URL per start, not for production. |

Caddyfile in full: `hng-relay.duckdns.org { reverse_proxy 127.0.0.1:8080 }` (certificate via HTTP-01 on 80
or TLS-ALPN on 443; WebSocket upgrades pass through). The relay URL is a committed constant `RELAY_URL` in
`src/core/config.ts`: `npm run deploy` builds locally, so Pages dashboard variables never reach the bundle
(they feed Functions only). A `?relay=` override works only in dev builds, so no link can redirect players.

### 8.2 Build and run, in outline

1. Oracle account with **home region Johannesburg** (`af-johannesburg-1`): Always Free Ampere runs only in
   the home region, fixed at sign-up (UNVERIFIED in detail). Sign-up asks for a card to verify identity
   without charging it (widely reported, UNVERIFIED).
2. Instance `VM.Standard.A1.Flex`, 2 OCPU, 12 GB, Canonical Ubuntu 24.04 aarch64, reserved public IPv4
   (free allowance UNVERIFIED), SSH key only.
3. Security list: TCP 80 and 443 from anywhere, TCP 22 from Gustav's address only. Oracle's Ubuntu images
   also ship iptables rules that block all but SSH: open 80 and 443 there and persist them (known gotcha;
   check `sudo iptables -L INPUT`).
4. Install Node (official arm64 build or NodeSource), Caddy (its apt repository), `unattended-upgrades`.
5. User `hng` without login. `/opt/hng-relay` holds a sparse checkout of the public repo (`server/`,
   `src/network/`, `src/core/config.ts`, `src/core/version.ts`, `src/combat/grenades/grenadeTuning.ts`);
   `npm ci --omit=dev` in `server/`.
6. `/etc/hng-relay.env` (root, mode 600): `HNG_ACCESS_CODES`, `HNG_ALLOWED_ORIGINS`, `HNG_PORT=8080`,
   `HNG_HOST=127.0.0.1` (the default; Caddy is in front), `HNG_MAX_ROOMS`, `HNG_MAX_PLAYERS_PER_ROOM=4`,
   `HNG_LOG_LEVEL`. `server/config.ts` fails fast with a message naming any malformed variable.
7. systemd `hng-relay.service`: `User=hng`, `EnvironmentFile=/etc/hng-relay.env`, `ExecStart=/usr/bin/node
   /opt/hng-relay/server/main.ts`, `Restart=always`, `RestartSec=1`, `MemoryMax=512M`, plus `NoNewPrivileges`,
   `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`.
8. DuckDNS: root cron every 5 minutes calls the update URL with the token from a root-only file.
9. All of it lives in `server/deploy/` (`setup.sh`, unit, Caddyfile, `deploy.sh`), so a lost VM is rebuilt
   from a fresh instance in about half an hour.

### 8.3 Updates

`server/deploy/deploy.sh` (run from Gustav's machine over SSH): pull, `npm ci --omit=dev`, wait until
`/healthz` shows `rooms: 0` (or `--force`), `systemctl restart hng-relay`, check `/healthz`. OS security
updates install unattended; automatic reboots at 04:00 SAST.

### 8.4 Idle reclamation (honest status)

Oracle may reclaim Always Free compute it judges idle. As I understand the rule (UNVERIFIED: read Oracle's
"Always Free Resources" page first): over 7 days, 95th percentile CPU, network and (Ampere) memory all
under 20 percent. A relay for a few friends meets all three, and whether Oracle warns by email first is
UNVERIFIED. Options: (1) **accept the risk and stay rebuildable** (`setup.sh`, DuckDNS follows the new IP):
recommended first, zero cost and no terms risk; (2) upgrade to Pay As You Go, reported to exempt Always Free
resources from reclamation at no cost within the limits (UNVERIFIED), but a card on file can be charged by
mistake (set a USD 1 budget alert): Gustav's call after a first reclaim; (3) fake CPU load: not recommended,
it may break Oracle's terms.

### 8.5 Monitoring

A free external uptime check on `GET /healthz` (UptimeRobot free tier, every 5 minutes, terms UNVERIFIED)
emails Gustav; `journalctl -u hng-relay` and `server/deploy/status.sh` (health, memory, last 50 log lines)
over SSH; Oracle's console metrics show CPU and network, and how close the VM is to the idle thresholds.

### 8.6 Fallback hosting if Johannesburg Ampere capacity is unavailable

Ampere A1 is often reported "out of host capacity" in busy regions (UNVERIFIED for Johannesburg now). In order:

1. **Oracle `VM.Standard.E2.1.Micro`** (AMD, 1/8 OCPU, 1 GB), same region, also Always Free and enough for
   this relay; same setup on x86_64. Retry A1 later and move.
2. **Gustav's own always-on machine** with DuckDNS, Caddy and a port forward for 80 and 443: free and local,
   but fails behind carrier-grade NAT (common on South African LTE and some fibre), and the home uplink
   carries the fan-out (0.8 Mbit/s at 4 players).
3. **Cloudflare Durable Objects** (free Workers plan): the pure `Room` core ports to one. Not plain Node;
   quotas count WebSocket messages; where it runs for South African players (maybe Europe, 150 ms or
   more) is UNVERIFIED. Last resort.
4. A paid South African VPS breaks the zero budget; listed so the code stays portable to it.

## 9. Client changes by file

| File | Change | Size |
|---|---|---|
| `src/network/transport.ts` (new) | `Transport`, `TransportCallbacks`, `HostHelloRequest`, `TransportErrorKind`, `NETWORK_BLOCKED_MESSAGE` (moved), factories that pick P2P or server. | S |
| `src/network/ServerTransport.ts` (new) | WebSocket client: handshake, create and join, frame encode and decode, control ops to callbacks, ping and RTT, `quality`, `connectionQuality`, `kick`, connect retries. | L |
| `src/network/serverEnvelope.ts` (new, shared) | Frame and op types, `SERVER_PROTOCOL_VERSION`, parse and validate helpers used by both ends. | S |
| `src/network/routing.ts` (new, shared) | `RELAYABLE_MESSAGE_TYPES` (moved), `GUEST_TO_HOST_TYPES`, `DROPPED_TYPES`, `routeClassOf(type)`, exhaustive test. | S |
| `src/network/protocol.ts` | Export `ALL_MESSAGE_TYPES` and `PLAYER_SLOT_COUNT`; use the constant in `isPlayerSlot`, `isSlot`, `scoreboardSync` length. | S |
| `src/network/senderAuthority.ts` | `serverAccepts`. | S |
| `src/network/HostRoster.ts` | Options `{ capacity, graceMs }`, `adopt`, `release`. | S |
| `src/network/PeerConnection.ts` | `implements Transport`; `onHostHello` takes the request object; drop `sendExcept`. | S |
| `src/network/MatchMessageRouter.ts` | Import and re-export `RELAYABLE_MESSAGE_TYPES` from `routing.ts`; comment updates. | S |
| `src/network/connectionStats.ts` | Route `'server'` and its formatting. | S |
| `src/network/MultiplayerSession.ts`, `src/ui/matchEndScreen.ts`, `src/core/App.ts` | `PeerConnection` type becomes `Transport`. | S |
| `src/core/Game.ts` | `onHostHello` request shape and `adopt`; `onReservationExpired` follow-up; host branch for `serverLost`; skip the host sweep in server mode; `getNetworkDebug` adds `transport`. | M |
| `src/core/gameDebugApi.ts` | `transport: 'p2p' \| 'server'` in `getNetworkDebug`. | S |
| `src/ui/menu/CreateRoomScreen.ts` | "Game server" toggle; code arrives from the server; `adopt` path; expiry callback replaces its sweep interval in server mode; server error texts. | M |
| `src/ui/menu/JoinRoomScreen.ts` | Automatic routing (section 10.2); new error texts (access denied, refresh to update, server unreachable). | M |
| `src/ui/menu/MultiplayerMenu.ts` | Access code field, stored in `localStorage` (wrapped in try and catch). | S |
| `src/core/config.ts` | `RELAY_URL`, `DEFAULT_NETWORK_TRANSPORT`, relay timeouts. | S |
| `src/core/multiplayerRejoin.ts` | None: tokens stay per room code in `sessionStorage`. | none |
| Senders (`createMatchPickups.ts`, `grenadeNetwork.ts`, mode controllers, `facilityInteraction.ts`) | None: they call `send` and `sendTo` on the session, which the interface keeps. | none |
| PeerJS and ICE (`buildIceServers`, `DEFAULT_ICE_SERVERS`), `GuestMesh.ts`, `directLinks.ts`, `peerjs` in `package.json` | Untouched until stage 3, then deleted with their tests. | M (stage 3) |
| `functions/api/turn-credentials.ts` and the Pages variables `METERED_API_KEY`, `METERED_APP_NAME` | Untouched until stage 3, then deleted and the variables removed from the Pages dashboard. | S (stage 3) |
| `functions/api/telemetry.ts` | Optional fields for the comparison (section 10.3). | S |
| CSP and CORS | No CSP exists today (no `public/_headers`, no meta tag: checked), so nothing to change; if one is added, `connect-src` must list the wss host. WebSockets are not subject to CORS; the server checks `Origin` itself. | none |
| `server/**` (new) | Section 7.2, plus `server/package.json`, `server/tsconfig.json`, `server/deploy/`. | L |
| `package.json` | Scripts `relay:dev` and `typecheck` adding `tsc -p server`; dev types. (A `package.json` change triggers the full e2e suite under `scripts/e2eGroups.mjs`: batch it with work that needs that anyway.) | S |
| `vitest.config.ts` | Include `server/**/*.test.ts`. | S |
| `playwright.config.ts` | A second `webServer` that starts the relay with a test access code when `E2E_TRANSPORT=server`. | S |
| `scripts/e2eGroups.mjs` and its test | Rule: `^server/` maps to `mp` and `mp4`. | S |
| `e2e/helpers.ts`, `multiplayer-match.spec.ts`, `multiplayer-four.spec.ts` | Seed the transport setting and access code; make the `fastChannelsReady` and `directLinksReady` assertions depend on `getNetworkDebug().transport`. | M |
| Docs | `multiplayer-and-modes.md` (topology, two sender slots, checklist step), `testing.md`, `ARCHITECTURE.md`, as-built `docs/server-relay.md`, `CHANGELOG.md`, `version.ts` (the scheme in `version.ts` suggests a major bump for an architecture shift: Gustav's call). | M |

The room code format does not change (section 4.1).

## 10. Rollout and rollback

### 10.1 Stages

| Stage | What players see | Exit criterion |
|---|---|---|
| 0, dark | Server deployed; only the harness and Gustav use it (dev override). | Harness green against the VM from Gustav's machine; `/healthz` up 3 days. |
| 1, opt-in | Create Room shows "Use game server (beta)", default off. Players enter the access code once. | 5 play sessions with no server-caused failure; comparison data (10.3) collected. |
| 2, default | Toggle default on (`DEFAULT_NETWORK_TRANSPORT = 'server'`), P2P still selectable. | 2 to 3 weeks without a reason to switch back; Gustav's yes. |
| 3, retire | P2P code, PeerJS, Metered function and variables removed. | |

### 10.2 How a player is routed

The **host chooses** the transport when creating the room; guests need no setting. `JoinRoomScreen` asks
the server first (when an access code is stored) with a 2 s budget, and on `notFound` or no answer falls
back to today's PeerJS join with the same code. A guest without an access code goes straight to PeerJS and,
on failure, is told the room may need the code. (A server code equal to a live P2P code is a 1 in 887
million event per pair; ignored.)

**Rollback:** set `DEFAULT_NETWORK_TRANSPORT = 'p2p'` and `npm run deploy` (minutes). Stopping the server
cannot break P2P: its only server dependency is the 2 s lookup, which falls through.

### 10.3 Comparing ping before and after

Extend the match telemetry beacon (`Game.sendMatchTelemetry` to `functions/api/telemetry.ts`, kept only if
the `MATCH_TELEMETRY` KV namespace is bound, which Gustav must do in the Pages dashboard) with optional
`transport`, `players`, `pingP50`, `pingP95` (HUD RTTs), `snapshotGapP95` and `stallsPerMin` (gaps above
150 ms between applied snapshots, counted in the router's `playerSnapshot` case) and `joinMs`. Play the same
group on one evening, alternating P2P and server rooms. Success: equal or lower `pingP95` for most pairs,
fewer stalls, no failed joins.

## 11. Test plan (nothing run for this design)

**Unit (Vitest, Node environment):**
- `routing.test.ts`: every one of the 63 types has exactly one class; R equals the old relay set.
- `senderAuthority.test.ts`: `serverAccepts` for host and guest senders, spoofed `senderSlot`, self-slot types,
  `playerDied` victim rule.
- `HostRoster.test.ts`: capacity option, `adopt`, `release`, derived guest slots.
- `server/Room.test.ts` with fake `MemberSocket`s: create; join; full; outdated; host answer timeout; token
  takeover closes the old socket; reservation and expiry; kick; host leaves closes the room; pending member
  gets nothing; `to` from a guest is dropped; slow-consumer snapshot skipping.
- `server/limits.test.ts`, access code comparison, envelope parsing (malformed JSON, wrong types, oversize).
- Import-graph test (section 3.3) and the largest-legal-welcome size test (section 7.4).
- `ServerTransport.test.ts` with a fake socket: op to callback mapping, `rejected` translations, quality maths.

**Headless harness** (`scripts/relay-harness.mjs`, Node's built-in WebSocket client): starts the server
in-process on a random port (or targets a URL), opens N clients, runs create, join, ready, a synthetic match
at 30 Hz with shots and host goose snapshots, a rejoin, a kick and a host leave, and reports latency (one
clock), loss and order violations (both must be zero) and server CPU, at N = 4, 8 and 16 (8 and 16 with
`PLAYER_SLOT_COUNT` raised in a scratch branch).

**Loss and latency:** Linux `tc netem` (say 30 ms delay, 10 ms jitter, 1 to 3 percent loss) on the VM or
another Linux machine while the harness records snapshot gaps: the evidence for or against F2. On Windows
the free tool clumsy can impair a real browser (loopback and WSL2 netem support UNVERIFIED).

**Playwright groups affected** (`scripts/e2eGroups.mjs`): `mp` (six `multiplayer*.spec.ts`), `mp4` (triggered
by `PeerConnection`, `HostRoster`, `MatchMessageRouter`), `facility` (`multiplayer-facility.spec.ts`), `ui`
and `quick` (room screens, menu), and `core`, `mission`, `facility`, `grenades` through the `Game.ts` rule.
Changes to `package.json`, `playwright.config.ts` and `e2e/helpers.ts` trigger the full suite once (the
`vitest.config.ts` change triggers nothing). Run `mp` and `mp4` in both modes (`E2E_TRANSPORT=p2p` and
`server`), one group at a time per `docs/testing.md`; ask Gustav before a plan covering nearly every group.

**Not testable locally:** real South African routes to Oracle Johannesburg, mobile networks and carrier-grade
NAT, Oracle reclamation and capacity, Let's Encrypt and DuckDNS, multi-day stability, and real frame rates
at 8 or 16 players (the e2e machine runs about 2 FPS on SwiftShader).

## 12. Risks and open questions

### 12.1 Top three

1. **The free VM is not guaranteed.** Johannesburg Ampere capacity, idle reclamation, the home-region rule
   and the card at sign-up can each block or end it. Mitigation: AMD micro fallback, scripted rebuild,
   DuckDNS following the IP, P2P kept until stage 3.
2. **Two single points of failure instead of one.** The host still simulates, and now a server crash,
   deploy or reclaim also ends every match; a host Wi-Fi blip still ends it in release 1. Mitigation:
   deploys wait for zero rooms, systemd restarts, and F1 (resume) as the first follow-up.
3. **A public server taking input from anyone:** floods, oversized frames, slot spoofing, access code
   guessing or leaks. Mitigation: section 7.4 limits, `serverAccepts`, constant-time hashed code checks,
   per-IP limits, no secrets in the repo, systemd hardening. **This is security-sensitive code under
   Gustav's rules: the build needs an independent Opus audit plus one re-check of its fixes, and tests that
   prove each safety property (rate limits, sender checks, size caps, access refusal, host-only ops).**

### 12.2 The rest, ranked

4. TCP head-of-line stalls on lossy links make opponents stutter. Measure in stage 1; F2 if needed.
5. Some pairs get slower (two Cape Town players through Johannesburg). Measure; accept or revisit.
6. Two transports side by side double the multiplayer code paths and e2e load. Time-box stage 3.
7. Routing drift: an unclassified new type is dropped by the server; the exhaustive test catches it.
8. DuckDNS outage or Let's Encrypt limits during setup (fallback: an `sslip.io` name); Node version drift
   on the VM (pin the major in `setup.sh`, check it in `deploy.sh`).
9. Unknown extra fields are forwarded (bounded by 64 KiB). Accepted for a private game.

### 12.3 Questions for Gustav (answered 2026-11-05, see section 1.1; question 3 deferred)

1. Do you already have an Oracle Cloud account, and if so, which home region? (If not Johannesburg, the
   plan changes before anything is built.)
2. Do you own a domain already on Cloudflare? (If yes, use it instead of DuckDNS.)
3. Is a host drop ending the match acceptable for release 1, with resume (F1) right after?
4. Are you fine entering a card at Oracle sign-up for identity checks, and with Pay As You Go only if the VM
   is ever reclaimed?
5. Who gets the access code, and how will you share and rotate it?

## 13. Build plan

In dependency order. S under half a day, M a day or two, L several days. Routing per Gustav's rule 1:
level 2 work to Codex (or Sonnet), security-sensitive server code to Opus, Haiku or Grok for lookups only.

| WP | Work | Depends on | Size | Who | Done when |
|---|---|---|---|---|---|
| 0 | Gustav: Oracle account (home region Johannesburg) and VM, a Cloudflare DNS name for the relay on his existing domain, the host-drop decision (12.3 question 3) | none | human | Gustav | SSH works; the relay name resolves to the VM. |
| 1 | Shared extraction: `routing.ts` (with the exhaustive test), `ALL_MESSAGE_TYPES`, `PLAYER_SLOT_COUNT`, `serverAccepts`, `HostRoster` options, `adopt`, `release` | none | S | Codex `gpt-6.1-sol` medium, or Sonnet | `npm run typecheck` and `npm run test:unit` pass; router re-exports the relay set. |
| 2 | `Transport` interface; `PeerConnection implements Transport`; retype `MultiplayerSession`, `App`, room screens, `matchEndScreen`; `onHostHello` request object | 1 | M | Codex or Sonnet | typecheck, unit tests, then e2e `mp` and `mp4` green on P2P (behaviour unchanged). |
| 3 | Server core: `Room`, `RoomRegistry`, admission flow, routing, limits, access check, with unit tests | 1 | L | Opus, high effort (security-sensitive) | `npx vitest run server` green; every test of section 11 for the core exists. |
| 4 | Server shell: `main.ts`, `ws` wiring, handshake, heartbeat, `/healthz`, config, logging, `server/tsconfig.json`, import-graph test | 3 | M | Opus (or Sonnet with the Opus audit) | `npm run relay:dev` starts; `tsc -p server` clean; import-graph test green. |
| 5 | Headless harness | 4 | M | Codex or Sonnet | `node scripts/relay-harness.mjs --players 4` reports zero loss and zero order violations. |
| 6 | `ServerTransport` and its unit tests | 2, 4 | L | Opus medium (the design is written; it parses server input) | Unit tests green; harness can drive it with a fake socket. |
| 7 | Host and guest adaptation: `Game.ts` (expiry, `serverLost`, sweep switch), room screens (server code, toggle, routing, texts), access code field, config | 6 | M | Sonnet; UI checked with Gustav's rule 10 skills (`/web-design-guidelines`, `site-qa`) | **Milestone 1** (below) passes. |
| 8 | Quality: `ping`/`pong`, `quality`, route `'server'`, HUD text | 6 | S | Codex | Unit tests; HUD shows "Ping N ms" in a server match. |
| 9 | e2e support: relay `webServer`, `E2E_TRANSPORT`, mode-aware assertions, `e2eGroups` rule | 7 | M | Sonnet | `mp` and `mp4` green in both modes (run one group at a time). |
| 10 | Deployment kit: `server/deploy/` (setup, unit, Caddyfile, deploy, status) | 4, 0 | M | Sonnet, reviewed by Opus with the server | Fresh VM to green `/healthz` over https by running `setup.sh`; harness passes against the VM. |
| 11 | Independent Opus audit of `server/`, `ServerTransport`, `serverEnvelope`, deploy kit; one re-check of fixes | 3 to 10 | M | Opus high, a session that did not write the code | Audit findings fixed and re-checked; tests prove each safety property. |
| 12 | Telemetry fields for the comparison | 8 | S | Codex | Beacon carries the new fields in a Pages preview. |
| 13 | Stage 1 release (opt-in): docs, CHANGELOG, version, deploy client and server | 9, 10, 11 | S | main session | Gustav's first opt-in session works. |
| 14 | Stage 3: remove P2P, PeerJS, Metered function and variables, mesh and fast channel (unless F2), their tests and docs | stage 2 exit | M | Codex or Sonnet | typecheck, unit, `mp` and `mp4` green on server only. |

Safe for cheaper models: 1, 2, 5, 8, 9, 12, 14 (contained, pattern exists, a runnable done-when check).
Keep on Opus: 3, 4, 6, 11, and the review of 10.

**Milestone 1, the smallest end-to-end proof:** in dev (`npm run relay:dev` plus `npm run dev`), two
windows: the host creates a room through the server, the guest joins by code, both ready, a Default match
starts on the Valley, each sees the other move and take damage, the guest leaves and rejoins mid-match with
its score, and the HUD shows a ping. Needs WP 1 to 4 and 6 to 8 (only what that path touches). Done when
`e2e/multiplayer-match.spec.ts` passes with `E2E_TRANSPORT=server` and the harness passes at 4 players.

**Follow-ups after release 1:** F1 resume within 10 s (M, Opus); F2 WebRTC unreliable leg, only on
measured need (L, Opus); F3 sender rounding then binary and batched snapshots (S then M); F4 host promotion,
better done inside Phase B (L). (F1 moved into release 1 with a 30 s window: section 1.1.)

### 13.1 Build status (as built, 2026-11-17)

**Milestone 1 reached on 2026-11-05** (branch `feature/server-relay`, not merged or deployed). WP 1 to 8 are
built and committed, plus the part of WP 9 Milestone 1 needs. Evidence: `node scripts/relay-harness.mjs
--players 4` zero loss and zero order violations; `e2e/multiplayer-match.spec.ts` with `E2E_TRANSPORT=server`
passed (P2P control passed too); `node scripts/relay-menu-qa.mjs` 15 of 15 in a real browser; unit tests for
`src/network`, `src/ui`, `src/core` and `server` green. Gustav played a server match in two browsers on
2026-11-05: gameplay worked.

**Built differently from the design above (code is right):**
- `RELAY_URL` and `DEFAULT_NETWORK_TRANSPORT` live in `src/network/relaySettings.ts`, not `config.ts`: `config.ts`
  is shared with the Node relay, where Vite's `import.meta.env` does not exist. Production `RELAY_URL` is `''`
  until WP 10, which hides every server control. Dev builds also read a relay URL override from `?relay=` or
  localStorage `fps-game-dev-relay-url` (the e2e config uses the latter).
- Section 10.2's 2 s server lookup is not built. A join tries the server first and falls back to P2P on
  `roomNotFound`, `serverLost`, `accessDenied` or `versionMismatch`, inside the 25 s join timeout. A refused or
  outdated access code falls back too, so a stale stored code never blocks P2P rooms (found in QA).
- The access code field sits in the Multiplayer menu; the "Game server" checkbox on Create Room shows only
  when a code is stored, re-creates the room when changed, and locks once a guest has joined.
- `ServerTransport`: 4 connect attempts in all (one try plus three retries), each capped at 4 s; a kicked
  (4010) or replaced (4011) guest reports the host as disconnected, as on P2P.
- E2E: `E2E_TRANSPORT=server` starts a relay on `E2E_PORT + 1000` with a throwaway local access code.

**F1 resume built on 2026-11-17** (branch `feature/relay-resume`, from `feature/server-relay`); section 5.6
describes it as built. Evidence: unit tests only, `server/resume.test.ts`, the resume cases in
`server/main.test.ts` (real sockets: a dropped guest, wrong tokens counted and blocked, the probe),
`src/network/ServerTransport.test.ts`, and `src/network/ServerTransport.relay.test.ts` (a guest's and the
host's socket cut mid-match against the real relay, nobody seeing a disconnect). Not yet run in a browser or
e2e. Differences from the F1 plan and its brief:
- `resumed` comes before the replay, not after it: a second drop during a long replay then still finds the
  client holding the current token.
- The goose snapshots are not kept either (the plan named snapshots in general, the brief `playerSnapshot`):
  a horde would overflow the buffer in about ten seconds. They are skipped for a slow consumer too.
- A resume while the server still counts the member as connected is refused with its own code (4013) and
  the old socket is probed (2 s), so a half-open connection after a network change resumes in seconds
  rather than after the 15 s heartbeat. Only a right token gets 4013; every other refusal is 4012.
- A guest that gives up after 30 s reports `serverLost`, as a dropped guest socket always did, rather than
  `onPeerDisconnected(HOST_SLOT)`: it cannot tell its own network from the host's.
- A client close with no code (1005) counts as chosen, like 1000 and 1001; the client abandons a socket
  with 4000. The reconnecting client queues its own frames (the plan said nothing of that direction).

**Found in testing, open:**
- Rejoin after the host leaves fails: release 1 closes the room when the host goes (section 4.4), and there is
  no visible "Rejoin" control. F1 (host resume within 30 s) is built (5.6); still planned: a Rejoin button on
  the disconnect screen and the Multiplayer menu, and the access code field on Join Room too (Gustav,
  2026-11-05: low priority).
- Server-mode e2e: 2 of 4 runs stopped at `lockPointer(guestPage)` before any network check, on a slow
  machine. Check in WP 9.
- The server-mode HUD ping is an application ping, so it includes the page's frame time; P2P reads RTCStats.
  Compare the telemetry with that in mind.
- `joinAnswer` is keyed by slot only; the client answers only the newest request. Echoing `peerId` would close
  the gap (a server change, for the WP 11 audit to weigh).

**Still to do:** F1 resume in a real browser (an e2e run that cuts a socket mid-match, and Gustav switching
networks mid-match); WP 9 (rest); WP 10 deploy kit (DuckDNS, Oracle VM in Johannesburg, Gustav's sign-up);
WP 11 audit, including resume (token handling, refusals, the client-to-server gap in 5.6); WP 13 release.

## 14. Phase B outline and rooms larger than 4

### 14.1 Phase B: the server simulates (outline only)

Move host-simulated systems into a headless Node process per room: wandering geese (`GooseManager`), the
horde and its waves (`HordeGooseManager`, `AmmoDropManager`), the bonus goose (`BonusGooseManager`), pickups
(`PickupSystem`), doors and breakers (`FacilityInteraction`), the win decision (`MultiplayerMatchState.findWinner`
plus `matchEnded`) and catch-up (`buildMatchSync`). The host then becomes an ordinary player, host drops
stop ending matches, and server-side hit validation becomes possible later.

Main obstacles:
- **Logic is tangled with presentation.** The managers hold Three.js meshes, effects and audio hooks beside
  their state; each needs a pure simulation split from its renderer (the `applyRemote*` follower path hints
  at the seam).
- **The world must exist on the server.** Geese walk on terrain and avoid buildings built in `Game.create`
  with Rapier; `rapier3d-compat` should run in Node (UNVERIFIED here) and terrain noise is pure, but every
  world builder needs a headless mode without meshes and textures.
- **Per-room state.** The same world from `setWorldSeed`, and module-level globals (core.md gotcha 5) turned
  into per-room state so several rooms share one process.
- **CPU per room** on a 2-core ARM VM caps concurrent rooms; profile first. The protocol barely changes
  (host-authored types become server-authored; slot 0 stops being special).

Rough cost: XL, about 15 to 25 work packages over several weeks, Opus-led design first. Do it only if host
drops or host-side cheating become the main complaint after Phase A.

### 14.2 What assumes 4 players today (grep of `src/`, tests excluded)

| Place | Assumption |
|---|---|
| `PlayerSlot = 0 \| 1 \| 2 \| 3` (`protocol.ts`) | The type itself; threaded through every per-opponent map. |
| `isPlayerSlot`, `isSlot` (value `<= 3`), `scoreboardSync` length `<= 4` (`protocol.ts`) | Validation. Section 3.3's `PLAYER_SLOT_COUNT` removes the literals. |
| `GUEST_SLOTS = [1, 2, 3]` (`HostRoster.ts`) | Slot allocation; derived from capacity in WP 1. |
| `MULTIPLAYER_MAX_PLAYERS = 4` (`config.ts`) | Read by `HostRoster`, both room screens (row count), `matchEndScreen` (podium rows), `Game.create` (`RemoteTorches` pool of `MAX - 1` spot lights). |
| `pickMultiplayerSpawnPoints` (`multiplayerSpawn.ts`) | Ring of radius 35 split N ways: 13.7 m apart at 16; respawns need 35 m from every opponent within 20 tries, which fails more often in a crowd. |
| `formatOpponentPings` (`connectionStats.ts`), `multiplayerHud.ts` | One HUD line lists every opponent's ping. |
| `HORDE_WAVE_TABLE_MULTIPLAYER` (`config.ts`) | Fixed waves, not scaled by player count (no player-count read found in `HordeGooseManager`). |

### 14.3 Obstacles beyond 4

- **Bandwidth grows with N squared** (5.7): JSON is fine to 8; past 8 use sender rounding, binary snapshots,
  per-recipient batching, and perhaps interest management (far players less often).
- **Client cost:** each `RemotePlayer` is a skinned model with colliders and each remote torch a spot light;
  8 or 16 need LOD and a light budget, measured on real machines.
- **UI, spawns, balance:** room rows, podium, HUD ping line and minimap, the spawn ring and respawn
  distance, kill limits, horde waves and pickup counts were all tuned for 4.
- **Slot type:** `PlayerSlot` becomes `number` checked against `PLAYER_SLOT_COUNT`; maps keyed by slot keep working.
- **The host in Phase A** uploads each world broadcast once (fine) but still simulates for everyone, and
  its download grows with N.
