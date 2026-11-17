# Release brief: v5.0.0 to the live game

Written 2026-11-11 by the Fable session that built `feature/fable-rebuild`, for the main session
that will merge it and deploy it to https://hunter-n-goose.pages.dev. Read this, then
`docs/fable-rebuild-handover.md` (what was built, the evidence, what is not verified) and decisions
D28 to D36 in `docs/fable-rebuild-decisions.md`.

## 1. Where things stand

- **Branch:** `feature/fable-rebuild`, pushed, in the worktree
  `C:\Users\HP 865 G10\Desktop\Claude WorkSpace\fps-game-fable`. 43 commits ahead of `master`.
- **Master** has one commit the branch lacks (`eacfdc8`, a docs-only brief), so the merge is not a
  fast-forward but should not conflict.
- **Version:** `GAME_VERSION` is already `5.0.0`. The changelog entry exists and is headed
  "v5.0.0 (current, on `feature/fable-rebuild`, not yet released)".
- **Preview:** https://fable-rebuild.hunter-n-goose.pages.dev is this branch at its last commit.
- **Production today:** v4.7.1.

## 2. What needs Gustav's yes

Merging to `master` and `npm run deploy` are his call. The prompt that started you carries his yes
for both, for this release only. It does not cover force-pushing, deleting branches or worktrees,
or touching `feature/server-relay`.

## 3. Checks before the merge

Run them in the worktree, or after merging locally and before pushing. Keep to the machine's
limits: one spec at a time, at most two browser contexts per test, never a unit run and a browser
run together, and browser runs from a copy of the committed tree
(`bash /c/tmp/fable-logs/snap-head.sh`, then `cd /c/tmp/fable-e2e && E2E_PORT=5192 npx playwright
test <spec>`). If that script is gone, make the copy as `docs/workflow.md` describes.

Required:

1. `npm run typecheck`, `npm run test:unit` (1983 tests at the last run), `npm run build`.
2. `e2e/skins.spec.ts`, the test "every weapon in every skin aims with its sight on the true aim
   point". It was not rerun after the Workbench replaced the Skins screen. It takes 4 to 15 minutes.
   Every offset must be under 1 px.
3. `e2e/smoke.spec.ts` (the core group). On 2026-11-10 the machine was too slow to judge it: five
   tests overran their own time budgets on this branch and on an untouched v4.7.1 copy alike. Rerun
   it on a quiet machine. For a test with no timeout of its own pass `--timeout=240000`. A failed
   assertion is a real failure; an overrun with no failed assertion is the machine.
4. `e2e/multiplayer.spec.ts` (two players join and see each other). Attachments and the new
   grenades were never played with two clients.

Already passing on this branch and not changed since: `grenades.spec.ts`, `gun-handling.spec.ts`,
`ui-qa.spec.ts` for the Workbench and the Loadout, the skins equip test and the attachments test,
`koth.spec.ts`, `horde.spec.ts`, `director.spec.ts`, `mission.spec.ts`, `facility-modes.spec.ts`.

The full suite takes about an hour and was skipped on Gustav's instruction (D28). Do not run it
unless he asks. Groups never run on this branch: `world`, `houses`, `pickups`, `mp4`, most of `mp`,
`ai` beyond the director, `facility` beyond its modes. If a check fails, stop and tell Gustav what
failed and what it means for players; do not deploy around it.

## 4. Merge and deploy

In the main checkout (`C:\Users\HP 865 G10\Desktop\Claude WorkSpace\fps-game`, on `master`):

1. `git status`: the two untracked `docs/server-relay-design.md` files are someone else's work in
   progress. Leave them.
2. `git merge --no-ff feature/fable-rebuild`. If a conflict appears it will be in a doc; keep both
   sides.
3. In `docs/CHANGELOG.md` change the v5.0.0 heading to "v5.0.0 (current)" with the release date,
   and make sure no older entry still says "(current)". In `docs/fable-rebuild-handover.md` add one
   line at the top saying it was released and when.
4. `npm run typecheck`, `npm run test:unit`, `npm run build` once more on the merged tree.
5. Check the music is there: `public/assets/music/` in the main checkout must hold the mp3 files.
   They are gitignored (the licence forbids distributing them in a public repository) and reach the
   site only by deploying from this machine. Never `git add` them.
6. Commit as `gustavpjvr@gmail.com`, push `master`, then `npm run deploy`.
7. Verify the live site: fetch https://hunter-n-goose.pages.dev, find the bundle it loads, and
   check it contains `5.0.0` and `WORKBENCH`. Then open the page once: the title screen shows
   v5.0.0, the Workbench opens and draws a weapon, a solo match starts, and the console is clean.

Rollback, if the live game is broken: redeploy v4.7.1 from its commit (`git checkout 9e9bdd9` in a
scratch worktree, `npm run build`, `npx wrangler pages deploy dist --project-name hunter-n-goose`),
or roll back to the previous deployment in the Cloudflare Pages dashboard. Tell Gustav first.

## 5. After the deploy

- Update the vault note (`06-Personal/hunter-n-goose.md`) and today's daily note: released, when,
  what was verified, what was not.
- Update `CLAUDE.md` only if something in it is now wrong (it already says 5.0.0).
- Leave the worktree `fps-game-fable` and its branch in place. Gustav decides when to remove them;
  the junction rule in `docs/workflow.md` applies.
- `feature/server-relay` now lags `master`. When that branch is picked up it needs a routing class
  for five new message types (`kothState`, `kothCrownClaim`, `hordeState`, `reviveEvent`, `ping`):
  the table is in the handover. Do not touch that branch as part of the release.

## 6. What players will notice, and what to tell Gustav honestly

New in v5.0.0: four rebuilt modes, 19 weapons modelled in code with six skins each, per-gun spread
and recoil, attachments and the Workbench, rebuilt grenades. Saved loadouts and settings carry
over; attachments and skins are new storage keys and start empty.

Not verified, to say in the release report: the full Playwright suite; a real phone; a real GPU
check of the new explosion and the weapon models; attachments and grenades in a real multiplayer
match; the reload fix in a live match (it was judged from frame captures). Co-op for Operation
Uplink and Showdown is postponed (D30). Other players do not see your attachments (D33).

## 7. Rules that bind you

Gustav's global rules and the repo's `CLAUDE.md` load in your session; these are the ones that bite
on a release: no em dashes or en dashes anywhere you write; git identity `gustavpjvr@gmail.com`;
the repository is public, so no secrets and no music files; run only the tests a change needs;
report failures and skipped steps plainly; answer in the first sentence; address the owner as
Gustav.
