# Fable rebuild: progress log

A fresh session starts here, then reads `docs/fable-rebuild-brief.md` and
`docs/fable-rebuild-decisions.md`. Worktree: `../fps-game-fable`, branch `feature/fable-rebuild`,
base `master` at v4.7.1 (`30e49e9`). `node_modules` is a junction to the main checkout.

## Phases

| # | Phase | State |
|---|---|---|
| 0 | Setup: worktree, logs, baseline checks, baseline performance | in progress |
| 1 | Arsenal: kit, 20 weapon models, definitions, handling, animations, sounds | next |
| 2 | Skins: six families, storage, snapshot fields, remote held weapon, aim-point test | |
| 3 | Menus: Loadout rework, Skins screen with aimed preview, screenshots spec | |
| 4 | Shared co-op systems: pings, down and revive, squad panel, end screen stats | |
| 5 | King of the Hill rebuild | |
| 6 | Goose Horde rebuild (solo and co-op) | |
| 7 | Uplink operation rebuild (solo) | |
| 8 | Director Showdown rebuild (solo) | |
| 9 | Co-op enemies, then co-op Uplink and Showdown | |
| 10 | New specs, full suite, performance after, docs, changelog, version | |
| 11 | Preview deploy, handover report | |

## Done so far

- 2026-11-10: worktree and junction created. Brief, architecture, workflow, testing, weapons and
  multiplayer docs read. Three read-only surveys (Game.ts, enemy and mode systems, UI and audio).
- Baseline on the untouched tree: `npm run typecheck` clean; `npm run test:unit` 1434 of 1435 passed, the
  one failure (`EnemyBrain.test.ts`, "search" case) passed when rerun alone (load flake: three agents
  were reading at the same time).
- `e2e/perf-log.spec.ts` takes `PERF_GRAPHICS=low|high` so the same run measures more than one tier.
- Baseline snapshot for performance: `C:\tmp\fable-base` (port 5190). Logs in `C:\tmp\fable-logs\`.

## Last checks

| Check | Result |
|---|---|
| typecheck (baseline) | clean |
| unit (baseline) | 1434/1435, flake passes alone |
| perf baseline Medium and Low | running |

## Next

1. Record the baseline performance numbers here when the run ends.
2. Phase 1: write the model kit and two exemplar guns (rifle, pistol), then the rest in parallel.

## New network message types (for the relay routing table)

None yet. Planned: `kothState` (B), `kothCrownClaim` (H), `ping` (R), and the co-op and enemy messages.

## Open issues

None yet.
