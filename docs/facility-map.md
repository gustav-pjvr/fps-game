# The Facility: an indoor map with a new layout every match (v4.3.0)

Gustav asked on 2026-10-24 for an indoor map whose layout is never the same, with the circular map
in the top right, the lighting of the Opus 5.5 test game ("Kepler Deep", `Desktop/Model Test - 3D
Game/Opus-5.5`, its `NOTES.md`) including a torch on the front of the gun, in the game's current
look and building materials. In the same request: a real knife animation, because using the knife
looked like shooting a player.

This file is the design. Sections are referenced by the build jobs.

## 1. Scope

- A second map, **Facility**, picked before a match: in the single-player setup and in Create Room.
  The Valley (today's outdoor world) stays the default.
- Modes on the Facility. Single-player: Elimination and Director. Multiplayer: Default, 1 Shot 1
  Kill, Sniper Duel, Gun Game, Knife Only. Not in this release (the options are disabled with a
  reason when Facility is picked): single-player Horde and Mission, multiplayer Goose Toss, King of
  the Hill and Goose Horde. They depend on open terrain, flying geese or watch towers.
- No ambient goose flock and no bonus golden goose on the Facility.
- Weather does not apply indoors: the weather select is disabled while Facility is picked.
- The layout comes from the match seed (`core/worldSeed.ts`), so every client in a multiplayer
  match builds the identical facility, and single-player gets a new one each match.

## 2. Layout generator (`src/world/facility/facilityLayout.ts`, pure, unit-tested)

Grid: `FACILITY_CELL = 1.5` m, `FACILITY_GRID = 56` cells a side (84 m), centred on the world
origin. Cell `(i, j)` has its centre at `x = (i - 28 + 0.5) * 1.5`, `z = (j - 28 + 0.5) * 1.5`.
Floor is at y = 0 everywhere. RNG: `mulberry32(seed + FACILITY_SEED_OFFSET)` with
`FACILITY_SEED_OFFSET = 307` (clear of the other offsets listed in EntityManager.ts).

Cell kinds: `SOLID = 0` (wall mass), `OPEN = 1` (floor), `PROP = 2` (open floor with a crate on it:
blocks walking and navigation, not light except through the crate's own box).

Steps, all deterministic for a seed:

1. **Atrium.** A hall of 12 x 12 cells centred on the origin, ceiling 7.5 m, with four 2 x 2 pillars
   (SOLID) placed symmetrically 3 cells in from its walls. The centre point (0, 0) stays OPEN.
2. **Rooms.** Rejection-place rooms with sides 5 to 12 cells, at least 2 SOLID cells from any other
   room and 1 cell from the outer edge, up to 400 attempts, aiming for 14 to 18 rooms. Each room
   gets a kind with its ceiling: `hall` (6 to 7 m, side >= 9), `storage` (4.5 m), `plant` (5 m),
   `office` (3.5 m, side <= 7). The atrium is a `hall`.
3. **Connections.** A minimum spanning tree over room centres (Prim, by distance), then extra edges
   for loops: for each room, its second-nearest neighbour with probability 0.5. Every room ends up
   with at least two connections where possible, so the map has circuits, not dead ends.
4. **Corridors.** Each connection is carved as an L-shaped corridor 2 cells wide (3 m) between the
   two room centres, the bend chosen at random. A carved cell that was SOLID becomes OPEN with
   ceiling 3.2 m. A corridor through another room just joins it.
5. **Doorways.** Every OPEN corridor cell that touches a room cell across a former wall is a
   doorway cell. Record doorways `{ i, j, axis }` for door frames and hazard thresholds.
6. **Connectivity.** Flood fill from the atrium centre. Any OPEN cell not reached becomes SOLID.
7. **Pillars.** In `hall` and `plant` rooms of side >= 9: single-cell SOLID pillars on a lattice
   every 4 cells, never within 2 cells of a doorway.
8. **Crates.** In every room except offices: 2 to 6 crate clusters (1 to 3 adjacent cells),
   heights 0.9, 1.2 or 1.8 m (a 1.8 m crate is two stacked). A crate cell becomes PROP. A crate
   is never on or within 2 cells of a doorway, and a placement is undone if a flood fill shows it
   cut the OPEN cells apart.
9. **Lamps.** Ceiling lamps at the ceiling height minus 0.15 m. Rooms: a lattice every 3 to 4 cells.
   Corridors: one every 4 to 5 cells along their length, with about 1 in 4 left out, so stretches
   go dark. About 1 room in 5 is a **dark room**: one dim amber lamp only (the torch matters there).
   Lamp colours: warm `0xffd2a0` in halls, storage and offices, cool `0xcfe2ff` in plant rooms,
   amber `0xffa040` for the dark rooms and for emergency lamps (one at every third corridor bend).
   Each lamp has `{ x, y, z, color, intensity, kind: 'panel' | 'emergency' }`.
10. **Retry.** If the OPEN fraction ends outside 0.35 to 0.6 or fewer than 10 rooms were placed,
    regenerate from `seed + attempt * 7919` (attempt 1, 2, ...). Deterministic either way.

Output, `FacilityLayout`:

```ts
interface FacilityLayout {
  readonly seed: number;
  readonly size: number;                 // 56
  readonly cell: number;                 // 1.5
  readonly kinds: Uint8Array;            // size * size, index j * size + i
  readonly ceiling: Float32Array;        // metres, 0 for SOLID
  readonly region: Int16Array;           // room index, -1 corridor, -2 SOLID
  readonly rooms: readonly FacilityRoom[];   // { i0, j0, i1, j1, kind, ceiling, dark }
  readonly doorways: readonly FacilityDoorway[];
  readonly crates: readonly FacilityCrate[]; // { i, j, height }
  readonly lamps: readonly FacilityLamp[];
}
```

Helpers in the same module: `cellOf(x, z)`, `cellCentre(i, j)`, `isWalkable(x, z, clearance)`
(every cell the clearance circle touches is OPEN), `isSpawnBlocked(x, z)` (not walkable with
clearance 0.8 m), `encounterPoints(count, avoid: {x, z, radius}, rng)` (cell centres spread over
different rooms, at most 3 per room, nothing inside `avoid`), `playerStart(rng)` (a room centre
other than the atrium).

## 3. Navigation (`src/world/facility/facilityNav.ts`, pure, unit-tested)

`FacilityNav.nextWaypoint(fromX, fromZ, toX, toZ): { x, z }`:
- Snap the target to the nearest walkable cell (clearance 0.45 m).
- If the straight segment is clear (grid DDA, every cell within 0.45 m of the line walkable), return
  the target itself.
- Otherwise use a flow field: a BFS from the target cell over walkable cells, 8 neighbours with no
  corner cutting, cached per target cell (LRU of 24 fields). From the enemy's cell, follow the flow
  up to 8 cells and return the centre of the farthest of those cells that is still in clear
  straight line, so paths are smoothed.
- An unreachable target returns the target unchanged (the existing stuck handling takes over).

## 4. Baked lighting (`src/world/facility/facilityBake.ts`, pure, unit-tested)

The Kepler approach: lamp light baked per vertex with shadows and ambient occlusion, so dozens of
lamps cost nothing at run time. Input: the layout and the static geometry's positions and normals.
Output: one linear RGB value per vertex.

- **Direct.** For each lamp within 14 m: `color * intensity * max(0, n.L) * falloff * cone *
  visible`, with `falloff = 1 / (1 + (d / 1.6)^2) * smoothstep(14, 8, d)` and, for ceiling panels,
  `cone = 0.35 + 0.65 * max(0, -Ldir.y)` (they throw light downward).
- **Shadows.** A ray from the vertex (pushed 0.05 m along its normal) to the lamp, walked through the
  grid with a DDA: blocked by a SOLID cell, by a crate box (slab test), or where the ray's height
  inside an OPEN cell is above that cell's ceiling (lintels between tall rooms and low corridors).
- **AO.** 12 fixed cosine-weighted hemisphere rays of 1.2 m, rotated by a per-vertex hash, against
  the same blockers plus floor and ceiling. `ao = 1 - 0.75 * occludedFraction`.
- **Bounce fill.** Per cell, a probe: the unshadowed-by-normal direct light at the cell centre 1.4 m
  up (no `n.L`, times 0.5). A vertex adds `0.12 *` the mean probe of the 3 x 3 cells around it.
- `final = (direct + fill) * ao`. The probes are also returned (`Float32Array`, rgb per cell): they
  light moving things (section 6).

Budget: the static geometry stays under 140k vertices and the bake under 1.5 s in desktop Chrome.

## 5. Geometry, colliders and materials (`src/world/facility/FacilityBuilder.ts`)

The game's own structure materials (`world/structureMaterials.ts`), the same ones the houses and
towers use, so the facility reads as the inside of the game's buildings.

- **Floor:** one quad per OPEN or PROP cell, split 2 x 2. `concrete`; `grating` in plant rooms.
- **Ceiling:** one quad per OPEN cell at its ceiling, facing down, split 2 x 2. `perforated` in
  corridors and plant rooms, `concrete` elsewhere.
- **Walls:** for each OPEN cell side that faces a SOLID cell, a vertical quad from 0 to that cell's
  ceiling, split every 0.75 m both ways. Below 1.1 m `cladding` (a dado band), above it `concrete`.
- **Lintels:** where two OPEN cells share a side and their ceilings differ, a quad on that side from
  the lower ceiling to the higher, facing the taller cell.
- **Doorways:** `steel` frame posts and a header on each doorway edge, and a `hazard` strip on the
  floor across the threshold.
- **Crates:** boxes of 1.2 x h x 1.2 m centred in their cells, `cladding` sides and `steel` tops,
  faces split 2 x 2 so they bake.
- **Lamps:** emissive panels 0.9 x 0.08 x 0.3 m (an `InstancedMesh`), emissive strong enough to
  bloom; emergency lamps are small amber boxes.
- **Light shafts** (Medium and High only): in rooms with ceiling >= 5.5 m, an additive open cone
  under each panel lamp (top radius 0.3 m, bottom 1.6 m, down to the floor), opacity about 0.05,
  fading toward the floor through vertex colours, `depthWrite: false`, `fog: false`.
- **Dust:** 300 slow additive points that follow the camera within 10 m (Medium and High).
- **Baked material patch:** each static material is a clone with `onBeforeCompile` adding a
  `bakedLight` vec3 attribute and, before `#include <aomap_fragment>`,
  `reflectedLight.indirectDiffuse += vBakedLight * BRDF_Lambert(diffuseColor.rgb);`, with a
  `customProgramCacheKey`. Real-time lights (the torch, muzzle flashes, explosions) still apply.
- **Colliders:** one fixed body. SOLID cells merged greedily into rectangles, each a cuboid from y 0
  to 8 m. A floor cuboid under the whole grid. Ceiling cuboids per rectangle of OPEN cells with the
  same ceiling. One cuboid per crate.
- **Cover for the enemy AI:** every crate cluster and pillar registered in the `ObstacleRegistry`
  as a rectangle footprint (the `'house'` obstacle kind).
- `dispose()` frees geometry, materials and colliders.

## 6. Look (`render/look.ts`, `core/Renderer.ts`)

A `facility` look preset beside the weather presets, with `indoor: true`: the sky is hidden, the
environment map is off, fog is near-black (`0x0b0d0e`, near 6 m, far 48 m), exposure about 1.2,
bloom intensity about 1.1 with threshold about 0.75, vignette 0.38, grain 0.05. The sun is off.
The hemisphere fill becomes the light for moving things (players, enemies, the gun): every frame
it takes the baked probe of the camera's cell, damped, so a player standing in a lit room sees
lit opponents and in a dark room sees only what the torch shows.

## 7. Torch (`src/render/Flashlight.ts`)

- A `SpotLight` added to the scene (not the camera, or the view-model layer swap would hide its
  light from the world), placed every frame at the camera position plus a camera-local offset at
  the front of the gun (about `(0.18, -0.16, -0.35)`), aimed along the camera forward.
  Angle 0.38 rad, penumbra 0.55, distance 32 m, decay 2, colour `0xfff1dc`. Casts a shadow
  (512 map) when the quality preset has shadows.
- A small torch body with an emissive lens mounted at the front of each ranged view model, near its
  muzzle; the knife has none and the light then comes from the shoulder.
- New action `flashlight`, default key F, rebindable, labelled "Torch". On by default on the
  Facility; F toggles it with a click. Not available on the Valley in this release.
- Other players: a pool of 3 extra spotlights (no shadows), created at match start so the shader
  never recompiles mid-match, each following one opponent's head with their yaw and pitch, plus a
  small glowing lens on the avatar. `playerSnapshot` gains an optional `torch?: boolean`; missing
  means on.

## 8. Minimap (`ui/minimap.ts`)

The circular map in the top right, player-relative as today. On the Facility it shows the layout:
the whole plan drawn dimly from the start, rooms and corridors the player has entered drawn
brighter, at a radius of 26 m. It is drawn on a canvas inside the existing circle from a prerendered
plan image (one `drawImage` per frame). Single-player on the Facility shows the map too, with enemies
inside the radius as red blips while they move. Multiplayer keeps its opponent dots.

## 9. Knife (`weapons/`)

- No tracer, no camera recoil kick, no gunshot sound for a melee weapon, locally or on other
  clients (a `fireEvent` for a melee weapon id plays a swing sound at the sender instead).
- View model: a draw flip when the knife is equipped, two alternating slashes (right to left, then a
  left to right backhand) of about 0.35 s, a quicker stab when aiming, no aim-down-sights pose.
- Sounds: a synthesised whoosh on every swing, a short thud when it hits a player or enemy.
- The pose curves live in a pure module with unit tests.

## 10. Plumbing

`MatchMap = 'valley' | 'facility'` in `core/config.ts`. Single-player: `MatchConfig.map`, chosen in
`PlaySetupModal`. Multiplayer: Create Room's map select, carried on `matchStart`, the welcome's
`activeMatch` and `MultiplayerSession.map`, optional on the wire (missing means `valley`) and kept
through Rematch. `TerrainGenerator.sampleHeight` gains a module-level override set by a Facility
match (floor height 0) and cleared on dispose. `Enemy.moveToward` and the retreat step route through
`FacilityNav` when a Facility match sets the enemy navigator. Debug API: `getFacilityDebug()`.
