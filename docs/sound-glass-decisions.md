# Sound and glass: decision log

Defaults taken by the building session (2026-11-11) for `docs/sound-and-glass-brief.md`. Each has the
reason and what Gustav could overrule. The as-built docs are `docs/sound.md` and `docs/glass.md`.

## Setup

1. **Base is `master`.** `master` contains `src/ui/menu/WorkbenchScreen.ts`, so v5.0.0 is released.
   Branch `feature/sound-and-glass`, worktree `../fps-game-sound`.

## Sound

2. **One spatial voice per sound event.** Every layer of a sound (crack, thump, tail) feeds one voice:
   a gain, a low-pass (distance and walls), a `PannerNode` and a reverb send. One panner per event
   keeps HRTF affordable in a firefight. Overrule: nothing to choose.
3. **The engine works out loudness, not the caller.** Callers pass a world position. The engine
   knows the listener, asks the world what lies between (a probe the game installs) and applies the
   loudness model of that kind of sound. The old `volume, pan` arguments are gone.
4. **HRTF on by default, with a setting to turn it off** (equal-power panning plus a duller rear).
   Reason: HRTF is the only way front, back and height are audible on headphones. Overrule: default
   off if it sounds phasey on his speakers.
5. **Loudness is inverse distance with a floor and a maximum range per kind,** and far sounds lose
   highs through the same voice filter. Gunshots keep a floor (never silent while they can hurt);
   small sounds fade to nothing at their maximum range.
6. **Sound takes time to arrive:** 343 m/s, capped at 0.4 s, only for gunshots and explosions past
   20 m. Reason: the delay is the strongest distance cue there is. Overrule: set the cap to 0.
7. **Occlusion is three probes at most, 12 ray casts at most, once per sound** when it starts
   (long sounds are not refreshed: the longest spatial one-shot is about 1.2 s). The direct line is
   tried first; if it is blocked, two bent paths (above and beside the source) are tried and the
   least blocked wins with a small penalty, so a tree trunk or a corner does not sound like a wall.
8. **No suppressed variants.** The game has no suppressor attachment, so there is nothing to vary.
9. **Samples: none.** Everything stays synthesized, so the public repository carries no audio
   licence question. The Facility music track is unchanged (gitignored).
10. **Enemy hearing is unchanged** (`EnemyBrain.onHeardGunshot`), as the brief allows.
11. **Casings are in, quietly,** on hard floors only and rate limited. Overrule: remove the call.
12. **A wind bed outdoors** that turns dull and quiet indoors and disappears underground, so walking
   through a door is audible even in silence. It is on the effects volume.
13. **Settings added:** effects volume, dynamic range (Full or Night), 3D audio (HRTF) on or off.
   Master and music stay.
14. **The sound test page is its own page, `/soundlab.html`,** in the build and linked from the
   Audio tab. Reason: it loads no 3D world, so it opens at once and also runs the offline
   measurements.

## Glass

15. **Panes are not physics colliders.** They are oriented rectangles tested by ray, like the lamps.
   Reason: bullets, enemy sight and blast rays must pass; only thrown grenades must stop, and their
   sweep asks the glass directly. No collision groups exist in the code and adding them would touch
   every query.
16. **Bullets pass through glass at full damage** and leave a hole. Overrule: a damage multiplier
   in `glassPane.ts`.
17. **Strength:** a pane has 6 points. A round costs 1 (damage under 35), 2 (35 to 59) or 3 (60 and
   up), so a pistol needs 6 rounds, a battle rifle 3, a sniper 2. Each shotgun pellet costs 1, so a
   full blast breaks it at once. A melee hit, a frag within 7 m and an exploding goose within 6 m
   break it at once. A flash does not. A thrown grenade bouncing off costs 1.
18. **Players cannot pass a window today** (the opening is 0.75 to 0.9 m high, the player 1.8 m) and
   that is unchanged.
19. **The bunkhouse's glazed front panel and the watch towers' slits stay as they are.** The panel is
   drawn on a solid wall that the enemy navigation, cover and layout tests rely on; the slits are
   firing ports. **The Facility gets no glass.**
20. **Network: two new messages, `glassHit` and `glassSync`,** nothing existing changed. The welcome
   message is untouched: a late joiner gets `glassSync` on their first snapshot, as lamps do.
21. **Pane id = house key x 16 + the window's index in the design's layout** (walls in order,
   openings in order, windows only). The block has 11 windows, the most of any design.
