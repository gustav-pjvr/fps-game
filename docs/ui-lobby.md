# UI & Lobby

Development notes for the lobby redesign, death screen, and motion/UI polish pass, extracted from the original NOTES.md.

## Lobby redesign (2026-07-05)

The lobby (main menu, match setup, settings, inventory) read as a generic dark web-app overlay:
plain rounded-rect panels, a bobbing character dead-center competing with a stacked button rail,
one accent color with no other visual system tying things together. Redesigned it grounded in real
shipped tactical-shooter lobbies (Valorant, Apex Legends, CS2 - researched via web search rather
than guessed) rather than a generic template.

**Design.** One consistent signature shape (a chamfered/cut corner, via CSS `clip-path`, replacing
every rounded corner in the old design) applied to every panel and button - `chamferClipPath()` in
`menuStyles.ts`, alternating which corner is cut so panels don't all lean the same direction. A
condensed display face (`Chakra Petch`, loaded via Google Fonts in `index.html` - this codebase had
no custom font infrastructure before this) for titles/buttons/eyebrow labels, against `Inter` for
body/data text - the first real typographic system this UI has had, replacing plain `system-ui`
everywhere. Same near-black + single green accent palette as before (kept for brand continuity,
just applied more deliberately), with a cool steel-gray added for secondary/label text.

**Layout.** Deliberately asymmetric rather than centered: the lobby character (`LobbyScene.ts`) now
sits left-of-frame (`CHARACTER_OFFSET_X`) instead of dead-center, with a soft accent-tinted ground
glow (a radial-gradient canvas texture, not a flat-color circle - a flat circle read as a hard-edged
puddle, confirmed via screenshot before switching to a gradient) giving it presence. This opens the
right side of the screen for the action rail without visual competition, and lets the title/eyebrow
live top-left near the character rather than fighting for center-screen space. Four corner brackets
(faint L-shaped marks, `createCornerBracket()`) frame the screen like a tactical HUD viewfinder - a
cheap, purely atmospheric touch. A thin vertical divider ties the left (identity) and right (action)
halves together.

**One genuinely diegetic touch, not decoration:** a "DEFAULT DEPLOYMENT" readout bottom-left shows
the *real* `DEFAULT_ENEMY_COUNT`/`DEFAULT_TARGET_COUNT` a match will actually spawn with (editable
in the existing Match Setup modal) - not a fabricated stat. Considered showing the current world
seed here too, but the seed doesn't exist yet at the main-menu stage (`randomizeWorldSeed()` only
runs when a match actually starts) - would have been fake data, so left out.

**Verification.** Screenshotted every panel (main menu, match setup, settings, inventory) after
each change rather than shipping on assumption - caught two real issues this way: the ground glow
initially rendered as a hard-edged circle (switched to a canvas radial gradient) and native
`<input type="range">` sliders in Settings rendered with the browser's default blue thumb, clashing
badly against the new near-black/green palette (fixed with `accent-color` on the slider elements -
a one-line, well-supported CSS fix, no custom slider markup needed). Full smoke suite (16/16) green;
one console-error test failed on the first full-suite run (`THREE.GLTFLoader: Couldn't load texture
Textures/colormap.png`) but passed 3/3 in isolation and clean on a full-suite re-run - pre-existing
flakiness unrelated to this change (nothing touched GLTF loading), not a new regression.

**Scope note:** `PlaySetupModal.ts`/`SettingsPanel.ts`/`InventoryPanel.ts` inherit the new chrome
"for free" since they're built from the same `createPanel`/`createButton`/`createPanelTitle`
helpers - only `SettingsPanel.ts` needed a direct touch (the slider accent-color fix). No internal
restructuring of those panels' own logic.

### Death screen repositioned, kill resets both players' health, respawn distance criterion

Three small, independent playtest requests, all uncommitted pending explicit sign-off per user
instruction (not pushed).

- **`DeathScreen`** - Respawn/Return to Lobby buttons (and the title/score above them) moved from
  screen-center to a `padding-top` block near the top, clearing MultiplayerHud's top-left health
  rows and top-center scoreboard (both keep updating live underneath the death overlay). Verified
  visually via a temporary Playwright screenshot.
- **Survivor health reset** - a kill now resets *both* players' health, not just the one who
  died. The dying player's own reset already existed (`Player.respawn()`, on the delayed
  mid-match respawn). Added `Game.healLocalPlayerToFull()` (reuses `Player.respawn()` at the
  player's own current position - a positional no-op, but it resets health/velocity/recoil/bob
  the same way a real respawn does), called the instant a client receives the opponent's
  `playerDied` message - i.e. the moment this client's own shot is confirmed as the kill.
- **Respawn distance criterion** - `pickRandomRespawnPoint` (`multiplayerSpawn.ts`) now takes the
  opponent's current position and filters `MULTIPLAYER_SPAWN_POINTS` to those at least
  `MULTIPLAYER_RESPAWN_MIN_DISTANCE_FROM_OPPONENT` (35 - half the spawn ring's own 70-unit
  diameter) away, falling back to the single farthest point if none qualify. A respawn can no
  longer drop a player back in sight of whoever just killed them.

**Verification:** `npx tsc --noEmit` clean, unit tests 19/19 green, `npm run build` succeeds.

**Motion/UI polish pass** (per user request: "flashy design" while keeping the current look).
Researched the existing token system first (dark tactical theme, accent green, chamfered panels,
corner-bracket HUD framing, Chakra Petch/Inter) and confirmed the current motion language was
essentially nothing - opacity fades, width/color transitions, one button hover nudge, zero
keyframe animations anywhere. Signature move: a thin accent-green scan-line sweeps down every
panel the instant it opens (`menuStyles.ts`'s `attachScanSweep`, injected once via a `<style>` tag
since inline `style.cssText` can't declare `@keyframes` and this codebase has never had a CSS
file) - applied consistently to every room screen and the match-end screen rather than inventing a
different entrance per surface, so it reads as one system. Everything else stays quiet by
comparison except a couple of targeted, single-use moments: corner brackets draw in staggered on
the main menu (a HUD "calibrating" read), the match-end title gets its own scale/letter-spacing
reveal (the most emotionally-charged moment in the app, deliberately given extra motion budget),
podium rows stagger in rank by rank, HUD health rows slide in when an opponent joins and flash red
on an actual hit (not every update tick - tracked via a `previousHealth` guard), and minimap dots
get a continuous slow pulse (reads as a live radar blip). Verified via screenshot - no layout
breakage, resting states match the pre-existing design (the screenshots can't show motion itself,
just confirm nothing is stuck mid-animation or broken).

## Post-launch playtest fixes: instant play on load, Create Room layout, dropdown legibility (2026-07-08)

A short round of live-playtest feedback, fixed and pushed the same day.

- **Match starts already playable, not paused.** `isPaused`'s formula (`!input.isLocked &&
  !deathScreenVisible`) meant a freshly loaded match always opened on the pause menu, since pointer
  lock was never requested until the player clicked "Resume" - a confusing extra step the user
  explicitly didn't want. `Game.start()` now calls `input.requestPointerLock()` right after starting
  the loop, piggybacking on whatever click (Play/Start Match) triggered match creation, since pointer
  lock still requires a real browser user gesture. This works whenever `start()` runs soon enough
  after that click to still carry its activation through `Game.create()`'s async loading; if it
  doesn't (a slow load, or a guest whose match starts from a network message with no local click at
  all), it fails silently and falls back to exactly today's click-to-resume pause menu - never worse
  than before.
- **`CreateRoomScreen` required scrolling.** Widened from 480px to 760px and restructured into two
  columns - name/code/settings on the left, the live player list on the right (previously stacked
  below everything else, pushing the panel past `createPanel`'s 80vh scroll threshold). No content
  or behavior changed, just the layout.
- **Illegible white-on-white dropdown options.** All `<select>` elements (kill limit, goose
  explosion difficulty, game mode - both `CreateRoomScreen.ts` and `matchEndScreen.ts`'s rematch
  settings, plus `PlaySetupModal.ts`'s single-player goose-difficulty select) had their closed box
  themed dark, but nothing told the browser to render the *native dropdown popup* in dark mode, so
  Chromium fell back to its light-theme default - near-white text on a near-white background.
  `color-scheme:dark` on each select's `style.cssText` fixes this correctly and consistently,
  without needing per-`<option>` styling hacks.
- **Dropdown label height mismatch.** "First to how many kills wins?" wraps to 2 lines while "Goose
  explosions:" stays on 1, so the two selects sat at different heights side by side. Both labels now
  reserve `min-height:2.2em` (2.1em in `matchEndScreen.ts`'s more compact panel) regardless of actual
  wrap, in both `CreateRoomScreen.ts` and `matchEndScreen.ts`.

**Rename:** the game's in-game title, browser tab title (`index.html`), and README are now
**"Hunter 'n Goose"** (previously "Goose-Buster"/"FPS Game"). `package.json`'s internal `name` field
(`fps-game`) was left untouched - it's not user-facing.

**Verification:** `npx tsc --noEmit` clean after each change. Not live-tested in a browser this
round - the pointer-lock fix in particular depends on real user-gesture timing that a headless
check can't meaningfully exercise; worth an eyeball in normal play.

## Loadout system replaces the read-only Inventory panel (2026-07-10)

Per explicit user request: the old `InventoryPanel.ts` (a read-only showcase of every weapon) is
replaced by real loadout management. "Inventory" is now "**Loadout**" everywhere (main menu button,
page title) - a genuinely different feature, not a rename of the same thing.

- **Its own full page**, not a small centered modal - `LoadoutScreen.ts` fills the whole overlay
  (`inset:0`) instead of reusing `createPanel()`'s ~80vh-capped box, per explicit "more space"
  request.
- **Categories, not a flat list.** New `WeaponCategory` (`primary`/`secondary`/`melee`/`special`) in
  `core/gameModes.ts`, with an explicit `WEAPON_CATEGORIES` map (sniper/rifle/shotgun = primary,
  pistol/mp5 = secondary, knife = melee, Goose Launcher = special/non-equippable) - the category is
  what actually stops a player stacking multiple primaries, since a loadout slot only ever accepts a
  weapon whose category matches it. Left column lists weapons grouped and ordered exactly as
  requested (`CATEGORY_DISPLAY_ORDER`, not `WEAPON_DEFINITIONS`' own object-key order): Primary
  (Sniper, Rifle, Shotgun) → Secondary (Pistol, MP5) → Melee (Knife) → Special (Goose Launcher,
  visibly dimmed, not clickable, "Reward only - not equippable").
- **Click to equip.** Each equippable card gets a `click` listener that fills its own category's
  slot (`{ ...this.loadout, [category]: weapon.id }`), persisted immediately - no drag-and-drop
  (an earlier pass tried native HTML5 DnD; switched to a plain click per explicit user feedback, a
  simpler interaction with no drag-target validation to get wrong).
- **Three columns, not two.** Weapon catalog (left, scrollable) → the three equipped-slot readouts
  (middle, a fixed-width column of its own) → the rotating character (right) - the slots moved out
  from an overlay pinned to the character's rim into their own column between the two, per explicit
  user request.
- **Rotating character preview** (`loadoutCharacterPreview.ts`, new): unlike `weaponThumbnail.ts`'s
  deliberate one-shot render-then-dispose, this keeps its own `WebGLRenderer`/`requestAnimationFrame`
  loop alive for as long as the page is open - a live turntable inside a tall rectangular chamfered
  "rim" (this project's existing signature chamfer motif, scaled up - not a circle, per explicit
  user request for a "decently sized" vertical frame with room for the whole character), not a
  static image. Reuses the exact same Kenney "Mini Characters" model + idle-animation lookup
  `RemotePlayer.ts` already uses for opponents (the only downloaded character skin this project
  has). **Scope decision:** the character does not visibly hold the equipped weapon in-hand - no
  bone-attachment precedent exists anywhere in this codebase (checked `Enemy.ts`/`RemotePlayer.ts`,
  neither attaches a weapon mesh to a bone), and building that from scratch is a separate, much
  larger effort; equipped weapons are communicated via the middle column's own text instead.
- **No visible scrollbar on the weapon catalog.** `scrollbar-width:none`/`-ms-overflow-style:none`
  inline (Firefox/legacy Edge) plus a small one-time injected `::-webkit-scrollbar{display:none}`
  rule (Chromium/Safari, which has no inline-style equivalent - mirrors `menuStyles.ts`'s own
  `ensureMotionKeyframesInjected` pattern for the same reason). In its place, a soft bottom fade +
  pulsing chevron (`scrollHint`) that only shows while there's actually more to scroll to
  (`scrollTop + clientHeight < scrollHeight`, rechecked on every `scroll` event) - a short catalog
  that already fits never shows it at all, rather than it being a permanent decoration.
- **Persists like the saved username.** New `core/loadout.ts` directly mirrors `core/username.ts`'s
  shape (`localStorage` + try/catch fallback) - a chosen loadout survives a reload/return visit the
  same way a typed username already does.
- **Actually drives spawned weapons**, for the three modes that don't already restrict/manage the
  loadout themselves (`modeUsesCustomLoadout`: Default, King of the Hill, Goose Horde - single-player
  and multiplayer alike). `resolveWeaponLoadout()` gained a third `customLoadout` parameter,
  consumed only by those three modes' new branch; every restricted mode (Gun Game, 1 Shot 1 Kill,
  etc.) is unaffected. An empty slot falls back to a sane default (rifle/pistol/knife) rather than
  blocking match start, per explicit confirmed decision. **Key simplification found during
  research:** `RemotePlayer.ts` never renders a held-weapon mesh for opponents, so `WeaponManager` was
  already fully local, per-client state with zero network dependency (confirmed by Gun Game's
  existing per-player-random starting weapon) - a chosen loadout needed no new network message at
  all, single-player and multiplayer alike.
- **Pause menu "Loadout" button**, shown only for the three unrestricted modes
  (`PauseMenu`'s new `showLoadoutButton`), opening a second, per-match `LoadoutScreen` instance (same
  duplication `SettingsPanel` already has between the lobby and in-match contexts). A mid-match
  change does **not** apply instantly - per explicit request, it takes effect on the player's *next*
  respawn. `Game.ts` tracks this with a `pendingLoadoutRebuild` flag, checked at the top of both
  `resetPlay()` (single-player) and `multiplayerRespawn()` (multiplayer): disposes the old
  `WeaponManager` (new `WeaponManager.dispose()` - detaches every slot's view model from the camera)
  and rebuilds a fresh one via the same closure (`buildWeaponManager`) the original match-start
  construction already used, refreshing the hotbar afterward.

**Verification:** `npx tsc --noEmit` clean, full `npm run test:unit` suite green (new
`gameModes.test.ts` covers the custom-loadout fallback/override behavior), `npm run build`
succeeds. Not yet live-playtested (drag-and-drop interaction, the rotating character render, and
the mid-match deferred-apply timing are all visual/gameplay-feel concerns a clean build can't
confirm) - single-player first, then a 2-browser multiplayer pass, is the real sign-off here.

## Loadout and menus (v4.4)

As built in v4.4.0 and unchanged in v4.5.0. This replaces the card layout of the 2026-07-10
section above. Its three-column page, categories, click to equip, persistence and "applies on the
next respawn" rule all still hold; the tiles, the details panel and the Grenade section are new.

### Loadout screen (`src/ui/menu/LoadoutScreen.ts`)

- **Square weapon tiles, design only.** Every weapon is an equal square button
  (`.loadout-tile`) holding nothing but its rendered model: the view model with the arms removed
  (`ARM_PART_NAMES`, the hand and sleeve parts of `weapons/models/arsenal.ts`). The size follows
  the viewport, `--loadout-tile: clamp(84px, min(14vh, 8vw), 132px)`, so the whole catalog fits
  unscrolled from 1280 by 720. Tiles are grouped Primary (sniper, rifle, shotgun), Secondary
  (pistol, MP5), Melee (knife) and a gold "Reward only" section for the Goose Launcher, which can be
  clicked for details but never equipped.
- **Name on hover.** The name is a caption laid over the foot of the tile (`.loadout-tile-caption`,
  absolutely placed so showing it moves nothing). It appears on hover, on keyboard focus
  (`:focus-visible`) and on pad focus (`[data-input-device="gamepad"]`), and is `aria-hidden`;
  the tile's `aria-label` carries the name for screen readers.
- **Stats on click.** Clicking a tile equips it (its own category slot only) and opens it in the
  middle column's details panel (`aria-live="polite"`): category, an "Equipped" or "Reward only"
  tag, name, description and stat badges (damage, fire rate per second, magazine, reload seconds,
  and Scope or burst count where the weapon has them, `weaponStats`). The page saves on every click.
- **Grenade section.** Below the weapons, under a rule, a smaller section (`loadout-grenades`,
  tiles at `--loadout-grenade-tile`, 0.66 of the weapon tile) offers Frag Grenade and Flash
  Grenade. Its heading carries the throw key as a key cap (`keyHint` from the player's bindings,
  Q by default, "RB (R1)" on a pad through `setDeviceHint`), re-read every time the page opens so a
  rebind in Settings shows. Clicking a grenade equips it and shows its details. The numbers come
  from `combat/grenades/grenadeTuning.ts`: frag 130 damage near, 7 m radius, 3.0 s fuse; flash
  blinds up to 3.5 s, 22 m reach, 1.6 s fuse.
- **Middle column.** Under the details, one readout per slot (Primary, Secondary, Melee, Grenade).
  Right column: the turning character (`loadoutCharacterPreview.ts`), unchanged. Below 980 px wide
  the page collapses to one scrolling column.
- **Closing.** Close, Escape (a document listener that stays quiet while the page is hidden), or B
  on a pad (B presses the control labelled Close).

### Thumbnails

- `weaponThumbnail.ts` renders each model once: a clone scaled to 1.4 units, a 3/4 camera at
  (1.4, 0.9, 1.6), then `fitCameraToModel` zooms and centres the projection on the projected
  vertices so the silhouette fills 86 percent of the square (`FRAME_FILL`). The output is a 192 px
  PNG data URL (`THUMBNAIL_SIZE`).
- One offscreen WebGL renderer serves the whole batch and is released with `forceContextLoss()` when
  `LoadoutScreen.create` finishes, to stay under Chrome's live-context cap.
- Results are cached for the session in a module-level map keyed by weapon id, so the lobby's screen
  renders them and every per-match screen reuses them without touching WebGL.
- `grenadeThumbnailModel.ts` returns `buildGrenadeModel(kind)`, the same model the game throws
  (`combat/grenades/grenadeModels.ts`); its cache keys are `grenade-frag` and `grenade-flash`.

### How the loadout is stored and read (`src/core/loadout.ts`)

- **Shape.** `PlayerLoadout` (`core/gameModes.ts`): `primary`, `secondary`, `melee` (a weapon id or
  null) and `grenade` (`'frag'` or `'flash'`). Saved as JSON in `localStorage` key
  `fps-game-loadout`, like the username (`core/username.ts`).
- **Defaults.** Null slots read as rifle, pistol and knife (`LOADOUT_SLOT_DEFAULTS`), the grenade as
  frag (`LOADOUT_GRENADE_DEFAULT`). `loadStoredLoadout` returns a fresh object every call and falls
  back to the empty loadout on missing or malformed data; a loadout saved before grenades existed
  keeps its weapons and gets the frag; an unknown grenade becomes frag.
- **Equip.** `equipWeapon` fills only the weapon's own category slot and ignores reward-only and
  unknown ids; `equipGrenade` swaps the grenade alone. Tests: `src/core/loadout.test.ts`.
- **Who reads it.** `LoadoutScreen` on construction and on every `show()`. `Game.create` at match
  start: `resolveWeaponLoadout` uses the weapons only in Default, King of the Hill and Goose Horde
  (`modeUsesCustomLoadout`), which covers every solo mode (solo Horde runs as Goose Horde); and
  `equippedGrenade(...)` sets the carried grenade kind in every mode that has grenades. The
  mid-match page (pause menu "Loadout" button, those three modes only) rebuilds the weapons at the
  next respawn or Restart (`applyPendingLoadoutIfNeeded`). The grenade kind is not touched
  mid-match: it changes at the next match.

### `modalScope.ts`

`ModalScope` is the keyboard scope of the full-page Loadout overlay. `enter(overlay, focusTarget)`
marks every sibling of the overlay `inert` (whatever shares its parent: the lobby's other menus, or
in a match the layer the page was added to), remembers where focus was, and focuses the equipped primary tile, else Close.
`leave()` restores exactly the siblings it inerted (ones already inert stay as they were) and
returns focus if that element is still in the page. Tab therefore cannot reach Return to Lobby
behind the page. Tests: `src/ui/menu/modalScope.test.ts`. Only `LoadoutScreen` uses it.

### The menu screens

All are built from the `menuStyles.ts` helpers (`createPanel`, `createOverlay`, `createButton`,
`createPanelTitle`, scan sweep on open).

| Screen | File | What it is |
|---|---|---|
| Main menu | `src/ui/menu/MainMenu.ts` | Title, PLAY, MULTIPLAYER, LOADOUT, SETTINGS, key hints that switch to pad names, version |
| Match setup | `src/ui/menu/PlaySetupModal.ts` | Solo options: enemy and target counts, goose difficulty, Map and Weather, Horde, Director and Mission |
| Settings | `src/ui/menu/SettingsPanel.ts` | Volume, sensitivity, FOV, graphics, key bindings, controller (lobby and pause) |
| Pause menu | `src/ui/menu/PauseMenu.ts` | Resume, Settings, Restart (solo) or Respawn (multiplayer, unlocks after 5 s), Loadout (three modes), Return to Lobby |
| Multiplayer menu | `src/ui/menu/MultiplayerMenu.ts` | Create Room or Join Room |
| Room screens | `src/ui/menu/CreateRoomScreen.ts`, `JoinRoomScreen.ts` | Host settings and player list; guest join and ready |
| Loading screen | `src/ui/menu/LoadingScreen.ts` | "DEPLOYING" with a progress bar while a match builds |

Match end and the mode briefing are `src/ui/matchEndScreen.ts` and
`src/ui/modeExplanationScreen.ts`. `App.ts` wires the lobby screens.

**Lobby music.** `App.enterLobby` calls `LobbyMusic.start()` once the main menu shows, and
`startMatch` stops it. Tracks, shuffle and volume are in `docs/music.md`.
