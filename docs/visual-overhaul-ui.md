# Visual overhaul: HUD and menus (phase 3 brief)

Self-authored under explicit creative delegation: Gustav chose art direction a (stylised dusk, after AFTERLIGHT), asked for a "well made, intent competitive game" with the goose humour no longer leading, and said "Go". Run under the scroll-craft skill's brief, originality and verification rules (rule 10: app interfaces keep those and drop the scroll choreography).

## Brief

- **What it is:** the in-match HUD and every menu of a browser FPS played in a procedurally generated valley at dusk.
- **What the player must feel:** calm, precise, in control. The HUD is an instrument, not a decoration. Information sits at the edges and the centre stays clear for aiming.
- **Feeling curve:** title screen, quiet anticipation (the valley drifting by at dusk, one clear action). Loading, patience with progress shown. In match, focus (thin, low-contrast HUD that only brightens what changed). Taking damage, alarm with direction (arcs say where from). Kill, a short confirmation. Death or match end, a held, legible summary.
- **The moment to remember:** the title screen is the actual valley at dusk, slowly drifting past a watch tower, with the sun on the horizon; the menu sits over it like a caption, not a box.
- **References (Refero, 2026-10-23):** Auros ("abyssal terminal with bioluminescent data orbs"): raised deep-teal surfaces instead of black, tracked uppercase labels, thin arrow glyphs, large numerals. Primary reference: GPT 6 Astra's AFTERLIGHT HUD and title (`reference/model-test/gpt-6-astra/`).

## Originality

- **First-guess ideas rejected:** the current chamfered near-black "tactical shooter" panels with a green scan sweep (what every Valorant-like lobby does); a copy of AFTERLIGHT's layout verbatim.
- **Derived from this subject instead:**
  - **The sun is a bearing.** The match's sun sits at a fixed azimuth, low on the horizon, and fighting into it is a real disadvantage. The compass tape marks the sun, so a player always knows which way is into the light. No other game has this exact sun, because it comes from this game's look preset.
  - **The valley is the menu.** The title screen renders a real slice of the generated valley (terrain, trees, a watch tower) under the match look, not a character on a disc.
  - **Range in metres, bearings in degrees**, set in a mono face, like a field instrument.
- **Swap test:** put a different game's name on the title and the sun-bearing compass and the valley drift no longer make sense. Passes.

## Tokens (`src/ui/theme.ts`, replacing the colour and font constants in `menuStyles.ts`)

| Token | Value | Use |
|---|---|---|
| `INK` | `#e9efe9` | primary text |
| `INK_DIM` | `#93a8a0` | secondary text, labels |
| `INK_FAINT` | `rgba(201, 226, 216, 0.38)` | ticks, inactive pips |
| `HAIRLINE` | `rgba(202, 231, 219, 0.2)` | rules, borders |
| `SURFACE` | `rgba(7, 24, 27, 0.78)` | panels (with `backdrop-filter: blur(10px)`) |
| `SURFACE_RAISED` | `rgba(16, 48, 52, 0.62)` | buttons, inputs, cards |
| `VOID` | `#071518` | full-screen backgrounds |
| `ACCENT` | `#6ff0dc` | primary action, friendly, healthy |
| `ACCENT_INK` | `#0d2a28` | text on accent |
| `AMBER` | `#e8a64a` | objectives, warnings, low ammo |
| `THREAT` | `#ff5a3c` | damage, enemies, critical |
| `TEXT_SHADOW` | `0 2px 8px rgba(4, 23, 22, 0.55)` | every HUD text over the world |

**Type:** `Manrope` (Google Fonts, weights 300, 400, 600, 700) for everything readable; `Martian Mono` (300, 400, 500) for numbers that update and instrument labels (bearings, ranges, ammo, timers, room codes). Big numerals are Manrope 300. Labels are 10 to 11 px, uppercase, letter-spacing 0.2em, `INK_DIM`. No other faces. The index.html font link is replaced accordingly.

**Shape:** no chamfers. Panels are plain rectangles with a 1px `HAIRLINE` border, 2px radius at most. The one accent device is a 32 by 1 px `ACCENT` rule under titles. Buttons: primary is solid `ACCENT` with `ACCENT_INK` text and a thin `→` glyph at the right; secondary is `SURFACE_RAISED` with a hairline border that turns `ACCENT` on hover and focus. Focus ring: 2px `ACCENT` outline, 3px offset.

**Motion:** keep `MOTION_EASE`. Panels enter with a 180 ms fade plus 8 px rise. No scan sweep, no glow halos. The global reduced-motion rule stays.

## HUD layout (1920 by 1080 reference, 32 px edge gutter, scales down to 1280 by 640)

- **Top left, objective panel:** label (`OBJECTIVE`, or the mode name), one line of objective text in Manrope 400 16 px, then progress pips (4 by 26 px bars, `ACCENT` when done) or a score line in Martian Mono. Single player shows the mode's goal and score; Director shows its current phase as a word (`BUILDING`, `PEAK`, `FADING`, `QUIET`) in `INK_DIM`.
- **Top centre, compass tape:** 320 px wide, heading in Martian Mono 11 px `ACCENT` above the centre tick (e.g. `NE 041`), tick marks every 15 degrees, cardinal letters, a **sun mark** (a small filled circle in `AMBER` with a 1px ring) at the look's sun azimuth, objective diamonds in `AMBER`, and red contact ticks in `THREAT` that fade over 3 s at the bearing of recent damage.
- **Centre, crosshair:** four 1 px lines 6 px long with a 7 px gap and a 2 px centre dot, `INK` at 80% opacity; turns `THREAT` while aiming at an enemy. The hit marker is four short diagonal lines in `INK` (headshot or kill: `THREAT`) that fade in 180 ms.
- **Around the crosshair, damage arcs:** a 90 degree arc segment on a 120 px radius ring, `THREAT`, pointing toward the damage source relative to the camera's yaw, fading over 1.2 s. Several can show at once. The existing red edge vignette stays but at half its old strength.
- **Bottom left, vitals:** label `HEALTH`, a Manrope 300 44 px numeral with a small `%`, a 3 px bar under it (`ACCENT`, `AMBER` under 50, `THREAT` under 25), a status line under that in 10 px (`STABLE`, `WOUNDED`, `CRITICAL`).
- **Bottom centre, hotbar:** the weapon slots as a row of minimal tabs: key number in Martian Mono in a 1px box, weapon name in 11 px uppercase; the active slot has `INK` text and a 2 px `ACCENT` underline, the rest `INK_DIM`.
- **Bottom right, weapon:** label = weapon name uppercase, a Manrope 300 44 px magazine numeral, `/ 30` in Martian Mono 14 px `INK_DIM`, reserve `+N` when it exists; `RELOADING` replaces the numeral line with a 3 px progress bar; under 25% magazine the numeral turns `AMBER`; melee shows `MELEE`.
- **Kill feed:** top right, right aligned, 12 px rows, killer and victim names with a thin `→`, fade after 4 s.
- **Minimap:** keep its position and behaviour; restyle to `SURFACE` with hairline ring, player `ACCENT`, enemies `THREAT`, items `AMBER`.
- **Announcements and callouts** (big announcement, long shot, goose announcement, horde wave, weapon caption): restyle to the tokens: Manrope 300 for headline text, a tracked label above it, no glow.
- **World markers:** a `WorldMarkers` HUD class that projects world points to the screen: an `AMBER` 9 px rotated-square diamond, a label, and the range in metres in Martian Mono; clamped to the screen edge with an arrow when off screen. Used by the mission mode (phase 4).

## Menus

- **Title screen:** the valley drift (Claude builds this in `LobbyScene`), with the menu left-aligned over it like AFTERLIGHT's: a small label line, the title `HUNTER 'N GOOSE` in Manrope (HUNTER at 300, 'N GOOSE at 700), a one-line tagline in 300, the primary `PLAY` button, then `MULTIPLAYER`, `LOADOUT`, `SETTINGS` as secondary buttons, and a footer line with the version in Martian Mono. A left-to-right `VOID` gradient scrim sits behind the menu only.
- **Every other menu surface** (play setup, loadout, settings, pause, multiplayer, create and join room, loading, mode explanation, death screen, match end): same components through the shared helpers, so the reskin is mostly the tokens and the helpers. Copy loses the jokes where it is ours to change (weapon descriptions, tagline), and keeps every functional label.

## Work split and checks

- Claude: this brief, `theme.ts` tokens, the title scene, review of everything.
- Codex job 1 (`gpt-6-astra`, high): tokens wired through `menuStyles.ts`, fonts, every menu surface reskinned.
- Codex job 2 (`gpt-6-astra`, high): the HUD (`hud.ts`, hotbar, crosshair, hit marker, damage arcs with a damage source passed from enemy attacks, compass, kill feed, minimap, announcements, world markers).
- Verification: typecheck, unit tests, the smoke e2e suite, screenshots at 1920 by 1080 and 1280 by 640 of the title, play setup, loadout, settings, pause, death screen and an in-match HUD under fire, then `/web-design-guidelines` and the `site-qa` checklist on the menus.
