# Multiplayer

Development notes for the room-code connection layer, movement/combat sync, match lifecycle, playtest fixes, and post-launch multiplayer polish, extracted from the original NOTES.md.

## Multiplayer, Phase 1: room-code connection layer (2026-07-06)

First step of `MULTIPLAYER_PLAN.md` (see that doc for the full architecture and the reasoning behind
every choice below) - no gameplay yet, just proving two browsers can find and talk to each other.

- **`peerjs` added as a dependency** (1.5.5) - wraps the WebRTC handshake (SDP offer/answer, ICE)
  behind a simple `Peer`/`DataConnection` API, using PeerJS's free public broker so this project
  needs zero backend infrastructure of its own for now (see the plan doc's §2 for the self-hosting
  fallback if that broker ever becomes a reliability concern).
- **`src/network/protocol.ts`** (new) - the `NetworkMessage` discriminated union both sides agree
  on; deliberately just `{ type: 'hello' }` for this phase, not pre-built out with message types
  later phases will need - those get added when combat/movement sync actually needs them.
- **`src/network/PeerConnection.ts`** (new) - thin wrapper around PeerJS for this game's exact
  shape (one host, one guest, connected by a short room code rather than PeerJS's own generated
  ID). Room codes are namespaced with a `fpsgame-` prefix before being used as the actual PeerJS
  peer ID - the public broker is shared by every app using PeerJS's default config, so a short,
  human-typeable code needs that prefix to avoid colliding with some unrelated app's peer IDs.
  `generateRoomCode()` excludes visually ambiguous characters (0/O, 1/I/L) since a code gets read
  aloud or typed by hand between two people.
- **`CreateRoomScreen.ts`/`JoinRoomScreen.ts`/`MultiplayerMenu.ts`** (new, in `src/ui/menu/`) - the
  create/join UI, following this project's existing one-class-per-screen overlay convention
  (`PlaySetupModal.ts` etc.). Both screens send a `hello` the moment the connection opens and only
  report "verified" once they've received the *other* side's `hello` back - proves the DataChannel
  actually works bidirectionally, not just that a connection object exists. `MainMenu.ts` gained a
  "MULTIPLAYER" button; `App.ts` wires the three new screens together the same way it already wires
  Settings/Inventory/PlaySetup.
- **Real end-to-end verification, not just typecheck-and-hope**: `e2e/multiplayer.spec.ts` (new,
  permanent) opens two independent Playwright browser *contexts* (not just tabs - contexts, so
  there's no shared storage), has one create a room and the other join with the generated code, and
  asserts both sides see "Connection verified both ways." This actually exercises the public PeerJS
  broker and a real WebRTC connection from this sandbox, not a mock - confirmed working before
  committing. A second test confirms joining a nonexistent code surfaces a clear error instead of
  hanging.

**Verification:** `npx tsc --noEmit` clean. `npm run test:unit` 19/19 green (unaffected - this phase
touches no game-simulation code). `npx playwright test e2e/smoke.spec.ts` 16/16 green (unaffected,
single-player is untouched). `npx playwright test e2e/multiplayer.spec.ts` 2/2 green, run standalone
against the real public broker multiple times during development to confirm it wasn't a fluke.

**Not yet done** (see `MULTIPLAYER_PLAN.md` §7 for the rest of the roadmap): no shared world/seed
sync, no `RemotePlayer`, no combat, no per-player spawn points, no minimap, no host match settings.
This phase is purely "can two browsers find each other and talk."

## Multiplayer, Phase 2: shared world + movement sync (2026-07-06)

Second step of `MULTIPLAYER_PLAN.md`: an actual match now starts on both sides, in the same
generated world, each player at their own spawn point, seeing the opponent move around - still no
combat (that's phase 3).

- **Seed sync.** `worldSeed.ts` gained `setWorldSeed(seed)` (a real production path, distinct from
  the test-only `setWorldSeedForTesting`) and `generateMultiplayerSeed()`. The host generates one
  seed via `CreateRoomScreen`'s new "Start Match" button, sends it in a `matchStart` message, and
  `Game.create()` calls `setWorldSeed(multiplayer.seed)` on *both* sides instead of
  `randomizeWorldSeed()` - never independently randomized per client, or the two worlds would diverge.
- **Per-player spawn points (MULTIPLAYER_PLAN.md §4a).** New `MULTIPLAYER_SPAWN_A_X/Z` and
  `_B_X/Z` in config.ts, on opposite sides of the map. Host always spawns at A, guest always at B -
  `Game.create()`'s new `multiplayerSpawnPoints(role)` helper picks both this client's own spawn
  and the opponent's starting position from one fixed rule, never negotiated per match.
  `VegetationManager.ts` now also excludes both points from tree/bush/rock placement (extending the
  same clearance check it already does for the single-player spawn) - cheap and applied
  unconditionally (harmless in single-player, since nothing ever stands at those coordinates then).
  Explicitly **not** done: `ZoneMap.ts`'s flat/forest zone placement still only knows about the
  single-player spawn, so a town or forest could rarely generate overlapping one of the multiplayer
  points - documented as a known gap in config.ts rather than silently ignored, since fixing it
  properly means touching the guaranteed-zone system `ZoneMap.test.ts` locks in across 1000 seeds,
  not something to do incidentally here.
- **`RemotePlayer.ts`** (new) - the opponent, never simulated locally. A capsule placeholder sized
  to match the local player's own collision capsule (a real character model is later polish, not
  required to prove sync). No Rapier collider yet - hit detection is phase 3's problem, no reason to
  guess at that shape now. Visual position/rotation *damps* toward the latest received snapshot
  (`THREE.MathUtils.damp`) rather than interpolating between two buffered, timestamped snapshots -
  a deliberate v1 simplification (documented in the class itself) that reads smoothly enough at an
  18Hz send rate without the extra bookkeeping true interpolation would need.
- **`Minimap.ts`** (new, `src/ui/`) - the opponent-position radar (MULTIPLAYER_PLAN.md §4b), a
  `Hud`-sibling widget matching the existing one-class-per-widget convention. World-oriented
  (north/-Z always "up"), reusing the exact snapshot data already flowing for movement sync - no
  extra network traffic. Confirmed this engine's forward=-Z/+X=right convention needs no axis
  inversion when mapping world offsets onto screen offsets.
- **`Game.ts`** - the biggest diff: `create()` takes an optional `multiplayer?: MultiplayerSession`;
  when present it skips `EntityManager`'s AI spawn call entirely (multiplayer is pure PvP per this
  whole plan's premise), spawns the local `Player` at its own designated point instead of the
  shared single-player one, constructs the `RemotePlayer`/`Minimap`, and takes over the
  `PeerConnection`'s callbacks from the room screen (`PeerConnection.setCallbacks`, a full handoff
  not a merge) to route incoming `playerSnapshot` messages into `RemotePlayer.applySnapshot`. A new
  `updateMultiplayer(dt)` runs every non-paused tick: advances `RemotePlayer`'s damping, updates the
  minimap, and throttled-broadcasts this client's own transform at `PLAYER_SNAPSHOT_SEND_INTERVAL`
  (~18Hz). `resetPlay()` (T key/death-screen Respawn) now no-ops entirely in multiplayer - without
  the guard it would spawn AI bots into a PvP match via the single-player reset path; full
  multiplayer reset/respawn semantics are phase 3/4's job, not something to half-implement here.
- **Room screens extended, not replaced.** `CreateRoomScreen`/`JoinRoomScreen` keep phase 1's
  `hello` verification step, then add the real next step on top: host gets a "Start Match" button
  once verified, guest gets "waiting for host" and reacts to the incoming `matchStart`. Both hand
  their now-established `PeerConnection` up to `App.startMultiplayerMatch` without disposing it -
  ownership moves to the match, not torn down when the room screen itself hides.
- **A real bug found while writing the first version of the movement-sync e2e test**, not a
  product bug: the test moved the host but never locked the *guest's* pointer, so the guest's own
  `Game.update()` sat in the paused early-return the whole time - and `RemotePlayer` damping (like
  every other per-tick widget) only advances on an unpaused tick. Incoming snapshots were still
  being recorded correctly (`applySnapshot` runs from the network callback, independent of the game
  loop), just never visually applied. Fixed by locking both pages' pointers in the test, matching
  how two real players would actually both be playing, not a product change.
- **A second, real bug found the same way, in the test *infrastructure* itself**: running
  `multiplayer.spec.ts` and `multiplayer-match.spec.ts` together picked up 2 Playwright workers
  (`fullyParallel: false` only serializes tests *within* one file, not across files) and one test
  failed on resource contention that vanished under a forced single worker. Fixed properly by
  adding `workers: 1` to `playwright.config.ts` project-wide, rather than leaving it to depend on
  which spec files happen to get run together - multiplayer tests are only going to get heavier
  (two real browser contexts, WASM physics, a live WebRTC connection, each) as more phases land.

**Verification:** `npx tsc --noEmit` clean. `npm run test:unit` 19/19 green (unaffected). New
`e2e/multiplayer-match.spec.ts`: starts a real match on both sides, asserts `getEntityCount() === 0`
on both (pure PvP, no bots), asserts each side's own position matches what the *other* side reports
as the opponent's spawn position, then moves the host and confirms the guest's view of the opponent's
position actually changes - not just that a connection exists, that movement genuinely crosses it.
Full `npx playwright test` (all spec files together, the real regression-risk scenario given the
worker-contention bug above) run clean after the `workers: 1` fix.

## Multiplayer, Phase 3: combat sync (2026-07-06)

Third step of `MULTIPLAYER_PLAN.md`: shooting the opponent now actually damages, kills, and
respawns them, with kills correctly scored across the network - the last piece of the core 1v1
loop before phase 4 (host match settings, match lifecycle).

- **`RemotePlayer` is now hittable.** Gave it a real Rapier collider - a
  `kinematicPositionBased()` rigid body with a capsule collider sized identically to the local
  `Player`'s own, registered via `physics.registerCollider()` and kept in sync every tick with
  `setNextKinematicTranslation()`. This is the same pattern `Enemy`/`Target` already use, and it
  means the *existing* `WeaponManager`/`castHitscan`/`isDamageable` pipeline can hit `RemotePlayer`
  with zero changes to that pipeline - `RemotePlayer` just implements `Damageable`, and its
  `takeDamage()` forwards to an injected callback instead of applying damage locally.
- **Trust model (MULTIPLAYER_PLAN.md §3/§6): the shooter resolves the hit, the victim owns their
  own health.** When the local player's raycast hits the `RemotePlayer` placeholder,
  `Game.ts` sends a `damageEvent {amount}` - not "I killed you," just "you took N." The receiving
  client applies that to its own `Player.takeDamage()` and is the only one that ever decides it's
  dead. The dying client then sends `playerDied` so the *other* client (which has no visibility
  into the victim's actual health) knows to credit the kill. `fireEvent` (tracer + muzzle flash)
  rides the same channel purely for the shooter's visual feedback on the other screen - cosmetic
  only, the receiving side never treats it as an actual hit.
- **A real bug, not a test artifact: network damage silently never triggered death.**
  `Game.update()` detects "the player just died this frame" by comparing `isDead` across the tick
  (`wasDead`, captured at the top of `update()`) - the *existing* debug-damage path
  (`pendingDebugDamage`) already queues its damage to apply *inside* that tick specifically so this
  comparison can see the before/after change. The new `damageEvent` handler applied
  `player.takeDamage()` directly from the WebRTC message callback instead, which fires at an
  arbitrary point *between* ticks - by the time the next `update()` ran, `wasDead` was captured
  *already dead*, so `isDead && !wasDead` was never true, the death screen never showed, and the
  `playerDied` reply (the only way the shooter's client learns about the kill) never got sent.
  Fixed by adding a `pendingNetworkDamage` field mirroring `pendingDebugDamage` exactly, applied at
  the same point in the tick. Found by writing the phase 3 e2e test end-to-end with two real browser
  contexts (no mocking) and temporary diagnostic logging that proved the shooter's raycast and the
  victim's health value were both correct the whole time - the damage pipeline worked; only the
  *transition detection* silently swallowed the kill.
- **Auto-respawn, not click-to-respawn (MULTIPLAYER_PLAN.md §4a).** `MULTIPLAYER_RESPAWN_DELAY`
  (3s) after death, `Game.multiplayerRespawn()` fires automatically: moves the local player back to
  its own fixed spawn point (never the opponent's), sends `respawnEvent {x,y,z}` so the other
  client's `RemotePlayer` snaps there immediately via `teleportTo()` rather than slowly damping
  across the whole map. `resetPlay()` (T key) now routes through the same auto-respawn in
  multiplayer instead of the single-player reset-match behavior it still is otherwise.

**Verification:** `npx tsc --noEmit` clean, unit tests 19/19 green (unaffected). New
`e2e/multiplayer-combat.spec.ts`: two real browser contexts create/join a room, start a match, and
teleport the host next to the guest (deliberately not walking there - the 280-unit spawn separation
across real procedural terrain is `world-bounds.spec.ts`'s concern, not this test's, and an earlier
walking-based version of this test spent several minutes stuck against terrain before this was
factored out). Fires until the *guest's own* health (not the host's belief it hit something) reads
0, confirms the host's score increments only after the guest's `playerDied` round-trips back,
confirms auto-respawn brings the guest back to full health at its own spawn point within
`MULTIPLAYER_RESPAWN_DELAY`, and confirms the host's view of the opponent snaps to match. Full
`npx playwright test` (all 22 specs, one worker) green.

## Multiplayer, Phase 4: host match settings + match lifecycle (2026-07-06)

Fourth and final step of `MULTIPLAYER_PLAN.md`'s original build order: a win condition that
actually ends the match on both sides, a MatchEndScreen showing the right result to each player,
a host-only Rematch that starts a genuinely fresh match on the same still-open room, and a
disconnect ending the match cleanly instead of leaving the remaining player's `RemotePlayer`
frozen in place forever.

- **Win condition (§4).** Host picks a kill limit (10/15/25, default 15 -
  `MULTIPLAYER_KILL_LIMIT_OPTIONS`/`DEFAULT_MULTIPLAYER_KILL_LIMIT`) from a plain `<select>` added
  directly to `CreateRoomScreen` rather than a standalone `RoomSettingsPanel` file - one control
  didn't earn its own component (YAGNI); promote it if match settings ever grow past this. Carried
  on `MatchStartMessage` (now `{ seed, killLimit }`) so the guest never picks, only receives.
- **Independent win detection, not a synced "the match is over" message.** Each client already
  knows its own kill count (`scoreState.value`, incremented on `playerDied` receipt) and derives the
  opponent's kill count as its own death count (`multiplayerDeathCount` - every death here is a kill
  for them). `Game.updateMultiplayer()` checks both against `killLimit` every tick and calls
  `endMultiplayerMatch()` the moment either crosses it - both sides converge on the same result
  independently off messages already flowing, no new "match over" message needed. Freezes
  simulation permanently via a new `matchEnded` flag (checked at the very top of `update()`, same
  early-return shape as the existing pause/death checks) - unlike a death, there's no respawn timer
  to eventually clear it.
- **MatchEndScreen lives in App, not Game (`src/ui/matchEndScreen.ts`).** Unlike `DeathScreen`
  (per-match HUD chrome, disposed with the rest of `Game`), this has to survive a Rematch's
  Game-teardown-and-recreate cycle, so it's a persistent App-level overlay like
  `MainMenu`/`CreateRoomScreen`. `Game.create()` gained two more trailing optional callbacks
  (`onMultiplayerMatchEnd`, `onMultiplayerRematchReceived`) rather than Game trying to recreate or
  dispose itself - App already owns every other match-lifecycle transition
  (`startMatch`/`returnToLobby`), and match-end/rematch is just another one of those, not a new kind
  of thing for Game to manage on its own.
- **Rematch reuses the connection, not a fresh room.** Only the host ever sees the Rematch button
  (`MatchEndScreen.show()`'s own rule) - clicking it generates a new seed, sends a fresh
  `matchStart` over the *same* `PeerConnection`, and calls `App.restartMultiplayerMatch()`, which
  disposes the old `Game` with a new `dispose({ keepConnectionAlive: true })` option (the ordinary
  `dispose()` call from `returnToLobby` still tears the connection down as before) and creates a new
  one on it. The guest never clicks anything - `Game.ts`'s `onMessage` switch gained a `'matchStart'`
  case specifically for this: the *first* `matchStart` a match ever sees is always consumed by the
  room screen before `Game.create()` attaches its own handler, so any `matchStart` `Game` itself
  receives is unambiguously this second-match signal, and it just calls
  `onMultiplayerRematchReceived` to trigger the same teardown-and-recreate on the guest's side.
  Before disposing the old `Game`, `restartMultiplayerMatch` resets the connection's callbacks to
  no-ops first - otherwise there's a real gap between the old `Game`'s disposal and the new one's
  `setCallbacks` call where a stray message could reach closures over an already-freed physics world.
- **Disconnect ends the match too (§6's "not solved yet" list, now solved for the 2-player case).**
  `PeerConnection`'s `onDisconnected` *and* `onError` (a dropped connection can surface as either,
  depending on how it failed) both now call `endMultiplayerMatch(false, 'opponentDisconnected')`
  instead of being no-ops - `MatchEndScreen` shows "Opponent Disconnected" with no Rematch option
  regardless of role, since the connection itself is gone.
- **A real testability gap, not a product bug: WebRTC disconnection has no bounded detection time.**
  The first version of the disconnect e2e test closed the guest's whole browser tab and waited for
  the host's `onDisconnected`/`onError` to fire - neither ever fired within 90s. Confirmed (via
  temporary diagnostic logging) this wasn't the product code failing to react; the underlying
  `RTCDataChannel`/ICE layer simply has no guaranteed-fast close signal for an abrupt disappearance,
  only its own failure-detection timers, which have no useful upper bound for a test to wait on.
  Added a test-only `debugDisconnect()` hook (mirroring the existing `damagePlayer` debug-API
  exception) that calls `PeerConnection.dispose()` directly - this exercises the exact same product
  code path (`DataConnection` 'close' -> `Game`'s `onDisconnected` -> `endMultiplayerMatch`) via a
  deterministic, fast trigger instead of waiting on browser/WebRTC teardown timing that isn't this
  feature's concern to test.
- **A real flaky test found and fixed, not a product bug.** The kill-limit e2e test (10 kills in a
  row, each teleporting the host to a fixed offset from the opponent) failed once during a full-suite
  run with a missed final shot - a fresh multiplayer seed generates different terrain around the
  same relative teleport spot every run, and a single fixed offset occasionally lands somewhere
  without a clean line of sight. Fixed by retrying a missed round from three other offsets
  (`KILL_ATTEMPT_OFFSETS`) before giving up, the same way a real player would just reposition after
  a miss rather than the test needing a single lucky spot every time.

**Verification:** `npx tsc --noEmit` clean, unit tests 19/19 green. New
`e2e/multiplayer-matchend.spec.ts`, two tests: (1) drives a full 10-kill match to its win condition,
confirms both sides' `isMultiplayerMatchEnded()`/score/opponent-score converge and MatchEndScreen
shows VICTORY/DEFEAT to the right side with Rematch visible only to the host, clicks Rematch, and
confirms a genuinely fresh `Game` starts on both sides (score back to 0, match-ended flag cleared,
screen hidden) rather than the old frozen match still sitting underneath; (2) confirms a mid-match
disconnect ends the match for the remaining player with no Rematch option. Full `npx playwright
test` (all 24 specs, one worker, ~16 minutes) green - including a full re-run after the flaky-test
fix above to confirm it actually holds, not just that it happened to pass once.

## Multiplayer playtest fixes: opponent skin + pause-invincibility exploit (2026-07-06)

Two real bugs the user found by actually playing a multiplayer match, not by reasoning about the
code - see this session's third one, ladder climbing, for the counter-example of a "fix" that
looked solid in automated testing but didn't hold up when the user tried it live; that one was
deliberately left out of this pass (see below) rather than claimed as done.

- **Opponent skin.** `RemotePlayer` was still the plain red capsule placeholder from Phase 2/3 -
  functionally correct (hittable, damageable) but visually nothing like a character. Now loads and
  clones the same `character-male-a.glb` (Kenney "Mini Characters") `Enemy.ts` already uses, via
  `AssetLoader.loadGLTF` (shared cache, so a match only fetches the model once regardless of how
  many enemies/opponents end up using it), with the same idle/walk animation swap Enemy.ts does
  based on whether the damped visual position actually moved this frame. `RemotePlayer`'s
  constructor became a private constructor behind a new `static async create()` (the GLTF load is
  async), matching this codebase's existing factory-method convention for anything that needs to
  await asset loading. The Rapier collider is unchanged - sized to the local player's own capsule,
  not the visual model, exactly as before; the model is cosmetic only, same as Enemy's own comment
  already said about itself. Verified with a real screenshot (not just a passing test) showing the
  actual character model in a live two-browser match, not the capsule.
- **Pause-invincibility exploit.** Reported directly by the user: pausing (releasing pointer lock)
  during a multiplayer match made a player briefly *unkillable* - shots that landed while paused
  didn't register until the player unpaused. Root cause: `Game.update()`'s pause check returned
  early before *anything* else ran, including applying already-arrived `pendingNetworkDamage` and
  the death-transition block that sends `playerDied`. The opponent's own client keeps running and
  keeps sending damage regardless of this client's pause state, so all of it just sat queued,
  unapplied, until the paused player actually unpaused - at which point it would land as one lump
  sum. A player who simply never unpaused was functionally invincible for as long as they stayed in
  the pause menu. Fixed by only letting the early-return skip *local* simulation (movement,
  shooting, AI) - `if (isPaused && !this.multiplayer) return;` instead of `if (isPaused) return;` -
  so network damage/death/respawn keep flowing through the rest of `update()` even while paused in
  multiplayer specifically. Single-player pause behavior is byte-for-byte unchanged (no `multiplayer`
  session, same unconditional freeze as always - nothing else is "live" to exploit there anyway).
  Verified with a dedicated two-browser test: guest pauses, host lands enough shots to kill them,
  guest's health reads 0 while *still* paused (checked without ever unpausing first).
- **Ladder climbing (attempted, not confirmed - deliberately not shipped this pass).** Also
  reported by the user ("only worked once," "doesn't let me climb when I walk into them"). Made two
  real-looking fixes in isolation - bypassing the character controller's shape-cast solver for
  climbing's vertical move (direct kinematic translation, mirroring the existing mantle-teleport
  technique) since it was returning near-zero movement against a flat wall in a large fraction of
  attempts, and replacing the sensor-contact-based "still climbing" check with a height-threshold
  one (the per-frame `isTouchingSpecificClimbable` query was intermittently reading "lost contact"
  within a tick or two of a climb starting, well before any real rise) - and built an e2e test
  around them that passed repeatedly, including 15/15 trials across three clean full runs. The user
  then tested it live and reported it still doesn't work. The test's own "did Y increase" assertion
  turned out not to be trustworthy enough to prove the mechanic actually works end-to-end (it can't
  distinguish "climbed the ladder" from "gained height some other way," and this session's own
  history already has a precedent for that gap - see the original "Ladder climbing" entry's
  documented 40%-failure-rate bug that automated testing initially missed too). Rather than keep
  guessing at fixes an automated test can't actually validate, the `Player.ts`/`PhysicsWorld.ts`/
  `config.ts` changes are left uncommitted in the working tree and the new `e2e/ladder-climb.spec.ts`
  is untracked - none of it is in this commit, none of it is claimed as fixed. Revisit with the user
  actually testing live, not another round of automated-test iteration.

**Verification:** `npx tsc --noEmit` clean, unit tests 19/19 green. New
`e2e/multiplayer-pause-damage.spec.ts` (the exploit test described above). Existing
`e2e/multiplayer-match.spec.ts`/`multiplayer-combat.spec.ts` still green with the new
`RemotePlayer.create()` async factory in place, confirming the skin swap didn't regress hit
detection or movement sync. This commit deliberately excludes all ladder-related changes.

## Second playtest round: facing flip, hit registration, damage feedback, dual HUD, minimap range,
## map shrink (2026-07-06)

More real bugs found by the user actually playing, plus three requested features and a second map
shrink - same "test on real code, not just reasoning" discipline as every entry above.

- **Opponent model faced backwards.** Not the model asset - a coordinate-convention mismatch.
  `Player.facingYaw` is a *camera*-forward convention (yaw=0 means the camera faces -Z, per
  `applyMovement`'s `forward = (0,0,-1).applyQuaternion(...)`), but the Kenney model faces +Z at
  rotation.y=0 (the same convention `Enemy.ts`'s own `atan2(dx,dz)` facing logic already assumes).
  Applying the raw camera yaw straight to `RemotePlayer.mesh.rotation.y` showed the model turned
  exactly backwards from wherever the real player was actually looking. Fixed with a `+ Math.PI`
  offset in `applySnapshot`. Verified with a real screenshot: teleported the host near the guest,
  had the guest look directly at the host, and confirmed the host now sees the guest's face (visible
  glasses/shirt front), not the back of their head as before.
- **Hit registration was unreliable against a moving target, worst with the sniper at range, but
  present with pistol/shotgun too (per the user: "we're just hitting each other, but it wasn't
  registering... sometimes the bullets would register").** Two real, fixable causes, not an
  inherent limit of the snapshot-sync model:
  1. `RemotePlayer.update()` (advances its damped position and commits the new kinematic
     translation) ran *after* `weaponManager.update()` in the same tick - every shot's raycast
     checked a collider position that was a whole extra frame stale on top of the network sync lag
     already inherent to snapshot-sync, for no reason. Moved earlier in `Game.update()` so the
     collider is current for that same tick's own raycast.
  2. Snapshot send rate (`PLAYER_SNAPSHOT_SEND_INTERVAL`, ~18Hz) and `RemotePlayer`'s damping rate
     were both tuned assuming a slower, purely-cosmetic use of the data - at sprint speed (8
     units/sec) the old ~55ms interval let real position drift up to ~0.44 units between updates,
     close to the target's own 0.4-unit hit-radius, before damping's own further lag stacked on top.
     Raised to 30Hz (~33ms) and damp rate 12 -> 18.
  Verified with a new `e2e/multiplayer-moving-target.spec.ts` - the first combat test to fire at a
  genuinely *moving* target (real held-key movement, not a stationary teleport); every earlier
  combat test would have missed this whole bug class entirely. Deliberately doesn't assert "the
  target always dies" - this environment's own per-step CDP round-trip overhead adds lag a real
  mouse click never pays, so a strict kill-every-time bar would partly grade the test harness, not
  the fix (same "don't let this sandbox's own performance quirks dictate an overclaimed pass/fail
  bar" lesson as the ladder work below) - it checks that *some* hits land against real movement,
  which is what the bug actually broke (real playtesting reported long zero-hit stretches).
- **Hit acknowledgment (`DamageVignette`, new).** A faded red screen-edge vignette flashes briefly
  every time the player takes damage, mirroring the existing `HitMarker` (which confirms *landing* a
  hit) from the receiving side. Wired to `Player`'s existing `onDamaged` hook, which already fires
  on every non-fatal `takeDamage` call regardless of source (enemy fire, network `damageEvent`) - one
  injection point covers single-player and multiplayer both. Confirmed firing correctly via direct
  polling (caught `opacity=1` mid-flash) - a single screenshot often missed it entirely, because this
  environment's fixed-timestep catch-up loop can burn through the whole 0.4s fade's worth of ticks in
  one burst before ever rendering a frame in between; unrelated to whether the feature works, a real
  60fps session sees the full flash normally.
- **Multiplayer HUD redesign (`MultiplayerHud`, new).** Replaces the single-player-shaped top-left
  score text and bottom-left health bar (hidden via new `Hud.setScoreVisible`/`setHealthVisible`)
  with a top-left pair of health bars (both players, not just your own) and a top-center scoreboard
  bar. Opponent health piggybacks on their existing `playerSnapshot` message (`health` field added)
  rather than a new message type - already sent at 30Hz, no reason to duplicate the delivery
  mechanism for one more number. Verified with a screenshot: damaged the guest, confirmed the host's
  screen showed "OPPONENT 55" with a proportionally-drained bar within ~1.5s.
- **Minimap radius, round 2.** Raised 120 -> 220 in the very first playtest-fixes round (see above)
  when spawns were still ~280 units apart; brought back down to 90 in *this* round once the map
  shrink below pulled spawns to ~70 units apart - 220 would have made the *entire* shrunk world fit
  inside a small fraction of the minimap's represented range, the opposite failure mode (too little
  dot-movement resolution) from the one the original fix addressed.
- **Map shrunk again, `WORLD_SIZE_CHUNKS` 6 -> 4**, per user request for a tighter 1v1 arena -
  flagged the real consequence *before* implementing, unlike the WORLD_SIZE_CHUNKS=7 mistake earlier
  in this project's history: the zone-placement ceiling (`ZONE_EDGE_MARGIN` already at its
  established safe floor of 5) only allows ~17.5-unit zones at 4 chunks, a real ~70% cut from the
  6-chunk world's 40-60/45-65 ranges, not a mild trim. User's own suggestion - growing zones
  organically outward from a point until hitting a boundary, instead of a fixed-radius disc checked
  against both boundaries - is a genuinely promising way to reclaim some of that loss (an irregular
  footprint can pack more usable area into a tight annulus than a circle constrained to fit its
  narrowest dimension), but it would touch terrain flattening's falloff too, not just placement, so
  it's a system rework earmarked for its own pass, not folded into this one. For now: `FLAT_ZONE_
  RADIUS_MIN/MAX` and `FOREST_ZONE_RADIUS_MIN/MAX` cut to 10-16 (both, from 40-60/45-65), their cell
  sizes shrunk proportionally (230->50, 200->45) so a full grid of cells still fits across the
  smaller world instead of only one or two, and `MULTIPLAYER_SPAWN_A/B_X` pulled in from +/-140 to
  +/-35 (now ~70 units apart, actually *closer* combat than before - fits the "tighter arena" goal).
  Confirmed visually (not just via the ceiling arithmetic): an overhead screenshot of a generated
  town shows a real, functional 5-6-building cluster - clearly smaller than before, but not broken
  or empty.

**Verification:** `npx tsc --noEmit` clean, unit tests 19/19 green (including `ZoneMap.test.ts`'s
guaranteed-site invariants across many seeds, unaffected by the radius/cell-size retune).
`e2e/world-bounds.spec.ts` and `e2e/multiplayer-match.spec.ts` green at the new world size.
`e2e/multiplayer-combat.spec.ts`/`multiplayer-matchend.spec.ts`/`multiplayer-moving-target.spec.ts`
re-run green after the spawn-point change, confirming combat/win-condition/rematch flows aren't
sensitive to the exact spawn distance. Two overhead/close-up screenshots (opponent facing, shrunk
town) used to confirm real visual outcomes rather than trusting the underlying math alone.

## Random multiplayer spawn points (2026-07-06)

Per user request: every spawn/respawn now picks a fresh point, not always the same fixed
host-spawns-here/guest-spawns-there layout. `MULTIPLAYER_SPAWN_A/B_X/Z` (two fixed points) replaced
with `MULTIPLAYER_SPAWN_POINTS` (a 6-point ring at the same 35-unit distance) in config.ts.

- **Match start:** the host picks two points at least `MULTIPLAYER_SPAWN_MIN_SEPARATION` apart
  (`pickMultiplayerSpawnPoints`, plain `Math.random()` - no reason this needs to be seed-reproducible
  the way world generation does) and sends them on the same `MatchStartMessage` that already carries
  the seed/kill-limit, so the guest never has to pick or guess - same "one side decides, transmits
  the result" shape the win-condition/seed already used, just two more numbers on it. Also re-picked
  fresh on every Rematch (`App.handleRematchClick`), not reused from the previous match.
- **Respawns:** each client picks its *own* fresh point independently on death
  (`pickRandomRespawnPoint`, `Game.multiplayerRespawn`) - no cross-client agreement needed here at
  all, since the chosen position already rides on the existing `respawnEvent` message that tells
  the opponent's `RemotePlayer` where to snap to. Simpler than the match-start case, not a special
  case of it.
- `VegetationManager`'s multiplayer-spawn clearance check (previously two fixed points) now loops
  over the whole pool, and `MultiplayerMatchStartParams` (new type in `MultiplayerSession.ts`)
  bundles seed/killLimit/spawnA/spawnB as one object through the room-screen -> App.ts handoff
  instead of letting that callback's positional parameter list keep growing.

**Verification:** `npx tsc --noEmit` clean, unit tests 19/19 green.
`e2e/multiplayer.spec.ts`/`multiplayer-match.spec.ts`/`multiplayer-combat.spec.ts` green (the latter
flaked once mid-batch on an already-known, pre-existing line-of-sight retry pattern - see that
test's own history earlier in this file - and passed cleanly re-run alone immediately after, so
treated as the established flake, not a new regression from this change).

## TURN server fallback for cross-network multiplayer (2026-07-06)

User report: joining a room from a different network/device than the host got stuck at
"connecting…" indefinitely. Root cause understood, not (yet) confirmed fixed live: WebRTC needs a
direct P2P path between the two browsers, and some NAT/firewall combinations can't establish one
with STUN alone - a TURN relay server is the standard fallback, but there's no custom "detect same
network, pick STUN vs TURN" logic to write; ICE already tries every candidate (direct, STUN,
TURN) automatically and uses whichever works, once TURN servers are actually offered as options.

- **A real discovery while implementing this: PeerJS already ships a default TURN relay**
  (`turn.peerjs.com`, shared public credentials) alongside Google's STUN server - this game was
  never purely STUN-only to begin with. Confirmed by reading PeerJS's own source
  (`DEFAULT_CONFIG` in its bundle), not assumed. Whatever caused the user's stuck connection might
  already be addressed by that existing relay in most cases; this change adds a *second*,
  independent TURN option on top, for the cases where even PeerJS's own relay can't be reached.
- **`netlify/functions/turn-credentials.mts` (new)** proxies Metered.ca's free-tier TURN credential
  API server-side, so the API key never reaches the client bundle - a client-side fetch straight to
  Metered's API would need the key embedded in shipped JS, readable by anyone. Returns an empty
  `iceServers` array (not an error) if `METERED_API_KEY`/`METERED_APP_NAME` aren't set as Netlify
  environment variables, so multiplayer keeps working exactly as before until those are configured.
- **`PeerConnection.hostRoom`/`joinRoom` are now async**, fetching this extra TURN option (bounded
  by a 2-second timeout, so a slow/unreachable endpoint can't meaningfully delay room creation)
  before constructing the underlying `Peer`. A real subtlety caught before shipping, not after:
  passing a `config` to `new Peer(...)` at all *replaces* PeerJS's own default ICE server list
  rather than merging with it (confirmed by reading PeerJS's source) - naively setting
  `config: { iceServers: [...fetched] }` would have *removed* the default STUN/TURN the moment this
  shipped, making connections *less* reliable whenever Metered isn't configured (an empty array) or
  down, not more. Fixed by explicitly combining `PEERJS_DEFAULT_ICE_SERVERS` (mirrored from PeerJS's
  own source) with whatever Metered.ca contributes, always - never in place of the defaults.
- **Room screens updated for the new async gap.** `CreateRoomScreen.show()`/`JoinRoomScreen.
  attemptJoin()` used to assign `this.connection` synchronously from `hostRoom`/`joinRoom`'s return
  value; now that both are promises, a Cancel click (or a repeat Join click) can land while one is
  still in flight. Without a guard, that in-flight call resolving *after* the screen already moved
  on would incorrectly resurrect `this.connection` and leak an orphaned PeerJS peer. Fixed with a
  generation counter on each screen, bumped on every show()/close()/dispose() - a resolved
  connection whose generation no longer matches gets disposed immediately instead of assigned.
- **Still needs the user to actually activate it** - this is plumbing, not yet a working relay:
  sign up free at Metered.ca (20GB/month), then set `METERED_API_KEY`/`METERED_APP_NAME` as
  environment variables in Netlify's dashboard (never committed to this repo). Until then, the
  function returns an empty array and behavior is unchanged from before this pass - verified
  locally, where no Netlify function runs at all (`vite dev` doesn't serve `netlify/functions/`),
  exercising the exact same fallback path a misconfigured or down Metered account would hit.

**Verification:** `npx tsc --noEmit` clean, unit tests 19/19 green, `npm run build` (which runs the
same `tsc --noEmit` the Netlify build itself does) succeeds. `e2e/multiplayer.spec.ts` (both create
and join flows) and `e2e/multiplayer-match.spec.ts` green - directly exercising the new async
`hostRoom`/`joinRoom` path and its STUN/peerjs-TURN-only fallback (no Metered credentials
configured in this environment), since that's the path every developer/CI run will actually take
until the user finishes the Metered.ca signup. The actual Metered relay path itself is unverifiable
from here - it needs the user's own account and a real cross-network test.

### Multiplayer polish: usernames, a real podium screen, positional gunshot audio

Three smaller multiplayer-quality requests, tackled together:

- **Usernames.** Both room screens (`CreateRoomScreen`/`JoinRoomScreen`) now prompt for a name
  (persisted via `localStorage`, see `core/username.ts`), exchanged over the existing `hello`
  handshake (`protocol.ts`'s `HelloMessage` gained a `username` field - no new message type
  needed, since both sides already know their own name before they ever connect). The host's room
  screen shows a live "Players in this room" list that updates from "Waiting for a player…" to
  the guest's real name the moment their `hello` arrives. `MultiplayerHud`'s health rows and
  scoreboard now show real names (truncated to fit) instead of generic "You"/"Opponent", carried
  through rematches via `MultiplayerSession.ownUsername`/`opponentUsername`.
- **Podium screen.** `MatchEndScreen` now shows a ranked 1st/2nd podium with real names instead of
  a plain score line, plus host-only rematch settings (kill-limit select, "generate a new map"
  checkbox - unchecked reuses the just-played seed for a direct rematch on the same terrain). Per
  user correction: both host and guest already saw this screen and waited on the host, but the
  host's "Return to Lobby" click previously left the guest stranded on it forever once the
  connection silently closed - fixed with a new `HostLeftRoomMessage` the host sends before
  leaving, which the guest's still-active `Game` instance reacts to by returning to its own lobby.
- **Positional gunshot audio.** Opponent gunshots in multiplayer were completely silent before
  this (the `fireEvent` handler only spawned the tracer/muzzle-flash, never played a sound).
  `FireEventMessage` now carries the shooter's `weaponId` so the receiving end plays the right
  gunshot sound, distance-attenuated (reusing the existing `enemyGunshotVolume` falloff) and
  stereo-panned by a new `computeStereoPan` helper (derived from `Player.facingYaw`'s own
  forward-vector convention) so a shot from off to the side is audibly distinguishable from one
  straight ahead. Per user request, the same panning was added to single-player enemy gunshots
  too, which previously only had distance attenuation with no directionality.

**Verification:** `npx tsc --noEmit` clean, unit tests 23/23 green, `npm run build` succeeds.
Multiplayer-specific behavior (username exchange, podium/rematch settings, host-leaves handoff,
positional audio panning) verified by code review and the existing `multiplayer-matchend.spec.ts`
e2e coverage rather than fresh manual multiplayer playtesting - flag for a manual two-browser
check if anything here reads wrong once live.

## Post-launch batch: lobby crash root-caused and fixed, Nuke tier, game modes, audio, footsteps, motion polish

A real WASM crash, four new game modes, an audio fix, networked footsteps, and a first real motion
pass - all held locally (no push) per explicit user instruction until every item was done and
signed off.

**Return-to-lobby crash - root-caused via a live 2-browser repro, not guessed.** The user reported
that after returning to the lobby, a new room/join attempt would silently do nothing until a full
page reload. Reproducing an abrupt guest disconnect mid-match against a real dev server caught the
actual failure via `page.on('pageerror')`:
```
RuntimeError: unreachable
    at ...rapier3d-compat.js: rbNumColliders / removeRigidBody
    at RemotePlayer.dispose (RemotePlayer.ts:166)
    at Game.removeMultiplayerOpponent (Game.ts:1286)
    at Object.onPeerDisconnected (Game.ts:605)
```
A WASM `unreachable` trap isn't a catch-and-move-on JS error - it can leave Rapier's WASM instance
unreliable for every subsequent call, including a brand new match's own `PhysicsWorld.create()`,
which is exactly the "everything just silently hangs, only a reload fixes it" symptom. Couldn't
fully prove the precise internal Rapier assertion from outside the WASM module itself, but found a
real, independently-confirmed gap: `Game.dispose()` disposes every `RemotePlayer` directly, *then*
disposes the `PeerConnection` a few lines later - and `App.ts`'s **rematch** path
(`restartMultiplayerMatch`) already knew this ordering needed a guard (it silences the connection's
callbacks before calling `Game.dispose()`), but the plain **return-to-lobby** path never adopted
the same guard, so a callback firing mid-teardown could re-enter `RemotePlayer.dispose()` on an
already-torn-down entity. Fixed in two layers: (1) a `disposed` guard added to
`RemotePlayer`/`Enemy`/`Target`/`Goose` (every physics-backed entity had the same latent gap, not
just RemotePlayer) so a second `dispose()` call anywhere is a safe no-op instead of re-entering
Rapier's removal path; (2) `App.returnToLobby()` now silences connection callbacks before
`Game.dispose()`, mirroring the rematch path exactly. Also added `.catch()` to the
`hostRoom()`/`joinRoom()` promise chains in both room screens (previously any failure there left
the screen stuck with no error and no retry - independently matches the reported symptom regardless
of root cause). Re-ran the same disconnect-then-return-to-lobby-then-create-a-new-room repro after
the fix: no `pageerror`, second room created successfully, lobby renders normally instead of black.

**Multiplayer game modes (host-picked pre-match, multiplayer-only per explicit follow-up
instruction - single-player never has a mode).** New `core/gameModes.ts`: 1 Shot 1 Kill (pistol
only, damage override to guarantee a 1-hit kill), Sniper Duel (sniper only, same override - base
sniper damage, 90, isn't quite lethal against 100 HP as-is), Gun Game (one random starting gun,
never the knife; every kill upgrades to a new random gun; dying does *not* reset the gun - which
falls out for free since respawn already only ever resets ammo, never weapon identity), Knife
Only. Needed two new primitives that didn't exist: a `damageOverride` on `Weapon` (per-instance,
not mutating the shared `readonly`-typed `WEAPON_DEFINITIONS`) and
`WeaponManager.replaceActiveWeapon()` for Gun Game's runtime swap. `gameMode` threaded through the
same six shapes `gooseDifficulty` was added to a few commits ago (`MatchStartMessage`,
`WelcomeMessage.activeMatch`, `MultiplayerSession`, `MultiplayerMatchStartParams`,
`RematchSettings`, `MultiplayerMatchEndResult`), plus a third selector in `CreateRoomScreen`/
`matchEndScreen` (as a full-width row, not a third column - the mode labels are too long to cram in
next to kill-limit/goose-difficulty at this panel width). Live-verified 3 of 4 modes in a real
2-browser match (Knife Only/Sniper Duel/1 Shot 1 Kill all correctly restricted both host and guest
loadouts); Gun Game shares the identical `resolveWeaponLoadout` → `WeaponManager.create()` path so
the initial-loadout mechanism is covered, but its kill-upgrade transition needs real combat to
verify and wasn't re-tested live this round. Also: hid the Pause Menu's "Reset Play" button in
multiplayer (it's single-player's own practice-reset feature and does nothing in a multiplayer
match, per user report).

**Audio.** Opponent gunshots were audibly too soft at real PvP engagement range - confirmed the
existing `enemyGunshotVolume`'s full-volume inner radius (10 units) is tiny next to
`MULTIPLAYER_SPAWN_RADIUS` (35), so most real close-quarters fights already sat in the linear
falloff zone. Rather than widen the shared constants (would also change single-player enemy/goose
audio, not asked for), added a separate `multiplayerGunshotVolume` with its own, more generous
`MULTIPLAYER_GUNSHOT_*` constants, sharing the same underlying falloff shape via a new
`distanceGainFalloff` helper. Also added networked footsteps (`FootstepEventMessage`, relayed like
every other per-event gameplay message) - `SoundEngine.playFootstep` gained the same
`volumeScale`/`pan` parameters `playGunshot` already had. Explosion sound (added a commit ago) was
re-confirmed by code review to already reach guests correctly - `GooseManager`'s `onExplosion`
callback isn't host-gated, so it fires independently on every client whether the explosion was
decided locally (host) or arrived via a `gooseExploded` broadcast (guest).

**Verification:** `npx tsc --noEmit`, `npm run test:unit` (53/53), `npm run build` all clean after
every phase. The crash fix has a real live re-repro (not just code review) confirming it. Game
modes: 3/4 live-verified, Gun Game's kill-upgrade not live-tested (needs real combat). Held
entirely local per explicit instruction - no push until the user reviews and says so.

## "Players can't join my lobby": root cause is no working TURN relay (2026-09-14)

**Report (Gustav):** other players could not connect to a created lobby; the guest sat on
"Connecting…" for 10 to 30 seconds. The devices involved are managed (JumpCloud, Mimecast).

**Diagnosis, measured rather than guessed:**
- The lobby code path itself works: a scripted host + guest against the live site joined in about
  1.4s, including a lowercase room code (the input upper-cases on every keystroke).
- The PeerJS broker is reachable from a managed device (`https://0.peerjs.com/peerjs/id` returned an
  id there), so Mimecast is not blocking signalling. The failure is at the ICE / peer-to-peer step.
- **The only TURN relay the game offered no longer exists.** `eu-0.turn.peerjs.com` and
  `us-0.turn.peerjs.com` return no A record from Google or Cloudflare DNS, and Chrome's ICE probe
  logged `TURN host lookup received error` for both. The 2026-07-06 note above assumed this relay was
  a working baseline.
- **The game's own relay was never switched on.** Live `/api/turn-credentials` returns
  `{"iceServers":[]}`: the Metered.ca signup noted as pending on 2026-07-06 never happened (or its
  env vars are wrong).
- So every connection was STUN-only. Two peers behind a strict firewall or symmetric/carrier-grade
  NAT (typical of managed devices and corporate networks, which often block UDP entirely) have no
  path, and ICE fails. A simulated UDP-blocked guest (`--force-webrtc-ip-handling-policy=
  disable_non_proxied_udp`) reproduced it exactly.

**Fixes (code):** removed the dead PeerJS TURN entries (STUN only, from Google and Cloudflare, until
a relay is configured); the guest now gives up after 25s with a "your network is blocking
peer-to-peer play" message instead of hanging, and an ICE failure no longer shows the misleading
"The host disconnected."; the host's lobby explains a failed join instead of printing PeerJS's raw
"Negotiation of connection to <uuid> failed."; the host re-registers its room code automatically if
its broker websocket drops (previously the code silently died until reload); a lost broker websocket
no longer ends a guest's running match; the data channel is now ordered (`reliable: true`).

**Relay switched on (same day):** Gustav created the Metered.ca app `hunter-n-goose` (free 20GB
plan) and set `METERED_APP_NAME` / `METERED_API_KEY` in the Cloudflare Pages project; a redeploy
picked them up. Live `/api/turn-credentials` now returns 5 entries, including
`turns:standard.relay.metered.ca:443?transport=tcp`. Verified: a relay-only ICE probe allocated
relay candidates over UDP, TCP and TLS, and the simulated UDP-blocked guest that previously timed
out joined a live production lobby in 4.6s. If joins regress, first check that endpoint still
returns servers (an empty list means the env vars are missing or Metered's free quota ran out).

## Three and four players (v4.4.0)

The room always held four players (a host star, `MULTIPLAYER_MAX_PLAYERS = 4`), but several things
only broke with three or more. The design is `docs/squad-arsenal-night.md` section 1; this is what
was built and how it is checked.

### The seven gaps and their fixes

1. **Late joiner resync.** A third or fourth player joining mid-match used to miss shared state
   that only live messages carry. `network/matchSync.ts` now builds one full answer from the host's
   own managers (`MatchMessageRouter.sendFullSync`, one answer for both sync requests): the roster,
   the King of the Hill carrier or the golden goose's resting place, the wandering geese, the Horde
   wave with its eliminated slots, live flock and finished result, the ammo crates, the bonus goose,
   geese in the air, and the host's verdict if the match is already decided.
2. **Concurrent joins.** The roster used to be read before the join awaited player creation, so one
   joiner could miss another's announcement. The roster is read after the await (`onHostHello`).
   `rosterSync` lets a client that finds itself short of an opponent ask again.
3. **Ghost player.** An opponent that finished loading after its `playerLeft` stayed forever. Every
   add and remove of a slot bumps a generation (`opponentGenerations` in `Game.ts`); a load whose
   generation is stale is dropped, and a joiner that left while its model loaded is never announced.
4. **Scoreboard.** Rows come from `scoreboardRows` (`ui/multiplayerHud.ts`): the union of your own
   slot, every opponent and every kept score, so a zero score has a row and a score kept after a
   leave keeps its name.
5. **King of the Hill drop race.** Claims are not arbitrated, so a claim only takes the goose from a
   higher slot (`acceptsGoldenGooseClaim`), and a relayed drop only applies from the carrier the
   client knows (`acceptsGoldenGooseDrop`). Every client applies the same rule and settles on the
   same carrier.
6. **Gun Game finisher bypass.** The kill that would reach the limit only counts when made with the
   Goose Launcher (`creditsKill`, `applyMatchDeath`), so the rule is in the scoring and does not
   depend on the weapon swap finishing in time. Every `damageEvent` carries the weapon id for it.
7. **Ping to other guests.** No longer guessed as twice the host link: it is measured (see below).

### Found by the browser test: a loading player was dropped

The host drops an opponent that has been silent for `MULTIPLAYER_CONNECTION_TIMEOUT_MS` (8 s). A
player sends no snapshots while its world is being built, and a late joiner or rejoiner (and, with
four pages at once, a starting guest) can take far longer than that, plus a stall of about 10 s on its
first frames: the host closed its connection and ended its match as "opponent disconnected" a few
seconds after the world appeared. The sweep now goes by `isOpponentSilent` (`core/opponentLiveness.ts`):
a player that has not sent a snapshot yet, or sent its first less than `MULTIPLAYER_SETTLE_MS` (30 s)
ago, gets `MULTIPLAYER_LOADING_TIMEOUT_MS` (120 s) after its last message; only a settled player is held
to the 8 s rule. Only a `playerSnapshot` starts the clock, because the connection layer sends messages
(mesh hellos, link reports) while the world is still loading.

### Direct guest-to-guest links

Guest A's position used to reach guest B through the host: two hops and the host's upload.
`network/GuestMesh.ts` opens a link between each pair of guests (the lower slot dials the higher
one, using the PeerJS id every roster entry carries) and checks it with a `meshHello { slot,
roomCode }`, so a stray connection is closed. The link opens the same fast channel as host links
and is kept alive by hellos every second.

- **What goes direct.** Only `playerSnapshot`, `fireEvent` and `footstepEvent`
  (`DIRECT_MESSAGE_TYPES` in `network/directLinks.ts`). Damage, deaths, respawns, mode state and
  world objects stay on the host path, so authority and ordering are unchanged.
- **The host's relay rule.** Each guest reports its live links to the host (`meshStatus`). The host
  stops relaying those three types between two guests only while both list each other
  (`MeshRelayPolicy`), and resumes the moment either reports the link gone or leaves. A guest that
  never reports is relayed to as before.
- **The duplicate filter.** While the host has not yet seen both sides of a new link, a fireEvent or
  footstepEvent arrives twice. Each copy carries the sender's never-repeating clock `t`, and the
  receiver drops the second one. A snapshot needs no filter: receivers already drop any that is not
  newer than the last applied.
- **Fallback.** A link that never opens (strict NAT, no working TURN relay) is retried a few times
  with a growing delay, then left alone until the roster changes (a rejoin brings a new PeerJS id).
  Nothing depends on a link, so the match plays exactly as before.

### Measured ping

The HUD line shows one round trip per opponent (`formatOpponentPings`). Each side reads the
browser's own connection statistics (`readConnectionQuality`): a guest measures the host and every
guest it has a live direct link to. For a guest without a link it adds its own link to the host and
the host's reported link to that guest (`linkQuality`, `combineRelayedQuality`), which is the path
that guest's updates take. Each opponent is also predicted ahead by half its own round trip.

### Browser test

`e2e/multiplayer-four.spec.ts` (group `mp4`; see `docs/testing.md`) runs on the Valley with the
default mode, one browser context per player, over real WebRTC:

- **Four players:** every page sees three opponents in distinct slots; direct links are read
  (`getNetworkDebug().directLinksReady`: a guest's own count, the host's count of linked pairs) and
  logged, not asserted, because headless contexts may not open WebRTC links to each other; one
  guest kills another with real pistol shots and every scoreboard shows the kill; the killer closes
  its page, the others drop to two opponents, and it comes back in a new context with its old rejoin
  token (`sessionStorage`, `core/multiplayerRejoin.ts`) into the same slot with its score.
- **Mid-match join:** three players start, one kills another, and a fourth player joins fresh: it
  sees three opponents, the full scoreboard with names and the kill, and the others see it.

Four pages at about 2 FPS each make it the slowest spec (budgets of 15 and 12 minutes; just creating,
joining and starting four players took 2.5 to 5 minutes here, depending on what else the laptop was
running). It runs on its own: `E2E_PORT=5181 npx playwright test
e2e/multiplayer-four.spec.ts`.
