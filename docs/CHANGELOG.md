# Changelog

Version shown in the main menu (bottom-right, see `src/core/version.ts`) is derived from this
history. **Scheme (semver-ish):**
- **Major** - a genuine identity or architecture shift (multiplayer's introduction, the rename +
  hosting migration).
- **Minor** - a new feature or game mode.
- **Patch** - a bug fix or small tweak.

Grouped by release-worthy chunks of work, not one entry per commit - see `git log` for the full,
granular history if you need it.

## v3.3.1 (current)

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
