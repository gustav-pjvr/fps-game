# FPS Game — Whole-Codebase Review and Assessment

*Comprehensive review conducted 2026-07-05 (Fable 5 model), covering the entire codebase — not a single-feature or diff review.*

**Scope:** ~7,500 lines of TypeScript across `src/` and `e2e/`, plus Vite/Playwright config and the running dev logs (`NOTES.md`, `PLAN.md`, `WORLD_PLAN.md`, `PERFORMANCE.md`). Stack: Three.js 0.185, Rapier (WASM, `rapier3d-compat` 0.19), Vite 8, TypeScript 6, Playwright e2e only (no unit tests).

**Overall verdict:** This is an unusually disciplined codebase for its size. Comments consistently explain *why* (often citing empirical verification), determinism is taken seriously (seeded RNG streams with documented offsets), teardown paths mostly exist, and NOTES.md shows genuine bugs being found by running the game rather than reasoning about it. The real weaknesses are: a handful of concrete lifecycle bugs (an `AudioContext` leak per match, a spawn/teardown race, an undisposed listener), a growing pile of dead config constants left behind by the archetype refactor, per-frame terrain sampling in the enemy hot path that will scale poorly, and a test suite that covers the core loop well but leaves the entire world-generation and AI-combat surface untested (and is coupled to fragile entity-index assumptions).

---

## 1. Architecture Overview

**Composition:** `src/core/App.ts` is a small top-level state machine (lobby → setup modal → loading → match → back to lobby). `Game.ts` (500 lines) is the composition root: `Game.create()` builds Renderer, InputManager, PhysicsWorld, world managers (Chunk/Vegetation/Building/Road), Player, WeaponManager, EntityManager, and ~12 UI widgets, then wires them via callbacks.

**Per-frame data flow** (`Game.update`, Game.ts:434-483): pause check (pointer-lock state is the single source of truth for "paused" — a genuinely elegant decision, documented at line 435) → player input/movement → `physics.step` → chunk streaming → weapons → entities → cosmetic systems (tracers, markers, HUD). Rendering is a separate fixed-timestep `Loop` (Loop.ts) with an accumulator; `render(alpha)` receives an interpolation factor that is **never used** (`_alpha`, Game.ts:485) — see Performance below.

**What holds up well:**
- **Decoupling via hooks.** `ChunkStreamHooks` (ChunkManager.ts:39-42) lets vegetation/buildings/roads hang off terrain streaming without ChunkManager knowing they exist. Combat cosmetics (tracers/impacts/sounds) are injected callbacks into both `WeaponManager` and `Enemy` (`EnemyCombatHooks`), keeping combat logic renderer-free.
- **Determinism architecture.** One mutable world seed (`worldSeed.ts`), with every generator deriving `mulberry32(seed + offset)` and documented distinct offsets (terrain +0, ridge +1, vegetation density +2, forest texture +13, flat zones +10, forests +11, town layouts +12, archetypes +101). Town layouts and roads are pure memoized functions of cell coordinates, so streaming order can't diverge (`BuildingManager.getTownLayout`, `RoadManager.getTownRoadLayout`).
- **Lifecycle discipline.** `Game.dispose()` (Game.ts:342-359) tears down GL, HUD DOM, input listeners, and frees the Rapier WASM world (`PhysicsWorld.dispose`, with the comment correctly noting WASM memory isn't GC'd).

**What's structurally fragile:**
- **`Game` as a 22-parameter constructor** (Game.ts:102-125). It's mostly wiring, not logic, so it's less harmful than a classic God object, but every new system adds a constructor parameter, a `create()` line, and usually a `dispose()` line — three places to forget. A `GameSystems` bag or a small registry (anything with `update(dt)`/`dispose()` interfaces iterated in order) would collapse the boilerplate. The `scoreState` holder and `gameRef` forward-reference (Game.ts:90-94, 287-302) are documented workarounds for construction-order circularity; they work, but they're symptoms of the same shape.
- **Two documented "clever wiring" hacks** — score in a shared mutable holder, PauseMenu created before SettingsPanel purely for DOM paint order (Game.ts:295-296) — are the kind of implicit ordering that breaks silently when someone reorders `create()`.

---

## 2. Concrete Bugs and Lifecycle Issues

These are the highest-value findings — real defects identifiable from reading:

### 2.1 `SoundEngine` leaks an `AudioContext` (and a running oscillator) per match — **HIGH**
`SoundEngine` has no `dispose()`, and `Game.dispose()` (Game.ts:342-359) never touches it. Each `Game.create()` makes a fresh `new AudioContext(...)` (SoundEngine.ts:50) *plus* a permanently running keep-alive oscillator (`startKeepAlive`, SoundEngine.ts:60-67) that connects **directly to `ctx.destination`, bypassing the master gain** — so it also ignores the volume setting. Browsers cap concurrent `AudioContext`s (Chrome historically ~6); repeated lobby↔match cycles will eventually fail to create new contexts and audio will silently die. Fix: add `dispose(): void { void this.ctx.close(); }`, call it from `Game.dispose()`, and route the keep-alive through `this.master`. Small change.

### 2.2 `resetPlay` spawn race / use-after-free — **HIGH (edge case)**
`resetPlay()` fires `void Game.spawnEncountersAsync(...)` without awaiting or cancellation (Game.ts:371). `spawnEncountersAsync` yields to `requestAnimationFrame` between batches (Game.ts:417, 428). Two consequences:
- Pressing **T twice quickly** (or Respawn then T): the second `clearAll()` clears entities spawned so far, but the *first* still-running spawn loop keeps pushing entities afterward → entity count exceeds the configured match size. The e2e assertion `getEntityCount() === 8` would only catch this with unlucky timing.
- **Respawn then immediately "Return to Lobby"**: `App.returnToLobby()` calls `game.dispose()` → `physics.world.free()`, while the in-flight spawn loop continues on subsequent frames and calls `spawnEnemy` → `physics.world.createRigidBody` on a **freed WASM world** — undefined behavior / thrown WASM errors.

Fix: a generation counter or `AbortSignal` checked between batches in `spawnEncountersAsync`, bumped by `resetPlay` and `dispose`. Small change.

### 2.3 `InputManager` never removes its `contextmenu` listener — **MEDIUM**
The listener is registered as an anonymous arrow function (InputManager.ts:25) and `dispose()` (InputManager.ts:111-120) removes every listener *except* it. Each lobby↔match cycle stacks another document-level `contextmenu` preventDefault. Harmless functionally (they're idempotent) but it's a leak and inconsistent with the otherwise-careful dispose. One-line fix.

### 2.4 `Settings.getKeyBindings()` returns the internal mutable object
Settings.ts:64-66 hands out `state.keyBindings` directly; any caller mutation would silently persist wrong bindings on the next `persist()`. All current callers only read, so it's latent, not live. Return a copy or `Readonly<Record<...>>`. Trivial fix.

### 2.5 Kinematic enemies can clip through obstacles while chasing
`Enemy.applyPosition` uses `setNextKinematicTranslation` (Enemy.ts:587-591) — kinematic bodies **do not resolve collisions**; the only thing keeping enemies out of walls is steering. Patrol/search/kite use whisker avoidance, but chase deliberately beelines (`moveToward`, no avoidance — Enemy.ts:326, acknowledged in the comment at Enemy.ts:544-546: "chase deliberately keeps beelining straight at the player for now"). A head-height LOS ray can clear *past* a tree trunk or a rock whose collider still blocks the direct ground path, so a chasing enemy can walk visibly through a trunk/boulder. This is a known/documented simplification, not an oversight — but it's the most player-visible AI artifact in the codebase. Using `moveTowardWithAvoidance` for chase too would cost 3 short raycasts per chasing enemy per frame and mostly fix it.

### 2.6 Tracer list is unbounded
`ImpactMarkers` caps at `MAX_MARKERS = 24` (ImpactMarkers.ts:4), but `Tracers.active` has no cap (Tracers.ts:27-38). Each tracer is a full `THREE.Mesh` added/removed from the scene. With a 50-enemy match, an 8-pellet shotgun and enemy bursts, dozens can be live simultaneously; not a leak (they self-remove) but the asymmetry with ImpactMarkers is an inconsistency, and per-shot `new THREE.Mesh` churn is avoidable with the same pool pattern.

### 2.7 Minor
- `Game.resetPlay` does not reset camera yaw/pitch — after respawn the player faces wherever they died. Arguably a feature; worth a deliberate decision.
- `WeaponManager.updateAim` calls `camera.updateProjectionMatrix()` every frame even when `aimAmount` hasn't changed (WeaponManager.ts:215-216). Cheap, but a `if (changed)` guard is free.
- `ChunkManager`'s ground material/texture and `VegetationManager`'s instanced meshes/geometries are never explicitly disposed on match teardown — currently masked because `Renderer.dispose()` kills the whole GL context per match, but if the renderer is ever reused this becomes a leak.

---

## 3. Code Quality Per System

### World generation (`src/world/`) — strongest module in the project
`ZoneMap.ts` is exemplary: the guaranteed-sites mechanism documents two failed prior approaches and two code-review-caught numeric subtleties (ZoneMap.ts:172-247), and `getFlatZoneSite`'s nearest-site-wins consistency check (ZoneMap.ts:333-363) closes a real town-on-unflattened-ground bug. `BuildingManager.measurePreset` measures actual asset bounding boxes instead of trusting hand-inspected numbers, including the off-center footprint fix (BuildingManager.ts:82-102). Nits:
- `townCellKey` is defined identically in both BuildingManager.ts:104 and RoadManager.ts:60 — trivially DRY-able into `chunkSeed.ts` next to `chunkKey`.
- `smoothstep` is duplicated in ZoneMap.ts:141 and TerrainGenerator.ts:33.
- **VegetationManager samples forest membership only at the chunk center** (VegetationManager.ts:187) to decide the candidate budget. A chunk whose corner overlaps a forest but whose center is outside gets only 24 candidates instead of up to 464 → forest density visibly falls off along chunk-boundary lines through forest edges. Sampling max membership at the 4 corners + center would fix it cheaply.
- **RoadManager segment ownership by midpoint** (RoadManager.ts:106-109): a long segment whose midpoint lies in a not-yet-loaded chunk won't render even when both endpoints' chunks are loaded — roads can pop in late relative to their buildings. Cosmetic, low severity.
- Roads have no colliders and use one flat `groundY` from the town site center (RoadManager.ts:112) — correct only because buildings are constrained to the flat core; if `TOWN_BUILD_FRACTION` ever rises past `FLAT_ZONE_INNER_FRACTION`, roads would float/clip. The invariant is implicit; worth an assertion or comment linking the two constants.

### Enemy AI (`src/entities/enemies/`) — coherent, one design seam
The state machine (idle/alert/chase/search, Enemy.ts:247-284) is clean: pure transitions separated from movement, throttled LOS checks with randomized phase offsets (Enemy.ts:135), engagement slots to prevent dogpiling. Genuinely good touches: `hasLineOfSight` excluding the whole rigid body (documented self-hit bug, enemySteering.ts:92-95), kite hysteresis, stuck detection with pluggable `onStuck`.

Issues:
- **Seeded vs. unseeded RNG inconsistency:** archetype assignment is seeded per world (`createArchetypePicker(getWorldSeed())`, EntityManager.ts:31) explicitly for reproducibility, but patrol destinations and repath timers use raw `Math.random` (Enemy.ts:499-500), and so do aim spread/melee spread (Enemy.ts:420-421, 460-461). Combat spread being non-deterministic is fine (matches player weapons), but patrol using `Math.random` half-defeats the "reproducible world" story and makes AI behavior untestable deterministically. `pickPatrolDestination` already takes `rng: () => number` as a parameter — the plumbing exists; only the call site passes `Math.random`.
- **Dead archetype fields:** `kiteTriggerRange: 0`/`kiteStopRange: 0` on non-kiters are self-described as "a dead value, not a meaningful 'never kite'" (archetypes.ts:27-29). A discriminated union (`movementStyle: { kind: 'direct' } | { kind: 'kite'; triggerRange; stopRange }`) would make invalid states unrepresentable. Same for Rush Job's `rangedDamage: 0, burstCount: 0` relying on branch-order unreachability (archetypes.ts:98-101) — it works, but the safety is positional, not typed.
- `updateSearch` stops moving when close and just idles out the timer (Enemy.ts:491-496, documented) — reads as "gives up on the spot"; a small look-around scan would sell it better. Deliberate scope choice per the docstring.

### Weapons/combat (`src/weapons/`, `src/combat/`) — solid
`Weapon.ts` is a tight little state machine. `Infinity` magazine for melee (definitions.ts:10-12) is a clever documented trick and `Hud.setAmmo` handles the display case (hud.ts:56-61). `WeaponManager`'s muzzle-offset computation has an excellent double-counting explanation (viewModel.ts:70-75). The knife's `reloadTime: 0` can't divide-by-zero in `reloadProgress` because `startReload` returns false when `ammo === magazineSize` and `Infinity === Infinity` — correct but fragile-by-coincidence; a `kind === 'melee'` guard would be more honest.

**Duplicated spread-cone math:** the two-axis-angle spread technique appears four times — `WeaponManager.firePellet` (WeaponManager.ts:260-261), `Enemy.fireRangedShot` (Enemy.ts:420-421), `Enemy.updateMelee` (Enemy.ts:460-461) — each with the same known bias (two independent axis rotations produce a square-ish, diagonally-biased distribution rather than a true circular cone; at these small angles it's imperceptible, but it's tripled code). A `applySpreadCone(direction, halfAngleRad, rng)` helper in `combat/` would DRY it and centralize any future fix.

### Physics (`src/physics/`) — small and correct
The `KINEMATIC_FIXED` active-collision-types fix for ladder sensors (BuildingManager.ts:310-317) and the handle-recycling comment on `unregisterClimbable` (BuildingManager.ts:191-196) show real understanding of Rapier's edge cases. The mid-climb sensor-swap bug and its lock-to-specific-collider fix (PhysicsWorld.ts:69-95, Player.ts:159-188) are well documented.

### Player (`src/entities/Player.ts`) — good; one subtle detail
The climb/mantle state machine is intricate but each branch is justified with a tested failure mode. `applyLook` scaling sensitivity by FOV ratio (Player.ts:144) is a nice ADS-feel touch. Note: `justReachedTop` (Player.ts:188) relies on the invariant "climbing has zero horizontal drift", which is enforced two branches away (`desiredMovement = {x:0, ...}`, Player.ts:206) — correct today, but the invariant and its consumer are far apart; a shared comment marker or an assertion would guard refactors.

### UI (`src/ui/`) — appropriately simple
DOM-based HUD with inline `cssText`, per-widget `dispose()`, `data-testid`s for the e2e suite. No framework, which is right for this scale. Colors like `#3ecf5f` (health bar, hud.ts:33; lobby glow, LobbyScene.ts:73) are repeated magic values — a tiny `theme.ts` would help if UI grows. Nothing structurally wrong.

### Audio (`src/audio/`) — good fallback design, one leak
Sample-with-procedural-fallback (SoundEngine.ts:78-101) with per-sample error tolerance (SoundEngine.ts:19-23) is nice. The `AudioContext` leak (§2.1) is the one real defect. Also: all sounds are non-positional — enemy gunshots play at full volume regardless of distance/direction, which matters now that enemies fire real ranged shots; distance-attenuated gain (even without full HRTF panning) would be a cheap, large gameplay-feel win.

### Input/settings — clean
`InputManager`'s consume-based just-pressed semantics are correct for fixed-timestep polling. `Settings.rebindKey`'s both-directions unbind (Settings.ts:68-76) is correct. Issues already noted (§2.3, §2.4).

### Dead code / stale config — **the biggest hygiene item**
The per-archetype refactor left `config.ts` with a block of now-dead constants, verified by grep: `ENEMY_HEALTH`, `ENEMY_SPEED` (alive only via `ENEMY_PATROL_SPEED`), `ENEMY_RANGED_RANGE`, `ENEMY_RANGED_DAMAGE`, `ENEMY_RANGED_FIRE_INTERVAL`, `ENEMY_RANGED_BURST_COUNT`, `ENEMY_RANGED_BURST_PAUSE`, `ENEMY_AIM_ERROR_MAX_DEG`, `ENEMY_AIM_ERROR_MIN_DEG`, `ENEMY_AIM_SETTLE_TIME`, `ENEMY_ATTACK_DAMAGE` have **zero uses outside config.ts** (config.ts:56-113). Worse, their values are duplicated as The Straggler's baseline in archetypes.ts:48-66, and the long Phase C/E tuning comments in config.ts (lines 89-113) now describe numbers the game reads from archetypes.ts instead — **stale documentation that will actively mislead the next tuning pass** (editing `ENEMY_RANGED_DAMAGE = 9` in config does nothing). Either delete them or make archetypes reference them. Small change, high confusion-prevention value.

---

## 4. Gameplay Systems Assessment

**AI internal consistency:** Good. The detection-vs-spawn-ring invariant (Ridge Walker's `detectionRange` must stay below `ENEMY_RING_BASE_RADIUS = 25`) was learned the hard way and is documented in archetypes.ts:70-76 — but it is **enforced only by comment**. Any future archetype (the two "reserved" names) can silently reintroduce match-start sniping. This is exactly the kind of invariant a 5-line unit test over `ENEMY_ARCHETYPES` would lock in permanently.

**Balance reading from the numbers:**
- *Ridge Walker* (archetypes.ts:77-96): 22 damage/shot, 1-shot bursts every ~2.9s, aim error 6°→1° over 3s. At its 30-unit range with the player's non-scoped weapons (pistol 20 dmg/shot vs 40 HP = 2 hits), it's punishable and fair. Reasonable.
- *Rush Job*: 90 HP, moveSpeed 3.4 vs player walk 5 / sprint 8 — it can never catch a player who backpedals-and-shoots at walk speed while facing it, since backpedal speed (5) exceeds 3.4. Its melee threat only lands on a distracted/cornered player. That may be intended, but "faster than the player's walk speed so it actually closes the gap" (archetypes.ts:100-102) is only true when the player walks *toward* it or stands still; the comment slightly oversells it.
- *Shotgun* (definitions.ts:77-95): 8 pellets × 10 = 80 max damage vs enemy 40-90 HP — one-taps a Straggler at close range but at spread 0.08 rad, pellet falloff with range is purely geometric (no damage falloff exists anywhere). At long range a lucky single pellet still does full 10 damage at 500 units — the shared `HITSCAN_RANGE = 500` (WeaponManager.ts:30) means shotgun pellets are 500-unit hitscans. Cosmetically odd; adding per-weapon `range` (the field already exists for melee) to the shotgun would fix it in data only.
- *Sniper*: 90 damage + 3× headshot = enough to one-shot anything; 40 HP targets die to a body shot. Coherent as the power pick balanced by fire rate 0.8 and scope-only accuracy (`adsSpreadMultiplier: 0.02` vs hip 0.02 rad spread — hip-firing the sniper is genuinely punished). Weapon roster is coherent overall, with distinct roles and consistently good flavor text.
- *Player TTK vs enemy TTK*: an aim-settled Straggler burst (3×9 = 27/burst every ~2.6s) kills a stationary player in ~4 bursts ≈ 10-12s; the tuning note at config.ts:102-106 says this was deliberately measured and raised. Fine.

**World generation edges:**
- The bounded-world edge treatment (ramp + soft push + hard clamp, Player.ts:260-282) is defense-in-depth that was empirically driven (NOTES.md wedge bug) — the strongest-engineered edge case in the project.
- `computeGuaranteedSites` correctly bails when `maxDistance <= minDistance` (ZoneMap.ts:208) — shrinking the world below ~2× zone radius degrades gracefully to "no guarantee" rather than crashing, though it *silently* loses the min-towns guarantee; a `console.warn` there would be appropriate given the constant's documented purpose.
- Enemy spawn ring vs. terrain: `spawnEnemy` places at `sampleHeight(x,z)+1` (Game.ts:425) and enemies then glue themselves to terrain each frame, so extreme seeds can't strand them; the spawn-clearing flattening (TerrainGenerator.ts:21-44) protects sightlines. Sound.
- One genuine fragility: **town/forest zone overlap is unresolved at the zone level** — flat and forest grids are independent (ZoneMap.ts:304-306 admits "overlap is resolved by callers"), and VegetationManager suppresses trees on flat zones (VegetationManager.ts:204), but the *terrain* of an overlapping forest membership isn't flattened and forest candidates just outside the flat membership edge can hug town rims. Works today; will bite if buildings ever spawn nearer the rim.

---

## 5. Performance (code-level)

- **`sampleHeight` in the enemy per-frame path is the main scaling risk.** Every enemy calls `applyPosition` → `sampleHeight` every frame it moves (Enemy.ts:588). `sampleHeight` = 4-octave simplex fBm + spawn-clearing check + `sampleFlatZone` → 9-cell Worley scan, each cell constructing a fresh `mulberry32` and hashing, plus a guaranteed-sites linear `find` (ZoneMap.ts:59-61, 96-110). At `MAX_MATCH_ENTITY_COUNT = 50` that's 50 fBm+Worley evaluations per 60Hz tick — thousands of noise calls/sec for what is nearly static data. A cheap fix: cache last (x,z,height) per enemy and only resample when the enemy moved > ~0.25 units; a better one: bilinear lookup into the already-generated chunk heightfields. Medium change, biggest hot-path win available.
- **LOS raycasts are already well-throttled** (0.15s per-enemy cadence with phase jitter, config.ts:85-87, Enemy.ts:100-103) and skipped beyond leash range (Enemy.ts:209-212) — good. Whisker avoidance adds 3 raycasts/frame per *moving* patrol/search/kite enemy; acceptable, but it's the second-largest per-enemy cost and is why extending it to chase (§2.5) should be measured.
- **Chunk generation is main-thread and heavy but budgeted** (`MAX_CHUNK_GENERATIONS_PER_TICK = 2`). Each chunk = 65×65 `sampleHeight` calls (~4,200 fBm + Worley evaluations) plus a heightfield collider build and vegetation candidate loop (up to 464 candidates in forests, each sampling zones/noise and doing an O(placed) spacing scan — worst case ~460×160 distance checks, VegetationManager.ts:214-218). p95 frame spikes during fast travel are the expected symptom; the FpsMeter's p95 was built precisely to see this. A worker-based heightfield generation is the eventual fix; a cheaper interim is lowering the budget to 1 chunk/tick or amortizing the vegetation loop across frames.
- **Unused render interpolation:** the Loop computes `alpha` but `render(_alpha)` ignores it (Game.ts:485). Simulation is 60Hz; on 120/144Hz displays entity and camera motion will visibly step at 60Hz while rendering faster. Since bodies are kinematic with known prev/next positions, interpolating mesh transforms by alpha is feasible — medium change, only matters for high-refresh users.
- **Per-frame micro-allocation** is pervasive but standard for this scale: `Player.applyMovement` allocates ~6 vectors/quaternions per tick, `player.position` getter allocates a `Vector3` and is called by every enemy plus Game; `getLiveEntityPositions().map(clone)` allocates per debug poll. None of this is worth fixing until profiling says so — noted, not flagged.
- **Rendering:** vegetation instancing with high-water-mark `mesh.count` (VegetationManager.ts:313-321) is the standout — the whole forest costs a handful of draw calls. Buildings are per-instance cloned scenes (dozens of draw calls per town), the accepted trade documented in NOTES.md. No frustum-culling concerns beyond Three defaults. Shadow map uses default 512×512-ish settings with an uncontrolled shadow camera on the directional light (Game.ts:383-386) — shadow quality/cost is untuned; if towns look shadow-acneish, this is why.

---

## 6. Testing

**What exists:** 16 smoke tests (`e2e/smoke.spec.ts`) + a manual world-bounds test + an informational perf script. There are **no unit tests** and no test runner besides Playwright.

**Well covered:** boot without console errors; pointer lock/pause/resume/reset/return-to-lobby lifecycle (the strongest area — 6 tests including teardown verification via `window.__gameDebug === undefined`); firing/ammo/reload/auto-reload; weapon switching; ADS FOV; target kill → score; enemy idle-patrol-not-beeline; full death flow via real combat damage (`killPlayerByEnemy` deliberately refuses a debug-damage cheat — principled, but see below).

**Completely untested:** everything in `src/world/` (terrain determinism, zone placement, guaranteed-zone minimums, town layout, roads, chunk load/unload including the building/ladder handle-recycling cleanup path), the ladder/climb/mantle mechanic (despite dedicated debug hooks `isClimbing`/`getActiveLadderPositions` existing for it — suggesting a test was planned and never written), enemy ranged combat (aim settle, bursts, engagement-slot cap), search/leash transitions, kiting (only incidentally exercised via `killPlayerByEnemy`'s widened timeout), archetype distribution (the verification test was written and **deleted** per NOTES.md), shotgun pellets, sniper scope overlay, knife, settings persistence/rebinding, world-edge clamp (its test exists but isn't in the smoke suite), and the HUD beyond ammo numbers.

**Maintainability problems:**
1. **Index-5 coupling.** Three tests and `killPlayerByEnemy` hard-code "index 5 is an enemy" and "8 total entities" (smoke.spec.ts:163-166, 215, 267; helpers.ts:63), which is only true for the default 5-target/3-enemy match and the current spawn order in `spawnEncountersAsync`. Reordering spawns or changing defaults breaks four tests obscurely. `getLiveEntityArchetypes()` already exists — a `findFirstEnemyIndex(page)` helper would decouple this.
2. **Wall-clock timing sensitivity.** The suite has a documented history of flakes from exactly this (NOTES.md: the vegetation `mesh.count` regression failing the auto-reload test; the pre-existing 1-in-6 auto-reload flake; `killPlayerByEnemy` widened 40→50→90s). Mitigations applied are sensible (teleport-away, sprint approach, `test.setTimeout`), but the underlying pattern — real-time combat as test infrastructure — makes the two death-flow tests cost up to 90s each and remain the most fragile. A single debug-only `damagePlayer(n)` hook would cut suite time dramatically; the "no gameplay cheats in `__gameDebug`" principle (Game.ts:57) is admirable but the death *UI flow* doesn't need real combat to be validated — one test could keep the real-combat path, the other could use the hook.
3. **`Math.random` in AI makes behavioral tests unwritable.** Deterministic patrol (§3, seeded RNG) is a prerequisite for any stronger AI assertions than "drifted less than 8 units."
4. **Missing unit-test layer.** The codebase is full of pure, heavily-documented functions that would be trivially and valuably unit-tested with Vitest: `mulberry32`, `membershipFor`/`isSiteClear`/`computeGuaranteedSites` (assert the guarantee actually holds across 1,000 seeds — the exact class of bug ZoneMap's own comments describe finding by hand), `computeMinimumSpanningTree`, `createArchetypePicker` weights, `pickType`/`minTreeSpacingFor` continuity at membership 0 (a regression test for the exact cliff bug the comment at VegetationManager.ts:327-331 describes), archetype invariants (`detectionRange < ENEMY_RING_BASE_RADIUS`, `kiteStopRange > kiteTriggerRange` for kiters). This is the single highest-leverage testing investment available.

---

## 7. Technical Debt & Inconsistencies (summary list)

- Dead enemy-tuning constants in config.ts with stale multi-paragraph tuning comments (§3, verified by grep) — the worst doc-rot in the repo.
- Seeded RNG everywhere in world gen vs. `Math.random` in enemy patrol (Enemy.ts:499-500) despite the picker parameter existing.
- Spread-cone math duplicated 3× (WeaponManager/Enemy ranged/Enemy melee).
- `townCellKey` duplicated (BuildingManager/RoadManager); `smoothstep` duplicated (ZoneMap/TerrainGenerator); `horizontalDistance` private to Enemy.ts while equivalent inline math appears in helpers, ZoneMap, VegetationManager.
- `GuaranteedSite` and `ZoneSite` are structurally identical interfaces (ZoneMap.ts:41-57), and `FlatZoneSite` (ZoneMap.ts:325-331) is a third copy.
- ImpactMarkers pooled/capped; Tracers uncapped/unpooled.
- `SoundEngine` and `VegetationManager`/`ChunkManager` lack `dispose()` while everything else has one (only SoundEngine's is a live bug).
- e2e "magic waits" (`waitForTimeout(100/260/300/500)`) tied to fire rates and lerp speeds by comment only.

---

## 8. Prioritized Improvement Suggestions

| # | What | Why | Size |
|---|------|-----|------|
| 1 | **Add `SoundEngine.dispose()` (close AudioContext, stop keep-alive), call from `Game.dispose()`; route keep-alive through master gain** | Live resource leak that breaks audio after ~6 lobby↔match cycles; keep-alive also bypasses volume (SoundEngine.ts:50, 60-67; Game.ts:342) | Small |
| 2 | **Cancel in-flight `spawnEncountersAsync` on reset/dispose** (generation counter checked after each `waitForNextFrame`) | Double-spawn on rapid reset; use-after-free on the freed WASM world if lobby is entered mid-spawn (Game.ts:371, 417, 428) | Small |
| 3 | **Delete or re-point the dead `ENEMY_*` constants and their stale tuning comments in config.ts; have archetypes.ts baseline reference the survivors** | Editing them silently does nothing; the comments actively misdirect the next balance pass (config.ts:56-113 vs archetypes.ts:45-123) | Small |
| 4 | **Add a Vitest unit layer for the pure functions** — ZoneMap guarantee across many seeds, MST, archetype invariants (detectionRange < spawn ring, kite ranges), `pickType` continuity, mulberry32 | Locks in three invariants that have *already* been broken once each and were caught only by hand; near-zero runtime cost; addresses the 0%-unit-coverage gap | Medium |
| 5 | **Seed enemy patrol RNG per-enemy from the world seed** (plumbing already exists via `pickPatrolDestination(spawn, rng)`) | Completes the determinism story; unlocks reproducible AI bug reports and stronger e2e assertions | Small |
| 6 | **Cache terrain height per enemy (resample on >0.25u movement) or read from chunk heightfields** | Removes ~50 fBm+Worley evaluations per tick at max match size — the clearest hot-path scaling issue (Enemy.ts:588, TerrainGenerator.ts:102-125) | Small-Medium |
| 7 | **Fix `InputManager` contextmenu listener removal; return a copy from `Settings.getKeyBindings`** | Listener stacking across matches; latent shared-mutable-state trap (InputManager.ts:25; Settings.ts:64) | Small |
| 8 | **De-index the e2e suite** (`findFirstEnemyIndex` via `getLiveEntityArchetypes`) and add a debug damage hook for *one* of the two death-flow tests | Removes the most fragile coupling; cuts up to ~3 min of worst-case suite time (helpers.ts:55-90; smoke.spec.ts:163, 251, 274) | Small |
| 9 | **Extract `applySpreadCone()` into `src/combat/`** | 3× duplicated math with a shared subtle distribution bias; one place to fix/tune (WeaponManager.ts:260, Enemy.ts:420, 460) | Small |
| 10 | **Use whisker avoidance during chase** (swap `moveToward` → `moveTowardWithAvoidance` at Enemy.ts:326) | Most player-visible AI artifact: chasing enemies clipping through trunks/rocks; already acknowledged as deferred | Small (plus perf check) |
| 11 | **Distance-attenuated enemy gunshot volume** | Enemies now fire real ranged shots from up to 30 units; uniform full-volume gunshots undermine the tracer-based "fair combat" readability goal (SoundEngine.ts:78, Game.ts:270-274) | Small-Medium |
| 12 | **Sample forest membership at chunk corners, not just center, for the candidate budget** | Removes chunk-grid-aligned density cliffs at forest edges (VegetationManager.ts:187) | Small |
| 13 | **Render interpolation using the Loop's unused `alpha`** | Smooth motion on >60Hz displays; the accumulator design already anticipates it (Loop.ts:41, Game.ts:485) | Medium |
| 14 | **Introduce a `GameSystems` registry to collapse Game's 22-param constructor and mirrored dispose list** | Every new system currently touches 3+ boilerplate sites; the two documented forward-ref hacks are symptoms (Game.ts:96-333) | Medium |
| 15 | (Longer-term) **Worker-thread chunk generation** | Eliminates the p95 spikes during fast travel that the FpsMeter/p95 tooling was built to observe; only worth it if real-hardware p95 numbers confirm | Large |

---

### Closing note on what *not* to change
Several things that might look like flaws are documented, tested decisions and should be left alone: pointer-lock-as-pause (Game.ts:435-443), the direct mantle teleport instead of shape-cast (BuildingManager.ts:319-327 — the shape-cast alternative was tried and failed), F3 bypassing the input system (Game.ts:494-497), `exitPointerLock()` in the e2e pause helper (a verified headless-Chromium limitation, helpers.ts:24-30), the deliberately reserved unused archetype names, and the no-navmesh whisker+stuck-detection approach (explicitly scoped in config.ts:121-128). NOTES.md is doing real work as institutional memory — any cleanup pass should keep updating it in the same style.
