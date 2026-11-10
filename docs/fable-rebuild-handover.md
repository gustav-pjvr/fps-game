# Fable rebuild: handover (draft, updated as the last checks land)

Branch `feature/fable-rebuild` (pushed to `origin`), base `master` at v4.7.1, version on the branch
5.0.0. Nothing is merged, nothing is deployed to production. The task is `docs/fable-rebuild-brief.md`;
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
production). Checked after deploying: it shows v5.0.0, the Skins preview draws, and Goose Horde,
Showdown and Operation Uplink each start, with no page errors and no failed requests.

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
| UI guard (`ui-qa.spec.ts`) on the Skins screen | passes at phone and desktop width |
| `e2e/koth.spec.ts` | 2 of 2: two players and a late joiner; four players two against two |
| `e2e/horde.spec.ts` solo | passes: supply drop, Second Wind, death, a new run, the boss, the win |
| `e2e/horde.spec.ts` four players | passes: a wave sized for four, the run lost when all four are down |
| `e2e/director.spec.ts` | 6 of 6: the three original director tests and Showdown's three |
| `e2e/mission.spec.ts` | 2 of 2: the whole operation with a redeploy and a graded win; both losses |
| `e2e/facility-modes.spec.ts` | 2 of 2 |

Still to be recorded here: the two-player Goose Horde test (revive, late join, rejoin), the core
group, the full suite, and performance against the baseline. See "Open at handover" below.

## Not done, and why

- **Co-op for Operation Uplink and Showdown.** Both are solo. The rules already take a list of
  players and scale to a squad, but enemies are simulated on one client only; making a host simulate
  them for a room (decision D14) is the riskiest change in the brief and was left for last.
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
