# Changelog

Version shown in the main menu (bottom-right, see `src/core/version.ts`) is derived from this
history. **Scheme (semver-ish):**
- **Major** - a genuine identity or architecture shift (multiplayer's introduction, the rename +
  hosting migration).
- **Minor** - a new feature or game mode.
- **Patch** - a bug fix or small tweak.

Grouped by release-worthy chunks of work, not one entry per commit - see `git log` for the full,
granular history if you need it.

## v4.1.0 (current)

The world redesign, 2026-10-24: new towers, houses and terrain, and simpler menu text. The full
record is in `docs/world-redesign.md`.

- **New watch towers.** A concrete core with five steel flights of real stairs around it, flat
  landings at every turn, a grated lookout deck over the whole tower and a roof on posts with a mast
  and a red warning light. The stairs climb cleanly now: the old landings stood half a metre above
  the ramps and two flights leaned into the wall. Towers also stand further apart.
- **New houses.** Three prefab outpost buildings (a bunkhouse, a two-storey block and a workshop)
  in concrete, ribbed cladding and corrugated roofing, with lit windows and lamps at the doors, on
  the same footprints as before. Shots stop exactly where the walls and roofs are.
- **New terrain.** Broad rises and basins, winding spurs and a few ridgelines for cover, with every
  slope walkable. Towns, towers and the spawn sit level in the ground instead of in pits or behind
  steep banks. The ground now shows grass, bare soil, rock on steep banks and gravel round the towns
  and towers.
- **Simpler menus.** Shorter labels, status lines and mode briefings; "Reset Play" is now "Restart",
  and ticking a mode in the match setup greys out the counts it replaces.

## v4.0.0

The visual overhaul, built on 2026-10-23 after Gustav reviewed a three-model 3D game test. A new
identity: a well-made, focused shooter at dusk instead of a goose joke (the goose modes stay
playable). The full record is in `docs/visual-overhaul.md`.

- **A new look: stylised dusk.** A deep teal sky over an amber horizon, a low sun with long
  shadows, haze that takes the horizon's colour, and muted surfaces, so the only strong colour is
  light: weapon glow, objectives, tracers, lit windows. Medium and High add bloom, a colour grade
  and anti-aliasing, and High adds ambient occlusion; Low keeps the palette without the extra
  passes. Night and fog get their own versions of the look.
- **A new arsenal.** Every weapon is rebuilt in one design language: dark gunmetal, brushed
  barrels, hazard trim and cyan glow strips that dim as the magazine empties and turn amber when it
  runs low. The magazine drops out during a reload and the gun tucks in when you sprint. Names,
  stats and saved loadouts are unchanged.
- **New HUD and menus.** An objective panel, a compass with contact ticks, world markers with
  distance, damage direction arcs, a restyled minimap, kill feed and hotbar, and a title screen that
  drifts over the real valley.
- **Uplink, a solo mission.** Bring three watch-tower uplinks online, hold each tower for 40 s
  while waves come for you, then reach extraction. Beams over the towers show what is pending,
  uploading and online, and an end screen sums up your time, kills and damage taken.
- **Detail in the world.** Shaded terrain, soft shadows under every tree, rock, house and tower,
  and windows that glow at dusk and night. Watch towers no longer cut into towns.
- **Sound with depth.** Gunshots and explosions echo off the valley, combat music follows the
  fight in Director and Uplink matches (with its own volume slider), and a heartbeat warns you at
  low health.
- **Full-size characters.** Enemies are SWAT troopers with red visors, other players wear
  spacesuits lit cyan, with real animations: gun up at rest, walking or running by speed, a shot
  for every round fired and a proper death.
- **Fair hitboxes.** Hits are measured against the character you see: the old boxes were nearly
  twice as wide, so near misses counted. Multiplayer now has headshots too, at three times the
  damage, as against enemies.
- **Tracers that fit.** Rounds fly as glowing streaks with a hot core and a fading tail.
- **Accessibility.** Menus are labelled for screen readers and fully usable by keyboard, and
  announcements are spoken.

## v3.10.0

Enemy AI v2 for solo play, built at Gustav's request on 2026-09-15. The full record (plan,
decisions, measurements, and what each step changed) is in `docs/enemy-ai-v2.md`.

- **Enemies take a moment to notice you.** An awareness meter fills while an enemy can see you in
  its view cone: about 0.6 s up close, about 1.5 s at the edge of its range, faster if you sprint.
  They do not see behind them, so you can stand behind one unnoticed.
- **They share what they know.** A sighting, a gunshot, a hit or a comrade's death is shared with
  the squad, and louder weapons carry farther (pistol 30 m up to sniper 60 m).
- **They fight as a squad.** At most two shoot at you at once, one works round your side for a
  crossfire, and the rest hold back and take over when a shooter drops.
- **They use cover.** Enemies pick spots behind tree trunks and house corners within their weapon's
  range, hide there and step out to fire, instead of standing in the open. Rush one and it stands
  and fights instead of backing off to cover.
- **They hunt for you when they lose you.** A search grid tracks where you could have gone, and
  searchers pair up and sweep the likeliest ground for up to 30 s instead of walking to one point
  and waiting.
- **You can read them.** Short radio chirps from the enemy's direction call out "spotted",
  "flanking" and "lost them"; a Ridge Walker lining up a long shot shows a glint and a faint ting
  first; a hit of 25 damage or more staggers an enemy for half a second.
- **New solo mode: Director.** A Match Setup checkbox, off by default. The match starts with two
  enemies and a pacing director sends waves in from behind you and out of sight, reads how hot the
  fight is, and gives you a breather after each peak.
- **Performance:** the AI costs about 0.3 ms per tick at 20 enemies and 0.4 ms at 30. A
  once-a-second performance log is built in (F4, or `?perflog` in the address).

## v3.9.4

Five fixes Gustav asked for on 2026-09-14:

- **Bullets no longer stop in empty air above house roofs.** Each house used to have one collision
  box running all the way up to the roof ridge. Colliders now follow the real roof slopes, measured
  from the house models themselves, so shots that visibly clear a roof pass over it and a player on
  a roof stands on the slope instead of hovering at ridge height.
- **Bushes and rocks spawn again.** They silently stopped appearing after a vegetation density
  change; they now get their own random roll again.
- **Spawn points no longer land inside houses or watch towers.** Every spawn (single-player,
  single-player Goose Horde, multiplayer match start, respawns, the pause-menu unstick respawn, and
  late joiners) steps off any structure. Single-player's fixed spawn point was inside a town on
  about 6% of maps.
- **A kill-limit race can no longer give two different winners.** The host now decides who reached
  the kill limit (or King of the Hill's points) and tells everyone, including the final scoreboard,
  so every player sees the same podium.
- **The single-player smoke tests** are updated for the three-slot loadout (rifle, pistol, knife).

## v3.9.3

Four small fixes from the independent review of v3.9.2:

- A death landing in the brief moment between a respawn and the next game tick (for example a goose
  explosion right at the new spawn point) is now handled like any other death, instead of being
  silently skipped.
- Removing a timed-out player no longer runs the disconnect path twice (which sent a duplicate
  "player left" message).
- A player joining mid-match no longer receives scores for players they can't see, which used to
  make a departed player's score silently drop off that joiner's podium.
- If the mid-match Loadout page ever fails to build, the pause menu's Loadout button can be clicked
  again instead of staying dead for the rest of the match.

## v3.9.2

Multiplayer connection fix plus a verified bug sweep (2026-09-14). Full diagnosis of the connection
problem in `docs/multiplayer.md` ("Players can't join my lobby").

**Connecting to a lobby:**
- Root cause of "other players can't join my lobby": the game had no working TURN relay. PeerJS's
  public relay (`turn.peerjs.com`) no longer exists and the Metered.ca relay was never configured, so
  players on strict networks (managed devices, work/school firewalls, carrier-grade NAT) had no path
  to each other. The dead relay entries are removed; a real relay still needs the Metered.ca
  environment variables set in Cloudflare Pages (see README, "Deployment").
- A join that can't get through now gives up after 25 seconds with a clear "your network is blocking
  peer-to-peer play" message, instead of hanging on "Connecting…" and then claiming "The host
  disconnected."
- The host's lobby explains a failed join instead of showing PeerJS's raw error text, and the host
  automatically re-registers the room code if its connection to the matchmaking server drops
  (previously the code silently stopped working until a reload).
- A dropped matchmaking-server connection no longer ends a guest's running match.
- Messages between players now arrive in the order they were sent.

**Multiplayer fixes:**
- A guest killed by a goose or horde-goose explosion now gets a real death (death screen, kill feed,
  Goose Horde life used). Previously they froze for 3 seconds and silently respawned, so guests in
  Goose Horde effectively had infinite lives.
- Winning multiplayer Goose Horde now ends the match for guests too, not just the host.
- The mode briefing can no longer leave a slower-loading player frozen forever: readiness is re-sent
  until everyone has it.
- King of the Hill: two players pressing E at the same moment no longer deadlocks the golden goose.
- Goose Horde: an eliminated player leaving no longer ends the run while a teammate is still alive,
  and the last survivor leaving now correctly ends it.
- Start Match is no longer locked for 90 seconds after a guest leaves the lobby, and a player who
  left no longer comes back as a frozen "ghost" at match start, on a rematch, or for a late joiner.
- A new player who takes a departed player's slot starts at zero instead of inheriting their score.
- A player who reloads and rejoins before the host notices keeps their slot and score instead of
  being treated as a stranger (or refused as "room full").
- A backgrounded, timed-out player is now actually disconnected (they can rejoin) instead of staying
  invisible while still dealing damage.
- A guest on the podium returns to the lobby if the host closes their tab.
- Kill credit only goes to someone who damaged you in the last 8 seconds.
- Horde geese and ammo crates ignore dead players.
- Gun Game with a kill limit of 1 no longer forces everyone onto the Goose Launcher from spawn.
- Goose Toss: two players grabbing the same goose can no longer orphan a thrown goose mid-air.

**Gameplay fixes:**
- The golden goose's Goose Launcher reward now works after changing loadout mid-match, and its blasts
  (and thrown geese) now damage enemies and targets in single-player.
- Single-player Goose Horde waves now spawn around your respawn point, not your first spawn point.
- A shotgun blast plays one hit-confirm, not up to eight.
- The hotbar and weapon caption update when the Goose Launcher is granted or Gun Game upgrades you.
- The scope and zoom no longer stay up behind the pause menu and death screen.
- The mid-match Loadout page is only built when opened, instead of on every match start.

## v3.9.1

Three fixes from live playtesting of v3.9.0:

- High graphics quality no longer overexposes the scene - the sky environment-map fill was still
  bright enough (even after an earlier reduction) to lift every shadowed surface toward white and
  flatten contrast next to Medium; its intensity is halved again (0.4 -> 0.2).
- The weapon view model now compensates for the FOV setting - the hip/ADS positions were tuned at
  the old fixed 75° FOV, so wider FOVs rendered the gun smaller and visibly floating in front of
  the player instead of held. The offset now scales toward the camera by the FOV tangent ratio,
  keeping the gun's on-screen size and placement as tuned at any FOV. Weapons with a real ADS zoom
  are unaffected while aiming (their authored zoom FOV was already the ADS tuning baseline).
- The Loadout page's rotating character no longer clips against its frame's edges - the preview
  camera is pulled back (~20% smaller on screen); the frame itself is unchanged and the character's
  proportions/idle animation stay identical to in-match.

## v3.9.0

A full 9-phase fix/improvement pass following a comprehensive code review (`docs/CODE_REVIEW.md`),
covering multiplayer stability, enemy AI, Goose Horde balance, architecture, test coverage, design
consistency, new features, and repo hygiene.

**Multiplayer stability fixes:**
- Fixed a real bug where a relayed message's transport-level sender slot was used instead of its
  own embedded `senderSlot`, misattributing position/respawn/goose/score updates from a 3rd/4th
  player to the wrong opponent in 3+ player matches.
- Golden goose now auto-drops when its carrier disconnects, instead of vanishing with them.
- A guest's `Escape`/disconnect during matchmaking no longer corrupts the host's slot bookkeeping;
  disconnected slots are now reliably swept and reused instead of leaking.
- Slot allocation now reuses the lowest freed slot instead of allocating past the 4-player cap.
- Fixed a mode-briefing deadlock where a late-joining player could raise the "everyone ready"
  threshold past what remaining players could ever satisfy.
- Multiplayer Goose Horde now actually ends the match on a co-op win - previously only showed a
  cosmetic toast with no real match-end.
- Dead/eliminated players are no longer targeted by the horde.

**Enemy AI:** added threat perception (enemies react to nearby gunshots and nearby deaths, not just
direct line-of-sight), a fairer aim-error model (wider spread while a target is moving or just
acquired, narrowing the longer an enemy holds aim), and a light flinch response on taking damage -
aimed at reducing the "aimless bot" feel while staying balanced against the player.

**Goose Horde:** fixed flyers diving at their spawn point instead of the live player position, fixed
the horde targeting already-eliminated players, and widened the concurrent-goose cap so later waves
scale further before hitting the cap.

**Architecture:** `Game.ts` shrunk from 2,738 to 2,165 lines by extracting the network message
router (`MatchMessageRouter`), per-mode controllers (Goose Toss, King of the Hill, Gun Game),
`MultiplayerMatchState` (scoreboard/respawn/win-condition), and positional-audio/debug-API helpers
into their own modules.

**Test coverage:** unit tests grew from 66 to 132, adding coverage for weapon ammo/reserve/burst-fire
accounting, the win-condition scan, Horde-elimination convergence, `HordeGooseManager` wave
progression, road-network MST generation, and enemy patrol RNG determinism.

**Design consistency:** the dark tactical/chamfered/accent-green design system (previously only on
a few screens) is now applied consistently across the pause menu, settings, play setup, multiplayer
menu, main menu, and death screen, plus the full HUD (health bars, hotbar, kill feed, announcements,
scoreboard); added a "(you)" scoreboard label so identifying your own row doesn't rely on color
alone; added a `prefers-reduced-motion` guard; added small-viewport layout clamps for the
create-room and loadout screens; added keyboard focus-visible styling and Escape/Enter handling on
menus.

**New features:**
- FOV setting in Settings (previously hardcoded) - also fixed two related bugs found while wiring
  it in: weapon aim was silently overriding any FOV setting every frame, and mouse sensitivity
  scaling used a stale constant instead of the live setting.
- A minimal, privacy-light match-end telemetry beacon (mode, wave/kills, duration, version - no
  player-identifying data) via a new Cloudflare Pages Function.
- Lobby per-player "ready" check before Start Match is enabled.
- `hordeSyncRequest`, closing a gap where a player joining mid-Horde-match had no way to learn the
  current wave/live goose state.

**Repo hygiene:** removed the legacy Netlify hosting config and serverless function (hosting has
been on Cloudflare Pages since v3.0.0); deleted dead exports and a couple of small cleanups
(explicit `void` on a fire-and-forget call, a real `kill()` method instead of a magic-number
`takeDamage(0, -1)`, skipping the now-pointless `gooseSyncRequest` round trip in Horde mode).

## v3.8.1

Same-day fixes/adjustments to v3.8.0's Loadout system, per live feedback:

- Fixed the MP5 firing only one round instead of a 3-round burst - the follow-up rounds were
  routed through the same cooldown gate the opening shot uses to pace *between* bursts, which
  silently blocked them. Now uses a dedicated path that only checks reload/ammo.
- Loadout page: click to equip a weapon instead of dragging it.
- The character preview's circular rim is now a taller rectangle, sized to comfortably fit the
  whole spinning character.
- The equipped Primary/Secondary/Melee readout moved into its own column between the weapon list
  and the character, instead of overlaying the character's rim.
- The weapon list's scrollbar is hidden; a soft fade + chevron now hints when there's more to
  scroll to instead.

## v3.8.0

New Loadout system, replacing the old read-only Inventory panel: a dedicated full page (character
rotating inside a slotted rim, guns listed by category on the left) where players drag weapons into
Primary/Secondary/Melee slots to build their own loadout, which persists locally (same mechanism as
the saved username) and now actually drives which 3 weapons a player spawns with in Default, King
of the Hill, and Goose Horde - single-player and multiplayer alike. A "Loadout" button on the pause
menu lets a player change it mid-match for those same modes, taking effect on their next respawn
rather than instantly. Also new: a burst-fire SMG (MP5, 3 rounds per trigger pull) with its own
distinct procedural model, and a reworked Goose Launcher model (was one cylinder and one box, now a
proper multi-part shape) - see `docs/weapons-combat.md` and `docs/ui-lobby.md` for the full detail
on both.

## v3.7.0

New pre-match mode-briefing screen, per explicit user request: every mode except Default (both
single-player Goose Horde and every multiplayer mode) now shows a 3-4 step explanation of that
mode's rules before the match actually goes live, using a small reusable set of geometric icons
(no sourced screenshots - matches this project's existing "procedural, no external assets for
non-hero elements" precedent) styled to the game's own dark/chamfered/accent-green identity. In
multiplayer, every connected player must individually click Skip - the live "N/M ready" count
shows right on the button itself - before the briefing disappears for anyone; in single-player it
dismisses on the first click, since there's nobody else to wait on. While any player's briefing is
up, `Game.update()`'s new `worldBriefingActive` gate freezes all simulation the same way a finished
match does - no enemy/goose AI, no wave spawner, nothing moves - so the world is only ever truly
"live" once every player has actually entered it. A late join/rejoin mid-match (see
`MultiplayerSession.showModeExplanation`) never shows this screen - only a genuinely fresh match
start or rematch does, since re-gating an already-running match for everyone else would be a
regression, not a feature.

## v3.6.0

- Fixed multiplayer Goose Horde's guest wave counter never updating: `HordeGooseManager.
  currentWave` derived from `waveIndex`, which a follower (guest) client never advances - it now
  mirrors the host's wave number instead, driven by the same `hordeWaveStarted`/`hordeReset`
  broadcasts that already drive the wave-incoming toast.
- Fixed multiplayer Goose Horde never actually ending after every player exhausted their 2
  respawns, letting waves continue indefinitely: a permanently-eliminated player's client stops
  broadcasting `playerSnapshot` (by design, it's done playing), which within
  `MULTIPLAYER_CONNECTION_TIMEOUT_MS` tripped the host's stale-connection sweep into treating that
  silence as a dropped connection - force-removing them from the opponent roster and desyncing the
  "how many total players" count every client uses to detect "everyone's out." Eliminated slots are
  now excluded from that sweep.
- The bonus "golden goose" (the ambient wandering goose that grants the Goose Launcher) is now
  restricted to the default game mode only - previously it spawned in every mode except Goose Toss
  and Goose Horde.
- New Gun Game-specific golden goose variant: whoever is exactly one kill from that match's win
  threshold is forced onto the Goose Launcher and must land the winning kill with it - re-granted
  automatically if they empty its 4 shots without scoring and fall back to their previous gun.

## v3.5.1

- Fixed a real regression from v3.5.0: multiplayer Goose Horde was still resetting wave progress
  to wave 1 on every ordinary death, same as before the limited-respawns/lives system was added -
  which made that system pointless, since a respawn (even with lives left) wiped the run anyway.
  An ordinary respawn now just returns the player to the current wave; only single-player, which
  has no lives system, still resets to wave 1 on death.

## v3.5.0

Multiplayer Goose Horde overhaul, per explicit user request:

- **Harder, longer**: multiplayer now runs its own 15-wave table, noticeably steeper than
  single-player's 10-wave one at every comparable wave (higher starting counts, faster speed ramp,
  jumpers/flyers introduced earlier) - a co-op squad can bring more firepower to bear than a single
  player, so it needed to actually feel that way.
- **Always-visible wave counter**: a persistent "Wave X / Y" indicator, single-player and
  multiplayer alike, instead of only the fading spawn toast.
- **Limited lives**: each player gets 2 respawns (3 lives total) before being permanently
  eliminated for the rest of the run; once every currently-connected player is eliminated, the
  whole co-op run ends in a loss.
- **No accidental co-op scoring**: friendly fire (or any player-vs-player death) no longer awards
  points or a free heal in this mode - there's no kill-limit win condition here anyway, and
  rewarding a teammate's death was never the intent.
- **Limited ammo + ammo drops**: multiplayer Horde weapons now carry a finite reserve beyond their
  first magazine (reloads draw from it instead of refilling for free) instead of the unlimited
  reloads every other mode keeps. Green ammo crates spawn near players (never more than 3 at once,
  slow-ish cadence), auto-collected by walking over one, refilling whatever weapon is currently
  held - shown on both players' minimaps as green dots.

## v3.4.4

- Multiplayer Goose Horde co-op now matches single-player: any player's death immediately restarts
  the whole run from wave 1 for everyone (host-authoritative, broadcast so every client clears its
  own view of the current flock rather than waiting for stray geese to be cleaned up one at a
  time). Previously multiplayer just respawned the fallen player and kept the run going.

## v3.4.3

Goose Horde cleanup pass, per user request:

- Single-player Horde no longer spawns the regular enemy/target roster (was already correct, but
  re-verified alongside this batch since it's the same "only the wave attacks you" premise).
- Single-player Horde now spawns the player at a random point on the map instead of the fixed
  single-player spawn ("not the middle") - both at match start and every time `resetPlay()` runs
  (the death screen's Respawn button/pause menu's Reset Play).
- Neither the ambient wandering goose flock nor the bonus golden goose spawn during Goose Horde
  anymore, single-player or multiplayer - "only the waves" now holds in both.
- Dying in single-player Horde now restarts the whole challenge from wave 1 (clearing any
  in-progress wave immediately) instead of continuing wherever the run left off.

## v3.4.2

- Widened the lobby Inventory panel into two side-by-side columns (4 weapons on the left, the rest
  on the right) instead of one long vertical list requiring scrolling - same widen-not-lengthen
  fix already applied to CreateRoomScreen earlier, per user request.

## v3.4.1

- The Goose Launcher wasn't visually distinguished from a normal loadout weapon in the lobby
  Inventory screen. Added a gold rim/glow and a "★ REWARD WEAPON" badge to its card so it reads as
  something earned, not picked. Also removed Goose Toss's zero-damage/no-model 'unarmed'
  placeholder from the Inventory list entirely (it was rendering as an empty card with nothing to
  show - it was never meant to be a real showcased weapon).
- The bonus golden goose's gold tint was applying to every material on its mesh, including its
  black eyes, so at a glance it could read as a featureless gold blob rather than a recognizable
  bird. Eyes now stay dark; everything else (body, wings, beak, legs) is gold.

## v3.4.0

- Added the bonus "golden goose" - single-player and multiplayer alike, every mode except Goose
  Toss (whose unarmed loadout has no way to shoot it). Exactly one lives on the map at a time,
  spawning at a random point after a random delay, with a big center-screen banner announcing it.
  It still takes 2 hits to kill like any wandering goose, but doesn't explode or deal damage on
  death - instead, whoever lands the FINAL hit is instantly equipped with a new weapon: the Goose
  Launcher. In multiplayer, hit attribution is tracked properly even when two different players
  land the two hits - only the second (killing) shot's player gets the reward.
- Added the Goose Launcher: a real ballistic weapon (not instant hitscan) that fires exploding
  geese, reusing the same flight/explosion machinery Goose Toss's pickup-and-throw already proved
  out. Exactly 4 shots, no reload - once empty, it automatically disappears and whatever weapon was
  equipped before returns. Deliberately powerful (a near-guaranteed kill within its blast radius),
  since it's a rare, hard-earned, strictly limited reward. Kills with it count toward the shooter's
  score in multiplayer through the normal damage/kill-credit pipeline, exactly like a Goose Toss
  throw - but (per explicit design intent) dying to an ordinary wandering goose on the field still
  never counts, unchanged.

## v3.3.1

- Fixed a real bug: switching weapons (scroll wheel or number key) could fire an unintended,
  ammo-costing shot on the newly-drawn weapon with no actual button press. Root cause: the
  switch-in-progress flag flips false the same tick its holster/draw animation finishes, and fire
  was checked again immediately afterward that same tick - if the player was still holding the
  fire button from before the switch (e.g. scrolling weapons while the mouse button is still down
  from the previous one), an automatic weapon's "is fire held" check read true with no fresh press
  at all. Weapon switches (and Gun Game's kill-upgrade) now lock fire on the new weapon until the
  button is actually released.
- Fixed invisible, disruptive collision around houses - the collider was sized from the house
  model's raw bounding box, which includes roof eaves/overhangs extending past the walls a player
  actually perceives as "the house," so both movement and bullets were blocked by empty-looking air
  a short distance past the visible structure. Shrunk the collider footprint 15% so it sits inside
  the walls instead of at the outermost roof edge. (Watch towers were audited too - their colliders
  already match their visual geometry exactly, no equivalent fix needed there.)
- Shotgun rebalance per user feedback ("not great"): damage per pellet raised 10 → 13 (max per-shot
  damage 80 → 104, now capable of a point-blank one-shot kill where most/all 8 pellets land, still
  situational at range where only a fraction connect) and reload time cut 2.6s → 1.8s (previously
  the slowest reload of any weapon, compounding on top of the already-low 6-round magazine and
  short effective range for no real balance reason).

## v3.3.0

Four new features landed together as one batch - minor bump (new modes/mechanics, not a bug fix).

- **Explosion knockback**: every goose explosion (Goose Toss throws, a wandering goose's own
  death, and Goose Horde's contact explosions below) now physically pushes nearby players back,
  with strength falling off linearly by distance like damage already does. The player controller
  is a kinematic capsule with no dynamic-body physics to lean on, so this is a manually-decaying
  knockback velocity layered on top of normal movement (`Player.applyKnockback`), not a real
  Rapier impulse - same shape as how recoil already layers a temporary camera kick on top of aim.
- **Match weather** (multiplayer host setting, Day/Night/Fog): purely cosmetic/atmospheric, picked
  alongside kill limit/goose difficulty/game mode. Night dims and cools the sun, hides the
  procedural Sky mesh in favor of a flat dark background (the Sky shader has no day/night uniform
  to swap), and raises ambient fill so it stays playable. Fog swaps in a second, much denser
  `FogExp2` - deliberately not a retune of the existing distance-culling fog, which is tuned for a
  different job (concealing the world edge, not atmosphere).
- **King of the Hill mode** (multiplayer): players spawn with the full arsenal, equidistant from a
  golden goose at the map's exact center (the same ring `pickMultiplayerSpawnPoints` already
  builds around that point). Picking it up (E) locks out firing - not reloading, aiming, or
  switching - until it's dropped with the fire button or the carrier dies, at which point it's
  left at that spot for anyone to grab. Holding it scores 1 point/second, shown as a live point bar
  on the HUD (first to 90 wins).
- **Goose Horde mode** (single-player toggle + multiplayer co-op): 10 progressively harder waves of
  aggressive geese that chase the player(s) down and explode on contact instead of wandering
  passively. Each wave escalates count, chase speed, and the mix of three flavors - plain walkers,
  "jumpers" that burst into a fast lunge within close range, and "flyers" that dive straight down
  from the sky - climaxing at wave 10 (30 geese, double base speed, 60%/40% jumper/flyer mix). A
  horde goose dies in exactly one hit from any weapon, unlike the normal wandering goose's two.
  Multiplayer reuses the same host-authoritative spawn/snapshot/hit/explode pattern already proven
  for Goose Toss's ambient flock, so every player sees the same geese in the same place.

## v3.2.2

- Fixed a real multiplayer bug: a guest whose connection dropped could leave a permanently stuck
  RemotePlayer standing in the match, un-killable and un-removable, because the host relied
  entirely on the browser's own WebRTC disconnect detection, which doesn't always fire promptly
  (or at all) for an abrupt tab close. The host now also tracks each opponent's last received
  message and proactively treats prolonged silence as a disconnect.
- Fixed `HostRoster.sweepExpiredReservations`'s return value being silently discarded, meaning a
  fully-expired rejoin reservation never broadcast final cleanup.

## v3.2.1

- Fixed the knife's inventory thumbnail rendering blank - it has no sourced `.glb` model (built
  procedurally, like the lobby goose), and the thumbnail renderer only handled loaded GLTF models.

## v3.2.0

- Multiplayer kill limit is now a free number input (1-100) instead of a fixed 10/15/25 preset
  list, in both the room-creation screen and the post-match rematch panel.

## v3.1.0

- Fixed multiplayer opponent gunshots all sounding like the same generic noise regardless of
  weapon - the network message was sending the weapon's display name instead of its internal id.
- Added a "Respawn" button to the multiplayer pause menu - an unstuck escape hatch for a player
  spawned inside geometry. Gated behind 5 continuous seconds of the pause menu being open (closing
  it resets the timer) so it can't be used to instantly escape a losing fight, and deliberately
  doesn't touch health/ammo/score.

## v3.0.0 - Rename to Hunter 'n Goose, migrate off Netlify

- Renamed the game (main menu title, browser tab, README) from "FPS Game"/"Goose-Buster" to
  **Hunter 'n Goose**.
- Migrated hosting from Netlify (ran out of free build credit) to Cloudflare Pages, including
  porting the TURN-credential serverless function to Cloudflare's Pages Functions format and
  fixing a `package-lock.json`/`npm ci` mismatch along the way.
- Added a wandering decorative goose (same mesh as the in-match one) to the lobby scene, walking a
  continuous loop around the character.
- `docs/NOTES.md`'s single 2500+ line chronological log split into one file per system
  (world-generation, enemy-ai, weapons-combat, multiplayer, goose-buster, ui-lobby, performance,
  changelog-foundations) plus a proper `README.md`.
- UI fixes from live playtesting: illegible white-on-white dropdown option lists (missing
  `color-scheme:dark`), a match that opened on the pause menu instead of already playable, and the
  Create Room screen requiring scrolling (widened + reorganized into two columns).

## v2.3.0 - Post-launch playtest batch

- Root-caused and fixed a severe bug where returning to the lobby after a multiplayer match could
  leave the page permanently broken until reload (a Rapier WASM double-dispose crash).
- Added a "Nuke" goose explosion difficulty tier (near-guaranteed instant death) and rebalanced the
  other three tiers.
- Added four multiplayer game modes, host-picked pre-match: 1 Shot 1 Kill, Sniper Duel, Gun Game,
  Knife Only.
- Multiplayer opponent gunshots given their own, more generous audio falloff range so close-range
  fights sound as loud as they should; added networked footstep sounds.
- A motion/animation pass across every lobby and HUD screen (panel entrance sweeps, podium
  stagger, HUD hit-flash, minimap pulse), replacing what had been a completely static UI.

## v2.2.0 - Goose-Buster mini-game

- Added the exploding goose mini-game: a wandering NPC that takes exactly 2 hits to kill, then
  explodes with distance-based falloff damage. Spawns at match start and again whenever a player
  dies. Host picks an explosion difficulty (Easy/Normal/Extreme) for multiplayer.
- Host-authoritative multiplayer sync for the goose (the first networked NPC this project had),
  plus playtest fixes: guests missing the initial goose spawn, the pause menu freezing the
  simulation in multiplayer, and a real performance bug (uncached expensive terrain-height sampling
  per goose per frame).
- Denser world generation; the old crate-stack roof-climb exploit removed entirely.

## v2.1.0 - Multiplayer polish and 4-player lobbies

- Extended multiplayer from strictly 1v1 to host-relay star-topology lobbies of up to 4 players,
  with mid-match rejoin support.
- Fixed a multiplayer opponent skin bug and a pause-menu invincibility exploit.
- Added a TURN server fallback (via a serverless proxy) so players behind stricter NATs can
  actually connect to each other.
- Added standalone watch towers, real usernames, a podium match-end screen, and positional gunshot
  audio.
- Tightened the map for closer-range engagements; random (not fixed) multiplayer spawn points.

## v2.0.0 - Multiplayer

- Multiplayer introduced: room-code connection layer over WebRTC (PeerJS), shared world/movement
  sync, combat sync (damage/death/respawn/scoring), win condition, match-end screen, and rematch.

## v1.5.0 - Lobby redesign, performance tooling, visual realism

- Redesigned the lobby UI with a tactical-shooter visual language (dark theme, chamfered panels,
  accent green, Chakra Petch display font) instead of a generic dark web-app look.
- Added an in-game FPS overlay and a local performance-check script/doc, since this project's own
  dev sandbox renders via software GPU and can't answer real performance questions itself.
- A visual realism pass: shadows, image-based lighting, PBR terrain, muzzle flash, a proper death
  sequence, weapon motion, plus a Graphics Quality setting (Low/Medium/High) applied live.
- Long-shot hit callouts (50m+); tree canopies now actually stop bullets via sensor colliders.

## v1.4.0 - Enemy AI overhaul

- A full enemy AI rework across five phases: goal-directed patrol, aggro/line-of-sight state
  transitions (idle/alert/chase/search), fair ranged combat, a player knife weapon plus an
  upgraded universal enemy melee fallback, and measurement-driven combat tuning.
- Per-archetype enemy loadouts (kiter/rusher/generalist), each with distinct behavior.

## v1.3.0 - World generation systems

- Deterministic zone-based world generation: towns and forests placed per-seed, guaranteed minimum
  counts, roads connecting town buildings, ladder climbing.
- Random per-match world seed; denser forests/towns; larger inventory previews.

## v1.2.0 - Pre-match lobby, world bounds, vegetation and buildings

- A real pre-match lobby: match settings, an inventory showcase, configurable enemy/target counts.
- World bounds, ground texture, sky shader, and fog; instanced vegetation (trees, bushes, rocks);
  non-enterable buildings from a modular Kenney kit.
- Fixed the respawn/death flow, added a Return to Lobby option, auto-reload, and real weapon sound
  effects (several of which had been swapped/mislabeled).

## v1.1.0 - Content pass and real assets

- Real CC0 weapon/enemy/target assets in place of placeholder geometry.
- Hotbar, per-weapon visuals, visible tracers, player health/death, enemies that fight back, hit
  confirmation, a reload visual cue, and a practice-reset (T key) for fresh entities/ammo/health.
- The first Playwright e2e suite, which immediately caught a critical player self-hit bug.

## v1.0.0 - Initial single-player FPS

- The foundational build, phase by phase: pointer-lock free-fly camera, Rapier physics with a
  grounded player controller, procedural terrain, chunk-streamed open world, the first hitscan
  weapon, aim-down-sights/scope, weapon switching, and shootable targets/enemies.
