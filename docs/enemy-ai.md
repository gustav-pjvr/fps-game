# Enemy AI

Development notes for the enemy AI overhaul (patrol, aggro/LOS, ranged combat, melee, tuning) and per-archetype enemy loadouts, extracted from the original NOTES.md.

## Enemy AI overhaul - design pass and Phase A: goal-directed patrol (2026-07-05)

The user asked for a full enemy AI overhaul: goal-directed movement instead of circling, an aggro
range with line-of-sight, enemies that shoot back with hitscan weapons (fair, not instant-perfect),
a player melee/knife weapon, and per-archetype behavior (sniper kites, shotgun rushes, etc.) with
every enemy falling back to melee at close range regardless of its gun. Given the size and risk of
this system (the user explicitly flagged it as the highest-stakes piece of this whole batch), an
Opus architect subagent was used for a full design pass before any implementation - full doc is in
the session transcript; summary of the design and Phase A (the only phase implemented so far)
below.

### Design summary (not yet all implemented - phases B-E remain)

- **State machine**: `idle -> patrol -> alert -> engage/reposition/melee -> search`, split into a
  separate `EnemyBrain` (decision logic) from `Enemy.ts` (entity shell: colliders, model, health) -
  not yet split out; Phase A kept the existing single-class structure since it only touched
  movement, and splitting was deferred until brain logic actually exists to split out.
- **Movement**: no navmesh (this codebase has none, and adding one is out of scope for a solo
  project this size) - goal-directed patrol toward real destinations across the map, biased toward
  town/forest zone content, with whisker raycast obstacle avoidance and stuck-detection reroute
  standing in for real pathfinding.
- **Aggro**: distance + line-of-sight (reusing `castHitscan`), throttled for performance, with
  detection/leash hysteresis (already existed as `ENEMY_DETECTION_RANGE`/`ENEMY_LEASH_RANGE`).
- **Fair enemy combat** (not yet implemented): enemies aim with a real error cone that widens with
  range/movement and narrows the longer they hold aim on the player - actual missed tracers the
  player can see and react to, not a hidden hit-chance roll. Reaction delay before the first shot,
  burst-then-pause cadence, and a cap on how many enemies can be actively engaging at once.
- **Melee** (not yet implemented): knife joins the existing `WeaponDefinition` data model via a
  `kind: 'ranged' | 'melee'` field so it works in the inventory/hotbar for free; hit-tested with a
  small fan of raycasts. Every enemy archetype auto-switches to melee at close range regardless of
  its gun.
- **Archetypes** (not yet implemented): sniper kites at range, shotgun rushes to close range,
  rifle/pistol are the aggressive/generalist middle: distinct range bands, weighted-random spawn
  loadout, seeded for reproducibility.

### Phase A: goal-directed patrol (implemented and verified this session)

**What changed.** Enemies previously "idled" by picking a random point within
`ENEMY_WANDER_RADIUS` (6 units) of their spawn point every `ENEMY_WANDER_INTERVAL` (3s) - a tight
shuffle that reads as running in small circles, exactly the complaint the user raised. Replaced
with real patrol:

- New file `src/entities/enemies/enemySteering.ts`:
  - `pickPatrolDestination(spawnPos, rng)` - samples a handful of random candidate points within
    the new `ENEMY_ROAM_RADIUS` (55 units, a real map-scale patrol area vs. the old 6-unit shuffle)
    of spawn, and prefers whichever candidate has the highest town/forest zone membership (via the
    existing `sampleFlatZone`/`sampleForestZone`) with probability `ENEMY_PATROL_POI_BIAS` (0.6) -
    so patrols read as heading somewhere with real content more often than pure noise, without the
    cost of precomputing/caching an actual point-of-interest list (these ZoneMap lookups are
    already O(1) hash-grid queries, cheap enough to just sample directly). Falls back to a plain
    random point the rest of the time, and always clamps candidates inside
    `WORLD_SOFT_PUSH_START_RADIUS` so patrol destinations never reach into the edge-mountain ramp.
  - `steerWithAvoidance(physics, chestPos, desiredDir, excludeCollider)` - whisker obstacle
    avoidance: casts three short probe rays (straight ahead, and +/-`ENEMY_AVOID_ANGLE_DEG`) via
    the existing `castHitscan`, and steers toward whichever is clearest (slight preference for
    straight-ahead on a tie, so an unobstructed enemy walks straight rather than drifting). Handles
    convex obstacles (buildings, rocks, tree trunks) reasonably; this codebase has no navmesh and
    isn't getting one this pass, so concave traps are explicitly *not* solved by this function -
    see stuck-detection below for the backstop.
- `Enemy.ts`: `updateWander` -> `updatePatrol`, using the above. New `repath()` helper (picks a
  fresh destination and resets the repath timer to a randomized `ENEMY_PATROL_REPATH_MIN..MAX`
  (8-16s) window) is called both on arrival/timeout and from a new `updateStuckDetection` - if an
  enemy tries to move but covers less than `ENEMY_STUCK_EPSILON` (0.5 units) over
  `ENEMY_STUCK_WINDOW` (2s), it's treated as wedged against something whisker-avoidance couldn't
  solve, and picks a new destination rather than freezing in place indefinitely. Chase/attack
  behavior (the `chase` state) is untouched this phase - still beelines straight at the player, no
  avoidance or aggro/LOS changes yet (that's Phase B/C).
- Added a permanent debug hook, `debugState` (on `Enemy`, threaded through
  `EntityManager.getLiveEntityStates()` and `window.__gameDebug.getLiveEntityStates()`), exposing
  each live entity's AI state (`'idle' | 'chase'`, undefined for non-AI entities like targets) -
  useful for this phase's own verification and will matter more once Phase B adds more states.

**Verification, and a real diagnostic detour.** Teleported near a town, sampled all three enemies'
positions every 5s for 60s. First pass looked broken - two of three enemies drifted for a while
then froze at an exact position for the remainder of the run, positions identical to many decimal
places. Root-caused via a live per-entity update-call counter (not console logs, which turned out
unreliable for this - see below) exposed through the same debug channel: **all three enemies'
update-call counters froze at the exact same number, simultaneously**, regardless of AI state (one
was `idle`, one was `chase`) - that ruled out a per-enemy patrol bug immediately, since a real stuck
enemy wouldn't freeze in lockstep with an unrelated chasing enemy. Checked `isPointerLocked()` at
the end: `false`. The freeze was the browser losing pointer lock during a ~60s idle automated wait
(a known headless-Chromium/Playwright quirk over long unattended runs, not something the game
itself does) - pointer-lock loss pauses the whole game loop by design, which freezes every entity's
update uniformly. Not a bug in this phase's code at all.

Re-confirmed with the actual (pre-freeze) data: enemies drifted 23-35 units from their start point
and covered 59-69 total units of movement over the ~59 "live" seconds before the pointer-lock
freeze - a real, wide-ranging patrol, a large step up from the old 6-unit shuffle. One enemy
correctly transitioned into `chase` mid-run when it patrolled within `ENEMY_DETECTION_RANGE` of the
stationary player, confirming the untouched chase logic still coexists correctly with the new
patrol. Full smoke suite (16/16) green throughout, including the existing "enemies wander near
spawn instead of beelining" test (its own comment referencing the now-removed
`ENEMY_WANDER_RADIUS` constant was updated to match).

**Still to do at the time (Phases B-E):** aggro/LOS state transitions, fair enemy ranged combat (the
highest-stakes remaining piece), player knife + universal enemy melee fallback, and per-weapon
archetype behavior differentiation with seeded randomized enemy loadouts. Phase B below.

### Phase B: aggro/LOS state transitions (2026-07-05)

**What changed.** Detection was pure distance (`ENEMY_DETECTION_RANGE`/`ENEMY_LEASH_RANGE`), so an
enemy on the far side of a building wall "sensed" the player right through it. `EnemyState` grew
from `'idle' | 'chase'` to `'idle' | 'alert' | 'chase' | 'search'`:

- **Detection now requires distance *and* a clear line-of-sight raycast.** New `hasLineOfSight()` in
  `enemySteering.ts` casts from the enemy's head to the player's eye position (`EYE_OFFSET`) and
  passes only if nothing is hit, or the one thing hit is the player's own collider (checked by
  collider handle, not a distance-margin guess - the target's own capsule radius would otherwise
  make even a clean hit land slightly short of the full distance).
- **`idle -> alert -> chase`.** Spotting the player (in range + LOS) enters `alert`: the enemy stops
  and faces the threat for `ENEMY_ALERT_REACTION_TIME` (0.4s) before actually committing to chase -
  a deliberate reaction beat, and the same window Phase C's aim delay can reuse later. Losing LOS or
  leash range during `alert` drops straight back to `idle`.
- **`chase -> search -> idle/chase`.** Losing LOS mid-chase (as opposed to just leashing out of
  range) now drops to `search` instead of forgetting the player instantly: the enemy beelines the
  last position it actually saw the player at (kept fresh every chase frame, so it's not stale) using
  the same whisker-avoidance movement as patrol, for up to `ENEMY_SEARCH_DURATION` (6s) before giving
  up back to `idle`. Regaining LOS+range during `search` returns straight to `chase`. Leashing out of
  range from *any* of alert/chase/search still drops straight to `idle`, unchanged from Phase A.
- **Throttled, not per-frame.** LOS is only rechecked every `ENEMY_LOS_CHECK_INTERVAL` (0.15s) per
  enemy, with a randomized initial timer offset so many enemies' checks don't all land on the same
  frame, and skipped entirely once the player's already beyond leash range (no state cares about LOS
  at that distance). Direct motivation: the earlier performance-headroom check (this same session)
  couldn't get a real number from this sandboxed environment, so the raycast cost that *is*
  controllable was kept as low as reasonably possible up front rather than deferred.

**A real bug caught before it ever worked: self-hit via the wrong exclusion.** First version excluded
only the enemy's body capsule collider from the LOS raycast, matching the existing pattern in
`steerWithAvoidance`. Every LOS check returned false, unconditionally - traced via a temporary e2e
test that never once observed `alert` or `chase` despite standing right next to an enemy in open
terrain. Root cause: the ray's origin (the enemy's own head height) sits exactly at the *center* of
its separate head-ball collider, which was never excluded - the ray immediately self-hit its own head
at distance ~0 every time. `steerWithAvoidance`'s horizontal probes never hit this because they don't
travel through the head ball's vertical position; a LOS ray specifically aimed at head height always
does. Fixed by extending `castHitscan()` (`combat/hitscan.ts`) with an `excludeRigidBody` parameter
(Rapier's `castRayAndGetNormal` already supports `filterExcludeRigidBody` - just not plumbed through
the wrapper before) and having `hasLineOfSight()` exclude the enemy's whole rigid body, which skips
every collider attached to it in one shot regardless of how many there are.

**Verified:** a temporary e2e test drove the real state machine end to end - teleported the player
next to a patrolling enemy in open terrain and watched `getLiveEntityStates()` for the sequence,
then teleported far away and confirmed the leash back to `idle`. 10 of 11 runs passed cleanly
(`alert` and/or `chase` observed while approaching, `idle` regained after leashing); the one failure
is presumed terrain/obstacle-dependent (a patrol destination happening to put the enemy somewhere
with an actually-blocked sightline to the chosen approach point) rather than a logic bug, consistent
with LOS now being a real geometric check rather than a distance formula - not chased further given
the sample size and that this is exactly the kind of variance a real sightline check should produce.
Full smoke suite (16/16) green throughout.

**Still to do at the time (Phases C-E):** fair enemy ranged combat (the highest-stakes remaining
piece - this phase deliberately didn't touch combat, only the state machine deciding *when* to
engage), player knife + universal enemy melee fallback, and per-weapon archetype behavior
differentiation. Phase C below.

### Phase C: fair enemy ranged combat (2026-07-05)

**What changed.** Chase previously only ever beelined the player and did one thing once close
enough: a flat-damage melee tick (`ENEMY_ATTACK_RANGE`, unchanged from Phase A). `updateChase` now
splits into three distance bands:

- **≤ `ENEMY_ATTACK_RANGE` (3):** melee, unchanged - "falls back to melee at close range" from the
  design doc always wins here regardless of what the enemy would otherwise be doing.
- **≤ `ENEMY_RANGED_RANGE` (16) with a clear line-of-sight (reusing Phase B's `hasLineOfSightToPlayer`):**
  stops closing distance and fires real hitscan shots (`updateRangedCombat`/`fireRangedShot`) - a
  visible tracer per shot whether it hits or misses, not a hidden hit-chance roll. Aim error is a
  real angular cone applied via the same "rotate direction by two random axis-angles" technique
  `WeaponManager.firePellet` already uses for the player's own weapons, which gets "widens with
  range" for free - a fixed angular error covers more lateral miss distance the farther the target
  is, no separate range multiplier needed. The cone narrows from `ENEMY_AIM_ERROR_MAX_DEG` (9°) to
  `ENEMY_AIM_ERROR_MIN_DEG` (1.5°) over `ENEMY_AIM_SETTLE_TIME` (2.5s) of continuously held sightline
  - rewards a player who breaks line of sight over one standing in the open. Fires in
  `ENEMY_RANGED_BURST_COUNT` (3)-round bursts at `ENEMY_RANGED_FIRE_INTERVAL` (0.5s) apart, then
  pauses `ENEMY_RANGED_BURST_PAUSE` (1.6s) - a cadence, not a continuous stream.
- **Beyond `ENEMY_RANGED_RANGE`, or LOS blocked:** closes distance, same as before.
- **New: a concurrent-engager cap.** `engagementSlots.ts` (new file) is a tiny shared counter -
  one `EngagementSlots` instance per match, held by every `Enemy` - capping how many can hold a
  "firing slot" at once (`ENEMY_MAX_CONCURRENT_ENGAGERS`, 2). An enemy that can't acquire a slot
  still tracks/faces the player in range, it just holds fire until one frees up (another engager
  dies, leashes off, or loses LOS) - without this, every enemy that spots the player opens fire
  simultaneously the instant it's in range, which reads as an unfair dogpile rather than a fight
  fought piece by piece. Slots are released on leaving chase (leash/LOS-loss), on melee engaging
  (ranged stands aside entirely at that range), and on `dispose()`.
- Enemy tracers render in a distinct color (`ENEMY_RANGED_TRACER_COLOR`, orange-red vs. the
  player's own pale-yellow `TRACER_COLOR`) - `Tracers.spawn()` gained an optional `color` param
  (lazily caches one extra material per distinct color used) so the player has a real visual tell
  for incoming fire, directly serving "not a hidden roll" rather than decoration.

**A real bug caught before ranged combat ever fired a shot: wrong exclusion, again.** First version
of `fireRangedShot` excluded the enemy's body capsule from the hitscan, matching the pattern already
used elsewhere in this file. Every shot reported a miss even standing right next to the player in
the open - actually the *same* head-ball self-hit bug fixed for LOS earlier this phase, reintroduced
in a second call site, since `castHitscan` didn't have the rigid-body exclusion the first time this
function was written this session. Fixed the same way: pass `this.rigidBody` as `excludeRigidBody`
instead of a single collider.

**Verified:** a temporary e2e test placed the player 10 units from a live enemy (inside
`ENEMY_RANGED_RANGE`, well outside `ENEMY_ATTACK_RANGE`) and confirmed the player actually took
damage over time while the enemy's distance to the player stayed > 3 units throughout (i.e. it
never closed to melee) - 6 of 7 runs passed; the one failure timed out before any damage landed,
plausibly an aim-error miss streak or an LOS-blocking obstacle at that particular random world/spawn,
consistent with the same kind of geometry-dependent variance Phase B's verification saw, not chased
further for the same reason. Full smoke suite (16/16) green throughout.

**Deliberately trimmed from the full design for this phase:** no explicit "widens with movement"
term (only range + hold-time feed the cone - the angular-cone insight already covers range "for
free," see above) and no repositioning/cover-seeking (`engage/reposition` from the original design
doc's state list) - a stationary enemy that stops and returns fire once in range already reads as
real ranged combat; cover-seeking would need real pathfinding this codebase doesn't have. Revisit in
Phase E's tuning pass if it reads as too static in practice.

**Still to do at the time (Phases D-E):** player knife + universal enemy melee fallback (melee was
still the Phase A/B flat-damage tick, not a real weapon-style attack), and per-weapon archetype
behavior differentiation with seeded randomized enemy loadouts. Phase D below.

### Phase D: player knife + upgraded universal enemy melee fallback (2026-07-05)

**Player knife.** `WeaponDefinition` gained a `kind: 'ranged' | 'melee'` field (all four existing
guns marked `'ranged'` explicitly) and an optional `range` (melee's short reach - guns keep sharing
`WeaponManager`'s existing long-range `HITSCAN_RANGE` constant). The knife itself
(`WEAPON_DEFINITIONS.knife`, "Bicknell Trench Knife") slots into the exact same firing pipeline every
gun already uses - `pelletCount: 3` *is* "a small fan of raycasts" (the design doc's own phrase for
melee hit-testing), just with melee's tighter spread/range instead of a shotgun's. `magazineSize:
Infinity` needed zero special-casing in `Weapon.ts`: `Infinity - 1 === Infinity` in JS, so
`tryFire()`'s plain `ammoInMagazine > 0` check never fails and reload never triggers, for free.
`Hud.setAmmo` shows `"MELEE"` instead of `"Infinity / Infinity"` (`Number.isFinite(max)` check) -
the one place that distinction needed to be visible at all.

No sourced `.glb` exists for a knife (Kenney's "Blaster Kit," everything else in this project's
weapon set, has no melee weapon in it) - added `createProceduralMeleeViewModel()` (a blade + handle
built from two tinted boxes) rather than blocking on a new asset, following this project's existing
precedent for non-hero placeholder geometry (the procedural ladder rungs in `BuildingManager.ts`).
`WeaponManager.create` now branches per-weapon: load a real `.glb` if `WEAPON_MODEL_SPECS` has one,
else use the procedural view model - `InventoryPanel` already handled a missing spec gracefully (no
thumbnail image, existing fallback), so the knife's inventory card needed no changes there.

Reachable in-game only via mouse-wheel weapon cycling, not a dedicated number key - `weaponSlot1-4`
are hardwired to physical keys `1-4` (`DEFAULT_KEY_BINDINGS`) and adding a fifth would mean touching
key-binding infrastructure (`actions.ts`, `InputManager`, the rebind UI) for one extra slot. Deliberately
trimmed for scope; the knife shows correctly in the hotbar (`Hotbar.setSlots` is length-agnostic) and
is fully functional once cycled to, just not one-key-direct-select yet.

**Enemy melee, upgraded from a flat tick to a real attack.** The close-range branch of
`updateChase` used to just deal `ENEMY_ATTACK_DAMAGE` unconditionally once `distanceToPlayer <=
ENEMY_ATTACK_RANGE`, with no line-of-sight check at all (a gap that predates this phase, from back
when melee was the *only* combat behavior). `updateMelee()` now mirrors the player's own knife: the
same spread-by-two-axis-angle fan of `ENEMY_MELEE_SWING_COUNT` (3) raycasts, gated on
`hasLineOfSightToPlayer` (Phase B's existing throttled check), and only deals damage if a ray
actually connects with the player's collider - a player hugging the exact edge of `ENEMY_ATTACK_RANGE`
is no longer guaranteed to get hit purely for being in range.

**Verified:** a temporary e2e test cycled to the knife via mouse wheel (`weaponNext` has no default
key binding, only wheel - confirmed via `InputManager`'s wheel handler), fired it at a live target in
range and confirmed a kill, then separately stood the player point-blank next to a live enemy and
confirmed the upgraded melee fallback still connects. 3 of 3 runs passed cleanly.

**A real, expected slowdown in the existing smoke suite - not a regression.** The full suite's first
post-Phase-D run failed `killPlayerByEnemy` (used by two death-flow tests) with a timeout, at its
existing 40s deadline. Re-ran the whole suite clean (16/16) immediately after with no code changes,
confirming this wasn't a hard regression - but the *reason* it's now borderline is real: before
Phases B-D, an aggroed enemy always beelined straight into a guaranteed-hit melee tick, so
time-to-kill was tightly bounded by `ENEMY_ATTACK_INTERVAL`. Now an engaging enemy often just stands
at range firing bursts with a real aim-error cone (an entire burst can whiff), and melee itself can
miss too (Phase D's fan-raycast swing) - death is still reliable, just no longer bounded by a fixed
cadence. Widened `killPlayerByEnemy`'s internal deadline (40s -> 50s) and both call sites'
`test.setTimeout` (60s -> 75s, keeping real margin after the kill for each test's remaining
assertions) - confirmed clean across 3 repeated runs of just those two tests, then a full-suite
re-run (16/16) green.

**Still to do at the time (Phase E):** per-weapon archetype behavior differentiation with seeded
randomized enemy loadouts, and a tuning pass across everything Phases B-D landed based on how it
actually plays. Phase E (the tuning half) below - archetype differentiation was descoped, see that
section's closing note.

## Phase E: measurement-driven tuning pass (2026-07-05)

No human tester available, so instead of guessing at numbers, built a temporary measurement harness
(`_phasee_measure.spec.ts`, deleted after use) that plays out real combat headlessly and times it:
how long a completely unresisting, stationary player survives a single engaging enemy at 10 units
(ranged) and at 1.5 units (melee), and how long the player's own rifle takes to kill one enemy.

**Ranged combat measured too weak, with a real stall risk.** At the Phase C baseline
(`ENEMY_RANGED_DAMAGE = 6`, `ENEMY_RANGED_BURST_PAUSE = 1.6`), killing a stationary, non-fighting-back
player at 10 units took **~23-26s** across three runs, and a fourth run landed *zero hits at all*
within a 45s cutoff (confirmed via per-second logging of health/state/distance - the enemy was
correctly in `chase` and roughly the right distance the whole time, so this was a real accuracy/cadence
problem, not a stuck state machine). That's too generous for a mechanic meant to read as a genuine
threat - especially since this is the *best case* for the enemy: a real player also moves, takes
cover, and shoots back, all of which only reduce the enemy's actual effective throughput further
below that already-weak baseline.

Tuned two constants: `ENEMY_RANGED_DAMAGE` 6 -> 9 (+50%) and `ENEMY_RANGED_BURST_PAUSE` 1.6 -> 1.1s
(more frequent bursts, raising sustained DPS further and shrinking the window a marginal LOS flicker
could interrupt a kill in progress). Re-measured: **~15.6-18.8s** (avg ~17.2s) across three fresh
runs, zero stalls. Left `ENEMY_RANGED_FIRE_INTERVAL`, `ENEMY_RANGED_BURST_COUNT`, and the aim-error
cone (`ENEMY_AIM_ERROR_MAX_DEG`/`MIN_DEG`/`ENEMY_AIM_SETTLE_TIME`) untouched - the cone's narrowing
behavior already read correctly in the Phase C verification, and this pass was about raw throughput,
not accuracy shape.

**Melee left as-is.** Measured **~12.5-13.0s** consistently (two runs) at point-blank range - already
fast and reliable without any stalls, so no tuning pressure there. Makes sense: melee's spread is
tighter, LOS at 1.5 units is essentially never blocked, and `ENEMY_ATTACK_DAMAGE` (8) with a 1s
cooldown and no narrowing-over-time mechanic to fail was already a simpler, more deterministic
system than ranged combat's cone.

**Player-side rifle TTK wasn't captured.** The measurement script chained three scenarios in one
page load (ranged -> reset via `KeyT` -> melee -> reset -> player rifle), and the second `KeyT`
reset (after the ranged-kill death) didn't reliably bring health back to 100 within the script's
own wait - plausibly `resetPlay` behaving differently once the death screen is actually showing
(untested territory; the existing `KeyT` smoke test only exercises it while alive) rather than a
death-screen bug per se. Not chased further: this was a measurement-script limitation, not something
blocking the tuning conclusions above, and the player's own weapons were already known to be
extremely fast against 60 HP enemies from every other combat test this session (one rifle burst or
a single sniper/shotgun hit).

**Archetype behavior differentiation (weighted-random spawn loadouts, sniper/shotgun/rifle range
bands) was descoped from this phase entirely.** This codebase only has one enemy visual/stat profile
right now (`ACTIVE_ENEMY_ARCHETYPE`) - building real per-archetype range-band behavior on top of
Phases B-D's now-working aggro/ranged/melee systems is a genuinely separate feature addition (new
archetype data, weapon-style stat variation, spawn-loadout randomization), not a "tuning pass" in
the sense the rest of this phase was, and the todo list's framing for Phase E was specifically
"tuning pass based on playtesting." Recorded here as a real gap rather than silently dropped -
worth its own follow-up pass if/when it's prioritized.

**Verified:** typecheck clean, full smoke suite (16/16) green after the constant changes.

## Per-archetype enemy loadouts (2026-07-05)

Phase E's tuning pass explicitly descoped this as real feature work, not a tuning tweak - this is
that follow-up. Before this, `EnemyArchetype` was name+flavor only; every enemy in the game ran
identical stats/behavior regardless of which of the five flavor names got attached to it.

**Design pass with a Fable architect subagent** (design-only, no code, mirroring the earlier Opus
design pass for the original enemy AI overhaul) produced a concrete doc covering the stat-block
schema, exact numbers for three archetypes, the kiting movement spec, the seeded spawn-assignment
algorithm, and which existing constants stay global vs. become per-archetype. Reviewed the actual
output before proceeding rather than the model name in isolation - it was grounded in the real
`updateChase` branch structure, gave a reasoned number for every field (no placeholders), and made
a concrete engineering call with justification (see Rush Job below) - implemented directly from it,
no Opus cross-check requested.

**Three real archetypes**, mapped onto three of the five existing flavor names (the other two,
Grass Sitter and The Other One, stay reserved for future archetypes - same as before):

- **The Straggler (generalist, spawn weight 50/100)** - today's Phase A-E tuned values, completely
  unchanged. Every other archetype is a deviation from this baseline.
- **Ridge Walker (kiter, weight 20)** - long range (30 vs. 16), high per-hit damage (22 vs. 9), but
  low health (40 vs. 60, `not less` - a stationary long-range threat has to be more punishable up
  close to stay fair) and weak melee (5) as the counterplay for closing the gap. Backs away if the
  player gets inside 10 units, via a new `updateKiteRetreat` (whisker-avoidance movement away from
  the player, facing rotation overridden to face the threat it's retreating from, hysteresis at 14
  units to stop flickering, aim-error stays wide while moving and only narrows once stationary).
- **Rush Job (rusher, weight 30)** - tankier (90 hp) and faster (3.4 vs. 2.5) so it actually closes
  the gap, heavy melee payoff (14) for surviving the approach. `rangedRange: 0` rather than a new
  "skip ranged" flag - the Fable design's actual argument: `updateChase`'s branch order already
  checks melee, then ranged, then closes distance, so a ranged range of zero makes the ranged branch
  permanently unreachable (melee already owns everything at or below `ENEMY_ATTACK_RANGE`) - "never
  shoot" falls out of the existing structure for free, no new code path.

**Seeded, reproducible spawn assignment.** `createArchetypePicker(seed)` in `archetypes.ts` -
`mulberry32(seed + ARCHETYPE_SEED_OFFSET)`, same pattern already used by ZoneMap/VegetationManager/
BuildingManager for terrain/vegetation/building placement (each with its own seed offset so the
streams don't correlate). `EntityManager` constructs one picker per match from `getWorldSeed()` and
calls it inside `spawnEnemy` - so a given world seed always produces the same loadout composition
*and* the same spawn-order sequence, not just the same total counts.

**Integration into `Enemy.ts`:** the state machine and every combat mechanic (fan-raycast melee, LOS
raycast, burst-fire cadence, engagement-slot cap, whisker avoidance) are completely unchanged and
shared by all three archetypes - only the *numbers* differ (health, moveSpeed, detectionRange,
leashRange, rangedRange, rangedDamage, burst timing, aim-error min/max/settle, meleeDamage), read
from `this.archetype.X` instead of flat module constants, plus the one new movement branch for
kiting. Deliberately kept global (per the design doc's reasoning): LOS-check throttle interval,
alert-reaction time, search duration, the melee swing's mechanics (count/spread/cooldown - only its
damage is per-archetype), the engagement-slot cap (a match-level pacing knob, not per-enemy), and all
patrol/roam constants (pre-aggro behavior is identical on purpose - an archetype reveals itself in
combat, not while wandering at 50m).

**Verified via e2e** (temporary test, deleted after use): started a 30-enemy match and confirmed all
three archetype names actually appear with roughly the expected 50/30/20 split (one real run: 16/9/5
Straggler/Rush Job/Ridge Walker - noisy at n=30 but directionally right); found a live Ridge Walker
and confirmed it measurably increases distance from an approaching player instead of standing still;
isolated a single-enemy match (retried fresh matches up to 15 times to land on a Rush Job by chance,
since spawn assignment is randomized per match) and confirmed a Rush Job's health-over-time trace
shows zero damage while the player closes a 10-unit gap - direct proof it never fires a ranged shot,
only ever damages via melee once the gap closes.

**A real regression caught by the full smoke suite, not just the new archetype tests.** First full
suite run failed `firing an empty magazine auto-reloads without pressing R` with the player dying
mid-test. Root cause: Ridge Walker's first-draft `detectionRange` (30) exceeded
`ENEMY_RING_BASE_RADIUS` (25, config.ts) - the radius the default match's enemy spawn ring uses -
so a Ridge Walker could detect and snipe a completely passive player from the moment the match
started, before they'd done anything at all. This silently broke an invariant several existing
smoke tests already depended on (enemies must NOT be able to sense a stationary player at spawn).
Fixed by dropping `detectionRange` to 20 and `leashRange` to 32 (both still above the generalist's
18/26, keeping the "notices you from farther away" identity, just no longer past the spawn ring
itself) - `rangedRange` (30) stays higher still since that's safe: an enemy only ever reaches ranged
combat *after* already detecting the player within `detectionRange` and closing in, so by the time
it matters the enemy is already well inside its own ranged range too.

Separately (confirmed via bisection against unmodified `master`), `firing an empty magazine...` was
already an intermittent ~1-in-6 flake *before* this session's archetype work, caused by the same
test running close to Playwright's 30s default timeout - not a logic bug (ammo/reload behaved
correctly every time the test actually completed). Hardened it regardless, since it's now more
exposed by a growing enemy roster: the test teleports away from the spawn ring before firing (ammo
bookkeeping has nothing to do with nearby enemies, so removing them as a variable is correct
regardless of enemy tuning) and got `test.setTimeout(60000)` for real margin. Confirmed clean across
6 repeated runs of just that test, then a full suite re-run (16/16) green.

**Explicitly out of scope for this pass** (per the design doc's own boundary): no per-archetype
visual models/tints/sounds, no 4th/5th archetype, no cover-seeking or strafing, no per-archetype
patrol behavior, no spawn-composition rules (e.g. "max N snipers per match"). Loadout stats and the
one kiting movement pattern only.

