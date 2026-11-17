# Release brief: v5.1.0 to the live game

Written 2026-11-11 by the session that built `feature/sound-and-glass`, for the main session that
merges it and deploys it to https://hunter-n-goose.pages.dev. Gustav played the preview and
approved it on 2026-11-11 ("All the sound build is good") and asked for the release.

## 1. Where things stand

- **Branch:** `feature/sound-and-glass`, pushed, in the worktree
  `C:\Users\HP 865 G10\Desktop\Claude WorkSpace\fps-game-sound`.
- **Master** has not moved since the branch was cut (`5d4b8ef`, v5.0.0): the merge cannot conflict.
- **Version:** `GAME_VERSION` is already `5.1.0`. The changelog entry is already headed
  "v5.1.0 (current)" with the release date 2026-11-11, and v5.0.0 no longer carries "(current)".
- **Preview:** https://sound-glass.hunter-n-goose.pages.dev is this branch.
- **Production today:** v5.0.0.

## 2. What is already done: do not repeat it

Gustav's instruction: the building session tested this; the release session assesses briefly and
releases. Already run on this branch (`docs/sound-glass-handover.md` has the detail):

- Typecheck, the unit suite (2,142 tests), the build.
- All 77 sounds rendered offline and measured.
- Browser specs: `glass.spec.ts`, `multiplayer-glass.spec.ts`, `soundlab.spec.ts`, the quick smoke
  tests, `grenades`, `houses`, `enemy-ai`, `facility`, `facility-doors`, `ui-qa`.
- Performance against `master` on the real GPU: level.
- An independent Opus audit and a re-check; every finding fixed.
- Gustav's own play of the preview, which is the only judgement of how it sounds.

Do not run Playwright, the sound measurements, the performance runs or another audit, and do not
run the full suite. `multiplayer-combat.spec.ts` times out on this machine on untouched `master`
too: it is not a release check.

Known and accepted, so not blockers: the glass's look on a real GPU beyond what Gustav saw, Firefox
and Safari, and the last audit fixes (typecheck and unit tests only, no browser run).

## 3. The brief assessment

1. Read `docs/sound-glass-handover.md` ("What is not verified" and "Defaults taken").
2. In the worktree: `git status` is clean and `git log origin/feature/sound-and-glass -1` matches
   the local head.
3. After merging locally and before pushing: `npm run typecheck` and `npm run build`. Both take
   under a minute. The unit suite (about two minutes, no browser running) is optional: it was green
   on the branch's last code commit and the merge adds nothing.

If either fails, stop and tell Gustav what failed. Do not deploy around it.

## 4. Merge and deploy

In the main checkout (`C:\Users\HP 865 G10\Desktop\Claude WorkSpace\fps-game`, on `master`):

1. `git status`: the two untracked `docs/server-relay-design.md` files are someone else's work in
   progress. Leave them.
2. `git fetch origin`, then
   `git -c user.email=gustavpjvr@gmail.com merge --no-ff feature/sound-and-glass -m "Merge feature/sound-and-glass: v5.1.0 (spatial sound, glass windows)"`.
3. `npm run typecheck && npm run build`.
4. If the release is not on 2026-11-11, correct the date under "v5.1.0 (current)" in
   `docs/CHANGELOG.md` and commit that as
   `git -c user.email=gustavpjvr@gmail.com commit -am "release: v5.1.0 (spatial sound, glass windows) to the live game"`.
5. `git push origin master`.
6. `npm run deploy` from the main checkout. Its `public/assets/music/` holds the music files (they
   are gitignored and reach the site only by deploying from this machine): check the folder has the
   nine files before deploying.
7. Verify the live site:
   - `https://hunter-n-goose.pages.dev/` answers 200 and its script bundles contain `5.1.0` and
     `glassHit` (the version string sits in a shared chunk, not always in the main one: search every
     `assets/*.js` the page loads).
   - `https://hunter-n-goose.pages.dev/soundlab` answers 200 (`/soundlab.html` redirects to it).
   - `https://hunter-n-goose.pages.dev/assets/music/floating-in-the-abyss.mp3` answers 200.
   - Open the live page once: the title screen shows v5.1.0, Settings, Audio shows Effects Volume,
     3D Audio, Night Mode and the sound test link, and a solo Valley match starts with no console
     errors.

Never force-push, never delete the branch or the worktree, and do not touch `server/`,
`ServerTransport` or `feature/server-relay`.

## 5. After the release

- Vault: add the release to `06-Personal/hunter-n-goose.md` and today's daily note.
- Memory: update `sound-and-glass-v5-1.md` (released, live).
- Tell Gustav: the live version, what was checked live, and what stays open.

Still open after the release:

- `feature/server-relay` lags `master` and needs routing classes for `glassHit` and `glassSync`,
  with the five message types from v5.0.0.
- The glass on a real GPU at night and in fog, Firefox and Safari, and the grenade's bounce off
  glass after the last fix have not been checked in a browser.
- The defaults Gustav may still want changed are in `docs/sound-glass-decisions.md`.
