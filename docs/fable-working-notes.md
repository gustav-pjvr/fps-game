# Working notes for the next Fable session

Written 2026-11-11 by the Fable session that built `feature/fable-rebuild` and its follow-ups, for
whoever picks up next. Everything here was learnt by getting it wrong first or by being told by
Gustav. The repo's `CLAUDE.md`, `docs/workflow.md` and `docs/testing.md` are the rules; this is how
to live with them.

## 1. Gustav, and how he wants to be worked with

- Address him as Gustav. Answer in the first sentence. The final message of a turn must stand on
  its own: he reads that, not the work log.
- **No em dashes and no en dashes, anywhere**: replies, comments, commits, docs, file names. Rewrite
  the sentence instead. Scan before you send.
- **Decide, do not ask.** He hands over a whole job and wants it finished. When a choice comes up,
  take the sensible default, write it in a decision log with the reason and what he could overrule,
  and carry on. Ask only when the work truly cannot move without him. At the end, list the defaults
  you took so he can change them.
- **He reports bugs as a screenshot and a sentence.** That is the bug report. Reproduce it and look
  at it before changing anything. He says what he sees ("a stray piece that does not move with the
  gun", "the hand cuts through"), not the cause; the cause was never where the first guess put it.
- **He plays the preview.** After each piece of work: commit, push the branch, build and deploy the
  preview, and tell him plainly what is verified and what is not. Never say something works that
  you did not see work.
- **Hard limits he set:** never push to `master`, merge into it or run `npm run deploy` unless he
  says so for that release; never delete branches or worktrees or force-push; never touch `server/`,
  `ServerTransport`, the relay or `feature/server-relay`; the repository is public, so no secrets
  and never the music files in `public/assets/music/`.
- Git identity is always `gustavpjvr@gmail.com`: `git -c user.email=gustavpjvr@gmail.com commit`.
- His global rules ask for a vault sync at the end of work (`06-Personal/hunter-n-goose.md` and the
  day's note in `Daily Notes/` in the Obsidian vault) and a routing note when anything was
  delegated. The game is a personal project: it has no monday.com board.

## 2. The machine

Windows, a laptop, software rendering in headless Chromium. It is slow and easy to starve.

- **One browser at a time.** One spec, or one test, per run. At most two browser contexts in a
  test. Never run the unit suite while a browser run is going. A heavy run fails falsely: the host
  of a multiplayer test stops answering and its silence rule drops the other players.
- **A timeout is usually the machine, not the code.** Read whether an assertion failed. Smoke tests
  with the default 30 s limit need `--timeout=240000` here. On 2026-11-10 the untouched v4.7.1 tree
  overran the same budgets as the branch.
- **Run browser tests from a copy of the commit:** `bash scripts/dev/snap-head.sh`, then
  `cd /c/tmp/<checkout>-e2e && E2E_PORT=5192 npx playwright test e2e/<spec> -g "<test name>"`.
  Commit first: the copy is HEAD, so uncommitted work is not in it. Each checkout uses its own port.
- **The dev server** for captures: `npx vite --port 5191 --strictPort` as a background task. A
  background task is killed after two hours at most; check with `curl` before using it and never
  start a second one on the same port.
- **An 8 GB orphan process** from another session once made every test fail. If the machine is
  crawling, look at what is running, tell Gustav, and kill only what he says to kill.
- **Shell traps:** Git Bash heredocs break on apostrophes and on `\U` inside Python strings: write
  the script to a file with the Write tool and run it. `grep -c` exits 1 on zero matches and breaks
  an `&&` chain. Bash's working directory resets between calls: start each command with `cd`.
- **CRLF:** many source files are CRLF. The Edit tool keeps them. For many edits at once use
  `scripts/dev/ed.py` (exact strings, each must match once, endings kept). Never rewrite a file
  with a blind text replace; check `git diff --stat` for whole-file rewrites.
- **Junctions:** every worktree's `node_modules` is a junction to the main checkout's. Deleting a
  folder that holds one with a recursive delete would delete the real `node_modules`. Remove the
  junction first (PowerShell: check `LinkType` is `Junction`, then `.Delete()`).
- **Scratch scripts** that need `@playwright/test` must run from inside the checkout to resolve it.
  Copy them in as `scripts/_name.mjs`, run, delete. One was committed by accident with `git add -A`:
  look at `git status` before every commit.

## 3. Looking at the game instead of guessing

The single most useful habit. Most of what was fixed could not have been found by reading code.

- **Hold the clock and step it.** `window.__gameDebug.holdTime(true)` stops the game;
  `stepTime(seconds)` advances it and draws one frame. Since 2026-11-11 the per-frame effects
  (explosions, the HUD) step with it too. Before that fix, an explosion ran in real time while each
  screenshot took a second, and every capture showed it already gone.
- **Contact sheets, not single screenshots.** Take the frames, lay them out in one image with the
  browser itself, and read one picture. `scripts/viewShots.mjs` (first-person animation sequences in
  a match), `scripts/labSheet.mjs` (any weapon lab views in a grid), `scripts/menuShots.mjs` (menu
  screens at desktop and phone width), `scripts/weaponShots.mjs` (one weapon, many views).
- **The weapon lab** (`weaponlab.html`, dev server only): `?w=<id>&k=<skin>&view=display|hip|aim|held`
  plus `a=all` (attachments), `spin`, `pitch`, `zoom`, `reload=0..1`, `cross=0`.
- **Debug hooks** in `src/core/gameDebugApi.ts`: teleport, lookAt, throwGrenade, getGrenadeDebug,
  getShotLog, placeEnemy, `getNearEyeObjects(radius)` (everything drawn near the camera, with its
  path of names: this found the stray torch body in one run), and per-mode hooks. Add a hook rather
  than guess; keep it if it will be useful again.
- **Put the camera where the thing is.** The first grenade capture showed nothing because the blast
  was 29 m away behind the brow of a hill. Throw short, find where it rests, look at that point.
- **Measure before a second guess.** Two failed fixes of the same visual defect means stop and
  measure (bounding boxes, positions, the scene graph), then fix.
- Software rendering cannot judge shaders, bloom or performance on a real GPU. Say so.

## 4. How the code is put together, where it bit

- **Fixed light count.** The Facility's lit materials compile for a fixed number of lights. Never
  add or remove a light mid-match: every shader recompiles and the game hitches. Make lights at
  match start with intensity 0 and only brighten them (the torch, the grenade's blast light).
- **Pool everything that appears mid-match** and keep it in the scene from the first frame with a
  count of 0 (`FragExplosion`, impact markers, tracers). Nothing may compile or allocate a material
  when a shot is fired.
- **The view model** (gun and arms) hangs off the camera and is drawn in its own pass with its own
  lens. Anything that must move with the gun goes on the model's **body part**, not the weapon's
  outer group: the reload and inspect clips move the model inside that group.
- **Weapons are code**, built by `GunBuilder` from parts and material slots. `weaponModels.test.ts`
  holds the rules (aim point, clear line of aim, budgets). A unit test over all weapons and skins is
  the cheapest way to check a geometric rule.
- **Gravity is 20 m/s2**, not 9.8. Players have 100 health. The simulation runs at a fixed step and
  the camera is interpolated between steps.
- **Network authority:** the one who causes a thing decides it and tells the others (a thrower's
  grenade, a shooter's lamp). Late joiners must be told state that already happened. Every new
  message type needs a routing class on `feature/server-relay` later: list it in the handover.
- **Changing a snapshot or message shape** affects the relay branch. Prefer a new message to a
  changed one, and say so.
- **Unit tests with real physics:** `GrenadeSystem.test.ts` builds a Rapier world with cuboids in a
  few lines. That pattern tests occlusion and collisions without a browser.
- **Pure core, thin shell.** The rules that matter (damage curves, flight, exposure, spread) are
  pure functions with tests; the system class wires them to Rapier and three. Keep new work that
  way: it is why a grenade rewrite took an afternoon.

## 5. Agents

- Gustav's routing rules are in his global file. During the Fable runs he allowed only Fable
  subagents (one at a time, medium effort) and Haiku for read-only surveys. Check what he wants now.
- Every agent prompt needs the exact line "Do not spawn any subagents. Do all of this work
  yourself, directly.", an explicit model, a task tag at the start of the description, the files to
  read and the check that means done.
- Haiku surveys at the start are worth it: "where is X and how does it work, with file and line",
  under 500 words. They keep your own context for the build.
- A new screen gets an independent look from the `ui-reviewer` agent before it is called done. It
  found three real defects in the Workbench that the author did not see.
- A background agent notifies you when it finishes. Do not poll it, and do not run a heavy browser
  job beside it. Agents can hit a usage limit and resume by themselves when it resets.
- Verify what an agent says before you repeat it.

## 6. UI

- The phone is the first check: screenshot at 390 px and at desktop width before showing anything.
- `e2e/ui-qa.spec.ts` guards every menu screen at both widths (console errors, 5xx, axe, nothing
  off screen). Add a new screen to its list.
- Selected states need more than colour. Tap targets 44 px on a phone. Escape closes the top layer
  first. Focus starts at the top of a dialog. No visible scrollbars where Gustav asked for none:
  hide them and give fades, arrows and the wheel instead.
- A WebGL canvas that was force-lost cannot get a new context: make a fresh canvas each time.

## 7. Closing out a piece of work

1. Typecheck, the unit tests the change touches, then the full unit suite once.
2. Only the browser specs the change maps to, one at a time, from the snapshot.
3. As-built doc, `docs/CHANGELOG.md`, the decision log, the handover.
4. `git status`, commit, push the branch.
5. Preview: `npm run build && npx wrangler pages deploy dist --project-name hunter-n-goose --branch <branch name>`.
   The music files must be in the worktree's `public/assets/music/` (copy them from the main
   checkout once; they are gitignored).
6. Vault note and memory.
7. Tell Gustav: what changed, what was seen working, what was not verified, the defaults taken.
