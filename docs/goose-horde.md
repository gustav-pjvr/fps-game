# Goose Horde (rebuilt in v5.0.0)

Wave survival against exploding geese, alone or as a squad of up to four. Twelve waves with two
bosses, a real win, supply drops the squad earns with its kills, and in a room a fallen player who
can be revived instead of a count of lives. This file describes what was built and the numbers to
tune. The rules are in `src/entities/hordeRules.ts`, the run in `src/entities/HordeGooseManager.ts`,
the goose in `src/entities/HordeGoose.ts`, the panel in `src/ui/hordeHud.ts`. The shared co-op
layer (down and revive, pings) is `docs/coop.md`.

## What a player sees

- A panel top centre: `WAVE 3 / 12`, then what is left of the wave (`14 LEFT`) or the countdown to
  the next one (`NEXT WAVE IN 6`), a thin bar for the supply meter (`SUPPLY DROP IN 5 KILLS`), and
  while a boss is alive its name and health bar. Solo also shows the Second Winds left.
- White geese are the small ones (walkers, jumpers that rush the last metres, flyers that dive).
  A **brute** is a big red goose that takes real damage to stop. A **boss** is a very big goose
  (purple Mother Goose, gold Matriarch) that stomps instead of dying when it reaches a player and
  hatches walkers while it lives.
- A headline names a boss when its wave starts; a line announces each wave, each wave survived and
  each supply drop. Supply crates carry a `SUPPLY` world marker with the distance and a dot on the
  minimap.
- In a room the scoreboard shows each player's kills, and the end screen ranks them.

## The waves

`HORDE_WAVE_TABLE` in `src/core/config.ts`, one table for solo and co-op:

| Wave | Small geese (one player) | Speed | Jumpers | Flyers | Brutes | Boss |
|---|---|---|---|---|---|---|
| 1 | 6 | 1.0 | 0 | 0 | 0 | |
| 2 | 9 | 1.1 | 15% | 0 | 0 | |
| 3 | 12 | 1.2 | 25% | 0 | 1 | |
| 4 | 14 | 1.3 | 30% | 10% | 0 | |
| 5 | 16 | 1.4 | 35% | 15% | 2 | |
| 6 | 10 | 1.4 | 30% | 10% | 0 | Mother Goose |
| 7 | 20 | 1.55 | 40% | 20% | 2 | |
| 8 | 24 | 1.65 | 45% | 25% | 3 | |
| 9 | 28 | 1.75 | 50% | 30% | 3 | |
| 10 | 32 | 1.85 | 50% | 35% | 4 | |
| 11 | 36 | 2.0 | 55% | 40% | 5 | |
| 12 | 16 | 2.0 | 50% | 30% | 2 | The Matriarch |

- Speed multiplies `HORDE_GOOSE_BASE_SPEED` (4 m/s). A brute moves at 0.6 of the wave's speed, a boss
  at 0.42.
- A boss wave's count is the boss's escort; the boss comes in first. The wave ends when the boss,
  its escort, its brutes and its broods are all gone.
- Brutes come in one every 7 s (`HORDE_BRUTE_SPAWN_INTERVAL`), the first after 3.5 s, on top of the
  count.
- The breather between waves is 8 s (`HORDE_WAVE_INTERMISSION_SECONDS`).
- At most `12 + wave index` geese are alive at once, capped at 24, plus 2 for each player past the
  first (`computeConcurrentCap`). A boss's brood may go past the cap by its own size.

### The kinds of goose (`HORDE_FLAVORS`, `HORDE_BOSSES`)

| Kind | Health | Size | Blast radius | Damage at centre | Contact |
|---|---|---|---|---|---|
| Walker, jumper, flyer | any hit kills | 1 | 5 m | 60 | 1.2 m |
| Brute | 220 | 1.8 | 7 m | 80 | 1.9 m |
| Boss (stomp) | see below | 3.2 | 8 m | 55 | 3 m |

| Boss | Health (one player) | Brood | Stomp |
|---|---|---|---|
| Mother Goose | 1500 | 2 walkers every 7 s | every 2.5 s while on a player |
| The Matriarch | 2600 | 3 walkers every 5 s | every 2 s |

A goose that reaches a player goes off and dies; a boss stomps (the same kind of blast) and keeps
coming. A goose that is shot just falls over.

### Scaling to the squad (`hordeRules.ts`)

The squad size is read when a wave begins, so a player who joins mid-wave is counted from the next
one, and a player who leaves makes the next one smaller.

| Players | Small geese | Brutes | Brute health | Boss health | Kills per supply drop |
|---|---|---|---|---|---|
| 1 | table | table | 220 | 1.0 | 14 |
| 2 | x1.45 | table | 275 | x1.5 | 18 |
| 3 | x1.9 | x1.5, rounded up | 330 | x2.0 | 22 |
| 4 | x2.35 | x1.5, rounded up | 385 | x2.5 | 26 |

Four players face 2.35 times one player's flock, not four times it: each player of a full squad has
fewer geese to deal with than a player alone, and in return the brutes and bosses need the squad's
fire together.

## Supply drops

- Every kill feeds the squad's meter: a small goose 1, a brute 3; a boss's kill fills it outright.
  A goose that goes off on a player counts for nothing.
- When the meter fills, a crate lands near every standing player (4 to 9 m away; on the Facility on
  clear floor 3 to 9 m away; underground inside the same volume), at most 6 on the field at once
  (`HORDE_AMMO_DROP_MAX_CONCURRENT`), and the meter starts again from empty.
- Walking onto a crate (1.8 m) takes it: +35 health, +1 grenade, and in a room two magazines for
  the weapon in hand (`SUPPLY_CRATE`). Solo reloads are unlimited, so the ammo part applies only to
  a room, where each weapon starts with three reserve magazines (`HORDE_STARTING_RESERVE_MAGAZINES`).
- Crates are `AmmoDropManager` (the old timed ammo crates, now `dropFor`); the pickup is
  self-reported and relayed as before.

## Falling

**Solo: Second Wind.** A run starts with one. A death with one in hand does not happen: the player
stands where they fell with 35 health and a 2.5 s shield, every small goose within 7 m is blown
away and a brute or boss there takes 150 (`SECOND_WIND_RULES`, `Game.trySecondWind`,
`HordeGooseManager.clearAround`). Surviving waves 4 and 8 earns another, up to two in hand. A death
with none left ends the run on the end screen (waves survived, geese killed, time); Respawn starts
a new run from wave 1 at a fresh point on the map.

**Co-op: down, revive, back with the wave.** See `docs/coop.md` for the shared rule. In this mode:
a fallen player is down (no death screen, a small panel instead), a teammate who stands within
2.6 m and holds interact for 3 s revives them where they fell with 40 health, after 25 s unrevived
they are out, and everyone who is down or out stands up again (full health, fresh ammo, a new
spawn point) when the next wave begins. The run is lost the moment every connected player is down
or out at once ("THE HORDE WINS"). This replaced the two respawns each player had before.

## Winning

Surviving wave 12 wins. Solo shows "The horde is broken" with the run's numbers; a room ends on the
podium with each player's kills.

## Network

The host runs the waves, the kill count and the supply meter; guests mirror its geese
(`docs/architecture/multiplayer-and-modes.md`). Messages changed or added in v5.0.0:

| Message | From | Change |
|---|---|---|
| `hordeGooseSpawned` | host | `flavor` may be `brute` or `boss`; optional `boss` (`mother`, `matriarch`) |
| `hordeGooseHitEvent` | guest to host | optional `damage`, what the hit takes off a brute or boss (capped at 400 a hit on the host) |
| `hordeGooseExploded` | host | optional `stomp`: the boss lives on |
| `hordeState` (new) | host | wave, phase, seconds to the next wave, geese left, supply meter, boss health, kills per slot; twice a second and at once on a change; in a late joiner's sync |
| `hordePlayerEliminated` | relayed | now means "this slot is down"; its `respawnEvent` takes it off the list |
| `reviveEvent`, `ping` (new) | relayed | the co-op layer, `docs/coop.md` |

`hordeReset` is no longer sent in a room (only a solo run restarts), and the limited-lives counter
is gone. A late joiner gets `hordeSyncState` (wave, who is down, the result if the run is over),
then `hordeState`, then the flock and the crates.

## Debug hooks (`window.__gameDebug`)

- `getHordeDebug()`: the panel's numbers as this client shows them, every live goose, the crates,
  this player's state (`up`, `down`, `out`), the slots held to be fallen, the Second Winds left.
- `setHordeWave(n)`: authoritative side, drops the current wave and begins wave `n`.
- `killHordeGeese()`: authoritative side, every live goose dies as this player's kill.

## Tests

- Unit: `src/entities/HordeGooseManager.test.ts` (the wave accounting, the table, scaling to the
  squad, the supply meter), `src/core/modeControllers/reviveRules.test.ts`,
  `SquadController.test.ts`, the router, protocol and sync tests.
- Browser: `e2e/horde.spec.ts` (group `modes`): a solo run (supply drop, Second Wind, death, boss,
  win), co-op with two players (the host's waves on the guest, a fall, a revive, back with the next
  wave), a late joiner, a rejoin, and four players (a wave sized for four, the run lost when all
  four are down). `e2e/facility-modes.spec.ts` keeps the Facility's spawn and flight checks.

## Where to change things

| To change | Look at |
|---|---|
| The waves | `HORDE_WAVE_TABLE` in `config.ts` |
| A goose kind's numbers, a boss | `HORDE_FLAVORS`, `HORDE_BOSSES` in `hordeRules.ts` |
| How it scales with players | the functions in `hordeRules.ts` |
| Supply crates | `SUPPLY_CRATE`, `supplyKillsNeeded`, `AmmoDropManager.dropFor`, `Game.updateHordeSupplies` |
| Second Wind | `SECOND_WIND_RULES`, `Game.trySecondWind` |
| The panel | `src/ui/hordeHud.ts` |
