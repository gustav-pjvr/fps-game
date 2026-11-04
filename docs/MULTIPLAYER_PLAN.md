> **Historical document (written before v4.0).** It records the original plan and what was decided then; the game has changed since (multiplayer now supports 4 players with direct guest links, see `multiplayer.md`). For how the game works now, see [ARCHITECTURE.md](ARCHITECTURE.md) and the index in [README.md](README.md).

# Multiplayer Plan — fps-game

Status: **Phases 1-4 (connection layer, shared world + movement sync, combat sync, host match
settings + match lifecycle) implemented and verified.** See NOTES.md's "Multiplayer" entries for
what actually landed and how it was verified. This build order (§7) is now complete; remaining
work is whatever's listed in §6 ("what this plan deliberately does not solve yet") if it's ever
needed.

Scope, per user request: a "party" model, not public matchmaking. One player clicks **Multiplayer → Create Room**, gets a short room code, shares it out of band (voice chat, text, whatever); the other player clicks **Multiplayer → Join Room**, enters the code, connects. The room owner (host) picks match settings and clicks **Play**; both players load into the same match and fight each other. The existing bot/enemy system (`EntityManager`'s AI-controlled `Enemy`/`Target`) stays exactly as it is today, but only for the existing single-player "training" mode — multiplayer matches are pure player-vs-player, no AI entities spawned at all.

---

## 1. Current-state findings (why this plan looks the way it does)

Investigated the existing codebase before designing anything, since a couple of its existing properties change what's actually the right call here:

- **Zero backend today.** `package.json` has no server framework, no WebSocket library, nothing — `vite`/`vitest`/`playwright` only. This is a pure static SPA. Any multiplayer approach needs *some* new infrastructure; the question is how much.
- **World generation is already fully deterministic from a single seed.** `worldSeed.ts` holds one in-memory seed; every system that generates world content (`TerrainGenerator`, `VegetationManager`, `BuildingManager`, `ZoneMap`) reads it via `getWorldSeed()` rather than anything random-at-call-time. This means: **if both players' browsers are handed the same seed number at match start, they will independently generate byte-for-byte the same terrain, the same trees, the same buildings, the same towns/forests — with zero network traffic beyond that one number.** This is the single biggest reason this project is cheap to make multiplayer compared to a from-scratch game: the whole world doesn't need to be streamed or synced, ever.
- **Physics runs on Rapier compiled to WebAssembly**, and simulation is already locked to a fixed timestep (`FIXED_TIMESTEP = 1/60` in `Loop.ts`), independent of render rate. This matters because WASM's floating-point arithmetic is IEEE-754-exact and *is* specified to produce bit-identical results across different machines/browsers for the same instruction sequence — the classic "physics engines aren't deterministic across platforms" problem that rules out lockstep for most native games doesn't automatically apply here. In principle, true lockstep (both clients simulate the *entire* match, including each other's physics, from replicated inputs only) is technically achievable in this codebase specifically because of this existing architecture. I'm still not recommending it for v1 — see §3 — but it's worth knowing this door isn't closed if a more competitive/cheat-resistant mode is wanted later.
- **Random rolls outside world-gen are plain `Math.random()`, not seeded.** Weapon spread (`applySpreadCone`), enemy aim error, etc. all use raw `Math.random()` "matching the player's own non-deterministic weapon spread" (an existing code comment). Fine for single-player; relevant for multiplayer combat design in §4.
- **No per-entity network-authority concept exists anywhere.** `EntityManager` owns and fully simulates every `Enemy`/`Target`; `WeaponManager`'s hitscan checks against whatever the local `PhysicsWorld` currently contains. Adding a second *player* means adding a new kind of entity — a networked opponent — that the local client does not simulate, only renders and interpolates.
- **The lobby/menu system (`App.ts`, `MainMenu.ts`, `PlaySetupModal.ts`) is already structured as a stack of overlay screens or a state machine** (lobby idle → play-setup modal → loading screen → live match, plus death/pause/settings overlays layered on top). A multiplayer create/join flow slots into this as two more screens, not a rearchitecture of the menu system.

---

## 2. Recommended architecture: WebRTC peer-to-peer, no dedicated game server

For exactly two players in a private "party," a full authoritative game server is more infrastructure than the problem needs. The recommended shape:

```
Player A (host)                                Player B (guest)
   |                                                  |
   |--- 1. "create room" ---> tiny signaling service <--- 2. "join room ABC123" ---|
   |                          (just brokers a WebRTC                              |
   |                           handshake, never touches                          |
   |                           game state)                                       |
   |                                                                              |
   |<==================== 3. WebRTC DataChannel (P2P, direct) ==================>|
   |          all real game traffic (movement snapshots, hit events,             |
   |          seed sync, score) flows browser-to-browser from here on            |
```

**Signaling layer: [PeerJS](https://peerjs.com/) rather than a hand-rolled WebSocket server.** PeerJS wraps the WebRTC connection-negotiation handshake (SDP offer/answer, ICE candidates) behind a simple `peer.connect(id)` API, and its maintainers run a free public broker (`0.peerjs.com`) specifically so small projects don't need to stand up signaling infrastructure at all. Practically:

- **Room code = the host's PeerJS peer ID**, formatted as something short and readable (PeerJS lets you supply your own ID string instead of taking its generated UUID — e.g. generate a 6-character code like `RVQK72` client-side and register the host's peer under that ID).
- **Create Room**: host calls `new Peer(generatedCode)`, shows the code on screen, waits.
- **Join Room**: guest calls `new Peer()` (auto-generated ID, doesn't matter), then `peer.connect(hostCode)` to open a `DataConnection` directly to the host.
- Once the `DataConnection` is open, **no server is involved for the rest of the match** — it's a direct browser-to-browser channel. If the public broker ever becomes a reliability concern (rate limits, downtime) for a real release, the fallback is self-hosting a `PeerServer` instance (a few lines of Node, the same library, just run privately) — a same-day swap, not a redesign, since the app code only ever talks to the abstract `Peer`/`DataConnection` API.
- **NAT traversal**: WebRTC needs STUN (almost always enough) and occasionally TURN (relay, for restrictive NATs/corporate firewalls) servers to establish the direct connection. PeerJS's default config includes public Google STUN servers. TURN has actual bandwidth cost if it's ever needed at scale, but for two friends playing together, STUN-only will work the large majority of the time; a free-tier TURN fallback (e.g. Twilio's or metered.ca's) can be added later if connection failures turn out to be common in practice.

This gets the exact UX described — create → code → join → connect — with a signaling dependency that's either a hosted free service or a few lines of self-run Node, and zero game-logic backend to build, deploy, or scale.

---

## 3. Networking model once connected: snapshot sync, not lockstep

Two real options once the DataChannel is open:

**Option A — Full lockstep** (both clients simulate the entire match, including each other's player physics, from replicated *inputs* only). Technically viable here per §1's WASM-determinism point, and it's the "purest" approach (perfect physics fidelity for both players, minimal bandwidth — just input bits). But it requires strict, whole-codebase determinism discipline: every `Math.random()` call that affects simulated state (weapon spread being the main one) would need to move onto a shared, network-synchronized seeded stream instead, input delay or rollback is needed to hide latency, and *any* accidental non-determinism anywhere causes silent, hard-to-diagnose state divergence between the two clients. High payoff, high implementation risk, hard to debug when it breaks.

**Option B — Snapshot/interpolation (recommended for v1).** Each client remains fully authoritative over *only its own* player — exactly like today, unchanged. The opponent is represented locally as a lightweight `RemotePlayer`: not simulated at all, just a mesh whose position/rotation/animation state is driven by periodic network snapshots and smoothed between them (the same interpolation technique `Player.interpolateCamera` already uses for local render smoothing between physics ticks — a `RemotePlayer` just applies the same idea to network snapshots instead of physics ticks). This is the standard approach essentially every online shooter uses in some form, it degrades gracefully under packet loss/jitter (worst case: the remote player looks slightly laggy, it doesn't desync the whole match), and it only requires the *existing* single-player-authoritative code to also broadcast its own state — nothing about how a client simulates itself needs to change.

Recommendation: **build Option B.** It's dramatically less risky for two reasons specific to this project: (1) it doesn't require retrofitting determinism onto code that was never written with it in mind, and (2) it's the kind of thing that fails *visibly and locally* (a laggy-looking opponent) rather than *invisibly and catastrophically* (a silent desync nobody notices until scores don't match at the end of a match). Lockstep stays a documented, plausible upgrade path if a more "esports-grade" feel is ever wanted.

### What gets synced, and how often

| Data | Direction | Frequency | Mechanism |
|---|---|---|---|
| World seed | Host → Guest | Once, at match start | Single message before either side calls `Game.create()` |
| Match settings (see §4) | Host → Guest | Once, at match start | Single message |
| Player transform (position, yaw/pitch, current weapon) | Both ways | ~15-20Hz (not every physics tick — bandwidth doesn't need 60Hz for this) | Small snapshot message, interpolated on the receiving end like `Player.interpolateCamera` already does |
| Fire event (weapon id, origin, direction, hit/miss) | Shooter → Other client | On every shot | Discrete event, drives muzzle flash/tracer on the receiving end too, so both players see the same shot |
| Damage/death | Both ways, but each client is authoritative over *its own* health | On every hit that lands | The shooter's client computes the hit locally (it has an up-to-date `RemotePlayer` transform to raycast against) and sends "I hit you for N," but the *victim's* client is what actually decrements its own health and decides when it dies — avoids one client silently killing the other's character without that client's own agreement, which matters once anti-cheat is a concern even if it doesn't fully solve it (see §6) |
| Score/kill feed | Both ways | On each kill | Discrete event |

---

## 4. Host (room owner) match controls

You said I could decide on defaults — proposed set, all editable from a pre-match "Room Settings" panel only the host sees, sent to the guest as part of match start:

- **Win condition**: first to N kills (default 15) *or* a time limit (default 10 minutes), host picks one.
- **Weapon set**: default "all weapons" (matches today's single-player loadout - pistol/rifle/shotgun/sniper/knife); host can optionally restrict to a subset for a themed match (e.g. "pistols only").
- **World size**: reuse the existing `MatchConfig`-style setup already in `PlaySetupModal.ts` if it exposes anything relevant, otherwise just inherit whatever the single-player default is — no need for a separate knob unless you want one.
- **Friendly fire**: not applicable, it's 1v1.
- **Respawn behavior**: on death, short respawn timer (e.g. 3s) back into the match rather than single-player's current "you're out until Reset Play" death screen — a PvP match should keep going after a kill, not end the session.

None of this is load-bearing to get a first version working — it's the layer that turns "two players in a room" into an actual configured match, and can be trimmed further or expanded once the core connection/sync works.

---

## 4a. Per-player spawn points and respawn behavior (confirmed with user)

Unlike single-player (one shared `SPAWN_X`/`SPAWN_Z`), each player gets their **own fixed spawn point on opposite sides of the map** for the whole match:

- **Two designated spawn points**, placed on opposite sides of the (now 7-chunk/350-radius) world, far enough apart that players have to advance toward each other to fight rather than spawning in sight of one another, but both inside the safe playable area (same margins the world-edge/zone-placement logic already respects - see `WORLD_EDGE_RAMP_START`, `WORLD_HARD_CLAMP_RADIUS`). Exact coordinates picked once real terrain sampling is in front of me (need flat-enough ground, same `sampleHeight` approach the existing single-player spawn uses).
- **Host always spawns at Point A, guest always spawns at Point B** - fixed assignment for the match, not randomized or swapped, so it's predictable across a match's lifetime.
- **A small clearance ring around each spawn point**, mirroring the existing `VEGETATION_SPAWN_CLEARANCE`/`ENEMY_RING_BASE_RADIUS` pattern already used for the single-player spawn - keeps trees/buildings from generating on top of a spawn point and gives a short buffer before the opponent can walk right up on top of you the instant you respawn.
- **On death: only the dying player teleports.** The player who died runs their own local respawn (identical mechanism to today's single-player `Player.respawn()`, just pointed at their own designated spawn point instead of the shared one) after the short respawn timer from §4. The player who *didn't* die is completely unaffected - no camera cut, no repositioning, they keep playing exactly where they are. The respawning client sends one `respawnEvent` network message (new position) so the other client's `RemotePlayer` snaps to the new spot immediately instead of trying to interpolate what would otherwise look like an instant teleport-speed slide across the map.

---

## 4b. Opponent minimap (confirmed feasible, confirmed with user)

A small radar-style indicator, top-right of the HUD, showing the opponent's position relative to yours:

- **Visual**: a circular DOM element (matching the existing plain-HTML/CSS HUD convention - see `hud.ts`/`hotbar.ts`, not an in-3D-world overlay), with a dot representing the opponent, redrawn every frame the same way other HUD widgets already update (`Hud.setHealth`, etc.).
- **Data source**: reuses the exact `playerSnapshot` position data already being sent for movement sync (§3) - no additional network traffic needed, this is purely a new local consumer of data the sync layer already provides.
- **Math** (world-oriented/north-up for v1, simplest to get right first):
  - `dx = remoteX - localX`, `dz = remoteZ - localZ` (world XZ, ignoring height)
  - `distance = sqrt(dx² + dz²)`
  - If `distance <= MINIMAP_WORLD_RADIUS` (a tunable constant, e.g. 100 units): dot sits at `(dx / MINIMAP_WORLD_RADIUS, dz / MINIMAP_WORLD_RADIUS)` scaled into the minimap's pixel radius, i.e. proportionally placed inside the circle.
  - If `distance > MINIMAP_WORLD_RADIUS`: normalize `(dx, dz)` to a unit vector and place the dot exactly on the minimap's rim in that direction - it still points the right way, it just can't show exact distance once the opponent is further than the map's represented range. This is the "sits on the rim, moves around it as they move" behavior you described, and it's ordinary vector clamping, nothing exotic.
- **Future upgrade, not v1**: rotating the map to always face "up = the direction you're currently looking" (rotate the `(dx, dz)` offset by `-playerYaw` before placing the dot) - a few extra lines once the world-fixed version works, deliberately deferred so the first version is simpler to get right.

---

## 5. New code surface (high-level; no implementation yet)

- **`src/network/`** (new directory)
  - `PeerConnection.ts` — thin wrapper around PeerJS: create-room/join-room, connection lifecycle (open/close/error), typed send/receive for the message protocol below.
  - `protocol.ts` — the message schema: `{ type: 'seed' | 'matchSettings' | 'playerSnapshot' | 'fireEvent' | 'damageEvent' | 'scoreUpdate' | 'matchEnd', ...payload }`, discriminated union, one place both sides agree on the wire format.
- **`src/entities/RemotePlayer.ts`** (new) — mirrors `Player`'s visual/collider footprint but is driven by incoming `playerSnapshot` messages instead of local input/physics; interpolates between the last two received snapshots the same way `Player.interpolateCamera` interpolates between physics ticks.
- **`Game.ts`** — needs a multiplayer branch: skip `EntityManager`'s bot spawning entirely, spawn one `RemotePlayer` instead, broadcast this client's own `Player` state on a fixed interval, route `WeaponManager`'s hit detection to also check the `RemotePlayer`'s collider, wire fire/damage/score/respawn network events in both directions, and respawn the local player at their own designated spawn point (§4a) rather than the shared single-player one.
- **`src/ui/menu/`** — two new screens: `CreateRoomScreen.ts` (shows the generated code, waiting-for-opponent state) and `JoinRoomScreen.ts` (code input field, connecting state, error state for bad/expired codes), plus a `RoomSettingsPanel.ts` for the host-only match controls from §4. `MainMenu.ts` gets a new "Multiplayer" entry point alongside the existing "Play"/"Settings"/"Inventory".
- **`src/ui/minimap.ts`** (new) — the opponent-position radar from §4b; a `Hud`-sibling widget, not part of `Hud` itself, following this codebase's existing one-class-per-HUD-widget convention (`hitMarker.ts`, `killFeed.ts`, etc.).
- **`EntityManager`** — needs a way to be told "don't spawn any bots this match" (a simple constructor/config flag) for multiplayer mode, rather than being restructured.
- **`config.ts`** — new constants for the two fixed multiplayer spawn points, a `PLAYER_SPAWN_CLEARANCE_RADIUS` (mirroring the existing `VEGETATION_SPAWN_CLEARANCE`/`ENEMY_RING_BASE_RADIUS` pattern), and `MINIMAP_WORLD_RADIUS`.

No changes needed to `PhysicsWorld`, `ChunkManager`, `VegetationManager`, `BuildingManager`, `ZoneMap`, or terrain generation at all — the seed-sync trick means they run completely unmodified on both machines.

---

## 6. What this plan deliberately does not solve yet

- **Cheating.** A client-authoritative-over-its-own-health model means a modified client could refuse to take damage, or claim hits it didn't land. Acceptable for a private "party with a friend" model (same trust level as any P2P game between people who know each other); would need a real authoritative server to fully close if this ever opens up to strangers/public matchmaking.
- **More than 2 players.** Everything above is designed around exactly one host + one guest. Extending to N players is a bigger jump (PeerJS supports multiple simultaneous `DataConnection`s from one peer, so it's not a rewrite, but snapshot broadcast becomes host-relayed rather than any-to-any, and match logic needs a real "list of participants" instead of one hardcoded opponent).
- **Reconnection.** If the guest's connection drops mid-match, v1's behavior is "match ends, both players return to their own lobby" — resuming a dropped connection into the same match state is future work.
- **Voice chat / text chat.** Out of scope unless requested; WebRTC's `MediaStream` (for voice) is a separate concern from the `DataChannel` used here for game state, but the same `Peer` connection could carry both later.

---

## 7. Suggested build order

Each phase should be independently testable (two browser tabs/windows on the same machine is enough to verify the network layer before testing across real devices):

1. **Connection layer only.** Create/join UI, PeerJS wired up, room codes work, two tabs can open a `DataConnection` and exchange a "hello" message. No gameplay yet.
2. **Shared world, no combat.** Seed sync + match-start handshake; each player spawns at their own designated point (§4a); both tabs load the same generated world; each shows the other as a `RemotePlayer` that walks around correctly (movement sync only — walk into each other, no shooting); minimap (§4b) comes along for free here since it only needs the position data this phase already introduces.
3. **Combat sync.** Fire events, hit detection against `RemotePlayer`, damage/health/death/respawn-at-own-spawn-point, kill feed, score.
4. **Host controls + match lifecycle.** Room Settings panel, win-condition enforcement, match-end screen, return-to-lobby/rematch flow, disconnect handling.
5. **Polish/future**: TURN fallback if STUN-only connection failures show up in practice, reconnection, >2 players, voice chat, player-relative rotating minimap — pull from here as wanted, none of it blocks a working 1v1 match.
