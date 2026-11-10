# Fable rebuild: progress log

A fresh session starts here, then reads `docs/fable-rebuild-brief.md` and
`docs/fable-rebuild-decisions.md`. Worktree: `../fps-game-fable`, branch `feature/fable-rebuild`,
base `master` at v4.7.1 (`30e49e9`). `node_modules` is a junction to the main checkout.

## Phases

| # | Phase | State |
|---|---|---|
| 0 | Setup: worktree, logs, baseline checks, baseline performance | done |
| 1 | Arsenal: kit, 20 weapon definitions, handling, clips, sounds, models | done: all 19 models built (15 main session, mp5/smg/machinePistol and sniper/dmr/battleRifle/lmg by two Fable agents) |
| 2 | Skins: six families, storage, snapshot fields, remote held weapon, aim-point test | done (unit); e2e spec written, not yet run |
| 3 | Menus: Loadout rework, Skins screen with aimed preview, screenshots spec | built; the UI guard passes at phone and desktop after two fixes (Skins opened from the Loadout was inert; the phone weapon strip ran off screen); `ui-reviewer`, `site-qa` and `/web-design-guidelines` passes still owed |
| 4 | Shared co-op layer: pings, down and revive, squad rows, kills on the scoreboard | done (unit); proven in the browser by the horde spec |
| 5 | King of the Hill rebuild | done: unit tests and both browser tests pass (two players with a late joiner; four players in teams) |
| 6 | Goose Horde rebuild (solo and co-op) | built; solo and four-player browser tests pass; the two-player test (revive, late join, rejoin) is waiting for a rerun |
| 7 | Uplink operation rebuild (solo) | done by Fable agent 3, verified (typecheck, 241 unit tests in mission, sites and enemies, its screenshots read) and committed; its browser specs passed in its own snapshot, rerun from the committed tree owed |
| 8 | Director Showdown rebuild (solo) | built and committed (rules, panel, wiring, briefing, end screen, hooks, doc); unit tests pass; its three browser tests not yet run |
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
  Fable agent 2: sniper, dmr, battleRifle, lmg (verified by the model tests and by eye, committed).
- King of the Hill rebuilt (`core/modeControllers/hillState.ts`, `KingOfTheHillController.ts`,
  `entities/HillView.ts`, `ui/kothHud.ts`), `docs/king-of-the-hill.md`, `e2e/koth.spec.ts`.
- The co-op layer (`core/modeControllers/reviveRules.ts`, `SquadController.ts`, `ui/downedOverlay.ts`,
  a tag on the squad's health rows, `Player.revive` with a shield), `docs/coop.md`.
- Goose Horde rebuilt (`entities/hordeRules.ts`, `HordeGooseManager.ts`, `HordeGoose.ts`,
  `AmmoDropManager.dropFor`, `ui/hordeHud.ts`, the solo end screen through `DeathScreen.showResult`),
  `docs/goose-horde.md`, `e2e/horde.spec.ts`. The old `HordeWaveIndicator` file is unused now.
- Operation Uplink (Fable agent 3): `core/mission/missionState.ts`, `missionGrade.ts`, `missionText.ts`,
  `world/missionSites.ts`, `world/UplinkBeacons.ts`, the Warden (`enemies/archetypes.ts`,
  `archetypeLook.ts`), `docs/uplink.md`, `e2e/mission.spec.ts`. The Warden's hit shape grows with its
  model (`characterHitbox.ts` `scaledHitShape`), added by the main session after the agent's report.
- Showdown: `enemies/director/showdown.ts`, `ui/showdownHud.ts`, `Game.onShowdownEvent` and its
  neighbours, `docs/showdown.md`, three tests added to `e2e/director.spec.ts`.
- e2e helpers for the mode specs: `e2e/coop.ts` (rooms, late join, rejoin with a token, briefing skip).

## Working notes

- Dev server for the worktree: `npx vite --port 5191 --strictPort` (background task of this session).
- Long Playwright runs: `bash /c/tmp/fable-logs/snap-head.sh` puts the committed tree (HEAD) in
  `C:\tmp\fable-e2e`, then run there with `E2E_PORT=5192`. (`snap.sh` mirrors the working tree instead:
  not while an agent is editing the checkout.)
- Edits to CRLF files: the Edit tool, or `C:\tmp\fable-logs\ed.py` (keeps line endings).
- Commit as `git -c user.email=gustavpjvr@gmail.com commit`. Never push to master, never deploy to
  production.

## Last checks

| Check | Result |
|---|---|
| typecheck | clean (2026-11-10, after Goose Horde) |
| unit | 1867 of 1867 pass (146 files), 2026-11-10 after Goose Horde |
| e2e quick (4 smoke tests) from the snapshot | 4 passed, with the new weapon manager |
| e2e `koth.spec.ts` | 2 of 2 pass: two players and a late joiner (6.4 min), four players two against two (10.4 min). Two earlier failures were the test's own (the briefing button reads "Skip (0/2)" in a room; the hill moved under a slow run), fixed with `skipBriefing` and `holdKothHill` |
| e2e `horde.spec.ts` | solo passes (7.3 min); four players pass (8.5 min); co-op with two players failed once at the revive check (the next wave stood the guest up first), `holdHordeWave` added, rerun owed |
| `showdown.test.ts` | 12 of 12 |
| e2e ui guard on the Skins screen | passes at phone and desktop (after the two fixes above) |
| e2e groups skins, core | a first run failed under load (30 s test timeouts while two sessions ran browsers); rerun in progress |
| unit, full | 1869 of 1912 while the browser runs held the CPU at 85 percent: all 43 failures were 5 s timeouts in heavy world and model tests; rerun on a quiet machine owed |
| e2e full | not yet run on this branch |

## Next

1. Confirm `koth.spec.ts` and `horde.spec.ts` in the browser; commit Goose Horde and the co-op layer.
2. Verify Fable agent 3's Uplink (tests, its screenshots, a read of its Game.ts changes), commit.
3. Director Showdown (five acts, supply crate in relax, finale with the Warden, score multiplier, a win).
4. A four-player King of the Hill check (teams) in `koth.spec.ts`.
5. Run `skins.spec.ts`, `ui-qa`, `core`, the mp groups; `/web-design-guidelines`, `site-qa` and a Fable
   `ui-reviewer` pass on Skins, Loadout and the new HUD panels.
6. Co-op enemies (D14) if reached, then co-op Uplink and Showdown.
7. Docs still owed: `docs/arsenal.md`, `docs/skins.md`, Showdown's doc, updates to ARCHITECTURE and
   `architecture/multiplayer-and-modes.md` (King of the Hill, Goose Horde and the co-op layer are
   described there as first built), weapons-combat, ui-lobby, controller (inspect, ping), testing
   (skins and modes groups), the credits note, CHANGELOG, version 5.0.0.
8. Full suite, performance after, preview deploy, handover.

## New network message types (for the relay routing table)

The held weapon and skin ride two optional fields of `playerSnapshot` (`w`, `k`). New types so far:

| Type | Sent by | Class for the relay's `routing.ts` |
|---|---|---|
| `kothState` | host, to everyone and in a late joiner's sync | host broadcast |
| `kothCrownClaim` | guest, to the host only | guest to host |
| `hordeState` | host, to everyone and in a late joiner's sync | host broadcast |
| `reviveEvent` | any player, relayed to everyone | relayed, self-reported (`senderSlot`) |
| `ping` | any player, relayed to everyone | relayed, self-reported (`senderSlot`) |

Existing types with new optional fields: `hordeGooseSpawned` (`flavor` now also `brute` or `boss`,
optional `boss`), `hordeGooseHitEvent` (`damage`), `hordeGooseExploded` (`stomp`).
`hordePlayerEliminated` keeps its shape and now means "this slot is down". Retired but still in the
protocol: `goldenGoosePickedUp`, `goldenGooseDropped`, `goldenGooseState`, `kothScoreTick`; `hordeReset`
is no longer sent in a room.

## Open issues

- The S5's round receiver top reads as only slightly rounded; wraps on upright magazines are blocky
  (kit: `wrapBox` runs along the barrel only). Cosmetic.
- The battle rifle's aimed view shows more of the receiver below the sight than the reference rifle
  (its rear sight sits far forward); the LMG's rear sight is chunky at the hip. Both pass the aim test.
- The architecture docs still describe King of the Hill and Goose Horde as first built.
