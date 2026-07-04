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

**Deferred (explicitly paused, not started):** roads connecting town buildings; Step 5 (ladder
sensor collider + player climbing state machine).
