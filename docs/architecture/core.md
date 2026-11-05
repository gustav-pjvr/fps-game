# Core architecture (v4.5.0)

Hunter 'n Goose is a browser first-person shooter: TypeScript, Three.js (rendering), Rapier (physics, WASM),
PeerJS (WebRTC multiplayer), built with Vite and deployed to Cloudflare Pages. There is no game engine and no
game server. This file explains how the game is put together and where to change things. Every claim names its
source file; line numbers are left out on purpose, so search for the named class or function.

It was written from the source of v4.5.0. Where an older file in `docs/` disagrees with the code, the code wins.
## 1. Boot flow and the App state machine

### 1.1 From the page to the lobby

| Step | File | What happens |
|---|---|---|
| 1 | `index.html` | Four mount points: `#lobby` and `#app` (the two WebGL canvases, `aria-hidden`), `#hud` (z-index 15, `pointer-events:none`) and `#overlay` (a `<main>`, z-index 25). Loads the Manrope and Martian Mono fonts, then `/src/main.ts`. |
| 2 | `src/main.ts` | Looks the four elements up (throws if one is missing), calls `startGamepadMenus()` from `src/ui/gamepadFocus.ts`, then `App.create(...)`. The returned promise is not awaited. |
| 3 | `src/core/App.ts` | `App.create` builds the App, awaits `LoadoutScreen.create` (async: it renders weapon thumbnails), then awaits `enterLobby()`. |
| 4 | `App.enterLobby` | `LobbyScene.create` (`src/lobby/LobbyScene.ts`, the drifting valley under the title), `lobby.start()`, `mainMenu.show()`, `lobbyMusic.start()`. |

`App` has no state enum. The state is implied by which fields are set: `lobby` (a `LobbyScene` or null),
`currentGame` (a `Game` or null), `playSetupModal`, and `currentMultiplayerSession` (null outside a multiplayer
match). It owns every lobby overlay: `MainMenu`, `SettingsPanel`, `LoadoutScreen`, `LoadingScreen`,
`PlaySetupModal`, `MultiplayerMenu`, `CreateRoomScreen`, `JoinRoomScreen` (all in `src/ui/menu/`) and
`MatchEndScreen` (`src/ui/matchEndScreen.ts`), plus one `LobbyMusic` (`src/audio/LobbyMusic.ts`).

### 1.2 State transitions (all methods are in `src/core/App.ts`)

| From | Trigger | Method | Result |
|---|---|---|---|
| Lobby | Play button | `openPlaySetup` | `PlaySetupModal` with defaults from `src/core/config.ts` (`DEFAULT_ENEMY_COUNT` and friends). |
| Match setup | Start Match | `startMatch` | Hides menus, `lobbyMusic.stop()`, shows `LoadingScreen`, disposes the lobby scene, awaits `Game.create(...)` with a progress callback, hides loading, `game.start()`. |
| Lobby | Multiplayer, Create or Join | `CreateRoomScreen`, `JoinRoomScreen` | They own the connection and roster; when the match is really starting they call `startMultiplayerMatch`. |
| Multiplayer start | (same) | `createMultiplayerGame` | Same teardown and loading shape as `startMatch`, but passes the `MultiplayerSession` plus callbacks (match end, rematch received, host left) to `Game.create`. |
| Match | Death screen "Return to Lobby" | `returnToLobby` | Silences connection callbacks, `currentGame.dispose()`, clears the session, `enterLobby()` again (fresh scene, menu, music). |
| Multiplayer match | Kill limit, horde cleared or wiped, opponent gone | `handleMultiplayerMatchEnd` (called by `Game`) | Shows `MatchEndScreen` (podium) over the frozen match. |
| Match end screen | Host clicks Rematch | `handleRematchClick` | Host sends `matchStart` on the same connection (new seed only if "new map" was ticked; roster from `hostRoster.connectedRoster()`), then `restartMultiplayerMatch`. |
| Match end screen (guest) | Host's `matchStart` arrives | router case `matchStart` in `src/network/MatchMessageRouter.ts` | `Game` calls `onRematchReceived`, which is `App.restartMultiplayerMatch`. |
| Rematch | either side | `restartMultiplayerMatch` | Silences old callbacks, `currentGame.dispose({ keepConnectionAlive: true })`, `createMultiplayerGame` on the same `PeerConnection`. |
| Match end screen | Return to Lobby | `handleReturnToLobbyFromMatchEnd` | The host also sends `hostLeftRoom`; a guest that receives it (`onOpponentLeftRoom`) returns to the lobby too. |

Silencing the callbacks first is deliberate: a stray `onPeerDisconnected` during `Game.dispose` once re-disposed a `RemotePlayer`
and trapped the Rapier WASM (comment in `returnToLobby`).

## 2. Game: the match

`src/core/Game.ts` is the match: about 3,600 lines, with nearly everything built in `Game.create` and held as a field.

### 2.1 What `Game.create` builds, in order

`Game.create(container, hudRoot, matchConfig, onProgress, onReturnToLobby, multiplayer?, ...)` is the only way to
make a `Game` (the constructor is private).

1. **Mode and seed.** `isHordeMode`, `currentGameMode` (single-player has no `GameMode` of its own: `default` or
   `gooseHorde`), then `setWorldSeed(multiplayer.seed)` or `randomizeWorldSeed()` (`src/core/worldSeed.ts`). The seed
   is what makes every client build the same world.
2. **Core objects.** `Renderer` (preset from `Settings.getGraphicsQuality()`), `InputManager`, `PhysicsWorld.create()`, then
   `setMatchLook(FACILITY_LOOK)` or `setMatchWeather`, `Game.addLighting`, and a `Flashlight` on every map (its shadow
   only where `torchCastsShadow`), plus `RemoteTorches` in multiplayer where `remoteTorchesAvailable(map, weather)`
   (Facility, Night, Fog: a Dusk match has no remote pool). `clearUnderground()` runs first, before the world is built.
3. **World.** Facility: `generateFacilityLayout(seed)`, `setHeightOverride(() => 0)`, `FacilityNav`,
   `FacilityWorld.build` (bakes light), `FacilityObjects.build`. Valley: `VegetationManager`, `BuildingManager`,
   `RoadManager`, `WatchTowerManager` and a `ChunkManager` whose chunk load and unload hooks fan out to those four;
   30 `chunkManager.update` calls seed the chunks around the spawn.
4. **Spawn point.** Multiplayer: the slot's point from `session.spawns`, stepped clear of structures
   (`findClearSpawnPoint`, `src/core/multiplayerSpawn.ts`). Otherwise the Facility start, a random horde point, or
   `clearFixedSpawnPoint`.
5. **Sound, HUD basics, player.** `SoundEngine.create()` (section 5), `Hud`, `DamageVignette`, `DamageArcs`, `Player`,
   `KillFeed`, `ImpactMarkers`, `Tracers`, `MuzzleFlash`, `GlintMarkers`, `ScopeOverlay`, `HitMarker`, `LongShotCallout`.
6. **Weapons.** `resolveWeaponLoadout(mode, ..., loadStoredLoadout())` picks weapon ids; the local closure
   `buildWeaponManager` calls `WeaponManager.create` and is kept as `rebuildWeaponManagerFn` for mid-match loadout changes.
7. **Enemies.** `EntityManager.create`, then (single-player, not horde) `Game.spawnEncountersAsync`, which yields a
   frame every `SPAWN_BATCH_SIZE` entities so the loading bar moves. Multiplayer matches have no AI.
8. **Geese.** `GooseManager`, and per mode `GoldenGooseManager` (King of the Hill), `HordeGooseManager`, `BonusGooseManager`,
   `AmmoDropManager`.
9. **Multiplayer state.** One `RemotePlayer` per other roster slot, a `Minimap` and `MultiplayerHud`, packed into an
    `ActiveMultiplayer` (`src/network/multiplayerMatchTypes.ts`).
10. **Menus and widgets.** `Hotbar`, `WeaponCaption`, `DeathScreen`, `PauseMenu`, an in-match `SettingsPanel`, `PerfOverlay`.
11. **`new Game(...)`.** The constructor creates the `Loop` (`new Loop(this.update, this.render)`), binds F3 and F4 and
    calls `installDebugApi()`.
12. **Wiring that needs `game`.** `ModeExplanationScreen`, `createMatchPickups` (`src/pickups/createMatchPickups.ts`),
    `FacilityInteraction` (Facility doors and breakers, Valley house doors), the Uplink mission, the per-mode controllers
    in `src/core/modeControllers/`, `GrenadeSystem` and `GrenadeEffects` (`src/combat/grenades/`), and in multiplayer
    `connection.setCallbacks` with a `MatchMessageContext` passed to `routeMatchMessage`.
13. **Briefing gate.** `beginModeExplanation` for every mode but `default`, unless it is a late join. The world stays
    frozen until every player has pressed Skip.
14. **Precompile.** On the Valley, the last step shows every streamed-in tower's hidden `tower-underground` group,
    calls `renderer.webgl.compile(scene, camera)` once and restores the groups' visibility, so the lab materials
    compile with the match's full light set before the first descent instead of stalling it.

Pieces that need `game` before it exists use forward references (the `gameRef` holder, the `game` variable captured by closures).

### 2.2 Main fields

| Field | Notes |
|---|---|
| `renderer`, `input`, `physics`, `player` | Core objects. |
| `chunkManager`, `buildings`, `watchTowers` | Valley only. `facility` (`FacilityMatch`: world, layout, start, mapLayer, lampBreak, objects) is Facility only. |
| `entityManager` | `src/entities/EntityManager.ts`: targets, enemies, squad AI. |
| `weaponManager` | Not readonly: replaced at respawn after a loadout change. |
| `grenades`, `grenadeEffects`, `pickups`, `facilityInteraction` | Systems built after construction. |
| `gooseManager`, `goldenGooseManager`, `hordeGooseManager`, `bonusGooseManager`, `ammoDropManager`, `thrownGeese` | Goose systems (`src/entities/`); null when the mode does not use them. |
| `gooseTossController`, `kingOfTheHillController`, `gunGameController` | `src/core/modeControllers/`; at most one is non-null. |
| `multiplayer`, `multiplayerMatchState` | `ActiveMultiplayer` (session, opponents, minimap, HUD, timers) and `src/network/MultiplayerMatchState.ts` (scoreboard, win check, "ended" flag). |
| `director`, `mission` | Single-player Director and Uplink modes. |
| `sound`, `perfLogger`, `fpsMeter` | One `SoundEngine` per match; perf rows from `src/core/perfStats.ts`. |
| `deathHandled`, `deathScreenVisible`, `pendingDeathScreenReveal`, `worldBriefingActive`, `missionWon` | Flags that decide what is frozen (2.4). |

### 2.3 The loop
`src/core/Loop.ts` is a fixed-timestep accumulator driven by `requestAnimationFrame`. Each frame adds
`min(frameTime, MAX_FRAME_TIME)` (0.25 s) to the accumulator, runs `update(FIXED_TIMESTEP)` (1/60 s; both constants
are in `src/core/config.ts`) while it can, then calls `render(alpha)` once, where `alpha` is the leftover fraction of
a tick. `Game.start()` starts the loop and, unless a briefing is showing, calls `input.resume()` to request pointer lock.

### 2.4 One tick: the order of `Game.update`

1. `grenades.tickEffects(dt)`, then `input.update(dt, menuOnly, crosshairOverEnemy)`. `menuOnly` is true during the
   briefing, death screen and match-end screen. On the death screen the `resetPlay` action calls `resetPlay()`.
2. Match ended (`multiplayerMatchState.hasEnded`): drain look input and return, for good.
3. Briefing (`worldBriefingActive`): drain look input, resend readiness, return.
4. `isPaused = !input.isEngaged && !deathScreenVisible`; update `pauseMenu`. A death while paused reveals the death
   screen on the first unpaused tick (`pendingDeathScreenReveal`).
5. Single-player and paused: `weaponManager.cancelAim()` and return. Multiplayer keeps simulating while paused, so
   pausing never dodges damage.
6. Key actions (`resetPlay`, `flashlight`; the toggle is ignored where `torchAvailableAt(player)` is false, which is
   the Dusk surface), then queued `pendingNetworkDamage` and `pendingDebugDamage` into `player.takeDamage`.
7. Every `RemotePlayer.update(dt)` (before this tick's shots, so hitscan sees fresh colliders), `facilityInteraction.update`,
   `buildings.houses.update`.
8. If the local player is not frozen: `gooseTossController` and `kingOfTheHillController` (they consume the fire press
   first), `player.update`, then on the Valley `valleyFallRecovery` (a player far below a lab floor or the terrain is
   teleported 4.5 m east of the nearest tower and, in multiplayer, a `respawnEvent` is sent), `weaponManager.update`.
   Then player visibility (`src/entities/enemies/playerVisibility.ts`) for the HUD light meter and enemy perception: an
   underground player (`isBelowGround`) counts as in an unlit room, the torch is switched off if it is not available
   here, and the HUD meter is shown only where the torch is available.
9. Shared world (always in multiplayer, only while unfrozen in single-player): `physics.step`, `chunkManager.update`,
   `entityManager.update`, `updateDirector`, `updateMission`, `gooseManager.update`, `updateThrownGeese`, `grenades.update`,
   `hordeGooseManager.update`, `bonusGooseManager.update`, ammo drops, `pickups.update`, the host's Goose Toss supply.
10. Hotbar and weapon caption refresh, then effect updates (impacts, tracers, muzzle flash, hit marker, vignette, kill feed,
    announcements, explosions, lamp break).
11. `updateMultiplayer(dt)`: minimap and HUD, connection poll (`MULTIPLAYER_CONNECTION_POLL_INTERVAL`), lamp resync, the
    host's win check (`findWinner`) and rejoin sweep, respawn timer, and the `playerSnapshot` broadcast every
    `PLAYER_SNAPSHOT_SEND_INTERVAL`.
12. Death handling (`player.isDead && !deathHandled`): telemetry (single-player), death screen, goose spawn, `playerDied`
    broadcast, scoreboard and horde lives. Then HUD writes, `sound.updateAmbience(...)`, `hotbar.setActive`.

**One frame, `Game.render(alpha)`:** records frame time (`fpsMeter`, `perfLogger`, `perfOverlay`), `player.interpolateCamera(alpha)`, `grenades.applyCameraShake`,
`hud.update`, `damageArcs.update`, `worldMarkers.update`, `grenadeEffects.update`, then `updateFacilityLight` (Facility) or
`updateSunFollow` and `updateUndergroundLight` (Valley), `updateTorches`, `renderer.render()`, `grenadeEffects.afterRender`. Only the camera and what is
parented to it (the weapons) is interpolated; other meshes show the last tick's pose.

### 2.5 Dispose, reset, respawn

`Game.dispose({ keepConnectionAlive? })` stops the loop and tears down in an order that matters: Facility world, objects,
interaction, house lights, lamp effects and torches first (they free GPU resources and a physics body); then the
module-level overrides (`setHeightOverride(null)`, `clearUnderground()`, `setEnemyNavigator(null)`, `setEnemyDoorGate`,
`setEnemyFloor`, `setEnemyEntrance`); then `input`, `renderer` (which forces WebGL context loss), HUD widgets, managers, `sound`, opponents,
minimaps, and the connection unless `keepConnectionAlive`. It bumps `spawnGeneration` (cancels an in-flight
`spawnEncountersAsync`) before `physics.dispose()`, and ends with `window.__gameDebug = undefined`.

`resetPlay` is single-player's restart (T or the death screen button): applies a pending loadout change, respawns, resets ammo,
enemies, director, mission, pickups and doors. In multiplayer it acts only when dead, via `multiplayerRespawn`.

## 3. Rendering

### 3.1 `Renderer` (`src/core/Renderer.ts`)

Owns the `WebGLRenderer`, `scene`, the main `camera` and a second fixed-lens `viewModelCamera` (`VIEW_MODEL_FOV`, synced by
`syncViewModelCamera` in `src/render/viewModelCamera.ts`). Everything parented to the camera (the weapons) moves to
`VIEW_MODEL_LAYER`, so the weapon draws in its own depth-cleared pass; lights flagged `userData.worldOnly` (the torch)
are dimmed for that pass. `applyQuality(preset)` is safe at any time (pixel ratio, shadows, `scene.environment`,
`rebuildPostStack`). `setMatchWeather` or `setMatchLook` is called once at match setup and applies a `LookPreset` (fog, sky,
exposure, window glow, and a PMREM environment map generated from the sky). `render()` uses `PostStack`, or on Low draws
the world and then the view model directly with ACES tone mapping.

### 3.2 Graphics quality presets (`src/settings/graphicsQuality.ts`)

| Preset | Shadows | Pixel ratio cap | Environment light (IBL) | Post stack | N8AO |
|---|---|---|---|---|---|
| low | off | 1 | off | off | off |
| medium (default) | on, `SUN_SHADOW_MAP_SIZE_MEDIUM` | 2 | off (hemisphere fill instead) | on | off |
| high | on, `SUN_SHADOW_MAP_SIZE_HIGH` | 2 | on | on | on |

The in-match `SettingsPanel` changes it live through `Game.applyGraphicsQuality`, which calls `Renderer.applyQuality`,
resets the fill light, sun shadow flag and torch shadow, and swaps the shadow map when its size changes. Medium is the
default because the e2e sandbox is verified on it.

### 3.3 Lighting and post-processing

- `Game.addLighting` creates a `HemisphereLight` fill and a `DirectionalLight` sun with an orthographic shadow box
  (`SUN_SHADOW_*` in `config.ts`). On the Valley `updateSunFollow` re-centres that box on the player in shadow-texel steps.
- **Underground light fade (Valley).** `Game.updateUndergroundLight` runs in the render path after `updateSunFollow`.
  It eases `undergroundAmount` (`easeUndergroundAmount`, about half a second) toward `undergroundLightTarget` at the
  camera: 1 below ground, 0.6 in the ground room, 0 outdoors. `undergroundLook(currentLook, environmentLighting, amount)`
  then derives the sun, hemisphere fill, environment intensity and fog from the weather's own look every frame, never
  from last frame's faded values: the three lights scale by `1 - 0.95 * amount` and the fog pulls from the weather's
  near and far to 4 m and 40 m, its colour moving from the haze to `UNDERGROUND_FOG_COLOR`. Only intensities and fog
  values change, so no shader recompiles. The same pass shows each tower's `tower-underground` group when
  `undergroundVisible` allows and moves the three `UndergroundLights` onto the nearest lab lamps
  (`src/world/undergroundLights.ts`, `docs/architecture/world-and-combat.md` section 1.7).
- `src/render/look.ts` holds the art direction in numbers: `LOOK_PRESETS` (`day`, shown as "Dusk", `night`, `fog`) and
  `FACILITY_LOOK`. Sky, fog, lights, grade and bloom all read from it.
- `src/render/PostStack.ts`: world `RenderPass`, optional `N8AOPostPass`, the view-model pass (`HookedRenderPass`), one `EffectPass`
  with bloom and the custom `GradeEffect`, then SMAA, on a half-float buffer.
- Also in `src/render/`: `StylizedSky.ts` (sky dome), `materialGrade.ts` (surface regrade, window glow), `Flashlight.ts` (torch),
  `contactShadows.ts` (used by `src/world/BuildingManager.ts` and `src/world/towerDesign.ts`), `proceduralTexture.ts`.

### 3.4 Valley versus Facility

| Aspect | Valley | Facility |
|---|---|---|
| Choice | `MatchMap` `'valley'` in `src/core/config.ts` (default) | `'facility'` |
| Look | `lookFor(weather)`: day, night, fog | `FACILITY_LOOK` (`indoor: true`): sky hidden, sun intensity 0, no IBL on the world, no sun shadows |
| World | Chunked terrain, vegetation, houses, roads, four towers with a ground room and a lab under each | `FacilityWorld` from `generateFacilityLayout(seed)` (`src/world/facility/`); flat floor via `setHeightOverride(() => 0)` |
| Light | Sun plus hemisphere fill (IBL on High) | Baked per-cell probes; `Game.updateFacilityLight` damps the fill toward the probe under the camera; light shafts and dust follow `quality.postProcessing` |
| Torch | `torchAvailable(map, weather, underground)`: at Night and Fog anywhere, at Dusk (`day`) only underground (`isUnderground`), switched off again on the surface; on by default at Night. A Dusk torch has no shadow and no remote torch pool | Always available and on by default (`src/render/Flashlight.ts`) |
| Weather | Chosen at setup | Not applicable; the select is disabled (`PlaySetupModal`) |
| Navigation | House walk grids (`src/world/houses/HouseNavigator.ts`) | `FacilityNav` |
| Geese | Ambient flock and bonus goose (default mode) | None, except Goose Toss pickups |
| Music | Synthesised combat mix | Looping recorded track (`INDOOR_MATCH_TRACK`) |

The Facility design is in `docs/facility-map.md`; read it before changing `src/world/facility/`.

## 4. Input, settings and UI

### 4.1 Input (`src/input/`)

- `actions.ts`: the `Action` union, `DEFAULT_KEY_BINDINGS` (key code to action), `REBINDABLE_ACTIONS`, `ACTION_LABELS`,
  `keyHint`. Fire and aim are mouse buttons mapped inside `InputManager`.
- `InputManager.ts`: keyboard, mouse, pointer lock and the gamepad bridge. Per-tick API: `isActionActive`,
  `consumeJustPressed` (true once per press), `consumeLookDelta`, `getMoveVector`, `vibrate`.
- **`InputManager.isEngaged`** is `!paused && (locked || activeDevice === 'gamepad')`: the one "player is in control" flag.
  `Game.update` derives `isPaused` from it and `isActionActive` is false without it. Losing pointer lock, a hidden tab, or
  (with a pad) a window blur pauses. `resume()` requests pointer lock (needs a user gesture) unless a pad is active.
- `GamepadInput.ts`: the `gamepadInput` singleton (`GAMEPAD_ACTIONS` button map, dead zones, `lookResponse`, mouse or pad
  device switching, `setDeviceHint` for prompt labels). Button 9 (Start) toggles pause in `InputManager.update`.

### 4.2 Settings (`src/settings/Settings.ts`)
A module-level singleton persisted to `localStorage` key `fps-game-settings-v1`: master and music volume, mouse and
controller sensitivity, invert Y, aim assist, vibration, key bindings, graphics quality, field of view. Each value has a
getter, a clamping setter and `persist()`. `mergeKeyBindings` adds default keys for actions added since a player saved,
without taking a key they use. Consumers read it live (`Settings.getFov()` every frame in `WeaponManager.updateAim`,
`getMusicVolume()` in `SoundEngine.updateAmbience`); a live push into a running match is a callback on `SettingsPanel`
(`onVolumeChange`, `onGraphicsQualityChange`, `onFovChange`), wired in `Game.create`.

### 4.3 UI layers (`src/ui/`)
| Layer | Files | Notes |
|---|---|---|
| Tokens | `theme.ts` | Colours, fonts, `LABEL_CSS`. Menus get them via `menu/menuStyles.ts` (`createPanel`, `createOverlay`, `createButton`). |
| HUD | `hud.ts` (`Hud`: compass, objective, score, health, ammo, grenades, prompt, light meter) and one class per widget (`hotbar.ts`, `killFeed.ts`, `hitMarker.ts`, `minimap.ts`, `multiplayerHud.ts`, `worldMarkers.ts`, ...) | Plain DOM under `#hud`. A widget takes `root` in its constructor and has `update(dt)` and `dispose()`. |
| Menus | `menu/MainMenu.ts`, `PlaySetupModal.ts`, `MultiplayerMenu.ts`, `CreateRoomScreen.ts`, `JoinRoomScreen.ts`, `SettingsPanel.ts`, `LoadoutScreen.ts`, `LoadingScreen.ts`, `PauseMenu.ts` | Lobby ones belong to `App`; `PauseMenu`, a second `SettingsPanel` and a lazily built `LoadoutScreen` belong to `Game`. |
| Gamepad menus | `gamepadFocus.ts` | `menuControls()` returns the focusable controls of the top-most z-indexed overlay; `GamepadFocus` moves focus with stick or d-pad and presses with A; `gamepadBack` sends B as a `gamepadback` event. `startGamepadMenus()` polls the pad in the lobby; while an `InputManager` exists (`gamepadInput.managed`) the match polls. New buttons work with a pad automatically. |
| Modal scope | `menu/modalScope.ts` | `ModalScope.enter/leave` makes an overlay's siblings `inert` and restores focus. Used by `LoadoutScreen` over the pause menu. |

The pause menu is not a mode: `Game.update` shows it whenever `input.isEngaged` is false and the death screen is not up.
Its Loadout button exists only for `modeUsesCustomLoadout` modes; a change applies at the next respawn.

## 5. Audio

| Piece | File | Lifetime |
|---|---|---|
| `SoundEngine` | `src/audio/SoundEngine.ts` | One per match. `SoundEngine.create()` in `Game.create` makes an `AudioContext` and loads weapon samples; `Game.dispose` calls `sound.dispose()` (closes the context). |
| `LobbyMusic` | `src/audio/LobbyMusic.ts` | One per `App`, built on `HTMLAudioElement`, not Web Audio. Started in `enterLobby`, faded out when a match starts. |
| Pure helpers | `ambience.ts`, `flashDeafness.ts`, `lobbyPlaylist.ts`, `weaponSounds.ts`; `src/core/positionalAudio.ts` | Unit-tested. Positional helpers give `volumeScale` and `pan` for `playGunshot`, `playExplosion` and friends. |

`SoundEngine` is mostly synthesised (`tone`, `noiseBurst`, `sweep`). The only recorded effects are the shots and reloads of
`pistol`, `rifle`, `shotgun` and `sniper` in `WEAPON_SOUND_PATHS` (`src/audio/weaponSounds.ts`); `playGunshot` falls back to
synthesis when a buffer is missing (the MP5 gets the generic burst). A reverb send, a master gain and a flash-grenade low-pass
sit on the master bus. `updateAmbience` runs every tick: combat music follows the director phase, a heartbeat starts at low
health, and the Facility's looping track (`startBedMusic`, `BED_LEVEL`) replaces the synthesised music.

Underground (`AmbienceInputs` in `SoundEngine.ts`, helpers in `ambience.ts`): `Game` passes `undergroundAmount` only
while the player is below ground (`isBelowGround`), plus `reactorDistance`. `updateAmbience` raises the reverb send by
`undergroundReverbScale` (up to 1.6) and closes the reverb's low-pass from 14,000 Hz toward 1,800 Hz, a darker echo. A
reactor hum (48 and 50 Hz sines plus low-passed noise, built on first need) follows `reactorHumGain(distance)`: full
within 4 m of the lab's nearest reactor core, silent from 22 m, scaled by the music volume. Sounds that cross the
surface are muffled by `undergroundMuffleFactor` in `src/core/positionalAudio.ts` (0.35 when the listener and the source
are on different sides, else 1), applied to enemy and remote gunshots, remote footsteps, goose and grenade blasts.

Music files are `public/assets/music/<slug>.mp3`. They are gitignored (the licence forbids redistributing them and the repo is
public; `.gitignore` keeps only the folder's `README.md`), so they exist only in a working folder and on the deployed site.
`LOBBY_TRACK_IDS` in `lobbyPlaylist.ts` lists the seven lobby tracks; `floating-in-the-abyss` is the Facility track. The shuffle
favours unheard tracks and keeps its state in `localStorage` (`hunter-n-goose.lobby-music`). Missing files are tolerated. See
`docs/music.md`.

## 6. Config, version, loadout and modes

- **`src/core/version.ts`**: `GAME_VERSION`, the one source of truth, shown by `MainMenu` and re-exported as `APP_VERSION` in
  `config.ts` (sent with match telemetry). Bump it with a `docs/CHANGELOG.md` entry.
- **`src/core/config.ts`** (about 1,400 lines of named constants, grouped by comments): loop (`FIXED_TIMESTEP`,
  `MAX_FRAME_TIME`), `SPAWN_X`, `SPAWN_Z`, multiplayer (`MULTIPLAYER_MAX_PLAYERS` = 4, `PLAYER_SNAPSHOT_SEND_INTERVAL`,
  `MULTIPLAYER_RESPAWN_DELAY`, rejoin and timeout values), camera and shadows, `MatchMap` and `MatchWeather`, player movement,
  `ENEMY_*` (including the `ENEMY_DIRECTOR_*` pacing director), `GOOSE_*`, `HORDE_*`, `KOTH_*`, `PLAYER_HEALTH`, `FACILITY_*`,
  terrain and world size (`TERRAIN_*`, `WORLD_SIZE_CHUNKS`, `WORLD_BOUNDARY_RADIUS`), vegetation, zones, towns, and at the end
  the setup defaults (`DEFAULT_ENEMY_COUNT`, `DEFAULT_TARGET_COUNT`, `MAX_MATCH_ENTITY_COUNT`). Pickup tuning lives in
  `src/pickups/pickupConfig.ts`, grenade tuning in `src/combat/grenades/grenadeTuning.ts`, weapon stats in
  `src/weapons/definitions.ts`.
- **Seed offsets.** Each seeded subsystem derives its own stream as `mulberry32(worldSeed + offset)` (`src/utils/rng.ts`): zones
  10, 11, 12 and towers 13 (`config.ts`), archetypes 101, patrol 211, geese 311, facility 307, coordinator 401, director 419,
  tactics 431, facility doors 613, facility power and pickups 617.
- **`src/core/gameModes.ts`**: `GameMode` (`default`, `oneShotOneKill`, `sniperDuel`, `gunGame`, `knifeOnly`, `gooseToss`,
  `kingOfTheHill`, `gooseHorde`), `GAME_MODES`, labels, `grenadesEnabled`, `WEAPON_CATEGORIES`, `modeUsesCustomLoadout`,
  `resolveWeaponLoadout`, `pickGunGameUpgrade`. Game modes are multiplayer only; single-player picks Elimination, Director,
  Horde or Mission with checkboxes in `PlaySetupModal`, carried as `hordeMode`, `directorMode`, `missionMode` in `MatchConfig`.
- **`src/core/loadout.ts`**: the player's chosen weapons and grenade in `localStorage` key `fps-game-loadout`
  (`loadStoredLoadout`, `saveLoadout`, `equipWeapon`). Only the three unrestricted modes (`default`, `kingOfTheHill`,
  `gooseHorde`) use it; the others fix or rotate weapons. `ui/menu/LoadoutScreen.ts` edits it.
- **Mode flow in multiplayer.** The host picks mode, map, weather, kill limit and goose difficulty in `CreateRoomScreen`; they
  travel in `matchStart` and `WelcomeMessage.activeMatch` (`src/network/protocol.ts`) into a `MultiplayerSession`
  (`src/network/MultiplayerSession.ts`). Briefing text: `src/core/modeExplanations.ts`.

## 7. Build, test and deploy

### 7.1 Scripts (`package.json`)

| Script | Runs |
|---|---|
| `npm run dev` | `vite` dev server (port 5173 by default). |
| `npm run build`, `npm run typecheck` | `tsc --noEmit && vite build` into `dist/`; `tsc --noEmit` alone. `tsconfig.json` includes only `src`: `e2e/`, `scripts/` and `functions/` are not type-checked. |
| `npm run test:unit` | `vitest run`. |
| `npm run test:e2e`, `:quick`, `:group -- <names>`, `:full` | `scripts/e2e.mjs`: changed groups, the four `@quick` tests, named groups, everything but perf. |
| `npm run deploy` | `npm run build && npx wrangler pages deploy dist --project-name hunter-n-goose`. |

### 7.2 Vite, Vitest, Playwright

- `vite.config.ts` is minimal: root `.`, `publicDir: 'public'` (copied as is, which is how music reaches production),
  output `dist`, target `es2022`. `vitest.config.ts` runs `src/**/*.test.ts` (130 files) and `scripts/**/*.test.mjs` in the
  `node` environment: unit tests are for pure logic; anything needing WebGL, WASM or a DOM goes to e2e.
- `playwright.config.ts`: `testDir: ./e2e`, one worker, no retries, Chromium. A `webServer` runs `npm run dev -- --port
  <E2E_PORT or 5173> --strictPort` and reuses a running one. `storageState` seeds `fps-game-settings-v1` with graphics
  `low` (`E2E_GRAPHICS` overrides); specs that judge the look use `test.use({ storageState: SHIPPED_GRAPHICS })`.
- `e2e/helpers.ts`: `waitForGameReady` (clicks PLAY and Start Match, waits for `window.__gameDebug`), `lockPointer`, `equipPistol`,
  `waitForGameTime` (counts game time the way `Loop` does), `holdKey`, `openPauseMenu`, `killPlayerByEnemy`.
- `scripts/e2e.mjs` and `scripts/e2eGroups.mjs` map changed files to groups (`quick`, `core`, `ai`, `mission`, `ui`, `world`,
  `facility`, `pickups`, `houses`, `grenades`, `mp`, `mp4`, `perf`) through `RULES`, then call `npx playwright test`; `--dry`
  prints the plan. `scripts/e2eGroups.test.mjs` checks the rules and that every spec belongs to a group, so a new spec must
  be added to `GROUPS`. The suite runs at about 2 FPS on software rendering: run the groups a change needs. Details:
  `docs/testing.md`.

### 7.3 Cloudflare Pages and Functions

`functions/api/` holds two Pages Functions, served at `/api/...` on Cloudflare only:

- `functions/api/turn-credentials.ts` (`onRequestGet`) proxies Metered.ca for TURN relay credentials using `METERED_API_KEY`
  and `METERED_APP_NAME` (dashboard variables). With none set it returns an empty list and multiplayer is STUN-only. Called by
  `buildIceServers` in `src/network/PeerConnection.ts`.
- `functions/api/telemetry.ts` (`onRequestPost`) accepts the beacon from `Game.sendMatchTelemetry` (`mode`, `waveOrKills`,
  `durationMs`, `version`), stores it only if a KV namespace `MATCH_TELEMETRY` is bound, and always answers 204.

`npm run deploy` builds locally and uploads `dist/`, so what ships is the working folder, music included. Live site:
`hunter-n-goose.pages.dev` (`README.md`).

## 8. Where do I change X

| Change | Files | Pattern to copy |
|---|---|---|
| Add a weapon | `src/weapons/definitions.ts` (`WEAPON_DEFINITIONS` entry), `src/weapons/models/arsenal.ts` (`builders`, `WEAPON_MODEL_TUNING`), `src/core/gameModes.ts` (`WEAPON_CATEGORIES`, `GUN_GAME_POOL`), `src/ui/menu/LoadoutScreen.ts` (`CATEGORY_DISPLAY_ORDER`), optionally `src/audio/weaponSounds.ts` | The `mp5` entry in each. View models are built from code, not `.glb`. |
| Add a grenade kind | `src/combat/grenades/grenadeTuning.ts` (`GRENADE_KINDS`), `grenadeModels.ts`, `grenadeBlast.ts`, `GrenadeSystem.ts`; `src/network/protocol.ts` checks kinds with `isGrenadeKind` | The `flash` kind. |
| Add a HUD widget (or a readout on `Hud`: a setter in `src/ui/hud.ts`, called near the end of `Game.update`) | New `src/ui/<name>.ts`; build it in `Game.create` with `hudRoot`, add it to the `Game` constructor, `update(dt)` in `Game.update`, `dispose()` in `Game.dispose` | `src/ui/hitMarker.ts`, `src/ui/killFeed.ts`. |
| Add a setting | `src/settings/Settings.ts` (`StoredSettings`, `defaults`, `loadFromStorage`, getter and setter), a row in `src/ui/menu/SettingsPanel.ts`, readers call `Settings.getX()` | Field of view: `getFov`, `setFov`, `onFovChange`. |
| Add a rebindable action | `src/input/actions.ts` (`Action`, `DEFAULT_KEY_BINDINGS`, `REBINDABLE_ACTIONS`, `ACTION_LABELS`), `src/input/GamepadInput.ts` (`GAMEPAD_ACTIONS`), consume with `input.consumeJustPressed` in `Game.update` | The `flashlight` action. |
| Add a menu screen | New class in `src/ui/menu/` using `menuStyles.ts`; build it in the `App` constructor and wire show and hide through callbacks | `src/ui/menu/MultiplayerMenu.ts`; add `ModalScope` if it opens over another overlay. |
| Add a main-menu or pause-menu button | `src/ui/menu/MainMenu.ts` and `App`; `src/ui/menu/PauseMenu.ts` and its construction in `Game.create` | The `onLoadout` callback in both. |
| Add a sound effect | A `playX` method in `src/audio/SoundEngine.ts`, called where the event happens (pass `volumeScale` and `pan` from `src/core/positionalAudio.ts` for world sounds) | `playTorchClick`, `playPickup`. A recorded sample needs a loader like `loadWeaponSoundBuffers`. |
| Add lobby music | `public/assets/music/<slug>.mp3`, the slug in `LOBBY_TRACK_IDS` (`src/audio/lobbyPlaylist.ts`), `docs/music.md` | Existing slugs; the files are gitignored. |
| Change a Valley constant | `src/core/config.ts` (`TERRAIN_*`, `VEGETATION_*`, `FLAT_ZONE_*`, `TOWN_*`, `WORLD_SIZE_CHUNKS`) | Read the constant's comment first: world size is tied to boundary and ramp values. Background: `docs/world-generation.md`. |
| Change the Facility | `src/world/facility/facilityLayout.ts` (generator), `FacilityBuilder.ts`, `facilityModes.ts`; `FACILITY_*` in `src/core/config.ts` | `docs/facility-map.md`; tests in `src/world/facility/*.test.ts`. |
| Add a Valley house design | `src/world/houseDesigns.ts` (`HOUSE_DESIGNS`), `src/world/houses/houseLayout.ts` | The three existing designs. |
| Add a weather or look | `MatchWeather`, `MATCH_WEATHERS` and labels in `src/core/config.ts`, `LOOK_PRESETS` in `src/render/look.ts`, torch rules in `src/render/Flashlight.ts` | `fog`; the setup menus iterate `MATCH_WEATHERS`. |
| Add a map | `MatchMap`, `MATCH_MAPS` in `src/core/config.ts`; a branch beside `isFacility` in `Game.create` and `dispose`; `helloSupportsMap` and `CLIENT_FEATURES` in `src/network/protocol.ts` | The Facility. |
| Add a multiplayer mode | `src/core/gameModes.ts` (type, `GAME_MODES`, labels, `GRENADES_ENABLED`, loadout), `src/core/modeExplanations.ts`, `findWinner` in `src/network/MultiplayerMatchState.ts`, a controller in `src/core/modeControllers/` built in `Game.create` and updated in `Game.update`, cases in `src/network/MatchMessageRouter.ts` | `GunGameController` (small), `KingOfTheHillController`. `CreateRoomScreen` lists `GAME_MODES` itself. |
| Add a single-player mode | `MatchSetupConfig` and a checkbox in `src/ui/menu/PlaySetupModal.ts`, `MatchConfig` and `Game.encounterCounts` in `src/core/Game.ts`, defaults in `App.openPlaySetup` and the literal in `App.createMultiplayerGame` | `missionMode`, end to end. |
| Add a pickup kind | `src/pickups/pickupConfig.ts` (`PickupKind`, mix, respawn), `pickupEffects.ts`, `pickupPlacement.ts` (`pickupKindsForMode`), `PickupVisuals.ts` and `src/ui/minimap.ts` (both `Record<PickupKind, ...>`), `SoundEngine.playPickup` | The `grenade` kind; design in `docs/pickups.md`. |
| Add an enemy archetype | `ENEMY_ARCHETYPES` in `src/entities/enemies/archetypes.ts`; numbers are `ENEMY_*` in `src/core/config.ts` | An existing entry. |
| Add a network message | `src/network/protocol.ts` (interface, `NetworkMessage` union, `MESSAGE_TYPES`, validation in `isNetworkMessage`), a case in `MatchMessageRouter.ts` (plus `RELAYABLE_MESSAGE_TYPES` if the host relays it), `src/network/senderAuthority.ts` (who may send it), send from `Game` | `pickupClaim`; tests `src/network/protocol.test.ts`, `senderAuthority.test.ts`. |
| Add a debug hook for e2e | `GameDebugApi` in `src/core/gameDebugApi.ts` and the object in `Game.installDebugApi` | `getPickups`. |
| Add an e2e spec | `e2e/<name>.spec.ts` using `e2e/helpers.ts`, then register it in `GROUPS` in `scripts/e2eGroups.mjs` | `e2e/pickups.spec.ts`. |
| Cut a release | `src/core/version.ts`, `docs/CHANGELOG.md`, then `npm run deploy` | Previous entries. |

## 9. Gotchas

Each item was confirmed in the code.

1. **CRLF in the working tree.** On this Windows setup `core.autocrlf` is `true` (Git for Windows system config; no
   `.gitattributes`), so `git ls-files --eol` shows `i/lf w/crlf` for `src/core/Game.ts`, `package.json` and the docs. A tool or
   script that matches multi-line text with `\n` may fail to find it. Check with `git ls-files --eol <file>`.
2. **`Game.create` is about a thousand lines of closures** over locals and the not-yet-existing `game`. A callback that needs a
   new system usually needs a forward reference (`gameRef`, or `game.x = ...` right after construction), as `pickups` does.
3. **Read `game.weaponManager`, never a captured manager.** A loadout change rebuilds it at the next respawn
   (`applyPendingLoadoutIfNeeded`); the router context exposes it through a getter for this reason.
4. **One `SoundEngine` per match, none in the lobby** (the lobby uses `LobbyMusic`). Browsers cap `AudioContext`s, so
   `Game.dispose` must close it. Sound needs a gesture: `Game.create` adds a one-time document click calling `sound.resume()`.
5. **Module-level state outlives a `Game`.** `setHeightOverride`, `setEnemyNavigator`, `setEnemyDoorGate`, `setEnemyFloor`,
   `setEnemyEntrance`, the underground cut zones, terrain collider handles and volumes (`clearUnderground()` in
   `Game.create` and `Game.dispose`), the world seed (`src/core/worldSeed.ts`), `Settings` and the `gamepadInput` singleton are globals.
   `Game.create` resets the Valley ones and `Game.dispose` clears them; a new match-set global must be cleared the same way.
6. **The debug API is the e2e contract.** `Game.installDebugApi` assigns `window.__gameDebug` in the constructor (so it appears
   only once loading finishes) and `Game.dispose` sets it to `undefined`. `waitForGameReady` waits for it and specs read state
   through it (`getPlayerPosition`, `getLiveEntityStates`, `getFacilityDebug`, `teleport`, `lookAt`, ...). The type is
   `GameDebugApi` in `src/core/gameDebugApi.ts`, which also declares the global `Window` field. It has mutating hooks (`teleport`, `setPlayerInvulnerable`, `placeEnemy`,
   `commandEnemy`, `setFacilityDoor`, `throwGrenade`, `setTowerDoor`) beside the read and aim ones. The underground adds
   `getUndergroundDebug()` (the eased `amount`, whether the player is `underground` by `isUnderground`, `torchAvailable`
   here, and every lab's `index`, `kind`, `x`, `z`, `groundY`, `floorY`, `doorId` and a walk `route` of floor points in
   world coordinates) and `setTowerDoor(index, open)` (a tower door through the same rules as a key press, like
   `setValleyDoor`). Teleport takes the capsule centre, so a spec stands 1 m above a route point. A spec that needs a
   lab reads `getUndergroundDebug().labs` rather than guessing, since the kind and position depend on the seed.
7. **`e2e` is outside `tsconfig.json`** (it includes only `src`), and Playwright does not type-check, so a type error in a spec
   is not caught by `npm run typecheck`. `e2e/global.d.ts` declares `Window.__gameDebug`; two specs also redeclare it
   (`e2e/multiplayer-combat.spec.ts`, `e2e/multiplayer-match.spec.ts`).
8. **Pause and death differ solo versus multiplayer.** Solo freezes the whole simulation while paused. Multiplayer keeps physics,
   geese and damage running, and a death while paused defers the death screen (`pendingDeathScreenReveal`). The `resetPlay`
   action does nothing in multiplayer unless the player is dead.
9. **Multiplayer has no AI.** `Game.create` skips `spawnEncountersAsync` when a session exists, and `App.createMultiplayerGame`
   passes `enemyCount: 0` and `targetCount: 0` only to fill `MatchConfig`. The host is authoritative for geese; each client is
   authoritative for its own health.
10. **The Facility nulls many fields** (`chunkManager`, `buildings`, `watchTowers`; `facility` is null on the Valley), so `Game`
    uses optional chaining; keep that. Facility lamps are not colliders: shots test them in `handleHitscanRay`.
11. **Seed offset 617 is used twice.** `FACILITY_POWER_SEED_OFFSET` (`src/core/config.ts`) and `PICKUP_SEED_OFFSET`
    (`src/pickups/pickupConfig.ts`) are both 617. They seed different generators, so it is harmless, but check the list in
    section 6 before picking a new offset.
12. **The world is 400 m across** (`WORLD_SIZE_CHUNKS` 4 times `TERRAIN_CHUNK_SIZE` 100), so trust the constants over any
    older doc that says 800 or 1200. Snapshots go at `PLAYER_SNAPSHOT_SEND_INTERVAL` = 1/30 s.
13. **Music files are not in git** (`public/assets/music/*` is ignored). A fresh clone runs but logs 404s, and `npm run deploy`
    ships whatever is on the deploying machine.
14. **The Cloudflare Functions do not run under `vite dev`.** The TURN fetch falls back to STUN and the telemetry `fetch` swallows
    its error. Test the Functions on a Pages preview.
15. **F3 and F4 bypass the action system** (`Game.onDebugKeyDown`): the perf overlay and perf log are not rebindable.
16. **`main.ts` does not await `App.create`, and `App` has no explicit state.** An error inside `App.create` is an unhandled
    rejection. When adding a transition, check which of `lobby`, `currentGame` and `currentMultiplayerSession` it sets or clears.
