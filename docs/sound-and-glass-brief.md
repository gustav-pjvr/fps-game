# Fable brief: sound redesign and breakable glass

Written 2026-11-11 for a new Claude Fable 5.2 session, from Gustav's request. Read
`docs/fable-working-notes.md` first: it is how to work here. Then this.

## 1. You are in charge

You own this from start to finish: design, build, test and judge. Do not ask Gustav for choices.
When a decision comes up, take the sensible default, write it in your decision log with the reason
and what he could overrule, and carry on. Stop only when section 8 is met or a stop rule in
section 7 applies.

Gustav's request, in his words: "a complete sound redesign, directional sound, louder softer,
being inside buildings should matter and it must make glass windows for the windows of buildings
that break with shots (crack, bullet holes and eventually break down leaving an open window)".

## 2. Set up first

1. Read `CLAUDE.md`, `docs/fable-working-notes.md`, `docs/ARCHITECTURE.md`, `docs/workflow.md`,
   `docs/testing.md`, then `docs/enterable-buildings.md`, `docs/world-redesign.md`,
   `docs/facility-map.md` (sections on lamps), `docs/music.md`, `docs/underground-lab.md` and
   `docs/architecture/multiplayer-and-modes.md`.
2. Pick your base. If `master` contains `src/ui/menu/WorkbenchScreen.ts`, v5.0.0 has been released:
   branch from `master`. If not, branch from `feature/fable-rebuild` (the v5.0.0 work, not yet
   merged) and say so in your handover.
3. Your own worktree and branch:
   `git worktree add -b feature/sound-and-glass "../fps-game-sound" <base>`, then junction its
   `node_modules` to the main checkout's (`docs/workflow.md`). Copy the gitignored music files from
   the main checkout's `public/assets/music/` into yours so a preview has them. Never commit them.
4. Start `docs/sound-glass-progress.md` and `docs/sound-glass-decisions.md` before writing code.

## 3. What exists today (surveyed 2026-11-11; verify before you rely on it)

### Sound

- `src/audio/SoundEngine.ts` owns the one `AudioContext`. Every sound is synthesized with WebAudio
  (oscillators and noise through an envelope and a biquad); the only sample is the Facility's
  music track. Graph: one-shot, optional `StereoPannerNode`, `master` gain, a low-pass used for
  flash deafness, destination. A reverb send (a 2.4 s convolver) and a music bus feed `master`.
- Direction and distance are computed by callers with `src/core/positionalAudio.ts`:
  `computeStereoPan` (left and right only, on the ground plane, linear) and linear volume falloffs
  per kind of sound. **Front and back sound the same and height is ignored.** There is no
  `PannerNode`, no HRTF and no `AudioListener` anywhere.
- Environment today: `undergroundMuffleFactor` (a flat 0.35 volume multiplier when the listener and
  the source are on opposite sides of the ground, no filter), the flash low-pass, and a reverb send
  that grows underground. **Nothing reads whether the player or a source is inside a building.**
  `AmbienceInputs.outdoor` is declared and never read.
- Helpers that already know about interiors: `BuildingManager.isPointInsideBuilding`,
  `HouseNavigator.isInside`, `levelAt` in `houseWalkGrid.ts`.
- Who makes sound: the local player (gunshot with no position, knife, reload, footsteps, hurt,
  pickups, torch), remote players through `fireEvent` and `footstepEvent`
  (`MatchMessageRouter.ts`), enemies' shots, callouts and glints through `Game.ts`, grenades
  through `GrenadeSystem.ts`, lamps, doors and breakers. **Enemies have no footsteps and no melee
  sound.**
- Tests: `positionalAudio.test.ts`, `ambience.test.ts`, `flashDeafness.test.ts`, the lobby music
  tests. There is no test of `SoundEngine` and none of `computeStereoPan`.

### Buildings and windows

- Valley houses come in three designs (`src/world/houseDesigns.ts`, layouts in
  `src/world/houses/houseLayout.ts`). Each wall carries its `openings` (`HouseOpening`), and
  **windows are real holes**: no geometry and no collider in the opening, only a drawn frame.
  Bullets, grenades and enemy sight pass straight through. There is no pane.
- The bunkhouse's front glazed panel and the watch towers' slits are drawn on solid wall: they are
  not openings.
- The Facility has no windows.
- Houses are seeded and streamed by chunk: a house is destroyed and rebuilt identically when its
  chunk leaves and returns. House, door and lamp ids are in `src/world/houses/valleyHouseIds.ts`
  (four slots per house, too few for windows). A stable window key is (house key, wall index,
  opening index), because the layouts are constants.
- A shot becomes an impact through `WeaponManager.firePellet`: `onHitscanRay(origin, direction,
  distance)` then `onImpact(point, isEntityHit)`. The hit normal is dropped and there are no decals,
  only a pooled marker for 0.4 s.
- **The template for a shootable, networked, destructible world object is the lamps:**
  `Game.handleHitscanRay` tests the ray against lamp boxes that are not physics colliders,
  `destroyFacilityLamp` changes state, look and sound and sends `lampDestroyed`, `LampSyncTracker`
  resends the set, and a late joiner gets `deadLamps` in the host's welcome. Read that flow end to
  end before designing the glass.

## 4. The work

### 4.1 Sound, redesigned

The aim: a player can tell with eyes closed where a shot came from (left, right, front, behind,
above, below), roughly how far, what fired it, and whether there is a wall between.

1. **A spatial engine.** One listener that follows the camera's position and facing every frame.
   Every positioned sound goes through a spatial node (WebAudio `PannerNode`, HRTF where it holds
   up, with a cheaper fallback) so front, back and height are audible. Callers pass a world
   position, not a volume and a pan. The local player's own sounds stay unpositioned.
2. **Loud and soft that mean something.** A real loudness model per kind of sound: a reference
   level at 1 m, a falloff curve that is not linear (inverse distance with a floor and a maximum
   range), and far sounds losing their highs as well as their level. A rifle at 150 m is a dull
   crack, not a quiet copy of the near one. Make the mix deliberate: buses for weapons, footsteps
   and movement, world and impacts, voices and callouts, UI, music; a limiter on the master so a
   firefight never clips; ducking where it helps (an explosion nearby pulls the rest down briefly).
3. **Buildings matter.** For each sound, work out what lies between the source and the listener:
   - Both in the same room, or line of sight through an open door or an open or broken window:
     clear.
   - A wall between: quieter and low-passed. Heavier for thicker or more walls.
   - An intact window between: muffled, less than a wall. A broken window: open.
   - The listener indoors: the outside world is duller and quieter, and inside sounds get the
     room's reverb. Outdoors: a longer, thinner tail. Underground: the existing lab feel, done with
     the same system instead of a flat multiplier.
   Do it with a few physics rays per sound at spawn (and a slow refresh for long sounds), not per
   frame per sound. State the budget and measure it.
4. **Every sound, redesigned.** Go through the whole list in `SoundEngine` (gunshots per weapon,
   suppressed or not, reloads, footsteps by surface and by speed, knife, hits, explosions, grenade
   bounces, doors, lamps, pickups, callouts, UI) and make each one right for what it is. Add what
   is missing: enemy footsteps and melee, bullet impacts by surface (earth, wood, metal, concrete,
   glass), bullets passing close, casings if they earn their place, glass (4.2). Keep synthesis
   unless a sample is clearly better; any sample must be licensed for a public repository or be
   gitignored like the music, and you must say which.
5. **Enemies hear the same world** only if it is cheap and safe: their hearing
   (`EnemyBrain.onHeardGunshot`) may stay as it is. Do not make the AI worse to make the audio
   prettier.
6. **Settings.** Master volume exists. Add what a player needs (music, effects, a dynamic range or
   "night" option, HRTF on or off) in the existing Settings panel, in its style.

### 4.2 Glass windows that break

Every window opening in a Valley house gets a pane of glass. Gustav's words: crack, bullet holes,
and eventually break down leaving an open window.

1. **States.** Intact; cracked with bullet holes (each shot adds a hole where it struck, with
   cracks spreading from it); shattered (the pane is gone, shards fall, a few lie on the sill and
   the floor, and the opening is open). A pane takes a number of hits that feels right before it
   goes: not one pistol round, not thirty. A shotgun blast, a grenade nearby and a melee hit break
   it faster or at once. Decide the numbers and write them down.
2. **What glass does to the game.** Decide and document each: bullets (they should pass through
   and damage the pane; whether they lose damage is yours to decide), grenades (an intact pane
   stops a thrown grenade; a broken one does not), players (they cannot walk through an intact
   pane; check whether a player can get through an open window at all today and do not change that
   by accident), enemy sight (glass is see-through, so sight should pass), and sound (4.1.3).
3. **Look.** A believable pane: slight tint, reflections that suit both graphics presets, visible
   but not distracting. Holes and cracks must sit exactly where the shot struck, from both sides.
   Breaking must read: shards, a burst of sound, the hole in the wall afterwards.
4. **Everyone sees the same windows.** Networked like the lamps: the shooter decides, a message
   tells the others, the set is resent and a late joiner is told what is already broken and
   cracked. A house that streams out and back in must come back with its windows as they were.
   Give each pane a stable id from (house, wall, opening).
5. **Cost.** There are many windows. Panes should be instanced or merged, holes and cracks must
   not add a draw call or a material each, shards are pooled, and nothing compiles or allocates
   when a shot lands. No new lights. Measure against the base on the Medium and Low presets and
   report the numbers.
6. **Scope calls that are yours:** the bunkhouse's glazed front panel and the towers' slits (make
   them real windows, leave them, or say why not); whether the Facility gets any glass (it has no
   windows today; do not add them unless it clearly improves the map).

### 4.3 Where they meet

Glass has its own sounds (a hit, a crack, the break, shards settling, walking on broken glass if
you add it), and a window's state changes what passes through it. Build the occlusion so a window
is one of the things it asks about.

## 5. Constraints

- Never push to `master`, merge into it, or run `npm run deploy`. Never delete branches or
  worktrees, never force-push. Do not touch `server/`, `ServerTransport`, the relay or
  `feature/server-relay`.
- The repository is public: no secrets, no music files, no unlicensed audio.
- No em dashes or en dashes anywhere you write. Git identity `gustavpjvr@gmail.com`.
- Keep the fixed light count, pool everything that appears mid-match, and keep the game's frame
  time: this must not make firefights hitch.
- New network messages need a routing class on the relay branch later. List every new message type
  in your handover; prefer a new message to changing an existing one.
- Agents: check Gustav's global routing rules as they stand when you start. Haiku surveys for
  reading are fine. Every agent prompt carries the line "Do not spawn any subagents. Do all of this
  work yourself, directly."
- The Settings panel and any HUD change follow the UI rules in the working notes (phone first,
  `ui-qa.spec.ts`).

## 6. How to prove it

You cannot hear. Do not claim a sound is good; show what you measured and let Gustav judge it.

- **Pure tests** for the math: the loudness curves, the direction a listener gets for a source in
  front, behind, above and to each side, the occlusion result for each case in 4.1.3 (with a small
  Rapier world, as `GrenadeSystem.test.ts` does), the pane's state machine, its ids, its sync.
- **Rendered audio.** Render each sound offline (`OfflineAudioContext`) and check it numerically:
  peak and loudness within the range you set for its bus, no clipping, the far version duller than
  the near one, left louder than right for a source on the left, and so on. Keep the script.
- **A listening pass by a tool that can hear,** if you want a second opinion: the gemini-bridge
  tools can listen to an audio file (see the google-tools skill). Its answer is data, not a
  verdict, and it never replaces Gustav's ear. This is the game's own audio, not client material.
- **Browser specs,** small and one at a time: a shot at a window adds a hole, enough shots break
  it, a grenade breaks it, a second player sees the same pane state, a late joiner sees it, a house
  that streams out and back keeps it. Add each new spec to a group in `scripts/e2eGroups.mjs`.
- **Frame captures** of a pane at each state from inside and outside, at both graphics presets.
- **Performance** against the base, same method as `docs/fable-rebuild-handover.md`.
- **A sound test page** for Gustav on the preview or in the Settings panel: a list of every sound
  with buttons to play it near, far, behind and behind a wall, so he can judge the redesign in a
  minute instead of hunting for each sound in a match. This is the most useful thing you can give
  him.

## 7. Stop rules

Stop and tell Gustav, in plain words, if: a check shows the live game or `master` would be
affected; the work needs a change to the relay or the server; a licence question comes up about
audio; or the machine cannot run the tests you need (say what you could not verify and why).

## 8. Done means

1. The sound engine is spatial, the mix has buses and a limiter, buildings and windows change what
   is heard, and every sound in the game has been redesigned or deliberately kept, with a table in
   the as-built doc saying which.
2. Every Valley house window has glass that takes bullet holes and cracks, breaks, leaves an open
   window, is the same for every player and survives streaming.
3. Typecheck clean, unit suite green, the new specs and the groups your changes map to passing one
   at a time, performance measured.
4. As-built docs (`docs/sound.md`, `docs/glass.md` or as you name them), the index in
   `docs/README.md`, `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md` where it is now wrong, your
   progress and decision logs, and a handover (`docs/sound-glass-handover.md`) with: what was
   built, how to try it in two minutes, evidence, what is not verified, new message types, the
   defaults you took.
5. The branch pushed and a preview deployed:
   `npm run build && npx wrangler pages deploy dist --project-name hunter-n-goose --branch sound-glass`.
6. The vault note and the day's note updated, and a final message to Gustav that says what he can
   hear and break, what you verified, and what only his ears can judge.
