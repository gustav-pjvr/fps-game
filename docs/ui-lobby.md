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

