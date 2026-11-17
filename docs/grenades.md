# Grenades (v4.4.0, as built; flight, blast and explosion rebuilt for v5.0.0)

Frag and flash grenades, carried beside the guns (not weapon slots). The player picks one kind in the
Loadout screen and carries only that kind. Design:
`docs/squad-arsenal-night.md` section 3. This page records what was built and where it differs.

## Playing them

- **Which kind:** the loadout's `grenade` (`'frag'` or `'flash'`, default frag, saved under
  `fps-game-loadout`). `Game.create` reads it once at match start and passes it to the system as
  `kind`; a Loadout change mid-match does not touch it. It is the same in every mode, and a mode
  without grenades carries none. Other players' grenades keep their own kind in `grenadeThrown`, so a
  guest throwing flashes and a host throwing frags both work, whatever each side carries.
- **Carry:** 2 of that kind at spawn and on every respawn, one count, at most 3 (`addGrenades` tops
  up, for pickups). The count shows under the ammo readout with the kind's name (`FRAG 2` or
  `FLASH 2`), and is hidden in modes without grenades.
- **Input:** Q, or RB on a pad (one rebindable action `grenade`, "Throw Grenade"; E stays interact).
  Key bindings saved by earlier builds (`grenadeFrag` on G, `grenadeFlash` on Q) are dropped on
  load with any other unknown action (`mergeKeyBindings`), and Q goes to `grenade` unless the player
  has put something else on Q. Hold to cook: the gun drops, the throwing arm comes up holding the grenade, and the arc preview shows. Release to throw. A
  tap throws at once. No throw while reloading or mid knife swing. Cooking past the fuse sets it off
  in the hand.
- **Modes:** on in Default, Elimination, Director, Horde, Goose Horde, Mission and King of the Hill;
  off in Knife Only, Gun Game, Sniper Duel, 1 Shot 1 Kill and Goose Toss (`gameModes.ts`
  `grenadesEnabled`).

## How a grenade moves (rebuilt for v5.0.0)

`grenadeFlight.ts`, pure and unit-tested against planes; GrenadeSystem passes it a Rapier shape cast.

- **Throw:** 21 m/s, 0.1 rad above the line of aim (an overarm lob), plus the thrower's own
  velocity. With the game's gravity (20 m/s2) a level throw first lands about 11 m out and a 45
  degree lob carries about 23 m.
- **In the air:** a projectile under gravity, advanced in pieces of at most 1/120 s, so the arc and
  the contacts are the same at any tick length. A sphere is swept along each piece, so nothing thin
  is ever passed through.
- **Hard contact** (faster than 1.4 m/s into the surface): it bounces. 0.4 of the speed into the
  surface comes back, and the speed along it loses at most 0.45 times the hit (Coulomb), so a steep
  drop keeps little forward speed and a flat skip keeps most of it.
- **Soft contact:** no bounce. It keeps only its speed along the surface, and on a floor it rolls:
  it follows the ground, gravity pulls it down a slope, and rolling resistance slows it at 0.45 of
  its weight (9 m/s2 on the flat). A typical throw bounces two to four times, each lower, then
  rolls two or three metres. The model rolls without slipping (speed over radius).
- **Rest:** on a floor, slower than 0.25 m/s, on a slope of at most about 24 degrees. Steeper and
  it keeps rolling. It wakes when what holds it up is gone, and it rolls off edges.
- What was wrong before: a bounce never ended (every touch bounced, however gentle, so a grenade
  chattered along the ground in tiny hops and slid further than it should), there was no rolling
  and no slope, the throw left along the line of aim and fell short, and the flight depended on
  the tick length.

## What a frag does (rebuilt for v5.0.0)

`grenadeTuning.ts` (`computeFragDamage`, `fragKnockback`) and `grenadeBlast.ts` (`blastDistance`,
`blastExposure`).

- **Damage in the open:** 160 within 2 m, then falling with the square of the radius left, to
  nothing at 9 m. Against 100 health that kills out to about 3.5 m, takes about half at 5 m and
  scratches at 8 m. (It was 130 within 1.5 m, linear to 7 m.)
- **Distance** is to the nearest point of the body's upright middle line, not its centre: a frag
  at someone's feet is point blank.
- **Cover:** three rays, to the legs (a quarter of the body), the chest (half) and the head (a
  quarter). The damage and the knockback are multiplied by the share that is exposed. A low wall
  next to the target hides its legs and takes a quarter; a wall close to the blast shadows
  everything behind it. (It was all or nothing: one clear ray gave full damage.)
- **Knockback:** the Goose Launcher's peak, linear to nothing at 6 m, times the exposure.
- **Also:** Facility lamps within 5 m are shot out, the camera shakes out to 24 m, and the danger
  marker shows a live frag within 10 m.
- The fuse is 3.5 s from the pin (it was 3.0), which leaves a full throw about a second on the
  ground.

## Where the code lives

| Part | File |
|---|---|
| Carry, cook, flight, blasts, network copies, positional sounds | `src/combat/grenades/GrenadeSystem.ts` |
| Tuning (every number below) | `src/combat/grenades/grenadeTuning.ts` |
| Flight step and arc prediction (Rapier shape cast) | `src/combat/grenades/grenadeFlight.ts` |
| Frag wall check, flash facing, camera shake | `src/combat/grenades/grenadeBlast.ts` |
| Flash strength and the player's blindness (hold then fade) | `src/combat/grenades/flashStrength.ts` |
| Frag and flash models (shared geometry, pooled per kind) | `src/combat/grenades/grenadeModels.ts` |
| Everything the player sees beyond the grenades (one object for Game) | `src/combat/grenades/GrenadeEffects.ts` |
| Frag explosion (core, fireball and smoke, dust ring, sparks, debris, scorch) | `src/combat/grenades/FragExplosion.ts` |
| Arc preview (accent dots and a landing ring, unlit, depth-tested) | `src/combat/grenades/GrenadeArcPreview.ts` |
| Frag blast reaching the horde's geese too | `src/combat/grenades/grenadeTargets.ts` |
| Throwing arm on the view model, and its keyframes | `src/weapons/GrenadeViewModel.ts`, `src/weapons/grenadeThrowPose.ts` |
| Danger marker | `src/ui/grenadeDangerMarkers.ts` |
| White-out and afterimage | `src/ui/flashOverlay.ts` |
| Muffle and ring | `src/audio/flashDeafness.ts`, `SoundEngine.setFlashDeafness` |
| Sounds | `SoundEngine.playGrenadePin`, `playGrenadeThrow`, `playGrenadeBounce`, `playFragExplosion`, `playFlashBang` |

Game.ts holds `grenades` (the system) and `grenadeEffects`; the effects update once per render frame
after the camera is placed, and take the flash afterimage straight after the frame renders.

## Tuning

| Constant | Value | Meaning |
|---|---|---|
| `GRENADE_START_COUNT` / `GRENADE_MAX_COUNT` | 2 / 3 | carried (of the chosen kind) at spawn / at most |
| `GRENADE_THROW_SPEED` / `GRENADE_THROW_LOFT` | 21 m/s / 0.1 rad | above the aim, plus the thrower's velocity |
| `GRENADE_RADIUS` | 0.07 m | the swept sphere |
| `GRENADE_RESTITUTION` | 0.4 | share of the speed into a surface that comes back from a hard contact |
| `GRENADE_SOFT_IMPACT_SPEED` | 1.4 m/s | a gentler contact does not bounce |
| `GRENADE_FRICTION` | 0.45 | Coulomb coefficient at a contact |
| `GRENADE_ROLLING_RESISTANCE` | 0.45 | rolling deceleration as a share of the weight |
| `GRENADE_REST_SPEED` | 0.25 m/s | below this on a floor that holds it, it comes to rest |
| `GRENADE_FUSE` | frag 3.5 s, flash 1.6 s | from the moment cooking started |
| `GRENADE_THROW_ANIMATION_SECONDS` | 0.45 s | the gun stays down for the throw |
| `GRENADE_HAND_OFFSET` | right 0.18, up -0.1, forward 0.45 m | where a throw leaves the camera |
| `GRENADE_ORPHAN_GRACE_SECONDS` | 2 s | a copy whose detonation never arrives is dropped this long after its fuse |
| `FRAG_RADIUS` / `FRAG_FULL_DAMAGE_RADIUS` / `FRAG_MAX_DAMAGE` | 9 m / 2 m / 160 | squared falloff to 0 at 9 m, times the exposure |
| `FRAG_KNOCKBACK_STRENGTH` / `FRAG_KNOCKBACK_RADIUS` | the Goose Launcher's / 6 m | knockback, linear, times the exposure |
| `FRAG_LAMP_RADIUS` | 5 m | Facility lamps shot out |
| `FRAG_SHAKE_RANGE` / `FRAG_SHAKE_PEAK` / `FRAG_SHAKE_SECONDS` | 24 m / 0.11 m / 0.6 s | camera shake |
| `FLASH_FULL_RANGE` / `FLASH_MAX_RANGE` | 5 m / 22 m | distance factor 1 to 0 |
| `FLASH_FACING_SIDE` / `FLASH_FACING_BEHIND` | 0.45 / 0.15 | facing factor at 90 degrees / behind |
| `FLASH_MIN_STRENGTH` | 0.1 | weaker does nothing |
| `FLASH_PLAYER_MAX_SECONDS` / `FLASH_FADE_SECONDS` | 3.5 s / 1.2 s | white-out hold (scaled) then fade |
| `FLASH_ENEMY_MAX_SECONDS` | 4 s | enemy blindness (scaled) |
| `FLASH_LIGHT_SECONDS` / `FLASH_LIGHT_INTENSITY` / `FLASH_LIGHT_RANGE` | 0.15 s / 260 / 28 m | the flash's light |
| `FRAG_LIGHT_SECONDS` / `FRAG_LIGHT_INTENSITY` / `FRAG_LIGHT_RANGE` | 0.28 s / 230 / 22 m | the frag's light (the same light, warm, 0.6 m off the surface) |
| `GRENADE_DANGER_RANGE` | 10 m | danger marker range |

Visual and audio constants, beside the code that uses them:

| Constant | Value | Where |
|---|---|---|
| `SPIN_RATE` | 14 rad/s, halved per bounce | tumble in flight; rolling turns it at speed over radius, `GrenadeSystem.ts` |
| `WORLD_MODEL_SCALE` | 1.35 | live grenades drawn bigger than life, `GrenadeSystem.ts` |
| `CLINK_MIN_SPEED` / `CLINK_INTERVAL` | 1.2 m/s / 0.09 s | bounce clinks: none slower, at most one per grenade per interval |
| `GRENADE_BOUNCE_LOUD_SPEED` | 9 m/s | an impact this fast clinks at full strength, `GrenadeSystem.ts`; how far it carries is the sound engine's (`docs/sound.md`) |
| `ARC_DOT_SPACING` / `ARC_DOT_START` | 0.32 m / 0.7 m | arc preview dots, `GrenadeArcPreview.ts` |
| `DEAF_CUTOFF_OPEN` / `DEAF_CUTOFF_CLOSED` | 20 kHz / 380 Hz | master low-pass at no flash / full blindness |
| `RING_FREQUENCY` / `RING_PEAK_GAIN` | 3300 Hz / 0.07 | the ring, times the master volume |
| `REDUCED_MOTION_WHITE_CAP` / `REDUCED_MOTION_RAMP_SECONDS` | 0.8 / 0.15 s | white-out under reduced motion |
| `FRAG_MAX_PUFFS` / `_SPARKS` / `_DEBRIS` / `_SCORCHES` | 168 / 160 / 96 / 8 | frag effect pools, shared by every frag; the oldest is reused, `FragExplosion.ts` |
| per frag | 1 core, 6 fire, 10 smoke, 9 dirt and 16 dust puffs, 38 sparks, 22 debris, 1 scorch | `FragExplosion.ts` |
| `CORE_SECONDS` / `FIRE_HOT_SECONDS` / `SCORCH_SECONDS` | 0.09 s / 0.2 s / 25 s (fades over the last 6) | `FragExplosion.ts` |
| `GRENADE_LEAVES_HAND_AT` | 0.26 of the throw | the hand lets go; an own throw's world copy stays hidden until then, `grenadeThrowPose.ts` |

## What the player sees and hears

- **Models:** the frag is an olive ovoid with two grooves, the flash a grey cylinder with an amber
  band; both have the guns' metal fuse, spoon and ring. One model per live grenade from a per-kind
  pool, sharing geometry and materials; it tumbles end over end in flight and stops at rest.
- **Throw:** a gloved right hand built like the guns (palm, four fingers in three jointed segments
  curled round the grenade, thumb, knuckle guards, padded tips), a wrist cuff with a strap and hazard
  tab, and a sleeve that tapers off the bottom of the frame (the arsenal's glove and sleeve
  materials, lit like the guns). It rises from below as `weaponManager.throwPose` lowers the gun and
  holds the cooking grenade up at the right, the pulled pin hanging by its ring from the little
  finger. On release it is a lob: a short wind back up and right, a swing forward over the shoulder
  with the wrist flicking through, the hand letting go at 0.26 of the throw and the fingers opening,
  then a follow-through down and out while the gun comes back up (`weaponManager.throwProgress`).
  The forearm always hangs down from the hand (the wrist turns, the elbow never comes into view), so
  the sleeve stays a narrow band: about 4 to 8 percent of the screen. Keyframed and smoothstepped
  like the knife (`meleeSwing.ts`).
- **Arc preview:** while cooking, accent-coloured dots every 0.32 m along `arcPreview.points` and a ring
  lying on the landing surface. Unlit, so it never changes the scene's light count; walls hide the part
  behind them.
- **Danger marker:** a small grenade glyph in the threat colour for each live frag within 10 m that is
  not the player's own: on the frag when on screen, else pinned to the screen edge with an arrow.
- **Flash:** a white layer at the blind level over an afterimage (the frame at the moment of the
  flash, frozen, washed out and blurred) that outlasts the white. Game audio goes through a closing
  low-pass with a high ring over it, both following the blind level. Under `prefers-reduced-motion`
  the white ramps in over 0.15 s, never passes 0.8, and there is no afterimage.
- **Frag explosion** (`FragExplosion.ts`, spawned by GrenadeEffects from the detonation listener),
  in the order the eye gets it: a white-orange flash up to 5 m wide for under 0.1 s; a short
  fireball that is smoke within 0.2 s (a frag is high explosive, not fuel); a fountain of dark
  dirt thrown 3 to 5 m up out of the ground and falling back; a ring of dust racing out along the
  surface to about 4 m and hanging for two or three seconds; hot fragments streaking out at up to
  30 m/s and clods of earth tumbling down and bouncing; a column of dark smoke that rises and thins
  to pale grey over four or five seconds; and a 3.8 m scorch that burns in and fades after 25 s.
  The earlier one was a 1.5 m fireball and a single grey puff, gone in about two seconds. GrenadeSystem finds the surface (the nearest fixed collider within 0.5 m below
  or 0.35 m to the sides, else the terrain floor, else none in the air) and lights the blast with
  the flash's light, made at match start, so no light is ever added mid-match. Everything is pooled
  and in the scene from the first frame (empty draws), so a frag compiles nothing mid-match; the
  puffs and scorch are unlit, so the Facility's light count is untouched. The Goose Launcher keeps
  ExplosionEffect. A single-player Restart clears it all.
- **Camera shake:** offsets the rendered camera position only, after the camera's interpolation has
  rewritten it each frame; the aim and every shot read the unshaken camera of the tick.
- **Sounds,** all synthesized and positional (distance and stereo pan from the local player), remote
  grenades included: pin pull on cook start, a whoosh on every throw, clinks on bounces by impact
  speed, the frag's explosion (heavier and longer than the launcher's) and the flash's crack with a
  high ring.

## Deviations from the design

- **Thrower velocity** is estimated from the player's change in position between ticks, not read from
  the physics body; a jump faster than 15 m/s (a respawn) counts as standing still.
- **Knockback is applied by the receiver:** every client knocks back its own player from any frag;
  only the thrower's client deals damage.
- **A cancelled cook returns the grenade** to the carry (death, pause, freeze), instead of dropping it.
- **Goose Horde has no friendly fire:** a frag sends no damage to teammates and does not knock them
  back; the thrower still takes their own frag's damage and knockback. A frag's blast now also kills the
  horde's geese, in Horde and Goose Horde, through the same hit path as a bullet (the host or
  single-player kills the goose, a guest reports the hit).
- **Live grenades are drawn 1.35 times life size**, so they read beyond a few metres; the copy in the
  hand is true size.
- **The frag's surface is found locally** by every client from the detonation point (the message
  carries no normal), so the scorch and dust ring sit on whatever that client's world has there.
- **In an unlit Facility room the arm reads as a silhouette:** the torch is world-only (it flared the
  gun white), so the view model is lit only by the room's lamps.

## Tests

- Unit: `src/combat/grenades/*.test.ts` (`grenadeFlight.test.ts`: the arc at any tick length, bounces
  that get lower and end, rolling distance, slopes, edges, rest; `grenadeBlast.test.ts` and
  `grenadeTuning.test.ts`: exposure behind low and high walls, distance to the nearest part of a
  body, the damage and knockback curves; `GrenadeSystem.test.ts`: the low wall and the frag at the
  feet through real physics; and `FragExplosion.test.ts`: pools and caps, no
  light added, no scorch in the air, bits never pass through the surface; and in
  `GrenadeSystem.test.ts` the surface probe, the reused light, the hidden own copy and no co-op
  knockback), `src/weapons/grenadeThrowPose.test.ts`,
  `src/ui/grenadeDangerMarkers.test.ts`, `src/ui/flashOverlay.test.ts`, `src/audio/flashDeafness.test.ts`.
- E2E: group `grenades` (`e2e/grenades.spec.ts`, solo): the loadout is seeded in localStorage
  (`fps-game-loadout`) before the page loads. A frag carrier's frag kills the enemy beside it and
  spends one; a flash carrier's flash blinds a player facing it and leaves one turned away from a far
  flash clear. Unit tests for the one-kind carry are in `grenadeHand.test.ts` and
  `GrenadeSystem.test.ts`, the binding migration in `src/settings/Settings.test.ts`.
