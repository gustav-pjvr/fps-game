# Fable rebuild: handover

Branch `feature/fable-rebuild` (pushed to `origin`), base `master` at v4.7.1, version on the branch
5.0.0. Nothing is merged, nothing is deployed to production. Written 2026-11-10.

**In one paragraph:** all four modes are rebuilt, the arsenal and skins are built, and a preview is
live. Three of the four modes are playable in a room as well as alone (King of the Hill is a room
mode; Goose Horde is both); Operation Uplink and Showdown are solo, and their co-op was postponed by
Gustav. Typecheck and the unit suite pass, the browser specs for everything new pass, performance
is equal or better than v4.7.1, and an independent review's eight clear defects are fixed. Not
verified: the full Playwright suite (skipped on Gustav's instruction) and the core smoke group
(this machine was too slow today to judge it; the untouched baseline fails it the same way). The task is `docs/fable-rebuild-brief.md`;
every decision and its reason is in `docs/fable-rebuild-decisions.md` (D1 to D27); the running log is
`docs/fable-rebuild-progress.md`.

## What was built

**The arsenal** (`docs/arsenal.md`)
- 19 weapons, each with its own model, sounds, recoil, reload and inspect animation and handling
  numbers: 7 primaries, 5 secondaries, 6 blades and the Goose Launcher. Twelve are new. All names
  are fictional.
- Every model is built in code by a small modelling kit (`src/weapons/models/`); no weapon model
  file is loaded. Sounds are synthesised (`src/audio/weaponSounds.ts`); the sampled files are gone.
- Damage falloff, side recoil, aim speed and weight per weapon; blades have two attacks each.
- Other players see the weapon and skin you hold.
- Spread and recoil by the kind of gun (added 2026-11-11 at Gustav's request, `docs/gun-handling.md`):
  aimed fire holds each gun's real precision, the hip, movement and long bursts open it up, a burst
  climbs then settles into a learnable weave, and each kick is sized to its cartridge. Unit suite
  1930 of 1930 after it; `e2e/gun-handling.spec.ts` 2 of 2; the four smoke tests that fire and aim pass.

**Skins** (`docs/skins.md`)
- Six looks for every weapon (Service, Ranger, Whiteout, Ember, Gilded Goose, Pulse), equipped per
  weapon, kept in the browser, visible to other players.
- A Skins screen in the main menu with three previews (on the rack, in hand, down the sights).
- The aim rule is tested for all 114 weapon and skin combinations.

**King of the Hill** (`docs/king-of-the-hill.md`)
- A hill that moves every minute, the golden goose as a crown that doubles points, two against two
  with four players, Final Push at 75 percent. Kills score nothing.

**Goose Horde** (`docs/goose-horde.md`)
- Twelve waves sized to the squad, brutes, two bosses, supply drops earned by kills, a real win.
- Co-op: down and revive instead of two respawns. Solo: Second Wind.

**The co-op layer** (`docs/coop.md`)
- Pings (V, middle mouse, LB) and down and revive, shared by every mode with a side.

**Operation Uplink** (`docs/uplink.md`)
- Four stages (breach, fetch the data core, defend the upload, extract), an alert level, two
  redeploys, a graded end screen, and the Warden elite. Solo.

**Showdown, the Director mode rebuilt** (`docs/showdown.md`)
- Five acts and a finale with the Warden, a score multiplier, two redeploys, a graded end screen. Solo.

## What to try first

1. Main menu, **SKINS**: pick a weapon, try each skin, switch between the three previews.
2. **LOADOUT**: the new grid; equip a new primary, secondary and blade.
3. **PLAY, Goose Horde** alone: survive a few waves, take a supply crate, lose a Second Wind.
4. **PLAY, Showdown**, then **PLAY, Operation Uplink** (both maps).
5. **MULTIPLAYER, King of the Hill** and **Goose Horde** with a second browser or a friend: hold the
   hill, take the crown; in the horde let one player fall and revive them (hold E beside them),
   and ping with V.
6. In any match: G to inspect, right button with a blade for its second attack.

## New network message types (for `feature/server-relay`)

Each needs a class in the relay's `src/network/routing.ts`. That branch was not touched.

| Type | Sent by | Suggested class |
|---|---|---|
| `kothState` | host, to everyone and in a late joiner's sync | host broadcast |
| `kothCrownClaim` | guest, to the host only | guest to host |
| `hordeState` | host, to everyone and in a late joiner's sync | host broadcast |
| `reviveEvent` | any player, relayed to everyone (`senderSlot`) | relayed |
| `ping` | any player, relayed to everyone (`senderSlot`) | relayed |

Existing types with new optional fields: `playerSnapshot` (`w` weapon id, `k` skin id),
`hordeGooseSpawned` (`flavor` also `brute` or `boss`, `boss`), `hordeGooseHitEvent` (`damage`),
`hordeGooseExploded` (`stomp`). `hordePlayerEliminated` keeps its shape and now means "this slot
is down". No longer sent, still in the protocol so the relay branch compiles:
`goldenGoosePickedUp`, `goldenGooseDropped`, `goldenGooseState`, `kothScoreTick`; `hordeReset` is
not sent in a room any more.

## Preview

https://fable-rebuild.hunter-n-goose.pages.dev (a Cloudflare Pages preview of this branch, not
production), redeployed after the UI review's fixes. Checked after each deploy: it shows v5.0.0, the
Skins preview draws, Goose Horde, Showdown and Operation Uplink each start, the review fixes are
present, and there are no page errors and no failed requests.

## Evidence

Every figure below is from this branch on 2026-11-10. Browser runs use software rendering and were
taken from a copy of the committed tree (`C:\tmp\fable-logs\snap-head.sh`).

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run test:unit` | 1912 tests in 150 files: 1911 pass in the full run; the one that did not (`structureMaterials.test.ts`, a 60 s texture test the rebuild did not touch) passes when run alone (3 of 3 in 33 s) |
| All 114 weapon and skin combinations (`weaponModels.test.ts`) | aim point, clear line of aim, budgets, arms and skin features pass |
| `e2e/skins.spec.ts`: every weapon in every skin, aimed | passes; every measured offset between sight and crosshair is 0.00 px; screenshots of each aimed view are saved by the test |
| `e2e/skins.spec.ts`: equip, reload, worn in a match | passes |
| UI guard (`ui-qa.spec.ts`), every menu screen at phone and desktop width | 14 of 14 (console errors, 5xx, axe, nothing off screen), run after the review fixes |
| `e2e/koth.spec.ts` | 2 of 2: two players and a late joiner; four players two against two |
| `e2e/horde.spec.ts` solo | passes: supply drop, Second Wind, death, a new run, the boss, the win |
| `e2e/horde.spec.ts` two players, three tests of two browsers each | 3 of 3: the host's waves and kills on the guest, a fall, a revive (40 health, where they fell) and back with the next wave (4.0 min); a late joiner told the wave, the kills and the flock (5.2 min); a guest who leaves and comes back into its slot (5.0 min) |
| `e2e/horde.spec.ts` four players | passes: a wave sized for four, the run lost when all four are down |
| `e2e/director.spec.ts` | 6 of 6: the three original director tests and Showdown's three |
| `e2e/mission.spec.ts` | 2 of 2: the whole operation with a redeploy and a graded win; both losses |
| `e2e/facility-modes.spec.ts` | 2 of 2 |
| After the UI review's fixes | rerun and passing: the UI guard, Showdown's three tests, `mission.spec.ts`, solo Goose Horde, the skins equip test. Not rerun after those fixes: `koth.spec.ts` (its panel moved under the scoreboard and gained a backing), the three two-player Goose Horde tests and the two four-player tests (panel styling only) |

**The core smoke group (`smoke.spec.ts`) could not be judged on this machine today.** 11 of its 16
tests pass; the other five overrun their own time budgets (60 to 120 s) with no assertion failing.
Run back to back on the untouched v4.7.1 copy, three of the same four overran in the same way, and
four other smoke tests took the same time on both trees (32 to 48 s each), so this is the machine,
not the rebuild. It should be rerun on a quiet machine before release.

**The full Playwright suite was not run** (Gustav's instruction, decision D28). The groups the
rebuild maps to were run one at a time instead, as listed above. Not run: `world`, `houses`,
`grenades`, `pickups`, `mp`, `mp4`, `ai` beyond `director.spec.ts`, and the facility group beyond
`facility-modes.spec.ts`.

## Independent UI review

A fresh Fable reviewer (the `ui-reviewer` agent, no knowledge of how the screens were built) looked
at the preview at 390 px and 1440 px for the menus and at 1280 px in a match, and read every
screenshot. Its verdict was "not fit to show yet": no blocker, eight clear defects (S2) and fifteen
points of polish (S3). Screenshots and its notes: `C:\tmp\fable-logs\ui-review\`.

**All eight S2 defects are fixed** (commit `5c59e44`), each checked again in a screenshot:

| Finding | Fix |
|---|---|
| The Goose Horde panel was unreadable over a pale building, and the Second Wind count wrapped | The mode panels (Goose Horde, Showdown, King of the Hill) have a backing like the scoreboard's; Second Wind has its own line |
| A headline printed over the boss bar (Goose Horde) and over the redeploy count (Showdown) | Headlines sit below the crosshair in modes with a panel top centre |
| A world marker pinned to the screen's edge landed on the Uplink objective panel | A pinned marker keeps out of the top 250 px, where the HUD panels live |
| The Goose Horde mode card said "Survive 10 waves" | It says 12, and names the bosses |
| Phone Skins: the skin cards and the preview were never on screen together | The preview stays at the top while the lists scroll under it |
| Phone Loadout: the weapon details and Skin row were a screen and a half below the grid | They stay at the top while the grid scrolls; the Change button is 40 px tall |
| End screens said "Respawn" on a finished run, a win included | A finished run offers "Play again"; a death mid-operation offers "Redeploy" |

Also fixed from the S3 list: Showdown's score no longer shows twice, its redeploy count is no longer
faint, its loss has its own title ("Showdown lost", where it shared "Overrun" with Goose Horde), the
phone Loadout uses the same 16 px margin as Skins, and the King of the Hill panel sits under the
scoreboard where it sat on top of it.

**Left as they are** (S3, judged not worth the risk now, or older than this rebuild):
- Skins at 1440 px: about 240 px of empty space under the preview's buttons; the two side lists are
  cut at the bottom with no scroll cue; a long weapon name with a long skin name wraps to two lines.
- Skins previews: the aimed view is mostly hands and forearm with the weapon small (the sight is on
  the crosshair in every capture); the in-hand view sits low and right as it does in play.
- Loadout: the turning character's rifle is clipped by the panel's right edge; dark thumbnails barely
  separate from their tiles.
- Play setup: stock dropdown arrows, small steppers, "Goose Explosions" stays active in Goose Horde,
  the Start Match arrow drops to a second line at 390 px (all older than this rebuild).
- Uplink headlines are thin orange text that blends into a lit forest; the end screens sit in the top
  half with the lower third empty; weapon slot 3 in the hotbar is hard to read over the arm.
- One capture of the phone main menu six seconds after load showed no title or buttons; five later
  captures all drew it. Not reproduced.

Not looked at by the reviewer: the co-op screens that need two browsers (the downed panel, the revive
prompt, pings, the King of the Hill panel), the pause menu, the Showdown win screen, keyboard and
Back navigation, and a real touch device. `/web-design-guidelines` and `site-qa` were not run as
separate passes; the UI guard spec (`ui-qa.spec.ts`: console errors, 5xx, axe, nothing off screen)
covers part of what they check.

## Performance against the baseline

`e2e/perf-log.spec.ts` (a solo match with 20 enemies: the player standing at spawn, then a fight),
run on the untouched v4.7.1 copy and on this branch back to back on 2026-11-10, so both saw the same
machine. The headed runs use the real GPU; frame rate is capped at 60 by the display.

| Run (real GPU) | fps at spawn | fps in the fight | render ms per frame | frame p95 ms | ai ms per tick | physics ms per tick |
|---|---|---|---|---|---|---|
| Medium, v4.7.1 | 51.7 | 58.0 | 7.95 | 20.2 | 1.19 | 3.42 |
| Medium, v5.0.0 | 56.3 | 59.5 | 7.12 | 18.9 | 1.16 | 3.04 |
| Low, v4.7.1 | 59.8 | 60.0 | 2.58 | 18.5 | 0.94 | 3.54 |
| Low, v5.0.0 | 59.9 | 60.0 | 2.19 | 18.3 | 1.37 | 3.80 |

Equal or better on both tiers: Medium gains about 1.5 fps in the fight and 0.8 ms of render time per
frame, Low sits on the 60 fps cap in both with 0.4 ms less render time. The per-tick AI and physics
figures move by a few tenths of a millisecond in both directions between runs (the fights differ),
well inside a 16.7 ms frame. Headless (software rendering, where only the per-tick CPU figures mean
anything): Medium ai 1.31 to 0.77 ms and physics 2.75 to 1.52 ms; Low ai 0.82 to 0.77 ms and physics
1.65 to 1.59 ms. Logs: `C:\tmp\fable-logs\perf2-*.log`.

Download size: the script bundle grew from 3,949 kB to 4,130 kB (1,394 to 1,448 kB gzipped) with the
weapon kit, 19 models and four modes in it, and the shipped asset files shrank from 5,517 kB to
5,378 kB (the sampled sounds and old weapon models are gone). A cold first load of a match in the
test browser took about the same on both trees.

This run measures the solo fight. It does not measure a full Goose Horde wave with four players, or
the new weapon models under a real match's worth of other players.

## Not done, and why

- **Co-op for Operation Uplink and Showdown: postponed by Gustav** (decision D30). Both are solo.
  The rules already take a list of players and scale to a squad, and the design to start from is
  written down (decision D29: the host simulates every enemy, guests mirror them, enemy damage rides
  the existing `damageEvent`). None of it is built.
- **The full Playwright suite** (see Evidence).
- **`server/`, `ServerTransport`, the relay and `feature/server-relay`** were not touched, as required.

## Known issues

- The Kestrel battle rifle shows more of its receiver under the sight when aimed than the VR-4; the
  R60's rear sight is chunky at the hip. Both pass the aim rule.
- The kit cannot cut into a round barrel, so flutes and heat-shield holes are dark strips.
- The R60's belt is part of its ammunition box and does not feed while firing.
- On the Valley the Uplink data core hovers over one of the lab's pickup sites.
- The in-match HUD is not designed for a phone (there are no touch controls); the menus are.

## How it was built

Main session on Fable 5.2 throughout. Three Fable subagents at medium effort, one at a time: weapon
models batch 1 (three guns), batch 2 (four long guns), and Operation Uplink. Three read-only Haiku
surveys at the start. No other models.
