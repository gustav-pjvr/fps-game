# Documentation index

Current version 4.6.1. Where a document and the code disagree, the code is right; fix the document.

## Start here

| Document | What it is |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the game is built: boot flow, the match loop, a source map and the cross-cutting rules |
| [architecture/core.md](architecture/core.md) | App and Game, rendering, input, UI, audio, config, build, test and deploy, and a "where do I change X" table |
| [architecture/world-and-combat.md](architecture/world-and-combat.md) | The Valley and Facility maps, houses and doors, entities and enemy AI, weapons, grenades, pickups |
| [architecture/multiplayer-and-modes.md](architecture/multiplayer-and-modes.md) | Topology, protocol, authority, join and rejoin, every game mode |
| [workflow.md](workflow.md) | Branches and worktrees, testing, releases, documentation, working with agents |
| [testing.md](testing.md) | Unit and Playwright tests, the e2e groups and which specs a change runs |
| [CHANGELOG.md](CHANGELOG.md) | Release history from v1.0.0 (the version shown in the main menu) |

## Features, as built

| Document | Covers |
|---|---|
| [facility-map.md](facility-map.md) | The indoor Facility map: layout, lighting, torch, lamps, doors and breakers (sections 12 and 13), modes |
| [enterable-buildings.md](enterable-buildings.md) | Enterable Valley houses |
| [grenades.md](grenades.md) | Frag and flash grenades |
| [pickups.md](pickups.md) | Health, ammo and grenade pickups |
| [controller.md](controller.md) | Gamepad support |
| [night-and-visibility.md](night-and-visibility.md) | Darkness, enemy sight, torch, weather choice, flash blindness |
| [music.md](music.md) | Lobby shuffle, the Facility track, the licence and why the files are not in git |
| [ui-lobby.md](ui-lobby.md) | The lobby, death screen, menus, and the Loadout screen |
| [multiplayer.md](multiplayer.md) | Multiplayer in depth, with history; the last section covers 3 to 4 players (v4.4.0) |
| [goose-buster.md](goose-buster.md) | The exploding goose, King of the Hill and Goose Horde |
| [enemy-ai-v2.md](enemy-ai-v2.md) | The enemy AI as built (step by step) |
| [weapons-combat.md](weapons-combat.md) | Weapon view models, hotbar, long-shot callout, tree canopy collision |
| [visual-overhaul.md](visual-overhaul.md), [visual-overhaul-ui.md](visual-overhaul-ui.md) | The v4.0 look, HUD and menu reskin |
| [world-redesign.md](world-redesign.md) | The v4.1 world redesign (exteriors, towers, terrain) |
| [world-generation.md](world-generation.md) | World generation notes: terrain, chunks, zones, roads, vegetation |
| [squad-arsenal-night.md](squad-arsenal-night.md) | The v4.4.0 design (3 to 4 players, controller, grenades, doors, pickups, night, houses) |

## Performance

[PERFORMANCE.md](PERFORMANCE.md) is the playbook, [performance-notes.md](performance-notes.md) the investigation log.

## History (not the current state)

These explain why things are the way they are. Read them for background, not for how the game works now.

| Document | What it was |
|---|---|
| [NOTES.md](NOTES.md) | Index of the early development logs |
| [PLAN.md](PLAN.md), [WORLD_PLAN.md](WORLD_PLAN.md), [MULTIPLAYER_PLAN.md](MULTIPLAYER_PLAN.md), [VISUAL_REALISM.md](VISUAL_REALISM.md) | Original plans, mostly implemented and since changed |
| [enemy-ai.md](enemy-ai.md), [enemy-ai-v2-design.md](enemy-ai-v2-design.md) | The first enemy AI and the v2 design |
| [changelog-foundations.md](changelog-foundations.md), [CODE_REVIEW.md](CODE_REVIEW.md) | v1 foundations and the whole-codebase review |
