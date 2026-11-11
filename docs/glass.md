# Glass windows

As built for `feature/sound-and-glass` (2026-11-11). Every window opening of a Valley house holds a
pane of glass that takes bullet holes, cracks, and breaks, leaving the open window that was there
before. The Facility has no windows and gets none. Decisions and their reasons are in
`sound-glass-decisions.md`.

## What a player sees

- **Intact:** a lightly tinted pane in the frame. On Medium and High it picks up the sky at grazing
  angles (the fog colour, so it follows day, night and weather); on Low it is flat tinted glass.
- **Hit:** a hole exactly where the round struck, a crushed white rim, and cracks running out from
  it: 7 to 10 radial cracks of different lengths and partial ring cracks, different for every hole.
  The cracks lengthen as the pane takes more hits. The same hole is in the same place from inside
  and outside, and for every player.
- **Broken:** the sheet bursts into 24 shards that fly the way the force travelled and fall. A
  jagged rim of glass stays in the frame, and six pieces lie where they landed: two on the sill, two
  on the floor inside, two on the ground outside. The opening is open again: sound, shots and
  grenades pass as they did before there was glass.

## The numbers

A pane has **6 points** (`PANE_STRENGTH`, `src/world/glass/glassPane.ts`).

| What hits it | Cost | Rounds to break |
|---|---|---|
| A round doing under 35 damage (pistol, MP5, machine pistol, rifle, SMG, battle rifle, machine gun) | 1 | 6 |
| A round doing 35 to 59 (revolver, marksman rifle) | 2 | 3 |
| A round doing 60 or more (sniper) | 3 | 2 |
| One shotgun or sawn-off pellet | 1 | a full blast on the pane breaks it at once |
| An enemy's round | 1 | 6 |
| A thrown grenade bouncing off it | 1 | |
| A blade (any melee strike whose ray crosses it) | all 6 | at once |
| A frag within 7 m of the pane's centre | all 6 | at once |
| An exploding goose within 6 m, or a thrown goose flying through it | all 6 | at once |
| A flash grenade | none | |

Up to 8 holes are kept and drawn per pane (`MAX_HOLES`); later hits still count toward breaking.

## What glass does to the game

| Thing | Intact pane | Broken pane |
|---|---|---|
| Bullets (players and enemies) | Pass through at full damage, leaving a hole | Pass |
| Thrown grenades | Stopped: the grenade bounces off (and knocks 1 point off) | Pass |
| Blast damage and knockback | Pass (the blast breaks the pane anyway) | Pass |
| Players | Cannot pass, but never could: a window is 0.75 to 0.9 m high and the player 1.8 m | Same |
| Enemy sight and enemy shots | Pass: glass is see-through | Pass |
| Sound | Muffled, less than by a wall (`docs/sound.md`) | Open |
| Footsteps | | Walking on the shards under a broken window crunches |

## How it is built

**A pane is not a physics collider.** It is an upright rectangle that rays are tested against, the
way the lamps are. The code has no collision groups, and everything except a thrown grenade must
pass through glass, so a collider would have had to be skipped by every query in the game. Instead:

- `src/world/glass/glassPane.ts` (pure): the state machine (`applyHit`, `mergeStates`), the windows
  of each house design (`layoutPanes`), pane ids, a pane's place in the world (`paneToWorld`), the
  ray, segment and ball tests (`rayPane`, `segmentCrossesPane`, `sweepPane`), and the parsing of what
  arrives from other players.
- `src/world/glass/GlassStore.ts`: every hit pane's state for the whole match, and the panes of the
  houses streamed in right now. It answers the questions the game asks (which intact panes does this
  ray cross, how many lie between two points, what does this ball touch first, which are near this
  blast, is there broken glass underfoot) and tells one listener when a pane's look must change.
- `src/world/glass/GlassView.ts`: the drawing (below).
- `ValleyHouses` owns the store and the view: `housePlaced` adds a house's panes, `houseRemoved`
  takes them out of the world and keeps their state.
- `Game` wires the hits: `handleHitscanRay` (the player's rounds and blades), `shootGlass` (any ray),
  `hitGlass` (one hit: state, sound, and the send), `breakGlassNear` (a blast).

**Pane id** = house key x 16 + the window's index in the design's layout (walls in order, openings
in order, windows only). The layouts are constants, so the id of a window never changes. The block
has 11 windows, the bunkhouse 4, the workshop 6.

**Streaming.** The store keeps state by pane id for the whole match. A house that streams out takes
its panes out of the world; when it streams back the store replays each pane's state to the view, so
a broken window comes back broken with its shards on the floor and a cracked one with its holes.

## Drawing and cost

Two draw calls and two materials for every window in the world, in every state (both materials
are single-pass: three would otherwise draw a see-through double-sided material twice):

- **Panes:** one instanced quad per streamed-in window (room for 768), one `ShaderMaterial`. A
  pane's holes travel as instance attributes (four `vec4`, two holes each) with its hole count,
  broken flag and a seed. The fragment shader draws the hole, rim and cracks from those numbers, and
  for a broken pane discards everything but a toothed rim. A shot that lands writes a few floats into
  an attribute buffer: no mesh, material, texture or light is created and nothing compiles.
- **Shards:** one instanced triangle (`MeshLambertMaterial`), 648 instances: 72 for pieces in the
  air (three panes bursting at once) and 6 lying pieces for each of up to 96 broken windows. The
  flying pieces are simulated only while any are in the air.

Both meshes are in the scene from the first frame, so their programs compile at match start. No
lights are added (the fixed light count is untouched).

Measured cost is in `docs/sound-glass-handover.md`.

## Between players

Networked like the lamps: the one who causes a hit decides it and tells the others.

- **`glassHit`** `{ pane, u, v, power, side }`: one hit on one pane at (u, v) metres from its
  centre. Receivers apply the same hit, so the pane cracks or breaks the same way everywhere. `side`
  is the way the force travelled, for the shards. Relayed by the host like `lampDestroyed`.
- **`glassSync`** `{ panes: [{ id, d, b, h }] }`: a client's whole set of hit panes (damage, broken,
  holes). Sent once to each opponent on their first snapshot (which is how a late joiner or a
  rejoining player is told) and every 5 s while the set has changed (`network/glassSync.ts`).
  Receivers keep the more damaged state of each pane, so the views only grow toward the same
  windows.

Who decides: a player's own rounds, blades, grenades (the bounce and the frag) and thrown geese are
decided by that player and sent. Enemy rounds are decided by the client that runs the enemies
(solo, or the host). An exploding goose breaks glass on every client without a send, because every
client sees the same explosion; the sync catches any difference within 5 s.

Both messages are new; no existing message or the welcome was changed. **They need a routing class
on `feature/server-relay`** (they are relayable, like `lampDestroyed` and `lampSync`).

Received messages are validated: the pane must be a real window of a real house in this world
(`ValleyHouses.isPaneId`), numbers must be finite and inside a pane's reach, and a sync list is read
only up to 2,048 entries.

## Scope calls

- **The bunkhouse's glazed front panel stays a drawn panel on a solid wall.** Enemy navigation,
  cover and the layout tests rely on that wall; turning it into an opening is a change to the house,
  not to the glass.
- **The watch towers' slits stay open.** They are firing ports.
- **The Facility gets no glass.** It has no windows and adding them would not improve the map.

## Tests

- `glassPane.test.ts`, `GlassStore.test.ts`, `glassSync.test.ts`, and the glass cases in
  `protocol.test.ts` and `valleyHouses.test.ts`: the state machine, ids, geometry, sync and
  streaming persistence.
- `e2e/glass.spec.ts`: a pistol round holes a window where it struck, more rounds break it, the
  window is still broken after its house streams out and back; an intact pane stops a thrown grenade
  and the frag breaks it.
- `e2e/multiplayer-glass.spec.ts`: a hit by one player shows for the other at the same spot, a break
  by the other shows for the first, and a player who rejoins the running match sees the glass as it
  is.
- Debug hooks: `getGlassDebug(radius?)`, `hitGlass(id, u, v, power)`.
