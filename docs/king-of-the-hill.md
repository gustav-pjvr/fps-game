# King of the Hill (rebuilt in v5.0.0)

A multiplayer mode for two to four players: a hill that moves round the map, held by standing on
it alone, and a crown (the golden goose) that doubles its points. The rules are
`src/core/modeControllers/hillState.ts` (pure, host only), the driver and presenter is
`KingOfTheHillController.ts` beside it, the ring in the world is `src/entities/HillView.ts`, the
panel is `src/ui/kothHud.ts`.

## What a player sees

- A ring on the ground marks the hill, coloured by who holds it: amber when open, mint when this
  player's side holds it, red when the other side does, pale when contested. A `HILL` world marker
  and a minimap marker point to it; in the last 8 s before it moves, `NEXT HILL` marks where it
  goes.
- A panel top centre: who holds the hill in this player's terms, a bar that drains as the hill's
  time runs out, and `HILL MOVES IN 0:23`. In Final Push the label says so.
- The golden goose lies in the middle of a new hill as the crown (`CROWN` marker, prompt
  `TAKE THE CROWN` within reach). Its wearer is shown on the scoreboard.
- The scoreboard shows each player's points out of 120 as a bar. Headlines announce a moved hill
  and Final Push; lines in the feed say who took the hill and the crown.

## Rules (`HILL_RULES`, `config.ts`)

| | |
|---|---|
| Points to win | 120 (`KOTH_POINTS_TO_WIN`) |
| Hill radius | 8 m, 6 m in Final Push (both x0.65 on the Facility, whose rooms are small) |
| Crown reach | 2.5 m (the host allows a guest 2 m more for lag) |
| A hill lasts | 60 s, 40 s in Final Push; a warning 8 s before it moves |
| Scoring | 1 point a second to a side standing on the hill alone; nothing while contested |
| The crown | doubles the points while its wearer's side holds the hill; its wearer cannot sprint |
| Final Push | begins when a side reaches 75% of the target |
| Kills | score nothing: they clear the hill |

- The crown is taken with interact within reach of where it lies. A guest asks the host
  (`kothCrownClaim`); the host grants it by where it sees that player. It drops where its wearer
  dies or leaves, and goes back to the middle of the new hill each time the hill moves.
- **Four players play two against two** (slots 0 and 2 against 1 and 3): a side scores together, a
  teammate on the hill does not contest it, teammates cannot hurt each other (bullets, blades and
  frags), and the match is won by a side. Two or three players play each for themselves.
- Hill sites are spread round the map by the host from the world seed (`Game.hillSites`,
  `spreadSites`); on the Facility they are rooms. The order is the host's.

## Network

The host owns the hill, the crown and every score. It sends the whole state as `kothState` five
times a second (`KOTH_STATE_SEND_INTERVAL`) and at once on a change, and to a late joiner in its
sync; guests apply it as it is and run only the hill's clock on between messages so the bar drains
smoothly. `kothCrownClaim` goes guest to host only, never relayed; the claimant is the link it came
in on. The older `goldenGoose*` and `kothScoreTick` types are no longer sent but stay in
`protocol.ts` until the relay branch merges (decision D16).

## Debug hooks

- `getKothDebug()`: the hill, the next hill, the clock, who holds it, the crown, as this client
  shows them.
- `holdKothHill(true)`: host only, stops the hill's clock so a slow browser run can finish its
  checks on one hill.

## Tests

`hillState.test.ts` (the rules), `KingOfTheHillController.test.ts`, the router, protocol, sync and
scoring tests, and `e2e/koth.spec.ts` (group `modes`): two players and a late joiner see the same
hill, a hold scores on both, a contested hill stops the score, a guest takes the crown through the
host, a late joiner is told the whole state, and the crown drops where its wearer dies.

## Where to change things

| To change | Look at |
|---|---|
| The numbers | `HILL_RULES` in `hillState.ts`, `KOTH_POINTS_TO_WIN` in `config.ts` |
| Teams | `playsInTeams`, `sideOf` in `hillState.ts` |
| Where hills go | `Game.hillSites`, `spreadSites` |
| The ring and the crown in the world | `src/entities/HillView.ts` |
| The panel | `src/ui/kothHud.ts` |
