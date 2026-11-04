# Night and visibility (as built, v4.5.0)

How darkness changes the game: what enemies can see, what the player sees, the torch, the weather
choice and flash grenades. The plan was section 6 and 8 of `docs/squad-arsenal-night.md`; where
they differ, this file is right. Grenade numbers are in `docs/grenades.md`, the Facility's lighting
in `docs/facility-map.md`.

## 1. The visibility factor

`visibility(inputs)` in `src/entities/enemies/playerVisibility.ts` returns the player's visibility
to enemies, 0.2 to 1. `Game.update` (`src/core/Game.ts`) calls it once per fixed tick and stores it
in `playerVisibility.value`, next to the eye position, the aim and `torchOn`.

Rules, in the order the function applies them (the first match wins):

| Case | Value | Constant or source |
|---|---|---|
| A shot fired in the last 0.6 s (`secondsSinceShot`, set by the muzzle flash hook in `Game.ts`) | 1 | `playerVisibility.ts` |
| A flash grenade's light is on the player (`flashLightsPlayer`) | 1 | `FLASH_LIGHT_SECONDS` 0.15 s, `FLASH_LIGHT_RANGE` 28 m (`grenadeTuning.ts`) |
| Valley, inside a house room whose lamp is off or shot out, in Night or Fog | 0.3 | `DARK_HOUSE_ROOM` |
| Valley, Dusk | 1 | `playerVisibility.ts` |
| Valley, Fog | 0.75 | `playerVisibility.ts` |
| Valley, Night | 0.4 | `playerVisibility.ts` |
| Facility | see below | `playerVisibility.ts` |

The player's own torch is not in this function. `Game.ts` passes `enemyInTorchBeam: false` and the
beam is judged per enemy (section 2).

**Facility.** The light at the player comes from the baked probes (`FacilityWorld.probeAt`, the
same sampler that lights moving things), turned into luma `0.2126 r + 0.7152 g + 0.0722 b`:

```
visibility = clamp(0.25 + 0.75 * (luma - DARK_LUMA) / (LIT_LUMA - DARK_LUMA), 0.2, 1)
LIT_LUMA  = 0.36812848785519603   (atrium centre, seed 1)
DARK_LUMA = 0.12890296173673124   (first dark room centre, seed 1)
```

So a lit room reads 1, a dark room 0.25, and a room whose lamps were shot out can fall to the 0.2
floor. The two luma values were measured on seed 1 with the real bake, and the test "calibrates a
real lit atrium and dark room" (`src/entities/enemies/playerVisibility.test.ts`) fails if the bake
changes. Weather is ignored indoors. Shooting a lamp out recomputes the probes near it
(`FacilityBuilder.killLamp`), so the number follows the room.

## 2. How enemies use it

Visibility shortens **acquisition** only. All of this is in `src/entities/enemies/EnemyBrain.ts`
and `perception.ts`.

- Each tick `EnemyBrain.update` sets `playerVisibility = visibilityForEnemy(visibility, head)`.
  That is 1 when the torch is on and the enemy's head is in the beam, else the player's value.
- **Beam test** (`enemyInTorchBeam`): within 28 m of the eye and within 25 degrees of the aim
  (vertical aim included). The visible spot light is a little narrower and longer: 0.38 rad
  (about 21.8 degrees) and 32 m (`src/render/Flashlight.ts`).
- **Sight range** is `detectionRange * visibility`. Archetypes have `detectionRange` 18 or 20 m and
  `leashRange` 26 or 32 m (`archetypes.ts`). At Night an 18 m enemy notices from 7.2 m, in Fog from
  13.5 m, in a dark Facility room from 4.5 m.
- **Where the scaled range applies:** the view cone test (`isWorthLooking`, `sightFactor`), the
  awareness fill (`sightFactor`), and the line-of-sight ray of an enemy that is idle or searching
  (`sightRayRange(false, ...)`). A searching enemy re-spots the player only inside the scaled range.
- **Fill rate** is `visibilityFactor(...) * visibility`: the distance term is computed against the
  scaled range, then the whole fill is multiplied by visibility. With `ENEMY_AWARENESS_FILL_TIME`
  0.6 s, a still player at close range takes 0.6 / 0.4 = 1.5 s to be detected at Night (1 s when
  sprinting, because of `ENEMY_AWARENESS_MOVEMENT_BONUS` 0.5) and 2.4 s in a dark Facility room.
- **Not affected:** the chase leash. `sightRayRange(true, ...)` returns `leashRange` for an enemy
  that is alert or chasing, so a chase in the dark does not drop at a few metres. Hearing
  (`hearingRangeFor`, `ENEMY_WEAPON_LOUDNESS_RANGE` in `config.ts`) is also unchanged.
- **Firing and the flash** reveal the player: a shot gives 1 for 0.6 s, and a flash grenade's light
  gives 1 for 0.15 s within 28 m.

Enemies exist only in single-player. A multiplayer match is pure PvP (`App.createMultiplayerGame`),
so there the factor is computed but nothing reads it.

## 3. The visibility eye on the HUD

A small eye icon sits beside the health number (`lightMeter` in `src/ui/hud.ts`). Its opacity is
the visibility, so it fades as the player hides. The tooltip is "Visibility to enemies" and the
accessible label reads "Visibility to enemies: N%". `Hud.setVisibility` only writes when the whole
percent changes.

It shows whenever the match has a torch: the Facility, Valley Night and Valley Fog
(`Game.ts`: `hud.setVisibility(this.torch ? value : null)`). At Dusk it is hidden.

## 4. The torch

`src/render/Flashlight.ts`. A `SpotLight` at the scene level (not a camera child, which the view
model layer would hide from the world), moved every frame to the front of the gun
(`TORCH_GUN_OFFSET`) or the shoulder for the knife and empty hands (`TORCH_SHOULDER_OFFSET`).

| Value | Setting |
|---|---|
| Angle, penumbra | 0.38 rad, 0.55 |
| Range, decay | 32 m, 2 |
| Intensity | 14 candela (`TORCH_INTENSITY`), colour `0xfff1dc` |
| Shadow | 512 map, only when the graphics preset has shadows (`setCastShadow`) |

- **Availability** (`torchAvailable`): the Facility always, the Valley in Night and Fog, never at
  Dusk. **On by default** (`torchOnByDefault`): the Facility and Night; Fog starts off.
- **Toggle:** the `flashlight` action, default key F, rebindable, D-pad up on a pad. It only
  changes intensity, because adding or hiding a light would recompile every shader.
  `Game.update` consumes the press even at Dusk, where there is no torch. There is no on-screen
  prompt for it.
- **Other players:** `RemoteTorches` is a pool of `MULTIPLAYER_MAX_PLAYERS - 1` shadowless spot
  lights made at match start, each following one opponent's head. Their on state comes from the
  `torch` flag in `playerSnapshot`.
- **Facility:** the torch matters most in dark rooms (about 1 room in 5, one dim amber lamp), after
  lamps are shot out (any hitscan, or a frag within `FRAG_LAMP_RADIUS` 4 m) and after a breaker
  zone is switched off. Emergency lamps stay lit on battery.
- **Valley:** houses have ceiling lamps lit in Night and Fog (`BuildingManager.create` with
  `lampsOn: matchWeather !== 'day'`, `src/core/Game.ts`); shot-out lamps stay dead.
  `ValleyHouses.roomLampLitAt` returns whether the player's room is lit (null outside any house),
  which feeds the 0.3 case in section 1.

## 5. Weather and time of day

There is no clock and no cycle: a match uses one fixed look for its whole length.

`MatchWeather` is `'day' | 'night' | 'fog'` (`src/core/config.ts`). The id `'day'` is the stylised
dusk the art direction is built on and is labelled **Dusk** in the UI (`MATCH_WEATHER_LABELS`), so
the design's "day" is Dusk in the game. Dusk is the default (`DEFAULT_MATCH_WEATHER`).

**Choosing it.** Single-player: the Weather select in `src/ui/menu/PlaySetupModal.ts`
(`buildWeatherRow`), beside the Map select. Multiplayer: the host's select in
`src/ui/menu/CreateRoomScreen.ts`, sent on `matchStart`. On the Facility the select is disabled and
its label reads "Indoor", because weather does not apply there. The rule that every choice has a
look and a defined torch rule is pinned by `src/core/matchWeather.test.ts`.

Looks (`LOOK_PRESETS` and `FACILITY_LOOK` in `src/render/look.ts`):

| Value | Dusk | Night | Fog | Facility |
|---|---|---|---|---|
| Sun or moon intensity | 2.6 | 0.55 | 1.1 | 0 (off) |
| Hemisphere fill | 2.4 | 0.9 | 1.3 | 1, then follows the baked probe |
| Exposure | 1.05 | 1.25 | 1.0 | 1.05 |
| Fog near, far (m) | 30, 640 | 25, 420 | 2, 95 | 6, 48 |
| Stars | none | yes | none | none |
| Window glow | 1.4 | 3.2 | 1.8 | 1.4 |
| Bloom intensity, threshold | 0.85, 0.9 | 1.1, 0.75 | 0.7, 0.95 | 1.1, 0.75 |

Fog also limits how far the player sees (fully fogged by about 95 m), which is separate from the
enemies' scaled sight range. In the Facility the hemisphere light for players and enemies follows
the baked probe of the camera's cell, so a dark room looks dark on a moving model too.

## 6. Flash grenades

Two separate effects, judged per eye. Constants are in `src/combat/grenades/grenadeTuning.ts`.

**Strength** (`src/combat/grenades/flashStrength.ts`): `flashStrength = distance factor * facing
factor`, 0 without a line of sight.

| Part | Rule |
|---|---|
| Distance factor | 1 within `FLASH_FULL_RANGE` 5 m, linear to 0 at `FLASH_MAX_RANGE` 22 m |
| Facing factor | 1 looking at it, `FLASH_FACING_SIDE` 0.45 at 90 degrees, `FLASH_FACING_BEHIND` 0.15 behind, linear in the angle |
| Minimum | below `FLASH_MIN_STRENGTH` 0.1 nothing happens |
| Seconds | `strength * max`, with max 3.5 s for the player and 4 s for an enemy |

**The player** (`GrenadeSystem.goOffFlash`, every client judges its own player):
`FlashBlindness` holds the level at the strength for `FLASH_PLAYER_MAX_SECONDS` (scaled), then
clears it over `FLASH_FADE_SECONDS` 1.2 s (scaled by the peak). A second flash keeps the stronger
and longer one. `blindLevel` drives two things:

- White-out (`src/ui/flashOverlay.ts`): a white layer at `0.94 * level`, over an afterimage (the
  frame at the flash, frozen, blurred, washed out) at `0.55 * min(1, 2.2 * level)` that outlasts
  the white. Under reduced motion the white ramps in over 0.15 s, never passes 0.8, and there is
  no afterimage (`REDUCED_MOTION_WHITE_CAP`, `REDUCED_MOTION_RAMP_SECONDS`).
- Deafness (`src/audio/flashDeafness.ts`, `SoundEngine.setFlashDeafness`): a low-pass on the master
  bus from 20000 Hz (`DEAF_CUTOFF_OPEN`) down to 380 Hz (`DEAF_CUTOFF_CLOSED`), exponential in
  frequency and following `sqrt(level)`, plus a 3300 Hz sine (`RING_FREQUENCY`) at gain
  `0.07 * level` (`RING_PEAK_GAIN`) times the master volume, added after the filter so it stays
  clear. The recorded Facility music is muffled with everything else.

**Enemies** (`EntityManager.applyFlash`, `EnemyBrain.onFlashed`, `src/entities/enemies/flashBlind.ts`):
only the thrower's client blinds them. Each enemy's eye gets the same strength formula with its own
facing, and a blinded enemy:

- loses its awareness and its line of sight, and staggers (`combat.onHeavyHit(Infinity)`);
- if it had seen the player before the flash, stands facing the last-seen spot and fires one wide
  shot every `ENEMY_FLASH_FIRE_INTERVAL` 0.7 s through `ENEMY_FLASH_FIRE_SPREAD_DEG` 15 degrees
  (`config.ts`), while it can fire; one that never saw the player only stands blind;
- ignores the flash's own bang, remembers the last gunshot it hears in range while blind, and
  searches there when it can see again. A second flash keeps the longer time.

The bang is also heard like a shot: `ENEMY_WEAPON_LOUDNESS_RANGE.flash` is 55 m.

**Light.** The detonation lights a point light (`FLASH_LIGHT_INTENSITY` 260, `FLASH_LIGHT_RANGE`
28 m) for `FLASH_LIGHT_SECONDS` 0.15 s. It briefly shows a dark room, and it sets the player's
visibility to 1 (section 1).

## 7. Tests

`playerVisibility.test.ts` (formula, calibration, houses, flash light, per-enemy beam),
`flashBlind.test.ts` (state and `EnemyBrain` behaviour), `flashStrength.test.ts`,
`flashDeafness.test.ts`, `flashOverlay.test.ts`, `matchWeather.test.ts`, all next to their sources.
Run with `npx vitest run src/entities/enemies src/audio src/ui src/combat src/core`.
