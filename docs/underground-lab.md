# Underground lab under the watch towers (design, proposed for v4.7.0)

Status: design approved by Gustav, 2026-11-05 (decisions in section 8). Building in phases.

Gustav's brief: the door on each tower's core becomes a real door into an extremely simple, old
looking room. From it, dark stairs go down about three flights, extending the map downwards, and
arrive in an underground testing facility with nuclear reactors and dodgy creatures in tanks or on
test tables. Design carefully first, and make sure building down works with the map systems,
because towers stand close together and the underground parts must never overlap.

## 1. What the player gets

1. **The door.** The steel plate on the tower core's east face (today a painted-on decoration, see
   `addCoreDetail` in `world/towerDesign.ts`) becomes a working sliding door, the same door the
   houses use (`SlidingDoorView`), synced in multiplayer, opened with E.
2. **The old room.** The bottom 3 m of the core is hollow: a 5.4 m square concrete room, stained
   and cracked, one caged bulb that flickers, a fallen shelf, a crate, a rusted "B3" sign, and a
   square hole in the floor with a bent guard rail round it.
3. **The dark stairs.** Three flights down, in a concrete stairwell lit only by two dead-looking
   caged lamps (dim emissive, no real light): the torch is the light here. About 9 m deep.
4. **The lab.** A short corridor with a blast door frame (always open), then:
   - **Reactor hall** (about 14 by 10 m, 6 m high): two reactor vessels with glowing cores, pipe runs,
     hazard floor bands, a catwalk along one wall.
   - **Test wing** (about 10 by 8 m): a row of tall glass tanks with green liquid and creatures
     floating in them (built from primitives, slowly bobbing), one cracked and empty tank with
     liquid on the floor, and an operating table with a strapped-down creature under a lamp.
   - **Control room** (about 6 by 5 m): consoles with glowing screens, a window onto the reactor
     hall.
   - Two or three pickups per lab (health, ammo, grenade): a reason to go down.

Every tower gets its own lab: the same plan, with seeded variety (which tanks are cracked, which
creature is on the table, which way the lab extends).

## 2. The core problem: going below the terrain

The Valley ground is one height surface per chunk, as both a Rapier heightfield collider and a mesh
(`world/Chunk.ts`). Neither can have holes, and 40 source files treat that surface as the lowest
floor (the survey is summarised in section 7). The design keeps the terrain exactly as it is and
adds three narrow exceptions inside each tower's core.

### 2.1 Terrain cut zones

A **cut zone** is a tower core's interior square (local x, z in [-2.7, 2.7]), one per tower. The
new module `world/underground.ts` owns the list and answers `inCutZone(x, z)`.

- **Walking.** `Player` passes a filter predicate to `computeColliderMovement` (Rapier supports one)
  that ignores terrain colliders while the player's capsule centre is inside a cut zone. Terrain
  colliders are registered with a terrain tag so the predicate can recognise them. Outside a cut
  zone nothing changes. Underground, outside the zones, the player is fully below the terrain
  surface and never touches it, because every underground ceiling stays at least 0.5 m below it
  (section 3).
- **Seeing.** The terrain material (`terrainSplat.ts` already patches its shader) discards
  fragments inside the cut zones, passed as a small uniform array (four towers). From the room you
  look down the stairwell instead of at the ground.
- **Shots and throws.** `castHitscan` (`combat/hitscan.ts`), the grenade rays in `GrenadeSystem.ts`
  and `ThrownGoose.ts` (the only physics ray callers) skip a terrain hit that lies inside a cut zone
  and continue the ray beyond it, through one helper in `underground.ts`. So you can shoot or throw
  down the stairwell.

### 2.2 One floor function

`underground.ts` also answers `floorBelow(x, y, z)`: the underground floor under that point when
it is inside an underground volume, else `sampleHeight(x, z)`. The systems the survey found that
would misbehave underground switch to it:

| System | Today | With `floorBelow` |
|---|---|---|
| Grenade flight floor (`Game.ts` grenade setup, `grenadeFlight.ts`, `GrenadeSystem.findSurface`) | Snapped up to the surface | Bounces on the lab floor |
| Thrown goose detonation (`Game.updateThrownGeese`) | Bursts at once underground | Bursts on the lab floor |
| Ammo drop crates (`AmmoDropManager`) | Spawn on the surface above you | Spawn at your level |
| Darkness for enemy perception (`playerVisibility`, `ValleyHouses.roomLampLitAt`) | Counts as outdoors | Counts as dark, like an unlit room |

Systems that should stay on the surface on purpose: spawns and respawns, the opening encounter,
director waves, wandering and horde geese, the golden goose, mission markers. Enemies do not go
underground in this version (section 5).

## 3. Layout and the overlap solver

### 3.1 Fixed parts (tower frame, ground at y = 0, door on the east face)

```
      north (+z)
   +-----------------+
   |  ROOM 5.4 x 5.4 |      core 6 x 6; walls 0.3 thick; room 3 m high,
   |  [D1]           |      solid core above
   |  [D1]       DOOR|===>  east face, under the second outside flight
   |  [D1]           |
   +--[D1]-----------+
      [D1]  first flight leaves the core underground, about 2.8 m down
   +-----------------+
   |  STAIRWELL      |      6 x 6.5 m concrete box under the tower's apron,
   |  D2 / D3        |      top at -0.6, two switchback flights to about -9
   +--------+--------+
            |  corridor 2.4 m wide, 3 m high
            v
       [ LAB COMPLEX ]  reactor hall, test wing, control room, floor about -9
```

- **D1** runs along a core wall that never holds the door, about 30 degrees, 2.8 m down, and passes
  under the core wall into the stairwell box. The cut zone covers only D1's part inside the core.
- **D2 and D3** are switchback ramps (the towers' ramp-under-treads construction, which the
  character controller already climbs; `towerDesign.test.ts` proves it), 28 to 32 degrees,
  each about 3 m. If a site needs a deeper lab (3.3), extra flights are added, up to five in all.
- Every walkable ramp, landing and floor is a box collider and the same box is drawn (the
  structures' existing "one description, two uses" rule, with the v4.6.1 rail lesson: rails run
  along local X).

### 3.2 Orientation and depth, solved per seed

The stairwell box and the lab beyond it can sit south, west or north of the core (never east,
where the door is). A pure function `computeTowerLabs()` (memoised per seed, like
`getWatchTowerPositions`) picks, for each tower in index order:

1. Orientation: try the three in order of distance from the nearest other tower (farthest first).
2. Depth: the shallowest lab (three flights, floor at about -9) whose every ceiling is at least
   1 m below the lowest terrain over its footprint, sampled on a 1 m grid inflated by 1 m (towns'
   flat pads and basins are thereby covered, since `sampleHeight` includes them). Add flights up
   to five if needed.
3. Clearance: its footprint (stairwell, corridor and lab, as rotated rectangles) is at least 4 m from
   every lab already placed, horizontally, or at least 8 m apart vertically.
4. Bounds: inside `WORLD_EDGE_RAMP_START`.
5. Fallback, if no orientation passes: a compact lab (stairwell plus the test wing only). If even that
   fails, the tower keeps its room and stairs down to a sealed, flooded landing (a dead end that
   still reads as a place). The seed-sweep test reports how often each fallback happens; the target
   is the full lab in at least 95 percent of towers.

Tower placement does not change, so every existing map keeps its towers where they are.

### 3.3 Other things in the ground

- **Tree trunks.** Trunk colliders start at the surface; the build checks whether any extend below
  ground and clips them over lab footprints if they do.
- **Houses and roads.** These sit on the surface with no basements, so the 1 m cover rule keeps
  them apart from the labs.
- **Chunk streaming.** A lab is built and removed with its tower (`WatchTowerManager.createTower`).
  The view radius (two chunks) always keeps the tower's chunk loaded while a player is in its lab.

## 4. Light and sound

- **Underground look.** A per-frame `undergroundAmount` (0 outdoors, 1 in the room, the stairs or
  the lab, eased over half a second) fades the sun, the hemisphere fill and the environment light
  down and pulls the fog in, the way the Facility damps its fill (`Game.updateFacilityLight`).
  Without this the sun would light the lab on Low graphics, which has no shadows. Only intensities
  change, so no shader recompiles.
- **Lab lights.** A pool of three point lights, created at match start on every Valley match (the
  fixed-light-count rule), follows the lab lamps nearest the camera, like `HouseLights`. Reactors,
  tanks and screens glow (emissive plus bloom). The stairwell stays dark on purpose.
- **Torch.** It has to work underground in every weather: on the Valley the torch exists in every
  match. At Dusk it can only be switched on below ground, and it switches off when you come up.
- **Draw cost.** A lab's meshes draw only when the camera is in that tower's room or underground near
  it. Its colliders are always there (static, cheap). Target: no frame-time change outdoors;
  measured inside the lab on Medium.
- **Sound.** Outdoor ambience fades underground and the reverb grows. A low reactor hum rises near
  the reactors. Shots and blasts between the surface and underground are muffled.

## 5. Rules per mode

- **Solo enemies stay on the surface (this version).** They never open tower doors; the core is
  already an obstacle in their cover and steering registries. They search up to the door and wait
  there. While every player is underground the Director holds its relax phase and sends no waves,
  so the lab is a breather, not a farm. The creatures in the tanks are scenery; a later version
  could let them break out.
- **King of the Hill:** the carrier scores nothing while underground.
- **Uplink mission:** holding an uplink and the extraction ring require being on the surface.
- **Goose Horde:** geese stay on the surface and gather over the tower; a wave cannot be cleared from
  below.
- **Multiplayer:** the underground is open in every mode. Door state is host-authoritative through
  the existing `worldInteract` and `worldObjectState` messages, with tower door ids in their own range
  next to the house ids (`valleyHouseIds.ts`), validated in `protocol.ts` and sent to late joiners.
  Remote players' y already crosses the wire (coordinates are bounded at 10,000 m). The minimap
  draws a player who is underground as a hollow dot.

## 6. Build plan

| Phase | Contents | Who |
|---|---|---|
| A. Foundation | `underground.ts` (cut zones, ray helper, `floorBelow`); terrain tag, player predicate, terrain shader discard; hollow core, room, door and its sync; D1 to D3 and the stairwell; the `computeTowerLabs` solver with a placeholder lab box; underground look; torch rule; the `floorBelow` switches of 2.2 | Codex on gpt-6-astra (high) from this design, in two or three jobs; independent Opus audit plus a re-check (physics, network ids and rendering are cross-cutting) |
| B. The lab | Reactor hall, test wing with tanks and creatures, control room, props, light pool, hum, lab pickups (seeded ids, host-authoritative) | Codex from a written art brief; I judge it from real-GPU screenshots and tune |
| C. Rules and polish | Mode rules of section 5, Director hold, minimap dot, sound muffling, docs, release v4.7.0 | Codex or Sonnet; review |

## 7. Tests

- **Seed sweep (unit, 500 seeds):** every lab under at least 1 m of cover; no two labs closer than
  the clearance; inside the world; at most five flights; D1 never crosses the door; fallback rates
  reported.
- **Walk test (unit, real Rapier):** a walker with the player's controller settings goes from the door
  down to the lab floor and back up, through the cut zone, on every orientation. This is the same
  approach as the tower climb test.
- **Rays (unit):** a ray down the stairwell passes the terrain; one outside the zone hits it.
- **Floors (unit):** grenades, thrown geese and ammo crates behave underground; underground visibility
  counts as dark.
- **Network (unit):** tower door ids accepted and range-checked, synced to a late joiner; King of the
  Hill and mission rules underground.
- **Browser:** a new `underground.spec.ts` in the world group (open the door, walk down, check depth,
  torch and lighting) and a two-player door sync check in the mp group. Both run alone, plus the
  groups the changed files map to.
- **Real GPU:** screenshots of the room, stairs and lab on Medium and Low for Gustav before release.

## 8. Decisions (Gustav, 2026-11-05)

1. Enemies stay above in this version: they wait at the door and the Director pauses while every
   player is down. Breakout creatures are a possible later feature.
2. A full lab under every tower, the same plan with seeded variety.
3. Mode rules as in section 5: no King of the Hill points underground; uplinks and extraction only
   count on the surface.
