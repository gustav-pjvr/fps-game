# Checking Performance

## Why this can't be answered from this project's usual dev environment

This project is normally developed and tested inside a sandboxed environment whose Chromium
instance renders via **SwiftShader** - a CPU software GPU rasterizer, not real hardware
acceleration. You can confirm this yourself by opening the game and running the following in the
browser console:

```js
const gl = document.querySelector('canvas').getContext('webgl2');
const ext = gl.getExtension('WEBGL_debug_renderer_info');
console.log(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
// -> "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"
```

Any FPS number gathered in that environment measures software rasterization speed, not the game's
real performance - it was measured at ~4-7 FPS across every scenario tried (open terrain, dense
town, dense forest), which is a hardware ceiling, not a game problem. A real performance check has
to happen on an actual GPU, which means running the game in a normal browser on your own machine.

## Option 1: the in-game overlay (fastest, zero setup)

Play the game normally (`npm run dev`, open in a browser) and press **F3** at any time during a
match. A small overlay appears top-left showing:

```
FPS 142  frame 7.0ms avg / 9.8ms p95
entities 23
```

- **FPS / avg frame time**: a rolling average over the last ~2 seconds of real frames.
- **p95 frame time**: the worst 5% of frames in that same window - this is the number to watch for
  stutter. A high average with a high p95 means occasional spikes (e.g. a burst of enemies all
  firing raycasts the same frame) that a plain average would hide.
- **entities**: how many targets/enemies are currently alive - useful context for comparing a quiet
  moment against a big fight.

Press F3 again to hide it. It's off by default and adds negligible overhead when hidden.

**What to actually test:**
1. Open terrain, standing still - your baseline.
2. Walk into a dense town (lots of buildings/ladders in view at once).
3. Walk into a dense forest (lots of trees).
4. Start a fight with several enemies engaging at once - ideally with a large enemy count
   (Match Setup lets you go up to 50) so multiple archetypes are firing/kiting simultaneously,
   which is the heaviest realistic case (each engaging enemy runs its own throttled LOS raycast
   plus hitscan shots).

If FPS holds up and p95 stays close to the average in all four, there's real headroom. If p95 spikes
hard specifically during the fight scenario, that's a signal enemy combat (not world rendering) is
the bottleneck - worth profiling with Option 2 before adding more enemies/archetypes/effects.

## Option 2: Chrome DevTools (more detail, more setup)

For a frame-by-frame breakdown of *what* is expensive (rendering vs. script vs. physics):

1. Open the game, open DevTools (F12), go to the **Performance** tab.
2. Click record, play for ~10-15 seconds through one of the scenarios above, stop recording.
3. Look at the flame chart's "Main" track - long yellow (script) blocks during a fight point at
   `EntityManager.update`/`Enemy.update`; long purple (rendering) blocks point at draw calls/shadows.
4. Chrome's **Rendering** tab (⋮ menu > More tools > Rendering) has a "Frame Rendering Stats"
   overlay that shows live FPS/GPU memory independent of this project's own F3 overlay - useful as
   a cross-check that the two agree.

## Option 3: the automated local check (repeatable, scripted)

`e2e/performance-check.spec.ts` drives the same scenarios above automatically and prints FPS/p95
numbers to the console, using `window.__gameDebug.getFrameStats()` (the same data the F3 overlay
reads). It is **not** part of the normal smoke suite - run it explicitly, on your own machine:

```bash
npx playwright test e2e/performance-check.spec.ts --headed
```

`--headed` matters: run it with a visible browser window so you can be sure Chromium picked a real
GPU backend rather than a software one (the same SwiftShader situation this whole document exists
because of). It has no pass/fail assertions - it can't break anything, it just prints numbers for
you to read and compare across changes over time (e.g. before/after adding a new enemy archetype or
a bigger default match size).

## What "good" looks like

There's no universal target baked into this doc - your hardware, your monitor's refresh rate, and
how many enemies you actually want alive at once all matter more than a fixed number. As a rough
starting point: if the game holds close to your monitor's refresh rate (avg FPS) with p95 frame
time not wildly higher than the average, you have headroom. If p95 balloons specifically once
several enemies are engaging in ranged combat, that's the concrete thing to profile and optimize
next - likely candidates are the per-enemy LOS raycast (`ENEMY_LOS_CHECK_INTERVAL`, already
throttled) and the ranged hitscan itself, both in `src/entities/enemies/Enemy.ts`.
