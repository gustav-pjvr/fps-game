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
| `npx playwright test e2e/<spec>` | one spec | rerunning a failure |

Add `--dry` to see the plan without running it, and `--base <ref>` to compare with another ref
(`npm run test:e2e -- --base master`). Flags after `--` go to Playwright.

## Groups

| Group | Specs | Picked by changes to |
|---|---|---|
| quick | `@quick` tests in `smoke.spec.ts` | enemies, hitboxes, UI, world, render, audio, settings, public assets |
| core | `smoke.spec.ts` | weapons, combat, input, the player, `Game.ts`, `App.ts`, `config.ts`, any src file no rule names |
| ai | `enemy-ai.spec.ts`, `director.spec.ts` | enemies, `EntityManager.ts`, targets, hitboxes, character models, `config.ts` |
| mission | `mission.spec.ts` | `core/mission/`, uplink beacons, world markers, the death screen, `Game.ts` |
| ui | `ui-qa.spec.ts` | `src/ui/`, `index.html`, `App.ts` |
| world | `world-bounds.spec.ts` | `src/world/` |
| facility | `facility.spec.ts`, `multiplayer-facility.spec.ts`, `facility-modes.spec.ts` | `src/world/facility/`, the torch, the minimap, `Game.ts` |
| mp | the six `multiplayer*.spec.ts` | network, lobby, remote players, game modes, room screens, the match end screen, hitboxes, `App.ts` |
| perf | `perf-log.spec.ts`, `performance-check.spec.ts` | never by a change: measurements, run by name before a release or after render work |

Docs, `reference/`, Markdown and unit-test files run no e2e spec. A changed spec runs itself. The
shared helpers (`e2e/helpers.ts`, `e2e/global.d.ts`), `playwright.config.ts`, `vite.config.ts`,
`tsconfig.json` and `package.json` run the full suite. The rules live in `scripts/e2eGroups.mjs`
with their own unit tests, including a check that every spec in `e2e/` belongs to a group: a new
spec has to be added there.

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
