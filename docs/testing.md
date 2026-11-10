# Testing

Two layers: Vitest unit tests (`src/**/*.test.ts`, seconds, run them on every change) and the
Playwright e2e suite in `e2e/` (a real browser, the full game, software rendering here: well over an
hour for everything). The e2e suite is split into groups so a change runs only what it can affect.

## Which e2e specs to run

| Command | Runs | When |
|---|---|---|
| `npm run test:e2e` | the groups the changed files need (since the pushed branch, plus uncommitted and new files) | after a change, the default |
| `npm run test:e2e:quick` | the four `@quick` smoke tests: load, pointer lock, movement, shoot a target (about 2 minutes) | a quick sanity check |
| `npm run test:e2e:group -- ai mp` | the named groups | when you know what a change touches |
| `npm run test:e2e:full` | every group but perf | only when absolutely necessary: a change to what every spec shares. A release or a merge to master runs the groups its changes map to, one group at a time (Gustav, 2026-10-24) |
| `npm run test:e2e:group -- mp4` | the four-player spec: host plus three guests in four contexts, up to a quarter of an hour, run on its own | a change to the squad network files |
| `npx playwright test e2e/<spec>` | one spec | rerunning a failure |

Add `--dry` to see the plan without running it, and `--base <ref>` to compare with another ref
(`npm run test:e2e -- --base master`). Flags after `--` go to Playwright.

## Groups

| Group | Specs | Picked by changes to |
|---|---|---|
| quick | `@quick` tests in `smoke.spec.ts` | enemies, hitboxes, UI, world, render, audio, settings, public assets |
| core | `smoke.spec.ts` | weapons, combat, input, the player, `Game.ts`, `App.ts`, `config.ts`, any src file no rule names |
| ai | `enemy-ai.spec.ts`, `director.spec.ts` (the director and Showdown) | enemies, `EntityManager.ts`, targets, hitboxes, character models, `config.ts`, the Showdown panel |
| mission | `mission.spec.ts` | `core/mission/`, uplink beacons, world markers, the death screen, `Game.ts` |
| ui | `ui-qa.spec.ts` | `src/ui/`, `index.html`, `App.ts` |
| world | `world-bounds.spec.ts`, `underground.spec.ts` | `src/world/`; `underground.ts`, `towerUnderground.ts`, `labInterior.ts` and `undergroundLights.ts` pick only this group (not `quick`) |
| facility | `facility.spec.ts`, `facility-doors.spec.ts`, `facility-modes.spec.ts`, `multiplayer-facility.spec.ts`, `pickups.spec.ts`, `solo-weather.spec.ts` | `src/world/facility/`, the torch, the minimap, `Game.ts` |
| pickups | `pickups.spec.ts` | `src/pickups/` |
| houses | `houses.spec.ts` | `src/world/houses/`, `src/world/doors/`, the house plan on the minimap |
| grenades | `grenades.spec.ts` | `src/combat/grenades/`, the grenade arm, the danger marker, the flash white-out and deafness, `Game.ts` |
| mp | seven specs: `multiplayer`, `multiplayer-underground`, `-match`, `-combat`, `-moving-target`, `-matchend`, `-pause-damage` (`multiplayer-facility` is in facility, `multiplayer-four` in mp4) | network, lobby, remote players, game modes, room screens, the match end screen, hitboxes, `App.ts` |
| skins | `skins.spec.ts` | weapon models and clips (`src/weapons/models/`, `animation/`), `viewModel.ts`, `core/skins.ts`, the Skins screen and its preview. Equips every skin on every gun and saves a screenshot of each aimed view. |
| modes | `koth.spec.ts`, `horde.spec.ts` | the rebuilt modes' rules and presenters (`hillState`, `KingOfTheHillController`, `reviveRules`, `SquadController`, the horde files, their panels) and `e2e/coop.ts`. Each test opens two to four browser contexts over real WebRTC (a late join and a rejoin among them) and takes 6 to 20 minutes on software rendering. |
| mp4 | `multiplayer-four.spec.ts` | the 3 to 4 player network files (`GuestMesh`, `directLinks`, `matchSync`, `HostRoster`, `PeerConnection`, `MatchMessageRouter`); not part of mp, and in the full suite |
| perf | `perf-log.spec.ts`, `performance-check.spec.ts` | never by a change: measurements, run by name before a release or after render work |

Docs, `reference/`, Markdown and unit-test files run no e2e spec. A changed spec runs itself. The
shared helpers (`e2e/helpers.ts`, `e2e/global.d.ts`), `playwright.config.ts`, `vite.config.ts`,
`tsconfig.json` and `package.json` run the full suite. The rules live in `scripts/e2eGroups.mjs`
with their own unit tests, including a check that every spec in `e2e/` belongs to a group: a new
spec has to be added there.

## The underground specs

Both run on the Valley and read the seeded labs from `window.__gameDebug.getUndergroundDebug()`, so they do not
depend on a fixed seed (`docs/architecture/core.md` gotcha 6 lists the hooks). Unit tests carry the walking and
geometry proofs (`towerUnderground.test.ts`, with a real Rapier world), so the specs only prove the wiring.

- **`e2e/underground.spec.ts`** (group `world`): solo Valley at Dusk with no enemies, viewport 640 by 360, timeout
  600,000 ms. On a full lab it checks that a collision ray hits the closed tower door and a walk into it is stopped, that
  E on the door opens it (`facilityLookTarget` reports the door id) and a walk through works, then teleports along the
  lab's `route` to the floor and back. At the bottom the underground flag is true, the light amount is 1 and the torch is
  available; back on the surface the amount is 0, the flag is false and the Dusk torch is not available. It also fails on
  any page error. The route points are teleports: walkability is proven by the unit tests, not here.
- **`e2e/multiplayer-underground.spec.ts`** (group `mp`): a host creates a Valley room, a guest joins, the host opens tower
  door 0 with `setTowerDoor(0, true)`, and the guest's collision ray through the doorway must clear within five game
  seconds. Then a third context joins the running match late and must see the same open door. The test sets a 10 minute
  timeout (600,000 ms) because three browser contexts on software rendering run at about 2 frames a second each and the
  whole host, guest and late-join sequence measured just over five minutes in this sandbox. Treat a timeout with steps
  still advancing as a budget problem, not a hang. Run it alone (`npx playwright test e2e/multiplayer-underground.spec.ts`)
  when changing tower doors, `ValleyDoors` or the welcome message's door list.
- `e2e/pickups.spec.ts` (group `pickups`) now counts lab pickups too: 10 to 16 surface pickups, then exactly the lab
  sites the labs' kinds give (3 per full lab, 1 per compact lab).

## Graphics quality in tests

Behaviour specs run on Low graphics: `playwright.config.ts` seeds the settings through
`storageState`, which also reaches the contexts the multiplayer specs open themselves. The specs that
judge the rendered look run on the shipped default (Medium) by opting out with
`test.use({ storageState: SHIPPED_GRAPHICS })` from `e2e/helpers.ts`: `ui-qa.spec.ts`, both perf
specs, and the `@quick` load test that checks for console errors. Low is not a speed fix here: a
single page measured about 2.2 FPS on Low and on Medium alike (2026-10-23), because the CPU (physics,
world streaming, scripts) is the limit, not the renderer. `E2E_GRAPHICS=medium` (or `high`)
runs everything at that quality, for example before a release that changed rendering.

## Known slow spots

Every spec runs on SwiftShader here, at about 2 frames a second once a match is loaded, so the
Playwright default of 30 s is often too short. Long tests set their own budget with a comment that
records the measured time. A timeout with every step still advancing is a budget problem, not a
hang: read the trace's step times before changing code. Two pages at once (the multiplayer specs)
are slower still. Run one Playwright chain at a time per checkout. A second checkout (a git
worktree) running at the same time sets its own port, `E2E_PORT=5181 npm run test:e2e:group -- ...`,
so it starts its own dev server instead of reusing the other checkout's on 5173.
