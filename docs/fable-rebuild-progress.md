# Fable rebuild: progress log

A fresh session starts here, then reads `docs/fable-rebuild-brief.md` and
`docs/fable-rebuild-decisions.md`. Worktree: `../fps-game-fable`, branch `feature/fable-rebuild`,
base `master` at v4.7.1 (`30e49e9`). `node_modules` is a junction to the main checkout.

## Phases

| # | Phase | State |
|---|---|---|
| 0 | Setup: worktree, logs, baseline checks, baseline performance | done |
| 1 | Arsenal: kit, 20 weapon definitions, handling, clips, sounds, models | models: 15 of 19 done, 4 with a Fable agent |
| 2 | Skins: six families, storage, snapshot fields, remote held weapon, aim-point test | done (unit); e2e spec written, not yet run |
| 3 | Menus: Loadout rework, Skins screen with aimed preview, screenshots spec | built; QA passes still owed |
| 4 | Shared co-op systems: pings, down and revive, squad panel, end screen stats | next |
| 5 | King of the Hill rebuild | |
| 6 | Goose Horde rebuild (solo and co-op) | |
| 7 | Uplink operation rebuild (solo) | |
| 8 | Director Showdown rebuild (solo) | |
| 9 | Co-op enemies, then co-op Uplink and Showdown | |
| 10 | New specs, full suite, performance after, docs, changelog, version | |
| 11 | Preview deploy, handover report | |

## Done so far

- 2026-11-10: worktree and junction created. Docs read. Three read-only Haiku surveys.
- Baseline on the untouched tree: typecheck clean; unit 1434 of 1435 (one load flake, passes alone).
- Baseline performance (v4.7.1, `e2e/perf-log.spec.ts`, 20 enemies). Headed runs use the real GPU:

  | Run | fps at spawn | fps in the fight | ai ms/tick | physics ms/tick |
  |---|---|---|---|---|
  | Medium, headed (real GPU) | 52.8 | 58.7 | 1.31 | 3.11 |
  | Low, headed (real GPU) | 59.6 | 59.9 | 1.52 | 3.87 |
  | Medium, headless (SwiftShader) | 1.40 | 2.04 | 0.98 | 1.95 |
  | Low, headless (SwiftShader) | 1.39 | 2.87 | 0.92 | 1.65 |

  Logs: `C:\tmp\fable-logs\perf-base-*.log`. Snapshot of the old tree: `C:\tmp\fable-base` (port 5190).
  `PERF_GRAPHICS=low` selects the tier; add `--headed` for the real GPU.
- Weapon kit (`src/weapons/models/kit/`), six skins (`skins.ts`, `skinMaterials.ts`), part clips
  (`src/weapons/animation/`), `weaponModels.ts`, the all-weapons aim test (`weaponModels.test.ts`).
- 20 definitions with falloff, recoil, weight and blade attack tables; `WeaponManager` rewritten on
  clips, skins, inspect (G) and blade attacks; new inputs `inspect` and `ping`.
- Sounds synthesised per weapon (`audio/weaponSounds.ts`); the 8 mp3 samples removed.
- Held weapon and skin shown to other players: snapshot fields `w` and `k`, `entities/heldWeapon.ts`.
- Skins screen (`ui/menu/SkinsScreen.ts`, `WeaponPreview.ts`), Loadout rework, `e2e/skins.spec.ts`,
  e2e group `skins`.
- Dev tools: `weaponlab.html` + `scripts/weaponShots.mjs` (models), `scripts/menuShots.mjs` (menus).
- Models done: rifle, pistol, knife, revolver, shotgun, sawnOff, gooseLauncher, karambit, machete,
  tanto, hatchet, spike (main session); mp5, smg, machinePistol (Fable agent 1).
  With Fable agent 2: sniper, dmr, battleRifle, lmg.

## Working notes

- Dev server for the worktree: `npx vite --port 5191 --strictPort` (background task of this session).
- Long Playwright runs: `bash /c/tmp/fable-logs/snap.sh` mirrors the worktree to `C:\tmp\fable-e2e`,
  then run there with `E2E_PORT=5192`.
- Edits to CRLF files: the Edit tool, or `C:\tmp\fable-logs\ed.py` (keeps line endings).
- Commit as `git -c user.email=gustavpjvr@gmail.com commit`. Never push to master, never deploy to
  production.

## Last checks

| Check | Result |
|---|---|
| typecheck | clean (2026-11-10, after the Skins screen) |
| unit | weapon, skins, network, entity, input, settings suites pass; `weaponModels` fails only "has every weapon built" until the 4 long guns land |
| e2e quick (4 smoke tests) from the snapshot | 4 passed, with the new weapon manager |
| e2e full | not yet run on this branch |

## Next

1. Verify agent 2's four models when it reports; run `skins.spec.ts`, `ui-qa`, `core`.
2. `/web-design-guidelines`, `site-qa` and a Fable `ui-reviewer` pass on Skins and Loadout.
3. Phase 4: pings, down and revive, squad panel. Then King of the Hill.
4. Docs still owed for what is built: `docs/arsenal.md`, `docs/skins.md`, updates to ARCHITECTURE,
   weapons-combat, ui-lobby, controller (inspect, ping), testing (skins group), README.

## New network message types (for the relay routing table)

None yet (the held weapon and skin ride two optional fields of `playerSnapshot`, `w` and `k`).
Planned: `kothState` (B), `kothCrownClaim` (H), `ping` (R), and the co-op and enemy messages.

## Open issues

- The S5's round receiver top reads as only slightly rounded; wraps on upright magazines are blocky
  (kit: `wrapBox` runs along the barrel only). Cosmetic.
