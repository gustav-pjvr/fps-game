# World redesign (v4.1)

Record of the houses, towers and terrain pass Gustav asked for on 2026-10-24, after v4.0.0: "go onto the redesign tasks. Houses, towers and also look at better terrain look, generation etc and implement", making the decisions without him, with simpler UI copy in the same release. The direction was set on 2026-10-23 (docs/visual-overhaul.md, Decisions): houses and towers in the Opus 5.5 station style, exteriors first with enterable rooms later, and the tower stairs rebuilt.

## Decisions

- **Built in code, not models.** Towers and houses are procedural (`world/towerDesign.ts`, `world/houseDesigns.ts`) on a shared kit (`world/structureKit.ts`) and procedural PBR materials (`world/structureMaterials.ts`: concrete panels, steel grating, perforated steel, corrugated roofing, ribbed sage cladding, steel, hazard stripes), in the language of the Opus weapons. The Kenney building GLBs are gone.
- **One description, two uses.** Every solid part of a structure is one box (or a convex gable) built as both its collider and its mesh, so walls, rails and roofs stop players and shots exactly where they are drawn. Detail nobody can touch (treads, stringers, braces, frames, lamps, masts) is drawn only. Each structure merges into one mesh per material: a tower is 10 draw calls.
- **Rails run along local X (v4.6.1).** `addRailing` (`structureKit.ts`) draws a rail's panel, cap and
  posts along the box's local X. A rail built with `box(...)` whose long side is Z drew as a stub while
  its collider kept full length, which left seven invisible walls on every tower until v4.6.1. Tower
  rails now come from `railBox` (`towerDesign.ts`), which builds Z-running rails with `boxAlong`; the
  houses already did the same (`rail` in `houseDesigns.ts`). `towerDesign.test.ts` checks every rail.
- **Footprints kept.** The houses keep the Kenney footprints (3.83 x 7.0, 3.58 x 7.22 and 6.56 x 7.22 m), so town layouts, AI cover points and spawn checks see the same rectangles. The tower keeps its 6 m core, 2.4 m stairs and footprint radius, so placement, terrain clearing and the AI's tower cover radius are unchanged.
- **Exteriors only.** No interiors yet; that is the next phase and changes AI and gameplay.
- **Terrain stays a heightfield with one photo texture.** The look comes from a shader that reads the texture as several surfaces, not from new texture downloads.

## Towers

A concrete core with lit slit windows and a hazard band, five steel flights with real treads wrapping it, a grated deck over the whole tower with a stairwell, and a roofed lookout on four posts with a mast and a red aviation light. The Uplink beams now rise from the roof around the mast, and the mission marker sits above the roof.

The stairs were the brief's main complaint. Two faults in the old geometry, both found by `towerDesign.test.ts`, which climbs the tower with Player.ts's own capsule and controller settings:
- **Landings stood half a metre proud.** Every ramp ran to its corner's centre and the landing sat on top, so each landing's edge was 0.5 m above the arriving ramp, exactly the autostep limit. The flights now run edge to edge between flat corner landings, flush. A face is only 6 m between landings, so four flights would have been 34 degrees, next to the 35 degree slide angle; five flights (one and a quarter turns) give 28.
- **Flights along Z leaned sideways.** `boxAlong` (the old `createRampCollider`) turned +X onto the slope with the shortest-arc rotation, which also rolls the box for any slope running along Z: two of the four flights leaned into the core and wedged a climbing player against it. The rotation is now built from a level basis (`structureKit.test.ts`).
- The old deck ended inside the stair lanes, so the last flight ran into its underside; it was then swung 15 degrees off the wall, which read as broken. The deck now covers the whole tower and the last flight climbs through a stairwell with a guard rail.

Spacing: twice the footprint kept towers from touching but stood two of them 16 m apart, which read as one twin structure. Placement now looks for 22 m first and settles for the old bound only when towns and forests leave no room (met in about 89% of 300 seeds; the ring towers can stand on is only about 12 m deep, and 28 m pushed towers into forest cores).

## Houses

Three prefab outpost designs, each with a concrete plinth or ground floor, ribbed sage cladding, corrugated roofs, steel corner trim, mullioned windows (about half lit, a fixed pattern per window so every client agrees), a steel door with an awning and a warm lamp:
- **Bunkhouse** (Kenney A): one storey under a single-pitch roof, an air handler and a vent stack.
- **Block** (Kenney B): concrete ground floor, clad upper floor, flat roof behind a parapet with a water tank.
- **Workshop** (Kenney C): a wide hall under a corrugated gable with a ridge cap, a roller door in a hazard frame, high windows, a roof vent and a generator.

`houseDesigns.test.ts` checks the footprints, that every solid stays inside its footprint and stands on the ground, and that shots at chest height and under the eaves hit the house from every side.

## Terrain

Generation (`TerrainGenerator.ts`, measured over seven seeds by `TerrainGenerator.test.ts`):
- **Landforms.** Broad rises and basins about 125 m across (5 m), a domain warp that bends the hills into spurs, and ridgelines from ridged noise in masked areas (3 m), on hills lowered from 8 to 6 m with a smoother top octave (persistence 0.42).
- **Walkable everywhere.** Before: a median slope of about 12 degrees, a tenth of the ground past 29, and walls up to 75 degrees. After: median under 10, 90% under 26, nothing over 45 (the climb limit).
- **Flattening without walls.** The spawn clearing, town pads and tower clearings now blend in one order-free pass: toward the weighted mean of their target heights, weighted by w / (1 - w), by the union of their weights. A core at full weight wins outright (dead flat), and the ground between two of them eases from one height to the other. The old code took only the nearest site, so overlapping clearings jumped from one height to the other halfway between them (68 degrees between two close towers).
- **Pads sit in their ground.** A pad, the spawn clearing or a tower clearing flattens to the natural ground averaged over its centre and a ring around it, not the height at its centre alone, which sank clearings 9 m into pits. Town pads ease back over 14 m past the town's edge (was under 2.5 m inside it), tower clearings over 8 m (was 4). Towns whose zones overlap share one height. A tower in a town's skirt flattens to the ground as the town has shaped it.
- **Fixes found on the way.** A density-rolled town could be jittered inside the spawn ring and cover the spawn point itself (seed 222); such sites are now rejected, for towns and forests alike. `sampleHeight` now clears its per-seed caches before reading them (the first sample after a seed change used the previous world's pad height).

Look (`terrainSplat.ts`, replacing the 'ground' grade): the one Poly Haven texture is split by how green each texel is into grass and soil, tinted from the dusk palette; sampled in world space at two scales and rotations to break the 10 m tile; large lush and dry patches; grass thinning on slopes from about 23 degrees and rock, sampled side-on, from about 26; packed gravel on town pads and tower aprons (a per-vertex `surface` attribute from `TerrainGenerator.groundWear`). Olive tints read brown under the warm sun and grade, so the grass colours are cooler and greener than the palette's foliage tokens.

## UI copy

Labels lose their colons and questions ("Kills to win", "Mode", "Weather", "Name", "Room code"), status lines are short ("Waiting for players…", "Everyone is connected. Start when ready.", "Connected. Waiting for the host…"), errors say what to do ("Couldn't join. Try again."), the mode briefings are one short sentence per step, "Reset Play" is "Restart", and two em dashes in the UI are gone. The match setup's mode options no longer each say they ignore the counts: ticking one disables the enemy and target counts instead.

## Build log

- 2026-10-24: structure materials and the world-scaled box (Codex job `structure-materials`), the kit, towers, houses, terrain generation and look, tower spacing (`a4e794a`, main thread), UI copy (Codex job `ui-copy`).
- Costs on this machine (SwiftShader): the structure materials build once in about 380 ms at startup, a tower in 10 ms (about 3,400 triangles, 10 draw calls), a house template in 6 ms.
