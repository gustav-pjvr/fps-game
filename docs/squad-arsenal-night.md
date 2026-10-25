# Squad, arsenal and night: the v4.4 to v4.6 program

Gustav, 2026-10-25: "Go full out on 1; 2: grenades (flash and normal), doors, switches, pickups;
3: controller support, 3 to 4 player support (high priority)." Group 1 was: darkness matters to
enemies, more modes on the Facility, the torch on the Valley at night, enterable buildings on the
Valley.

Three releases, each merged, reviewed (one independent Opus audit plus one re-check) and deployed
before the next is called done. Work inside a release runs in parallel on separate branches.

| Release | Contents |
|---|---|
| v4.4.0 "Squad" | 3 to 4 player fixes, direct guest-to-guest links, a 4-player browser test; controller support |
| v4.5.0 "Arsenal" | frag and flash grenades; Facility doors and breaker switches; health, ammo and grenade pickups |
| v4.6.0 "Night" | darkness-aware enemy sight; every mode on the Facility; the torch on the Valley at night; enterable Valley buildings |

Rules for every part: no em or en dashes in code, comments or docs; match the surrounding style
(comment density, naming); unit tests at the contracts; new e2e specs registered in
`scripts/e2eGroups.mjs` and `docs/testing.md`; run only the e2e groups a change affects, never the
full suite; keep `npm run build` (typecheck) green. Network additions follow the existing protocol
style in `src/network/protocol.ts` and are validated in `isNetworkMessage`.

---

## 1. v4.4.0: 3 to 4 players

The room already holds 4 (host-relay star, `MULTIPLAYER_MAX_PLAYERS = 4`), and scores, HUD rows,
minimap dots and the podium are slot-keyed. A Codex survey (2026-10-25) found these gaps that only
show with three or more players. Verify each before fixing; fix the root cause; add a unit test per
fix where the logic is testable.

1. **Late joiner resync is incomplete.** A third or fourth player joining mid-match does not get:
   the King of the Hill carrier or dropped golden goose position (Game.ts ~1194, ~1617); the Horde
   eliminated-slot set (MatchMessageRouter ~437; they can wait forever for teammates to be
   eliminated again); live thrown geese, bonus geese, Goose Horde ammo drops, and a finished Horde
   result (MatchMessageRouter ~284, ~436). Every piece of shared match state must reach a late
   joiner.
2. **Concurrent joins race** (Game.ts ~1598, ~1609, PeerConnection ~238): the roster is snapshotted
   before awaiting player creation, so one joiner can miss another's announcement.
3. **Ghost player** (Game.ts ~3060, ~3083): an async player addition that finishes after
   `playerLeft` creates an opponent that never goes away.
4. **Scoreboard** (Game.ts ~1489, multiplayerHud ~132, ~153): zero-score players have no row, and a
   kept score loses its name when the health row is removed.
5. **King of the Hill drop race** (MatchMessageRouter ~369, KingOfTheHillController ~53): a delayed
   drop from one claimant can clear another claimant's ownership after the tie-break, so carriers
   diverge between players.
6. **Gun Game finisher bypass** (GunGameController ~43, Game.ts ~2605): two kills before the next
   grant check can jump past the launcher finisher.
7. **Guest ping to other guests** (connectionStats ~59) is estimated as twice the host link. With
   direct links (below) measure it.

### 1.1 Direct guest-to-guest links

Today guest A's position reaches guest B through the host: two hops, and through the host's
upload. Add direct links between guests for the latency-sensitive cosmetic traffic only:

- The roster (welcome, rosterUpdate, matchStart, playerJoinedMatch) carries each guest's PeerJS id.
- For each pair of guests, the lower slot dials the higher slot. Hello on a guest link is a small
  `meshHello { slot, roomCode }` so a stray connection is refused. The link opens the same fast
  channel as host links (`fastChannel.ts`).
- On a direct link a guest sends: `playerSnapshot`, `fireEvent`, `footstepEvent`. Everything else
  (damage, deaths, respawns, mode state, world objects) stays on the host path, so authority and
  ordering do not change.
- Correctness does not depend on the link: receivers already drop snapshots older than the newest
  applied (sender clock `t`). A guest reports its live direct links to the host (`meshStatus
  { linked: PlayerSlot[] }` on change); the host stops relaying those three message types between
  a linked pair and resumes the moment either side reports the link gone. If the direct link never
  opens (strict NAT), nothing changes from today.
- The HUD ping line shows a measured round trip per opponent (direct link stats when linked,
  otherwise host link plus the host's reported link to that guest).
- The TURN relay settings that host links use apply to guest links too.

### 1.2 Four-player browser test

`e2e/multiplayer-four.spec.ts` (group `mp4`, not in quick): host plus three guests in four browser
contexts. Checks: everyone sees three opponents; a guest-to-guest hit registers on the target and
the kill on every scoreboard; direct links report ready (`getNetworkDebug()` gains
`directLinksReady`); one guest leaves and rejoins and comes back with the right score; a fourth
player joining mid-match gets the full match state. SwiftShader is slow with four contexts: give it
generous timeouts, and keep it out of every group except its own.

## 2. v4.4.0: controller support

Standard-mapping gamepads through the Gamepad API (Xbox and PlayStation names in brackets).

- **New `src/input/GamepadInput.ts`**, polled once per frame by `InputManager.update()` (new). It
  feeds the same action sets as the keyboard, plus two analog values:
  - `InputManager.getMoveVector(): { x, y }` (length at most 1): keys give unit directions, the left
    stick gives its value after a radial dead zone of 0.15 rescaled to 0..1. `Player.applyMovement`
    uses it so a half-pushed stick walks at half speed.
  - Look: the right stick, dead zone 0.12, response curve `v * |v|` (squared, sign kept), turned
    into a look rate (default 220 degrees per second yaw, 150 pitch, scaled by a new controller
    sensitivity setting) and added to `consumeLookDelta` in the units mouse deltas use, so
    `Player.applyLook`'s zoom scaling applies unchanged.
- **Mapping.** Left stick move, L3 sprint (stays on while moving forward), right stick look, RT
  (R2) fire, LT (L2) aim, A (Cross) jump, X (Square) reload, B (Circle) interact, Y (Triangle) next
  weapon, D-pad left and right previous and next weapon, D-pad up torch, RB (R1) frag grenade and
  LB (L1) flash grenade (wired once grenades land in v4.5.0; until then unbound), Start (Options)
  pause, View (Share) reset match where `resetPlay` applies.
- **Playing without pointer lock.** The game pauses whenever pointer lock is lost. With a pad, a
  player must be able to play without it: `InputManager.isEngaged` is true when pointer lock is
  held or a gamepad is the active device and the pause menu is closed. Every `isLocked` check that
  means "the player is playing" uses `isEngaged`. Start toggles the pause menu. Moving the mouse or
  pressing a key makes keyboard and mouse the active device again.
- **Menus.** With a pad, every menu and screen (main menu, play setup, lobby screens, settings,
  pause, death, match end) is navigable: D-pad or left stick moves focus to the nearest focusable
  element in that direction (spatial navigation over visible buttons, selects, sliders and inputs),
  A activates, B goes back (the same as Escape), left and right change a focused select or slider.
  The focus ring must be clearly visible.
- **Prompts.** On-screen hints that name a key ("Press E", "F torch", the death screen) show the pad
  button when the pad is the active device.
- **Aim assist**, solo and multiplayer, setting on by default: look speed slows to 55 percent while
  the crosshair is over an enemy or opponent within 60 m (slowdown only, no pull). Pads only.
- **Vibration** (setting, on): a short pulse on firing (weaker for automatics), a stronger one on
  taking damage and on an explosion within 10 m, through `vibrationActuator.playEffect` when the pad
  has one.
- **Settings panel:** controller sensitivity (0.3 to 3), invert Y, aim assist, vibration, and a
  read-only list of the mapping.
- Tests: unit tests for dead zone, response curve, move vector merge, spatial focus selection (pure
  function over rectangles), active-device switching. No e2e needs a real pad; an e2e may inject a
  fake `navigator.getGamepads`.

---

## 3. v4.5.0: grenades

Two thrown items carried beside the guns (not weapon slots): **frag** and **flash**.

- **Carry:** 2 of each at spawn and on respawn, at most 3. HUD shows both counts beside the ammo.
- **Input:** G frag, Q flash (rebindable; pad RB and LB). Press and hold to cook: an arc preview
  (dotted line and a landing ring) shows while held; release throws. A tap throws at once. You
  cannot throw while reloading or during the knife swing; throwing lowers the gun briefly
  (0.45 s) with a throw animation on the view model (arm and grenade).
- **Flight:** speed 17 m/s along the aim, plus the player's velocity, gravity as the game's.
  A sphere of radius 0.07 m swept against the physics world (Rapier shape cast) each step; bounce
  with restitution 0.35 and tangential friction 0.6; it rolls to rest. Fuse: frag 3.0 s, flash
  1.6 s, counted from the moment cooking started (cooking past the fuse detonates in hand).
- **Authority:** like the Goose Launcher, the thrower is authoritative. `grenadeThrown { id, kind,
  origin, velocity, fuseLeft, t }` lets every client fly a copy for visuals; the thrower's copy
  decides the detonation point and sends `grenadeDetonated { id, kind, position }`; receivers move
  their copy there and play the effect. Damage to others travels as `damageEvent` (weapon id
  `frag`), kills credited to the thrower. Live grenades are part of late-joiner resync.
- **Frag:** radius 7 m; damage 130 within 1.5 m, falling linearly to 0 at 7 m; blocked by walls
  (a ray from the blast to the target's chest and head; if both are blocked, no damage). Damages
  the thrower, enemies and opponents. Knockback as the launcher. Shoots out every Facility lamp
  within 4 m (through the lamp sync path). Effect: the existing explosion plus a dust ring and
  sparks; camera shake falling off over 15 m; loud positional sound that enemies hear.
- **Flash:** no damage. Each client judges its own player: if the flash has line of sight to the
  eye, strength = distance factor (1 within 5 m, 0 at 22 m) times facing factor (1 looking at it,
  0.45 at 90 degrees, 0.15 behind). Strength above 0.1 whites out the screen for up to 3.5 s
  (scaled) then fades, and muffles game audio under a ringing tone for as long. Enemies with line
  of sight in range are blinded the same way: they lose their target and awareness, stagger and
  fire wide for up to 4 s (scaled). The flash also lights its surroundings for 0.15 s (a bright
  point light), so it briefly shows a dark room. Enemies hear it.
- **Danger marker:** a live frag within 8 m of the player shows a small grenade marker at its
  direction on screen.
- **Modes:** grenades on in Default, Elimination, Director, Horde, Goose Horde, Mission and King of
  the Hill; off in Knife Only, Gun Game, Sniper Duel, 1 Shot 1 Kill and Goose Toss. One table in
  `gameModes.ts`.
- **Enemies** do not throw grenades in this release.

## 4. v4.5.0: Facility doors and breaker switches

- **Doors.** Doorway cells (`layout.doorways`) are merged into openings (adjacent cells, same axis,
  same room). About 60 percent of openings get a door, chosen from the seed; dark rooms' doors are
  always doors and start closed; all other doors start open. A door is two steel leaves that slide
  into the wall in 0.6 s, matching the Facility's look (painted steel, a hazard stripe, a small
  status lamp: green open, red closed). Interact (E, pad B) within 2.2 m while looking at it
  toggles it. A closed door is a collider (blocks players, bullets and grenades) and blocks sight
  for enemy line of sight. The bake is not recomputed for doors.
- **Enemies** path through closed doors: the flow field counts a closed door cell as passable at
  extra cost; an enemy that reaches a closed door stops for 0.8 s and opens it (the same toggle,
  synced). They do not close doors.
- **Breaker switches.** Rooms are split into power zones: 4 to 6 zones from the seed (rooms grouped
  by position; corridor lamps join the nearest room's zone). Each zone has one breaker panel on a
  wall inside the zone, never in the atrium, at shoulder height, with a lever and a red or green
  lamp. Interact flips it. Off: every panel lamp in the zone goes dark (the existing per-lamp
  darken and queued rebake); emergency lamps stay lit (they are on battery). On: every lamp in the
  zone that was not shot out relights, through a matching queued rebake that adds the lamp back.
  A lamp shot out stays dead regardless of its breaker. Breakers start on.
- **Minimap:** closed doors as short bars; breaker panels as a small icon once seen.
- **Sound:** door slide, breaker clunk and power-down hum, positional.
- **Sync (multiplayer):** host-authoritative. A guest sends `worldInteract { kind: 'door' |
  'breaker', id }`; the host applies it if valid and broadcasts `worldObjectState { doors, breakers }`
  (compact arrays or bit strings); welcome and late-joiner resync carry it. Solo applies locally.
  Shot-out lamps and powered-off lamps are tracked separately so each restores correctly.

## 5. v4.5.0: pickups

- **Kinds:** health pack (+40 health, up to 100), ammo box (one magazine to every gun's reserve),
  grenade crate (+1 frag, +1 flash, up to the cap). Walk-over pickup within 1.4 m; skipped if it
  would give nothing (full health, full ammo, full grenades).
- **Placement** from the match seed: Facility: one pickup per room on average, never in the
  player start room, against a wall, mix about 45 percent health, 40 ammo, 15 grenade; Valley:
  beside buildings and at the foot of watch towers, about 16 per map. Not in Knife Only (health
  only there) and no grenade crates where grenades are off.
- **Respawn:** health 30 s, ammo 25 s, grenades 45 s. A taken pickup shows a faint ring until it
  returns.
- **Look:** a small floating, slowly turning model (red cross case, olive ammo box, grenade crate)
  over a soft glowing ring in the HUD accent colours; minimap icon within 25 m.
- **Sync:** host-authoritative. A guest sends `pickupClaim { id }`; the host grants the first claim
  and broadcasts `pickupTaken { id, slot, respawnAt }`; the claimant applies the effect when it
  receives its own grant. The host's own claims apply at once. Respawns are driven by the host
  (`pickupRespawned { id }`), and resync carries the full state. Goose Horde's existing ammo drops
  stay as they are.

---

## 6. v4.6.0: darkness-aware enemy sight

- `visibility` of the player, 0.2 to 1, computed once per frame:
  - Facility: the light at the player from the bake's probes (the same probe that lights moving
    things), mapped so a lit room is 1 and an unlit room about 0.25.
  - Valley: by weather and time: day 1, fog 0.75, night 0.4; inside an enterable building at night
    0.3 unless its lamp is on.
  - Raised to 1 for 0.6 s after the player fires (muzzle flash), and for an enemy inside the torch
    beam (within 28 m and 25 degrees of the aim), the torch counts as fully lighting the player.
  - A flash grenade's light raises everything nearby to 1 for its 0.15 s.
- Enemy sight range is `detectionRange * visibility`, and the awareness fill rate scales with
  visibility (EnemyBrain ~319 to ~356, perception.ts ~37 to ~60). Hearing is unchanged.
- **HUD:** a small light meter (an eye glyph that brightens) beside health, shown on the Facility
  and at night.

## 7. v4.6.0: every mode on the Facility

Remove the Facility gates in `gameModes.ts` for Goose Toss, King of the Hill, Goose Horde, Horde
and Mission, with Facility versions of what each needs (survey 2026-10-25):

- **Goose Toss:** ambient pickups on walkable floor cells, clear of walls and crates.
- **King of the Hill:** the golden goose starts at the atrium centre.
- **Horde and Goose Horde:** spawn points from floor cells in rooms far from every player; flying
  geese fly below the local ceiling (clamped to ceiling minus 0.6 m) and enter through rooms, not
  from the sky.
- **Mission:** four objectives in four rooms in different quadrants, far from the start, using the
  existing mission state with indoor beacons (a console with a beacon light) instead of towers.

## 8. v4.6.0: the torch on the Valley at night

The torch, its F toggle and remote torches work on the Valley in Night and Fog weather (on by
default at Night, off in Fog); in Day it stays unavailable as now.

## 9. v4.6.0: enterable Valley buildings

All three house designs become enterable:

- A real doorway in place of the steel door panel, with the Facility door from section 4 (sliding
  steel, interact to open, synced, enemies open it).
- Interiors: walls with thickness, a floor, ceiling, one or two rooms per design, simple furniture
  as cover (crates, a table, shelves, a bunk) from the Facility's look kit; the two-storey block
  gets a stair to an upper floor with a window over the street. Window openings are real openings
  (shoot through, see through), with frames.
- Light: interiors are dark by day except for the window light and one ceiling lamp per room that
  is on at night (a real light only for the nearest 4 lit interiors to the camera; the others use
  an emissive panel); it can be shot out (synced like Facility lamps).
- Enemies use doors: a small walk grid per building (the Facility's nav ideas); an enemy whose
  target is inside goes to the door first. Cover points inside.
- Spawns never inside a building. The minimap draws building interiors once entered.
- Performance: interiors are merged geometry per building, culled by distance like the exteriors.
