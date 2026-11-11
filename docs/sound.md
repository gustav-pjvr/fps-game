# Sound

As built for `feature/sound-and-glass` (2026-11-11): the sound engine rebuilt as a spatial engine.
The aim: with eyes closed, a player can tell where a shot came from (left, right, front, behind,
above, below), roughly how far, what fired it, and whether there is a wall between. Decisions and
their reasons are in `sound-glass-decisions.md`. What was measured and what only ears can judge is in
`sound-glass-handover.md`.

Everything is still synthesized with Web Audio. There are no samples, so the public repository
carries no audio files; the only recorded audio remains the Facility's music track (`docs/music.md`).

## How a sound reaches the ears

A sound is one **event**. All its layers (a gunshot's snap, crack, bark, thump and tail) play into
one **voice**, and the voice carries the event to the mix:

```
layers -> gain (distance x walls) -> low-pass (air, walls, rear) -> PannerNode -> bus
                                          \-> send -> reverb of the listener's space
```

- **Callers pass a world position**, never a volume or a pan: `sound.playGunshot('rifle', origin)`.
  The player's own sounds pass no position and play in the middle of the head.
- **The listener** is the camera: `Game.render` gives the engine the camera's position and
  orientation every frame (`setListener`).
- **Direction** is a `PannerNode` at the source's position. With 3D audio on (the default) it uses
  HRTF, the only model in which front, back and height differ; a light rear low-pass backs it up.
  With 3D audio off it is equal-power left and right panning, and the rear low-pass is stronger,
  because plain panning cannot tell front from back.
- **One panner per event**, not per layer, keeps HRTF affordable in a firefight. A positioned sound
  that would arrive under a gain of 0.004 is not played at all (no nodes are made), and past 28 live
  voices only loud sounds get one.

Files: `src/audio/SoundEngine.ts` (the engine and every recipe), `spatial.ts` (loudness, air,
arrival, direction: pure), `occlusion.ts` (what a wall or a pane does: pure), `mix.ts` (buses and
dynamics: pure), `ambience.ts` (reverb impulses, wind, music mix, heartbeat: pure),
`weaponSounds.ts` (per-weapon profiles), `soundCatalog.ts` (every sound by name, for the test page),
`src/world/soundProbe.ts` (the rays).

## Loud and soft

Each kind of sound has a loudness model (`LOUDNESS` in `spatial.ts`): full level inside a reference
distance, then inverse distance, with either a floor (never silent) or a maximum range (eased to
nothing).

| Kind | Full within | Gone at | Floor | Air halves the top every |
|---|---|---|---|---|
| Gunshot (and the scope glint warning) | 8 m | never | 0.05 | 30 m |
| Explosion | 10 m | never | 0.05 | 45 m |
| Voice (callouts) | 5 m | 70 m | | 40 m |
| World (doors, breakers, lamps, a window breaking) | 4 m | 60 m | | 35 m |
| Impact (bullet strikes, a round through glass, a bullet passing) | 2.5 m | 45 m | | 30 m |
| Footstep | 2 m | 32 m | | 22 m |
| Small (grenade bounce) | 1.5 m | 25 m | | 20 m |
| Blade (swings, a grenade's throw) | 2 m | 15 m | | 25 m |

- **Far sounds are duller, not only quieter.** The voice's low-pass closes with distance: a rifle at
  150 m keeps nothing above about 750 Hz. More of a far sound goes to the reverb (up to four times
  the close-up send), so a distant shot is mostly its ring off the valley.
- **Far shots and blasts arrive late:** the speed of sound, from 20 m out, capped at 0.4 s.

## Buildings matter

For every positioned sound, once, as it starts, the engine asks the world what lies between the
source and the listener (`probeSoundPath`):

1. **The straight line.** Clear (an open door, an open or broken window, open air): the sound is
   clear. Otherwise every separate solid on the line is counted, up to three, and the ground itself
   is noted.
2. **Bent lines**, only if the straight one is blocked: to points 1.7 m beside the source on either
   hand and above it, each of which the source must itself see. A clear one means the sound gets
   round (a tree trunk, a corner, the top of a wall): slightly quieter and duller, not walled off.
3. **Glass:** intact panes on the line, from the glass store (`docs/glass.md`).

| Between source and listener | Gain | Low-pass |
|---|---|---|
| Nothing | 1 | open |
| Round a corner | 0.72 | 6.5 kHz |
| One intact pane | 0.6 | 3.6 kHz |
| Two panes | 0.36 | 2.4 kHz |
| One wall | 0.32 | 900 Hz |
| Two walls | 0.18 | 620 Hz |
| Three or more | 0.1 | 430 Hz |
| The ground (a hill, or a lab under the valley) | 0.08 | 380 Hz |

**Budget:** at most 10 ray casts per sound (`MAX_CASTS`), at spawn only, never per frame. The
longest positioned one-shot lasts about 1.6 s, so none is refreshed while it plays. Only fixed
world colliders count (walls, floors, doors, terrain, trees, crates); players, enemies and sensors
do not. Terrain inside a lab's cut zone is skipped the way shots skip it. Measured cost is in the
handover.

**Where the listener stands** picks the reverb every sound rings in (`listenerSpace`):

| Space | When | Reverb |
|---|---|---|
| Outdoors | The Valley, in the open | The valley: 2.4 s, long and thin |
| Room | Inside a Valley house | A furnished room: 0.5 s, bright, close reflections |
| Hall | The Facility | Concrete: 1.5 s, duller |
| Underground | A lab under the Valley | The hall, longer on the ear and darker |

A sound walled off from a listener in a house rings outdoors, not in the listener's room. The
**wind** over the valley is a standing layer: full outdoors, dull and quiet inside a house, gone
underground and absent in the Facility, so walking through a door is audible even in silence.

The old flat "underground" multiplier is gone: a sound on the other side of the ground is occluded
by the ground like anything else.

## The mix

Buses, each with its level (`BUS_LEVELS`): weapons, movement, world, voices, blast, interface. Then:

```
weapons, movement, world, voices -> duck -+
blast, interface --------------------------+-> effects volume -> limiter -> soft clip -> master -> out
music ------------------------------------------------------------------------------------^
```

- **Ducking:** a near explosion pulls weapons, movement, world and voices down by up to 65 % for
  about a second. The blast itself and the interface are not ducked.
- **Limiter:** a compressor set as a limiter (threshold -5 dB, ratio 20), then a soft clipper that
  is linear to 0.7 and bends so that no sample leaves above 1. A firefight cannot clip.
- **Night mode:** the same compressor set hard (threshold -36 dB, ratio 8) with makeup: quiet sounds
  come up and loud ones come down, for playing at low volume.
- **Music** joins after the limiter, so gunfire does not pump it.

**Settings** (Settings, Audio): Master Volume, Music Volume, Effects Volume, 3D Audio (headphones),
Night Mode, and a link to the sound test page.

## Every sound

"Redesigned" means a new recipe. "Kept" means the old recipe was judged right for what it is and
carries on, now placed in the world and on a bus. "New" did not exist.

| Sound | Status | What it is now |
|---|---|---|
| Gunshot, each of 13 weapons and the enemies' rifle | Redesigned | Five layers: snap, crack, bark (a band per gun, so guns differ in more than level), thump, tail; a sub for the heavy cartridges; the pump or bolt after. No suppressed variants: the game has no suppressor. |
| Reloads (6 patterns) | Redesigned | Each step is a noise transient with a short metallic ring under it. |
| Casings | New | Two or three small brass notes after the player's own shot, on hard floors only, rate limited. |
| Bullet passing close | New | A falling hiss placed at the nearest point of the bullet's path, for enemy and other players' misses within 3 m of the head. |
| Bullet impacts: earth, wood, metal, concrete, glass, a body | New | Earth thuds and hisses, wood knocks and splinters, metal pings, concrete cracks and scatters grit, glass ticks, a body thuds. At most 3 voiced per tick. |
| Blade swings (6 blades) | Redesigned | Two bands: the body of the swing and an edge of air. Placed for other players. |
| Blade hits a body | Redesigned | Thud, wet tick, low body. |
| Enemy melee swing | New | Heavier and lower than a knife. |
| Footsteps by surface and pace | Redesigned | Earth, wood, concrete, metal, broken glass; walk or run; a heel thud plus the surface's texture. Other players' steps are placed and use the surface at their feet. |
| Enemy footsteps | New | A heavier boot every 1.9 m walked: enemies are heard coming. |
| Window: a round through it | New | The tick of the hole and cracks running. |
| Window: breaking | New | The crash, the sheet going, shards landing over the next second. |
| Lamp shot out | Kept | Placed, on the world bus. |
| Door slide, breaker | Kept, rebalanced | Placed; levels lowered to sit under gunfire. |
| Goose explosion | Redesigned | Crack, roar, sub; ducks the mix. |
| Frag | Redesigned | Kept its five layers, a lower sub, debris landing after; ducks the mix fully. |
| Flash | Kept | Placed, on the blast bus. |
| Grenade pin, throw | Kept | The throw is placed for other players. |
| Grenade bounce | Redesigned | A body under the clink; off a window it rings higher and thinner. |
| Enemy callouts | Kept | Their shapes carry meaning (rising, three quick, falling). Placed; lowered so they inform rather than startle. |
| Scope glint warning | Kept | It is a warning, so it carries as far as a gunshot. |
| Hit confirm | Kept, refined | A second partial; kept apart from every world sound on purpose. |
| Player hurt | Kept, refined | A small mid tick added. |
| Ping, objective cues, pickups, torch click | Kept | Interface sounds, on the interface bus, never ducked. |
| Heartbeat | Kept | On the interface bus. |
| Wind | New | See "Buildings matter". |
| Reactor hum, combat music, Facility music | Kept | Unchanged. |

**Enemy hearing is unchanged** (`EnemyBrain.onHeardGunshot`): the AI does not use the audio model.

## Surfaces

Colliders carry no material, so surfaces are read from where a point is (`Game.stepSurfaceAt`,
`Game.impactSurfaceAt`):

- Footsteps: the Facility is concrete; a lab is metal; the shards under a broken window are glass;
  inside a house is wood; everything else is earth.
- Impacts: a body; the Facility is concrete; a lab is metal; within 0.2 m of the terrain is earth;
  a house wall is concrete; anything else standing in the valley (trees, towers, crates) is wood.

## The sound test page

`/soundlab.html` (linked from Settings, Audio; `src/soundlab/soundLab.ts`). It runs the game's own
engine with no world: the listener stands at the origin facing forward.

- Choose **where the sound comes from**: near, left, right, behind, above, below, far, behind a
  wall, two walls, through a window, round a corner, underground, a circle round you, coming closer.
- Choose **where you are standing**: outdoors, in a house, the Facility, an underground lab.
- Press **Play** on any of the 77 sounds. Sounds the player also makes have a **Mine** button.
- 3D audio, night mode and volume are the game's own settings.

## Measuring instead of hearing

`node scripts/soundRender.mjs` (with `npx vite --port 5193` running) renders every sound offline
through the same engine in a real browser and checks, for each one: not silent, not clipping, louder
or earlier in the ear on its side, much quieter and duller at 120 m, quieter and duller behind a
wall, a window in between, duller behind with 3D audio off. Across sounds: front, behind, above and
below differ with HRTF; a far shot arrives late; no two guns measure the same; a firefight does not
clip; night mode narrows the range; a house rings shorter than the valley. `--wav <dir>` saves a few
renders as files.

Tests: `spatial.test.ts`, `occlusion.test.ts`, `mix.test.ts`, `ambience.test.ts`,
`soundProbe.test.ts` (a small Rapier world), and `e2e/soundlab.spec.ts` (the page).
Debug hook: `getSoundDebug()` (voices opened and skipped, probe casts, the listener's space).
