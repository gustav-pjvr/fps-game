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
  Kill, Sniper Duel, Gun Game, Knife Only. Since v4.4.0 every other mode too (section 12):
  single-player Horde and Mission, multiplayer Goose Toss, King of the Hill and Goose Horde.
- No ambient goose flock and no bonus golden goose on the Facility (Goose Toss's pickups are the
  one exception, section 12).
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
  Facility; F toggles it with a click. Since v4.4.0 it also works on the Valley at night and in fog (docs/night-and-visibility.md).
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

## 11. Shooting out lights (Gustav, 2026-10-24)

Any lamp (ceiling panel or emergency lamp) can be shot out, so a room can be made almost completely
dark and players then rely on their torches.

- **Hit test:** lamps are not physics colliders. Every hitscan ray a player fires (each pellet;
  enemy shots never break lamps) is also tested against the live lamps' boxes
  (slab test, slightly enlarged to 1.0 x 0.2 x 0.4 m so they are fair to hit). A lamp closer than
  the physics hit is destroyed; the ray still continues to its physics hit as before.
- **Light:** the lamp's light is removed from the bake. FacilityWorld keeps the vertex positions and
  normals, and `killLamp(index)` re-runs the direct, fill and AO terms only for vertices within the
  lamp radius (14 m) of it, with every dead lamp excluded, and rewrites that part of the
  `bakedLight` attribute (`addUpdateRange` + `needsUpdate`). Probes within the radius are recomputed
  too, so the hemisphere light on players and enemies goes dark with the room. Budget: under 25 ms.
- **Visuals and sound:** the panel instance turns black (no emissive), its light shaft disappears, a
  short spark burst and a few glass shards fall from it, and a glass-break plus electrical fizz
  sound plays at its position.
- **Multiplayer:** a new relayed message `lampDestroyed { senderSlot, lamp }` (lamp index, the
  layout's lamp order is identical on every client). Receiving one for a live lamp kills it the
  same way. The welcome's `activeMatch` gains optional `deadLamps?: number[]` so a late joiner
  sees the same dark rooms. Older builds ignore the unknown message.
- **Resets:** a single-player Restart relights every lamp. A rematch builds a new facility anyway.
- **Debug API:** `getFacilityDebug()` gains `deadLamps: number` and a test-only
  `shootLamp(index)`; plus `lampPosition(index)` so an e2e test can aim at one.

## 12. Doors and breaker switches

`facilityDoors.ts` merges adjacent doorway cells with the same axis, room and side into one
opening. A seeded draw (`FACILITY_DOOR_SEED_OFFSET = 613`) gives each eligible opening a door
with `FACILITY_DOOR_CHANCE = 0.6`; eligible openings into dark rooms always get doors and start
closed. Other doors start open. `FACILITY_DOOR_MAX_CELLS = 3`: openings wider than 3 cells
(4.5 m) get no door, so a dark room with one is not sealed.

`FacilityObjects.ts` builds two painted steel sliding leaves, a hazard stripe and red closed or
green open status lamps. Leaves are 6 cm thick and sit 4 cm toward the corridor so they slide
inside the wall mass. `FACILITY_DOOR_SLIDE_SECONDS = 0.6`; colliders change immediately with
state, independently of the visual slide. Closed doors block players, bullets, grenades and
enemy sight. Doors refuse to close on a player. Door changes do not recompute the light bake.

Look at a door or breaker within `FACILITY_INTERACT_REACH = 2.2` m and press interact (E or pad B)
to toggle it. A nearer physics hit blocks the prompt, with 0.2 m tolerance for a door's own
collider. `facilityInteraction.ts` owns prompts, authority, positional slide and breaker sounds,
and the enemy gate. The cost-ordered flow field treats closed door crossings as passable with
`FACILITY_DOOR_NAV_COST = 4` extra steps: short detours win, long ones lead through the door.
Enemies stop within a 1.6 m lookahead, wait `FACILITY_ENEMY_DOOR_WAIT = 0.8` seconds at the same
door, then open it. They never close doors.

`facilityPower.ts` groups rooms by position into 4 to 6 seeded zones, using farthest-point room
seeds and nearest-seed membership. Corridor lamps join the nearest room's zone. Each zone has
one panel on a perimeter wall beside walkable floor inside a room, never in the atrium (room 0).
Its floor cell stays at least 3 cells (Chebyshev distance) from every doorway. The panel centre
is 1.45 m high, stands 0.06 m off the wall and has a lever and red or green status lamp. A zone
without panel space joins its nearest neighbour. All breakers start on.

Switching off darkens that zone's panel lamps; emergency lamps stay lit on battery. Switching on
relights every lamp that was not shot out. `FacilityWorld` tracks shot-out and unpowered lamps
separately. Visuals change immediately; the rebake queue recomputes light from the current union
of dark lamps, one queued lamp per update, for both cuts and relights. `flushLampRebakes()` drains
the queue for tests. The final vertex light, direct light, fill and probe arrays are independent
of the order of power changes and lamp shots. Restart restores lamps, initial doors and breakers.

The minimap draws closed doors as short bars. A panel shows on the minimap once its room is
entered. Multiplayer is host-authoritative: guests send `worldInteract { kind, id }`, where kind
is `door` or `breaker` and id is a non-negative integer. The host validates the object and guest
reach (2.2 m plus 1.5 m latency slack), applies the change and broadcasts `worldObjectState`.
`facilityObjectState.ts` encodes `doors` and `breakers` as bit strings in id order: 1 means open
or on. Network validation limits each string to 4096 binary characters; layout parsing requires
the exact expected counts. Welcome and first-snapshot resync carry the full state for late joiners.

Debug hooks: `facilityDoor`, `setFacilityDoor`, `facilityBreaker`, `setFacilityBreaker`,
`facilityLookTarget` and the door and breaker counts in `getFacilityDebug()`. Debug setters use
the interaction rules, including refusing to close on players.

## 13. Modes on the Facility (v4.4.0, docs/squad-arsenal-night.md section 7)

Every mode now runs on the Facility; the map gates in `core/gameModes.ts` and the "Valley only"
notes in Create Room, the match end screen's Rematch picker and the single-player setup are gone.
Where things go is decided in `src/world/facility/facilityModes.ts` (pure, unit-tested), which the
entity managers reach through two small adapters, so the Valley code paths are unchanged.

- **Goose Toss.** `GooseManager` takes an optional `GoosePlacement` (`facilityGoosePlacement`):
  the opening batch, the constant supply and the goose a death spawns all land on cell centres
  walkable with 0.6 m clearance (clear of walls, pillars and crates), the supply anywhere in the
  facility, a death's goose 10 to 20 m from the victim. A wandering goose only takes a destination
  in clear straight line (`segmentClear`, 0.45 m), so it never presses into a wall. The opening
  batch runs on the Facility for Goose Toss only; the bonus golden goose stays off. A thrown goose
  bursts on the first wall cell, crate or ceiling it meets (`facilityBlocksThrow`), not only on the
  floor.
- **King of the Hill.** The golden goose starts at the atrium centre (0, 0), on the floor (the
  height override already makes `sampleHeight` 0), so nothing changed there. While it lies free it
  is a cyan diamond on the Facility map (`KingOfTheHillController.minimapMarkers`).
- **Goose Horde and Horde.** `HordeGooseManager` takes an optional `HordeIndoorSite`
  (`facilityHordeSite`). Each goose comes in at a room floor cell (corridors left out) outside every
  live player's room and at least 18 m from each player, preferably within 40 m of the nearest so a
  wave arrives in seconds; with no such cell, the one farthest from its nearest player. Walkers and
  jumpers chase through the doors with the enemies' navigator (`resolveMoveTarget`, section 3; a
  no-op on the Valley). Flyers never drop from the sky indoors: they spawn at their flight height
  and fly the same waypoints at 2.6 m, clamped to the local ceiling minus 0.6 m (a corridor's 3.2 m
  allows exactly 2.6), diving onto the target over the last 5 m. A guest's mirror flyers start at
  the same height. Single-player Horde starts at the layout's start like Elimination.
- **Mission.** `facilityMissionObjectives(layout, start)` picks four rooms, one per quadrant around
  the atrium where it can, never the atrium or the start's room, each at least 16 m from the
  start; the largest room wins in a quadrant (room for the console and the extraction ring), a
  short quadrant is filled from the others, farthest first. Each point is the clear floor nearest
  its room's centre. `MissionState` is unchanged: the three nearest the start are the uplinks, the
  farthest the extraction. Each point gets a console (`facility/facilityConsoles.ts`: a steel
  cabinet with a lit screen and a beacon cap, solid to walk into) and its beam is a slim shaft from
  the cap to the ceiling (`UplinkBeacons`' indoor site). All of it is emissive or unlit: no light is
  added, because the Facility's materials compile for a fixed number of lights. World markers sit
  1 m over the cap; the uplinks not yet online and the open extraction are diamonds on the map
  (`missionMapMarkers`).
- **Minimap.** `Minimap.setMarkers` draws a mode's objectives as cyan diamonds, held at the rim
  when out of range like the other dots.
- **Debug API:** `getHordeDebug()` returns the current wave and every live horde goose.
- **Tests:** `facilityModes.test.ts`, `missionState.test.ts` (markers); e2e
  `e2e/facility-modes.spec.ts` (group `facility`): solo Horde starts wave 1 with geese inside the
  bounds and under the ceiling, solo Mission shows four objectives inside the bounds and marks the
  uplinks on the map.
- **Known limits:** the mission's radii are the Valley's (start 9 m, hold 14 m, extraction 6 m), so
  an upload can be started or held from just behind a room's wall, and the extraction ring can
  cross a small room's walls. Multiplayer Goose Toss, King of the Hill and Goose Horde on the
  Facility have no e2e test of their own.
