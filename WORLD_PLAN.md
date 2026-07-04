# World Improvement Plan

Scope: everything **world-related** — terrain, buildings, vegetation, sky, lighting, atmosphere.
Explicitly **not** touching player, enemy, or weapon visuals/models (those already went through a
real-asset pass). This is a plan for review, not implementation — nothing here gets built until
it's approved.

## 1. Current state

- `TerrainGenerator.ts`: layered simplex noise (fBm, 4 octaves), sampled per-vertex, deterministic
  by world coordinate (`WORLD_SEED`).
- `ChunkManager.ts` / `Chunk.ts`: truly infinite streaming — loads a `VIEW_RADIUS_CHUNKS` (2) ring
  of 100-unit chunks around the player every frame, unloads anything beyond
  `UNLOAD_RADIUS_CHUNKS` (3), budgeted at `MAX_CHUNK_GENERATIONS_PER_TICK` (2) chunks/tick. No
  hard boundary anywhere.
- Visuals: one flat `MeshStandardMaterial` (`0x4a7a3a`, solid green, no texture) for all terrain.
  Sky is a solid color (`0x87ceeb`) with linear fog from 50 to `CAMERA_FAR` (2000). No props, no
  skybox, no ground texture, no vegetation. Four colored reference boxes exist purely as
  distance/orientation markers from early development — candidates for removal once real content
  exists.
- Nothing currently occupies world space except terrain and the entity spawn ring (targets/enemies
  within ~25 units of the match's spawn point).

## 2. World size: bounded, not infinite — recommendation

**Recommendation: cap the generated/playable world to a fixed bounded region instead of true
infinite streaming.** Reasoning:

- The game is arena-style, not open-world. Matches spawn a fixed enemy/target ring around one
  spawn point; even at the maximum match size (50 enemies), the ring radius formula
  (`Game.ringRadius`) tops out around 25 units from spawn — players realistically never travel
  more than a few hundred units in a session. Infinite terrain beyond that is generated and never
  seen.
- Every feature in this plan (building placement, vegetation scatter, ground texturing) adds
  per-chunk generation cost. That cost is fine to front-load once into a bounded world (and can
  lean on the loading screen already built for match setup) but compounds badly as an
  ever-growing, never-ending stream that must stay within a per-tick budget forever.
- A bounded world lets me *design* an edge instead of the terrain just trailing off into
  identical procedural noise forever. Treatment options (pick one, or combine):
  - A visible ring of mountains/high terrain at the boundary (raise `sampleHeight` output as
    distance from origin approaches the limit) — feels intentional, no artificial wall.
  - Fog-out tuned so the boundary sits just past the fog's far distance — you never actually see
    "the edge," you just can't see past it.
  - A soft invisible push-back force near the true edge as a last-resort safety net (not a hard
    wall — a hard wall would feel bad to walk into).
- Concretely: something like a 10×10 to 14×14 chunk world (1000–1400 units per side) comfortably
  dwarfs the largest match's play area while staying finite. Exact size is a tuning pass once
  building/vegetation density is known (denser content needs a smaller world to hit the same
  frame budget).

This replaces `ChunkManager`'s unbounded streaming with streaming-within-bounds (same load/unload
mechanism, just clamped to a chunk-coordinate range), not a rewrite.

## 3. Buildings

**Not enterable.** Solid exterior only — no interior geometry, no doors, no interior lighting.
Functionally a large collision box with a climbable face and a rooftop.

- **Shape**: procedural boxes (`THREE.BoxGeometry`), not a sourced modular building kit. A full
  architectural kit (doors, interior rooms, multiple modular pieces) is overkill for something
  that's deliberately not enterable, costs more draw calls, and is harder to keep visually
  consistent. A handful of size variants (e.g., 3-4 footprint/height presets) with a tiled
  concrete/brick texture gets a real "building" silhouette at a fraction of the complexity.
  Texture sourced from Poly Haven (tileable, CC0) rather than fabricated.
- **Placement**: per-chunk deterministic scatter (same seeding approach as terrain — hash chunk
  coordinates through the existing RNG so a chunk always generates the same buildings, matching
  how heightfield generation already works). Avoid placing buildings inside the match's spawn
  ring/entity area so they don't interfere with existing encounters; keep a minimum spacing
  between buildings so climbing one doesn't put a player inside the collision box of another.
- **Collision**: one solid fixed-body box collider per building (cheap — same pattern already used
  for the reference boxes and terrain heightfields).
- **Ladder / climb-by-contact mechanic**: one face of each building gets a visual ladder
  (texture or a simple low-poly rung mesh, sourced or procedural) backed by a **sensor collider**
  (non-solid, event-only — same collider-registry pattern already used for damage detection) on
  that face. New `Player` movement state:
  - Player's kinematic controller already blocks horizontal movement against solid colliders. If
    the blocking surface is tagged "climbable" (via the sensor) and the player is holding
    forward, switch into a **climbing** state: suspend gravity, move the player straight up at a
    fixed climb speed instead of the normal horizontal movement solve.
  - Releasing forward, reaching the top, or moving backward away from the wall exits climbing and
    returns to normal gravity/movement.
  - At the top: a small rooftop platform (flat collider flush with the top of the building) so
    climbing has a payoff — a vantage point over the arena — rather than dead-ending at the roof
    edge.
  - This is the one genuinely new **player movement** system in this plan (everything else is
    world content); it's in scope because it's a building/world interaction, not a player visual
    change.

**Implementation note (found during §6 step 1's code review):** the world's playable area is a
*circular* radial clamp (`WORLD_HARD_CLAMP_RADIUS`) inscribed inside the *square* 12×12 chunk
generation region — the player can never reach the four square corners (~848 units from origin vs.
the clamp's ~595). Vegetation/building scatter in §3–4 should skip placement beyond
`WORLD_HARD_CLAMP_RADIUS` (plus a small margin) rather than scattering across the full square, to
avoid spending instancing/placement budget on permanently unreachable corner terrain.

## 4. Vegetation (trees, bushes, rocks)

- **Source**: Kenney's Nature Kit (CC0, same low-poly style already established by the weapon/
  enemy/target models) — trees, bushes, rocks, maybe grass tufts. Exact download URLs verified at
  implementation time (never guessed), per this project's existing asset-sourcing discipline.
- **Placement**: per-chunk deterministic scatter, same seeding approach as buildings — density
  varies by a secondary noise field so vegetation clusters into looser "forest" and "clearing"
  patches instead of being uniformly speckled, which reads as much more natural for near-zero
  extra cost (just an additional noise sample per candidate placement, thresholded).
- **Performance — this is the part that actually matters**: individual `Object3D` instances for
  potentially thousands of trees/bushes across a bounded world would blow the draw-call budget
  immediately. **Must** use `THREE.InstancedMesh` — one draw call per vegetation *type* (e.g., one
  for "pine tree," one for "bush"), with each chunk contributing transform matrices to the shared
  instance buffer for whatever's in view. This is a hard technical requirement, not a nice-to-have.
- **Collision**: trees get a cheap cylinder/capsule collider (blocks movement, matches their
  trunk); bushes are visual-only, no collider (small clutter, not worth the physics cost, and
  shouldn't block movement anyway).

## 5. Visual polish (everything else world-related)

- **Ground texture**: replace the flat green material with a real tiled grass texture (Poly
  Haven, CC0). If height/slope-based blending is cheap enough at this project's complexity level,
  blend in a dirt/rock texture on steeper slopes — otherwise a single good grass texture already
  beats a flat color by a wide margin and is a reasonable place to stop for v1 of this pass.
- **Sky**: replace the flat color with `three`'s built-in `Sky` shader (procedural atmospheric
  scattering, ships with the `three` package already installed, no new dependency) or a gradient
  skybox — either reads dramatically better than a solid fill color for near-zero added
  complexity.
- **Fog**: retune near/far distances once the bounded world size is set, so fog conceals the
  boundary (see §2) rather than the current 50→2000 spread tuned for infinite terrain.
- **Small clutter**: scattered rocks (already covered under vegetation's instancing approach —
  same mechanism, just a different mesh) breaks up visually empty ground between trees/buildings.
- **Remove the four placeholder reference boxes** once real world content exists — they were
  distance/orientation markers for early development with no place in a finished-looking world.
- Lighting itself (`Game.addLighting` — one ambient + one directional "sun") is reasonable as-is;
  worth revisiting shadow-map resolution/distance once real geometry (buildings, trees) exists to
  cast/receive shadows, but not a structural change.

## 6. Suggested implementation order

Roughly least-to-most risky, each independently shippable/testable:

1. Bound the world (chunk-range clamp in `ChunkManager`) + edge treatment — smallest change,
   unblocks tuning everything else against a known play space.
2. Ground texture + sky shader + fog retune — pure visual, no new systems, immediate impact.
3. Vegetation (instanced trees/bushes/rocks) — new placement system, but no new player mechanics.
4. Buildings (solid box + placement) — reuses the same placement/collision patterns as vegetation.
5. Ladder climb mechanic — the one new player-movement system, built last once buildings exist to
   climb.

## 7. Decisions (resolved 2026-07-04)

- **World size**: bounded to **12×12 chunks (1200×1200 units)**. Middle of the originally proposed
  10×10–14×14 range — comfortably dwarfs the largest match's ~25-unit spawn ring. Treated as a
  starting number, not final: revisit once vegetation/building density and frame budget from §3–4
  are measured against it.
- **Building density/placement**: **moderate density, allowed just outside the spawn/entity ring**
  (never inside it). This means the per-chunk building scatter in §3 needs an explicit exclusion
  check against the ring radius (`Game.ringRadius` at max match size, ~25 units from spawn) plus a
  small buffer, rather than excluding a much larger area — buildings can sit close enough that a
  climbed rooftop plausibly offers a vantage over part of an encounter. Flagging this as a scope
  note: it changes existing encounter balance (LOS/sightlines into the ring from elevation) in a
  way full exclusion wouldn't — worth a playtest pass after buildings land, before tuning enemy
  spawn/detection ranges around it.
- **Art direction**: confirmed — low-poly/stylized throughout, matching the existing Kenney weapon/
  enemy/target models. No realism push on terrain or building textures.
- **Implementation order**: confirmed as written in §6 (bound world → visual polish → vegetation →
  buildings → climbing mechanic). No reprioritization.

All four items above are now locked for implementation; nothing left blocking a start on §6 step 1.

## 8. Fable model — assessed use in this plan

Per PLAN.md §8's standing rule, Fable (`claude-fable-5`) is scoped to creative/narrative subtasks
only, run in parallel with the core engineering (which stays on Sonnet). This plan is heavier on
systems work (chunking, colliders, instancing, a new player-movement state machine) than narrative
surface, so Fable's footprint here is intentionally small. Assessed task-by-task against §3–6:

**Good fit for Fable:**
- **Landmark/POI naming.** Once the world is bounded (§2) and has real content (buildings,
  vegetation clusters), a few named landmarks would help players orient themselves the way an
  infinite/uniform world never needed — e.g. flavor names for the largest building cluster, a
  distinctive rock formation, or the boundary mountain ring itself. Pure text, no gameplay logic;
  low-stakes pilot task like the Section 8 enemy-archetype naming that already worked well.
- **Building "flavor" signage/description text**, if the building pass (§3) ever grows a subtle
  environmental-storytelling layer (e.g. a tooltip or a loading-screen line referencing what a
  building cluster is meant to look like — a depot, a watchtower). Not currently in scope per §3
  ("solid exterior only, no interior") but cheap to add as text-only content later if wanted.
- **Loading-screen / tips copy** mentioning new world features (e.g. "Buildings can be climbed" as
  a rotating tip) once climbing (§3, ladder mechanic) ships — same pattern as existing UI copy.

**Not a fit — stays with Sonnet (this session):**
- Chunk-range clamping and edge treatment (§2) — physics/terrain code.
- Ground texture/sky shader/fog retuning (§5) — rendering code, not content generation; no text
  surface for Fable to act on.
- Vegetation placement, noise-based density clustering, `InstancedMesh` wiring (§4) — performance-
  critical systems code, explicitly excluded by PLAN.md §8's "physics/collision/render loop" rule.
- Building placement/collision, and especially the **climbing state machine** (§3) — new player-
  movement logic; PLAN.md §8 is explicit that Fable's coding reliability on systems code is
  unproven and mistakes here are expensive (a broken climb state could softlock or clip the
  player through geometry).

**Recommendation:** don't schedule a dedicated Fable pass until after buildings/vegetation exist
in-world (end of §6 step 4) — that's the first point this plan produces enough named, player-facing
surface for a small landmark-naming pilot to be worth running, mirroring how Fable's actual first
use on this project (Section 8 of PLAN.md) waited until Target/Enemy classes existed to hang
content on. Until then, this plan proceeds entirely on Sonnet, same as the rest of core engineering.
