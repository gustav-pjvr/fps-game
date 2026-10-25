# Grenades (v4.5.0, as built)

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
| `GRENADE_THROW_SPEED` | 17 m/s | along the aim, plus the thrower's velocity |
| `GRENADE_RADIUS` | 0.07 m | the swept sphere |
| `GRENADE_RESTITUTION` | 0.35 | share of the speed into a surface that comes back |
| `GRENADE_FRICTION` | 0.6 | Coulomb coefficient at a contact (see deviations) |
| `GRENADE_REST_SPEED` | 0.4 m/s | below this on a floor it comes to rest |
| `GRENADE_FUSE` | frag 3.0 s, flash 1.6 s | from the moment cooking started |
| `GRENADE_THROW_ANIMATION_SECONDS` | 0.45 s | the gun stays down for the throw |
| `GRENADE_HAND_OFFSET` | right 0.18, up -0.1, forward 0.45 m | where a throw leaves the camera |
| `GRENADE_ORPHAN_GRACE_SECONDS` | 2 s | a copy whose detonation never arrives is dropped this long after its fuse |
| `FRAG_RADIUS` / `FRAG_FULL_DAMAGE_RADIUS` / `FRAG_MAX_DAMAGE` | 7 m / 1.5 m / 130 | linear falloff to 0 at 7 m |
| `FRAG_KNOCKBACK_STRENGTH` | the Goose Launcher's | knockback |
| `FRAG_LAMP_RADIUS` | 4 m | Facility lamps shot out |
| `FRAG_SHAKE_RANGE` / `FRAG_SHAKE_PEAK` / `FRAG_SHAKE_SECONDS` | 15 m / 0.09 m / 0.6 s | camera shake |
| `FRAG_CHEST_OFFSET` / `FRAG_HEAD_OFFSET` | 0.3 / 0.75 m | the wall check's two rays |
| `FLASH_FULL_RANGE` / `FLASH_MAX_RANGE` | 5 m / 22 m | distance factor 1 to 0 |
| `FLASH_FACING_SIDE` / `FLASH_FACING_BEHIND` | 0.45 / 0.15 | facing factor at 90 degrees / behind |
| `FLASH_MIN_STRENGTH` | 0.1 | weaker does nothing |
| `FLASH_PLAYER_MAX_SECONDS` / `FLASH_FADE_SECONDS` | 3.5 s / 1.2 s | white-out hold (scaled) then fade |
| `FLASH_ENEMY_MAX_SECONDS` | 4 s | enemy blindness (scaled) |
| `FLASH_LIGHT_SECONDS` / `FLASH_LIGHT_INTENSITY` / `FLASH_LIGHT_RANGE` | 0.15 s / 260 / 28 m | the flash's light |
| `FRAG_LIGHT_SECONDS` / `FRAG_LIGHT_INTENSITY` / `FRAG_LIGHT_RANGE` | 0.22 s / 160 / 16 m | the frag's light (the same light, warm, 0.6 m off the surface) |
| `GRENADE_DANGER_RANGE` | 8 m | danger marker range |

Visual and audio constants, beside the code that uses them:

| Constant | Value | Where |
|---|---|---|
| `SPIN_RATE` | 14 rad/s, halved per bounce | tumble in flight, `GrenadeSystem.ts` |
| `WORLD_MODEL_SCALE` | 1.35 | live grenades drawn bigger than life, `GrenadeSystem.ts` |
| `CLINK_MIN_SPEED` / `CLINK_INTERVAL` | 1.2 m/s / 0.09 s | bounce clinks: none slower, at most one per grenade per interval |
| `GRENADE_BOUNCE_FULL_VOLUME_RANGE` / `_AUDIBLE_RANGE` / `_LOUD_SPEED` | 3 m / 28 m / 9 m/s | clink volume, `positionalAudio.ts` |
| `ARC_DOT_SPACING` / `ARC_DOT_START` | 0.32 m / 0.7 m | arc preview dots, `GrenadeArcPreview.ts` |
| `DEAF_CUTOFF_OPEN` / `DEAF_CUTOFF_CLOSED` | 20 kHz / 380 Hz | master low-pass at no flash / full blindness |
| `RING_FREQUENCY` / `RING_PEAK_GAIN` | 3300 Hz / 0.07 | the ring, times the master volume |
| `REDUCED_MOTION_WHITE_CAP` / `REDUCED_MOTION_RAMP_SECONDS` | 0.8 / 0.15 s | white-out under reduced motion |
| `FRAG_MAX_PUFFS` / `_SPARKS` / `_DEBRIS` / `_SCORCHES` | 96 / 96 / 48 / 8 | frag effect pools, shared by every frag; the oldest is reused, `FragExplosion.ts` |
| per frag | 1 core, 8 fire puffs, 12 dust puffs, 22 sparks, 10 debris, 1 scorch | `FragExplosion.ts` |
| `CORE_SECONDS` / `FIRE_HOT_SECONDS` / `SCORCH_SECONDS` | 0.085 s / 0.3 s / 25 s (fades over the last 6) | `FragExplosion.ts` |
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
- **Danger marker:** a small grenade glyph in the threat colour for each live frag within 8 m that is
  not the player's own: on the frag when on screen, else pinned to the screen edge with an arrow.
- **Flash:** a white layer at the blind level over an afterimage (the frame at the moment of the
  flash, frozen, washed out and blurred) that outlasts the white. Game audio goes through a closing
  low-pass with a high ring over it, both following the blind level. Under `prefers-reduced-motion`
  the white ramps in over 0.15 s, never passes 0.8, and there is no afterimage.
- **Frag explosion** (`FragExplosion.ts`, spawned by GrenadeEffects from the detonation listener): a
  white-orange flash core under 0.1 s, a fireball of soft billboard puffs that cools from orange to
  dark grey smoke and rises, a brown dust ring spreading along the surface, bright sparks and dark
  debris flung out under gravity and bouncing on the surface, and a scorch decal that burns in and
  fades after 25 s. GrenadeSystem finds the surface (the nearest fixed collider within 0.5 m below
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
- **Friction is read as a Coulomb coefficient:** the tangential speed lost at a contact is at most 0.6
  times the normal impulse, so a hard landing skids less far than a gentle one and a grenade rolls to
  a stop.
- **Live grenades are drawn 1.35 times life size**, so they read beyond a few metres; the copy in the
  hand is true size.
- **The frag's surface is found locally** by every client from the detonation point (the message
  carries no normal), so the scorch and dust ring sit on whatever that client's world has there.
- **In an unlit Facility room the arm reads as a silhouette:** the torch is world-only (it flared the
  gun white), so the view model is lit only by the room's lamps.

## Tests

- Unit: `src/combat/grenades/*.test.ts` (including `FragExplosion.test.ts`: pools and caps, no
  light added, no scorch in the air, bits never pass through the surface; and in
  `GrenadeSystem.test.ts` the surface probe, the reused light, the hidden own copy and no co-op
  knockback), `src/weapons/grenadeThrowPose.test.ts`,
  `src/ui/grenadeDangerMarkers.test.ts`, `src/ui/flashOverlay.test.ts`, `src/audio/flashDeafness.test.ts`,
  `src/core/positionalAudio.test.ts`.
- E2E: group `grenades` (`e2e/grenades.spec.ts`, solo): the loadout is seeded in localStorage
  (`fps-game-loadout`) before the page loads. A frag carrier's frag kills the enemy beside it and
  spends one; a flash carrier's flash blinds a player facing it and leaves one turned away from a far
  flash clear. Unit tests for the one-kind carry are in `grenadeHand.test.ts` and
  `GrenadeSystem.test.ts`, the binding migration in `src/settings/Settings.test.ts`.
