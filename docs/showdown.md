# Showdown (v5.0.0, the Director mode rebuilt)

The solo Director mode used to be endless waves with no goal. Showdown keeps the pacing director
as its engine (`docs/enemy-ai-v2.md`, step 6) and gives it an arc: five acts, each harder than the
last, a breather with a supply crate after each, a finale squad led by the Warden, a score with a
multiplier that rewards staying in the fight, and an end screen with a grade. Chosen on the Play
screen as **Showdown**.

- The rules: `src/entities/enemies/director/showdown.ts` (pure, with tests beside it).
- The director it drives: `pacingDirector.ts` in the same folder (`retune`, `forcePeak` added).
- The wiring: `Game.updateDirector`, `onShowdownEvent`, `placeShowdownFinale`,
  `tryShowdownRedeploy`, `showShowdownResult`.
- The panel: `src/ui/showdownHud.ts`. The Warden: `src/entities/enemies/archetypes.ts`.

## What a player sees

- A panel top centre: `ACT 2 / 5`, what the fight is doing (`THEY ARE COMING`, `PEAK`, `HOLD ON`,
  `BREATHER`, then `KILL THE WARDEN` in the finale), the score with its multiplier, a bar toward the
  multiplier's next step, and the redeploys left.
- A headline at each act (`ACT 3`) and at the finale (`FINALE: THE WARDEN`); a line when an act is
  survived with its bonus, and when the multiplier changes.
- A supply crate near the player in each breather, with a `SUPPLY` marker (health +35, a grenade).
- The end screen: "Showdown won" or "Overrun", the grade, score, kills, best multiplier and time.

## An act

One cycle of the director: **build-up** (waves come in from behind and out of sight), **peak** (no
more waves for a few seconds once the intensity reaches its top), **fade** (until the player has
cleared or shaken off what is left and the intensity drops), **breather**. An act is survived when
its peak gives way to the breather. A build-up that lasts 110 s without the player's own fight
bringing the peak peaks by itself, so an act always ends. A breather the player gets by going
underground (the director relaxes when everyone is below ground) clears nothing.

| Act | Enemies alive at most | Wave size | Seconds between waves | Rush waves | Sniper waves | Breather after (s) |
|---|---|---|---|---|---|---|
| 1 | 6 | 2 | 9 | 10% | 10% | 14 to 18 |
| 2 | 8 | 3 | 8 | 20% | 15% | 14 to 18 |
| 3 | 10 | 3 | 7 | 25% | 20% | 16 to 20 |
| 4 | 12 | 4 | 7 | 30% | 20% | 16 to 20 |
| 5 | 14 | 4 | 6 | 30% | 25% | none: the finale |

(`SHOWDOWN_ACTS`. Everything else, such as how damage and kills raise the intensity, is the
director's own configuration in `config.ts`.)

## The finale

When the fifth act's peak ends there is no breather: the Warden comes in with four escorts, placed
like any wave (behind the player, out of sight; if nowhere hidden is free the placement is tried
again each tick). No more waves follow. The run is won when the squad has been placed and no enemy
is left alive.

## Score

| | |
|---|---|
| A kill | 100 x the multiplier |
| An act survived | 500 x the act's number |
| The finale won | 2500 |
| Multiplier | x1 to x5: one step up for every 8 s the intensity stays at 0.45 or more, one step down for every 10 s at 0.12 or less, back to x1 on a death |

## Falling

Solo has two **redeploys**. A death with one left does not end the run: the player is put back at
the map's start point with full health and a 3 s shield, the enemies and the act stay as they are,
and the multiplier starts again. A death with none left ends the run ("Overrun"). Respawn on the
end screen starts a new run from act 1.

## Grade

| Grade | When |
|---|---|
| S | won with no redeploy used and a best multiplier of x4 or more |
| A | won with a redeploy left |
| B | won with none left, or lost in act 4 or 5 |
| C | lost before act 4 |

## Sized for a squad (not yet played in a room)

The rules already take the number of players: each further player adds 35% to an act's cap and
wave size (`showdownOptions`) and two escorts to the finale. Showdown is solo until enemies can be
simulated by a host for a room (decision D14).

## Debug hooks (`window.__gameDebug`)

- `getShowdownDebug()`: act, stage, phase, score, multiplier, best multiplier, kills, redeploys
  left, enemies alive, crates, whether a Warden is alive.
- `setShowdownAct(n)`: jump to the start of act `n`.
- `forceDirectorPeak()`: end the current build-up with its peak.
- `killEnemies()`: kill every live enemy as the player's kills.
- `getDirectorDebug()` as before (phase, intensity, the last wave's placements).

## Tests

- Unit: `showdown.test.ts` (acts and their bonus, the underground breather, the forced peak, the
  finale and the win, escorts for a squad, the multiplier up and down and its cap, redeploys and the
  loss, the grade), `pacingDirector.test.ts`.
- Browser: `e2e/director.spec.ts` (group `ai`): the original director checks, then an act survived
  with its crate and the next act, two redeploys and the loss with a new run after it, and the
  finale with the Warden won.

## Where to change things

| To change | Look at |
|---|---|
| An act's numbers | `SHOWDOWN_ACTS` |
| Score, multiplier, redeploys, the forced peak | `SHOWDOWN_RULES` |
| The grade | `ShowdownState.grade` |
| The Warden | `WARDEN` in `archetypes.ts` |
| The crate | `SUPPLY_CRATE` in `entities/hordeRules.ts` |
