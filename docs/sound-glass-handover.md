# Sound and glass: handover

Written 2026-11-11 by the session that carried out `docs/sound-and-glass-brief.md`. Branch
`feature/sound-and-glass` (from `master` at v5.0.0), worktree `../fps-game-sound`, version 5.1.0 on
the branch. Nothing was pushed to `master`, merged or deployed to production; no branch or worktree
was deleted; `server/`, `ServerTransport` and `feature/server-relay` were not touched.

Preview: PREVIEW_URL

As built: `docs/sound.md`, `docs/glass.md`. Decisions: `docs/sound-glass-decisions.md`.

## What was built

**Sound.** The engine is spatial: every sound in the world has a position, and the engine works out
its loudness, direction, dullness and what lies between it and the player. Buses, a limiter, a soft
clipper, ducking under a near blast. Walls, the ground and intact windows muffle; a house, the
Facility and a lab each ring differently; the wind drops indoors. Every sound was redesigned or kept
on purpose (the table is in `docs/sound.md`), and new ones were added: enemy footsteps and melee,
bullet impacts on six surfaces, bullets passing close, casings, footsteps by surface and pace, glass,
wind. Three new settings: Effects Volume, 3D Audio, Night Mode.

**Glass.** Every window of a Valley house has a pane. Rounds leave holes where they strike with
cracks from them, enough rounds break it, a blade or a blast breaks it at once, shards fly and lie,
and the window is open. Bullets pass through, an intact pane stops a thrown grenade and muffles
sound. It is the same for every player, a late joiner included, and survives a house streaming out.

## Try it in two minutes

1. Open the preview and put on **headphones**.
2. **Settings, Audio, "Open the sound test page".** Choose "Circle round you" and press Play on
   Rifle: the shot should walk round your head. Then "Behind", "Above", "Far", "Behind a wall",
   "Through a window" on a few sounds. Switch "Where you are standing" to "In a house" and press
   Mine on Rifle: a shorter ring. Try Night mode with "Far" footsteps and a frag.
3. **Play, Valley, solo.** Walk to the nearest house. Shoot a window: a hole and cracks where you
   aimed. Keep shooting (six pistol rounds, or one shotgun blast): it bursts and stays open. Knife
   another window. Throw a grenade at a third: it bounces off the glass, then the blast breaks it.
4. Walk in through the door: the wind drops and your steps turn to boards. Stand inside by an
   intact window while enemies fire outside, then break the window and listen again. Walk over the
   shards under a broken window.
5. Let an enemy come: you should hear its boots before you see it, and its shots from where it is.

## Evidence

**Unit tests.** 2,153 tests in 161 files pass; typecheck clean. New: `spatial`, `occlusion`, `mix`,
`soundProbe` (a Rapier world), `glassPane`, `GlassStore`, `glassSync`, and added cases in
`ambience`, `protocol` and `valleyHouses`.

**Rendered audio** (`node scripts/soundRender.mjs`, every one of the 77 sounds rendered offline
through the game's own engine in Chromium; all checks pass):

SOUND_NUMBERS

**Browser specs,** each run alone from a snapshot of the commit:

SPEC_RESULTS

**Frame captures** (`scripts/glassShots.mjs`): one window in every state, from outside and inside,
at Medium and Low, with the clock held for the burst. Looked at: the hole sits where the hit was
given and is mirrored correctly from inside, cracks run from each hole, the burst shows shards in
the opening, the broken window keeps a jagged rim, pieces lie on the floor and the sill.
`C:\tmp\sound-glass-shots\glass-medium.png`, `glass-low.png`.

**Occlusion cost.** At most 10 ray casts per sound, at spawn. Measured in a unit test: about 17
microseconds per probe through one wall in a world of 200 colliders.

**Performance against the base.** PERF_RESULTS

**Independent audit.** AUDIT_RESULTS

## What is not verified

- **How anything sounds.** Nobody on the build side can hear. The measurements prove levels,
  left and right, distance, dullness, arrival and that front, behind, above and below produce
  different signals. They do not prove a rifle sounds like a rifle, that the mix is pleasant, that
  HRTF reads as "behind" to your ears (generic ear models do not work for everyone), that the house
  reverb sounds like a room, or that night mode is comfortable. That is the sound test page's job.
- **The glass on a real GPU.** Captures were taken with software rendering: placement, cracks,
  shards and the rim are verified; the tint, the reflection strength and how the pane reads at
  night, in fog and at a distance are not.
- **Firefox and Safari.** Only Chromium was run. The engine falls back to the older listener and
  panner methods where the newer ones are missing, untested.
- UNVERIFIED_EXTRA

## New network messages

`glassHit` and `glassSync`, both relayed like `lampDestroyed` and `lampSync`. They need a routing
class on `feature/server-relay`. No existing message, and not the welcome, was changed.

## Defaults taken

The full list with reasons is `docs/sound-glass-decisions.md`. The ones most worth a second look:

- The game is about twice as loud as before at the same master volume (decision 11).
- 3D audio is on by default (5); far shots arrive late (8).
- Glass strength: six pistol rounds, two sniper rounds, one shotgun blast, one blade (26); a blast
  breaks glass through walls (27); bullets lose no damage to glass (25).
- The bunkhouse's glazed panel, the tower slits and the Facility get no glass (29).
- Other players' footsteps always land as a run (19).
- The full browser suite was not run (35).

## For whoever continues

- `src/core/positionalAudio.ts` and its config constants are gone; nothing outside the engine
  computes a volume or a pan any more.
- Tools kept: `scripts/soundRender.mjs`, `scripts/glassShots.mjs`, the debug hooks `getGlassDebug`,
  `hitGlass`, `getSoundDebug`, `restreamChunkAt`.
- Ideas not done: a per-pane strength by size, glass in the bunkhouse panel, walls that carry a
  material for impacts, a moving source (a sound that follows a running enemy for its length), pace
  on the footstep message.
