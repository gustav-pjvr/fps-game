# Fable rebuild: decision log

Each entry: the decision, the reason, the runner-up. Newest at the bottom. The brief is
`docs/fable-rebuild-brief.md`; progress is in `docs/fable-rebuild-progress.md`.

## D1. Order of work (2026-11-10)

Arsenal and skins first, then the shared co-op systems, then the modes (King of the Hill, Goose Horde,
Uplink, Director), then co-op enemies, then UI polish, docs, full suite, preview and handover.

- Reason: the modes need the weapon balance and the pickup rules, so the arsenal is the foundation. The
  required parts land before the optional one (co-op for Uplink and Director).
- Runner-up: modes first. Rejected because every mode spec would be rewritten when weapon names, damage
  and the loadout changed under it.

## D2. Weapon ids stay, the roster grows to 20 definitions

Existing ids and names are kept (`pistol`, `mp5`, `rifle`, `shotgun`, `sniper`, `knife`, `gooseLauncher`,
`unarmed`), so stored loadouts, Gun Game, the fixed-loadout modes and the e2e helpers keep working.
New ids: primaries `smg`, `battleRifle`, `lmg`, `dmr`; secondaries `revolver`, `machinePistol`, `sawnOff`;
blades `karambit`, `machete`, `tanto`, `hatchet`, `spike`. All names are fictional.

- Reason: a rename buys nothing and breaks saved loadouts.
- Runner-up: a clean new id scheme with a migration table. More churn for no player benefit.

## D3. Weapon models are procedural, built from a new kit

Every weapon is rebuilt in code from a kit (`src/weapons/models/kit/`): side profiles extruded with a
bevel (silhouette is most of what reads as a real gun), lathed barrels, rails, pins, real moving parts
(slide, bolt, pump, cylinder, magazine), and merged geometry so a detailed gun still costs a handful of
draw calls. One file per weapon under `src/weapons/models/guns/` and `blades/`.

- Reason: no licence risk in a public repo, skins can change shape as well as paint, and one aim-point
  rule covers every weapon and skin. Download size stays near zero.
- Runner-up: sourced glTF models (CC0 packs). Rejected: mixed art styles, no control over sights (the
  aim-point rule), and per-skin shape changes would need an artist.

## D4. Six skin families, each built for every weapon

`service` (default), `ranger`, `whiteout`, `ember`, `gilded`, `pulse`. A skin is a material set plus
optional shape parts and animation style: `ranger` swaps the rear notch for an aperture sight and adds
cloth wraps, `ember` adds a ported muzzle device, `gilded` adds engraved plates and a goose medallion,
`pulse` replaces the iron sights with a reflex sight and pulses its light lines, and has its own inspect
move. The player equips one skin per weapon, saved in wrapped localStorage (`fps-game-skins`).

- Reason: the brief asks for look families that change colour, materials, shape and animation. Sight
  changes are included on purpose: they are what the aim-point test exists to protect.
- Runner-up: paint-only skins (cheaper). Rejected: the brief names shape and animation.

## D5. Other players see the held weapon and skin through the snapshot

`playerSnapshot` gains two optional fields, `w` (weapon id) and `k` (skin id), bounded strings checked
against the registries. `RemotePlayer` holds a third-person copy of the weapon model on the right wrist.

- Reason: no new message type (so nothing new for the relay's routing table), self-healing for late
  joiners and rejoins, and older builds ignore the fields.
- Runner-up: a reliable `weaponState` event on change plus a sync entry. More moving parts for the same
  result.

## D6. Aim-point proof

Unit test: for every weapon and every skin, the aim point sits on the screen centre at the aim distance,
the sight tip sits on the centre line, and nothing but the sight tip (and an optic's thin frame, outside
a clear window) rises above the line of aim. Browser test: the Skins screen has an aimed-view preview;
a spec screenshots every weapon and skin in it.

- Reason: the unit test is exact and runs in seconds; the screenshots are the visual evidence the brief
  asks for and cost no match load.
- Runner-up: screenshots taken inside a real match (20 weapons x 6 skins at 2 frames a second: hours).

## D7. Handling model

Definitions gain: damage falloff by distance, a recoil pattern (vertical and horizontal, recovery), aim
speed, mobility, draw time, and an animation set (fire, reload stages, inspect, draw). Blades get an
attack table (primary and alternate attack, each with damage, reach, arc, duration and pose curve).
New inputs: `inspect` (G, pad D-pad down) and `ping` (V and middle mouse, pad LB).

- Reason: twelve guns cannot be told apart with damage, rate and magazine alone.
- Runner-up: keep the flat model and vary numbers only. Rejected: SMG, rifle and DMR would overlap.

## D8. Sounds are synthesised per weapon

Every gunshot, reload stage and blade swing is built in `SoundEngine` from a per-weapon profile (crack,
body, tail, mechanical layers). The four old weapon mp3 pairs are removed: their source is not recorded
anywhere in the repo or its history, and the brief requires a recorded source for every asset.

- Reason: licence-clean in a public repo, and one consistent sound family across 12 guns and 6 blades.
- Runner-up: keep the 8 mp3s for the 4 old guns and synthesise the rest. Rejected: unknown licence and
  two sound families side by side.

## D9. Knife Only uses the player's equipped blade; Gun Game uses all 12 guns

- Reason: the fixed modes must keep working with the new arsenal and should show it off. Blade stats are
  balanced against each other (fast and weak to slow and strong).
- Runner-up: Knife Only stays on the Combat Knife. Safe but hides five blades.

## D10. King of the Hill becomes a moving hill with the golden goose as its crown

Rules: one hill (a ring on the ground, radius 8 m) at a seeded site; it moves every 60 s with an 8 s
warning. A side scores 1 point a second while it has a player inside and no opponent is inside
(contested: nobody scores). The golden goose stands in the hill's centre: whoever takes it (E) is
crowned, scores double, cannot sprint, is marked for everyone, and drops it on death. With 4 players the
match is 2 against 2 (no friendly fire); with 2 or 3 it is free for all. First to the point target
wins; past 75 percent the Final Push starts (smaller hill, 40 s moves). Kills are stats, not points.
The host decides everything (occupancy, score, crown) and broadcasts one state message; a guest asks for
the crown.

- Reason: today's mode is a single carrier running away, with no place to fight over and no team play.
  A hill gives a place, the crown keeps the goose and adds risk, teams give a reason to cover each other,
  and host authority removes self-reported score ticks.
- Runner-up: keep goose carrying and add an escort rule. Rejected: with 2 players it stays cat and mouse.

## D11. Goose Horde becomes a 12 wave stand with brutes, two bosses and revives

One wave table for solo and co-op, scaled by living players. New geese: the brute (armoured, takes many
hits, bigger blast) and two bosses (wave 6 Mother Goose, wave 12 the Matriarch) that spawn walkers. Co-op:
a player at 0 health goes down, a teammate revives them (hold E, 3 s), a bleed-out sits out until the
next wave; everyone down is the loss. Solo: one Second Wind that recharges every 4 waves. Kills fill a
squad meter that calls a supply drop (ammo, health, a grenade) each player can claim once. Solo gets a
real win (wave 12).

- Reason: today there is no objective, no team mechanic and solo never ends. Revives and focus targets
  are the two cheapest mechanics that make four players act as a squad.
- Runner-up: a points shop between waves. Rejected: a large UI for a small gain at 4 players.

## D12. Uplink becomes a four stage operation, solo and co-op

Stages: hack the first uplink (hold), fetch the data core (from the lab under a tower on the Valley,
from a far room on the Facility) and carry it to the relay, defend the upload (escalating waves, a
Warden elite in the last), extract before the timer ends. An alert level rises with time and noise and
sizes the waves. Solo has 2 redeploys from the last finished stage; co-op uses the shared down and revive
system and redeploys bled-out players when a stage completes. The end screen grades the run.

- Reason: three identical holds have no arc. Four different stages give a beginning, a risk run, a
  stand and an escape.
- Runner-up: keep three uplinks and add modifiers. Rejected: still the same task three times.

## D13. Director becomes Showdown: five acts and a finale

The pacing director stays the engine. Each act is one build-up, peak and relax cycle with a larger
cap and a harder mix; relax drops a supply crate; act 5 ends with a finale squad led by a Warden. A score
multiplier grows while intensity stays high and resets on a death. Surviving the finale wins. Co-op
feeds the director the whole squad's damage and kills and scales the cap by players.

- Reason: endless waves with no end and no arc is a sandbox, not a mode.
- Runner-up: endless with a leaderboard. Rejected: no server to hold one, and no ending.

## D14. Co-op enemies (for Uplink and Showdown) are host-simulated, built last

Enemies get an `EnemyTarget` interface so the host's AI can chase and shoot any player; guests mirror
enemies as puppets from host snapshots, report their hits, and take enemy damage by message. This is the
last mode phase. If it is not reached, Uplink and Showdown ship solo with the rebuilt rules and the
handover says so.

- Reason: the brief allows co-op for these two "if that makes it better", and it does, but it is the
  riskiest change (the AI assumes one player in about ten places), so nothing else depends on it.
- Runner-up: keep both solo for good. Rejected as the first choice: the mission is the best co-op mode.

## D15. Shared co-op systems

Pings (a marker where you look, 6 s, relayed), the down and revive system, a squad panel (teammate
health and state), objective markers on the existing `WorldMarkers`, and per-player end screen stats.
Built once in `src/core/coop/` and used by Horde, team King of the Hill, Uplink and Showdown.

- Reason: four modes need the same aids; building them per mode would diverge.
- Runner-up: per-mode helpers.

## D16. Retired messages stay in the protocol

The old King of the Hill messages (`goldenGoosePickedUp`, `goldenGooseDropped`, `goldenGooseState`,
`kothScoreTick`) are no longer sent, but their types stay in `protocol.ts` until `feature/server-relay`
is merged, because that branch's `routing.ts` names them and would stop compiling.

- Reason: a clean merge for the relay work matters more than a few dead types.
- Runner-up: delete them now and note it for the merge.

## D17. UI process

The Skins screen and the reworked Loadout extend the existing menu design language (theme tokens,
panels, tiles) that Gustav approved in v4.6.0, so no mock-up round is run; the brief forbids asking him
to pick one. Each new or changed screen still gets `/web-design-guidelines`, `site-qa`, screenshots at
390 px and desktop width, and a `ui-reviewer` pass.

- Reason: mock-ups exist to let Gustav choose; here the choice is delegated and the language is set.
- Runner-up: build two directions and pick one myself. Double the cost for a screen inside a set system.

## D18. Agents are Fable only (Gustav, 2026-11-10, mid-session)

Gustav's instruction after the kit was built: no agents except Fable agents, or Haiku for read-only
legwork; this run is also a test of Fable, so Fable does the main work. One Fable agent runs at a time
at medium effort in the background (his rule 1.3) on batches of weapon models with a written brief and a
runnable check, while the main session builds everything else. No Sonnet or Opus agent was started.
Reviews that his rules give to Opus (the independent audit, the `ui-reviewer`) are run as Fable agents
with a fresh context instead.

- Reason: a direct instruction that overrides section 6 of the brief.
- Runner-up: none.

## D19. Skins screen and Loadout: the brief, self-authored under delegation

The Skins screen is three columns on the existing menu language: every weapon by category on the left
(with the skin it wears now), the weapon itself in the middle, six skin cards on the right (swatches,
what the skin changes, the equipped corner the Loadout tiles use). Its one idea comes from this game's
own rule: the preview shows the weapon three ways, on the rack, in hand and down the sights, so a skin
that changes the sights shows the crosshair still sitting on them before it is equipped. Clicking a
card equips at once, as the Loadout does. On a phone it is one column: preview, a strip of weapons to
swipe, the cards. The Loadout gains a grid for 19 weapons, side-on pictures in each weapon's skin, the
character holding the equipped primary, and a Skin row with a Change button.

- Reason: the aim-point proof is the one thing no other skins screen needs to show; it is also what
  the screenshot spec photographs.
- Runner-up: a skins tab inside the Loadout page. Rejected: no room for a preview large enough to
  judge sights.

## D20. Ranged damage falls off with distance; a blade hits each target once per strike

Guns other than the sniper and the launcher lose damage in a straight line between two ranges
(`falloff`). A blade's strike is a fan of rays cast a moment into the swing (`hitAt`), and each target
takes the attack's damage once, however many rays find it. Before, the knife's three rays each did 45,
so a clean hit did 135: one hit killed. Blade damage is now what the table says (two hits for most).

- Reason: twelve guns need range to tell them apart, and six blades need honest numbers to balance.
- Runner-up: keep multi-ray stacking. Rejected: the stat shown would be a third of the damage dealt.

## D21. Other players stand with the weapon up

`RemotePlayer` plays the model's `Idle_Gun_Pointing` clip when standing (and `Run` when moving) now
that a weapon is in the hand: a rifle hanging from one arm at the side read badly.

- Reason: judged from lab renders of each clip with the rifle, pistol and knife.
- Runner-up: `Run_Shoot` while moving. Rejected: the arm waves the weapon overhead mid-stride.

## D22. Goose Horde: one table of twelve waves, sized to the squad

Solo and co-op share `HORDE_WAVE_TABLE` (twelve waves, bosses on 6 and 12). The table's counts are
for one player; each further player adds 45 percent of the small geese, three or four players get half
as many brutes again, a boss gains half its health per extra player, and the squad size is read when
each wave begins (so a late joiner counts from the next wave). Before, solo had 10 waves and a room 15
with fixed counts whatever the number of players.

- Reason: fair from 1 to 4 players needs the flock to follow the squad; one table keeps the arc the
  same for everyone and is one thing to tune.
- Runner-up: a table per player count. Rejected: four tables to balance, and no answer for a player
  joining or leaving mid-run.

## D23. Co-op Goose Horde: down and revive replace the two respawns

A fallen player is down for 25 s (a teammate holds interact for 3 s within 2.6 m to stand them up
with 40 health), then out, and everyone down or out returns when the next wave starts. The run is
lost when the whole squad is down at once. The fallen player has no death screen.

- Reason: a count of lives gives teammates nothing to do for each other; a revive is the team play
  the brief asks for, and "back next wave" keeps a fallen player in the evening.
- Runner-up: keep limited lives and add revives on top. Rejected: two systems for one event.

## D24. Solo Goose Horde: Second Wind, and a real ending

Solo cannot be revived, so it starts with one Second Wind (stand up with 35 health, a 2.5 s shield, the
geese within 7 m blown away) and earns another after waves 4 and 8, two at most. A death with none
left ends the run and restarts from wave 1; surviving wave 12 wins on an end screen with the numbers.

- Reason: one mistake ending a twelve wave run reads as unfair alone; an earned safety net rewards
  progress without removing the stakes.
- Runner-up: checkpoints every four waves. Rejected: it removes the tension of the late waves.

## D25. Supply drops are earned, not timed

The squad's kills fill a meter (small goose 1, brute 3, a boss fills it); a full meter drops a crate
near every standing player: health, a grenade, and in a room ammunition. Before, a room got a timed
ammo crate near a random player and solo got nothing.

- Reason: a reward the squad sees coming ("5 kills to the drop") is a goal inside the wave, and one
  crate each avoids a fight over supplies.
- Runner-up: keep timed crates. Rejected: nothing to play for.

## D26. The co-op layer lives in `core/modeControllers/`, and rides existing messages where it can

`SquadController` and `reviveRules` sit beside the mode controllers (not in a new `core/coop/` as D15
named). A fall reuses `hordePlayerEliminated` (now "this slot is down") and standing up is the ordinary
`respawnEvent`; only `reviveEvent` and `ping` are new. The squad panel is the existing health rows top
left with a `DOWN 18` or `OUT` tag, not a second panel.

- Reason: fewer message types for the relay branch to classify, and one place for a player's health.
- Runner-up: new `playerDowned` and `playerStoodUp` messages. Rejected: they would say what two
  existing messages already say.

## D27. Fable agent 3 builds Uplink in the shared checkout, by file ownership

The Uplink rebuild is delegated with a list of files and of `Game.ts` members that are the agent's,
and a list that is not; it does not commit. The main session keeps to the rest of `Game.ts` meanwhile.

- Reason: a separate worktree would need its own `node_modules` junction, and a harness that removes
  a worktree with a junction in it could delete the main checkout's modules (the brief's stop rule).
- Runner-up: a worktree per agent. Rejected for that risk.

## D28. The full Playwright suite is skipped; co-op for Uplink and Showdown goes ahead (Gustav, 2026-11-10)

Gustav's instruction during the run: skip the full suite, measure performance against the baseline,
run the independent UI review, close those out, then build the co-op tasks. The groups the rebuild
maps to were run one at a time instead (results in the handover's evidence table).

- Reason (Gustav's): his call; no reason given. My reading: the affected groups already ran, and a
  full run on this machine takes hours while other sessions share it.
- This reopens D14's "if it is reached": co-op enemies are now in scope.

## D29. Co-op enemies: the host simulates, guests mirror, damage rides the existing damageEvent

Uplink and Showdown become room modes. The host runs the director, the mode's rules and every enemy;
each enemy fights the nearest living player through a small `EnemyTarget` interface (the host's own
player, or a remote player whose `takeDamage` sends that guest an ordinary `damageEvent`). Guests
show each enemy as a puppet moved by the host's snapshots and report their hits to the host. The
fallen use the co-op layer (down, revive) and come back when an act or a stage is cleared.

- Reason: it keeps the host-authoritative star the brief requires, reuses the damage path every
  client already trusts, and needs the AI to change in one place (who its target is).
- Runner-up: every client simulates its own enemies from a shared seed. Rejected: the AI reads the
  player's position every tick, so two clients would diverge within seconds.
