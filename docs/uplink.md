# Operation Uplink (rebuilt in v5.0.0)

The single-player mission, rebuilt from "hold three towers, then extract" into an operation in four
different stages: breach a terminal, fetch a data core, defend its upload, extract. It runs on both
maps, with mouse or controller, on top of the pacing director. The rules are
`src/core/mission/missionState.ts` (pure), the grade is `missionGrade.ts`, the HUD wording is
`missionText.ts`, where it happens on each map is `src/world/missionSites.ts`, the beams and the
core in the world are `src/world/UplinkBeacons.ts`, and `Game.ts` wires them (`startMission`,
`restartMission`, `redeployMission`, `updateMission`, `handleMissionEvents`, `updateMissionHud`).

It replaces the mission described in `docs/visual-overhaul.md` (phase 4), which is history now.
Co-op is decided (D12, D14 in `docs/fable-rebuild-decisions.md`) but not built: see "Co-op later".

## What a player sees

- The setup card `Operation Uplink` ("Breach, fetch the core, defend, extract"), then a briefing in
  four steps that holds the world until it is skipped (`MISSION_EXPLANATION`).
- The objective panel, top left: `UPLINK 2/4 | FETCH`, what to do now, and a line with the stage's
  progress, the alert level and the redeploys left (`HACK 40% | ALERT 2 | REDEPLOYS 2`).
- A world marker, a compass marker and (on the Facility) a minimap marker on the place the stage
  sends the player to: `TERMINAL`, then `DATA CORE` and `RELAY`, then `RELAY`, then `EXTRACT`.
- A beam over the terminal, the relay and the extraction point: amber while waiting, pulsing while
  the hack or the upload runs, cyan once done. The data core is a cyan crystal in a turning amber
  ring with a beam over wherever it lies; on the Valley the beam rises from the ground above the
  lab. A ring on the ground marks the extraction.
- A headline at each stage change, `WARDEN INBOUND` as the last wave comes, and field report lines for the
  alert rising and the core changing hands.
- The prompts `TAKE THE DATA CORE` and `PLUG IN THE DATA CORE` under the crosshair, with the key or
  the pad button.
- After a death with a redeploy left: `Operative down`, where the redeploy goes, the stage, the
  redeploys left and the alert. Respawn takes the redeploy.
- The end screen: `Operation complete` with the grade, or `Signal lost` with the stage reached,
  then time, damage taken, redeploys used, kills and the alert level. Respawn starts a new
  operation.

## The four stages (`missionState.ts`)

| Stage | Rule | Numbers |
|---|---|---|
| 1 Breach | Stand in the terminal's zone, on the surface, until the hack completes. Leaving the zone pauses it; it resumes where it stopped. Light resistance: one wave of 2. | zone 14 m (`ZONE_RADIUS`), hack 25 s (`HACK_DURATION`), wave at 10 s |
| 2 Fetch | Take the data core with interact, carry it to the relay, plug it in with interact. No sprinting while carrying. The core drops where its carrier dies and can be taken again from there. A pursuit wave meets the carrier when it first carries on the surface, then one every 25 s of carrying there. | take within 3.5 m on the core's level, plug within 9 m of the relay, wave base 2 |
| 3 Defend | The upload runs while a living player is in the relay's zone and pauses otherwise. Three waves: mixed, rushers, then a sniper-led wave with a Warden on top. | upload 75 s (`UPLOAD_DURATION`), waves at 0, 25 and 50 s, bases 2, 3 and 2 (`UPLOAD_WAVES`) |
| 4 Extract | A countdown to reach the extraction point while the pursuit comes: reaching it on the surface wins at once, the countdown running out loses. | 60 s (`EXTRACTION_SECONDS`), ring 6 m, waves at 0 s (base 3) and 30 s (base 2) |

Across all four:

- **Alert level, 1 to 5.** Heat rises with time (a level every 120 s), kills (0.06 a kill) and
  shots fired (0.004 a shot), and never falls. Every wave after Breach's brings its base plus one
  enemy at level 3 and two at level 5 (`waveSize`). Shown in the objective line; each rise is a field
  report line and a tone.
- **Redeploys, two.** When every player is down the operation waits (`squadDown`). With a redeploy
  left, Respawn spends it (`redeploy()`): the stage starts over and the player stands beside the
  site of the last finished stage. Breach restarts from nothing at the start; Fetch restarts at the
  terminal with the dropped core left where it fell; Defend restarts at the relay from the start of
  the wave the player fell in, and that wave comes again; Extract restarts at the relay with the
  full countdown. The alert level and the clock carry on. With none left the operation is lost
  (`Signal lost`, "No redeploys left").
- **Grade** (`missionGrade.ts`), for a win: 100 points, minus one for every 6 s over the 6 minute
  par (30 at most), minus one for every 12 damage taken (30 at most), minus 20 for each redeploy
  used. S from 90, A from 75, B from 55, C below. So one redeploy rules out an S and two an A.
- The pacing director (`docs/enemy-ai-v2.md`, step 6) still runs underneath and sends its own
  waves; the operation's waves go through the same reinforcement spawner (`Game.spawnDirectorWave`).

Why these numbers: the old mission asked for 120 s of standing still (three 40 s holds). The hack is
25 s so the first stage is a warm-up, the upload is 75 s in three 25 s waves so the stand has a
shape, and the extraction is 60 s because the Valley's towers stand 50 to 90 m apart, which is 10
to 20 s at a sprint: the countdown is pressure under fire, not a race against the map. Par is about
a minute and a half over a run with no fighting.

## Where it happens (`src/world/missionSites.ts`)

`planOperation` (pure, in `missionState.ts`) turns a map's four objective points into the four
sites: the terminal is the point nearest the start, the core lies at the point farthest from the
terminal, the relay is the remaining point farther from the core (so the carry is the long way), and
the last is the extraction. Everything is a function of the world seed.

- **Valley** (`valleyOperationSites`): the four watch towers. The core lies down in the lab under
  its tower (`docs/underground-lab.md`), on the deepest free floor site of the lab's interior, and
  only towers with a lab can hold it. With no lab under any of the three (a dead-end stair under
  each, which the lab solver avoids) it lies on the ground beside its tower.
- **Facility** (`facilityOperationSites`): the four objective rooms of `facilityMissionObjectives`,
  a console in each. The core rests on the console of the room farthest from the terminal.

A redeployed player stands on the first clear point of a ring round the site (`standPointNear`), so
never inside a tower's footprint or a console.

## The Warden (`src/entities/enemies/archetypes.ts`)

An elite archetype, `WARDEN` ("The Warden"), in `ELITE_ARCHETYPES`: the seeded random picker never
returns it, `archetypeNamed('The Warden')` does. Against a Straggler (the rifleman): 240 health to
60, 1.9 m/s to 2.5 (slower than a walking player, so it can be kited), bursts of 6 rounds to 3 at 7
damage a round to 9. Its `look` (scale 1.22, amber tint) is applied by `applyArchetypeLook`
(`archetypeLook.ts`) in `Game.spawnDirectorWave`, whose `leader` argument puts it first in a wave:
the model grows from its feet and wears tinted copies of the shared materials with a faint glow, and
no light is added. Showdown's finale uses the same call.

Known limit: the hit colliders are not scaled with the model, so the Warden's head collider sits
where a rifleman's head would be (about its collar). Body shots land as they look.

## Co-op later

`MissionState` takes the players as a list of `{ x, z, alive, underground }` and an interact press
as the index of the player who pressed. Zones count any living player, the core records which player
carries it, any player can take a dropped core, and the operation only waits for a redeploy when
every player is down. Solo passes one player. Nothing here sends a network message.

## Debug hooks (`window.__gameDebug`, `gameDebugApi.ts`)

- `getMissionDebug()`: the whole `MissionView` (phase, stage and its number, the sites, the hack,
  the core, the upload and its wave, `extractionLeft`, `alert`, `redeploys`, `awaitingRedeploy`,
  `prompt`, `loss`, `elapsed`) plus `won`, `kills`, `damageTaken`, `carrying` and `corePosition`.
- `completeMissionStage()`: finishes the current stage as if its rule had been met.
- `advanceMission(seconds)`: runs the operation's own clock forward with the player where they
  stand, so timers and waves fire in a slow browser run.

## Tests

- `src/core/mission/missionState.test.ts`: the site plan, each stage's completion rule, pausing
  outside the zone and underground, taking, carrying, dropping and plugging in the core, the alert
  level and wave sizes, redeploys in each stage and the loss after two, the extraction's win and
  loss, the test hook, the map markers.
- `missionGrade.test.ts`, `missionText.test.ts`, `src/world/missionSites.test.ts` (40 Valley seeds,
  20 Facility layouts), and the Warden in `src/entities/enemies/archetypes.test.ts`.
- `e2e/mission.spec.ts` (group `mission`): the whole operation on the Valley with a death and a
  redeploy, the Warden's wave and the graded win; then both losses and a fresh start.
- `e2e/facility-modes.spec.ts`: the four sites inside the Facility and its map markers by stage.

Run them: `npx vitest run src/core/mission src/world/missionSites.test.ts
src/entities/enemies/archetypes.test.ts`, and from a snapshot `npm run test:e2e:group -- mission`.

## Where to change things

| To change | Look at |
|---|---|
| A stage's numbers, the waves, the alert | the constants at the top of `missionState.ts` |
| The grade | `missionGrade.ts` |
| Any HUD wording, headline or marker label | `missionText.ts` |
| The briefing | `MISSION_EXPLANATION` in `src/core/modeExplanations.ts` |
| Which point is which site, where the core lies | `planOperation`, `src/world/missionSites.ts` |
| Beams, the core, the extraction ring | `src/world/UplinkBeacons.ts` |
| The Warden | `WARDEN` in `archetypes.ts`, `archetypeLook.ts` |
| The end screen | `DeathScreen.showMission`, `MissionResult` in `src/ui/deathScreen.ts` |
