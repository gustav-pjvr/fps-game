# Sound and glass: progress

Working log for `docs/sound-and-glass-brief.md`. Newest at the bottom.

## 2026-11-11

- Worktree `../fps-game-sound`, branch `feature/sound-and-glass` from `master` (v5.0.0). Node modules
  junctioned, music files copied (gitignored).
- Two read-only surveys (callers of the sound engine; houses, windows, lamps and shots).
- Design written into `sound-glass-decisions.md`.
- Sound: pure rules (`spatial`, `occlusion`, `mix`), the engine rewritten, every caller converted to
  pass a position, the world probe, enemy footsteps and melee, impacts, bullets passing, casings,
  wind, three settings.
- Glass: pure rules, store, view (one instanced shader), hooks into shots, blades, grenades, blasts
  and geese, two network messages, sync.
- The sound test page and `scripts/soundRender.mjs`. First measurements showed levels far too low,
  reverb drowning the direction of small sounds, night mode clipping and a rifle that measured like
  the pistol: all corrected from the numbers.
- Unit tests written by a Sonnet job; three issues found and fixed.
- Browser specs: glass solo (a recoil drift and the world being too small to stream were test
  problems, fixed in the test), two-player glass, the sound page. Frame captures at Medium and Low.
- Regression specs for the touched areas, one at a time. The multiplayer combat spec times out on
  this machine on `master` too.
- Opus audit, fixes, re-check, one more fix.
- The old positional audio module and constants removed. Docs, changelog, version 5.1.0.
- Performance against `master` on the real GPU: level.
- Pushed; preview at https://sound-glass.hunter-n-goose.pages.dev.
