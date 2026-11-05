# World, entities and combat (architecture, v4.5.0)

How the world, the entities and the combat work, and where to change things. Written from the
source on 2026-11-04 (version in `src/core/version.ts`). Every claim names its file. Line numbers are
left out on purpose, search for the names. The older notes in `docs/` are partly stale (see the last
section), so trust this page and the code over them. Depth lives in `docs/facility-map.md`,
`docs/enterable-buildings.md`, `docs/grenades.md`, `docs/pickups.md`, `docs/enemy-ai-v2.md`, `docs/multiplayer.md`.

## 0. The frame everything hangs on

- `src/core/Game.ts` owns a match. `Game.create()` builds the world, the managers and the HUD in a
  fixed order, then `new Game(...)` wires them. `dispose()` tears everything down.
- `src/core/Loop.ts` runs `Game.update(dt)` at a fixed 60 Hz (`FIXED_TIMESTEP` in `src/core/config.ts`)
  and `Game.render(alpha)` once per frame. Everything in this page that says "per tick" means `update`.
- Single-player and multiplayer share the same code. The multiplayer host (and single-player) is the
  authority for geese, doors, breakers, pickup claims and the match end. Every client is authoritative
  for its own health, its own grenades' damage and its own shots (see sections 3 and 5).
- Module-level switches: a Facility match sets `setHeightOverride` (`src/world/TerrainGenerator.ts`),
  `setEnemyNavigator`, `setEnemyDoorGate`, `setEnemyFloor` and `setEnemyEntrance`
  (`src/entities/enemies/enemyNavigator.ts`). `Game.create()` clears or sets all of them for the map it
  builds and `Game.dispose()` clears them. A new map type must do the same.

Order of `Game.update`, in short: gates (pause, death, match end; in multiplayer the world keeps
running while paused so pausing cannot dodge damage), opponents' `RemotePlayer.update`, doors and house
update, mode controllers, `player.update`, `weaponManager.update` (hitscan happens here), then
`physics.step`, `chunkManager.update`, `entityManager.update`, `updateDirector`, `updateMission`,
`gooseManager.update`, `updateThrownGeese`, `grenades.update`, horde and bonus managers,
`pickups.update`, effects, `updateMultiplayer`, death handling, HUD and sound. `Game.render` runs
`updateFacilityLight` (Facility) or `updateSunFollow` (Valley), `updateTorches`, `renderer.render()`.

## 1. Worlds

### 1.1 Picking a map and a weather

- `MatchMap = 'valley' | 'facility'` and `MatchWeather = 'day' | 'night' | 'fog'` are in
  `src/core/config.ts` (`MATCH_MAPS`, `MATCH_MAP_LABELS`, `DEFAULT_MATCH_MAP`). Single-player picks in
  `src/ui/menu/PlaySetupModal.ts`, the multiplayer host in `src/ui/menu/CreateRoomScreen.ts`. The choice
  rides `MatchConfig` (`Game.ts`) or the multiplayer session (`src/network/MultiplayerSession.ts`,
  `protocol.ts` match start and welcome messages), so late joiners get it too.
- `Game.create()` reads `multiplayer?.map ?? matchConfig.map` into `isFacility`. The Facility branch
  builds only the indoor world, the Valley branch builds vegetation, buildings, roads, towers and a
  `ChunkManager`. Nothing is shared between the two branches except physics, entities and the HUD.
- "day" is the stylised dusk. The id stays `'day'` for the protocol. Weather does not apply on the
  Facility, which uses `FACILITY_LOOK` (`src/render/look.ts`).
- Weather is fixed per match. There is no time-of-day cycle: `Renderer.setMatchWeather` applies one
  `LookPreset` from `LOOK_PRESETS` (sky, fog, sun, hemisphere fill, grade, bloom, window glow) once,
  before anything compiles. Dusk: sun 2.6, fog near 30 / far 640. Night: sun (moon) 0.55, fog 25 / 420.
  Fog: fog 2 / 95. The sky is `src/render/StylizedSky.ts`.
- The torch (`src/render/Flashlight.ts`): `torchAvailable(map, weather, underground)` is true on the
  Facility and at Night or Fog on the Valley, and at Dusk only where `isUnderground` is true (section
  1.7). `torchOnByDefault` is true on the Facility and at Night. Every Valley match builds the torch.
  At Dusk it casts no shadow (`torchCastsShadow`) and the match has no remote torch pool
  (`remoteTorchesAvailable`). Elsewhere other players' torches are a fixed pool of
  `MULTIPLAYER_MAX_PLAYERS - 1` spotlights (`RemoteTorches`).

### 1.2 World seed and determinism

- `src/core/worldSeed.ts`: `getWorldSeed()`, `randomizeWorldSeed()` (single-player, once per match, not
  per practice reset), `generateMultiplayerSeed()` (host) and `setWorldSeed()` (both sides). In
  multiplayer `Game.create()` calls `setWorldSeed(multiplayer.seed)`; a rematch can reuse the old seed
  (`settings.newMap` in `src/core/App.ts`).
- Every world system derives its randomness from the seed, so a seed is the whole map and only
  indices cross the wire: terrain, zones, towns, roads, houses, towers, vegetation, the Facility
  layout, doors, breakers, pickups, door and lamp ids.
- Helpers: `mulberry32` (`src/utils/rng.ts`), `hashChunkSeed` and `chunkKey` (`src/world/chunkSeed.ts`).
  Streaming systems seed per chunk or per town cell, so load order never changes the result.
- Seed offsets in use (a new seeded system must pick an unused one): terrain noises +0 to +3
  (`TerrainGenerator.ensureNoiseForCurrentSeed`), vegetation density +2 and forest texture +13
  (`VegetationManager`), flat zones +10, forest zones +11, towns +12, watch towers +13
  (`config.ts`), guaranteed zone sites +40 and +41 (`ZoneMap`), archetypes +101
  (`archetypes.ts`), enemy patrol +211, coordinator +401, tactics +431 (`EntityManager.ts`), goose patrol
  +311 (`GooseManager.ts`), Facility +307 (`FACILITY_SEED_OFFSET`), director +419 (`Game.ts`), Facility
  doors +613, Facility power +617, pickups +617 (`pickupConfig.ts`), lab interiors +719
  (`LAB_INTERIOR_SEED_OFFSET` in `labInterior.ts`, added to `seed + towerIndex * 1009`; the ground
  room uses the same stream). The tower lab solver draws no random numbers. 719 was the only offset
  added by the underground work. Spawn points picked by the host
  (`src/core/multiplayerSpawn.ts`) are not part of the seed.
- Not seeded: single-player spawn picks and the Facility start and encounter points (`Math.random`).

### 1.3 The Valley (`src/world`)

| Piece | File | What it does |
|---|---|---|
| World size | `config.ts` | `WORLD_SIZE_CHUNKS = 4`, `TERRAIN_CHUNK_SIZE = 100`: a 400 x 400 m square, `WORLD_BOUNDARY_RADIUS` 200 |
| Terrain height | `TerrainGenerator.ts` | `sampleBaseHeight` (fBm, ridges, warp, landform, edge mountain ring from `WORLD_EDGE_RAMP_START`), `sampleHeight` (base plus flattening for the spawn clearing, town pads and tower clearings, in one order-free blend), `groundWear`, `generateHeightfield` |
| Chunk streaming | `ChunkManager.ts`, `Chunk.ts` | Loads chunks within `VIEW_RADIUS_CHUNKS` (2) of the player, at most `MAX_CHUNK_GENERATIONS_PER_TICK` (2) per tick, unloads past `UNLOAD_RADIUS_CHUNKS` (3). Each chunk is a mesh plus a Rapier heightfield collider. `ChunkStreamHooks` (`onChunkLoaded`, `onChunkUnloaded`) hang vegetation, buildings, roads and towers off it |
| Ground look | `terrainSplat.ts`, `terrainShading.ts` | Grass, soil, rock and gravel from one texture, baked horizon AO in vertex colour |
| Zones | `ZoneMap.ts` | `sampleFlatZone` and `sampleForestZone` (organic 16-ray shapes), guaranteed sites (`GUARANTEED_ZONE_COUNT = 3`), `getFlatZoneSite`. Flat zones are where towns stand |
| Towns and houses | `BuildingManager.ts` | A town is a pure function of its flat-zone cell (`getTownLayout`, memoised): 8 to 20 buildings by rejection sampling. A chunk places the buildings whose position falls inside it |
| Roads | `RoadManager.ts` | `computeMinimumSpanningTree` over a town's houses, drawn as flat strips, each owned by the chunk holding its midpoint |
| Vegetation | `VegetationManager.ts` | Instanced trees, bushes and rocks (`VEGETATION_TYPES`), seeded per chunk. Trees have a trunk collider plus a canopy sensor (stops shots, not walking). Trunks register as cover |
| Watch towers | `WatchTowerManager.ts`, `towerDesign.ts` | Exactly `WATCH_TOWER_COUNT` (4) per map, placed independent of towns (`computeWatchTowerPositions`, cached by `getWatchTowerPositions`). Stairs are ramp colliders. Terrain flattens round each. The core is hollow at the bottom: a ground room with a door on its east face and stairs down to a lab (section 1.7) |
| Mission beacons | `UplinkBeacons.ts` | Beam shader over each Uplink point (tower roof on the Valley, console cap on the Facility) |

World bounds: the mountain ring ramps up, `Player` adds a soft inward push from
`WORLD_SOFT_PUSH_START_RADIUS` and a hard clamp at `WORLD_HARD_CLAMP_RADIUS` (`src/entities/Player.ts`).

Hooks into Game: `Game.create()` builds `VegetationManager`, `BuildingManager`, `RoadManager`,
`WatchTowerManager` and a `ChunkManager` wired through `ChunkStreamHooks`, seeds 30 `chunkManager.update`
calls around the spawn, then calls `chunkManager.update(player x, z)` every tick. The render pass uses
`updateSunFollow` (the sun's shadow box follows the player, snapped to shadow texels).

### 1.4 Enterable Valley houses (`src/world/houses`, `src/world/doors`)

- Three designs in `HOUSE_DESIGNS` (`src/world/houseDesigns.ts`): bunkhouse, block (two floors and a
  stair), workshop. Their pure layouts (walls with openings, rooms, furniture, stair, one lamp per
  room) are `HOUSE_LAYOUTS` in `houses/houseLayout.ts`. `houseDesigns.ts` builds meshes and colliders
  from the layout (`makeDesign`). A wall's collider is also its drawn skin.
- `BuildingManager` clones a design per placement and calls `ValleyHouses` (`houses/ValleyHouses.ts`),
  which owns doors (`ValleyDoors.ts`), lamps (`HouseLights.ts`), the enemy navigator (`HouseNavigator.ts`)
  and interior culling (`INTERIOR_DRAW_DISTANCE`, 70 m).
- Ids: a house is `(gx, gz, index)` of its town, packed by `houseKey`, doors and lamps by
  `houseObjectId` (`houses/valleyHouseIds.ts`). The ids are identical on every client and ride the
  existing `worldInteract`, `worldObjectState`, `lampDestroyed` and `lampSync` messages. A peer id is
  checked with `isHouseInWorld` first so far ids cannot force thousands of layout builds.
- Doors: `SlidingDoorView.ts` (shared with the Facility), `doorGeometry.ts` (pure plane, pick box, walk
  crossing). Doors start closed. Only a closed door has a collider (it blocks players, bullets,
  grenades, enemy sight).
- Enemies: `houseWalkGrid.ts` builds a 0.5 m walk grid per design (stair as a node chain, the door as a
  threshold and a street node). `HouseNavigator` places grids in the world and answers
  `setEnemyNavigator`, `setEnemyFloor` and `setEnemyEntrance`. `houseCover.ts` adds interior cover spots.
- Lamps: lit only at Night and Fog (`lampsOn: matchWeather !== 'day'`). A pool of `HOUSE_LIGHT_POOL`
  (4) point lights, created at match start, moves to the lit lamps nearest the camera.
- Hooks into Game: `Game.create()` builds a `FacilityInteraction` on `buildings.houses.doors`, sets the
  enemy door gate, calls `valleyBuildings.houses.killLampsQuietly(multiplayer.deadLamps)` for late
  joiners. Each tick: `facilityInteraction.update` and `buildings.houses.update(dt, camera)`. A player
  shot reaches lamps through `handleHitscanRay` (`houses.shootRay`).

### 1.5 The Facility (`src/world/facility`)

An indoor map, 56 x 56 cells of `FACILITY_CELL` 1.5 m (84 m square, `FACILITY_GRID`), a new layout per
seed. Flat floor at y = 0.

| Piece | File | What it does |
|---|---|---|
| Layout | `facilityLayout.ts` | `generateFacilityLayout(seed)`: atrium (room 0) plus 14 to 18 rooms (`hall`, `storage`, `plant`, `office`, about 1 in 5 `dark`), spanning tree plus loops, L corridors, flood-fill connectivity, crates and pillars, lamps. Retries until the open share is 0.35 to 0.6. Helpers `isWalkable`, `isSpawnBlocked`, `encounterPoints`, `playerStart`, `cellCentre`, `cellOf` |
| Geometry | `facilityGeometry.ts` | Floor, ceiling, wall and lintel quads per material, collider boxes (`ColliderBox`), cover footprints, lamp panels, light shafts |
| Builder | `FacilityBuilder.ts` | `FacilityWorld.build`: meshes, one fixed Rapier body of merged cuboids, instanced lamp panels, optional shafts and dust. Lamp API: `killLamp`, `killLamps`, `rayHitLamp`, `lampPosition`, `probeAt`, `update` |
| Lighting | `facilityBake.ts`, `bakedLightMaterial.ts` | CPU bake of lamp light into a per-vertex `bakedLight` attribute plus light probes (`sampleProbe`). A shot or unpowered lamp is re-baked locally, one per frame (`rebakeFacilityAround`) |
| Nav | `facilityNav.ts` | `FacilityNav`: per-target flow fields, `segmentClear`, closed doors raise the edge cost (`FACILITY_DOOR_NAV_COST`) |
| Doors | `facilityDoors.ts` | `facilityDoors(layout)`: merges doorway cells into openings, `FACILITY_DOOR_CHANCE` 0.6, dark rooms always get a door and start shut. `EnemyDoorWaits` |
| Power | `facilityPower.ts` | `facilityPower(layout)`: 4 to 6 zones, one breaker per zone, never in the atrium. `unpoweredLamps` |
| Objects | `FacilityObjects.ts`, `facilityObjectState.ts` | Door and breaker meshes, colliders, state and its wire form (`wire()`) |
| Consoles | `facilityConsoles.ts` | Uplink consoles (cabinet, screen, cap) |
| Modes | `facilityModes.ts` | Adapters so every mode runs indoors: goose placement, horde sites and flight height, mission points, throw blocking, ceiling lookup |
| Lamp effect | `lampBreakEffect.ts` | Sparks and glass when a lamp breaks (also used by the houses) |

Hooks into Game: `Game.create()` calls `generateFacilityLayout(getWorldSeed())`, `setHeightOverride(() =>
0)`, `FacilityNav`, `setEnemyNavigator`, `FacilityWorld.build`, `FacilityObjects.build`, builds a
`FacilityMatch` (`objects`, `world`, `layout`, `start`, `mapLayer`, `lampBreak`) and a
`FacilityInteraction` (`src/core/facilityInteraction.ts`, shared with the Valley houses). Each tick:
`facilityInteraction.update`; each render: `updateFacilityLight` (camera probe tints the hemisphere
fill). Single-player starts in a non-atrium room (`playerStart`).

### 1.6 Physics and colliders (`src/physics`)

- `PhysicsWorld` (`PhysicsWorld.ts`) wraps one Rapier world (gravity `GRAVITY` -20), steps it in
  `Game.update`, and keeps a `colliderToEntity` map. `registerCollider(collider, entity)` is how a
  hitscan hit finds the entity to damage (`getEntity`); `dispose()` frees WASM memory.
- Static world: terrain is a heightfield per chunk (`Chunk.ts`). Buildings and towers are fixed bodies
  of cuboids made with `createBoxCollider` and `createHullCollider` (`src/world/structureKit.ts`).
  The Facility is one fixed body of merged cuboids (`FacilityWorld.build`).
- Characters: `Player` is a kinematic capsule driven by a Rapier `KinematicCharacterController`
  (45 degree climb, autostep 0.5, snap to ground 0.3). Enemies, `RemotePlayer` and geese are kinematic
  bodies. Enemies and remote players get a body capsule plus a head ball from `createHitColliders`
  (`src/entities/characterHitbox.ts`, shapes `ENEMY_HIT_SHAPE` and `PLAYER_HIT_SHAPE`).
- Cover and spawn blocking use registries, not Rapier: `ObstacleRegistry`
  (`src/entities/enemies/tactics/obstacleRegistry.ts`) and the spawn check `makeSpawnBlockedCheck`
  (`Game.ts`, houses and towers) or `isSpawnBlocked` (Facility layout).

### 1.7 The underground (`src/world/underground.ts` and friends)

Every watch tower has a hollow ground room, a stair down and a lab. The terrain stays one height
surface per chunk, with three narrow exceptions (cut zones, `floorBelow` and the ray helper). Design
and decisions: `docs/underground-lab.md`; its section 9 is the as-built record of this section.

| Piece | File | What it does |
|---|---|---|
| Module state | `world/underground.ts` | The cut zones (at most four, one per tower), the registered terrain collider handles and the underground volumes. `Game.create` and `Game.dispose` call `clearUnderground()`; `WatchTowerManager` sets the zones and volumes |
| Cut zone | `underground.ts`, `Chunk.ts`, `Player.ts`, `terrainSplat.ts` | A tower core's interior square, local x and z within 2.7 m. `Chunk` registers its heightfield collider as terrain. The player's character controller ignores terrain colliders while the capsule is wholly inside a zone (`inCutZone(x, z, PLAYER_RADIUS)`). The terrain shader discards fragments inside the zones through the shared `cutZoneUniforms` |
| Rays | `underground.ts` (`castRaySkippingCuts`) | A drop-in for `castRayAndGetNormal` that skips a terrain hit whose point is inside a cut zone and carries on, up to three skips, with `timeOfImpact` kept relative to the original origin. Callers: `combat/hitscan.ts`, the surface probe and line-of-sight casts in `GrenadeSystem.ts`, and `throwSegmentBlocked` in `ThrownGoose.ts`. `GrenadeSystem.castSweep` does the same for its shape cast with a skipped-collider set |
| Floor | `underground.ts` (`floorBelow`) | Outside any volume it is `sampleHeight(x, z)`. Inside one it casts a ray down from 0.1 m over `y` at fixed bodies only, skipping terrain, and falls back to the volume's floor, never to the terrain. Used by the grenade floor callback (`(x, y, z)` in `grenadeFlight.ts` and `GrenadeSystem`), `Game.updateThrownGeese`, and `AmmoDropManager` |
| Two predicates | `underground.ts` | `isUnderground`: inside a registered volume (the ground room's column too) or in a cut zone less than 3.2 m over the terrain. For light, torch and `floorBelow`. `isBelowGround`: inside a volume and at least 1 m under that tower's ground (`groundY`). For rules, sound, the minimap and enemy perception |
| Lab solver | `world/towerUnderground.ts` | `computeTowerLabs()`, memoised per seed. For each tower in index order it tries the orientations south, west and north (the one farthest from the other towers first), and 3, 4 then 5 flights, for kind `full`, then `compact`, then `dead-end`. A candidate must sit inside `WORLD_EDGE_RAMP_START` (`labInsideWorld`), keep at least 1 m of terrain over its ceilings (`lowestCoverHeight`, the lowest height over its footprint inflated by 1 m), and be 4 m from every earlier lab or 8 m apart vertically (`labsClear`). It also reserves a dead end, and a full lab where one is still possible, for every later tower, and throws if a tower has no landing at all. Tower positions never change |
| Lab shell | `towerUnderground.ts` (`buildTowerLab`) | Boxes in the tower's frame: the shaft from the room (D1), a stairwell 9.6 by 6 m with switchbacks of 3 m drop, a one metre corridor and the lab hall (26 by 18 m full, 10 by 8 m compact). Orientation turns it by a quarter turn; north is mirrored in x so D1 always follows a wall without the east door. It returns `volumes` (world space, drive the predicates), `footprints` (the solver's rectangles, the ground room's column left out), a walk `route`, `lamps` and the `interiors` |
| Interior | `world/labInterior.ts` | `buildLabInterior(kind, seed)` is pure: solid parts (each one a collider and a drawn box), detail meshes without colliders, lamps, reactor core points and the free floor sites for pickups. Kinds: `full` (five tanks with one cracked, an operating table with a specimen, a glass partition with two console banks, two reactors, a catwalk with a ramp), `compact` (four tanks and a table), `ground` (the old room: shelf, crate, B3 sign, a bulb that flickers). `createLabInteriorVisual` batches everything into one mesh per material and bobs the specimens in the vertex shader |
| Door | `houses/valleyHouseIds.ts`, `houses/ValleyDoors.ts`, `towerUnderground.ts` (`towerDoorPlane`) | The east face doorway is a normal Valley door with id `2^32 + tower index`. `ValleyDoors.addTowerDoor` and `removeTowerDoor` keep a per-physics-world registry that the door manager reads whenever it exists |
| Light | `world/undergroundLights.ts`, `Game.updateUndergroundLight` | `undergroundAmount` eases (about half a second) toward 1 below ground, 0.6 in the ground room, 0 outdoors, and scales the sun, hemisphere fill and environment light by `1 - 0.95 * amount`, with fog pulled to 4 to 40 m in a cold near black. `UndergroundLights` is a fixed pool of three point lights that follow the nearest lab lamps. Lab meshes draw only near the tower |

- **Colliders and meshes.** The lab's colliders are added with the tower and live as long as its chunk
  does; the `tower-underground` mesh group is hidden unless `undergroundVisible` says the camera is
  near. Volumes stay registered when a chunk unloads, so the predicates answer for towers that are
  not streamed in.
- **Fixed light count.** The three lab lights are created in the `Game` constructor on every Valley
  match, whether or not the player goes down. The first descent does not recompile shaders: the end
  of `Game.create` shows every lab group and calls `renderer.webgl.compile` once.

## 2. Entities (`src/entities`)

| Entity | File | Notes |
|---|---|---|
| `Player` | `Player.ts` | Local player: movement, jump, recoil, knockback (manual, decays), health 100 (`PLAYER_HEALTH`), respawn, camera interpolation |
| `RemotePlayer` | `RemotePlayer.ts` | Opponent avatar. `takeDamage` does not change health: it forwards to `onHit`, which sends a `damageEvent`; the target's own client applies it. Head hits count `HEADSHOT_MULTIPLIER` (3) |
| `Enemy` | `enemies/Enemy.ts` | Body shell (collider, model, animation, health). The brain is `EnemyBrain.ts` behind the `EnemyBody` interface |
| `Target` | `enemies/Target.ts` | Static shootable disc, bullseye collider |
| `EntityManager` | `EntityManager.ts` | Spawns and updates targets and enemies, owns the squad systems (below), kills, death sequence |
| `Goose` | `Goose.ts` | Wandering primitive-mesh goose. Dies after `GOOSE_HITS_TO_KILL` (2) hits, whatever the weapon. Authoritative or follower mode (guests mirror the host) |
| `GooseManager` | `GooseManager.ts` | The ambient flock and the explosion on death (`explode`, radius and damage from `GOOSE_EXPLOSION_PRESETS`, host-chosen difficulty) |
| `ThrownGoose` | `ThrownGoose.ts` | Ballistic projectile for Goose Toss and the Goose Launcher |
| `HordeGoose(+Manager)` | `HordeGoose.ts`, `HordeGooseManager.ts` | Goose Horde waves (`HORDE_WAVE_TABLE`), kinds including jumpers and flyers |
| Bonus goose, golden goose, ammo drops | `BonusGooseManager.ts`, `GoldenGooseManager.ts`, `AmmoDropManager.ts` | Bonus goose grants the Goose Launcher; golden goose is King of the Hill's carry prop; ammo drops are Goose Horde multiplayer crates (separate from `src/pickups`) |

### 2.1 Enemy archetypes

`ENEMY_ARCHETYPES` in `enemies/archetypes.ts`: The Straggler (60 hp, weight 50), Ridge Walker (40 hp,
long-range kiter, weight 20), Rush Job (90 hp, melee only, weight 30). `createArchetypePicker` draws
by weight from a seeded stream per match; `archetypeNamed` is how the director asks for a kind.
Tune an archetype in that file, not in `config.ts`.

### 2.2 Enemy AI in outline (depth: `docs/enemy-ai-v2.md`)

- Perception (`perception.ts`): an awareness meter that fills with sight (rate depends on distance,
  facing, player movement) and drains without it. The player's visibility factor (`playerVisibility.ts`,
  `visibility()`): 1 right after firing or in a torch beam or flash light; Valley dusk 1, fog 0.75, night
  0.4; 0.3 inside a dark house room; Facility 0.2 to 1 from the baked probe under the player.
  `Game.update` fills a `PlayerVisibility` each tick and passes it to `entityManager.update`.
- Squad knowledge (`squadKnowledge.ts`): one shared belief about where the player is (seen, gunshot,
  damage, comrade death), with confidence that decays over `ENEMY_KNOWLEDGE_DECAY_TIME`.
- Roles (`combatCoordinator.ts`): shooter tokens (`ENEMY_MAX_CONCURRENT_ENGAGERS` 2), flanker, rusher.
- Cover (`tactics/`): `coverPoints.ts`, `tacticalQuery.ts` (scores), `planner.ts`, `rayBudget.ts`
  (shared rays per tick), `obstacleRegistry.ts` (trees, houses, Facility crates). Enemies hide at a
  `cover` spot and step to a `peek` spot to fire.
- Search (`searchGrid.ts`): a probability grid around the last known position that spreads and is
  wiped where enemies look or walk.
- Callouts and cues (`calloutDirector.ts`, `readability.ts`): rationed voiced lines, the long-shot
  glint (`combat/GlintMarkers.ts`) and the stagger.
- Flash blindness (`flashBlind.ts`): a flashed enemy sees nothing and fires wide at the last seen
  spot every `ENEMY_FLASH_FIRE_INTERVAL`.
- Movement: whisker steering (`enemySteering.ts`), `stuckDetector.ts`, no navmesh. Indoors the
  navigator hooks in `enemyNavigator.ts` route through Facility doors and Valley house grids.
- Hooks into Game: single-player only. `Game.create()` builds `EntityManager` with combat hooks
  (tracers, impact, positional gunshot, callouts), then `spawnEncountersAsync` places targets and
  enemies on a ring (`ENEMY_RING_BASE_RADIUS`, Facility: `encounterPoints`). Each tick:
  `entityManager.update(dt, player, playerVisibility)`. Player shots call
  `entityManager.notifyGunshot`; explosions call `applyExplosion`, `applyBlast`, `applyFlash`.

### 2.3 Pacing director and the Uplink mission

- Director (`enemies/director/pacingDirector.ts`, pure): build-up, peak, fade, relax from an intensity
  that rises with damage taken and nearby kills. It returns `spawnWave` commands.
  `reinforcementSpawner.ts` places a wave behind the player and off screen. Tuned by
  `ENEMY_DIRECTOR_*` in `config.ts`. Created in `Game` only when
  `!multiplayer && (directorMode || missionMode) && !hordeMode`.
- Uplink mission (`src/core/mission/missionState.ts`, pure): the three points nearest the spawn become
  uplinks A, B and C (hold `E` within `UPLINK_START_RADIUS`, `UPLINK_DURATION` 40 s, a wave every 10 s),
  the fourth is the extraction ring. Points are the four watch towers on the Valley and
  `facilityMissionObjectives` (four rooms) on the Facility. Single-player only.
- Hooks into Game: `updateDirector` and `updateMission` run right after `entityManager.update` (they
  read `killsThisTick`). Waves go through `spawnDirectorWave`. `startMission` and `restartMission`
  build `MissionState`, `UplinkBeacons`, `WorldMarkers`. Death ends the mission, Respawn restarts it.

## 3. Weapons and combat

### 3.1 Weapons (`src/weapons`)

- `definitions.ts`: `WEAPON_DEFINITIONS` holds pistol (Kestrel P9), mp5 (3-round burst), rifle (full
  auto), shotgun (8 pellets), sniper (scope), knife (melee, range 2.2), unarmed (Goose Toss
  placeholder) and gooseLauncher (`isProjectile`, 4 shots, `disableReload`). Fields: damage per
  pellet, `fireRate`, `magazineSize`, `reloadTime`, spread, recoil, `adsFov`, `automatic`, `pelletCount`,
  `kind`, `burstCount`.
- `Weapon.ts`: magazine, reload, fire cooldown, `consumeBurstRound`, reserve ammo, `damageOverride`.
- `WeaponManager.ts`: the hotbar (switching, `beginSwitch`), ADS (`updateAim`), firing (`fireShot`,
  `firePellet`), bursts (`WEAPON_BURST_SHOT_INTERVAL_SECONDS`), the melee swing, grenade throw lowering,
  the Goose Launcher grant and restore, ammo pickups, torch mount. `HITSCAN_RANGE` is 500 m.
- View models: `models/arsenal.ts` (`buildWeaponViewModel`, `WEAPON_MODEL_TUNING`), `viewModel.ts`
  (ADS pose from the aim point of the open iron sights, `Parts.ironSights` in `arsenal.ts`; the sniper aims by its scope's sight dot), `GrenadeViewModel.ts`, `meleeSwing.ts`, `grenadeThrowPose.ts`.
- Who gets which weapons: `src/core/gameModes.ts` (`resolveWeaponLoadout`, `FIXED_LOADOUTS`,
  `WEAPON_CATEGORIES`, `grenadesEnabled`) and `src/core/loadout.ts`.
- Hooks into Game: `WeaponManager.create` is built in `Game.create` through `buildWeaponManager` with
  callbacks (`onFire`, `onTracer`, `onImpact`, `onMuzzleFlash`, `onHitscanRay`, `onProjectileFire`,
  `onLongShot`). `weaponManager.update(dt, input, player)` runs each tick while the player is alive. A
  mid-match Loadout change rebuilds the manager at the next respawn, so callbacks read
  `game.weaponManager`, never a captured instance.

### 3.2 Hitscan, damage, hitboxes

- A shot: `firePellet` applies a spread cone (`combat/spread.ts`), calls `castHitscan`
  (`combat/hitscan.ts`, one Rapier ray, excludes the shooter), then
  `physics.getEntity(colliderHandle)` and, if `isDamageable` (`combat/damage.ts`, the
  `isDamageableTarget` marker), `takeDamage(damage, colliderHandle, origin)`.
- The target decides head or body by comparing the handle with its own head collider:
  `Enemy.takeDamage` and `RemotePlayer.takeDamage` both multiply by `HEADSHOT_MULTIPLIER` (3).
- Against another player the shooter does not touch their health: `RemotePlayer` sends a `damageEvent`
  (wired in `Game.create`), the victim queues it (`pendingNetworkDamage`) and applies it next tick.
  Kill credit uses `lastDamageSourceSlot` inside `MULTIPLAYER_KILL_CREDIT_WINDOW_MS`.
- Explosions: `combat/explosion.ts` (`computeExplosionDamage`, `computeKnockbackStrength`: linear
  falloff to the radius). Effects: `Tracers.ts`, `ImpactMarkers.ts`, `MuzzleFlash.ts` (one reusable
  light), `ExplosionEffect.ts`, `GlintMarkers.ts`.
- Hooks into Game: `handleHitscanRay` (lamp shooting), `ExplosionEffect.update` and the effect
  updates each tick.

### 3.3 Grenades (`src/combat/grenades`)

- `GrenadeSystem.ts` owns the carry (`GRENADE_START_COUNT` 2, max 3), cooking, flight, detonation and
  the received copies. `grenadeTuning.ts` holds every number (frag: 130 damage, radius 7, fuse 3 s;
  flash: fuse 1.6 s, range 22). `grenadeFlight.ts` is the pure swept-sphere bounce, `grenadeBlast.ts`
  the wall check (`blastReaches`, chest and head rays), `flashStrength.ts` distance and facing,
  `FragExplosion.ts` and `GrenadeEffects.ts` the visuals, HUD and sound, `GrenadeArcPreview.ts` the aim
  arc, `grenadeNetwork.ts` and `grenadeTargets.ts` the adapters from `Game`.
- Multiplayer sync: the thrower simulates its own grenade and sends `grenadeThrown` (origin,
  velocity, `fuseLeft`, send time). Every other client flies a copy with its own sweep
  (`receiveThrown`, capped at 32 copies). When the fuse ends, the thrower runs `goOff(own = true)`,
  decides the damage and sends `grenadeDetonated` plus a `damageEvent` per victim. Receivers only
  detonate a copy that this sender threw (`receiveDetonated`); a copy whose detonation never arrives is
  dropped `GRENADE_ORPHAN_GRACE_SECONDS` after its fuse. A late joiner's first snapshot makes the
  thrower re-send live grenades (`opponentInMatch`). The host relays both messages.
- Frag: knockback from any frag, damage only from your own client's calculation. It shoots out
  Facility lamps within `FRAG_LAMP_RADIUS` (`shootLampsNear` in `Game.create`) and makes noise for the
  enemies. Flash: white-out and muffled hearing for the player (`FlashBlindness`), blindness for
  enemies through `entityManager.applyFlash`.
- Hooks into Game: `new GrenadeSystem(...)` and `GrenadeEffects` in `Game.create`;
  `grenades.tickEffects` first thing each tick (also while frozen), `grenades.update` in the live
  block. The router (`src/network/MatchMessageRouter.ts`) feeds `receiveThrown` and `receiveDetonated`.
  `flashLightsPlayer` makes a flash light raise the player's visibility.

### 3.4 Goose weapons (`Game.ts`, `ThrownGoose.ts`)

A thrown goose (Goose Toss pickup or Goose Launcher shot) is simulated only by its thrower
(`updateThrownGeese`): it bursts on ground, on a Facility wall, crate, ceiling or closed door, on a house
wall or door, or on a player. `resolveThrownGooseExplosion` then applies self damage and knockback,
`entityManager.applyExplosion` for single-player enemies, and a `damageEvent` per opponent in range,
then sends `gooseThrowExploded`. Blast size is fixed per source (`GOOSE_TOSS_*`, `GOOSE_LAUNCHER_*`),
not the host's goose difficulty.

### 3.5 Pickups (`src/pickups`)

- Kinds in `pickupConfig.ts`: health (+40), ammo (+1 magazine per gun, cap 6), grenade (+1, cap 3). Respawn
  30, 25, 45 s. Mix 45, 40, 15 percent.
- Sites are a pure function of seed, map and mode (`pickupPlacement.ts`: `placeFacilityPickups`,
  `placeValleyPickups`, `pickupKindsForMode`; Valley inputs from `valleyPickupInputs.ts`), so only ids go
  on the wire. The Valley list ends with the lab sites (`gatherLabPickupSites`: three in a full lab,
  one ammo in a compact lab, none at a dead end), appended after the surface sites so their ids never
  move. Single-player on the Facility keeps clear of its start room, multiplayer cannot.
- `PickupBoard` (`pickupState.ts`) is the pure availability and respawn bookkeeping. `PickupSystem`
  runs the walk-over check (`PICKUP_RADIUS`, vertical reach) and the claim protocol: the authority
  (single-player or host) takes a claim at once; a guest sends `pickupClaim`, the host grants it only if
  it sees that avatar within `PICKUP_CLAIM_TOLERANCE` horizontally and 3 m vertically of the pickup
  centre (so a guest on the surface cannot take a lab pickup), and broadcasts `pickupTaken` and
  `pickupRespawned`. A guest asks for the full state with `pickupSyncRequest` and gets `pickupState`.
  A pickup that would give nothing is walked past. `pickupEffects.ts` applies it, `PickupVisuals.ts` draws it.
- Hooks into Game: `createMatchPickups` (`createMatchPickups.ts`) builds the system in `Game.create`;
  each tick `pickups.update(dt, player.position, alive)`; the router calls `pickups.handleMessage`;
  `updateMinimapPickups` draws icons; `resetPlay` calls `resetAll`.

## 4. Where do I change X

| Change | Files | Pattern to copy |
|---|---|---|
| Add an enemy archetype | `enemies/archetypes.ts` (`ENEMY_ARCHETYPES`, `spawnWeight`), `Game.ts` `waveArchetype` if the director should call it by name | Copy Rush Job (`rangedRange: 0` means melee only). Check the unit tests in `archetypes.test.ts` |
| Tune enemy senses, squad or cover | `src/core/config.ts` (`ENEMY_*`), the file named in section 2.2 | Change the constant, run `npm run test:unit` |
| Add a weapon | `weapons/definitions.ts`, `weapons/models/arsenal.ts` (view model, tuning), `audio/weaponSounds.ts` (optional: `mp5` and `knife` have no entry and fall back to synthesised sound), `core/gameModes.ts` (`WEAPON_CATEGORIES`, loadout lists), `ui/menu/LoadoutScreen.ts` (`CATEGORY_DISPLAY_ORDER`) | Copy `mp5` (definition, model, category, burst) |
| Tune a weapon | `weapons/definitions.ts`; shared ranges in `WeaponManager.ts` (`HITSCAN_RANGE`); headshot in `config.ts` (`HEADSHOT_MULTIPLIER`) | Edit the definition fields |
| Tune a grenade or add a kind | `combat/grenades/grenadeTuning.ts` (`GRENADE_KINDS`), `GrenadeSystem.ts` (`goOffFrag`, `goOffFlash`), `grenadeModels.ts`, `protocol.ts` (`isGrenadeKind`) | Copy the flash kind end to end; keep the thrower-decides rule |
| Change goose explosions | `config.ts` (`GOOSE_EXPLOSION_PRESETS`, `GOOSE_TOSS_*`, `GOOSE_LAUNCHER_*`, `HORDE_GOOSE_*`) | Edit the preset |
| Add a pickup type | `pickups/pickupConfig.ts` (`PickupKind`, `PICKUP_MIX`, respawn), `pickupEffects.ts` (`pickupWouldGive`, `applyPickup`), `PickupVisuals.ts`, `pickupPlacement.ts` (`pickupKindsForMode`), `src/network/protocol.ts` only if a message changes | Copy `grenade` (the kind that needs a supply interface) or `health` |
| Change pickup counts or spacing | `pickupConfig.ts` (`PICKUP_VALLEY_COUNT`, `PICKUP_FACILITY_PER_ROOM`, spacing) | Edit constants; placement stays seeded |
| Change the Valley size | `config.ts` `WORLD_SIZE_CHUNKS`, then re-check `FLAT_ZONE_RADIUS_*`, `FOREST_ZONE_RADIUS_*`, `ZONE_EDGE_MARGIN`, `GUARANTEED_ZONE_COUNT` (see the long comments), `ZoneMap.test.ts` | Not a one-number change: zones and towns must still fit |
| Change terrain shape | `world/TerrainGenerator.ts`, `config.ts` (`TERRAIN_*`) | Keep the edge ridge low frequency (the comment explains the wedge bug) |
| Change tree, bush, rock density or add a type | `world/VegetationManager.ts` (`VEGETATION_TYPES`), `config.ts` (`VEGETATION_*`) | Copy `rock` (collider shape) and add an asset under `public/assets/models/vegetation` |
| Add a Valley house design | `world/houses/houseLayout.ts` (layout, add to `HOUSE_LAYOUTS`), `world/houseDesigns.ts` (builder, add to `HOUSE_DESIGNS`), `houseWalkGrid.ts` and `houseCover.ts` follow automatically, `valleyHouseIds.ts` limits (`SLOT_SPAN` 4 doors or rooms, `INDEX_SPAN` 64 houses) | Copy `workshop`. A town draws its preset as `floor(rng() * HOUSE_DESIGNS.length)` (`BuildingManager.getTownLayout`), so a new design changes the towns of every seed, and every client must run the same build |
| Change town size or density | `config.ts` (`TOWN_MIN_BUILDINGS`, `TOWN_MAX_BUILDINGS`, `TOWN_BUILDING_SPACING_MARGIN`), `FLAT_ZONE_*` | The zone radius is the real ceiling (comment in `config.ts`) |
| Move or add watch towers | `config.ts` (`WATCH_TOWER_*`), `world/WatchTowerManager.ts` (placement), `towerDesign.ts` (parts) | The Uplink mission needs at least 4 points (`MissionState`). Cut zones are capped at four (`setCutZones`, `uCutZones[4]` in `terrainSplat.ts`) and tower door ids at `WATCH_TOWER_COUNT` (`valleyHouseIds.ts`), so raise both |
| Change a lab's size, depth or stair plan | `world/towerUnderground.ts` (constants at the top, `buildTowerLab`, the solver in `computeTowerLabs`) | Any change moves every seed's labs: rerun `towerUnderground.test.ts` (500 seed sweep, at least 95 percent full labs, walk and enclosure tests) and read the fallback rates it prints |
| Change a lab's furniture, specimens or pickup sites | `world/labInterior.ts` (`buildLabInterior`, `materials`) | Copy an existing prop. Keep a 2.4 m route and the pickup sites clear of solids (`labInterior.test.ts`). One mesh per `PieceMaterial`; the transparent ones (glass, liquid) set `renderOrder` in `createLabInteriorVisual` |
| Add a rule that depends on being underground | Call `isBelowGround(x, y, z)` from `world/underground.ts` and pass a flag in, as `MissionInput.underground` and `DirectorSignals.allPlayersUnderground` do | Use `isUnderground` only for light, the torch and floors. Keep the rule in the pure module and test it there |
| Make something rest or land on the ground | The `floorBelow(world, x, y, z)` form of the floor, not `sampleHeight` | Copy `AmmoDropManager` or the grenade `floor` option |
| Add a ray or shape cast that should pass a tower's cut zone | `castRaySkippingCuts` in `underground.ts` instead of `world.castRayAndGetNormal` | Copy `combat/hitscan.ts`; for a shape cast copy `GrenadeSystem.castSweep` |
| Change the underground look, torch or lights | `world/undergroundLights.ts` (`undergroundLook`, targets, pool size), `render/Flashlight.ts`, `Game.updateUndergroundLight` | The pool size is part of every lit shader, so `UNDERGROUND_LIGHT_POOL` is a match-start constant: never add or remove one of the pool's lights mid-match |
| Add a Facility room kind | `facilityLayout.ts` (`FacilityRoom.kind`, `placeRooms`, ceiling constant in `config.ts`), `facilityGeometry.ts` (materials), `pickupConfig.ts` (`PICKUP_FACILITY_PER_ROOM` is keyed by kind) | Copy `office` |
| Add or change Facility doors | `facilityDoors.ts` (`facilityOpenings`, `facilityDoors`), `FacilityObjects.ts`, `core/facilityInteraction.ts`, `config.ts` (`FACILITY_DOOR_*`) | Door ids are numbered in a fixed order; keep one rng draw per opening |
| Add a Facility breaker, lamp or power zone rule | `facilityPower.ts`, `facilityLayout.ts` (`placeLamps`), `FacilityBuilder.ts` (lamp state), `config.ts` (`FACILITY_LAMP_*`) | Copy the lamp-kill flow: `killLamp` then rebake queue |
| Add a Facility object that players use | `world/doors/interactiveObjects.ts` (`InteractiveWorldObjects`), `facilityObjectState.ts` (`WorldObjectKind`), `FacilityInteraction`, `protocol.ts` | Copy `ValleyDoors`, which reuses the same messages |
| Add a map | `config.ts` (`MatchMap`, labels), `Game.create` branch, set and clear the module switches (section 0), `render/look.ts` preset, `network/protocol.ts` and `helloSupportsMap` | Copy the Facility branch |
| Add a weather or look | `config.ts` (`MatchWeather`, labels), `render/look.ts` (`LOOK_PRESETS`), `playerVisibility.ts`, `Flashlight.ts` (`torchAvailable`, `torchCastsShadow`, `remoteTorchesAvailable`), `HouseLights` (`lampsOn`), `undergroundLook` (it scales the new look's sun, fill and fog) | Copy `fog` |
| Change the pacing director or the mission | `enemies/director/*`, `config.ts` (`ENEMY_DIRECTOR_*`), `core/mission/missionState.ts` | Both are pure and unit tested; change them there, not in `Game.ts` |
| Add a game mode | `core/gameModes.ts`, `core/modeControllers/`, `Game.create` (controller wiring), `core/modeExplanations.ts`, `network/protocol.ts` | Copy `GunGameController` |

## 5. Gotchas

- Light counts are fixed per match. Three.js recompiles every lit material when the number of lights
  changes, so the code creates its lights once: the torch (one on every map, plus
  `MULTIPLAYER_MAX_PLAYERS - 1` remote spotlights, only where `remoteTorchesAvailable`), the muzzle
  flash light, the grenade blast light (only if the mode has grenades, `GrenadeSystem`), the house
  pool of 4 (only at Night and Fog, `HouseLights`), and the underground pool of 3 (every Valley
  match, `UndergroundLights`). The Facility's lamps are baked per-vertex light plus emissive instances, not real
  lights, and consoles and shafts are emissive only for the same reason (`facilityConsoles.ts`). Do not
  add a light mid-match. One exception exists in the code: `ExplosionEffect.spawn` adds and removes a
  `PointLight` per goose explosion. By three.js's rules that changes the light count; I did not
  measure a recompile hitch.
- A thrown goose bursts on the near side of a house wall or closed door (at its previous position),
  but the blast damage is a plain distance check (`resolveThrownGooseExplosion` calls
  `computeExplosionDamage` without a wall ray), so a radius of 9 m can still hurt someone behind that
  wall. Frags differ: `blastReaches` casts chest and head rays. Goose deaths (`GooseManager.explode`) also
  ignore walls. Outside houses a thrown goose only checks the ground and players.
- Doors gate enemies and horde geese the same way: `heldAtDoor` stops them at a closed door and, after
  `FACILITY_ENEMY_DOOR_WAIT` (0.8 s), `FacilityInteraction.enemyGate` opens it. Only the authority runs the
  gate (`if (!this.authority) return false`), enemies never close doors, and a door will not close on a
  living enemy or goose (`others` in `FacilityInteraction`). A closed door raises the flow-field cost
  on the Facility (`doorCrossings`) rather than blocking the route.
- Anything new that walks through houses or the Facility must call `heldAtDoor`, or it will push
  against closed doors (`Enemy.ts` and `HordeGoose.ts` are the two callers today).
- Module-level state (height override, navigator, door gate, floor, entrance, underground zones and
  volumes, noise caches) survives
  between matches. `TerrainGenerator` rebuilds its noise lazily when the seed changes
  (`ensureNoiseForCurrentSeed`) and caches flat heights per seed, so changing the seed outside
  `Game.create` leaves stale caches only until the next `sampleHeight` call.
- The Facility replaces `sampleHeight` with a constant 0. Anything that samples terrain (goose
  heights, marker heights, pickups) is automatically flat there, but code that assumes the Valley's
  `WATCH_TOWER` or town data on the Facility will be wrong (`EntityManager` still passes
  `getWatchTowerPositions()` to the tactics world even when Facility is loaded).
- The single-player spawn is not kept clear of towns (about 6 percent of seeds, per a comment in
  `Game.ts`), so `Game.create` steps it off structures (`clearFixedSpawnPoint`). Multiplayer spawns are
  picked by the host before any world exists, so each client re-clears its own.
- Single-player has a minimap on the Facility only (`soloMinimap`); multiplayer has one on both maps.
- Multiplayer has no AI: `entityManager` spawns nothing, the director and mission are single-player
  only, and a guest's geese are followers. Only the host spawns and adjudicates geese.
- Damage authority: you apply damage to yourself. A grenade or goose blast you throw damages others by
  `damageEvent`, a copy on another screen never damages anyone (`own = false`). Anything that bypasses
  `damageEvent` is a desync.
- There is no day cycle and no changing weather inside a match. The sun direction is a constant
  (`SUN_AZIMUTH_DEG` in `render/look.ts`), so shadows fall the same way in every match.
- The seed offset 617 is used by both `FACILITY_POWER_SEED_OFFSET` and `PICKUP_SEED_OFFSET`, so
  Facility power zones and pickup placement start from the same random stream. It is harmless (they draw
  for unrelated things), and `pickupConfig.ts` now says so. Terrain's warp noise and
  the vegetation density noise are also both `seed + 2`.
- Tree canopies are sensors: they stop hitscan but not walking, and `throwSegmentBlocked` ignores them.
- **The controller predicate inside cut zones.** `Player` passes a filter that ignores terrain colliders
  to `computeColliderMovement` only when the capsule is wholly inside a cut zone, judged on the position
  before the move (`inCutZone(x, z, PLAYER_RADIUS)`). Without it the heightfield would be a lid over the
  stair hole; with it applied everywhere a player could walk through the ground. Any new walking body
  that must enter a tower needs the same rule, and nothing may rely on terrain being solid inside a zone
  (rays use `castRaySkippingCuts` for the same reason).
- **`isUnderground` for light and torch, `isBelowGround` for rules and sound.** The ground room counts
  for the first (it is dim and the Dusk torch works there) and not for the second (the mission, King of
  the Hill, the Director, the minimap and the muffle ignore it). Using the wrong one makes the room feel
  like the lab, or the lab like the surface, for exactly one system.
- **Rails must run along local X.** `addRailing` (`structureKit.ts`) draws a rail's length along its
  box's local X, so a rail made any other way draws as a short stub with a full length collider. Build
  them with `boxAlong`; `towerUnderground.test.ts` and `towerDesign.test.ts` check every rail part.
- **The torch shadow map must be drawn once even when the torch is off.** `Flashlight.setOn` always sets
  `shadow.needsUpdate`. Every lit material samples the torch's shadow map; a torch that starts off and
  never drew it left WebGL rejecting every lit draw call and the whole Fog world missing (v4.6.2). At
  Dusk the torch has no shadow at all (`torchCastsShadow`), so the rule applies where it does.
- **Underground state is module level.** The cut zones, terrain collider handles and volumes in
  `underground.ts` survive a `Game`. `Game.create` and `Game.dispose` both call `clearUnderground()`;
  a stale volume would make `isBelowGround` true in the next match. A chunk must unregister its collider
  handle in `Chunk.dispose`, or a recycled handle would be treated as terrain.
- **Underground colliders exist when the mesh does not.** The lab is solid and the door works while its
  `tower-underground` group is hidden, so a ray or a player always meets the real shape.

## 6. Known stale spots

`docs/world-generation.md` is a historical log: its world sizes (12 x 12 chunks, 1200 m, then 800 m) were
superseded by `WORLD_SIZE_CHUNKS = 4`, which is 400 m. The Valley comments and docs that said houses were
not enterable, or that the world is 800 m, were corrected on 2026-11-04.
