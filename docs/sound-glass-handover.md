# Sound and glass: handover

Written 2026-11-11 by the session that carried out `docs/sound-and-glass-brief.md`. Branch
`feature/sound-and-glass` (from `master` at v5.0.0), worktree `../fps-game-sound`, version 5.1.0 on
the branch. Nothing was pushed to `master`, merged or deployed to production; no branch or worktree
was deleted; `server/`, `ServerTransport` and `feature/server-relay` were not touched.

**Approved.** Gustav played the preview on 2026-11-11 and said "All the sound build is good", then
asked for the release. The main session releases it from `docs/release-v5-1-brief.md`.

Preview: https://sound-glass.hunter-n-goose.pages.dev (the sound test page is
https://sound-glass.hunter-n-goose.pages.dev/soundlab). The live game is unchanged at 5.0.0.

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

**Unit tests.** 2,142 tests in 160 files pass; typecheck clean. New: `spatial`, `occlusion`, `mix`,
`soundProbe` (a Rapier world), `glassPane`, `GlassStore`, `glassSync`, and added cases in
`ambience`, `protocol` and `valleyHouses`.

**Rendered audio** (`node scripts/soundRender.mjs`, every one of the 77 sounds rendered offline
through the game's own engine in Chromium; all checks pass):

| What | Measured |
|---|---|
| The player's own shot, peak at full volume | pistol 0.32, rifle 0.31, battle rifle 0.46, shotgun 0.61, sniper 0.70 |
| A rifle 3 m away, 120 m away | -35.2 dB, -49.4 dB, and less than half as bright |
| The same rifle 8 m away behind a wall, behind a window | 9 dB and 3.5 dB under the open air |
| A source on the left | 1.2 to 5 times louder in the left ear, and 0.75 ms earlier there |
| A rifle with HRTF: how unlike "in front" (0 is identical) | behind 0.47, below 0.28, above 0.22 |
| A rifle at 120 m arrives | 0.30 s late (0.29 expected) |
| A firefight in one render (5 guns, a frag, a goose, a window) | peak 0.977: no clipping |
| Night mode | a footstep at 10 m comes up 11 dB; the firefight peaks at 0.66 |
| The ring 0.4 s after the player's own shot | in a house -82.7 dB, Facility -64.2 dB, valley -64.0 dB |

Above is the weakest of the directions: it differs from in front, but least. Expect it to be the
hardest to hear. The Facility's ring measures almost the same as the valley's at 0.4 s.

**Browser specs,** each run alone from a snapshot of the commit:

| Spec | Result |
|---|---|
| `glass.spec.ts` (2 tests) | passed |
| `multiplayer-glass.spec.ts` (two players and a rejoin) | passed |
| `soundlab.spec.ts` (3 tests, desktop and phone, axe clean) | passed |
| `smoke.spec.ts` @quick (4) | passed |
| `grenades.spec.ts` (2) | passed |
| `houses.spec.ts` (2) | passed |
| `enemy-ai.spec.ts` (10) | passed |
| `facility.spec.ts` (2), `facility-doors.spec.ts` (1) | passed |
| `ui-qa.spec.ts` (14, includes the Settings screen at both widths) | passed |
| `multiplayer-combat.spec.ts` | **timed out, on this branch and on untouched `master` alike** |

The multiplayer combat spec runs two full-size software-rendered players at about 1.6 frames a
second on this machine and cannot finish inside its 150 s limit. It was run on a fresh copy of
`master` at 5d4b8ef and failed the same way, so it says nothing about the branch either way. A
script that repeats its steps on the branch showed shots firing, sounds placed and no page errors.
The glass, grenade, houses and regression specs above ran before the audit fixes went in; after
them, typecheck and the unit suite were run, not the browser specs.

Not run: the groups `mission`, `modes`, `skins`, `world`, `pickups`, `mp4`, and the rest of `mp`,
`ai` (`director.spec.ts`) and `core` (`gun-handling.spec.ts`, the non-quick smoke tests).

**Frame captures** (`scripts/glassShots.mjs`): one window in every state, from outside and inside,
at Medium and Low, with the clock held for the burst. Looked at: the hole sits where the hit was
given and is mirrored correctly from inside, cracks run from each hole, the burst shows shards in
the opening, the broken window keeps a jagged rim, pieces lie on the floor and the sill.
`C:\tmp\sound-glass-shots\glass-medium.png`, `glass-low.png`.

**Occlusion cost.** At most 10 ray casts per sound, at spawn. Measured in a unit test: about 17
microseconds per probe through one wall in a world of 200 colliders.

**Performance against the base.** `e2e/perf-log.spec.ts` headed (real GPU, 20 enemies,
the fight phase), on a fresh copy of `master` and on this branch, back to back:

| Run | fps | render ms per frame | frame p95 ms | ai ms per tick | physics ms per tick | draw calls |
|---|---|---|---|---|---|---|
| Medium, master | 59.2 | 6.55 | 18.3 | 1.18 | 3.41 | 596 |
| Medium, branch | 59.0 | 7.40 | 19.0 | 1.07 | 3.58 | 576 |
| Low, master | 59.9 | 2.30 | 18.3 | 1.11 | 4.75 | 47 |
| Low, branch | 59.9 | 2.12 | 18.3 | 1.29 | 3.18 | 47 |

Both sit on the 60 fps cap. Medium shows 0.85 ms more render time in this one pair of runs; the
fights differ from run to run and Low shows none, so it is not proven to be the glass, and not
ruled out. One run each: treat it as "no visible cost", not as a precise figure. Logs:
`C:\tmp\sound-glass-logs\perf\`. The script bundle grew from 4,130 kB to 4,201 kB (the main chunk
plus the engine chunk the test page shares).

**Independent audit.** An Opus 5.5 reviewer with a fresh context read the branch. No
critical or high findings: hostile or malformed glass messages cannot throw, corrupt state or grow
memory, and a hit cannot be applied twice. One medium and seven low findings, all fixed: a silent
limit on drawn panes (now warns; the Valley has about 110 of 768), crack patterns that depended on
the order hits arrived in (now seeded by position), enemy boots never crunching on shards, the
heartbeat having moved bus, a blade hit also voiced as a bullet, a wall bounce able to ring as
glass, four draw calls instead of two, and rays cast for sounds that were then dropped. A second
reviewer re-checked the fixes: six right, one needing more (the grenade's glass contact, redone so
the step's hardest contact decides), one housekeeping item missed (done). Before that, the unit
test author found three issues, also fixed: the ground muffling less than three walls, a hit of
under one point leaving a free hole, and a stale night-mode expectation.

## What is not verified

- **How anything sounds, by the build side.** Gustav has since listened and approved it; this is
  what the build could not judge. Nobody on the build side can hear. The measurements prove levels,
  left and right, distance, dullness, arrival and that front, behind, above and below produce
  different signals. They do not prove a rifle sounds like a rifle, that the mix is pleasant, that
  HRTF reads as "behind" to your ears (generic ear models do not work for everyone), that the house
  reverb sounds like a room, or that night mode is comfortable. That is the sound test page's job.
- **The glass on a real GPU.** Captures were taken with software rendering: placement, cracks,
  shards and the rim are verified; the tint, the reflection strength and how the pane reads at
  night, in fog and at a distance are not.
- **Firefox and Safari.** Only Chromium was run. The engine falls back to the older listener and
  panner methods where the newer ones are missing, untested.
- **The last fixes in a browser.** The audit fixes (above) were verified by typecheck and the
  unit suite only. The one that changes behaviour in play is the grenade's bounce off glass.
- **Multiplayer sound.** That another player's shots and steps are placed correctly was seen in a
  script (voices opened, no errors), not asserted by a spec, and never heard.
- **A real firefight's load.** HRTF with many voices was not measured on a slow machine; 3D Audio
  off is the cheaper path if it ever stutters.
- **No listening tool was used.** The brief allowed a Gemini listening pass as a second opinion; it
  was not done. Every statement about sound here is a measurement.

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
