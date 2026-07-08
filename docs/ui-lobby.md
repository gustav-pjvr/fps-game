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

