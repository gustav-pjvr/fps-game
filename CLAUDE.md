# Hunter 'n Goose

A browser first-person shooter (TypeScript, Three.js, Rapier, PeerJS, Vite) deployed to Cloudflare
Pages at hunter-n-goose.pages.dev. Current version 4.5.0. The owner is Gustav; address them as Gustav.

## Read first

1. `docs/ARCHITECTURE.md`: how the game is built, with a map of the source and where to change things.
2. `docs/workflow.md`: branches and worktrees, testing, releases, documentation.
3. `docs/README.md`: index of every doc. Each feature has an as-built doc; `docs/CHANGELOG.md` is the history.
4. The doc for the area you are about to touch (multiplayer, Facility, grenades, controller, and so on).

Older planning docs (`PLAN.md`, `WORLD_PLAN.md`, `MULTIPLAYER_PLAN.md`) are history. When a doc and the
code disagree, the code is right; fix the doc.

## Rules for this project

- **No em dashes or en dashes** anywhere you write (code, comments, docs, commits, replies). Plain hyphens are fine.
- **Git identity** is `gustavpjvr@gmail.com` (`git -c user.email=gustavpjvr@gmail.com commit`). Commit and push
  to `master` and deploy (`npm run deploy`) are pre-authorised for finished work; anything destructive or
  outward-facing beyond that (force-push, deleting branches, publishing elsewhere) needs Gustav's yes.
- **The repository is public.** Never commit secrets, keys or the music files in `public/assets/music/`
  (licence forbids distributing them; see `docs/music.md`). Use anon or publishable keys only, never a `service_role` key.
- **Testing:** run only what a change needs. Always `npm run typecheck` and `npm run test:unit`. A small fix that
  a unit test already proves gets no browser run. Otherwise run the Playwright groups the change maps to, one at a
  time (`npm run test:e2e -- --dry`, then `npm run test:e2e:group -- <group>`). The full suite only when
  absolutely necessary, and ask first if the plan covers nearly every group. Details: `docs/testing.md`.
- **Source files are often CRLF.** Edit them with the Edit tool, not a blind text replace.
- Match the surrounding code's comment density, naming and idiom. Smallest correct change.
- Update the as-built doc and `docs/CHANGELOG.md` with any release; bump `src/core/version.ts`.

## Agents

Gustav's global rules (`~/.claude/CLAUDE.md`) load in every session and are binding here: the model routing
table, a task tag on every agent description, the exact line "Do not spawn any subagents. Do all of this work
yourself, directly." in every agent prompt, an independent Opus audit plus one re-check for complex or
security-sensitive code, the vault sync at the end of work, and a short routing note closing each substantial
reply. Parallel feature work uses one git worktree per feature (see `docs/workflow.md`).
