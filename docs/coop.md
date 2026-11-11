# The co-op layer (v5.0.0)

What every mode with a side shares: pings a player's side can see, and in the co-op modes the
fallen and their revives. One controller per client, `src/core/modeControllers/SquadController.ts`,
built for every multiplayer match; its rules are `reviveRules.ts`, its panel is
`src/ui/downedOverlay.ts`, and it draws on the existing world markers (`src/ui/worldMarkers.ts`)
and the health rows of `src/ui/multiplayerHud.ts`.

## Pings

- Press ping (V, middle mouse, LB on a controller) to mark the point under the crosshair. The
  marker carries the player's name and the distance, stays 6 s, and plays a short two-note blip. A
  player has one ping at a time; a new one moves it. There is a 0.6 s gap between a player's own.
- Only a player's own side sees it: everyone in Goose Horde, the teammate in a two against two King
  of the Hill. In a free-for-all nobody has a side, so the key does nothing there. A client drops a
  ping from a player who is not on its side.
- The point is found with one ray from just in front of the camera, 150 m long; aiming at the sky
  marks nothing.
- Message: `ping { senderSlot, x, y, z }`, self-reported and relayed.

## Down and revive (the co-op modes)

A player whose health reaches zero in a co-op mode is **down**, not dead:

| | |
|---|---|
| Time a downed player can still be revived | 25 s |
| Hold to revive | 3 s of interact (E, or the controller's interact), within 2.6 m |
| Health after a revive | 40, with a 2 s shield, the ammo they had, where they fell |
| After the 25 s | **out**, until the mode brings them back (Goose Horde: the next wave) |

- The fallen player sees a small panel low on the screen ("YOU ARE DOWN", a bar that drains, then
  "OUT OF THE FIGHT"), never the full-screen death screen: they keep watching the fight.
- Teammates see `REVIVE NAME` as a world marker on the body while a revive is still possible, the
  tag `DOWN 18` (then `OUT`) in place of that player's health in the squad rows top left, and a line
  in the feed. Standing in reach shows the prompt `HOLD TO REVIVE NAME`, then the progress.
  Letting go loses the progress.
- Who decides what: a player reports its own fall (`hordePlayerEliminated`, relayed) and decides its
  own standing up. A reviver sends `reviveEvent { senderSlot, targetSlot }` when its hold completes;
  only the target acts on it, and only while it is still down. Standing up, by a revive or by the
  mode, is an ordinary `respawnEvent`, which is what takes a slot off everyone's list of the fallen.
- Each client times a teammate's 25 s itself from the moment it hears of the fall. The fallen
  player's own clock is the one that counts; a revive that arrives after it is ignored.
- A late joiner is told who is down in its sync and gives each the whole time (it cannot know how
  long ago they fell).
- The mode decides the loss: Goose Horde ends the run when every connected player is on the list.

## Where the pieces are

| Piece | File |
|---|---|
| Numbers and the pure tracker | `src/core/modeControllers/reviveRules.ts` (`REVIVE_RULES`, `ReviveTracker`) |
| Pings, prompts, markers, tags, the messages | `src/core/modeControllers/SquadController.ts` |
| The fallen player's panel | `src/ui/downedOverlay.ts` |
| The tag on a health row | `MultiplayerHud.setRowTag` |
| Standing up in place, the shield | `Player.revive`, `Game.reviveOwnPlayer` |
| Wiring | `Game.create` (the `SquadController` block), `MatchMessageRouter` cases `reviveEvent`, `ping`, `hordePlayerEliminated`, `respawnEvent` |

## Tests

`reviveRules.test.ts`, `SquadController.test.ts`, the router test (a fall, a stand-up, a revive and
a ping reach the layer; the new messages are bounded), and `e2e/horde.spec.ts` in the browser.

## To use it in another co-op mode

Pass `revives: true` for that mode where the controller is built, call `squad.ownFell()` where the
mode handles the player's death (and send the fall), and decide when the fallen come back
(`Game.onHordeWaveStart` is Goose Horde's).
