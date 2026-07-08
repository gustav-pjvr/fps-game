# Performance

Development notes for frame-rate investigation, the in-game performance overlay/tooling, and the Graphics Quality setting, extracted from the original NOTES.md.

## Performance headroom check - inconclusive, environment limitation (2026-07-05)

Attempted to measure frame-rate headroom ahead of Enemy AI Phases B-E (which add per-enemy
line-of-sight raycasts every frame - directly relevant to whether there's budget left). Sampled
actual rendered FPS via `requestAnimationFrame` counting at spawn, inside a dense town, and inside a
dense forest using a temporary Playwright script.

**Result was not usable.** Checked the canvas's WebGL context (`WEBGL_debug_renderer_info`) and this
automated browser is running on `SwiftShader` (Google's CPU software rasterizer), not a real GPU -
confirmed via `UNMASKED_RENDERER_WEBGL` returning `"ANGLE ... SwiftShader Device ... SwiftShader
driver"`. Measured FPS was 4-7 across all three locations, which is a software-rendering artifact,
not a signal about real-world performance - Playwright/headless Chromium here has no hardware GPU
access at all, so these numbers say nothing about how the game runs on the user's actual machine.
The only thing worth noting from the raw numbers is a relative one (town ~4fps vs. spawn/forest
~6.5fps in this same software-rendered environment), which is weak evidence building-heavy scenes
cost more to render than vegetation-heavy ones, but not solid enough to act on.

**Conclusion:** this check genuinely requires the user's own hardware - open the game in a normal
browser and watch DevTools' Performance/FPS meter (or Chrome's `Rendering > Frame Rendering Stats`)
in a dense town vs. open terrain vs. a big forest, ideally with several enemies aggroed at once once
Phase B lands. Deferred; not something this environment can answer, so moving on to Phase B rather
than continuing to chase a number that can't mean anything from here.

## Performance tooling: in-game overlay + local check + docs (2026-07-05)

The earlier Phase E performance-headroom attempt concluded that this sandbox can't answer "is
performance okay" at all - its Chromium renders via SwiftShader (a CPU software rasterizer,
confirmed via `WEBGL_debug_renderer_info`), so any FPS number gathered here measures software
rasterization speed, not the game. This session's tooling is aimed entirely at making that check
possible *outside* this environment, on the user's own hardware, with as little friction as
possible.

- **`FpsMeter`** (new, `src/core/FpsMeter.ts`) - a rolling 120-sample window of real per-frame
  wall-clock time (sampled once per displayed frame in `Game.render`, not the fixed physics
  timestep). Reports average FPS/frame time plus **p95 frame time** specifically so an occasional
  stutter (e.g. several enemies' hitscan raycasts landing the same frame) shows up even when it's
  brief enough not to move the average.
- **In-game overlay** (`src/ui/perfOverlay.ts`) - off by default, toggled with **F3**. F3 is
  deliberately wired via a raw `document.addEventListener`, not the `Action`/`InputManager`/
  rebind system - it's a dev tool, not a gameplay control, same reasoning as the e2e suite's
  `openPauseMenu` helper calling `document.exitPointerLock()` directly rather than going through a
  bound key.
- **`window.__gameDebug.getFrameStats()`** - the same numbers the overlay shows, for scripted
  measurement.
- **`e2e/performance-check.spec.ts`** (new, NOT part of the smoke suite - has no pass/fail
  assertions, just prints numbers) - drives three representative scenarios (open terrain, a
  20-enemy combat encounter, a dense town found via grid search) and logs FPS/p95 for each.
  Deliberately kept as a `.spec.ts` file despite wanting to exclude it from casual discovery -
  tried naming it without that suffix first so Playwright's default test discovery would skip it
  entirely, but confirmed via direct testing that Playwright requires the suffix even for an
  explicit file-path argument (`npx playwright test e2e/performance-check.ts` reports "No tests
  found"). Documented instead, in both the file's own header comment and PERFORMANCE.md, that it's
  manual/local-only.
- **`PERFORMANCE.md`** (new, repo root) - explains the SwiftShader limitation, and walks through
  three ways to get a real number: the F3 overlay (fastest), Chrome DevTools' Performance/Rendering
  tabs (most detail), and the scripted check above (repeatable). No fabricated "target FPS" number -
  hardware and desired enemy count vary too much for one to be meaningful; the doc explains what to
  watch for (average vs. p95 spread) instead of asserting a threshold this session can't verify.

**A real, unrelated regression this work exposed rather than caused.** Running the full smoke suite
while building this surfaced `killPlayerByEnemy` (used by two death-flow tests) intermittently
exceeding even its already-once-widened 50s deadline - traced to Ridge Walker (the kiter archetype,
Phase 1's per-archetype loadouts) actively backing away whenever the helper's approach closed to
its kite range, turning a straightforward walk-up-and-get-hit into an extended chase. One measured
case took 58s by the exact same approach logic. Rather than widen the timeout a third time (diminishing
returns - kiting is open-ended in the worst case, so any fixed deadline just gets a bigger tail),
fixed the helper itself: it now holds `ShiftLeft` (sprint, speed 8) during its approach bursts
instead of walking. This is safe specifically because the loop already re-aims and re-issues a
fresh short (<=400ms) burst every iteration rather than holding one heading for a long stretch - the
"blows straight past" failure mode the original code's own comment warned about only happens with
one long, uncorrected sprint, which this loop never does. Verified via 16 repeated runs of both
affected tests (8 batches x 2 tests) - all clean, and each batch visibly faster (down to 50s-1.4m
for both tests combined, from over 2 minutes for a single test pre-fix).

**Verified:** typecheck clean; full smoke suite (16/16) green after all of the above.

## Graphics Quality setting (2026-07-05)

Added a Low/Medium/High graphics-quality option under Settings, so players on weaker hardware
aren't stuck with whatever tuning happens to suit this project's own test sandbox, and players on
real GPUs can opt into the full visual pass (particularly image-based lighting, disabled by default
per the regression above).

- `src/settings/graphicsQuality.ts` (new) - `GraphicsQuality` type, `GraphicsQualityPreset`
  interface (`shadowsEnabled`, `shadowMapSize`, `pixelRatioCap`, `environmentLighting`,
  `environmentIntensity`), and the three presets. Medium is the default and is exactly what this
  project's own e2e suite runs against (512 shadow map, no IBL) - out-of-the-box behavior matches
  what's actually verified. High matches VISUAL_REALISM.md's original recommendations (2048 shadow
  map, IBL on) for real GPU hardware, which has no reason to share the test sandbox's
  software-rendering ceiling. Low turns shadows off entirely and caps pixel ratio at 1 for the
  lowest-end/most CPU-bound systems.
- `Settings.ts` - persists the choice (`getGraphicsQuality`/`setGraphicsQuality`), default
  `'medium'`.
- `SettingsPanel.ts` - new "Graphics Quality" section, a three-button segmented control (styled
  like the existing key-bind rows) rather than a slider, since these are named presets, not a
  continuous range.
- `Game.create()` reads the preset once via `Settings.getGraphicsQuality()` for a freshly created
  match's initial setting.

**Follow-up: High was overexposing the scene (bleached landscape) - fixed same day.** At full
strength the sky's PMREM stacked with the already-full-intensity direct sun, roughly doubling the
light every surface received. Added `environmentIntensity` (three.js `scene.environmentIntensity`)
to the preset, 0.4 on High, so IBL reads as fill alongside the sun rather than a second sun.

**Follow-up: made the setting apply live, not just next-match - fixed same day.** Originally the
preset was baked into `Renderer`/`Game` at construction and a change only took effect on the
player's next match (shadow map resolution and the PMREM texture are both GPU resources tied to
creation time, so the first pass avoided touching them mid-match). Revisited once asked whether this
could be instant instead: `Renderer.applyQuality(quality)` is now a public method (also called once
from the constructor) that updates pixel ratio, `shadowMap.enabled`, and swaps `scene.environment`
between `null` and a texture generated *once* up front regardless of quality (the sky's shader
uniforms never change at runtime, so there's nothing to regenerate later - toggling is just
reassigning a cached reference, not re-running `PMREMGenerator`, so it's cheap and leak-free).
`Game.applyGraphicsQuality(quality)` mirrors this for what Renderer doesn't own: toggles the
ambient-light fallback's intensity, toggles `sun.castShadow`, and - only if the resolution actually
changed - disposes the shadow map's GPU render target and clears the reference so three.js
allocates a fresh one at the new size on the next shadow pass. Wired from the pause menu's Settings
panel via a new optional `onGraphicsQualityChange` callback (same forward-ref pattern as
`onResetPlay` already uses for the circular Game/SettingsPanel dependency). Explicitly does **not**
touch the world seed, terrain, entities, or physics - confirmed by inspection, since none of the
above calls into `ChunkManager`/`EntityManager`/`PhysicsWorld`/`worldSeed.ts` at all; it only
changes how the same, unchanged scene graph is lit and rendered from that frame onward.

**Verification for the whole Graphics Quality feature (all three passes):** `npx tsc --noEmit`
clean throughout. `npm run test:unit` 19/19 green. Full `npx playwright test e2e/smoke.spec.ts`
16/16 green after the live-apply follow-up (one `loads without console errors` failure on the
full-suite run was the same pre-existing GLTF-texture-load flake this file already documents
elsewhere, confirmed unrelated by an isolated re-run passing cleanly). Root-cause isolation for the
original IBL-performance regression was delegated to an Opus-model agent (per user request) once
initial isolation (shadow map size, shadow enable/disable, Enemy shadow fix) had ruled out the more
obvious suspects without finding the actual cause - it bisected the remaining candidates and applied
the `environmentLighting` gate fix, independently re-verified here rather than taken on faith.
