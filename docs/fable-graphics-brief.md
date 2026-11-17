# Fable brief 2: graphics and performance overhaul

Written 2026-11-10 for the same Claude Fable 5.2 session that carried out `docs/fable-rebuild-brief.md`.
Start this only after that brief's section 9 is fully met and its handover report is written.

## 1. You are in charge (unchanged)

Everything in section 1 of the rebuild brief still holds: you own the design, the build, the testing and
the judgement, you do not ask Gustav for help, approval or choices, and every decision goes in your
decision log with the reason and the runner-up. Sections 4 (fixed rules), 6 (agents) and 7 (stop rules)
of the rebuild brief apply here unchanged.

## 2. Goal

Make Hunter 'n Goose look clearly better and run faster at the same time, on every map, weather and
mode, including everything the rebuild added. The game keeps its theme and colours; how it gets there is
yours to decide.

## 3. Set up

1. Stay in your worktree. Commit the rebuild's final state, then start a new branch from it:
   `git switch -c feature/fable-graphics`. This work builds on the rebuild, not on `master`.
2. Read `docs/PERFORMANCE.md`, `docs/performance-notes.md`, `docs/VISUAL_REALISM.md`,
   `docs/visual-overhaul.md`, `docs/night-and-visibility.md`, `src/core/Renderer.ts`, `src/render/PostStack.ts`
   and the graphics presets in `src/settings/graphicsQuality.ts`.
3. Start the logs for this phase: `docs/fable-graphics-progress.md` and `docs/fable-graphics-decisions.md`.

## 4. Measure first (on a real GPU)

The Playwright browsers here render with SwiftShader, a software rasteriser, so their frame rates say
nothing about real performance (`docs/PERFORMANCE.md`). Measure on this laptop's own GPU:

1. Build a benchmark that runs in a headed browser with hardware acceleration (check the renderer string,
   as `docs/PERFORMANCE.md` shows, and refuse to report numbers from SwiftShader). It visits fixed camera
   spots on both maps (open valley, the densest town, the densest forest, a tower and the underground lab,
   Facility corridors and its largest room) in each weather, plus a busy moment (a full Goose Horde wave,
   4 players in multiplayer if you can simulate them), and records average frame time, p95 and p99 frame
   time, draw calls, triangles, and GPU memory where available.
2. Record the baseline (the rebuild's final state) for Low, Medium and High at 1920x1080 before changing
   anything. Keep the benchmark in the repo (`npm run bench` or similar) so it can be rerun later.
3. Take baseline screenshots at the same fixed spots for the before-and-after comparison.

## 5. The work

- **Profile** the renderer and the frame (CPU and GPU): find where the time goes before optimising.
- **Batch repeated objects:** trees, rocks, houses, fences, geese and other repeated things drawn with
  instancing or merged geometry, with level of detail for distant objects and culling for what cannot be
  seen.
- **Lighting and materials:** consistent physically based materials, better shadows where they matter,
  cheaper ones where they do not, believable light in every weather, night, the Facility and the lab. The
  fixed light count per match stays (`docs/ARCHITECTURE.md`).
- **Post-processing that stays cheap:** pick effects that earn their cost (for example tone mapping,
  colour grading, ambient occlusion, bloom, anti-aliasing), scaled per graphics preset.
- **The presets:** Low, Medium and High each get a clear purpose; Low must run well on weak laptops.
- **Loading:** shader compile stalls and hitches when things first appear on screen are fixed (precompile,
  warm up), and load time does not grow.

## 6. Targets (Gustav gave none; these are the defaults)

At 1920x1080 on this laptop's GPU, at every benchmark spot:
- **Low:** 60 FPS or better with p95 frame time at or under 16.7 ms.
- **Medium:** 60 FPS average with p95 at or under 20 ms.
- **High:** 45 FPS or better average.
- No spot slower than its baseline on any preset, and the busy moments must not hitch (p99 under 33 ms).

If a target turns out impossible on this hardware, get as close as the evidence allows, record why in the
decision log, and say so in the handover.

## 7. Testing

- `npm run typecheck`, `npm run test:unit` on every change; the matching Playwright groups as you go; the
  full suite at the end (pre-approved, from a `C:\tmp` snapshot with its own `E2E_PORT`).
- The benchmark rerun at the end on all three presets, compared with the baseline.
- Screenshots at the fixed spots, before and after, side by side, at 390 px wide and desktop width where
  the UI shows, and the `ui-reviewer` agent's look at them.
- Nothing visual may break: weapon sights still line up for every weapon and skin (the rebuild's aim-point
  test passes), night and torch visibility rules hold, minimap and HUD unchanged unless improved on
  purpose.

## 8. Done when

1. The benchmark exists, runs on the real GPU, and shows the section 6 targets met (or the gap explained).
2. Before-and-after screenshots show the game looking clearly better at every fixed spot.
3. `npm run typecheck`, `npm run test:unit` and the full Playwright suite pass (known flakes that also fail
   on the base branch are allowed and listed).
4. As-built docs updated (`docs/PERFORMANCE.md`, `docs/performance-notes.md` and the rendering docs),
   `docs/CHANGELOG.md` entry written, version bumped on the branch (your call on the number).
5. The preview is deployed to `https://fable-graphics.hunter-n-goose.pages.dev`
   (`npm run build && npx wrangler pages deploy dist --project-name hunter-n-goose --branch fable-graphics`,
   music copied into the worktree first and never committed). Never `npm run deploy`, never `master`.
6. A handover report, `docs/fable-graphics-handover.md`: what changed and why, the benchmark tables
   (baseline and final), the screenshot comparison, what to look at first on the preview, open issues.
