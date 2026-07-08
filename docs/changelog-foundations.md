# Changelog & Foundations

Early foundational v1 notes and whole-codebase review follow-through that do not cleanly belong to one system, extracted from the original NOTES.md.

# Playtest Notes — v1 (Phases 0-7) + Phase 8 + Content Pass + Real Assets + Fable Pass

Feedback from the first playtest, triaged into: real bugs, missing pieces that belong in v1's
own combat loop, and things that were deliberately deferred past v1 per PLAN.md.

## Fable pass (step 3) — pilot passed, integrated, plus one added feature

Ran the Section 8 pilot: asked Fable for 5 enemy archetype names/flavor lines and 4 weapon
names/flavor lines for a grounded, wry (not cartoonish, not grimdark) tone. Output was genuinely
good - tight, consistent voice, and the shotgun line ("Eight opinions, delivered all at once, at
conversational range") directly references the actual `pelletCount: 8` mechanic without being
told to. Cleared the bar for integration on the first try, no revision needed.

Integrated:
- Weapon `name`/new `description` field in `definitions.ts`: Kestrel P9 (pistol), VR-4 Fieldhand
  (rifle), Hedgerow 12 (shotgun), Marchand Longview (sniper) - replacing the generic "Pistol"/
  "Assault Rifle"/etc. labels. New `ui/weaponCaption.ts` shows name + flavor briefly on switch.
- Enemy archetypes in `entities/enemies/archetypes.ts`: all 5 are recorded, but the game only
  has one enemy *behavior* right now, so only one ("Rush Job" - its flavor line matches the
  actual chase-aggressively behavior) is wired in as `ACTIVE_ENEMY_ARCHETYPE`. The other four
  are unused, documented reference content for whenever enemy AI variety (a real behavioral
  difference per type, not just a name swap) gets built - didn't fabricate fake variety just to
  use all five names.
- New `ui/killFeed.ts`: a top-center toast on every kill ("Target destroyed" / "Rush Job
  eliminated"), which required threading a `killFeedLabel` through `EntityManager`'s `onKilled`
  callback (previously just `() => void`, no info about what died).

Found one layout bug while screenshotting the result: the weapon caption's two lines of text
overlapped the hotbar underneath it (both were positioned independently without accounting for
each other's height). Fixed by moving the caption from `bottom:100px` to `bottom:150px`.

Also added a **practice-reset feature** (not from Fable - a separate ask): press **T** to
respawn all targets/enemies at their ring positions, instantly refill every weapon's ammo
(`Weapon.refillAmmo()`, new), teleport the player to spawn at full health, and zero the score -
a clean restart without a page reload. Works from the death screen too, since the key check runs
unconditionally at the top of `Game.update()` rather than being gated on alive/dead state.

## Real assets pass (step 2) — Kenney CC0 models, and a big rendering bug found by using them

Sourced free CC0 assets per PLAN.md's asset pipeline instead of guessing at URLs: found current
download links via web search + fetch, downloaded and inspected the actual zip contents rather
than assuming file layout.

- **Weapons**: Kenney "Blaster Kit" - blaster-h (pistol), blaster-e (rifle), blaster-p (shotgun),
  blaster-f (sniper), target-large (replaces the placeholder sphere target). `viewModel.ts` is
  now data-driven per weapon (path/scale/rotation in `WEAPON_MODEL_SPECS`), and `WeaponManager`
  became an async factory (`WeaponManager.create`) since loading .glb files is async - same
  pattern as `PhysicsWorld.create()`. Also downloaded `scope-large-a.glb` from the same pack as
  a candidate scope attachment for the sniper's view model, but did not actually wire it in this
  pass (the sniper's full scope-overlay UI from Phase 5 already covers "looking through a
  scope"; the model attachment would only be a cosmetic addition visible before full ADS) -
  it's sitting in `public/assets/models/weapons/` unused, worth picking up later.
- **Enemies**: Kenney "Mini Characters" - character-male-a.glb, which comes rigged with 30+
  animation clips. Enemy now uses `SkeletonUtils.clone` (not a plain `.clone()` - required for
  skinned meshes, a plain clone shares the skeleton and breaks every instance but the first) and
  an `AnimationMixer` crossfading between "idle" and "walk" clips based on movement state.
- New `src/core/AssetLoader.ts`: caches `GLTFLoader.loadAsync()` promises per path so multiple
  entities sharing a model (5 targets, 3 enemies) only fetch/parse it once.

**Found via this work, not before it: the weapon view model was never actually rendering.**
`camera.add(weaponGroup)` parents the gun to the camera object, but `Renderer.ts` never added
the camera itself to the scene - `renderer.render(scene, camera)` only traverses the `scene`
graph, so anything parented to a camera that sits outside that graph silently never renders,
even though every other property (position, visible, scale) looks completely correct on
inspection. This means **the placeholder box-gun was never visible either**, the whole time,
across every prior phase and screenshot - it just wasn't obvious with primitive shapes bottom-
right of frame the way it became obvious once a detailed, textured model was expected there and
nothing showed up. Fixed with one line (`this.scene.add(this.camera)`) in `Renderer.ts`.

Also found and fixed while wiring the real target model: the "bullseye" hit-bonus collider was
initially placed **concentric** with the body collider (same center, smaller radius) - which is
geometrically unreachable by any ray, since a smaller sphere fully enclosed in a larger one
always has the outer sphere's surface as the closest intersection point. No ray could ever reach
it. Fixed by offsetting it to protrude slightly toward the viewer instead.

Verified all of this the same way as the self-hit bug: build a hypothesis, check it with a
throwaway script against the live game (screenshots, scene-graph inspection via a temporary
debug hook, a rotation comparison render), not by reasoning about Three.js/glTF conventions from
memory. The target model's correct facing rotation in particular came out backwards from the
first analytical guess (rotation.y = π/2 looked right on paper, was wrong in practice) and was
only nailed down by rendering four candidate rotations side by side and reading off the one that
actually showed the painted face.

## Content pass (post-Phase 8) — what changed and one deliberate non-change

Added: Assault Rifle (automatic, data-driven via a new `automatic` flag - holding fire uses
`isActionActive` instead of edge-triggered `consumeJustPressed`) and Shotgun (`pelletCount: 8`,
each pellet an independent hitscan ray within a wide spread cone, one recoil kick per trigger
pull not per pellet). Enemy AI gained idle/wander (stays within `ENEMY_WANDER_RADIUS` of spawn)
vs. chase (only once the player is within `ENEMY_DETECTION_RANGE`, with a wider `ENEMY_LEASH_RANGE`
for hysteresis) instead of always beelining from anywhere on the map. Sound design is fully
procedural (Web Audio synthesis in `src/audio/SoundEngine.ts` - noise bursts + oscillators, no
audio files) for gunshots (per-weapon timbre), footsteps, hit confirmation, reload, and taking
damage.

**Deliberately did not tune ADS numbers** (`ADS_LERP_SPEED`, sensitivity-by-zoom-ratio) in this
pass - there's no concrete feedback yet on how it actually feels post-fix (the original "aim
doesn't work well" report predates the self-hit bug fix and the hit-confirmation additions, both
of which likely explain most of it). Guessing at number changes without data risks being a
placebo fix. Extended the Playwright suite instead (ADS FOV narrows/restores, automatic fire,
enemy wander-vs-chase) so there's a harness to verify actual tuning changes against once real
feedback comes in.

## Update — root cause of "enemies don't get killed" found (via Playwright, post-Phase 8)

Added a Playwright e2e suite (`e2e/`) so tests could be run directly instead of reasoning from
code. The very first "aim at a target and kill it" test failed - and the cause was a genuine,
previously-undiscovered bug, not a missed-shot/no-feedback issue as guessed below:

**`WeaponManager.fireHitscan()`'s ray origin (`camera.position`) sits inside the player's own
capsule collider**, so without an exclusion filter the ray immediately self-hit at distance 0
on every shot. `isDamageable()` was a pure structural check ("has a `takeDamage` function"), and
`Player` also grew a `takeDamage()` method in Phase 8 for its own health system - so the player
satisfied that check and got hit by their own gunfire, every single shot, since Phase 8 was
added. Shots never reached real targets/enemies at all.

Fixed: `castHitscan()` now takes an `excludeCollider` param (Rapier's own
`filterExcludeCollider`), and `Damageable` now uses a nominal `isDamageableTarget: true` marker
instead of structural typing, so `Player` can't accidentally match it again just by having a
same-shaped method. See commit for full detail.

This means the *pre-Phase-8* "enemies don't get killed" report (below) can't have had this exact
cause (Player didn't have `takeDamage` yet), but it's the same symptom and this bug would have
made it persist regardless of any other fix. Worth actually playtesting again now that both the
original hit-feedback gap (Phase 8) and this self-hit bug are gone.

## Bugs found (investigated after feedback)

- **Hitscan ray origin was one frame stale.** `WeaponManager.fireHitscan()` used
  `camera.getWorldPosition()`, which reads from the camera's cached world matrix - only
  refreshed during `render()`, which runs *after* that tick's fire/movement logic. Since the
  camera has no parent, `camera.position` is already correct and doesn't have this staleness.
  **Fixed** (`src/weapons/WeaponManager.ts`). Effect was small (a few cm of origin error, one
  frame behind player movement) - unlikely to fully explain missed shots on its own, but it was
  a genuine correctness bug and is now gone.

## Reported as broken, likely explained (not yet visually confirmed - no browser access here)

- **"Can't change guns."** Traced the switch logic end to end (`WeaponManager.handleSwitchRequests`
  / `updateSwitching`) and it looks correct - number keys and scroll should both work, and the
  HUD's weapon-name/ammo text should update. Best explanation: **both weapons use the exact same
  placeholder mesh** (`createPlaceholderWeaponMesh()` takes no weapon-specific input), so a
  successful switch is visually silent. Likely not a logic bug so much as a "you can't see it
  worked" problem.
- **"Enemies don't get killed."** Damage/death code (`Target.takeDamage`, `Enemy.takeDamage`,
  `EntityManager.update`) looks correct on read-through, and the collider registry (verified
  empirically back in Phase 7) resolves hits to entities properly. No hit confirmation exists
  anywhere (no hit marker, no damage number, impact marker is a tiny 0.04-radius dark sphere
  that's easy to miss against terrain) - so there's currently no way to tell "did that shot even
  land" from "did I miss." This is the most likely explanation, but it's also possible some
  shots really were landing on terrain/rocks first (LOS blocked by hills at the 15-25 unit spawn
  ring) - can't fully rule that out without a live test.

## Missing pieces that belong in v1's combat loop (scope gap, not "future extensions")

The original plan's Phase 7 only covered the player shooting entities - it never gave enemies
a way to threaten the player back, which is why this doesn't feel like real combat yet:

- No player health / no way to die
- Enemies never attack or damage the player - they just walk up and stand there
- No visible feedback that a shot landed (hit marker, damage number, brighter/bigger impact FX)
- No tracer/visible bullet path (intentional for hitscan, but with zero visual travel and a
  barely-visible impact dot, shots feel like they vanish)
- Weapon switch has no visual distinction between weapons (see above)
- No reload animation/cue beyond the HUD text flipping to "RELOADING…"
- ADS "feel" - ADS_LERP_SPEED / sensitivity-by-zoom-ratio tuning has never been playtested,
  only read-through-verified

## Confirmed working as designed (placeholder-quality, not bugs)

- Graphics/animations "scuffed" - expected, all placeholder box/sphere/capsule primitives per
  the plan's free-asset section (nothing from Kenney/Mixamo/Poly Haven has been sourced yet)
- No gun view model animation (fire kick exists via recoil, but no reload/draw animation clips -
  there's no rigged model to animate)

## Explicitly out of v1 scope (per PLAN.md's own Future Extensions section)

- Lobby - implies multiplayer, which PLAN.md explicitly deferred ("requires architectural
  foresight now" but not implemented in v1)
- Settings menu - never in the phase list
- Weapon/player skins - cosmetic customization, not in the phase list

None of these were overlooked - they were intentionally out of the original 8-phase scope.

## Whole-codebase review follow-through: 13 of 15 items implemented, 2 deferred (2026-07-05)

`CODE_REVIEW.md` (a fresh whole-codebase review, ~7,500 lines, Fable 5 model) produced 15
prioritized improvement items. Worked through them roughly in the review's own priority order,
grouping related fixes into separate commits the way this project's history already does. Full
commit list is in the session's final report; this entry covers what changed and why, grouped by
theme rather than by commit.

**Lifecycle bugs (items 1, 2, 7 - the review's own top priority, "highest-value, lowest-risk"):**
`SoundEngine` now has a real `dispose()` (stops the keep-alive oscillator, closes the
`AudioContext`) called from `Game.dispose()` - previously every lobby->match cycle leaked a
running `AudioContext` until the browser's concurrent-context cap would eventually kill audio
outright; the keep-alive oscillator is also rerouted through the master gain so volume/mute now
actually applies to it. `spawnEncountersAsync` takes an `isCancelled` check (a generation counter
bumped by `resetPlay`/`dispose`) evaluated after every frame-yielded batch - closes both the
double-spawn race (rapid double-reset previously left two spawn loops running, overshooting the
match's entity count) and the use-after-free (returning to the lobby mid-spawn had the surviving
loop calling `createRigidBody` on the already-freed WASM world). `InputManager`'s `contextmenu`
listener is now a named handler actually removed in `dispose()` (the old anonymous registration
stacked one document-level listener per match); `Settings.getKeyBindings()` returns a copy instead
of the live internal object.

**Dead code (item 3):** deleted every `ENEMY_*` constant in `config.ts` that the per-archetype
refactor had already made unreachable (`ENEMY_HEALTH`, `ENEMY_SPEED`, `ENEMY_DETECTION_RANGE`,
`ENEMY_LEASH_RANGE`, the `ENEMY_RANGED_*`/`ENEMY_AIM_*` block, `ENEMY_ATTACK_DAMAGE`) along with
their multi-paragraph tuning comments, which had gone stale and were actively describing numbers
the game no longer reads from that file - verified by grep before and after. The surviving baseline
values live on The Straggler's archetype entry now, with the Phase E measured-TTK tuning note moved
there too.

**Testing (item 4 - "the single highest-leverage testing investment available" per the review):**
added the project's first unit-test layer, Vitest, scoped to `src/**/*.test.ts` so it never
collides with the Playwright e2e suite (`npm run test:unit`, additive - `npx playwright test` is
unchanged). Three tests lock in invariants that had each already been broken once and caught only
by hand: `ZoneMap.test.ts` sweeps 1000 seeds confirming the guaranteed-zone-count/full-size/
distinct-cell/nearest-site-wins invariants from `computeGuaranteedSites`'s own docstring;
`archetypes.test.ts` enforces `detectionRange < ENEMY_RING_BASE_RADIUS` for every archetype (the
exact Ridge Walker match-start-sniping regression from the per-archetype loadouts session) plus
kite hysteresis ordering and picker determinism; `rng.test.ts` covers `mulberry32` determinism/
range/uniformity. `setWorldSeedForTesting()` added to `worldSeed.ts` as a documented test-only
escape hatch.

**Determinism and dedup (items 5, 9):** enemy patrol (destinations, repath timers, LOS-check phase
offset) now draws from a per-enemy seeded `mulberry32` stream (world seed + spawn index) instead of
raw `Math.random` - completes the "reproducible world" story archetype assignment already had; the
`pickPatrolDestination(spawn, rng)` plumbing for this already existed, only the call site was
wrong. The spread-by-two-axis-angle technique, previously duplicated verbatim in
`WeaponManager.firePellet`, `Enemy.fireRangedShot`, and `Enemy.updateMelee`, is now one
`applySpreadCone()` helper in `src/combat/spread.ts`, with the known square-ish/diagonally-biased
distribution documented in exactly one place instead of three.

**Enemy hot-path and behavior (items 6, 10 - "the clearest hot-path scaling issue" and "the most
player-visible AI artifact"):** `Enemy.applyPosition` now caches its last sampled terrain height and
only resamples after 0.25 units of horizontal drift, instead of paying a 4-octave fBm + 9-cell
Worley zone scan every frame for every moving enemy - the dominant per-enemy cost at the 50-enemy
match cap. Separately, chase movement switched from the old deliberate beeline (`moveToward`) to
the same whisker-avoidance steering patrol/search/kite already used (`moveTowardWithAvoidance`) -
chasing enemies used to visibly clip through tree trunks and boulders because a head-height LOS ray
clears past obstacles whose ground-level collider still blocks movement; the now-unused
`moveToward` was deleted.

**Fairness/readability polish (items 11, 12):** enemy gunshots are now distance-attenuated (full
volume inside 10 units, linear fade to a 0.15 floor at 60, never fully silent) instead of playing
at uniform full volume regardless of the shooter's distance - undermined the same combat-
readability goal the ranged-combat tracer work exists for. `VegetationManager`'s forest-density
candidate budget now samples membership at a chunk's center *and* all 4 corners (max, not average)
instead of center alone, removing the chunk-grid-aligned tree-density cliffs that showed up along
forest edges when a chunk's corner overlapped a forest but its center didn't.

**e2e suite maintainability (item 8):** added `findFirstEnemyIndex(page)` (identifies the first
live enemy by archetype, since targets report none) to replace the hard-coded "index 5 is an
enemy" assumption baked into three tests and `killPlayerByEnemy` - only true for the default
5-target/3-enemy match with the current spawn order, and would have broken obscurely on any
reorder. Added `window.__gameDebug.damagePlayer(n)` - the one deliberate exception to the
aim-only debug API's no-gameplay-cheats rule, used by exactly one of the two death-flow tests
(the other keeps real combat via `killPlayerByEnemy`, so the genuine enemy-damages-player path
stays covered end to end) - cuts that test's worst case from ~90s of staged combat to one tick.
Caught a real bug writing this: the hook originally applied damage immediately on call, but
`update()` detects the death transition by comparing `isDead` *across* a tick, so damage landing
between ticks made the transition unobservable and the death screen never showed. Fixed by queuing
the damage and applying it inside the next `update()` tick, the same within-tick path enemy damage
already takes.

**Render interpolation (item 13):** `Loop`'s fixed-timestep accumulator already computed a
fractional tick progress (`alpha`) for exactly this purpose, but `Game.render(_alpha)` ignored it,
so camera motion visibly stepped at 60Hz on displays faster than the simulation. `Player` now
tracks `previousCameraPosition/Quaternion` independently of `camera.position` itself (captured at
the start of `update()`, before `applyMovement`'s authoritative write), and `interpolateCamera(alpha)`
blends them for rendering only - never fed back into the next tick's "previous," so no drift.
Deliberately scoped to the camera only (weapon view models come along for free, being parented to
it) rather than every enemy/target mesh - the highest-value, lowest-risk slice per the review's own
sizing, and it needs no new e2e-visible bookkeeping since `getLiveEntityPositions()` etc. read
physics-authoritative positions, never the camera. `respawn()`/`debugTeleport()` snap both
interpolation endpoints together so a teleport cuts instantly instead of drawing a one-frame streak.

**Deferred (items 14, 15), per this pass's explicit authorization to scope down or skip risky
items rather than force them through:**
- **Item 14 (GameSystems registry)** - not attempted beyond this assessment. `Game`'s 22-parameter
  constructor is exactly as fragile as the review describes, but the fragility is entangled with
  two already-documented forward-reference hacks (`scoreState`, the `gameRef` circular dependency
  for `DeathScreen`/`PauseMenu` callbacks) and one implicit-ordering hack (`PauseMenu` constructed
  before `SettingsPanel` purely for DOM paint order). A mechanical "collect into a disposables
  array" slice was considered and rejected: `update()`/`render()` need each system's specific typed
  methods (`hud.setAmmo`, `weaponManager.ammo`, etc.), so a generic registry array would have to
  coexist alongside the individually-typed fields rather than replace them - not a real reduction
  in the "three places to forget," just moving the list around. A genuine fix means redesigning
  around the forward-ref hacks first, which is bigger than "introduce a registry" and risks
  destabilizing working teardown/paint-order behavior for a cosmetic win. Left as-is.
- **Item 15 (worker-thread chunk generation)** - skipped entirely, per the review's own "only worth
  it if real-hardware p95 numbers confirm" framing and this pass's explicit pre-authorization to
  skip it. This sandbox's Chromium renders via SwiftShader (software GPU, see PERFORMANCE.md), so
  there's no way to measure whether the p95 spikes this would fix are actually a problem on real
  hardware, and a worker migration is real architectural surgery (structured-clone or SharedArrayBuffer
  transfer of heightfield data, moving `sampleHeight`'s noise/zone dependencies off the main thread)
  that shouldn't be attempted blind.

**Verification methodology for this whole pass:** every item ran `npx tsc --noEmit --pretty false`
(clean throughout) and either the full smoke suite or a targeted subset immediately after
implementation, never batching several risky changes before checking. The full suite went
16/16 green multiple times across the pass; the one recurring flake (`loads without console errors`
failing on a full-suite run, always passing in isolated re-runs) is the same pre-existing
GLTF-texture-load flake this file already documents elsewhere, confirmed unrelated by isolated
re-runs after each change that touched anything nearby. New: `npm run test:unit` (17 Vitest tests,
~0.4s) alongside the unchanged `npx playwright test` workflow.

