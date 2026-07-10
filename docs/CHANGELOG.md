# Changelog

Version shown in the main menu (bottom-right, see `src/core/version.ts`) is derived from this
history. **Scheme (semver-ish):**
- **Major** - a genuine identity or architecture shift (multiplayer's introduction, the rename +
  hosting migration).
- **Minor** - a new feature or game mode.
- **Patch** - a bug fix or small tweak.

Grouped by release-worthy chunks of work, not one entry per commit - see `git log` for the full,
granular history if you need it.

## v3.7.0 (current)

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
