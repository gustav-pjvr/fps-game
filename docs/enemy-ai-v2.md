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
| 13 to 17 | Step 3: position picking, ray budget, combat skills (checkpoint C) | later |
| 18 to 19 | Step 4: search grid and paired sweeps | later |
| 20 to 22 | Step 5: callouts, telegraph, stagger (checkpoint D) | later |
| 23 to 25 | Step 6: pacing director as a new opt-in solo mode (checkpoint E) | later |
| 26 to 27 | Step 7: navmesh with recast-navigation-js | conditional on checkpoint C |
| 28 to 30 | Final review, docs and version, merge and deploy | later |

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
  comrade death 0.8) only replaces a belief that is weaker or more than 2 s old, so a live
  sighting always wins.
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
