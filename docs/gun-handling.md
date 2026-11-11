# Gun handling: spread and recoil (v5.0.0)

How each gun's shots scatter and how it kicks, set by the kind of gun it is. The rules are
`src/weapons/gunHandling.ts` (pure, tested beside it), each gun's numbers are its `spread` and
`recoil` in `src/weapons/definitions.ts`, and `WeaponManager.fireShot` applies them. The rest of
the arsenal is `docs/arsenal.md`.

## What was wrong before

Every gun had one cone and one kick. The cone was the same shape for a sniper rifle as for a
pistol, only scaled; aiming multiplied it by a fraction, so an aimed rifle still scattered about
0.4 degrees (a real one holds about 0.03). Nothing changed with movement or with how long the
trigger was held, so there was no spray: shot 30 of a magazine went exactly where shot 1 did. The
kick was a fixed lift with a random sideways part, and the view sprang back so fast between shots
that an automatic never climbed.

## The model

Two different things move a shot off the point of aim. They are kept apart because they come from
different places.

**Spread** is where the round goes relative to the sights.

| Part | What it is | Where it comes from |
|---|---|---|
| `aimed` | The cone when aimed down the sights, standing still | The gun's own (mechanical) error. Tiny for every bullet gun. For a shotgun, its pattern |
| `hip` | The cone from the hip, standing still | The shooter pointing without sights. Small for a sidearm, large for a long or scoped gun |
| `moving` | Added at full movement speed (a quarter of it when aimed) | The shooter's feet. Largest for the heavy guns |
| `bloomPerShot`, `bloomMax` | Added per shot of quick fire (twice as much from the hip), up to a cap | The shooter losing the sight picture in a burst |

Bloom holds for 0.22 s after a shot and then settles over 0.45 s, so shots closer together than
that stack (any automatic, a pistol fired fast) and slow aimed fire (the revolver, the marksman
rifle) recovers between shots.

**Recoil** moves the sights themselves.

| Part | What it is |
|---|---|
| `kick` | Upward lift of one shot, in radians of view |
| `side` | Largest sideways kick of one shot |
| `climbShots` | Shots of a burst that climb at full strength before the shooter catches it |
| `sustain` | Share of the kick each later shot still climbs by |
| `drift` | Which way the burst pulls while it climbs (positive is left) |
| `aimed` | Share of the kick left when aimed and shouldered |

A burst climbs for its first `climbShots` rounds pulling to one side, then settles into the smaller
sustained climb and weaves from side to side. About two thirds of the sideways kick is the gun's
pattern (the same every burst, so it can be learned) and a third is random. A burst ends 0.38 s
after its last shot: the next shot is a first shot again. While a burst is going the view settles
slowly (`RECOIL_DECAY_FIRING`), so the shots stack into a climb the player has to pull down; once
the firing stops it settles at the old rate. A long spray stops lifting at 0.3 rad
(`RECOIL_MAX_CLIMB`) and turning at 0.12 rad.

## The numbers, and why

Spread is a half-angle. One minute of angle (MOA) is 0.00029 rad; a gun that groups N MOA across has
an aimed spread of N / 2 MOA.

| Gun | Aimed (group) | Hip (rad) | Moving | Bloom per shot / cap | Kick | Side | Climbs for | Then |
|---|---|---|---|---|---|---|---|---|
| L7 Sniper Rifle | 0.5 MOA | 0.060 | 0.030 | none | 0.060 | 0.006 | 1 | single shot |
| K14 Marksman Rifle | 1.5 MOA | 0.035 | 0.015 | 0.0025 / 0.006 | 0.022 | 0.006 | 2 | x0.8 |
| Kestrel Battle Rifle | 3 MOA | 0.028 | 0.012 | 0.0016 / 0.009 | 0.019 | 0.008 | 4 | x0.55 |
| VR-4 Assault Rifle | 4 MOA | 0.022 | 0.010 | 0.0008 / 0.006 | 0.0085 | 0.0035 | 7 | x0.35 |
| R60 Light Machine Gun | 8 MOA | 0.040 | 0.020 | 0.0006 / 0.005 | 0.0075 | 0.005 | 10 | x0.25 |
| Wasp SMG | 8 MOA | 0.018 | 0.006 | 0.0007 / 0.007 | 0.0055 | 0.0045 | 5 | x0.45 |
| S5 Burst SMG | 6 MOA | 0.016 | 0.006 | 0.0008 / 0.004 | 0.0065 | 0.003 | 3 | whole burst |
| Hornet Machine Pistol | 12 MOA | 0.020 | 0.006 | 0.0016 / 0.014 | 0.012 | 0.009 | 6 | x0.6 |
| P9 Pistol | 8 MOA | 0.012 | 0.004 | 0.0015 / 0.006 | 0.014 | 0.004 | 3 | x0.8 |
| Rook .44 Revolver | 6 MOA | 0.014 | 0.005 | 0.003 / 0.008 | 0.055 | 0.012 | 1 | single shot |
| H12 Shotgun | pattern 0.020 | 0.030 | 0.004 | none | 0.050 | 0.012 | 1 | single shot |
| Stub 12 Sawn-off | pattern 0.034 | 0.045 | 0.004 | none | 0.075 | 0.020 | 1 | single shot |

The Goose Launcher throws a goose, not a round, and keeps its plain kick; the blades have neither.

**Sourced:**
- **Precision.** A service rifle's standard has long been about 3 to 4 MOA and a sniper system's
  1 MOA or better; the M24 holds about 0.5 MOA; the M14's specification is about 3 MOA; a good
  target pistol manages about 4 MOA from a rest. The VR-4 (4 MOA), the Kestrel (3 MOA) and the L7
  (0.5 MOA) take those figures directly.
- **Recoil energy** (free recoil, which depends on the gun's weight): about 3.4 ft-lb for a 9 mm
  pistol, 4.5 for a 5.56 rifle, 14.9 for a 7.62 NATO rifle, 22 to 30 for a 12 gauge, about 38 for a
  .338 magnum. The kicks follow that order: the Kestrel and the K14 (full power) kick a little over
  twice the VR-4 (intermediate), the shotguns more than any rifle but the magnum.
- **Buckshot patterns.** Modern tests put an open barrel at roughly 0.35 to 0.96 inches of spread
  per yard, and a typical 00 buckshot load at about 8 inches across at 10 yards; the old "inch per
  yard" rule overstates it. The H12's pattern is 0.02 rad, which is about 14 inches across at
  10 yards: wider than the measured figure on purpose, so that eight pellets still cover a moving
  target at the ranges the game is played at, and about a quarter of the old cone. The sawn-off is
  1.7 times wider.
- **Spray patterns.** The shape (the first rounds climb almost straight up, then the pattern moves
  sideways; fixed per weapon so it can be learned; random spread grows with movement and sustained
  fire) is how the best known competitive shooters build theirs.

**My own estimates, not sourced** (no figure turned up in the search):
- Aimed precision of the submachine guns, the machine pistol and the machine gun. They are set
  looser than the rifles because they are built for volume: 6 to 8 MOA, 12 for the machine pistol.
- The pistol's 8 MOA is hand-held, twice the rested figure above.
- The .44 revolver's kick. I set it between the full power rifles and the shotgun, with the hardest
  flip of any sidearm, from general knowledge of magnum revolvers.
- Every hip-fire, movement and bloom figure, and how many rounds each gun climbs for. These are
  game feel: the order between guns follows weight and length (a sidearm points more easily than a
  long or scoped gun; a heavy gun is worst on the move and steadiest once settled), the sizes were
  chosen so each gun plays to its type.
- How a weight soaks up recoil (the machine gun kicks less than the rifle per shot; a pistol more
  than the same round in a shouldered gun). The direction is physics; the amount is mine.

## What it means in play

- Aimed and still, every bullet gun puts its first shot where the sights are. Missing is now the
  shooter's recoil control, movement or distance, not dice.
- From the hip the sidearms and SMGs are usable, the rifles rough, the machine gun and the scoped
  rifles poor. The sniper rifle without its scope is close to useless.
- The assault rifle climbs for seven rounds and then is easy to hold; the battle rifle keeps
  fighting; the SMG barely lifts but chatters sideways; the machine pistol is the wildest gun in the
  game; the machine gun is clumsy for its first ten rounds and then the steadiest thing there is.
- Shotguns are tighter than before: a real pattern, not a wall. Aiming barely changes them.
- Short bursts beat holding the trigger for anything but the machine gun.

## Debug hook and tests

- `window.__gameDebug.getShotLog()`: the last 64 shots, each with the weapon, its place in its
  burst, how far it was aimed, the cone it was drawn from, the bloom in it and the kick it gave.
- Unit: `src/weapons/gunHandling.test.ts` (the rules, and the arsenal's order by the kind of gun:
  precision, hip fire, the size of each kick, the shape of a magazine of automatic fire, the
  shotgun pattern at 10 yards).
- Browser: `e2e/gun-handling.spec.ts` (group `core`): a real rifle burst from the hip and aimed, a
  pause ending the burst, and the pistol.

## Where to change things

| To change | Look at |
|---|---|
| One gun's feel | its `spread` and `recoil` in `definitions.ts` (keep `spreadRadians`, `recoilKick`, `recoilSide` and `adsSpreadMultiplier` in step: a test checks) |
| How bloom builds and settles, when a burst ends, the weave | the constants at the top of `gunHandling.ts` |
| How fast the view settles, the caps on climb | `RECOIL_DECAY`, `RECOIL_DECAY_FIRING`, `RECOIL_HOLD_SECONDS`, `RECOIL_MAX_CLIMB` in `config.ts` |

## Sources

- [Shot grouping (Wikipedia)](https://www.Wikipedia.com/wiki/Shot_grouping)
- [Sniper rifle (Wikiwand)](https://www.wikiwand.com/en/articles/Sniper_Rifle)
- [The accuracy revolution in small arms ammunition](https://blog.roninsgrips.com/the-accuracy-revolution-in-small-arms-ammunition-a-21st-century-overview/)
- [Military vs FBI maximum MOA (Sniper's Hide)](https://www.snipershide.com/shooting/threads/military-vs-fbi-maximum-moa.25803)
- [Rifle recoil table (backfire.tv)](https://backfire.tv/recoil/)
- [Free recoil (Wikipedia)](https://en.wikipedia.com/wiki/Free_recoil)
- [Recoil calculator (rifleconfigurator.com)](https://www.rifleconfigurator.com/tools/recoil-calculator)
- [Myth-busting: 1 inch per yard shotgun pattern spreads](https://fishgame.com/2014/07/myth-busting-1″-per-yard-shotgun-pattern-spreads/)
- [Stop the spread: patterning a defensive shotgun (Shooting Illustrated)](https://www.shootingillustrated.com/content/how-to-pattern-your-shotgun/)
- [AAFS 2020 E15 (forensic study of pellet spread)](https://www.aafs.org/sites/default/files/media/documents/AAFS-2020-E15.pdf)
- [Recoil control in Counter-Strike 2 (refrag.gg)](https://refrag.gg/blog/recoil-control-in-counter-strike-2-a-complete-guide)
- [Bullet bloom: an FPS tragedy (critpoints.net)](https://critpoints.net/2018/02/21/bullet-bloom-an-fps-tragedy)
