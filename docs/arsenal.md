# The arsenal (rebuilt in v5.0.0)

Nineteen weapons a player can carry (seven primaries, five secondaries, six blades, and the Goose
Launcher reward), each with its own model, sounds, recoil, reload and inspect animation and handling
numbers. Every name is fictional: no real maker, trademark or logo. Every model and sound is made
by code in this repository (`public/assets/credits/README.md`); no weapon asset file is loaded.

- Definitions and numbers: `src/weapons/definitions.ts`.
- Models: `src/weapons/models/` (the kit in `kit/`, one file per weapon in `guns/` and `blades/`,
  the registry in `registry.ts`). How to write one: `docs/arsenal-modelling.md`.
- Animation clips: `src/weapons/animation/`. Blade swings: `src/weapons/meleeSwing.ts`.
- The weapon in play: `src/weapons/WeaponManager.ts`, `Weapon.ts`.
- Sounds: `src/audio/weaponSounds.ts`, played by `SoundEngine`.
- Skins: `docs/skins.md`.

## What changed for a player

- Seven new guns and five new blades beside the old seven weapons, which were all remodelled.
- Damage falls off with distance (except the sniper and the launcher), so each gun has a range.
- Recoil kicks up and to a side; heavier weapons aim more slowly and slow the player a little.
- A blade's left click and its aimed (right button held) click are two different attacks, each with
  its own damage, reach, speed and swing. A strike hits each target once.
- Inspect the weapon in hand with G (D-pad down on a controller).
- Other players see the weapon and skin you hold.
- The old ids are kept (`pistol`, `rifle`, `sniper`, `shotgun`, `mp5`, `revolver`, `knife`), so a
  stored loadout from before still loads.

## Primaries

| Name (id) | Damage | Shots/s | Magazine | Reload (s) | Falloff | Recoil up / side | Aim FOV | Mobility | Notes |
|---|---|---|---|---|---|---|---|---|---|
| VR-4 Assault Rifle (`rifle`) | 17 | 10 | 30 | 2.0 | 35 to 75 m, x0.7 | 0.009 / 0.004 | 45 | 1 | automatic |
| Wasp SMG (`smg`) | 13 | 14 | 32 | 1.6 | 12 to 32 m, x0.5 | 0.007 / 0.005 | 52 | 1.05 | automatic |
| Kestrel Battle Rifle (`battleRifle`) | 26 | 6.5 | 25 | 2.3 | 45 to 90 m, x0.8 | 0.018 / 0.007 | 42 | 0.97 | automatic |
| R60 Light Machine Gun (`lmg`) | 18 | 9 | 80 | 4.4 | 40 to 85 m, x0.75 | 0.011 / 0.006 | 48 | 0.9 | automatic, belt fed |
| K14 Marksman Rifle (`dmr`) | 45 | 3.3 | 12 | 2.2 | 70 to 140 m, x0.85 | 0.03 / 0.006 | 26 | 0.97 | semi, scope |
| H12 Shotgun (`shotgun`) | 13 x 8 pellets | 1.2 | 6 | 2.2 | 8 to 24 m, x0.3 | 0.04 / 0.008 | 60 | 1 | semi |
| L7 Sniper Rifle (`sniper`) | 90 | 0.8 | 5 | 2.4 | none | 0.05 / 0.004 | 15 | 0.95 | bolt action, scope |

## Secondaries

| Name (id) | Damage | Shots/s | Magazine | Reload (s) | Falloff | Recoil up / side | Aim FOV | Mobility | Notes |
|---|---|---|---|---|---|---|---|---|---|
| P9 Pistol (`pistol`) | 22 | 5 | 15 | 1.3 | 18 to 45 m, x0.6 | 0.016 / 0.004 | 55 | 1.03 | semi |
| S5 Burst SMG (`mp5`) | 17 | 2.6 bursts | 30 | 1.7 | 16 to 40 m, x0.55 | 0.012 / 0.004 | 50 | 1.02 | bursts of 3 |
| Rook .44 Revolver (`revolver`) | 58 | 1.8 | 6 | 2.6 | 25 to 60 m, x0.6 | 0.05 / 0.01 | 50 | 1 | semi |
| Hornet Machine Pistol (`machinePistol`) | 12 | 15 | 20 | 1.5 | 10 to 28 m, x0.5 | 0.011 / 0.008 | 58 | 1.03 | automatic |
| Stub 12 Sawn-off (`sawnOff`) | 11 x 10 pellets | 3 | 2 | 2.1 | 5 to 14 m, x0.2 | 0.06 / 0.012 | 62 | 1.02 | two barrels |

Falloff reads "full damage to the first distance, falling in a straight line to that fraction at
the second and beyond" (`falloffMultiplier`). Recoil is in radians per shot. Mobility multiplies
the player's move speed while the weapon is in hand.

## Blades

| Name (id) | Mobility | Click: damage, reach, swing, cooldown | Aimed click: damage, reach, swing, cooldown |
|---|---|---|---|
| Combat Knife (`knife`) | 1.06 | 55, 2.2 m, 0.35 s, 0.55 s (slashes) | 80, 2.4 m, 0.42 s, 0.8 s (stab) |
| Talon Karambit (`karambit`) | 1.08 | 36, 1.9 m, 0.26 s, 0.34 s (hooks) | 60, 2.0 m, 0.42 s, 0.62 s (uppercut) |
| Bushline Machete (`machete`) | 1.03 | 70, 2.9 m, 0.5 s, 0.85 s (wide chops) | 100, 2.8 m, 0.7 s, 1.15 s (overhead chop) |
| Kiri Tanto (`tanto`) | 1.06 | 55, 2.3 m, 0.36 s, 0.6 s | 90, 3.1 m, 0.5 s, 0.95 s (lunge) |
| Trail Hatchet (`hatchet`) | 1.02 | 80, 2.3 m, 0.55 s, 0.95 s | 120, 2.4 m, 0.8 s, 1.4 s (a kill on a full-health player) |
| Trench Spike (`spike`) | 1.06 | 42, 2.4 m, 0.24 s, 0.42 s (jab) | 32 x 3 strikes, 2.4 m, 0.56 s, 0.95 s (flurry) |

A strike is a small fan of rays cast `hitAt` seconds into the swing; each target takes the
attack's damage once, however many rays find it (decision D20). Before v5.0.0 the knife's three
rays each did damage, so one clean hit killed.

## The Goose Launcher

A mid-match reward, never in a loadout: four explosive geese, no reload, swapped back for the
previous weapon when empty. Unchanged in rule, remodelled.

## Modes and the arsenal

`src/core/gameModes.ts` reads the categories from the definitions:

- **Default, King of the Hill, Goose Horde, Elimination and the solo modes:** the player's loadout
  (one primary, one secondary, one blade).
- **1 Shot 1 Kill:** pistols; **Sniper Duel:** the sniper; **Knife Only:** the blade the player has
  equipped, whichever it is; **Goose Toss:** empty hands.
- **Gun Game:** a random gun from all twelve guns on each kill, the Goose Launcher for the last.

## Models

Every model is built at load from code with the kit (`kit/GunBuilder.ts`, `kit/geometry.ts`,
`kit/sights.ts`, `kit/hands.ts`): side profiles extruded into plates, solids of revolution for
barrels and scopes, boxes, tubes, rings and discs, merged per part and per material slot. A model
names its moving parts (`slide`, `bolt`, `magazine`, `cylinder`, `cover`, `stock`, the arms), its
muzzle and, for a gun, its aim point. Budgets, checked by `weaponModels.test.ts` for every weapon
in every skin: at most 26 draw calls and 16000 triangles for a first-person model.

**The aim rule.** The aim point sits on the screen's centre at `ADS_SIGHT_DISTANCE` (0.4 m) when
aimed, and nothing but the front sight's tip (and an optic's frame outside a small clear cone) may
stand above the line of aim. A shoulder stock is its own part and draws back out of view when aimed
(`retractWhenAimed`). Scoped weapons show the scope overlay and are exempt; blades have no aim
point. `weaponModels.test.ts` proves it for every weapon and skin, and `e2e/skins.spec.ts`
photographs each aimed view (`docs/skins.md`).

## Animation

A weapon carries clips of per-part tracks (`animation/clips.ts`): `fire` in seconds, `reload` over
0 to 1 of the weapon's reload time, `inspect` in seconds. `PartAnimator` poses the parts from rest
each frame; the `gun` track moves the whole model. Reloads are specific to the action: a magazine
out and in and the action racked, a revolver's cylinder swung out, a shotgun fed, a bolt worked, the
machine gun's cover lifted and its box changed. Blade swings are poses in `meleeSwing.ts`, cycled
per attack.

## Sounds

Synthesised per weapon in the browser (`audio/weaponSounds.ts`): a gunshot is layered noise bursts
and a low thump shaped per weapon, a reload is that weapon's steps placed at their moments in its
reload time, a blade has its own swing. The eight sampled mp3 files of v4.x were removed.

## What other players see

A player's snapshot carries the weapon id and skin id in hand (`w`, `k`, optional, at most 24
characters). `entities/heldWeapon.ts` builds the same model without arms and fixes it to the
character's right wrist; a standing player holds it up (`Idle_Gun_Pointing`). An unknown id shows
nothing rather than a wrong weapon.

## Inputs

| Action | Mouse and keyboard | Controller |
|---|---|---|
| Fire / blade attack | left button | RT |
| Aim / blade's second attack | right button (held) | LT |
| Reload | R | X |
| Inspect | G | D-pad down |
| Ping (docs/coop.md) | V or middle button | LB |

## Tests

`definitions.test.ts` (every weapon is complete and sane), `weaponModels.test.ts` (budgets, aim
rule, arms and skin features for every weapon in every skin), `clips.test.ts`, `heldWeapon.test.ts`,
the weapon manager's tests, `e2e/skins.spec.ts`, and the smoke spec for firing and reloading.

## Tools

`weaponlab.html` (dev only) shows one weapon in one skin from the side, at the hip, aimed, or in a
character's hand; `node scripts/weaponShots.mjs --port 5191 --w rifle --k service --view
display,hip,aim` saves screenshots of it.

## Known issues

- The Kestrel's aimed view shows more of the receiver under the sight than the VR-4 does (its rear
  sight sits far forward); the R60's rear sight is chunky at the hip. Both pass the aim rule.
- The kit cannot cut into a solid of revolution, so flutes and heat-shield holes are dark strips.
- The R60's belt is part of its ammunition box and does not feed while firing.
