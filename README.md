# Goose Dash Buster

A browser-based first-person shooter built from scratch with Three.js and Rapier physics — procedurally generated open world, AI enemies, a full weapon set, and up to 4-player peer-to-peer multiplayer with host-picked game modes. No game engine, no backend server: the world generates from a shared seed, and multiplayer runs entirely over WebRTC with one player's browser acting as host.

Live at **[gustavgame.netlify.app](https://gustavgame.netlify.app)**.

## Features

- **Procedural open world** — seeded terrain, zones (towns/forests), roads, vegetation, and 4 fixed watch towers, all generated client-side from a single world seed so every player in a multiplayer match sees the identical map.
- **Enemy AI** — patrol, aggro, line-of-sight, and ranged/melee combat behavior across several enemy archetypes with distinct loadouts.
- **Full weapon set** — pistol, rifle, shotgun, sniper, and knife, each with real ballistics (hitscan, spread, damage falloff), ADS, reload, and per-weapon sounds.
- **Goose Dash Buster mini-game** — a wandering goose that takes exactly 2 hits to kill, then explodes with distance-based falloff damage. Spawns at match start and again whenever a player dies. Multiplayer host picks an explosion difficulty (Easy/Normal/Extreme/Nuke).
- **Multiplayer (up to 4 players)** — host-relay star topology over PeerJS/WebRTC (with a TURN fallback for cross-network play), room codes, live lobby rosters, mid-match rejoin, positional audio, a shared minimap, and a full podium/scoreboard flow.
- **Host-picked game modes** (multiplayer only) — Default, 1 Shot 1 Kill, Sniper Duel, Gun Game, and Knife Only.
- **Graphics quality settings**, an in-game performance overlay, and rebindable controls.

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL (Vite will pick an open port starting at 5173). Click into the canvas to lock the pointer and start playing.

### Other scripts

```bash
npm run build       # type-check + production build (outputs to dist/)
npm run preview     # preview a production build locally
npm run typecheck   # tsc --noEmit only
npm run test:unit   # Vitest unit suite
npm run test:e2e    # Playwright end-to-end suite (spins up its own dev server)
```

## Controls

| Action | Key |
|---|---|
| Move | `W` `A` `S` `D` |
| Jump | `Space` |
| Sprint | `Shift` |
| Fire | Left click |
| Aim (ADS) | Right click |
| Reload | `R` |
| Switch weapon | `1`–`5`, or mouse wheel |
| Reset match | `T` |
| Pause / menu | `Esc` |

Movement, jump, sprint, reload, and reset-match are rebindable from the in-game settings panel.

## Multiplayer

One player creates a room and shares the generated code; up to 3 more players join with it. The host picks the kill limit, goose explosion difficulty, and game mode before starting the match — guests inherit all of it automatically, including a player who joins or rejoins after the match has already started. A dropped guest can rejoin the same room code and resume with their identity and score intact; the match continues uninterrupted for everyone else in the meantime.

No dedicated game server is involved — the host's browser is authoritative for match settings and shared world state (like the goose), and every other client relays through it.

## Tech stack

- **[Three.js](https://threejs.org/)** — rendering
- **[Rapier](https://rapier.rs/)** (via `@dimforge/rapier3d-compat`) — physics, collision, character controllers
- **[PeerJS](https://peerjs.com/)** — WebRTC data channels for multiplayer
- **[simplex-noise](https://www.npmjs.com/package/simplex-noise)** — terrain/world generation
- **[Vite](https://vitejs.dev/)** — dev server and build
- **[Vitest](https://vitest.dev/)** + **[Playwright](https://playwright.dev/)** — unit and end-to-end testing
- **TypeScript**, strict, no framework — the UI is hand-built DOM/canvas, no React/Vue

## Project structure

```
src/
  core/       App/Game orchestration, match config, game modes, world seed
  world/      Terrain, chunk streaming, zones, buildings, roads, vegetation, watch towers
  entities/   Player, remote players, enemies, the Goose
  weapons/    Weapon definitions, firing/reload logic, view models
  combat/     Hitscan, damage, explosions, muzzle flash, tracers, impact markers
  physics/    Rapier world wrapper
  network/    PeerConnection, host roster, multiplayer session/protocol
  audio/      Procedural sound engine and weapon sounds
  input/      Keybindings and input state
  settings/   Persisted settings, graphics quality presets
  ui/         HUD, menus, HUD widgets, minimap, match-end screen
  lobby/      Pre-match lobby scene
e2e/          Playwright end-to-end tests (including multi-browser-context multiplayer tests)
docs/         Development notes and planning documents
```

## Deployment

Deployed via Netlify (`netlify.toml`), including a serverless function for TURN credential issuance (`netlify/functions/turn-credentials.mts`) used as a fallback when direct peer-to-peer WebRTC connections can't establish across NATs.
