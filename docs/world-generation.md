# World Generation

Development notes for terrain, zones, towns, forests, roads, watch towers, and vegetation, extracted from the original NOTES.md.

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

## World shrink + denser zone placement (2026-07-05)

Per user request: a smaller, denser-feeling world (less open ground, more towns/forests), without
resorting to a real inter-zone overlap-avoidance search - the user explicitly doesn't mind
forest/town discs overlapping each other or crowding the spawn/combat ring.

Turned out `WORLD_SIZE_CHUNKS` can't just be lowered on its own: it sets a hard geometric ceiling
on how large any flat/forest zone can ever be (see `isSiteClear`/`maxClearRadius` in `ZoneMap.ts` -
a site's disc must clear both the world-edge mountain ramp and the spawn/combat ring, and shrinking
the world narrows that clearance for every site everywhere at once, not just some). Worked out the
actual ceiling formula by hand: at the user's first-choice `WORLD_SIZE_CHUNKS=6` (300 unit radius),
even the *best-possible* site position anywhere in the world only clears ~42 units of radius - far
below the existing zone radius ranges (65-90 flat, 78-92 forest). Confirmed this isn't a "some
sites fail, retry elsewhere" situation: `computeGuaranteedSites` already has an explicit
`if (maxDistance <= minDistance) return []` bail-out for exactly this case, meaning zero towns and
zero forests, ever, for any seed - not something a smarter retry/overlap-avoidance search could fix,
since there's no position anywhere that the geometry allows.

Landed on a combination that keeps zone sizes nearly unchanged while still shrinking the world and
substantially increasing how many towns/forests spawn:
- `WORLD_SIZE_CHUNKS`: 8 -> 7 (350 unit radius, `WORLD_EDGE_RAMP_START` = 220).
- `ZONE_EDGE_MARGIN`: 30 -> 10 (per user decision - zone/spawn-ring crowding is fine). This is the
  bigger lever on density: a smaller margin means far more candidate sites clear `isSiteClear` at a
  large radius, directly increasing how many towns/forests actually spawn per match, not just
  capping how big one can be. Not dropped to zero - buildings have no clearance check of their own
  (unlike vegetation's `VEGETATION_SPAWN_CLEARANCE`, checked per-instance regardless of zone shape),
  so this margin is the only thing keeping a town's actual buildings off the encounter ring's edge.
- `FLAT_ZONE_RADIUS_MAX`: 90 -> 85, `FOREST_ZONE_RADIUS_MAX`: 92 -> 85 (mins unchanged at 65/78) -
  the new ceiling at these settings is ~87.5, so both needed only a small trim to stay safely inside
  it, nowhere near the drastic cut (~40) shrinking the world alone would have forced.

**Verification:** `npx tsc --noEmit` clean. `npm run test:unit` 19/19 green, including
`ZoneMap.test.ts`'s 1000-seed sweep asserting every seed still yields exactly `GUARANTEED_ZONE_COUNT`
full-size, clear flat and forest sites - the definitive check for this change, since it exercises the
exact formula this whole exercise was reasoning about by hand. Full `npx playwright test
e2e/smoke.spec.ts` 15/16 green (the one failure was the same pre-existing GLTF-texture-load flake
this file already documents elsewhere, confirmed unrelated by a clean isolated re-run).

**Follow-up (2026-07-06): 7 was a real bug, reverted to 6.** Only found because a full,
unfiltered `npx playwright test` run (done for an unrelated reason - verifying the multiplayer
Phase 2 work below) happened to include `e2e/world-bounds.spec.ts`, a pre-existing test this
session had never actually run (every prior check in this file only ever ran `smoke.spec.ts`
directly by name). It failed: a player sprinting toward the boundary fell through into empty space
(`y = -2281`). Root cause: `WORLD_MIN_CHUNK`/`WORLD_MAX_CHUNK` are computed as
`-floor(n/2)` / `-floor(n/2) + n - 1` - symmetric only for *even* `n`. At `n=7` this generates
terrain from x/z -300 to +400, not a symmetric +/-350, but `WORLD_HARD_CLAMP_RADIUS` (345) assumes
symmetric coverage in every direction - so the boundary clamp pushed the player to a radius the
terrain generator never actually reached on the shorted side. Confirmed by direct calculation, not
just theory, before touching any code. Fixed by moving to `WORLD_SIZE_CHUNKS=6` (confirmed
symmetric: exactly +/-300) instead - the nearest smaller even number - and re-deriving the zone-radius
squeeze this reopens: per user decision, `ZONE_EDGE_MARGIN` absorbs most of it (10 -> 5) rather than
cutting zone radii further than necessary (`FLAT_ZONE_RADIUS` 65-85 -> 40-60, `FOREST_ZONE_RADIUS`
78-85 -> 45-65 - both re-derived from the same ceiling formula, now ~67.5 instead of ~87.5). Also
moved the multiplayer spawn points inward (+/-180 -> +/-140) since the ramp start radius shrank
under them too (220 -> 170). `WORLD_SIZE_CHUNKS`'s own comment now states in bold that it must stay
even, with the full derivation, so this can't quietly regress again.

**Re-verification:** `npx tsc --noEmit` clean. `npm run test:unit` 19/19 green (the 1000-seed zone
sweep passing again with the new 40-60/45-65 ranges is the definitive check that towns/forests still
reliably spawn). `e2e/world-bounds.spec.ts` - the test that caught this - now passes (1.5m). Full
`npx playwright test` (every spec file together) re-run clean after the fix.

### Ladders removed, replaced with a physical crate staircase

Per playtest feedback: remove ladders entirely, investigate crates near houses that players can
jump onto instead, reusing some of the ladder codebase where it made sense.

- **`BuildingManager.ts`**: the old wall-mounted ladder (scripted hold-forward-to-climb, sensor
  spanning ground-to-roof, zero real collision on the visible rungs) is gone. Replaced with
  `createCrateStack`: a real, solid, 3-tier crate staircase (`CRATE_TIER_COUNT`/`CRATE_SIZE` in
  `config.ts`) the player actually jumps up tier by tier, each tier one crate-width closer to the
  wall than the last. Only **house** presets get a crate stack (`hasCrateStack` on
  `BuildingPresetDef`) - the user specifically asked for crates "near houses," and towers (up to
  12m tall) have no realistic jump-based staircase equivalent, so they lose roof access entirely
  now rather than getting an ugly compromise.
- **Reused from the ladder system**: the `registerClimbable`/`getClimbableMantleTarget`
  machinery (`PhysicsWorld.ts`) - a sensor collider above the crate stack still teleports the
  player onto the roof center once they're standing on the top crate and walk into the wall,
  closing whatever gap remains above the fixed 3-tier stack regardless of the house's actual
  height (4-6.5m across the three house presets). What's genuinely new/removed: the *sustained
  climb* state (`climbing`/`LADDER_CLIMB_SPEED`/`activeClimbColliderHandle` in `Player.ts`) is
  gone entirely - the crates themselves do the real vertical work now, so the mantle is a
  one-shot teleport triggered by contact, not a scripted multi-second rise. This also let
  `isTouchingSpecificClimbable`/`isClimbable` (no longer needed once there's no sustained state
  to lock onto) come out of `PhysicsWorld.ts`, and `isClimbing`/`isTouchingClimbable`'s debug
  hooks come out of `Player.ts`/`Game.ts`.
- **Crate visual**: procedural boxes (same placeholder-primitive precedent as the old ladder
  rungs/rocks/targets - see this file's own history), positioned to exactly match the physical
  colliders so what's rendered is what's actually walkable, not a decorative approximation.
- **Known follow-up, not yet done**: the user tried this live and it works, but noted the 3-tier
  stack reads as an obvious geometric staircase rather than a casual pile of crates - cosmetic
  polish (jittering crate position/rotation without touching the collision geometry) is a small
  follow-up, not done this pass (an agent assigned to it hit a session limit before reaching that
  part - see the building-count fix below, which *did* land).

**Verification:** this is a real risk-tier change (core player movement/physics, not a config
tweak) - `npx tsc --noEmit` clean, unit tests 19/19 green, `npm run build` succeeds. Manually
playtested live by the user, who confirmed climbing the crates and mantling onto a house roof
actually works. My own automated e2e attempt at this (teleport near a found crate stack, walk/jump
into it, assert the player ends up higher) turned out unreliable in this harness - it repeatedly
produced inconsistent results (frozen in place, or once a large unexplained fall) that traced back
to synthetic-input timing quirks (a raw `keyboard.down`/`up` pair spanning several seconds silently
stopped registering; the codebase's own `holdKey` helper, called repeatedly, didn't have this
problem) rather than an actual game-logic bug - confirmed by isolated diagnostics showing the
crate colliders themselves settle correctly at the expected heights. Per this session's own
established lesson (see the earlier ladder-debugging entries in this file), a flaky test that
grades the test harness rather than the product isn't worth shipping - removed rather than kept as
an unreliable permanent regression test.

### Town building-count fix (fallout from the WORLD_SIZE_CHUNKS 6→4 shrink)

Live playtest report: "very little houses spawn." Root cause: `TOWN_MIN_BUILDINGS`/
`TOWN_MAX_BUILDINGS` (30-45, per an earlier explicit project decision - "towns must consist of a
minimum of 30 buildings") were tuned for the *old* 40-60 radius flat zones and never rescaled when
`WORLD_SIZE_CHUNKS` shrunk flat-zone radius down to 10-16 this same session. With
`TOWN_BUILD_FRACTION = 0.8`, the buildable disc is only radius 8-12.8 now - simulating
`getTownLayout`'s actual rejection-sampling loop against the presets' real measured footprints
across 2000 seeds showed towns saturating at roughly 4-8 buildings regardless of how high the
30-45 target was set, burning the full `TOWN_MAX_PLACEMENT_ATTEMPTS` budget every time and still
landing far short - exactly the reported symptom.

- Retuned to `TOWN_MIN_BUILDINGS = 8`, `TOWN_MAX_BUILDINGS = 12` - sits at/just above the
  geometric saturation ceiling for the current zone sizes, so towns stay as dense as the geometry
  physically allows. This supersedes the "minimum 30" decision, which is no longer reachable at
  this world size without either enlarging flat zones again or shrinking building footprints -
  flagged back rather than silently reinterpreted, in case the user wants to revisit the tradeoff
  differently (e.g., growing flat zones specifically, independent of forest zones).
- **Investigated forest sparsity separately** (the user also reported a seed with no visible
  trees): unlike towns, vegetation placement (`VegetationManager.ts`) isn't a fixed-total-count
  target per zone - it's density-field-gated per candidate-per-chunk, scaled by forest zone
  membership. So a smaller forest zone (same 10-16 radius shrink as flat zones) naturally produces
  proportionally fewer trees by area, without any rejection-sampling saturation failure - this is
  an inherent, expected consequence of the accepted map-shrink tradeoff, not a distinct placement
  bug. The guaranteed-zone-existence mechanism itself (`computeGuaranteedSites`) still checks out
  numerically for both flat and forest zones at the current world size (a positive 7-unit
  distance band for either), so "zero forest zones" specifically shouldn't be happening - a report
  of a seed reading as treeless is more likely "the forest zones that exist are small and the
  player didn't walk into one" than a bug. Left vegetation spacing/density constants untouched -
  bumping forest zone radius specifically (independent of flat zones, since forests carry no
  competing "minimum N" requirement) is a real option if the user wants denser-looking forests, but
  is a design tradeoff to confirm with them first, not something to change unilaterally.

**Verification:** `npx tsc --noEmit` clean, unit tests 19/19 green (including the
`ZoneMap.ts` guaranteed-sites coverage this project already treats as load-bearing regression
protection). `npm run build` succeeds.

### Denser forests + crate pile visual polish

Follow-up to the two items above, per direct user request.

- **`FOREST_ZONE_DENSITY`** raised 0.45 → 0.7 - the actual lever for "more forests, more often"
  (raises the odds any given density-noise cell rolls a forest site at all; doesn't touch the
  radius/geometric-ceiling math at all, so no risk to the guaranteed-forest-zone invariant).
  **`FOREST_ZONE_RADIUS_MAX`** nudged 16 → 17 (min left at 10) - close to the world's ~17.5
  geometric ceiling without meaningfully raising the natural-site rejection rate. Verified:
  `npx tsc --noEmit` clean, unit tests 19/19 green (including `ZoneMap.ts`'s guaranteed-sites
  coverage).
- **Crate stack visual** (`BuildingManager.ts`'s `createCrateStackVisual`) now applies small
  deterministic per-crate jitter - position offset, Y-rotation, tint variance - seeded from each
  building's own position (mulberry32/hashChunkSeed, same pattern this file already uses for town
  layouts, so a reloaded world looks identical, not randomized every visit). Purely cosmetic: the
  actual collision boxes in `createCrateStack` are untouched, so climbing behavior is unchanged.
  Addresses playtest feedback that the un-jittered 3-tier stack read as an obvious geometric
  staircase rather than a casual pile of crates. Verified visually via a screenshot from a
  temporary Playwright script (teleported next to a live crate stack, confirmed the jitter reads
  as a loose pile while crates still sit flush against the wall) - discarded after confirming, not
  kept as a permanent test since it was purely a one-off visual check, not a regression the CI
  suite needs to keep guarding.

### Organic zone growth - towns/forests no longer fixed-radius circles

Bigger rework, planned and confirmed with the user before implementation (see the session's plan
file) - the deferred idea already noted in this file's own `WORLD_SIZE_CHUNKS` history. The
circular-disc zone model was the actual ceiling on how big/dense towns and forests could get in
the tight post-shrink annulus (not the annulus itself): `isSiteClear` rejected a candidate site
entirely the moment its full-radius circle didn't fit at that exact position, even when a smaller
or differently-shaped zone would fit fine there.

- **`ZoneMap.ts`**: each site's shape is now `radii: readonly number[]` - 16 evenly-spaced rays
  from the site center, each ray's length computed via ray-circle intersection against both
  existing boundaries (the world-edge mountain ramp and the spawn/combat ring), capped at 98% of
  the zone's own cell size to preserve `findNearestSite`'s 3x3-neighbor-search assumption that no
  site's extent exceeds one cell. This can't produce an out-of-bounds shape by construction, so
  `isSiteClear` is gone - replaced by `hasMinimumRoom` (every ray must clear `radiusMin`) for the
  one remaining rejection case, a site with no usable space in *any* direction.
  `membershipFor`/building placement now interpolate the two nearest rays at a query's actual
  angle instead of comparing against one scalar. Added a per-cell shape cache
  (`cachedSiteForCell`, cleared wholesale on world-seed change, mirroring this file's existing
  `guaranteedSitesCache` pattern) since ray-circle intersection is meaningfully more expensive
  than the old single multiply-add and `siteForCell` runs on every terrain-vertex/vegetation/
  building zone query.
- **Consumer audit before touching anything**: traced every consumer of zone data outside
  `ZoneMap.ts`. `TerrainGenerator.ts`, `VegetationManager.ts`, `enemySteering.ts`, and
  `RoadManager.ts` all only read `.membership`/`.siteX`/`.siteZ` - untouched by this rework, since
  those are unaffected by how the shape is computed internally. Only `BuildingManager.
  getTownLayout` used `site.radius` directly (uniform-sampling building positions within a disc) -
  changed to pick the angle first, then sample distance against `radiusOfFlatZoneAtAngle` for
  that exact angle, so buildings can now use a zone's actual organic footprint in every direction
  rather than whatever fit inside the tightest circle that used to bound the whole zone.
- **`ZoneMap.test.ts`** rewritten (not preserved as-is - the new model has no single scalar radius
  to check) to assert the organic equivalents of the same invariants across the same 1000-seed
  sweep: every guaranteed site's rays independently re-verified against both boundaries (via a
  boundary check written separately from `ZoneMap.ts`'s own ray-circle math, not just re-running
  production code against itself), every ray clears `radiusMin`, distinct cells, determinism, and
  `getFlatZoneSite` consistency.

**Verification:** `npx tsc --noEmit` clean, unit tests 19/19 green including the rewritten
1000-seed sweep, `npm run build` succeeds. Visually confirmed via the dev server (grid-searched
for a live town, screenshotted from directly overhead): a real multi-building town on visibly
smooth flattened ground, no terrain seams, no console/page errors. Uncommitted pending explicit
sign-off per user instruction (not pushed).

### Standalone watch towers, replacing the generic tower building presets

Per user request: removed the "tower" building presets that used to be mixed into town layouts
(`BUILDING_PRESET_DEFS` in `BuildingManager.ts` now only lists houses) and replaced them with 4
standalone watch towers per map, placed independently of towns/forests, each with a real walkable
switchback staircase - a continuous tilted-box ramp per flight, not the crate-jump mechanic used
for house roofs, per this project's own hard lesson from that earlier work about jump-timing
reliability.

- **New `WatchTowerManager.ts`**: `computeWatchTowerPositions()` (pure, exported for testing)
  places 4 towers via evenly-spread angles + bounded retry, mirroring `ZoneMap.ts`'s
  `computeGuaranteedSites` - with a second, wider retry pass that drops the "stay in your own
  sector" ideal if a town/forest zone genuinely covers a tower's whole assigned sector (a real
  measured failure mode, not theoretical: caught ~6% of seeds in the test sweep before this
  existed). `WatchTowerManager` itself builds each tower's shaft, 4 ramp flights, landings, top
  lookout platform, and railings as RAPIER colliders on one fixed rigid body, wired into
  `Game.ts`'s chunk-streaming hooks alongside `buildings`/`vegetation`/`roads`.
- **`WatchTowerManager.test.ts`**: seed-swept placement invariants (exact count, world-edge/
  spawn-ring clearance as a hard 100%-guaranteed check; zone-clearance and inter-tower separation
  as documented best-effort checks with a real, measured failure-rate ceiling, not false 100%
  guarantees - see the test file's own comment for why those two specifically can't be made
  airtight without a disproportionate rework for a low-stakes cosmetic edge case).
- **Three real bugs found only by actually testing this in the dev server** (automated e2e proved
  too unreliable for this specific tight polling-loop scenario in this sandboxed environment -
  repeatedly hung inside plain `page.evaluate()` calls unrelated to any game logic, confirmed by
  swapping CDP keyboard dispatch for a direct DOM event and seeing the exact same hang move to a
  different, non-keyboard call; the user's own manual playtesting is what actually caught and
  diagnosed these):
  1. **Terrain buried the staircase.** A tower's rigid body was positioned using
     `sampleHeight` at its own single center point, assuming locally flat ground - but this
     world's mountainous terrain can vary by many meters over just the tower's own footprint
     width. Fixed by adding a flattened clearing around each tower's base in
     `TerrainGenerator.ts` (`nearestWatchTowerClearing`, mirroring the existing spawn-clearing
     mechanism), with a cached `getWatchTowerPositions()` wrapper in `WatchTowerManager.ts` since
     `sampleHeight` runs on every terrain-vertex sample and the full placement search is too
     expensive to redo per-vertex.
  2. **Railing overlapped the ramp it was supposed to guard.** `createOuterFlightRailing`/
     `createOuterLandingRailing` offset the railing by only half the stair width from the ramp's
     centerline - placing the railing's centerline exactly at the ramp's own edge, so the
     railing's near half-thickness physically overlapped the ramp. A player's capsule walking
     directly along that overlapping seam caused erratic character-controller ejection. Fixed by
     offsetting by half the stair width *plus* the railing's own half-thickness, so the railing
     sits flush against the ramp's edge instead of overlapping it.
  3. **The last flight merged into the platform.** A tilted ramp box's true walkable surface sits
     above its own nominal centerline by a thickness-dependent amount once projected through the
     incline angle - making the last flight's endpoint match the platform's height exactly (the
     first draft) let the ramp's solid geometry punch up into the platform's own solid volume,
     merging into one mass with no exposed edge to step onto - exactly matching the user's report
     ("the last stair piece merges into the main piece... impossible to get onto the tower").
     Fixed by stopping the last flight `TOP_FLIGHT_CLEARANCE_BELOW_PLATFORM` (0.5) short of the
     platform's height instead of ending flush with it, leaving a clean, small, autostep-sized
     step up rather than trying to make a tilted surface flush with a flat one.

**Verification:** `npx tsc --noEmit` clean, unit tests 23/23 green (19 existing + 4 new placement
tests), `npm run build` succeeds. Functional climbability confirmed by the user directly in the
dev server after each fix, not by the automated e2e harness (see above for why that path was
abandoned as unreliable for this specific scenario, not because the underlying mechanic is
untested - the placement math and boundary invariants are still covered by the unit test sweep).

**Follow-up (same feature, later manual playtest):** a fourth real issue, found the same way -
the last flight's landing point sat right at the edge of its own tower's flattened clearing, in
the *blending* band back toward natural terrain rather than the guaranteed-flat band, so on
towers where the surrounding terrain happened to slope steeply the ramp visibly floated above or
sank into the ground depending on which way that slope ran. Fixed in two parts:
1. `TerrainGenerator.ts`'s clearing blend now uses the tower's own real footprint radius
   (`WatchTowerManager.ts`'s new exported `WATCH_TOWER_FOOTPRINT_RADIUS`) as the guaranteed-flat
   inner radius, instead of a fixed fraction of the outer clearing radius that didn't actually
   reach the outer flights' own corners.
2. Per the user's own hands-on iteration (several rounds of "rotate the last flight's endpoint by
   N degrees, raise it a little") - the last flight's endpoint now pivots around its own start
   point (`TOP_FLIGHT_SWING_DEGREES`, settled at -15°) instead of running flush along the shaft's
   fourth face like the other three, landing a touch closer to the platform's own height
   (`TOP_FLIGHT_CLEARANCE_BELOW_PLATFORM` tightened from 0.5 to 0.3). Confirmed correct by the
   user directly in the dev server, not by automated e2e (same reasoning as above).

## Match weather (v3.3.0): host-selectable Day/Night/Fog

A new multiplayer-only host setting (single-player always renders 'day', the existing baseline).
Deliberately cheap to fake, no new assets/shaders: `Renderer.setMatchWeather` toggles the
procedural `Sky` mesh's visibility and swaps `scene.fog`/`scene.background`, while `Game.ts`
separately adjusts the sun `DirectionalLight`'s color/intensity and the ambient fill (it already
owns those objects, Renderer doesn't).

- **Night**: the `Sky` shader has no day/night uniform to swap, so night hides it entirely and
  paints a flat dark `scene.background` instead - the cheap way to fake a night sky without new
  shaders. Sun dims/cools (`NIGHT_SUN_COLOR`/`NIGHT_SUN_INTENSITY`), and ambient fill is forced up
  to `NIGHT_AMBIENT_INTENSITY` regardless of the current Graphics Quality tier's own ambient rule -
  without that override, switching graphics quality mid-match would silently undo the night
  brightness floor and leave the match unplayably dark.
- **Fog**: a second, much denser `THREE.FogExp2` (`MATCH_FOG_DENSITY`/`MATCH_FOG_COLOR`) swapped in
  only for this choice - deliberately *not* a retune of the existing `FOG_NEAR`/`FOG_FAR`/
  `FOG_COLOR` linear fog, which is tuned for a different job entirely (concealing the world edge at
  distance, not atmosphere) and shouldn't be repurposed to do both.

Threaded through the same 4 sites `gooseDifficulty`/`gameMode` already established
(`MatchStartMessage`, `WelcomeMessage.activeMatch`, `MultiplayerSession`,
`MultiplayerMatchStartParams`) - a new `weather: MatchWeather` field at each, read from a 4th
`CreateRoomScreen`/`matchEndScreen` selector cloned from the existing goose-difficulty template.


## House roof colliders, bushes and rocks, spawn safety (2026-09-14)

**Roof colliders follow the roof.** Every house used to get one cuboid (footprint shrunk 0.85 per
the v3.3.1 invisible-wall fix) whose height ran to the roof ridge, so its flat top filled the empty
air above both gable slopes: shots that visibly cleared a roof stopped in mid-air, and a player on a
roof hovered at ridge height. `src/world/buildingColliders.ts` (pure, unit tested) now derives the
shape from the loaded model at runtime: upward-facing triangles are grouped into flat or sloped
pieces (pieces under 2% of the footprint, like door trim, are ignored), a wall box keeps the shrunk
footprint but stops at the storey top under the lowest eave, and each roof piece becomes a convex
prism dropped onto the slab below it and clamped inside that slab's outline, so there is still no
invisible ledge under the eaves. All three presets measured a 40.5 degree roof pitch. Verified with
the real `castHitscan` against a real `placeForChunk` house: a shot 0.35 m above a slope now passes,
one below hits the drawn gable, and collider and visual roofs agree within 0.10 m on house-a.
Known leftover: house-c is T-shaped and its single wall box still fills the two empty back corners
(about 1.1 by 2.6 m, 2.75 m tall; the old box did this up to 6.5 m).

**Bushes and rocks spawn again.** `pickType` rolled the bush/rock scatter only after the tree
density check failed, and the effective tree threshold had been tuned to 0, so that fallthrough was
unreachable and no bush or rock spawned anywhere. The scatter roll now comes first, independent of
density, as its docstring always described.

**Spawn safety.** `BuildingManager.isPointInsideBuilding` and `isPointInsideWatchTower` answer "is
there a structure here" from the seeded layout alone, and every player spawn path (multiplayer
initial points, respawns, the unstick respawn, late joins, single-player Goose Horde) now steps off
any house or tower through `findClearSpawnPoint` in `src/core/multiplayerSpawn.ts`.
