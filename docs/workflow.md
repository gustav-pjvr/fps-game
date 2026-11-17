# Working on this repo

How changes are made, tested, released and recorded. The code itself is in
[ARCHITECTURE.md](ARCHITECTURE.md); the e2e group rules are in [testing.md](testing.md).

## Ground rules

- **Repository:** `gustav-pjvr/fps-game` on GitHub, **public**. Commit as `gustavpjvr@gmail.com`
  (`git -c user.email=gustavpjvr@gmail.com commit ...`), never `jacojvr@gmail.com`.
- **Never commit secrets or licensed media.** The lobby and Facility music is gitignored on purpose
  (`docs/music.md`): its licence forbids distributing the files and this repository is public. Do not
  `git add -f` anything under `public/assets/music/`.
- **No em dashes or en dashes** in anything written for this project (code comments, docs, commits,
  copy). Use a comma, colon, parentheses or a plain hyphen.
- **Windows machine.** Many source files use CRLF line endings; edit them with a tool that keeps
  them (the Edit tool does) rather than a blind text replace, and check `git diff --stat` for
  whole-file rewrites.
- Match the surrounding code: comment density, naming, idiom. Comments explain why, not what.

## Branches and worktrees

Small changes go straight to `master`. A feature that takes more than one sitting, or runs in
parallel with others, gets a **git worktree** of its own:

```
git worktree add ../fps-game-<feature> -b feature/<feature>
```

Then share the dependencies instead of installing again: make `node_modules` in the worktree a
Windows directory junction to the main checkout's (`mklink /J node_modules <main>\node_modules`).
**Never delete a worktree with a recursive delete while the junction is in place:** that would
delete the real `node_modules`. Remove the junction first (in PowerShell,
`(Get-Item <worktree>\node_modules).Delete()` after checking `LinkType` is `Junction`), then remove
the worktree with `git worktree remove`. Branches stay in git after the worktree is gone.

Merging several feature branches produces conflicts in the shared hubs (`Game.ts`, `protocol.ts`,
`MatchMessageRouter.ts`, `GrenadeSystem.ts`). After a merge, typecheck and run the unit tests: two
branches editing the same object shape can merge cleanly and still break (this happened once with
a grenade view field).

## Tests

The rule (Gustav, 2026-10-24, repeated three times): **run only what a change needs.**

1. Run `npm run typecheck` and `npm run test:unit` (seconds) on every change.
2. Ask whether any browser test is needed at all. A small, contained fix that a unit test and a
   direct check already prove gets none.
3. Otherwise run `npm run test:e2e -- --dry` to see which groups the change maps to
   (`scripts/e2eGroups.mjs`), then run them one group at a time, smallest and most relevant first
   (`npm run test:e2e:group -- facility`), reporting each.
4. `npm run test:e2e:full` runs about 50 to 60 minutes: only for a change to what every spec shares
   (helpers, Playwright or Vite config, `package.json` dependencies). If a plan covers nearly every
   group, say so and ask before running it.
5. A new spec must be added to a group in `scripts/e2eGroups.mjs` (a unit test checks this).

Practicalities:

- Specs run on software rendering at about 2 frames a second once a match loads, so budgets are
  generous and a timeout is usually a budget problem, not a hang: read the trace's step times first.
- Run **one Playwright chain at a time per checkout**. A second checkout or worktree sets its own
  port: `E2E_PORT=5181 npm run test:e2e:group -- mp`.
- Long chains (more than a few minutes) run from a snapshot copy under `C:\tmp`, so editing the real
  tree does not hot-reload the page under test: `bash scripts/dev/snap-head.sh` copies the committed
  tree and junctions `node_modules` (commit first; uncommitted work is not in the copy).
- Practical habits, capture tools and traps on this machine: [fable-working-notes.md](fable-working-notes.md).
- Slow world tests (for example `ZoneMap.test.ts`) can time out on a loaded machine; rerun alone
  before treating a failure as real.
- Real GPU checks (a screenshot in Chrome against `npm run dev`) catch what software rendering
  cannot, such as shader issues.

## Releases

1. Make sure `npm run typecheck`, `npm run test:unit` and `npm run build` pass, plus the e2e groups
   the release's changes map to.
2. Bump `GAME_VERSION` in `src/core/version.ts` and add an entry at the top of `docs/CHANGELOG.md`
   (marked `(current)`; remove that mark from the previous entry). Versioning: major for an identity
   or architecture shift, minor for a feature or mode, patch for a fix.
3. Update the as-built docs the change touches (the doc index is `docs/README.md`).
4. Commit, push to `master`, then `npm run deploy` (builds, then `wrangler pages deploy dist` to the
   `hunter-n-goose` Pages project; production is `hunter-n-goose.pages.dev`).
5. Verify the live site: fetch the served bundle and check it contains the new version string and a
   marker of the new feature.

Deploying from this machine is also how the gitignored music files reach the site.

## Documentation

- `docs/CHANGELOG.md` is the release history. Each feature has an as-built doc in `docs/` (see the
  index). When a design doc and the code disagree, the code is right; fix the doc.
- Files dated before October 2026 (`PLAN.md`, `WORLD_PLAN.md`, `MULTIPLAYER_PLAN.md`,
  `enemy-ai-v2-design.md`, and the dev-log files indexed by `NOTES.md`) are history. They explain why
  things are the way they are, not what they are now.

## Working with AI agents on this repo

Everything above applies to an agent session. The owner's standing rules (model routing, agent
tags, testing, vault sync) live in the owner's own configuration, not in this repository; the short
version for this project is in `CLAUDE.md`.

Lessons from building v4.4.0 with parallel agents:

- Agents stop at a token budget (300k), so give each a task that fits: one subsystem, the files it
  needs, a "done when" command. Split a big feature into two or three parts.
- Give each parallel feature its own worktree and port, and merge in an order that puts the shared
  network hubs last.
- After a feature, one independent review per area plus a re-check of its fixes, then the main
  session verifies with tests. A reviewer never reviews its own work.
