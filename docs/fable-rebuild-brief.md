# Fable brief: modes, arsenal and skins rebuild

Written 2026-11-10 for a Claude Fable 5.2 session, from Gustav's request. Base: `master` at v4.7.1.

## 1. You are in charge

You own this work from start to finish: design, build, test and judge. Gustav has said you must not ask
him for help, approval or choices. When a decision comes up, make it yourself, write it in your decision
log (section 8) with the reason and the runner-up, and carry on. Treat the current game as the idea, not
the guide: keep what is good, replace what is not, and do not feel bound by how anything is built today.
Stop only when section 9 is met, or when a stop rule in section 7 applies.

## 2. Set up first

1. Read `CLAUDE.md` (repo), `docs/ARCHITECTURE.md`, `docs/workflow.md`, `docs/testing.md`, and the
   as-built doc for each area you touch (`docs/architecture/multiplayer-and-modes.md`,
   `docs/weapons-combat.md`, `docs/squad-arsenal-night.md`, `docs/enemy-ai-v2.md`, `docs/pickups.md`,
   `docs/facility-map.md`, `docs/underground-lab.md`, `docs/controller.md`, `docs/performance-notes.md`).
2. Work in your own worktree: `git worktree add -b feature/fable-rebuild "../fps-game-fable" master`,
   then make its `node_modules` a junction to the main checkout's `node_modules`
   (`New-Item -ItemType Junction`). Never delete a worktree while the junction is in place: remove the
   junction first, then `git worktree remove`.
3. Start your progress log and decision log (section 8) before writing code.

## 3. The work

### 3.1 Rebuild these modes

Rebuild each one as a mode worth playing for an evening: clear goal, rising tension, moments players
talk about afterwards, and a reason to work as a team. For each, cover the mechanics, the design, the
systems behind it, co-op and team play, weapon and pickup balance for the mode, and UI where it needs
it (HUD, objective markers, end screen, the mode explanation screen).

- **King of the Hill** (multiplayer). Today: one golden goose, carrier scores a point a second with weapons
  locked (`src/core/modeControllers/KingOfTheHillController.ts`).
- **Goose Horde**, co-op multiplayer and single player. Today: waves of geese, 2 respawns each in co-op,
  10 waves solo (`src/entities/HordeGooseManager.ts`, co-op rules in `Game.ts`).
- **Uplink mission** (single player today). Today: bring 3 towers online, then extract
  (`src/core/mission/`, `docs/enemy-ai-v2.md`). You may make it co-op as well if that makes it better.
- **Director** (single player today). Today: enemy waves paced to the fight
  (`src/entities/enemies/director/pacingDirector.ts`). You may make it co-op as well.

Co-op and team play are first-class: shared objectives, revives or other team mechanics if they earn their
place, roles if they help, communication aids (pings, markers), fair scaling from 1 to 4 players, and late
joiners and rejoins handled (`docs/multiplayer.md`). Multiplayer is host-authoritative peer-to-peer today:
keep that model.

The other modes (Default, 1 Shot 1 Kill, Sniper Duel, Gun Game, Knife Only, Goose Toss, Elimination) are
not being rebuilt, but they must keep working with the new arsenal, and Gun Game's pool should use it.

### 3.2 Arsenal

- **Redesign every existing weapon** (`src/weapons/definitions.ts`, `src/weapons/models/arsenal.ts`,
  `weaponMaterials.ts`, `viewModel.ts`) as a highly realistic version that fits the game's theme and
  colours. You have full control of the build: geometry, materials, textures, sounds, recoil, reload and
  inspect animations, handling numbers.
- **Design and build new weapons**: more primaries, more secondaries, and a range of different realistic
  blades and knives (each with its own handling and animations).
- Names are fictional: no real manufacturer names, trademarks or logos. Assets are made by you or come
  from sources whose licence allows a public repo; record each source in `public/assets/credits/`.
- Every weapon works with mouse and controller, in first person and as seen by others in multiplayer, in
  the loadout screen, with grenades, and in every mode that allows it.

### 3.3 Skins

- A skin is a look family that exists for every weapon. The player equips skins per weapon (a different
  skin on each gun is allowed).
- A skin may change colour, materials, shape and animations, not only paint.
- Aiming must never break: for every weapon in every skin, the sights must line up with the true aim point
  (the iron sight aim-point fix of v4.6.0 is the reference, `docs/weapons-combat.md`). Prove this with an
  automated test that checks every weapon and skin combination, plus screenshots of each aimed view.
- The choice is saved per player (wrapped localStorage, like the loadout) and other players see your skin in
  multiplayer.
- A skins screen in the menu to browse and equip them, previewing the weapon.

## 4. Rules that stay fixed

- Everything in the repo's `CLAUDE.md` applies: no em dashes or en dashes anywhere you write (code,
  comments, docs, commits, replies); CRLF files are edited with the Edit tool; match the local style;
  git identity `gustavpjvr@gmail.com`.
- The repository is public: never commit secrets, keys or the music files in `public/assets/music/`.
- The game's own rules (`docs/ARCHITECTURE.md`): seeded world shaping (no `Math.random` there), a fixed
  light count per match, the network checklist for every new message type
  (`docs/architecture/multiplayer-and-modes.md` section 6), and `window.__gameDebug` hooks for anything the
  browser tests need to check.
- Do not touch `server/`, `ServerTransport`, the relay, or the branch `feature/server-relay`: that work is
  separate and security-sensitive. That branch will be merged later, so in your handover list every new
  network message type you add; each will need a class in the relay's `src/network/routing.ts`.
- Performance must not regress: measure before and after with the perf spec and `FpsMeter`, on Low and
  Medium graphics, and record the numbers.

## 5. Testing (you decide what runs, within these rules)

- Every change: `npm run typecheck` and `npm run test:unit`.
- Browser tests: run the Playwright groups your change maps to (`npm run test:e2e -- --dry`, then
  `npm run test:e2e:group -- <group>`), one at a time, from a snapshot in `C:\tmp` with its own `E2E_PORT`
  (`docs/testing.md`). Gustav has pre-approved the full suite for this work: run it at the end of each
  major phase and before handover. Known sandbox flakes are listed in `docs/testing.md`: rerun a failure
  alone, and compare against `master` before calling it yours.
- Write new specs for the new modes, co-op flows (2 and 4 players, late join, rejoin), weapon handling and
  the skin and aiming checks.
- UI: run `/web-design-guidelines` and the `site-qa` skill on every new or changed screen, screenshot at
  390 px and desktop width, and have the `ui-reviewer` agent look before you call a screen done.
- Play it yourself through the debug hooks and screenshots: judge whether each mode is fun and readable,
  not only whether tests pass.

## 6. Agents

You lead. Follow Gustav's global rules (`~/.claude/CLAUDE.md` section 1): hand reading and searching to
Haiku, scoped coding with a runnable check to Sonnet, and independent reviews of complex code to Opus.
Every agent prompt carries "Do not spawn any subagents. Do all of this work yourself, directly.", a task
tag in the description and an explicit model. Verify every agent's output before trusting it. Keep your own
context lean: you hold the design and the decisions.

## 7. Stop rules

- Never push to `master`, merge into it, or run `npm run deploy` (production). Gustav decides the release.
- Preview deploys are allowed and expected:
  `npm run build && npx wrangler pages deploy dist --project-name hunter-n-goose --branch fable-rebuild`
  (it serves at `https://fable-rebuild.hunter-n-goose.pages.dev`). Copy the music into the worktree's
  `public/assets/music/` before building a preview (it is gitignored), and never commit it.
- Committing and pushing `feature/fable-rebuild` is allowed (a backup of your work).
- Never delete branches, force-push, or touch other worktrees.

## 8. Logs (so a fresh session can resume)

Keep these in the worktree and commit them with the work:
- `docs/fable-rebuild-progress.md`: phases, what is done, what is next, the last checks run and their results.
- `docs/fable-rebuild-decisions.md`: each decision with the reason and the runner-up.
If your context runs low, update both first; the next session starts by reading them and this brief.

## 9. Done when

1. All four modes are rebuilt and playable solo and in multiplayer at 2 and 4 players where they apply,
   with late join and rejoin working.
2. The arsenal is redesigned, the new primaries, secondaries and blades are in, and skins work for every
   weapon with the aim-point test passing for every weapon and skin.
3. `npm run typecheck`, `npm run test:unit` and the full Playwright suite pass (known flakes shown to fail
   on `master` too are allowed and listed).
4. Performance is equal or better than v4.7.1 on Low and Medium (numbers recorded).
5. As-built docs are written for every area, `docs/CHANGELOG.md` has the entry, and `src/core/version.ts`
   is bumped on the branch (your call on the number; a rebuild this size suggests 5.0.0).
6. The preview is deployed and works.
7. A handover report, `docs/fable-rebuild-handover.md`: what was built and why, what to try first on the
   preview, test and performance evidence, the new network message types, open issues, and anything you
   chose not to do.
