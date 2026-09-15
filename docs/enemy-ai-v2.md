# Enemy AI v2 | Squad tactics

The living design and build record for the solo-play enemy AI upgrade, started 2026-09-15 on the
branch `feature/enemy-ai`. It is updated as each task lands, so at any point it says what the new
system is, why it is shaped that way, what has been built, and what has been measured. The history
of the original AI (patrol, line of sight, ranged combat, melee, archetypes) is in
[enemy-ai.md](enemy-ai.md).

## Goal

Make the single-player enemies read as a squad instead of a set of individual bots. Today each
enemy only knows what it saw itself, stands still while fighting, walks to one spot when it loses
the player, gives no cue about what it is doing, and nothing paces a fight. The target is enemies
that share what they know, take roles (someone pins, someone flanks), use cover, search properly,
say what they are doing, and (in a new opt-in mode) arrive in paced waves.

Multiplayer is untouched: these enemies only exist in single-player, and nothing here changes the
network protocol.

## Research basis

Full report: <https://claude.ai/artifact/S45Eg6v4AcmBZNTgLGLADu> (2026-09-15). The short version:

- **The Last of Us (Naughty Dog):** a sight timer instead of instant detection, a view angle that
  narrows with distance, one shared "last known position", a Combat Coordinator that hands out
  roles (Flanker, Approacher, Investigator, Shooter), position picking by multiplying 0 to 1 scores
  over sampled points with a fixed raycast budget (160 a frame on PS3), and a search grid whose
  probability spreads outward and clears wherever an enemy can see.
- **F.E.A.R. (Monolith):** its famous squad tactics were simple squad behaviours (get to cover,
  advance with a suppressor, search in pairs) plus dialogue that announced them. The planner was
  not what made them look smart.
- **DOOM 2016 (id):** attack tokens per attack type, stealing a token from a worse-placed ally, and
  token count as a difficulty dial.
- **Killzone (Guerrilla):** position picking scored on cover from threats, line of fire, distance
  and travel cost.
- **Left 4 Dead (Valve):** an intensity-driven director (build up, peak, fade, relax) that spawns
  out of sight.
- **Halo (Bungie):** predictable beats random; players reward AI they can read.

What was deliberately ruled out: a GOAP planner, machine-learning bots, and LLM-driven enemies.

## Plan and status

Status key: done, in progress, next, later, conditional.

| # | Task | Status |
|---|------|--------|
| 1 | Research: re-read the enemy code and the world APIs position picking needs | done |
| 2 | Research: measure raycast cost | folded into task 3 (see decisions) |
| 3 | Once-a-second perf logger, plus a runnable perf spec | done (`aac3bab`) |
| 4 | Design: architecture pass by a Fable subagent | done, checked against the code ([design](enemy-ai-v2-design.md)) |
| 0 | Behaviour-preserving split of `Enemy.ts` | done (`92f2767`) |
| 5 | Branch `feature/enemy-ai` | done |
| 6 to 9 | Step 1: squad knowledge, awareness meter, event routing, tests (checkpoint A) | done, checkpoint A passed |
| 10 to 12 | Step 2: combat coordinator and roles (checkpoint B) | done, checkpoint B passed |
| 13 to 17 | Step 3: position picking, ray budget, combat skills (checkpoint C) | done, checkpoint C passed |
| 18 to 19 | Step 4: search grid and paired sweeps | done, checkpoint D passed |
| 20 to 22 | Step 5: callouts, telegraph, stagger (checkpoint D) | done, checkpoint D passed |
| 23 to 25 | Step 6: pacing director as a new opt-in solo mode (checkpoint E) | done, checkpoint E passed |
| 26 to 27 | Step 7: navmesh with recast-navigation-js | not built: 0 of 114 picks unreachable, trigger 20 percent |
| 28 to 30 | Final review, docs and version, merge and deploy | review done, all six findings fixed; released as v3.10.0 |

## Decisions

- **2026-09-15, Gustav:** task 3 changed from "Gustav records a manual F3 baseline" to "build a
  logger that prints FPS and other stats every second, which Claude can run itself".
- **2026-09-15:** task 2 (a separate Node raycast benchmark) was folded into the logger. The
  logger measures raycasts per second and AI milliseconds per tick inside the real game world,
  with real terrain, houses and trees, which is a better number than a synthetic scene would give.
- **2026-09-15, defaults taken while Gustav approved the plan without answering the three open
  questions:** stop at each checkpoint (A to E) for a playtest on the branch preview; Fable
  designs (task 4) and reviews (task 28) while implementation happens on the main thread; the
  pacing director is a separate new solo mode, not a replacement for the current practice setup.
  Any of these can be reopened.
- **2026-09-15, Gustav:** no stopping at checkpoints. Work continues straight through, but each
  checkpoint (A to E) ends with a full test pass (typecheck, unit suite, smoke suite, a perf log
  run compared against the baseline, and a targeted behaviour check) and a documentation update
  here before the next step starts.

## Measurement tooling

`src/core/perfStats.ts` records one row per second during a match:

| Field | Meaning |
|-------|---------|
| `fps`, `frameMsAvg/P95/Max` | Real frames drawn in that second and their timing. Needs a real GPU. |
| `ticks` | Fixed-step updates run (60 when the game keeps up). |
| `physicsMs`, `worldMs`, `aiMs` | Average milliseconds per tick in the Rapier step, world chunk streaming, and `EntityManager.update` (all enemy and target logic). CPU work, so comparable even in the sandbox. |
| `aiMsMax` | The worst single tick's AI time, to catch spikes. |
| `renderMs` | CPU time submitting each frame to WebGL. Needs a real GPU to mean much. |
| `raycastsPerSec` | Every `castHitscan` call: enemy line of sight, shots, whiskers, and player shots. |
| `enemies`, `states` | Live enemies and how many are in each AI state. |
| `drawCalls`, `triangles`, `heapMb` | Renderer and memory context (heap is Chrome-only). |

Ways to use it:

- **Playing normally:** open the game with `?perflog` on the end of the URL (for example
  `http://localhost:5173/?perflog`), or press **F4** during a match. A line prints to the browser
  console every second. F4 again stops printing.
- **Scripted:** `npx playwright test e2e/perf-log.spec.ts` runs a baseline at spawn and then a
  sustained fight, and prints a summary of both. Add `--headed` on a real GPU for frame rates.
  `PERF_ENEMIES` and `PERF_SECONDS` override the enemy count (default 20) and fight length
  (default 30 s).
- **From the console:** `__gameDebug.getPerfLog()` returns every row recorded so far.

## Measurements

Filled in as runs happen. Sandbox rows are CPU-only (SwiftShader, see PERFORMANCE.md): the
sandbox draws 2 to 4 frames a second, so the fixed-step loop hits its 0.25 s frame cap and runs
45 to 60 ticks a second instead of 60. Per-tick milliseconds are the figures to compare.

### Baseline, before any v2 code (2026-09-15, sandbox, 20 enemies, 0 targets)

| Phase | AI ms/tick (worst tick) | Physics ms/tick | World ms/tick | Raycasts/s | Enemies alerted or chasing |
|-------|-------------------------|-----------------|---------------|------------|----------------------------|
| Standing at spawn, 10 s | 0.32 (4.50, first frames) | 1.20 | 0.02 | 2,240 | 1.0 |
| Fight v1, 30 s | 0.26 (1.50) | 1.22 | 0.01 | 3,288 | 0.3 |
| Fight v2, 30 s (the reference for later checkpoints) | 0.26 (4.10) | 1.22 | 0.01 | 2,895 | 5.4 |
| Commit 0, spawn | 0.34 (1.60) | 1.32 | 0.02 | 2,124 | 1.8 |
| Commit 0, fight v2 | 0.25 (3.90) | 1.14 | 0.01 | 2,866 | 6.4 |
| Checkpoint A, spawn | 0.31 (1.80) | 1.20 | 0.02 | 2,235 | 1.2 |
| Checkpoint A, fight v2 | 0.25 (1.50) | 1.21 | 0.01 | 2,761 | 2.8 |
| Checkpoint B, spawn | 0.35 (2.70) | 1.20 | 0.02 | 2,111 | 0.9 |
| Checkpoint B, fight v2 | 0.29 (3.40) | 1.16 | 0.01 | 2,950 | 4.9 |
| Checkpoint C first run, fight v2 | 0.28 (3.00) | 1.13 | 0.01 | 3,298 | 2.7 |
| Checkpoint C first run, 30 enemies, 60 s fight | 0.38 (4.00) | 1.12 | 0.01 | 4,546 | 5.6 |
| Checkpoint C re-run, fight v2 | 0.29 (3.10) | 1.18 | 0.02 | 2,418 | 4.6 |
| Checkpoint C re-run, 30 enemies, 60 s fight | 0.41 (3.40) | 1.21 | 0.01 | 4,079 | 6.7 |
| Checkpoint D, spawn | 0.39 (2.40) | 1.31 | 0.02 | 1,979 | 0.9 |
| Checkpoint D, fight v2 | 0.33 (3.50) | 1.19 | 0.01 | 2,738 | 7.6 |
| Checkpoint D, 30 enemies, 60 s fight | 0.45 (4.20) | 1.18 | 0.01 | 4,013 | 6.3 |

Checkpoint A reading: the AI cost per tick is unchanged (0.25 ms in the fight, 0.31 ms at
spawn) and raycasts fell slightly (2,761 against 2,895 a second in the fight). The cone prefilter
saves less than the design hoped at spawn (2,235 against 2,279 a second, about 2 percent) because
patrol whiskers, not sight lines, dominate the count. Fewer enemies count as alerted or chasing in
the same fight (2.8 against 5.4): that is the new perception, not a cost. The spec steps the
player 8 m to the side of an idle enemy, which is often outside its view cone now, and a gunshot
sends enemies to 'search', which this column does not count.

Fight v2 is the scenario the checkpoints compare against: every 3 s the player steps 8 m from
the nearest idle enemy and fires into the air, so the fight grows to 4 to 7 chasing enemies.
Five chasers cost no more AI time per tick than twenty patrollers, because a chaser that stands
and fires stops casting whisker rays.

What it shows:

- Patrol dominates the raycast count. At 20 enemies, 3 whisker rays per moving enemy per tick
  is 3,600 a second at 60 ticks, which matches the 3,000 to 3,800 a second measured once the loop
  runs near full rate. Line of sight (one ray per enemy every 0.15 s) is only about 130 a second.
- AI is cheap: about a quarter of a millisecond per tick for 20 enemies, one fifth of physics.
  The v2 budget has real room, but raycasts are the thing to watch.
- The first fight scenario engaged almost nobody (0.3 enemies alerted or chasing on average):
  firing into the air from one spot only pulled a few enemies into a short search. The spec was
  reworked to keep moving the player next to fresh enemies, and re-baselined below.

## Architecture

The full design (interfaces, scoring formulas, every tuning constant, the test plan per step) is
in [enemy-ai-v2-design.md](enemy-ai-v2-design.md), from a Fable architect pass on 2026-09-15 and
checked against the code before building. The shape of the new system in brief:

- **Enemy is split into a shell and a brain.** `Enemy.ts` keeps the Rapier body, colliders, model,
  animation and health, and implements a small `EnemyBody` interface. `EnemyBrain.ts` holds the
  decision logic and `enemyCombat.ts` the firing and melee maths. Every later step lands on the
  brain side, so no file nears the 800-line limit.
- **Squad knowledge** (`squadKnowledge.ts`): one shared belief about where the player is, how it
  was learned and how sure the squad is, decaying over 20 s, plus a memory of recent shot origins
  for the direction fire comes from.
- **Perception** (`perception.ts`): an awareness meter replaces the fixed 0.4 s alert beat. A
  view cone narrows from 70 degrees near to 30 degrees at detection range, fill takes 0.6 s up
  close and 1.5 s at range, sprinting players are seen faster, and a warned enemy starts
  suspicious. Hearing range depends on the weapon fired.
- **Combat coordinator** (`combatCoordinator.ts`, replacing `engagementSlots.ts`): role tokens
  (Shooter cap 2, Flanker 1 or 2, Approacher 1, Investigator 2), stolen only by a clearly
  better-placed enemy after a minimum hold.
- **Skills** (`skills/`): a prioritised skill picks what each enemy does each tick (melee, kite,
  peek and fire, hold and fire, flank, leapfrog, approach, take cover, search sweep, investigate,
  face threat, patrol, stagger). The existing `idle | alert | chase | search` states survive as a
  derived "mode", so every test and the perf log keep working.
- **Position picking** (`tactics/`): candidates from rings around the enemy plus house corners,
  tree trunks, rocks and tower bases, taken from an obstacle registry the world managers fill as
  chunks load. Cheap scores multiply first, and only the best few candidates spend raycasts from a
  shared budget of 16 per tick.
- **Search grid** (`searchGrid.ts`), **callouts** (`calloutDirector.ts` and new procedural sounds)
  and the **pacing director** (`director/`, a new opt-in mode) follow in steps 4 to 6.
- **Determinism:** new seeded streams at offsets 401, 409, 419 and 431 plus spawn index.
  `Math.random` stays only in combat spread.
- **Navmesh trigger:** if more than 20 percent of position picks prove unreachable in the
  checkpoint C run, step 7 goes ahead; under 10 percent it is skipped.

## Build log

### Commit 0: Enemy.ts split, no behaviour change (2026-09-15)

`Enemy.ts` (711 lines) became three files plus an interface:

| File | Lines | Holds |
|------|-------|-------|
| `Enemy.ts` | 297 | The shell: Rapier body, capsule and head colliders, model and animation, health, and the movement primitives (`moveToward`, `retreatFrom`, `faceToward`). |
| `EnemyBody.ts` | 42 | The interface the brain drives, plus the head-collider constants both sides share. |
| `EnemyBrain.ts` | 380 | The state machine (patrol, aggro and line of sight, chase, kiting, search, stuck detection), moved as-is. |
| `enemyCombat.ts` | 178 | Aim error, burst cadence and the engagement-slot handshake, the ranged shot and the melee swing. |

The pure firing rules are now pinned by `enemyCombat.test.ts` (8 tests): first shot after taking a
slot uses the widest error, the error settles to the tightest over the archetype's settle time,
full player speed adds 4 degrees, bursts fire `burstCount` shots `fireInterval` apart and then
pause, an enemy without a slot holds fire and never settles its aim.

Two small differences from the design: the head position is computed in the brain from the
tick's position rather than exposed by the body, and the kiting retreat is one body call
(`retreatFrom`) instead of a general "move along a direction".

**Verified:** typecheck clean; unit suite 191 of 191; smoke suite 16 of 16; perf log matches the
baseline (table below, "Commit 0").

### Step 1: shared knowledge and awareness (2026-09-15)

What the player sees:

- **Enemies take a moment to notice you, and it depends on how.** A sightline no longer means
  instant detection. An awareness meter fills while an enemy can see you inside its view cone:
  about 0.6 s up close, about 1.5 s at the edge of its detection range, 50 percent faster if you
  sprint. At 0.35 it stops and stares at where it saw you (the old 'alert'); full, it engages.
  Break line of sight early and the meter drains over 3 s, and it goes back to its patrol.
- **Enemies do not see behind them.** The view cone is 70 degrees each side up close, narrowing
  to 30 degrees at detection range; inside 3 m it is a full circle. An oblivious enemy facing away
  does not even cast a sight ray.
- **One enemy spotting you pulls in the others nearby.** A chasing enemy's view of you is shared
  with the squad. Any idle enemy within 30 m of where you were just seen comes to search there,
  already suspicious, and keeps following the latest sighting while a comrade still has eyes on
  you.
- **Louder weapons carry farther.** Hearing range is per weapon: pistol 30 m, rifle 40 m (as
  before), Goose Launcher 45 m, shotgun 50 m, sniper 60 m. A searching enemy now reacts to fresh
  shots, hits and comrade deaths too; before, only idle ones did.

How it is built:

- `perception.ts` (pure): view cone, visibility factor, awareness fill and drain, levels, and
  hearing range by weapon.
- `squadKnowledge.ts` (pure): one belief per match (position, source, confidence decaying over
  20 s), who can currently see the player, and a memory of recent shot origins that gives the
  direction fire is coming from (used from step 2 on). Indirect evidence (gunshot 0.6, hit or
  comrade death 0.8) never moves the belief while anyone still sees the player. Once nobody does,
  the newest evidence wins, even over a sighting a moment old; between two rumours under 2 s apart
  the more confident one stays. (Revised at step 4, see its build log: the first rule let a
  sighting overrule any evidence for 2 s, which could stop a search from ever starting.)
- `EnemyBrain.ts`: the idle and alert transitions run on the meter; chase reports sightings; idle
  joins and search follows a fresh shared sighting. `EntityManager` owns the knowledge, advances
  it before any enemy thinks, and reports comrade deaths. The weapon id now travels with every
  gunshot (`WeaponManager.onMuzzleFlash(point, weaponId)`).
- New debug hooks: `getLiveEnemyDebug()` (state, awareness, sightline, facing, position),
  `getSquadDebug()` (the belief), and a test-only `placeEnemy(index, x, z)`.

Departures from the design: hearing lives in `perception.ts` rather than a separate
`threatEvents.ts`; sharing is limited to enemies within 30 m of the sighting and to direct
sightings only (gunshots stay per-enemy hearing), so a map-wide squad does not all converge at
once and the gunshot behaviour the smoke tests rely on does not widen; the damage error still uses
`Math.random` like before rather than a seeded stream.

Fixes from reviewing the first build, before checkpoint A:

- A searching enemy briefly had a new range cutoff (leash plus 30 m) that the original code never
  had. It was redundant (the 6 s search timer already ends a search that no fresh sighting
  refreshes) and wrong at the edges (a Straggler 56 to 60 m away could hear a sniper shot and then
  give up on the spot), so it was removed.
- A suspicious ('alert') enemy that got shot used to ignore it, which was harmless when 'alert'
  lasted a fixed 0.4 s. Now that suspicion can last seconds, any enemy that is not already chasing
  goes after the shooter when hit.
- The first e2e run of the sharing check failed on its own setup, not on the feature: the watcher
  spotted the player and shared the sighting within one debug round trip, so the comrade was
  already searching when the test checked it was still idle. The test now places the comrade
  before the player steps into view.

Tests: `perception.test.ts` (12) and `squadKnowledge.test.ts` (12), including the match-start
invariant that no archetype can notice a player on the 25 m spawn ring; `e2e/enemy-ai.spec.ts`
(new, not part of the smoke suite) checks the meter, the cone, sharing and hearing by weapon in the
running game.

**Checkpoint A (2026-09-15), all passed:** typecheck clean; unit suite 215 of 215 (24 new);
`e2e/enemy-ai.spec.ts` 4 of 4 (an enemy facing the player fills its meter to 1 and chases; a
player 8 m behind an enemy leaves its meter at 0; a comrade 26 m away joins the search once the
watcher sees the player; an enemy 36 m away ignores a pistol shot while one 34 m away reacts to a
rifle shot); smoke suite 16 of 16, including the real enemy-kills-player death flow and the
match-start "no enemy senses a passive player" invariant; perf log within noise of the baseline
(measurements table).

### Step 2: the combat coordinator (2026-09-15)

What the player sees:

- **At most two enemies shoot at you at once, and they are the best-placed ones.** The old cap
  went to whoever asked first. Now shooter tokens go to the enemies with a clear sightline nearest
  the ideal distance for their weapon (60 percent of their range), and a clearly better-placed
  enemy can take a token from one that has fired for at least 1.5 s.
- **While two pin you, one works round your side.** With two or more enemies fighting and at
  least one of them seeing you, the coordinator sends the nearest waiting enemy to a point ninety
  degrees round from the squad's front (on a side it picks), about 10 m out for a Straggler. It
  does not fire on the way and keeps going round cover while a comrade still sees you. Once there
  it waits, facing you, and its crossfire position earns it a shooter token. A squad of six or
  more sends two. A flank that has not paid off in 10 s is dropped.
- **Everyone else waits their turn.** Reserves hold their ground facing you; Rush Jobs keep
  rushing.

How it is built:

- `combatCoordinator.ts` (pure, replaces `engagementSlots.ts`): roles `shooter`, `flanker`,
  `rusher`, `reserve`; `shooterScore` (sightline, range fit, crossfire bonus of 0.3 at 60 degrees
  or more off the squad's line); steal margin 0.25 after a 1.5 s minimum hold; flank duration 10 s
  and cooldown 8 s. Seeded at offset 401, used only to pick the flank side.
- `EntityManager` builds the roster (every chasing enemy) once per tick before any enemy moves,
  and the coordinator re-deals roles.
- `EnemyBrain` fights by role: only a shooter fires; a flanker runs `updateFlank`; melee inside
  3 m and the Ridge Walker's retreat still come first. `enemyCombat.stepRangedFiring` now takes a
  "has shooter token" flag instead of acquiring a slot itself.

Departures from the design, decided on the main thread:

- **Roles, not a general skill system.** The design replaces the chase and search logic with a
  prioritised skill selector across about eight skill files. Step 2 instead keeps the tested
  perception state machine (idle, alert, chase, search) as the outer layer and lets the
  coordinator's role pick the behaviour inside chase. It is far less code and keeps every existing
  test meaningful. Switch condition: if steps 3 to 5 (cover, peeking, stagger, search sweeps) make
  the role dispatch in `updateChase` sprawl, introduce the design's skill selector then.
- **The Approacher role moves to step 3.** Its job in The Last of Us is to break a stalemate
  where everyone holds cover while the player has slipped away. Until step 3 gives enemies cover to
  hold, every searching enemy already walks to the last known position, so an Approacher would
  change nothing.

A test-harness fix found at checkpoint B: the smoke suite's real enemy-kills-player test timed out
once in ten runs under step 2 (9 of 10 passed: 1 of 1 in the suite, then 3 of 3 and 6 of 6
repeated). The cause was the helper, not the AI: `killPlayerByEnemy` had a 90 s wall-clock
deadline, but the sandbox game runs at roughly half speed (2 to 4 frames a second against a
0.25 s frame cap), so it only allowed about 45 s of play, and steps 1 and 2 legitimately make an
engagement take a little longer (noticing the player takes a moment; a flanker does not shoot on
the way). The deadline now counts 90 s of game time with a page-side clock that advances exactly
as `core/Loop.ts` does, which is the original budget as it plays on real hardware, and the test's
own time limit rose from 150 s to 240 s to cover the half-speed sandbox. On a timeout the helper
now reports every enemy's state, role and awareness and the squad's belief, so a future failure is
diagnosable even after later runs overwrite the trace.

**Checkpoint B (2026-09-15), all passed:** typecheck clean; unit suite 231 of 231 (16 new in
`combatCoordinator.test.ts`, `enemyCombat.test.ts` rewritten for tokens); `e2e/enemy-ai.spec.ts`
5 of 5, including the new check (five enemies placed in an arc and alerted by a shot: over 20 game
seconds no sample shows more than two shooters, a flanker is assigned, and it works at least 20
degrees round the player); smoke suite 16 of 16 on the re-run with the game-time deadline; the real
enemy-kills-player death flow 10 of 11 across all runs, the one miss being the harness timeout
above; perf log within noise of the baseline (0.29 ms of AI per tick in the fight against 0.26 ms,
raycasts flat).

File sizes after step 2: `EnemyBrain.ts` 545 lines (limit 800), `Enemy.ts` 343,
`combatCoordinator.ts` 252, `EntityManager.ts` 319. Step 3 opens by moving the chase behaviours
(shooter, flanker, kiter, reserve) out of `EnemyBrain.ts` into their own module before cover logic
is added, so the brain does not approach the limit.

### Step 3: position picking, cover and peeking (2026-09-15)

What the player sees:

- **Enemies in a fight use cover.** Each shooter and reserve picks a spot behind a tree trunk, a
  house corner or a watch tower, on the side away from you, and walks there. Reserves hide and
  wait. Shooters alternate: 1.5 s hidden, then a step out to the side for 1.4 s of fire, then back.
  Each peek's first shot is the wide first-shot-grace shot, as with any new sightline.
- **They spread out and stay out of each other's line of fire.** No two enemies pick spots within
  2.5 m of each other, nobody stands within 1.5 m of another shooter's line to you, and no path to
  a spot passes nearer you than 4 m.
- **Ridge Walkers prefer higher ground.** A gentle bonus for spots up to 4 m above you.
- **When there is no cover,** a shooter picks an open firing spot at a good distance and fights
  from there; a reserve that finds no cover holds its ground as before.
- **Hiding never turns into a stalemate.** An enemy in cover or on a flank stays in the fight
  without its own sightline only while the squad has seen you in the last 3 s. After that everyone
  goes to search your last known position.

How it is built (all under `src/entities/enemies/`):

- `tactics/obstacleRegistry.ts`: the cover map. `VegetationManager` registers every tree trunk and
  `BuildingManager` every house footprint per chunk as chunks load, and drops them on unload.
  Rocks are left out on purpose: at about 0.9 m tall they sit below an enemy's 1.1 m chest. Watch
  towers come straight from `getWatchTowerPositions`, treated as one round obstacle of the shaft
  plus its stairs (5.4 m).
- `tactics/coverPoints.ts`: each obstacle yields pairs of spots, a covered spot on its far side and
  a peek spot a step out to the side. House corners use the wall faces that point away from you.
  Open ground yields rings of plain firing spots (4, 8 and 12 m around the enemy).
- `tactics/tacticalQuery.ts`: every candidate is scored by multiplying 0 to 1 factors (distance band
  for its weapon, walking distance, cover over open ground, high ground for Ridge Walkers), with
  hard rejections for blocked, claimed, in-a-line-of-fire and past-the-player spots. Then the best
  are confirmed with rays in order: one from your eye to the covered spot's chest height (must be
  blocked), one from the peek spot's head height to your eye (must be clear, shooters only).
- `tactics/rayBudget.ts`: those rays come from one shared budget of 16 per tick, handed out
  stalest-first so nobody starves; at 50 enemies each simply refreshes its spot less often.
- `tactics/planner.ts` glues it together; `tactics/terrainHeightCache.ts` memoises terrain height
  for candidate spots.
- `combatBehaviour.ts` (new): the fighting half of the old `EnemyBrain.ts`, plus the hide and peek
  cycle, re-checking a held spot every refresh, and giving up on spots it cannot reach.
  `stuckDetector.ts` is shared by patrol and combat. `EnemyBrain.ts` keeps perception, the state
  machine, patrol and search.
- `EntityManager` owns the budget and scheduler and builds the context once per tick; its rays
  skip your own capsule (your eye sits inside it) and the asking enemy's own body.
- The perf log gained tactical rays per second, the share of ticks the budget ran short, spots
  picked, and the percent of spots found unreachable - the step 7 navmesh trigger.

Departures from the design:

- **Two spots per candidate, not one.** The design's peek spot was a single point hidden at chest
  height but clear at head height. The enemies cannot crouch and trunks and walls block both
  heights equally, so such spots would almost never exist. A covered spot plus a peek spot a step
  to the side always exists where there is cover.
- **Rocks are not cover** (too low), and towers are read from the pure tower list rather than a
  registry.
- **The Approacher role is not needed** and was dropped: the 3 s blind grace does its job (nobody
  sits in cover forever after losing you).
- **Leapfrog advancing was not built.** The design listed it as the first thing to cut; shooters
  pinning from cover while a flanker works round already reads as the move it describes.
- **Rush Jobs do not look for covered routes.** Without pathfinding a "covered route" cannot be
  planned; they rush as before. Revisit with step 7 if the navmesh goes ahead.

Findings from the first checkpoint C run:

- **Enemies became easier.** Smoke 16 of 16 and the death flow 3 of 3 passed, but the death flow
  took 2.3 to 2.9 min against 1.2 to 2.0 before cover: at 1.4 s out and 1.5 s hidden, a shooter was
  firing under half the time. A smarter enemy should not be an easier one, so the cycle was
  retuned to 2.0 s out and 1.0 s hidden (exposed two thirds of the time, a full burst plus the start
  of the next).
- **The tower cover check never reached the behaviour.** Its first shot did not fire (ammo stayed
  at 30): the long tower search had lost pointer lock, and the game ignores the mouse while
  unlocked. The test's shot helper now takes pointer lock first.
- **The "unnoticed from behind" check found no usable attempt.** It only counts attempts where the
  enemy keeps its heading, and on that run's map the enemy was patrolling among trees, where
  whisker steering can swing its heading 80 degrees in a tick. Patrol did not change in step 3 (it
  passed at checkpoints A and B). The test now moves the enemy to the open clearing around spawn
  first.
- **Position picking is cheap and reachable so far.** The standard fight cost 0.28 ms of AI per
  tick (baseline 0.26). The 30-enemy, 60 s run cost 0.38 ms per tick with the budget never short;
  enemies committed to 37 spots and found none unreachable. That is under the 10 percent threshold
  for skipping the navmesh (step 7), on a small sample; the re-run adds to it.

Second checkpoint C run, after the retune and the two test fixes:

- **The retune worked.** The death flow passed 3 of 3 in 1.8, 0.8 and 1.0 min, back in the range
  it ran before cover (1.2 to 2.0 min). Smoke suite 16 of 16.
- **Perf unchanged:** 0.29 ms of AI per tick in the standard fight, 0.41 ms at 30 enemies, the ray
  budget never short. Across all checkpoint C runs enemies committed to 81 spots and found none
  unreachable, so the step 7 navmesh trigger (above 20 percent) is nowhere near.
- **Two behaviour checks still failed, one on its own assertion.** The tower check reached the
  fight, but a later shot's "did it fire" check saw ammo go from 12 to 30: the button stayed down
  long enough to empty the magazine and auto-reload. It now checks that ammo changed, not that it
  fell. The hearing check reported the enemy 36 m away as chasing, which should be impossible past
  every archetype's leash (26 to 32 m drops it to idle within a tick) and passed at checkpoints A
  and B. Its artifacts were overwritten by later runs, so it now reports every enemy's record, the
  player position and the squad belief in its failure message; a targeted re-run follows.

Targeted re-run (the tower and hearing checks, twice each):

- **The hearing check passed both times.** The "chasing at 36 m" reading did not come back. Its
  cause is not found: by the code an enemy that far out is dropped to idle by the leash within a
  tick, so it is recorded here as an open, intermittent test failure (1 in 5 runs of that check
  across checkpoints A to C), with the failure message now carrying every enemy's full record so
  the next occurrence can be diagnosed from the log alone.
- **The tower check failed once and passed once.** The failing run saw no covered spots at all,
  and its screenshot showed the player looking up at tower structure overhead - standing at the
  tower's base, not 24 m out. Towers sit near the world's edge ramp, and the test always placed the
  player 24 m in +z, which on that map was out past the playable area. From the tower's base every
  enemy closed straight to melee range, where melee always wins and no spot is picked. The test now
  stands the player on the side of the tower facing spawn and the enemies on the far side, so the
  layout is the intended one on any map.

Third run: the tower check still failed 3 of 3 (0, 0 and 1 covered spots), and the flank check
failed once (no flanker seen) after passing in both earlier checkpoint C runs. The tower failures
were the test asking for something the design rightly refuses:

- **A watch tower is poor cover for most enemies, by geometry.** Counting its stairs it is about
  5.4 m in radius, so the spot hidden behind it is at least 6 m past its centre on the far side
  from the player. With the player 24 m from the tower that spot is about 30 m away, outside every
  archetype's fighting band (a Straggler fights from 5.6 to 14.4 m, a Ridge Walker from 10.5 to
  27 m), and the scoring correctly rejects it: an enemy should not hide where it cannot shoot back.
  Towers only serve as cover when the player is close to them, and then mainly for Ridge Walkers.
  Tree trunks and house corners are the cover that matters. This is left as is, and noted.
- **The check now fights in a wood.** A new debug hook, `getCoverNear(x, z, radius)`, reads the
  cover registry; the test finds a spot with at least 8 trunks within 15 m and rings six enemies
  12 m around the player, inside a Straggler's band.
- **The flank check now reports a timeline** (every enemy's state, role and spot, and how many
  enemies see the player, for the last 12 samples) if it fails, to tell a flaky sample apart from
  hiding enemies leaving fewer moments when anyone sees the player - which is what a flank needs.

Fourth run: the full behaviour spec passed 6 of 6, and the woods check passed all 3 times it ran.
The flank check failed 1 of 3, and its timeline answered the question: every sample read "seen by
5" with four Rush Jobs (role `rusher`) and one gunner holding the only shooter token. A flank needs
a second gun-carrying enemy waiting for a token, and that match had none - the coordinator was
right not to send anyone. Rush Jobs are 30 percent of spawns, so about 3 squads in 100 roll one gun
or none among five. The check now re-rolls the match (up to four times) until at least three of
its enemies carry guns, so it tests flanking rather than the archetype dice. Hiding in cover is
not starving the flank of sightings: the player stayed in view of the whole squad throughout.

**Checkpoint C (2026-09-15), passed:** typecheck clean; unit suite 278 of 278; `e2e/enemy-ai.spec.ts`
6 of 6 in one clean full run, with the woods cover check (at least two enemies pick covered spots
behind trees, at least one reaches its spot and hides or peeks, never more than two shooters)
passing 3 of 3 and the corrected flank check 3 of 3; smoke suite 16 of 16; the real
enemy-kills-player death flow 3 of 3 in 0.8 to 1.8 min after the peek retune; perf within noise
of the baseline (0.29 ms of AI per tick in the standard fight, 0.41 ms at 30 enemies, the ray
budget never short). Navmesh decision input: 81 spots committed to across the checkpoint runs, 0
unreachable, far under the 20 percent trigger, so step 7 stays unbuilt unless later steps change
that picture. One item stays open: the hearing check's single "chasing at 36 m" reading, not
reproduced in 5 runs since, with its failure message now carrying the full diagnosis.

### Step 4: the search grid (2026-09-15)

What the player sees:

- **Losing the enemies now starts a real search.** A second after the squad last saw or heard
  you, it lays a grid of 4 m cells over the ground around where you were (a disc 44 m across, the
  leash range), holding the chance that you are in each cell. The chance spreads outward over time,
  because you could have moved any way.
- **Searchers split up and sweep in pairs.** Every half second they are re-sent to the likeliest
  cells: the nearest two to the top cell (one to it, one beside it, so they sweep side by side), the
  next two to the next likely spot, and so on. Cells they walk near, or can see within 12 m ahead,
  are wiped.
- **They keep at it until the ground is cleared.** Instead of walking to one point and standing for
  6 s, a searcher keeps searching for as long as the grid sends it somewhere. The search ends when
  four fifths of the chance has been wiped (never in its first 10 s), after 30 s at most, or the
  moment anyone sees you again;
  then the searchers' own 6 s timers run out and they go back to patrolling.
- **New evidence restarts it.** A fresh sighting, gunshot or hit rebuilds the grid around the new
  best guess; a spent search is not restarted until something new happens.

How it is built:

- `searchGrid.ts` (pure, every setting a constructor option): diffusion to the four neighbours with
  the total held constant (clearing is the only way probability leaves), clearing near a point,
  clearing by sight (cells in range and in the searcher's cone, likeliest first, one `isVisible`
  check each up to a ray allowance), the likeliest cell, and the pairing. 10 unit tests.
- `EntityManager.updateSearch` owns the one squad grid: it starts, rebuilds and ends it, wipes
  cells near every searcher each tick, lets one searcher per tick look over its view cone with up
  to 4 rays taken from what position picking left of the shared budget, and re-sends searchers
  every half second through `EnemyBrain.assignSearchTarget`.
- Debug: `getSquadDebug().searchGrid` (cells, chance left, age, likeliest cell) and each enemy's
  `searchTarget`.

Departures from the design: there is no separate Investigator role - every searching enemy joins
the sweep, and pairs are formed by who is nearest each likely spot; the grid's rays come from the
same budget as position picking, after it, rather than a separate allowance.

A bug found by the first behaviour check, fixed in step 1's knowledge rule: the check (fire from
hiding, slip away, expect a search grid) never saw a grid, and its full timeline showed why. An
enemy had spotted the player a moment before the shot; the shot, under 2 s later, was rejected as
weaker than that fresh sighting, so the squad had no new evidence. Meanwhile the grid built for the
sighting had been used up at once - the spotting enemy stood in open ground within sight of the
spot and cleared it, which is right (there is nowhere to hide there) - and a spent search is only
rebuilt on new evidence. The rule is now: a sighting overrules other evidence only while someone
still sees the player; once nobody does, the newest evidence wins, even over a sighting a second
old, because it says where the player is now (between two rumours close together the more
confident one still wins). Three new unit tests pin it. The same timeline also showed the check's
own timing was off several times over - every debug call lets the slow sandbox run on - so
`getSquadDebug()` now reports the squad clock and checks time behaviour on it.

A second flaw, found at checkpoint D, was in the grid itself: it spread far too slowly. It started
with nearly half its chance in the last known cell and the rest in the ring around it, and at 0.15
per second it spread about 2.4 m in 5 s, a tenth of what a walking player covers. An enemy standing
near the spot therefore wiped four fifths of it within a few ticks and the search ended almost as
soon as it began: the check saw its searchers go idle 9 s after the shot and never sampled a grid.
Three changes fix it. The rate is now 2.5 per second, derived so the likely area reaches about
10 m out after 5 s (the spread after t seconds is about sqrt(rate × t / 2) cells), and the update
runs in steps of at most 0.05 s so it stays stable whatever tick it is given. A new grid starts
already spread for the time since the evidence (`spreadFor`), since the player had that head start.
And low chance cannot end a search in its first 10 s, only a sighting, a lost belief or the 30 s
limit can. New unit tests pin the pace (over half the chance 2 or more cells out after 5 s, against
under a fifth at the old rate), that one long step matches many short ones, and the head start.
`getSquadDebug()` also reports how many grids were built and why the last one ended, so a check that
samples seconds apart can still see a grid that came and went between samples.

File sizes after step 3 (limit 800): `EntityManager.ts` 432, `combatBehaviour.ts` 420,
`EnemyBrain.ts` 412 (down from 545 once fighting moved out), `Enemy.ts` 367, `combatCoordinator.ts`
252; every file in `tactics/` is under 175. Unit suite 278 of 278 (47 new across the tactics
modules, the planner and the hide-and-peek cycle).

### Step 5: callouts, the glint and the stagger (2026-09-15)

What the player sees and hears:

- **Enemies call out what they are doing.** A short radio click and a chirp, from the enemy's
  direction and quieter with distance, exactly like its gunshots: rising for "spotted" (the moment
  an enemy fully notices you), three quick notes for "flanking" (when one is sent round your side),
  falling for "lost them" (when the squad starts searching, from the searcher nearest where you
  were). The squad talks like a squad, not a chorus: one callout at a time, each kind at most every
  4 s, any two at least 1.2 s apart, and none from farther than 45 m.
- **A Ridge Walker's long shot is telegraphed.** When one is 15 m or more away and about to open a
  burst, a bright glint shows at its head with a faint high "ting", and it holds the shot for 0.6 s.
  You get a fair warning to break the sightline. Closer than 15 m there is no glint: you can see it
  aiming.
- **Heavy hits stagger.** A hit of 25 or more damage (after the headshot multiplier: sniper,
  shotgun and rifle headshots do it, pistol body shots do not) knocks the enemy off balance for
  half a second. It tips back and eases upright, and neither moves nor fires until it recovers;
  its aim and burst start over. Light hits only reset its aim, as before.

How it is built:

- `calloutDirector.ts` (pure): enemies emit intent events into it, and once per tick
  `flush(now, listener)` returns at most one callout to voice (the nearest in range whose cooldowns
  allow it) plus every visual cue (glints and staggers, which are never rationed). Unit tested.
- `readability.ts` (pure): `GlintTelegraph` decides when a burst gets a glint and how long to hold
  the shot; `StaggerState` holds the threshold, the timer and the 0 to 1 lurch. Unit tested.
- Who emits what: `EnemyBrain` emits "spotted" on the move to chase; `CombatBehaviour` emits
  "flanking" once when its role becomes flanker, runs the glint inside `fire`, and owns the stagger
  (`onHeavyHit`, called from `EnemyBrain.onDamaged` with the damage actually dealt); a staggered
  enemy's brain skips movement and fighting but keeps perceiving. `EntityManager` owns the one
  director, emits "lost them" when it starts a search grid, and flushes the director at the end of
  each tick into two new optional combat hooks, `onCallout` and `onCue`.
- `Game` plays them: `SoundEngine.playCallout(kind, volume, pan)` and `playGlint`, both procedural
  like every non-weapon sound, attenuated and panned with the gunshot helpers; `GlintMarkers.ts`
  is a small pool of additive sprites that flash and fade over the lead time.
- Debug: `getSquadDebug().callouts` counts callouts voiced and cues shown by kind, each enemy
  record has `staggered`, and a test-only `damageEnemy(index, amount)` hook deals real damage
  through `takeDamage`, like `damagePlayer` does for the player.

Departures from the design:

- Five intent kinds instead of ten. "Approaching", "taking cover", "searching", "reinforcing" and
  "comrade down" were left out: each would fire often, and five chirps the player can learn beat ten
  they cannot tell apart. The design's `longShotAim` is `glint` here, and `lost` is `lostThem`.
- The director does not call the sound hooks itself: `flush` returns what to play and
  `EntityManager` passes it on, which keeps the director free of hooks and fully testable. It
  needs no random stream either: the nearest speaker wins.
- The stagger lives in `CombatBehaviour` rather than a `staggerSkill`, following step 2's
  role-dispatch departure, and the shell reads the lurch from the brain rather than through an
  `EnemyBody.setLurch` call.
- The design's ambiguity note stands: "stagger on heavy hits" is read as the enemy staggering.

File sizes after step 5 (limit 800): `EntityManager.ts` 598, `combatBehaviour.ts` 475,
`EnemyBrain.ts` 456, `Enemy.ts` 387, `searchGrid.ts` 210, `calloutDirector.ts` 102,
`readability.ts` 87, `GlintMarkers.ts` 114. `EntityManager.ts` is the one to watch: the search
section is the natural piece to move out if step 6 pushes it much further.

Checkpoint D (steps 4 and 5), first run, the behaviour spec alone: 9 of 10. Every step 5 check
passed: callouts voiced and rationed (at least one "spotted", never more often than the 1.2 s
squad-wide gap allows), a 10-damage hit not staggering and a 26-damage hit staggering, and a Ridge
Walker 18 m out glinting before it fired. The search check failed, and its timeline exposed the
search grid spreading far too slowly (written up in step 4's build log above). After that fix the
search check passed on its own in 43.6 s.

Second run, the full checkpoint chain (behaviour spec, smoke suite, the death flow three times, two
perf runs). It ran from a snapshot copy of the working tree in `C:\tmp`, so step 6 wiring could
carry on in the real tree without the dev server reloading pages under the tests. What each
result turned out to be:

- **Behaviour spec 9 of 10**, the fixed search check passing. The flank check read 16 degrees
  against 20. Its timeline showed the coordinator right (a flanker at every sample, never more than
  two shooters) and the role rotating between enemies, as the 10 s flank limit and 8 s cooldown
  intend. The check followed only the first flanker, even after it stopped flanking, so it measured
  one short stint. It now measures every stint from where that enemy took the role, asserts on the
  best one, and prints them all.
- **Smoke suite 14 of 16.** The reset test found the player dead before T could be pressed: its
  pistol shots at spawn now bring the squad looking for the shooter, and at about 2 FPS the test
  lingers there long enough to be killed. It now keeps the player invulnerable until it is clear,
  then deals 30 real damage so the reset's health restore is still checked. The death flow inside
  the smoke run timed out, and not for want of lethal enemies: its dump shows the player still in
  the spawn clearing, 23 m from the enemy it was sprinting at, with every enemy idle and unaware.
  The helper sprints in a straight line, and a tree or rock on that line stops it dead. It now
  steps sideways after three steps without moving, re-takes pointer lock if it was lost, and
  reports both in its dump.
- **The death flow on its own passed 3 of 3**, in 1.7, 2.6 and 2.9 min, against 0.8 to 1.8 at
  checkpoint C. Runs vary widely (the archetype drawn and the map both matter, and a blocked
  approach costs time with no enemy involved), and nothing in steps 4 or 5 changes enemy damage
  apart from the Ridge Walker's 0.6 s glint hold, so three runs cannot show enemies got less
  deadly. The next full run repeats it with the fixed helper.
- **Perf within noise:** 0.33 ms of AI per tick in the standard fight (0.29 at C) and 0.45 ms at
  30 enemies (0.41). The ray budget never ran short, even with search clearing drawing up to 164
  tactical rays a second at 30 enemies. 33 more spots were picked, none unreachable.

**Step 7 decision:** across checkpoints C and D enemies committed to 114 spots and found none
unreachable, against a 20 percent trigger, so the navmesh is not built. Revisit only if a later
change (covered routes for Rush Jobs, say) needs real paths.

### Step 6: the pacing director, a new opt-in solo mode (2026-09-15)

What the player sees:

- **A new "Director" checkbox in Match Setup.** Off by default, so a normal match is exactly what
  it was. It cannot be combined with Goose Horde (ticking one unticks the other), and it ignores the
  enemy and target counts.
- **The match starts small and builds.** Two enemies and no practice targets to begin with. Every
  8 s the director sends a wave of two more, never more than 8 alive at once.
- **Waves never appear on your screen.** Each reinforcement comes in 18 to 30 m away, somewhere
  behind you (up to 100 degrees round from straight behind, so always outside your view), clear of
  houses and towers. Spots your eye has no clear line to are used first, so turning round at once
  rarely catches one arriving; in open ground, where nothing behind you is hidden, it comes in
  exposed but still off screen. If every spot drawn was inside a structure, the wave tries again a
  second later.
- **It reads the fight.** Damage you take and enemies you kill within 20 m raise an intensity
  (50 HP lost, or about 7 close kills, is a full peak). At the peak the waves stop; the peak holds
  3 to 5 s; then the director waits for you to get clear (intensity drains only while nothing is
  chasing you) and gives you a 30 to 45 s breather before the next build-up opens with a wave.
- **Waves vary.** One in five is all Rush Jobs, one in five brings a Ridge Walker placed on the
  highest hidden ground drawn, and the rest are the usual mix.

How it is built:

- `director/pacingDirector.ts` (pure): intensity, the build-up, peak, fade and relax cycle, and
  wave commands. Every setting is a constructor option and the only randomness is a seeded stream
  (world seed plus 419, the offset the design reserved). 7 unit tests: wave timing, the cap, the
  full cycle, drain only while unengaged, no waves outside build-up, the quick retry, determinism.
- `director/reinforcementSpawner.ts` (pure): draws the candidate points off screen and checks each
  with one ray through an injected probe, 6 at most per wave, hidden points first. 7 unit tests:
  the arc and radii, never on screen (and no ray spent there), hidden before exposed with an honest
  flag, a wave still sent when everything behind is exposed, never a blocked point (and no ray
  spent on it), spacing, the high-ground preference.
- Wiring: `Game` owns a director only in a Director match (never in multiplayer or Goose Horde)
  and runs it straight after the entity update, inside the AI timing, so a spawn never changes the
  entity list mid-loop and its cost shows in the perf log's AI column. Each tick it passes the
  damage taken (read from the player's health, so no new hook), the kills within 20 m
  (`EntityManager.killsThisTick`) and the alive and chasing counts. A wave goes through
  `pickReinforcementSpawns` with the sight check cast from the player's eye past their own capsule
  (`EntityManager.playerCanSee`), and `spawnEnemy` takes an optional archetype, so a rusher wave is
  all Rush Jobs and a sniper wave leads with a Ridge Walker. Practice reset starts the director
  over, and the two setup checkboxes untick each other.
- Debug: `getDirectorDebug()` gives the phase, intensity and total spawned, and the last wave's
  reinforcements with where the player stood and looked, plus a fresh sight check to each new
  enemy's real head (its own body ignored). That check guards the wiring; the spawner's rules are
  the unit tests' job.

Departures from the design:

- Sniper waves do not use tower platforms. An enemy snaps to the terrain every time it moves, so
  one placed on a platform would drop to the ground inside the tower. The Ridge Walker goes on the
  highest hidden ground drawn instead. Tower perches would need an enemy that never moves, a
  change for later if Gustav wants it.
- "Out of sight" means off screen first, hidden preferred. The design accepted only points with no
  line of sight from the player's eye. In open ground, like the spawn clearing, every point behind
  the player is in plain line of sight, so that rule would never send a wave there. Points are now
  drawn only outside the camera's horizontal view plus 15 degrees, and the sight ray decides
  preference: hidden first, exposed only when nothing drawn is hidden. The debug record says which
  (`hidden`) and re-checks each placed enemy against the screen (`onScreen`).
- The spawner's sight checks come from their own allowance (6 a wave, a wave every 8 s at most)
  rather than the shared ray budget: under one ray a second.
- The director is told how many enemies a wave actually placed (`confirmSpawned`), so a wave with
  nowhere hidden to go retries after 1 s instead of counting as sent.
- The wave mix (one in five all Rush Jobs, one in five with a Ridge Walker) is my choice: the design
  named the biases but not their shares.

File sizes after step 6 (limit 800): `EntityManager.ts` 654 (the search section, about 100 lines,
is the first piece to move out if it grows again), `combatBehaviour.ts` 475, `EnemyBrain.ts` 456,
`Enemy.ts` 387, `searchGrid.ts` 228, `director/pacingDirector.ts` 168,
`director/reinforcementSpawner.ts` 99. `Game.ts` was already about 2,500 lines before this work; the
director adds about 150 to it, kept to one field block and three small methods.

Checkpoint E (step 6), first run, the director spec from a snapshot: 2 of 3. A normal match has no
director, and a Director match started with two enemies and no targets and sent its first wave in
from behind the player, off screen, 18 to 30 m out. The peak check failed with the intensity at
0.84 after 55 HP lost. The director added the tick's damage (capped at 1.0) and then drained that
same tick, since nothing was chasing, leaving 0.9987, just under the threshold, and it drained on
from there: 0.16 below the cap is exactly 2 s at 0.08 a second. The unit test had taken its damage
while enemies chased, so nothing drained. Draining now comes first, and a new unit test takes 50 HP
with nothing chasing and expects the peak.

The three checks fixed after checkpoint D and the final review were rerun from a second snapshot
before the final chain, and all passed: the flank check with its per-stint measure, the glint
check with its two glints, and the reset test.

Final chain (checkpoint E plus a full repeat of D, from a snapshot of the finished tree): director
spec 3 of 3, the peak check included; behaviour spec 9 of 10; smoke suite 15 of 16; the death flow
1 of 3 on its own. The machine ran slower through this chain (41 ticks a second in the standard
fight against 52 at checkpoint D, physics 1.60 ms a tick against 1.19), and the woods check and one
death flow ran out of Playwright's wall-clock budget rather than failing a check: game time runs
slower on a loaded machine, so the same game-time scenario takes more minutes. The other death-flow
failure did use its whole 90 game seconds, and its dump shows the player on 8 HP chasing a kiting
Ridge Walker that held the shooter token with a sightline: enemies doing damage, but slowly.

Death-flow times had also crept up across checkpoints (0.8 to 1.8 min at C, 1.7 to 2.9 at D, 3.1
here), though the D and final runs shared the machine with other work. Nothing in steps 4 to 6
changes close-range damage, but "smarter but easier" is exactly what checkpoint C's peek retune
ruled out, so it is measured instead of assumed: an A/B run of the death flow's own approach (walk
up to the first enemy, 4 enemies, 6 runs a build), timed in game seconds, against this branch and
against master (v3.9.4, the old AI) side by side.

**It found a real regression from step 3.** On master every run killed the player: 34, 19, 23,
15, 19 and 71 game seconds. On the branch, Rush Jobs (melee) killed as fast as ever (29 and 19),
but Stragglers took 75, 124 and 33, against 15 to 23 on master, and the one Ridge Walker drawn
took 122 (master drew none, so kiters have no comparison here). A gunner only fights from spots
between 0.35 and 0.9 of its ranged range from the player (5.6 to 14.4 m for a Straggler), so with
the player standing next to it every spot on offer is farther out. It walked off to one, the player
followed, the spot went stale, and it walked again: always moving, rarely firing. Cover had made
enemies easier to rush, the exact thing checkpoint C's peek retune was meant to rule out; three
death-flow runs had not been enough to show it.

The fix: inside the near edge of its band, with the player in sight, an enemy drops its spot and
stands and fights, the original behaviour, and it looks for no spot at that range at all (which
also saves the rays). Reserves in the same place still wait for a shooter token. A unit test pins
the no-spot rule; the fixed build's A/B run and three death flows check the result.

The fixed build, same A/B: Stragglers killed in 17.5, 16, 36 and 23 game seconds, master's range,
so the regression is gone. The death flow on the fixed build passed 3 of 3 in 2.2, 2.2 and 2.5 min,
running with nothing else on the machine. Its two Rush Job draws were slow, 92 and 105 game seconds,
against 29 and 19 on the unfixed branch and 19 to 71 on master. The fix cannot cause that: it only
applies to enemies with a gun (a Rush Job's ranged range is 0), and a Rush Job's code path is the
same as on the unfixed branch, where its draws were fast. With two draws a build, and master itself
producing a 71, it reads as spread rather than a fault, and it is left as a watch item: if Rush Jobs
feel soft in real play, the first thing to measure is a Rush-Job-only A/B.

The last full run on the fixed build: director spec 3 of 3, behaviour spec 10 of 10, smoke suite
15 of 16. The one failure was the death flow waiting out its whole 400 s on a death screen: the
enemies had killed the player, and the helper then tried to take back the pointer lock that death
releases. Two test bugs met there. The helper's new re-lock (added at checkpoint D) could run just
after a death, and `lockPointer`'s final wait passed its options as `waitForFunction`'s second
argument, which is the page function's argument, so its 5 s limit never applied and it waited for
ever. The helper now only clicks Resume if the pause menu is up and goes back round, where its
health check catches a death; `lockPointer` passes its options third.

The same misplaced-options call is in other specs: fixed in the two written for this work
(`director.spec.ts`, `enemy-ai.spec.ts`), and left as a follow-up in `helpers.ts`
(`waitForGameReady`, `equipPistol`, `openPauseMenu`), the two perf specs and every multiplayer spec.
Each of those waits has in effect had no limit, and switching the limits on needs each one budgeted
for the slow sandbox first (a 20 s game-load limit, for one, may be too short here), so it is its
own change.

Rerun after those fixes: the death flow 3 of 3 (1.9, 1.1 and 2.0 min, back in checkpoint C's
range), director spec 3 of 3, behaviour spec 8 of 10. Both failures were test staging, and one of
them closes the oldest open item. The hearing check's "enemy 36 m away reacted to a pistol", open
since checkpoint C, came back with its full dump: the enemy had walked from 36 m to 32 m before
the shot, was chasing at 17.5 m afterwards, and the squad's belief said "seen". It never heard
the pistol. `placeEnemy` moved only the enemy's body, so its patrol kept picking spots around
where it had spawned, near the player, and it walked back into view. `placeEnemy` now makes the
new spot the enemy's patrol home too, so a staged layout stays staged. The "unnoticed from behind"
check found no attempt where the patrolling enemy held its heading, which it needs before it may
judge: it now gets twelve attempts instead of six and reports each one's largest turn.

With re-homing in, the behaviour spec ran once in full and the two fixed checks twice more each.
The hearing check passed 3 of 3. The behind check passed 2 of 3: its two repeats found a usable
attempt within 35 s, and its one miss was not a judgement but its 180 s wall-clock limit, which I
had left as it was when doubling the attempts. It now has 360 s; its check is still timed in game
seconds. The other eight checks all passed on the re-homing fixture. With 360 s the behind check
then passed 3 of 3 (52 s, 38 s and 1.3 min).

**Checkpoints D and E (2026-09-16), passed.** Typecheck clean; unit suite 324 of 324 on an idle
machine. On the final code: the director spec 3 of 3; every behaviour check passing (the hearing
check 3 of 3 with re-homing, the behind check 3 of 3 with its new limit, the other eight in a full
run); the smoke suite 15 of 16, its one failure the death-flow helper hang, after whose fix the
death flow passed 3 of 3 on its own in 1.1 to 2.0 min, back in checkpoint C's range. The A/B
against v3.9.4 showed gunners as deadly as the old AI once the point-blank fix went in. Perf is
within noise of the baseline: 0.33 ms of AI a tick in the standard fight, 0.45 ms at 30 enemies,
the ray budget never short. Still open: Rush Job kill times (two slow draws after the fix, likely
spread), the misplaced `waitForFunction` options in the older specs, and how it all feels on real
hardware, which only a play session can tell.

### Final review (task 28, 2026-09-15)

An independent Fable review of the whole branch, commit 0 to step 6, read-only while the checkpoint
D chain ran (typecheck and unit suite clean on its side too). Six findings, each checked against
the code before it was fixed:

- **HIGH, fixed: the glint showed before a Ridge Walker's first shot only.** The telegraph worked
  out that a burst had ended from the shot counter going back to 0. A Ridge Walker fires one-shot
  bursts, and its counter goes 0, 1, 0 inside one firing step, so the telegraph never saw it move
  and never re-armed. The firing step now reports each burst's end (`GlintTelegraph.onBurstEnded`).
  A new unit test fires three one-shot bursts and expects three glints, and the browser check waits
  for two glints instead of stopping at the first, which is why it had missed this.
- **MEDIUM, fixed: director waves could land past the world's edge ramp.** Only houses and towers
  were rejected, so a player out near the edge could get reinforcements on the edge mountain or past
  the last chunk. Waves now stay within 65 m of the centre (where the edge ramp starts, less the
  zone margin), the bound every other spawn keeps.
- **LOW, fixed: the stagger tipped enemies about the world's X axis.** With three.js's default
  rotation order an enemy facing along X tipped sideways. Enemies now turn first and tip second, so
  the lurch, and the older death topple, tip them back whichever way they face.
- **LOW, fixed: per-enemy random streams could run into other offsets in a long Director match.**
  They were an offset plus the spawn index, safe for a fixed match of 50, but a Director match has
  no fixed limit: enemy 100's patrol stream was the geese's. They now step 1,000 apart per spawn,
  which changes the patrol routes on any given map once.
- **LOW, fixed: "lost them" was said again whenever new evidence re-aimed a running search.** It is
  now said only when a search starts.
- **Design observation, decided: reinforcements arrived oblivious.** They patrolled where they came
  in, so in a quiet build-up a wave could stand behind the player unnoticed. The director now sends
  each one to search toward the player, already suspicious. The reviewer left this for Gustav; it
  is a default taken to keep the mode working, and easy to reverse.

The reviewer also recorded what it checked and found sound: state transitions and token release,
the search grid's mass and timing, yaw conventions, the director's mode gating and reset, the
knowledge rule, determinism, disposal of glint sprites and audio nodes, per-tick cost, and test
quality apart from the glint gap.
