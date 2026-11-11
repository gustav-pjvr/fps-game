# Architecture (v4.5.0)

Hunter 'n Goose is a browser first-person shooter written in TypeScript on Three.js (rendering), Rapier
(physics, WebAssembly) and PeerJS (WebRTC multiplayer), built with Vite and deployed to Cloudflare Pages.
There is no game engine, no UI framework and no game server. This page is the map; the three files under
`architecture/` hold the detail, and [README.md](README.md) indexes everything else.

| Read | For |
|---|---|
| [architecture/core.md](architecture/core.md) | App and Game, the loop, rendering, input, UI, audio, config, build, tests, deploy |
| [architecture/world-and-combat.md](architecture/world-and-combat.md) | The two maps, houses and doors, enemies and their AI, weapons, grenades, pickups |
| [architecture/multiplayer-and-modes.md](architecture/multiplayer-and-modes.md) | Topology, protocol, who decides what, join and rejoin, every game mode |

Each of them ends with a "Where do I change X" table and a list of gotchas. Read those before editing.

## The shape of the program

Two lifetimes, and almost everything belongs to exactly one of them.

- **The lobby lifetime** is `App` (`src/core/App.ts`). It starts at page load, owns every menu and overlay
  (main menu, loadout, settings, match setup, multiplayer rooms, loading screen, match-end screen), the drifting
  lobby scene (`src/lobby`) and the lobby music (`src/audio/LobbyMusic.ts`). `App` has no state enum: the state
  is whichever of `lobby`, `currentGame` and `currentMultiplayerSession` are set.
- **The match lifetime** is `Game` (`src/core/Game.ts`, about 3,600 lines). `Game.create` builds everything for one
  match (renderer, physics, world, player, enemies, HUD, sound engine, network wiring) and `Game.dispose` tears it
  all down. Returning to the lobby, or a rematch, throws the `Game` away and builds a new one. Nothing about a
  match is meant to survive it, except a few module-level globals that `Game.create` and `Game.dispose` reset (see
  core.md, gotchas).

A match runs on a fixed-timestep loop (`src/core/Loop.ts`): the simulation advances in 1/60 s ticks
(`Game.update`) and one render follows each frame. Input is turned into actions (`src/input`), actions drive
the player and weapons, the world, enemies and projectiles update, the network sends and applies messages, and
the HUD reads the result.

## Principles that shape the code

1. **The world is a function of a seed.** Terrain, vegetation, buildings, houses, the Facility layout, its doors
   and power zones, pickup placement and the lab under each watch tower all derive from one world seed (`src/core/worldSeed.ts`) through seeded
   random streams with fixed seed offsets. In multiplayer the host sends the seed and every client builds the
   identical world; no world data crosses the network. Anything that shapes the world must therefore use the
   seeded RNG (`src/utils/rng.ts`), never `Math.random()`, and a new random stream needs an unused seed offset.
2. **No server: a host browser is the authority.** Multiplayer is a star around the host with direct links
   between guests for movement and shots. The host decides shared state (the goose, doors and breakers, pickups,
   King of the Hill, the winner); the thrower decides a grenade; each client decides its own health. Every
   message is validated by who sent it and by numeric bounds (`src/network/senderAuthority.ts`, `protocol.ts`).
3. **Multiplayer is player against player.** Enemy AI and the Director and Uplink modes exist only in solo.
4. **The UI is hand-built DOM and canvas.** HUD and menus are TypeScript classes writing styles directly; there is
   no React and no CSS framework. Controller navigation of menus is a layer on top (`src/ui/gamepadFocus.ts`).
5. **Sound is synthesized and spatial.** `SoundEngine` (one per match) builds every effect from oscillators and
   noise and places it in the world: callers pass a position, and the engine works out loudness, direction and
   what lies between (`docs/sound.md`). Only the two recorded music uses are files.
6. **Tests drive the real game.** Playwright specs talk to a debug API the match installs (`window.__gameDebug`,
   `src/core/gameDebugApi.ts`), so the e2e suite is part of the contract of `Game`.

## Source map

| Directory | Holds | Detail |
|---|---|---|
| `src/main.ts`, `index.html` | The four mount points (lobby canvas, game canvas, HUD, overlay) and boot | core.md section 1 |
| `src/core/` | `App`, `Game`, `Loop`, `Renderer`, `config.ts` (constants), game modes and their controllers, loadout, mission, world seed, version | core.md, multiplayer-and-modes.md |
| `src/world/` | Valley terrain, chunk streaming, zones and towns, buildings, vegetation, watch towers; `underground.ts`, `towerUnderground.ts`, `labInterior.ts` and `undergroundLights.ts` (the ground room, stairs and lab under each tower); `facility/` (the indoor map), `houses/` and `doors/` (enterable Valley houses) | world-and-combat.md section 1.7, [underground-lab.md](underground-lab.md) |
| `src/entities/` | Player, remote players, enemies and their AI, the Goose | world-and-combat.md |
| `src/weapons/`, `src/combat/` | Weapon definitions and view models; hitscan, damage, explosions, tracers, `grenades/` | world-and-combat.md |
| `src/pickups/` | Health, ammo and grenade pickups | world-and-combat.md |
| `src/physics/` | The Rapier wrapper | world-and-combat.md |
| `src/render/` | Look presets, lighting, flashlight and post-processing helpers | core.md section 3 |
| `src/network/` | `PeerConnection`, host roster, guest mesh and direct links, protocol, message router, sender authority | multiplayer-and-modes.md |
| `src/input/` | Keyboard, mouse and gamepad, actions and bindings | core.md section 4, controller.md |
| `src/settings/` | Persisted settings and graphics presets | core.md section 4 |
| `src/ui/` | HUD, menus (`ui/menu`), minimap, match-end screen, gamepad focus | core.md section 4, ui-lobby.md |
| `src/audio/` | Sound engine, loudness and occlusion rules, the mix, ambience, lobby music, weapon sounds | sound.md, core.md section 5, music.md |
| `src/world/glass/` | The glass in the house windows: state, geometry, drawing | glass.md |
| `src/soundlab/` | The sound test page (`soundlab.html`) | sound.md |
| `src/lobby/` | The pre-match lobby scene | core.md section 1 |
| `src/utils/`, `src/types/` | Seeded RNG and helpers; type shims | |
| `e2e/`, `scripts/` | Playwright specs, the group runner | testing.md |
| `functions/` | Cloudflare Pages Functions: TURN credentials, telemetry | core.md section 7 |

## A match, end to end

1. The player picks Play (solo) or creates or joins a room (multiplayer). Solo setup reads the map, weather,
   enemy and target counts and the solo mode; multiplayer takes the host's choices, including the seed.
2. `App` hides the menus, stops the lobby music, shows the loading screen and calls `Game.create`.
3. `Game.create` sets the seed, then builds the renderer, input, physics and the map (Valley chunks and
   buildings, or the Facility layout), the lighting and torch, the player and the weapon manager, the sound
   engine (plus the indoor music track on the Facility), the pickups, the HUD, and either the enemies and
   targets (solo) or the remote players and network router (multiplayer).
4. `game.start()` starts the loop. Each tick processes input, moves the player, steps physics, updates the AI,
   grenades, pickups and doors, applies and sends network messages, and updates the HUD and the sound.
5. The match ends by death (solo), a kill limit or horde result (multiplayer, decided by the host), or the player
   leaving. `App` returns to the lobby with a fresh lobby scene, or restarts a multiplayer match on the same
   connection (rematch).

## Rules that bite

- **Fixed light counts.** The Facility compiles its shaders for a fixed number of lights; a feature must not add
  a light mid-match (use the pooled lights; see world-and-combat.md).
- **Host-authoritative messages need three places edited:** the protocol type, the sender-authority rule and the
  router case. The checklist is in multiplayer-and-modes.md.
- **Read the live manager.** A loadout change rebuilds `game.weaponManager` at the next respawn; never keep a
  captured reference.
- **Module-level state outlives a `Game`.** Anything set globally for a match must be cleared in `Game.dispose`
  (the underground zones, volumes and terrain handles are cleared by `clearUnderground()`).
- **The ground is not always the floor.** Inside a watch tower's cut zone the terrain is not solid, so a new ray
  caller uses `castRaySkippingCuts`, anything that rests on the ground asks `floorBelow(world, x, y, z)` instead of
  `sampleHeight`, and a rule that depends on being down uses `isBelowGround`. `isUnderground` is only for light, the
  torch and floors (world-and-combat.md section 1.7).
- **Files are CRLF on this Windows setup.** Edit with a tool that keeps line endings.
- **The repo is public:** never commit secrets, and the music files are gitignored (music.md).

## Reading order for a new contributor

1. This page, then [workflow.md](workflow.md) (how changes are made and tested).
2. The "Where do I change X" table in the architecture file for the area you will touch.
3. The as-built feature doc for that area ([README.md](README.md) lists them), then the code.
4. [testing.md](testing.md) before running any browser test.
