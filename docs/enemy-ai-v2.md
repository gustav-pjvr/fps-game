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
| 3 | Once-a-second perf logger, plus a runnable perf spec | built and unit-tested; baseline run in progress |
| 4 | Design: architecture pass by a Fable subagent | in progress |
| 5 | Branch `feature/enemy-ai` | done |
| 6 to 9 | Step 1: squad knowledge, awareness meter, event routing, tests (checkpoint A) | later |
| 10 to 12 | Step 2: combat coordinator and roles (checkpoint B) | later |
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
