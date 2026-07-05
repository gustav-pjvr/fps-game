# Playtest Notes — v1 (Phases 0-7) + Phase 8 + Content Pass + Real Assets + Fable Pass

Feedback from the first playtest, triaged into: real bugs, missing pieces that belong in v1's
own combat loop, and things that were deliberately deferred past v1 per PLAN.md.

## World Plan §6 step 1 — bounding the world, and a wedge bug found by actually sprinting into it

Implemented the WORLD_PLAN.md §2 bound: `ChunkManager` now clamps to `[WORLD_MIN_CHUNK,
WORLD_MAX_CHUNK]` (12×12 chunks, 1200×1200 units), and `TerrainGenerator.sampleHeight` adds a
radial mountain ring that ramps up as distance from world origin approaches the boundary.

**Found by verifying in-browser (new `e2e/world-bounds.spec.ts`, sprinting straight at the edge for
several real minutes), not by reasoning about the noise math:** the first version of the ridge
noise (`TERRAIN_EDGE_RIDGE_FREQUENCY: 0.05`, weight `0.4`) fragmented the ramp into small
alternating steep/shallow patches. Rather than blocking cleanly or sliding the player back down,
the character controller got wedged — `x`/`z` frozen, `y` creeping up in tiny (~0.004 units/sec)
increments indefinitely, well short (radius ~525) of both the intended push zone (560) and the
world edge (600). A jagged high-frequency ridge on top of a steep base rise reads to the character
controller as a staircase of sub-autostep ledges rather than a slope - same failure class as other
"looked fine analytically, wrong once actually driven" bugs in this file. Fixed by lowering the
ridge frequency to 0.006 (broad ~1000-unit wavelength, effectively flat across the ~130-unit ramp
band) and its weight to 0.1, and widening/moving the ramp earlier (`WORLD_EDGE_RAMP_START` at
boundary−130 instead of boundary−100).

Also added, since the ramp alone can't *guarantee* a player stays in bounds (a smoother ramp is
climbable, just slower - confirmed empirically: the test player climbed to y≈40 while covering the
last 100 units of radius in the same time the first 500 took a third as long): a soft radial push
starting at boundary−100 that scales up to a hard, absolute radial clamp at boundary−5. The clamp
is inscribed inside the generated square specifically so it can never send the player into
ungenerated terrain. Verified end-to-end: the player's distance from origin plateaus and the clamp
holds exactly at boundary−5 under continuous forward pressure - see `Player.ts`'s
`applyWorldEdgePush` / `clampToWorldBounds` and the passing e2e test.

Incidental finding while running this test: the player took real combat damage (down to 36/100 HP)
just from running away from spawn, because the entity ring sits directly in the sprint-forward
direction. Not a bug - it's the existing chase/leash behavior working as intended - but worth
knowing before the WORLD_PLAN.md §3 building-placement pass, since it confirms the entity ring's
effective radius in practice for the "just outside the ring" placement rule agreed in that plan.

## World Plan §6 step 2 — ground texture, sky shader, fog retune, reference boxes removed

Replaced the flat green `MeshStandardMaterial` with a real CC0 texture (Poly Haven's
"Aerial Grass Rock", verified via the public Poly Haven API rather than a guessed URL - see
`public/assets/credits/aerial-grass-rock-LICENSE.txt`), tiled at an integer repeat count
(`GROUND_TEXTURE_REPEAT = TERRAIN_CHUNK_SIZE / GROUND_TEXTURE_WORLD_SIZE`) so it stays phase-aligned
across chunk seams. Added `three/addons/objects/Sky.js` as a real gradient sky replacing the flat
color, sharing its sun direction with `Game.addLighting`'s shadow-casting `DirectionalLight` via new
`SUN_DIRECTION_X/Y/Z` config constants so the sky's bright spot and the shadows agree. Retuned fog
(`FOG_NEAR`/`FOG_FAR`) to sit just past the new world boundary instead of the old infinite-world
50→2000 spread. Removed the four placeholder reference boxes (`Game.addReferenceBoxes` and its
colliders) now that there's real content to look at.

Code review caught one real gap: the texture load had no `onError` handler, so a failed fetch
(bad path, moved asset) would have silently left the ground with an empty map and no signal
anywhere - fixed by logging the error via `TextureLoader.load`'s fourth callback param.

Verified in-browser via screenshot (not just typecheck) - confirmed the sky gradient renders,
the ground texture tiles without visible seams, fog blends toward the horizon, and no reference
boxes remain. All 16 existing smoke tests plus the Step 1 boundary test still pass.

## World Plan §6 step 3 — vegetation, and three real bugs found by actually looking at it

Added `VegetationManager`: per-chunk deterministic scatter of trees/bushes/rocks (Kenney Nature
Kit, CC0, real files verified via the Kenney site's own zip link - see
`public/assets/credits/nature-kit-LICENSE.txt`), rendered through one shared `THREE.InstancedMesh`
per (vegetation type, sub-mesh) pair so the whole bounded world's vegetation costs a handful of
draw calls, not one per plant. Density is gated by a second low-frequency simplex noise field so
trees/bushes/rocks cluster into forest patches and clearings instead of uniform speckling. Trees
get a fixed-body cylinder trunk collider; bushes/rocks are visual-only. Wired into `ChunkManager`
via a new generic `ChunkStreamHooks` interface (`onChunkLoaded`/`onChunkUnloaded`) so terrain
streaming stays decoupled from what else hangs off it.

Screenshotting the result (not just trusting the code) surfaced three real, non-obvious bugs before
this could be called done:

1. **Vegetation rendered almost solid black except a thin rim highlight, view-angle dependent.**
   Root cause: Kenney's Nature Kit glTF export bakes `metallicFactor: 1` into every material -
   unlike the Blaster Kit/Mini Characters packs already used elsewhere in this project, which
   correctly export `metallic: 0`. With no `scene.environment` for image-based lighting, a fully
   metallic `MeshStandardMaterial` has near-zero diffuse reflectance and only shows a grazing
   specular glint - looks fine by coincidence at some angles, solid black at most others. Fixed by
   forcing `material.metalness = 0` on every extracted primitive in `extractBakedPrimitives`.
   Confirmed via before/after screenshots at both distance and close range.
2. **A real frame-rate regression that broke an unrelated, timing-sensitive e2e test.** The
   auto-reload test (fires 12 timed shots, expects the 13th to trigger reload) started timing out
   after this change - not because reload logic changed, but because `markPoolsDirty()` set every
   `InstancedMesh.count` to the full fixed pool capacity (500) regardless of how many instances
   were actually placed, so the GPU was drawing and shadow-casting hundreds of degenerate
   zero-scale instances per type every frame. Fixed by capping `mesh.count` at the high-water mark
   of indices actually ever allocated (`pool.nextFreeIndex`, clamped to capacity). Caught by
   actually re-running the full suite after the change instead of assuming an unrelated system
   couldn't be affected - a frame-budget regression in one system can silently fail a test in a
   completely different one whenever that test's assertions are wall-clock-timed.
3. **Code review caught a spawn-safety gap before it shipped**: the "don't place vegetation on top
   of the player" check measured distance from world origin `(0,0)` with a 6-unit radius, but the
   actual spawn point is `(SPAWN_X, SPAWN_Z) = (0, 8)` and the largest encounter ring extends 25
   units from it - meaning a tree's solid trunk collider could have generated inside the entire
   combat ring, or right on top of the player at spawn. Fixed by moving `SPAWN_X`/`SPAWN_Z`/
   `ENEMY_RING_BASE_RADIUS` into `config.ts` as shared constants and measuring clearance from the
   real spawn point with a radius that actually covers the ring
   (`VEGETATION_SPAWN_CLEARANCE = ENEMY_RING_BASE_RADIUS + 5`).

All 16 smoke tests pass after both the performance fix and the spawn-clearance fix.

## World Plan §6 step 4 — buildings, a scope change mid-step, and two more real bugs

First pass shipped exactly what WORLD_PLAN.md §3 originally scoped: a plain `THREE.BoxGeometry`
with a tiled Poly Haven concrete texture (`concrete_wall_007`, CC0), one solid fixed collider per
building doubling as the rooftop's walkable surface. Functionally correct and matched the agreed
plan, but once the user actually looked at it in the browser, the reaction was "it just looks like
a block of textured concrete bricks" - fair, since that's literally what was built. Asked the user
directly: keep it simple (original scope), add painted-on window/door decals, or switch to a real
modular building kit. They chose the real kit, explicitly accepting more draw calls/complexity in
exchange for it actually reading as a building - **a deliberate mid-step scope change**, not scope
creep, since it was surfaced and decided explicitly rather than assumed.

Switched to Kenney's "Modular Buildings" kit (CC0) - specifically its premade
`building-sample-house-a/b/c.glb` and `building-sample-tower-a/b/c/d.glb` prefabs, which are
already-assembled structures (the kit's own wall/window/door/roof tiles, pre-composed by Kenney)
rather than raw modular tiles this project would have to hand-place and rotate itself. Considered
the raw tile kit first (`kenney_building-kit`) but its wall/corner/roof pieces have no premade
whole buildings, and correctly reverse-engineering each piece's default-orientation convention well
enough to assemble a leak-free perimeter would have meant the same trial-and-error rotation-guessing
this project's `NOTES.md` already describes doing for weapon models - the premade-sample kit avoids
that entirely for a comparable visual result.

Two more real bugs found before this could ship:

1. **`THREE.GLTFLoader: Couldn't load texture Textures/colormap.png`** on all 7 presets. Kenney's
   glTF export for this kit references its texture by a relative URI instead of embedding it in the
   `.glb` (unlike the weapon/enemy/vegetation assets already used in this project, which are fully
   self-contained) - the zip ships `Textures/colormap.png` as a sibling of the `.glb` files, which
   this project hadn't extracted. Fixed by placing it at the matching relative path
   (`public/assets/models/buildings/Textures/colormap.png`) so `GLTFLoader` resolves the reference
   correctly. Caught by the same "loads without console errors" e2e test that's caught every other
   asset-path issue in this project - reinforces why that test exists.
2. **Code review caught a collider/visual misalignment**: `measurePreset` computed footprint width/
   height from the raw bounding box's *extents* but never checked whether that box was *centered*
   on the model's local origin. For 3 of the 7 prefabs (`tower-a/b/c`) it isn't - verified directly
   against the `.glb` files' own accessor bounds. Since the building's collider was placed at the
   same point as the model's local origin, this silently offset the collider by ~0.24-0.28 world
   units from the true visual footprint for those three presets, worse under 90°/270° rotation
   (the offset only exists on local Z, so it rotates onto world X while the collider assumed it was
   always zero) - exactly the kind of edge that would matter once climbing (§6 step 5) relies on
   the collider's top face as a true rooftop. Fixed by measuring the box's *center* offset too and
   rotating/adding it into the collider's translation, not just the raw footprint span.

Also extracted the identical `hashChunkSeed`/`chunkKey` helpers (previously copy-pasted between
`VegetationManager` and `BuildingManager`) into a shared `world/chunkSeed.ts` now that a second
real consumer exists - a LOW finding from the same review, applied because the duplication was now
real rather than speculative.

All 16 smoke tests pass after both fixes.

## Post-step-4 batch: playtest fixes + a full zone/town/forest generation system

User playtest feedback after step 4 covered five things: rocks had no collision, gunshots sounded
delayed, the world still felt too big, buildings should cluster into flat-ground towns instead of
scattering one-per-chunk, and trees should form real walk-into-able forests with bushes/rocks
staying uniformly random. The last two needed an actual design pass - spawned an Opus subagent to
produce an architecture document (deterministic jittered hash-grid "Worley noise" zones, terrain
flattening via a blend toward a per-zone constant height, town layout as a pure function of its
zone's cell coordinates) before implementing it in this session with full codebase context, per the
user's explicit choice of "Opus designs, Sonnet implements" over handing the whole task to Fable
(which this project's own PLAN.md already scopes out of physics/terrain/systems work).

**Quick fixes:**
- **Rocks**: `VegetationManager`'s vegetation types gained a `colliderShape` field (`cylinder` |
  `box` | `none`) instead of a boolean; rocks now get a box collider sized to their measured
  footprint (bushes stay visual-only, trees keep their trunk cylinder).
- **Gunshot delay**: no bug in the fire/audio call chain itself (traced `tryFire()` → `onFire()` →
  `playGunshot()` - fully synchronous, no scheduling gap). Applied the standard Web Audio mitigation
  for Chrome's idle-throttling of an `AudioContext`'s render thread during silent gaps between
  one-shot sounds (exactly this game's semi-auto cadence): a near-silent (`gain: 0.0001`), always-
  running oscillator keeps the audio graph continuously active so gunshots always play on a warm
  pipeline. Flagged to the user that this can't be verified by automated testing - needs their ears.
- **World size**: `WORLD_SIZE_CHUNKS` 12 → 8 (1200×1200 → 800×800 units); all boundary/ramp/push/
  clamp constants are derived from this, so nothing else needed to change numerically.

**The zone system** (`src/world/ZoneMap.ts`, new): two independent deterministic jittered hash-
grids (flat zones for towns, forest zones for trees) - each grid cell has a hash-derived candidate
site (jittered position, randomized radius, present or not), and any world point's zone membership
is resolved by nearest-site-wins across the surrounding 3×3 cells. Pure functions of world/cell
coordinates only, no global state - reload-identical by construction, matching every other system
in this project.

- **Terrain flattening** (`TerrainGenerator.ts`): split the old `sampleHeight` into `sampleBaseHeight`
  (the original fBm + edge-ring, unchanged) and a new `sampleHeight` that blends toward a per-zone
  constant height (`sampleBaseHeight` evaluated once at the zone's site center, cached per cell) as
  flat-zone membership approaches 1, easing back to natural terrain at the zone's rim.
- **Forests** (`VegetationManager.ts`): tree placement's density threshold now lerps continuously
  from a high "rare stragglers" value outside any forest zone down to a low "dense cluster" value
  at full forest membership. Bushes/rocks moved off the density-noise field entirely onto their own
  independent uniform roll from the chunk RNG - decoupled from forests, per the user's ask. All
  vegetation is suppressed inside flat/town zones so pads stay clear for buildings.
- **Towns** (`BuildingManager.ts`, rewritten): a town's entire building layout (varied presets,
  rejection-sampled positions/rotations within the zone's flat core, minimum spacing) is now a pure
  function of its flat-zone cell coordinates, memoized. Each chunk spawns only the buildings from
  any overlapping town whose world position actually falls inside that chunk's bounds, so a town
  spanning several chunks streams in/out correctly regardless of load order - no per-chunk
  "one random building" scattering anymore.
- **Roads**: not attempted this pass. Opus's design covers a straightforward approach (MST over a
  town's building positions, rendered as flat textured strips since the pad is already level) -
  deferred to a follow-up so the core zone/town system could ship verified rather than adding more
  surface area before this large batch was even confirmed working.

**Three real bugs found shipping this** (two via code review, one via the project's own
verify-in-browser discipline):

1. **Mountain-ramp wedge, again.** First implementation only excluded zone sites within
   `ZONE_EDGE_MARGIN` of `WORLD_HARD_CLAMP_RADIUS` - leaving the entire ~130-unit mountain-ramp band
   (`WORLD_EDGE_RAMP_START` to the hard clamp) open to zone placement. A flat zone sited there fights
   the steep mountain ramp with its own flatten-blend, producing a sharp transition. Caught by the
   `world-bounds` e2e test wedging the character controller against what looked like a plain
   hillside in the failure screenshot - the exact same failure class as the original ridge-noise
   wedge bug from step 1, just triggered by a different terrain feature. Fixed by culling zone sites
   against `WORLD_EDGE_RAMP_START` instead, keeping zones entirely within the naturally-rolling
   interior.
2. **Code review caught a nearest-site inconsistency**: `BuildingManager`'s direct per-cell site
   lookup (`getFlatZoneSite`) didn't confirm that cell's site was actually the *nearest* site at its
   own center - the same check `sampleFlatZone` (which drives terrain flattening) always performs.
   Two adjacent cells' jittered sites can have overlapping discs, letting a building be placed as if
   it belongs to one zone while the terrain at that exact point flattens toward a neighboring zone
   instead (or not at all). Didn't manifest with this project's current seed/constants by luck, but
   was a real, reachable bug confirmed by simulation. Fixed by requiring a cell's site to also win
   the nearest-site contest at its own center before treating it as valid.
3. **Code review caught a forest-edge density cliff**: the tree threshold branched between an
   "outside forest" constant and an "inside forest" formula at `forestMembership > 0`, which are
   numerically nothing alike at the boundary (0.95 outside vs. ~0.62 the instant membership ticks
   above zero) - producing a hard density cliff exactly at the forest edge, contradicting the
   intended "rare stragglers fading into a dense core" design. Fixed by lerping the threshold
   continuously by membership instead of branching.

All 16 smoke tests plus the `world-bounds` e2e test pass after all four fixes (three above plus a
stale seed-offset code comment also caught by the same review).

## User-caught bug: rifle view model rendered backwards/tilted

Reported with a screenshot after the Fable pass. `blaster-e`'s `rotationYOffset: Math.PI` was an
unverified guess from the original asset-integration pass (its bounding box is asymmetric -
pivot at the grip, not centered, unlike the other three blaster models) - I set a value that
looked plausible on paper and never actually screenshotted that specific weapon closely enough
to catch it being wrong. Same failure mode as the target-facing bug from the real-assets pass:
trusting an analytical guess about a glTF export's axis convention instead of rendering it.

Fixed properly this time - rendered all 4 rotation candidates from both a perspective angle and
a top-down view, then confirmed directly in-game against the real first-person camera before
committing. Correct value: `rotationYOffset: 0` (no rotation needed).

While in there, found and fixed a second bug in the same function: the muzzle bounding box was
computed *after* the view-model group was already positioned at `WEAPON_HIP_POSITION`, so that
offset got baked into `muzzleLocalOffset` and then added *again* in `WeaponManager.fireShot()` -
every weapon's tracer was starting from well behind the actual muzzle. Fixed by computing the
box while the group is still at its default origin.

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

## Random per-match world seed, forest/town density tuning, inventory previews (2026-07-04)

**Random world seed.** Every match now generates a genuinely different world instead of always
reusing the same fixed seed. `src/core/worldSeed.ts` holds a mutable module-level seed
(`getWorldSeed()` / `randomizeWorldSeed()`); `Game.create()` calls `randomizeWorldSeed()` once at
the top of match setup (not on practice-reset via T, so a mid-match reset keeps the same world).
`TerrainGenerator.ts`, `ZoneMap.ts`, `VegetationManager.ts`, and `BuildingManager.ts` were all
switched from the old frozen `WORLD_SEED` constant to `getWorldSeed()`. Terrain noise generators
in `TerrainGenerator.ts` are now rebuilt lazily the first time they're sampled under a new seed
(`ensureNoiseForCurrentSeed()`), rather than once at module load.

**Bug found via e2e, fixed: random seeds could block spawn-area line-of-sight.** The earlier
NOTES entry above speculated shots might occasionally be "blocked by hills at the 15-25 unit
spawn ring" - that's exactly what random seeding exposed. `e2e/smoke.spec.ts`'s "pressing T
resets..." test started failing intermittently (~1 in 6 runs). Diagnostic instrumentation
(temporary `e2e/_diag-shoot.spec.ts`, since removed) showed `player.y` and `target.y` - both
terrain-height-dependent at fixed (x,z) positions - diverging by several units on some random
seeds, while staying within ~0.05 units of each other under the old fixed seed. The old fixed
seed (1337) had simply been lucky: flat ground near spawn by coincidence, not by guarantee. Fix:
`TerrainGenerator.sampleHeight()` now blends toward a small, fixed (non-randomized) "spawn
clearing" - radius `ENEMY_RING_BASE_RADIUS + 5` (30 units, matching the same margin already used
by `VEGETATION_SPAWN_CLEARANCE`), always centered on `(SPAWN_X, SPAWN_Z)`, blending toward the
base terrain height sampled at the spawn point itself regardless of seed. Verified via the same
diagnostic script across 6 fresh random seeds post-fix: player/target height now track within
~0.05 units every time, and `e2e/smoke.spec.ts` (16/16) plus `e2e/world-bounds.spec.ts` (1/1) all
pass. Deliberately kept small (not a large flattened area) at the user's request - it only
guarantees fair combat within the entity encounter ring, not a big cleared zone.

**Forest density "extreme" variance.** `VegetationManager.ts` gained a second seeded noise field
(`forestTextureNoise2D`) and `minTreeSpacingFor()`, which varies minimum tree spacing by both
forest-zone membership and local texture noise - producing dense thickets (spacing down to
`VEGETATION_TREE_MIN_SPACING_DENSE`) right next to sparser pockets (`_SPARSE`), instead of a
uniform density across a forest zone. `VEGETATION_INSTANCE_CAPACITY` and
`VEGETATION_MAX_PER_CHUNK_PER_TYPE` were both raised substantially to support the denser thickets
without hitting the instance cap.

**Bigger towns.** `TOWN_MIN_BUILDINGS`/`TOWN_MAX_BUILDINGS` raised from 4-8 to 15-30,
`FLAT_ZONE_RADIUS_MIN/MAX` widened to fit them, `TOWN_BUILDING_SPACING_MARGIN` tightened and
`TOWN_MAX_PLACEMENT_ATTEMPTS` raised so rejection sampling can still pack that many buildings in.

**Inventory: weapon previews + stat icons.** `src/ui/menu/weaponThumbnail.ts` renders each
weapon's real glTF model to a static thumbnail (offscreen `WebGLRenderer`, disposed immediately
after `toDataURL()`) instead of showing text-only stats. `src/ui/menu/statIcons.ts` adds small
SVG icons (damage/fire-rate/magazine/reload/scope) next to each stat value. `InventoryPanel`
became an async factory (`InventoryPanel.create()`) since rendering previews requires awaiting
each weapon's glTF load; `App` was updated to await it before showing the main menu.

Code-reviewed (agent pass): no CRITICAL/HIGH/MEDIUM findings, one cosmetic LOW (stale comments
still saying "WORLD_SEED" - fixed).

## Guaranteed towns/forests, bigger towns, larger inventory previews (2026-07-04)

**Guaranteed minimum towns/forests per world.** Previously flat zones (towns) and forest zones
were placed purely by a per-cell density roll on a jittered hash-grid, so a run of bad luck could
generate a world with very few or even zero towns/forests. `ZoneMap.ts` now force-places
`GUARANTEED_ZONE_COUNT` (2) full-size sites of each type directly - `computeGuaranteedSites()`
picks positions at evenly-spread angles around spawn, each at a distance sampled from the exact
band where a full-`radiusMin` zone is mathematically guaranteed to clear both the spawn ring and
the world edge, then assigns each to whichever grid cell it lands in. `siteForCell()` checks this
list first and returns a guaranteed site verbatim, bypassing the density roll for that cell.

This went through several iterations before landing correctly, all confirmed via direct numeric
testing (see below) rather than trusting the math by inspection:
- A random angle/distance sampler that floor-divided into grid cells only ever reached ~4 distinct
  cells (the zone's cell size is large relative to the safe annulus), so a bad seed could still
  fail regardless of how many samples were tried.
- Enumerating every cell exhaustively but requiring its *natural* hash-jittered position to already
  fit a full-size zone left most seeds with zero eligible cells - positions aren't something that
  approach can choose, only accept or reject, and the safe annulus is narrow.
- The final approach (constructing positions directly) initially had two subtler bugs caught by a
  code-review pass: (1) the distance band was measured from spawn, but the edge-clearance check
  measures from world origin, and spawn sits 8 units off-origin, so ~11% of seeds produced a
  guaranteed zone smaller than its stated minimum radius; (2) the two guaranteed sites' collision
  check rejected merely-*adjacent* grid cells (not just exact duplicates), and since the safe
  annulus is smaller than one grid cell, nearly every angle pair ends up adjacent to any other -
  the retry loop exhausted its budget without escaping. Both fixed (band now accounts for the
  spawn/origin offset; collision check only rejects exact cell matches, since adjacent guaranteed
  sites are already handled correctly by the existing nearest-site-wins logic). Re-verified via a
  throwaway script driving the real production code across 500 fresh random seeds post-fix: zero
  radius-floor violations, zero seeds with fewer than 2 towns or forests. Also directly verified
  every guaranteed site's full footprint (center ± radius) stays within the loaded chunk range
  (`[-400, 400)`) - not a boundary/streaming issue.

**Bigger towns.** `TOWN_MIN_BUILDINGS`/`TOWN_MAX_BUILDINGS` raised from 15-30 to 30-45.
`FLAT_ZONE_RADIUS_MIN/MAX` narrowed from 60-100 to 65-90 (radii above ~92 could never pass the
spawn/edge clearance check anyway, so the old range wasted a third of its rolls);
`FLAT_ZONE_INNER_FRACTION` raised from 0.6 to 0.85 so more of each zone reads as genuinely flat;
`TOWN_BUILDING_SPACING_MARGIN` tightened and `TOWN_MAX_PLACEMENT_ATTEMPTS` raised so rejection
sampling can still pack 30-45 buildings in. Verified via a script replaying the real placement
algorithm against production config across 40 random seeds: every town hit at least 30 buildings.

**Bug found and fixed: bigger/guaranteed towns exposed a sprint-test false failure, not a game
bug.** `e2e/world-bounds.spec.ts` (sprints the player in a fixed heading toward the world edge)
started timing out after the above changes - a screenshot at the stuck position showed the player
flush against a building's flat wall, HP dropping from a nearby enemy. This is *correct* physics:
holding pure forward with zero strafe against a wall exactly perpendicular to travel direction
has no tangential component to slide along, so Rapier's character controller correctly grinds to
a near-standstill - a real player would just strafe around it. Bigger, guaranteed towns just make
a fixed-heading sprint far more likely to run straight into a wall. Fixed the test (not the game)
to nudge sideways (alternating `KeyA`/`KeyD`) whenever forward progress stalls, emulating how a
real player would route around an obstacle, while asserting the same final boundary-safety
invariants. Re-ran 3x clean after the fix.

**Inventory: larger previews.** Thumbnail render resolution raised 96px -> 192px, displayed size
72px -> 112px, panel width 520px -> 580px, so players can actually make out each weapon's shape.

**Still deferred (paused pending user go-ahead on order):** roads connecting town buildings;
Step 5 (ladder sensor collider + player climbing state machine) - both now next up per the user's
latest direction, along with a larger enemy AI/weapon-variety overhaul (goal-directed patrol,
aggro range, enemy ranged combat, player melee, per-weapon-archetype behavior) planned as a
separate, more heavily-designed phase.

## Bigger forests, denser trees (2026-07-04, follow-up)

Forest radius raised from 50-90 to 78-92 - the top of that range (~92) is the largest a zone can
ever be given the world's spawn-ring/edge-mountain geometry, so this is effectively maxed out
without enlarging `WORLD_BOUNDARY_RADIUS` itself. `FOREST_ZONE_CELL_SIZE` raised 160 -> 200 to
stay comfortably above 2x the new max radius. Tree density roughly doubled by doubling
`VEGETATION_FOREST_EXTRA_CANDIDATES` (220 -> 440), `VEGETATION_MAX_PER_CHUNK_PER_TYPE` (80 -> 160,
so the per-chunk cap doesn't bottleneck the extra candidates), and `VEGETATION_INSTANCE_CAPACITY`
(5000 -> 10000, headroom for the higher counts). Re-verified the guaranteed-zone mechanism still
holds >=2 forests and >=2 towns at the new radius across 200 random seeds; full smoke suite green.

## Roads connecting town buildings (2026-07-04, Phase 3)

Implemented the approach already logged in WORLD_PLAN.md §9 (Opus's design): `src/world/
RoadManager.ts` computes a minimum spanning tree (Prim's algorithm) over a town's building
positions and renders each edge as a flat strip mesh. `BuildingManager.ts` gained a public
`getTownBuildingPositions(gx, gz)` so roads always connect to the exact same buildings that are
actually rendered (reuses the same memoized layout, no separately-derived approximation that could
diverge). Roads stream in/out per-chunk the same way buildings do - each segment is owned by
whichever chunk contains its *midpoint*, since a segment (unlike a single building) can span
farther than one chunk. Visually confirmed via a targeted e2e screenshot (predicted a guaranteed
town's position from the match's world seed, walked straight there, screenshotted) - road strips
render correctly between buildings. Code-reviewed: zero findings (chunk-ownership margin math,
resource cleanup, MST correctness, and the plane-rotation math were all independently verified,
not just visually sampled once).

## Ladder climbing (2026-07-04, Phase 3 continued)

Implemented WORLD_PLAN.md §3's climb-by-contact mechanic: `BuildingManager.createBuilding()` gives
every building a sensor collider (`RAPIER.ColliderDesc.cuboid(...).setSensor(true)`) plus a
procedural low-poly rung ladder mesh, both fixed to the building's world -Z face regardless of the
building's own rotation (simpler than tracking a rotated "local" face, and every preset's box is
axis-aligned post-rotation so any face works). `Player.ts` gained a climbing movement state:
touching the sensor while holding forward suspends gravity and moves straight up
(`LADDER_CLIMB_SPEED`); releasing forward, holding backward, or reaching the top exits it.

**Real bugs found and fixed, in order, all via direct testing (not just code review):**

1. **Sensor never detected at all.** `PhysicsWorld.isTouchingClimbable()` uses
   `world.intersectionPairsWith()`, which depends on Rapier's narrow-phase actually tracking an
   intersection pair between the two colliders - and Rapier's default `ActiveCollisionTypes`
   (`DYNAMIC_DYNAMIC | DYNAMIC_FIXED | DYNAMIC_KINEMATIC`) does **not** include `KINEMATIC_FIXED`.
   Since the player is a kinematic body and the ladder sensor sits on a fixed body, no pair was
   ever tracked - confirmed by `isTouchingClimbable()` staying false even while visibly wedged
   against the sensor's building. Fixed by explicitly OR-ing in `KINEMATIC_FIXED` on the sensor's
   `ColliderDesc`.
2. **Ladder alignment band too narrow to use.** Original `LADDER_WIDTH = 1.2` (±0.6 tolerance) -
   user playtested and reported being unable to climb despite ladders visually rendering correctly.
   Root cause: pressing forward into a flat wall has zero tangential/sideways drift (the character
   controller correctly has nothing to "slide" along when there's no sideways input component -
   same physics already confirmed for the world-bounds sprint test earlier this session), so a
   player can't feel their way along a wall to find a narrow band the way they could on an angled
   surface. Widened to `LADDER_WIDTH = 2.6`.
3. **Reaching the top dropped the player straight back to the ground, missing the roof.** The
   original mantle was a horizontal nudge fed through `computeColliderMovement` (the normal
   physics shape-cast solver) - sometimes worked, often didn't. Root causes (two, compounding):
   - A fixed mantle distance tuned for one building size overshot or undershot others - fixed by
     computing the mantle distance (and later, the full target position) per-building from its own
     `colliderHalfDepth`, registered alongside the climbable sensor.
   - Even with a correctly-sized distance, the shape-cast itself was unreliable near the wall's own
     top corner. Replaced entirely: the mantle now **teleports directly** to a precomputed exact
     roof-center position (`x/y/z` stored on the climbable registration) via
     `rigidBody.setNextKinematicTranslation`, bypassing the shape-cast solver for this one
     special-cased action - the same technique many games use for vault/mantle moves.
4. **Mid-climb, the mantle target could silently swap to a neighboring building's roof.** In a
   dense town (30-45 buildings, tight spacing), two buildings' ladder sensors can be within reach
   of each other, and re-querying "any touched climbable" every frame during climbing could pick up
   the wrong one right as contact was lost, teleporting the player to a roof position nowhere near
   where they actually were. Fixed by capturing the specific sensor's collider handle once when a
   climb starts (`activeClimbColliderHandle`) and checking continued contact against that one
   sensor only for the rest of the climb (`isTouchingSpecificClimbable`), never re-resolving to
   "whichever is currently closest."
5. **Test artifact, not a game bug (caught during verification, worth recording since it looked
   identical to a real failure at first):** an e2e test reactively releasing the forward key after
   *polling* `isClimbing()` had real lag (Playwright's per-check round-trip vs. the 60fps game
   loop) - the key stayed logically "held" for extra frames after a successful mantle, walking the
   test's player forward off whatever roof edge was closest. Direct per-frame instrumentation
   showed `grounded: true` holding steady immediately after the mantle for as long as the
   (still-held) forward input was fed in - i.e., the landing itself was fine; the test just kept
   walking off it. Fixed by using `page.waitForFunction(..., { polling: 'raf' })` (in-browser,
   no round-trip) to detect climbing start/end instead of a JS-side polling loop.

**Verified:** 4 of 5 clean automated runs (teleporting to a real streamed-in ladder, holding
forward until climbing naturally starts and ends, per-frame `grounded`/position confirmed stable
afterward) landed on the roof and stayed there; the fifth didn't engage climbing within the test's
timeout (alignment/timing, not a landing failure). Full smoke suite (16/16) and world-bounds green
throughout.

**Follow-up verification (2026-07-05), re-run at higher volume:** re-tested against ~15 fresh
teleport-and-climb trials across several different worlds/ladders. Roughly 60% climbed cleanly with
sensible height gains matching the mantle formula (`groundY + height + PLAYER_HEIGHT/2 +
LADDER_ROOF_CLEARANCE`). The remaining ~40% reproduced a real, distinct failure mode not covered by
the fixes above: `climbing` flips to `true` (contact + forward held, as expected) but the player's Y
position then stays frozen at the ladder's base indefinitely - `computeColliderMovement`'s returned
`computed.y` is apparently ~0 even though `desiredMovement.y = LADDER_CLIMB_SPEED * dt` was requested
every frame. Ruled out one candidate cause directly: an initial version of this re-test teleported
the capsule to `wallFaceZ - 0.3` (0.1m *inside* the solid wall collider, given `PLAYER_RADIUS = 0.4`)
which produced this exact symptom very reliably; moving the approach distance out to `wallFaceZ -
0.45` (flush against the wall, no overlap - matching where a normally-walked-up player's capsule
actually rests) reduced but did **not eliminate** the freeze, so wall overlap is a contributing factor
at most, not the root cause. Suspect the Rapier `KinematicCharacterController`'s own slide/autostep
resolution is, in some frames, treating the ladder's flat vertical wall as an obstruction to a
pure-vertical move even without lateral input - worth a closer look at whether climbing should
bypass `computeColliderMovement` entirely (direct `setNextKinematicTranslation`, the same pattern
already used for the mantle) rather than routing vertical ladder movement through the general-purpose
collision solver at all. **Not yet independently re-confirmed by the user in normal (non-automated)
play** - deferred per user direction ("not game-breaking, doesn't affect future tasks") to keep
moving through the rest of the todo list; a real player who gets stuck mid-climb can still exit by
holding backward (release condition doesn't depend on the frozen movement working), so this isn't a
hard-lock, just a bad climb.

## World-gen visual gut-check (2026-07-05)

Confirmed by eye (not just generation-logic reasoning) that the recent town-density, forest-density,
and road changes actually read correctly in-game. Used a temporary Playwright script driving
`window.__gameDebug.teleport`/`lookAt` to fly to real streamed-in content (found via
`getActiveLadderPositions()`, which is only non-empty once a town's chunks have loaded) and
screenshot it, since a pure high-altitude top-down shot turned out useless (just washed-out dirt
texture with no readable structure - camera needs to be closer and angled, not directly overhead).

Confirmed: a town interior shot showed 6+ buildings packed close together, each with a distinct
ladder on its wall, varied roof shapes/heights, and a road strip running between them into the
cluster - matching what the town-minimum-30/road-connection work was supposed to produce. A forest
shot from an earlier run in a different world seed showed a dense stand of trees on a hillside,
consistent with the doubled density/maxed radius change. Script and screenshots were temporary
(deleted after review) - this was a one-time visual sanity check, not a repeatable test, since
"looks right" isn't something worth asserting on every CI run the way the smoke suite's functional
checks are.

## Performance headroom check - inconclusive, environment limitation (2026-07-05)

Attempted to measure frame-rate headroom ahead of Enemy AI Phases B-E (which add per-enemy
line-of-sight raycasts every frame - directly relevant to whether there's budget left). Sampled
actual rendered FPS via `requestAnimationFrame` counting at spawn, inside a dense town, and inside a
dense forest using a temporary Playwright script.

**Result was not usable.** Checked the canvas's WebGL context (`WEBGL_debug_renderer_info`) and this
automated browser is running on `SwiftShader` (Google's CPU software rasterizer), not a real GPU -
confirmed via `UNMASKED_RENDERER_WEBGL` returning `"ANGLE ... SwiftShader Device ... SwiftShader
driver"`. Measured FPS was 4-7 across all three locations, which is a software-rendering artifact,
not a signal about real-world performance - Playwright/headless Chromium here has no hardware GPU
access at all, so these numbers say nothing about how the game runs on the user's actual machine.
The only thing worth noting from the raw numbers is a relative one (town ~4fps vs. spawn/forest
~6.5fps in this same software-rendered environment), which is weak evidence building-heavy scenes
cost more to render than vegetation-heavy ones, but not solid enough to act on.

**Conclusion:** this check genuinely requires the user's own hardware - open the game in a normal
browser and watch DevTools' Performance/FPS meter (or Chrome's `Rendering > Frame Rendering Stats`)
in a dense town vs. open terrain vs. a big forest, ideally with several enemies aggroed at once once
Phase B lands. Deferred; not something this environment can answer, so moving on to Phase B rather
than continuing to chase a number that can't mean anything from here.

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

## Lobby redesign (2026-07-05)

The lobby (main menu, match setup, settings, inventory) read as a generic dark web-app overlay:
plain rounded-rect panels, a bobbing character dead-center competing with a stacked button rail,
one accent color with no other visual system tying things together. Redesigned it grounded in real
shipped tactical-shooter lobbies (Valorant, Apex Legends, CS2 - researched via web search rather
than guessed) rather than a generic template.

**Design.** One consistent signature shape (a chamfered/cut corner, via CSS `clip-path`, replacing
every rounded corner in the old design) applied to every panel and button - `chamferClipPath()` in
`menuStyles.ts`, alternating which corner is cut so panels don't all lean the same direction. A
condensed display face (`Chakra Petch`, loaded via Google Fonts in `index.html` - this codebase had
no custom font infrastructure before this) for titles/buttons/eyebrow labels, against `Inter` for
body/data text - the first real typographic system this UI has had, replacing plain `system-ui`
everywhere. Same near-black + single green accent palette as before (kept for brand continuity,
just applied more deliberately), with a cool steel-gray added for secondary/label text.

**Layout.** Deliberately asymmetric rather than centered: the lobby character (`LobbyScene.ts`) now
sits left-of-frame (`CHARACTER_OFFSET_X`) instead of dead-center, with a soft accent-tinted ground
glow (a radial-gradient canvas texture, not a flat-color circle - a flat circle read as a hard-edged
puddle, confirmed via screenshot before switching to a gradient) giving it presence. This opens the
right side of the screen for the action rail without visual competition, and lets the title/eyebrow
live top-left near the character rather than fighting for center-screen space. Four corner brackets
(faint L-shaped marks, `createCornerBracket()`) frame the screen like a tactical HUD viewfinder - a
cheap, purely atmospheric touch. A thin vertical divider ties the left (identity) and right (action)
halves together.

**One genuinely diegetic touch, not decoration:** a "DEFAULT DEPLOYMENT" readout bottom-left shows
the *real* `DEFAULT_ENEMY_COUNT`/`DEFAULT_TARGET_COUNT` a match will actually spawn with (editable
in the existing Match Setup modal) - not a fabricated stat. Considered showing the current world
seed here too, but the seed doesn't exist yet at the main-menu stage (`randomizeWorldSeed()` only
runs when a match actually starts) - would have been fake data, so left out.

**Verification.** Screenshotted every panel (main menu, match setup, settings, inventory) after
each change rather than shipping on assumption - caught two real issues this way: the ground glow
initially rendered as a hard-edged circle (switched to a canvas radial gradient) and native
`<input type="range">` sliders in Settings rendered with the browser's default blue thumb, clashing
badly against the new near-black/green palette (fixed with `accent-color` on the slider elements -
a one-line, well-supported CSS fix, no custom slider markup needed). Full smoke suite (16/16) green;
one console-error test failed on the first full-suite run (`THREE.GLTFLoader: Couldn't load texture
Textures/colormap.png`) but passed 3/3 in isolation and clean on a full-suite re-run - pre-existing
flakiness unrelated to this change (nothing touched GLTF loading), not a new regression.

**Scope note:** `PlaySetupModal.ts`/`SettingsPanel.ts`/`InventoryPanel.ts` inherit the new chrome
"for free" since they're built from the same `createPanel`/`createButton`/`createPanelTitle`
helpers - only `SettingsPanel.ts` needed a direct touch (the slider accent-color fix). No internal
restructuring of those panels' own logic.

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

## 5th hotbar key for the knife (2026-07-05)

The knife (Phase D) was only reachable by mouse-wheel cycling - `weaponSlot1-4` are hardwired to
physical keys `1-4` (`DEFAULT_KEY_BINDINGS`), and a 5th slot had never been added since only four
guns existed when that binding was written. Small, mechanical follow-up: added `weaponSlot5` to the
`Action` union, bound it to `Digit5`, added its `ACTION_LABELS` entry, and extended
`WeaponManager`'s `SLOT_ACTIONS` array to five entries so `handleSwitchRequests`'s existing
index-into-`SLOT_ACTIONS` loop picks it up for free. `REBINDABLE_ACTIONS` already excludes number
keys entirely (they're intentionally fixed, not user-rebindable) - slot 5 needed no new exclusion,
it just fell under the same existing rule by not being listed.

**Verified:** pressing `5` switches directly to the Bicknell Trench Knife, and pressing `1`
afterward correctly returns to the pistol - confirming slot 5 didn't disturb the other direct-select
keys. 2 of 2 repeat runs clean. Full smoke suite (16/16) green.

## Performance tooling: in-game overlay + local check + docs (2026-07-05)

The earlier Phase E performance-headroom attempt concluded that this sandbox can't answer "is
performance okay" at all - its Chromium renders via SwiftShader (a CPU software rasterizer,
confirmed via `WEBGL_debug_renderer_info`), so any FPS number gathered here measures software
rasterization speed, not the game. This session's tooling is aimed entirely at making that check
possible *outside* this environment, on the user's own hardware, with as little friction as
possible.

- **`FpsMeter`** (new, `src/core/FpsMeter.ts`) - a rolling 120-sample window of real per-frame
  wall-clock time (sampled once per displayed frame in `Game.render`, not the fixed physics
  timestep). Reports average FPS/frame time plus **p95 frame time** specifically so an occasional
  stutter (e.g. several enemies' hitscan raycasts landing the same frame) shows up even when it's
  brief enough not to move the average.
- **In-game overlay** (`src/ui/perfOverlay.ts`) - off by default, toggled with **F3**. F3 is
  deliberately wired via a raw `document.addEventListener`, not the `Action`/`InputManager`/
  rebind system - it's a dev tool, not a gameplay control, same reasoning as the e2e suite's
  `openPauseMenu` helper calling `document.exitPointerLock()` directly rather than going through a
  bound key.
- **`window.__gameDebug.getFrameStats()`** - the same numbers the overlay shows, for scripted
  measurement.
- **`e2e/performance-check.spec.ts`** (new, NOT part of the smoke suite - has no pass/fail
  assertions, just prints numbers) - drives three representative scenarios (open terrain, a
  20-enemy combat encounter, a dense town found via grid search) and logs FPS/p95 for each.
  Deliberately kept as a `.spec.ts` file despite wanting to exclude it from casual discovery -
  tried naming it without that suffix first so Playwright's default test discovery would skip it
  entirely, but confirmed via direct testing that Playwright requires the suffix even for an
  explicit file-path argument (`npx playwright test e2e/performance-check.ts` reports "No tests
  found"). Documented instead, in both the file's own header comment and PERFORMANCE.md, that it's
  manual/local-only.
- **`PERFORMANCE.md`** (new, repo root) - explains the SwiftShader limitation, and walks through
  three ways to get a real number: the F3 overlay (fastest), Chrome DevTools' Performance/Rendering
  tabs (most detail), and the scripted check above (repeatable). No fabricated "target FPS" number -
  hardware and desired enemy count vary too much for one to be meaningful; the doc explains what to
  watch for (average vs. p95 spread) instead of asserting a threshold this session can't verify.

**A real, unrelated regression this work exposed rather than caused.** Running the full smoke suite
while building this surfaced `killPlayerByEnemy` (used by two death-flow tests) intermittently
exceeding even its already-once-widened 50s deadline - traced to Ridge Walker (the kiter archetype,
Phase 1's per-archetype loadouts) actively backing away whenever the helper's approach closed to
its kite range, turning a straightforward walk-up-and-get-hit into an extended chase. One measured
case took 58s by the exact same approach logic. Rather than widen the timeout a third time (diminishing
returns - kiting is open-ended in the worst case, so any fixed deadline just gets a bigger tail),
fixed the helper itself: it now holds `ShiftLeft` (sprint, speed 8) during its approach bursts
instead of walking. This is safe specifically because the loop already re-aims and re-issues a
fresh short (<=400ms) burst every iteration rather than holding one heading for a long stretch - the
"blows straight past" failure mode the original code's own comment warned about only happens with
one long, uncorrected sprint, which this loop never does. Verified via 16 repeated runs of both
affected tests (8 batches x 2 tests) - all clean, and each batch visibly faster (down to 50s-1.4m
for both tests combined, from over 2 minutes for a single test pre-fix).

**Verified:** typecheck clean; full smoke suite (16/16) green after all of the above.

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

## Long-shot callout (2026-07-05)

Added an on-screen acknowledgment when a player hit lands at `LONG_SHOT_DISTANCE` (50m, see
config.ts) or beyond - a hit that far out is easy to miss amid tracers/hit markers/kill feed, so it
gets a brief, unmissable callout of its own. Implemented directly (not via a Fable agent, per
explicit instruction) since it's a small, isolated feature.

- `src/ui/longShotCallout.ts` (new) - `LongShotCallout` class, same fade-in/out shape as the
  existing `WeaponCaption`: `show(distance)` starts a 1.5s hold + 0.4s fade, `update(dt)` advances
  it, `dispose()` tears down its DOM node.
- `WeaponManager.firePellet` now takes an `onLongShot(distance)` callback (threaded through
  `WeaponManager.create`) and calls it when `hit.distance >= LONG_SHOT_DISTANCE` on a damageable
  hit - reuses the hitscan's own reported distance, no separate distance calculation needed since
  world units in this codebase are already meters (`PLAYER_HEIGHT = 1.8`, etc.).
- `Game.ts` wires a `LongShotCallout` instance into the HUD root and calls `.update(dt)` each frame
  alongside the other HUD widgets it already owns.

Verification: typecheck clean. Automated e2e verification turned out to be the wrong tool for this -
teleporting the player to a precise 50m+ firing solution kept hitting the project's known
"teleport + immediate lookAt goes stale" issue (see the Ridge Walker/aim sections elsewhere in this
file): reusing a stale y-coordinate after a large horizontal teleport lets gravity move the player
an unpredictable amount before the pre-computed aim is applied, so the shot would geometrically miss
even though the feature itself was correct. After a couple of failed attempts (including using the
`raycastForward` debug hook, which was discovered along the way to be unconditionally broken - it
never excludes the player's own collider, so it always self-hits at distance~=0 regardless of aim;
confirmed via grep that nothing in `e2e/` or `src/` relies on it, so left as-is and just avoided),
the test was dropped in favor of direct manual verification, which the user performed and confirmed:
a real 110m hit produced the callout correctly.

## Tree leaves now stop bullets, without blocking movement (2026-07-05)

Trees' trunks have always had solid hit collision; their canopy (leaves) had none, so a shot aimed
into the foliage instead of the trunk just passed through. Added a canopy hit volume per tree
instance that registers hitscan hits but never blocks movement - players and enemies still walk
through foliage exactly as before. Implemented directly (not via a Fable agent, per explicit
instruction).

The mechanism is a Rapier **sensor** collider, not `InteractionGroups`: sensors are included in
raycast queries by default (Rapier would need an explicit `QueryFilterFlags.EXCLUDE_SENSORS` to
skip them, and `castHitscan` never passes that), but never participate in solid narrow-phase
collision resolution, so the player's character controller and enemies' kinematic movement both
ignore it completely. This was chosen over `InteractionGroups` because this codebase uses zero
custom collision groups anywhere - doing it via groups would have meant touching the player
capsule's own (currently all-default) group config, a much larger blast radius for a feature this
contained.

- `config.ts` - added `VEGETATION_CANOPY_RADIUS` (0.9) and
  `VEGETATION_CANOPY_CENTER_HEIGHT_FRACTION` (0.7, since foliage sits in the upper portion of a tree
  model, not at its base).
- `VegetationManager.ts` - `placeInstance` now also creates a fixed rigid body + ball sensor
  collider for tree types only (bushes/rocks unaffected), sized off the same per-instance scale
  jitter the trunk already uses; `PlacedInstance` gained `canopyColliderHandle` /
  `canopyRigidBodyHandle`, cleaned up in `removeChunk` alongside the existing trunk cleanup. Pulled
  the geometry math out as an exported pure function, `canopyGeometryFor(worldY, scaledHeight,
  scaleJitter)`, following the same pattern as this file's existing `pickType`/
  `minTreeSpacingFor` - specifically so the "canopy floats above where a standing player can reach"
  invariant could be locked in as a real test rather than left as a comment-only assumption (the
  Ridge Walker detection-range bug earlier in this project's history was exactly that kind of
  comment-only gap until a test was added after the fact).
- `VegetationManager.test.ts` (new) - two Vitest cases: the reach invariant, checked across the two
  real tree target heights (4.5, 6.0) and the actual scale-jitter range this codebase produces
  (`1 +/- VEGETATION_SCALE_VARIANCE`, not arbitrary extremes - a first draft using 0.5/1.5 jitter
  failed correctly, because trees outside the real jitter range are never placed at all); and a
  scaling-sanity check that a larger jittered tree gets a larger, higher canopy than a smaller one.

Verification: typecheck clean, `npm run test:unit` 19/19 green (17 pre-existing + 2 new), full smoke
suite 15/16 green with one failure (`dying releases pointer lock and Respawn resets the match without
leaving it`, timed out waiting on `isPointerLocked() === false` after `killPlayerByEnemy`) - re-run in
isolation to check whether the canopy change was responsible; this is the same pre-existing
kiting-archetype tail-risk flakiness already documented elsewhere in this file (Ridge Walker's
kiting occasionally pushes `killPlayerByEnemy` toward worst-case duration even after the sprint-based
mitigation), not something touched by this change, since nothing here touches enemy/combat/death-UI
code paths.
