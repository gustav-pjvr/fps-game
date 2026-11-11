# Underground lab under the watch towers (v4.7.0: design, then as built)

Status: Built, release v4.7.0. The design below was approved by Gustav on 2026-11-05 (decisions in
section 8) and is kept as written. Section 9 records what shipped, file by file, and where it differs
from the design. Where the two disagree, section 9 and the code are right.

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

## 9. As built (v4.7.0)

The branch is `feature/underground-lab`, built in phases A1 to A3 (cut zones, tower room and door, light),
B (lab interior), C1 to C3 (rules, sound, minimap, browser specs) and two audit fix rounds. Every row
below names its file. Architecture notes for each area are in `docs/architecture/world-and-combat.md`
(section 1.7), `core.md` and `multiplayer-and-modes.md`.

### 9.1 What shipped, file by file

| File | What it does |
|---|---|
| `src/world/underground.ts` | The module state and its queries. Up to four terrain cut zones (`setCutZones` throws on a fifth), the set of terrain collider handles, the registered underground volumes. `inCutZone(x, z, margin)`, `isUnderground`, `isBelowGround`, `inUndergroundVolume`, `pointInUndergroundVolume`, `floorBelow(world, x, y, z)`, `castRaySkippingCuts` (skips a terrain hit inside a cut zone, up to three times per ray), the shared `cutZoneUniforms`, and `clearUnderground()` for `Game.create` and `Game.dispose` |
| `src/world/towerUnderground.ts` | `buildTowerLab(index, position, orientation, flights, kind)` builds one lab as boxes in the tower's frame (parts, walk route, volumes, footprints, lamps). `computeTowerLabs()` is the memoised per-seed solver. Also `towerDoorPlane(id)`, `labsClear`, `labInsideWorld`, `lowestCoverHeight` |
| `src/world/labInterior.ts` | `buildLabInterior(kind, seed)`: a pure description of the furnished rooms for the kinds `full`, `compact` and `ground` (the old room). `LAB_INTERIOR_SEED_OFFSET` is 719. `createLabInteriorVisual` draws all of it as one mesh per material (14 materials), with the bobbing specimens and the pulsing reactor cores and bulb |
| `src/world/undergroundLights.ts` | The look: `undergroundLightTarget`, `easeUndergroundAmount`, `undergroundLook`, `UNDERGROUND_FOG_COLOR`. Culling: `undergroundVisible`. The fixed pool of three lab lights: `UndergroundLights` |
| `src/world/towerDesign.ts` | `towerParts(orientation)` now has the hollow ground room (solid core from 3 m up, four 0.3 m walls, a doorway in the east wall, floor slabs round the stair hole). `TowerOrientation`, `towerRotation`, `towerStairLane`. The painted steel plate on the east face is gone (the real door replaces it) and the contact shadow has a square hole over the core |
| `src/world/WatchTowerManager.ts` | The constructor sets the cut zones and registers every lab volume once (they outlive chunk streaming). `createTower` adds the lab colliders next to the tower's, builds the hidden `tower-underground` group and registers the door. `getUndergroundTowers` and `getUndergroundLamps` feed `Game` without allocating each frame |
| `src/world/houses/valleyHouseIds.ts`, `src/world/houses/ValleyDoors.ts` | Tower door ids and the door itself (section 9.3) |
| `src/core/facilityInteraction.ts` | `enemyGate` holds an enemy at a tower door without ever opening it |
| `src/world/Chunk.ts`, `src/world/terrainSplat.ts` | Each chunk's heightfield collider is registered as terrain; the terrain shader discards fragments inside the cut zones |
| `src/entities/Player.ts` | Inside a cut zone the character controller's filter predicate ignores terrain colliders |
| `src/combat/hitscan.ts`, `src/combat/grenades/GrenadeSystem.ts`, `grenadeFlight.ts`, `src/entities/ThrownGoose.ts` | Rays and shape casts look past a terrain hit inside a cut zone; the grenade floor callback is `(x, y, z)` |
| `src/entities/AmmoDropManager.ts`, `src/entities/enemies/playerVisibility.ts` | Ammo crates for an underground player land inside the player's volume; underground counts as an unlit room |
| `src/render/Flashlight.ts` | The torch rules (section 9.4) |
| `src/core/Game.ts` | `updateUndergroundLight` each render, the torch gate, fall recovery, the Director, mission, minimap and ambience inputs, the match start precompile, `clearUnderground` in create and dispose, the debug hooks |
| `src/core/valleyFallRecovery.ts` | The pure fall check (section 9.5) |
| `src/core/mission/missionState.ts`, `src/core/modeControllers/KingOfTheHillController.ts`, `src/entities/enemies/director/pacingDirector.ts` | Mode rules (section 9.6) |
| `src/pickups/valleyPickupInputs.ts`, `pickupPlacement.ts`, `pickupConfig.ts`, `PickupSystem.ts`, `createMatchPickups.ts` | Lab pickup sites and the height checked claim (section 9.7) |
| `src/audio/ambience.ts`, `src/audio/SoundEngine.ts`, `src/world/soundProbe.ts` | Reactor hum, darker echo, and the muffle across the surface boundary (section 9.8; since the sound rebuild the ground occludes like any wall, `docs/sound.md`) |
| `src/ui/minimap.ts` | A player who is below ground is a hollow ring (section 9.8) |
| `src/core/gameDebugApi.ts` | `getUndergroundDebug()` and `setTowerDoor(index, open)` for the specs |
| `e2e/underground.spec.ts`, `e2e/multiplayer-underground.spec.ts`, `scripts/e2eGroups.mjs` | Browser specs, in the `world` and `mp` groups (`docs/testing.md`) |
| `src/world/underground.test.ts`, `towerUnderground.test.ts`, `labInterior.test.ts`, `undergroundLights.test.ts`, `src/core/valleyFallRecovery.test.ts`, and additions to the tests beside the files above | The unit tests of section 7, plus the walk, enclosure and door tests |

### 9.2 Where it differs from the design above

- **Two predicates, not one.** `isUnderground(x, y, z)` is true inside any registered volume (the
  ground room's column included) or inside a cut zone below 3.2 m over the terrain. It drives light,
  the torch and `floorBelow`. `isBelowGround(x, y, z)` is stricter: a volume at least 1 m below its
  tower's ground level (`registerUndergroundVolume` stores `groundY`). It drives every rule and sound
  (King of the Hill, the mission, the Director, enemy perception, the minimap, the muffle, the
  ambience, ammo crate placement). So the daylit ground room never counts as "down" for a rule.
- **The room is half dark.** `undergroundLightTarget` is 1 below ground, 0.6 in the ground room and
  the first part of the first flight, 0 outdoors. The room keeps some outdoor fill; stairs and labs
  get the full buried look (sun, fill and environment scaled by `1 - 0.95 * amount`).
- **Fog is cold and close.** At full strength fog runs from 4 m to 40 m in
  `UNDERGROUND_FOG_COLOR` (0x0a1312, a cold near black), blended from the weather's haze colour.
- **Depth.** The first floor is 3.85 m under the tower's ground and each extra flight adds 3 m, so a
  three flight lab floor is 9.85 m down (not "about 9"), four flights 12.85 m, five 15.85 m. The
  solver tries 3, 4 then 5 flights. A lab is entered by a flight from the room (D1) that leaves the
  core's footprint along the stair lane, then switchbacks in a stairwell 9.6 m wide by 6 m deep.
- **Lab sizes.** The full lab is 26 by 18 m and 6 m high, the compact lab 10 by 8 m. A one metre
  entry corridor joins the stairwell to the lab.
- **The dead end is a sealed landing.** Kind `dead-end` has one flight and a walled landing with a low
  roof. There is no flooding.
- **Fallback rates.** The 500 seed sweep (`towerUnderground.test.ts`, 2000 towers) measured on
  2026-11-05: 1912 full labs (95.6 percent), 77 compact (3.85 percent, about 4), 11 dead ends
  (0.55 percent). The test fails below 95 percent full.
- **Director wait.** The Director holds only after every living player has been below ground for 3
  seconds in a row (`PacingDirector.undergroundSeconds`), so a quick dip does not pause it.
- **Pickup claims.** The host grants a claim within 4 m horizontally (`PICKUP_CLAIM_TOLERANCE`) and 3 m
  vertically of the pickup centre (the site's floor plus `PICKUP_HOVER_HEIGHT`), not 4 m flat.
- **Goose Horde needs no code of its own.** Geese follow the surface (`sampleHeight`) and chase the
  player's x and z, so they gather over the tower while players are down and a wave cannot be cleared
  from below; nothing in `HordeGooseManager` or `GooseManager` reads the underground state. Tree trunk clipping (section 3.3) was not needed: every lab keeps at least 1 m of
  cover under the lowest terrain over its footprint, and trunks start at the surface.
- **Outdoor ambience.** The design said "outdoor ambience fades". There is no separate outdoor bed to
  fade, so the engine raises the reverb send by up to 60 percent and closes its low-pass filter
  instead (section 9.8).

### 9.3 Tower doors

- **Ids.** `towerDoorId(index)` is `TOWER_DOOR_BASE + index`, where the base is 4096 * 4096 * 64 * 4 =
  2^32, above every house id. `towerIndexFromDoorId` returns the index for the four valid ids and null
  otherwise (`src/world/houses/valleyHouseIds.ts`).
- **Validation.** The wire carries the id in the existing `worldInteract` and `worldObjectState`
  messages. `protocol.ts` only checks a non-negative integer. The real check is
  `ValleyDoors.state.has`, which resolves a house id through its lookup and any other id through
  `towerDoorPlane`, and so accepts only the four tower doors. `parseWire` rejects a whole list that
  holds an id that is not a real door.
- **Late joiners.** The open state is in the host's `wire().valleyDoors` list, which the welcome
  message carries, and a door's state is kept while its tower is streamed out. `ValleyDoors.addTowerDoor`
  and `removeTowerDoor` keep a per-world registry, so the order in which the towers and the door
  manager are built does not matter.
- **Enemies.** `closedDoorAhead` reports a tower door even when it is open, and
  `FacilityInteraction.enemyGate` then returns true without starting the open timer. Enemies wait at
  the doorway and never open or pass it.

### 9.4 Light, torch and precompile

- **Torch.** `Flashlight.ts`: the Valley always creates a torch. `torchAvailable(map, weather,
  underground)` is true on the Facility, at Night and Fog, and at Dusk only where `isUnderground` is
  true. `Game` switches the torch off the moment it is not available and ignores the toggle there. It
  starts off at Dusk (`torchOnByDefault` is unchanged).
- **Dusk torch.** At Dusk the torch has no shadow (`torchCastsShadow` is false there) and no remote
  torch pool exists (`remoteTorchesAvailable` is false). A remote player's torch lens still shows
  when that player is underground (`MatchMessageRouter`), but it casts no beam on your screen.
- **Lights.** `UndergroundLights` creates three point lights (colour 0xffd49a, range 14, intensity 6
  when used) in the `Game` constructor on every Valley match. Each frame they move to the three lamps
  nearest the camera within 30 m, and park at intensity 0 when none is.
- **Culling.** A tower's `tower-underground` group is visible only within 45 m (horizontally) of the
  tower, and only when the fade amount is above 0 or the camera is within 8 m of the door.
- **Precompile.** At the end of `Game.create` every lab group is made visible, `renderer.webgl.compile`
  runs once, and the visibility is put back, so the first descent does not stall on shader compiles.

### 9.5 Falling out of the map

`valleyFallRecovery(position, terrainHeight, towers)` returns a safe spot when the local player is more
than 25 m below the nearest tower's lab floor, or more than 60 m below the terrain anywhere. The spot
is 4.5 m east of that tower's centre (the doorway face, clear of the door leaves) at the terrain
height plus 2 m. `Game.update` runs it every tick on the Valley, teleports the player, and in
multiplayer sends a `respawnEvent` so others see the move.

### 9.6 Mode rules as built

- **King of the Hill.** `KingOfTheHillController.update` adds no hold time while `isBelowGround`. The
  goose is still carried, and the timer carries on when the player comes up.
- **Uplink mission.** `MissionInput.underground` stops starting an uplink, stops the uplink hold
  timer, resets the extraction count (as stepping out of the ring does), hides the START or RESUME
  prompt, and shows the active uplink as paused (`MissionState.view(player, underground)`). The death
  screen passes `false`.
- **Director.** `DirectorSignals.allPlayersUnderground` comes from `Game.updateDirector`: living
  players only, and only if at least one is alive. After 3 seconds of it the Director switches to
  `relax` (an existing relax clock is kept), sends no waves and advances no phase clock. On the
  surface the relax clock runs again and the Director carries on from there.
- **Enemy perception.** `visibility()` treats an underground player as in an unlit room in every
  weather.

### 9.7 Lab pickups

A full lab has three pickup sites (health, ammo, grenade), a compact lab one (ammo), a dead end none
(`PICKUP_LAB_KINDS`). The sites are `LabInterior.pickupSites`, in the lab's frame, clear of every
interior solid. `gatherLabPickupSites` puts them in world space at the lab's floor height, and
`placeValleyPickups` appends them after the surface sites, so no surface id changes. A mode that does
not allow a kind drops those sites, and the lab ids stay contiguous. The host's claim check uses the
claimant's height too (`PickupSystem.handleMessage`), so a guest on the surface above a lab pickup
cannot take it. Solo walk-over keeps its 1.6 m vertical reach.

### 9.8 Sound and the minimap

- **Reverb.** `undergroundReverbScale(amount)` scales the reverb send by up to 1.6, and the reverb
  low-pass moves from 14,000 Hz to 1,800 Hz. `Game` reports an amount only while the player is below
  ground (the ground room stays outdoors for sound).
- **Reactor hum.** Two sine tones at 48 and 50 Hz plus low-passed noise, built on first need
  (`buildReactorHum`). `reactorHumGain(distance)` is full inside 4 m and fades smoothly to silence at
  22 m from the nearest reactor core of the lab the player is in. It follows the music volume setting.
- **Muffle.** Since the sound rebuild (`docs/sound.md`) there is no separate rule for the surface:
  every positioned sound asks what lies between it and the listener, and the ground is the
  heaviest thing there is (0.08 of the level, nothing above 380 Hz). A stair shaft's cut zone is
  open to sound the way it is open to shots. (Before, `undergroundMuffleFactor` scaled a fixed list
  of sounds by 0.35.)
- **Minimap.** `Minimap.update` takes `MinimapPlayerDot` entries (`x`, `z`, `underground`) and a
  `localUnderground` flag. Below ground a dot is a ring with the same colour and footprint
  (`minimapDotStyle`), and the local player gets a ring at the centre while the forward wedge stays,
  so facing is still readable.

### 9.9 Debug hooks and tests

- `window.__gameDebug.getUndergroundDebug()` returns `{ amount, underground, torchAvailable, labs }`,
  each lab with `index`, `kind`, `x`, `z`, `groundY`, `floorY`, `doorId` and `route` (floor points in
  world coordinates). `setTowerDoor(index, open)` asks for a tower door through the same rules as a key
  press. The specs teleport the capsule centre 1 m above a route point.
- Unit tests: the seed sweep, headroom, enclosure and walk tests are in
  `src/world/towerUnderground.test.ts`; rays, floors, ammo crates and visibility in
  `underground.test.ts`; interiors and furnished routes in `labInterior.test.ts`; look, pool and
  culling in `undergroundLights.test.ts`; claims in `PickupSystem.test.ts` and
  `pickupPlacement.test.ts`.
- Browser: `e2e/underground.spec.ts` (group `world`) and `e2e/multiplayer-underground.spec.ts` (group
  `mp`), described in `docs/testing.md`.
