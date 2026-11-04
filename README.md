# Hunter 'n Goose

A browser first-person shooter built from scratch with Three.js and Rapier physics: a procedurally generated open valley, an indoor facility, AI enemies, a full weapon and grenade set, and up to 4-player peer-to-peer multiplayer with host-picked game modes. No game engine and no game server: the world generates from a shared seed, and multiplayer runs over WebRTC with one player's browser acting as host.

Live at **[hunter-n-goose.pages.dev](https://hunter-n-goose.pages.dev/)**. Current version: 4.5.0 (see `docs/CHANGELOG.md`).

New to the codebase? Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), then [`docs/workflow.md`](docs/workflow.md) for how work, tests and releases run here. [`docs/README.md`](docs/README.md) indexes every document.

## Features

- **Two maps.** The **Valley**: seeded terrain with rises, basins and ridgelines, towns, forests, roads, four watch towers, and enterable houses (three designs with doors, rooms, furniture, windows, stairs and lamps you can shoot out). The **Facility**: a seeded indoor map of rooms and corridors with sliding doors, a breaker panel per power zone, emergency lamps, and every game mode. Dusk (the default), night and fog weather on the Valley, chosen at match setup. See `docs/world-redesign.md`, `docs/facility-map.md`, `docs/enterable-buildings.md`.
- **Enemy AI (solo).** Several archetypes with distinct loadouts that notice you gradually, share what they know as a squad, limit themselves to two shooters at once while others flank, fight from cover, search in pairs when they lose you, and call out what they are doing. Darkness slows how fast they spot you, and flash grenades blind them. See `docs/enemy-ai-v2.md` and `docs/night-and-visibility.md`.
- **Solo modes.** Standard, Goose Horde, Director (a pacing director sends waves from out of sight and gives you a breather between peaks), and the Uplink mission (bring three watch-tower uplinks online, hold each, then extract).
- **Weapons.** Pistol, burst SMG, rifle, shotgun, sniper and knife, with real ballistics (hitscan, spread, damage falloff), ADS, reload, per-weapon sounds, glowing tracers and headshots that count triple.
- **Grenades.** Pick frag or flash in the Loadout and throw it with `Q` (hold to cook, with an arc preview). Frags explode in a fireball with smoke and sparks; flashes white out and deafen anyone facing them. See `docs/grenades.md`.
- **Pickups.** Health packs, ammo boxes and grenade crates on both maps. See `docs/pickups.md`.
- **Controller support.** Analog movement and aim, the full button layout, every menu navigable, button prompts, aim slowdown, vibration and settings. See `docs/controller.md`.
- **Goose Dash Buster.** A wandering goose that takes exactly 2 hits, then explodes with distance-based damage; a multiplayer host picks the explosion difficulty (Easy, Normal, Extreme, Nuke). See `docs/goose-buster.md`.
- **Multiplayer (up to 4 players).** Host-relay star over PeerJS and WebRTC (with a TURN fallback for cross-network play), guests that also link to each other directly for movement and shots, room codes, live lobby rosters, mid-match join and rejoin, positional audio, a shared minimap, and a podium and scoreboard flow. See `docs/multiplayer.md`.
- **Host-picked game modes (multiplayer).** Default, 1 Shot 1 Kill, Sniper Duel, Gun Game, Knife Only, Goose Toss, King of the Hill and Goose Horde (co-op), on either map.
- **Look and sound.** A stylised dusk look with bloom, colour grade and anti-aliasing (ambient occlusion on High), valley reverb, combat music that follows the fight, a heartbeat at low health, and recorded lobby and Facility music (`docs/music.md`).
- **Settings.** Graphics quality presets, an in-game performance overlay, rebindable keys, master and music volume, field of view and controller options.

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL (Vite picks an open port starting at 5173). Click into the canvas to lock the pointer and start playing.

The lobby and Facility music files are not in the repository (their licence forbids distributing them; see `docs/music.md`). The game runs without them and logs a 404 for each in the browser console.

### Scripts

```bash
npm run dev              # dev server
npm run build            # type-check + production build (outputs to dist/)
npm run preview          # preview a production build locally
npm run typecheck        # tsc --noEmit only
npm run test:unit        # Vitest unit suite (seconds)
npm run test:e2e         # Playwright groups for what changed since the pushed branch
npm run test:e2e:quick   # four smoke tests, about 2 minutes
npm run test:e2e:group -- <groups>   # named groups, for example: facility mp
npm run test:e2e:full    # every group but perf: only when absolutely necessary
npm run deploy           # build, then wrangler pages deploy dist
```

Which e2e groups to run, and why not all of them, is in `docs/testing.md`.

## Controls

Keyboard and mouse (move, jump, sprint, reload, reset, torch and grenade are rebindable in Settings):

| Action | Key |
|---|---|
| Move | `W` `A` `S` `D` |
| Jump | `Space` |
| Sprint | `Shift` |
| Fire | Left click |
| Aim (ADS) | Right click |
| Reload | `R` |
| Interact (uplinks, Facility doors, breakers, consoles) | `E` |
| Throw grenade | `Q` |
| Torch | `F` |
| Switch weapon | `1` to `5`, or mouse wheel |
| Reset match | `T` |
| Pause / menu | `Esc` |

A controller takes over the moment you use it; the button map is in `docs/controller.md`.

## Multiplayer

One player creates a room and shares the generated code; up to 3 more players join with it. The host picks the map, game mode, kill limit and goose explosion difficulty before starting; guests inherit all of it, including a player who joins or rejoins after the match has started. A dropped guest can rejoin the same room code and resume with their identity and score. No dedicated game server is involved: the host's browser is authoritative for match settings and shared world state (goose, doors, pickups, King of the Hill), and a guest that cannot open a direct link to another guest relays through the host.

## Tech stack

- **[Three.js](https://threejs.org/)** for rendering, with `postprocessing` and `n8ao` for effects
- **[Rapier](https://rapier.rs/)** (`@dimforge/rapier3d-compat`) for physics, collision and character controllers
- **[PeerJS](https://peerjs.com/)** for WebRTC data channels
- **[simplex-noise](https://www.npmjs.com/package/simplex-noise)** for terrain and world generation
- **[Vite](https://vitejs.dev/)** for the dev server and build
- **[Vitest](https://vitest.dev/)** and **[Playwright](https://playwright.dev/)** for unit and end-to-end tests
- **TypeScript**, strict, no UI framework: the UI is hand-built DOM and canvas

## Project structure

```
src/
  core/       App and Game orchestration, config, game modes, loadout, mission, world seed
  world/      Terrain, chunk streaming, zones, buildings, roads, vegetation, watch towers;
              facility/ (the indoor map), houses/ (enterable Valley houses), doors/
  entities/   Player, remote players, enemies and their AI, the Goose
  weapons/    Weapon definitions, firing and reload, view models
  combat/     Hitscan, damage, explosions, tracers, grenades/
  pickups/    Health, ammo and grenade pickups
  physics/    Rapier world wrapper
  render/     Renderer, lighting, post-processing
  network/    PeerConnection, host roster, guest mesh, protocol, sender authority
  audio/      Sound engine, ambience, lobby music, weapon sounds
  input/      Keyboard, mouse and gamepad input, actions and bindings
  settings/   Persisted settings, graphics quality presets
  ui/         HUD, menus (ui/menu), minimap, match-end screen, gamepad focus
  lobby/      Pre-match lobby scene
  utils/      Seeded RNG and small helpers
e2e/          Playwright end-to-end tests (including multi-browser multiplayer tests)
scripts/      The e2e group runner
functions/    Cloudflare Pages Functions (TURN credentials, telemetry)
docs/         Architecture, design and as-built notes, changelog (index: docs/README.md)
reference/    Character reference assets
production/   Publishing plans
```

## Deployment

Deployed to Cloudflare Pages with `npm run deploy` (`wrangler pages deploy dist`), including the Pages Functions for TURN credential issuance (`functions/api/turn-credentials.ts`) and a minimal match-end telemetry beacon (`functions/api/telemetry.ts`).

**Cross-network multiplayer needs a TURN relay.** Players on strict networks (work or school firewalls, carrier-grade NAT, managed devices) cannot reach each other directly, and PeerJS's old public relay no longer exists. The only relay the game offers is the one `functions/api/turn-credentials.ts` fetches from Metered.ca, and it stays empty until `METERED_API_KEY` and `METERED_APP_NAME` are set in the Cloudflare Pages project's environment variables. Check with `curl https://hunter-n-goose.pages.dev/api/turn-credentials`: `{"iceServers":[]}` means no relay is configured.
