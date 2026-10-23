# Visual overhaul (v4.0)

Living record for the overhaul Gustav approved on 2026-10-23 after reviewing his three-model 3D game test (`reference/model-test/README.md`). Plan, decisions, then a build log per phase.

## Brief (Gustav, 2026-10-23)

- Take all seven recommendations from the test review: palette and grade, post-processing, HUD and menus, a mission mode, procedural detail, sound depth, and better character models.
- Art direction **a: stylised dusk**, in the spirit of GPT 6 Astra's AFTERLIGHT.
- The Opus 5.5 pulse rifle's design replaces our weapon models, and every other weapon is designed and built in the same theme.
- The goose humour no longer leads. The aim is a well-made, focused competitive game. Goose modes stay playable, just not the face of the game.
- Test code is copied into `reference/model-test/` before anything is ported from it (Gustav, same day).
- Work without stopping at checkpoints, but test properly and document each phase before starting the next (his standing rule from the enemy AI build).

## Art direction: stylised dusk

The world sits in a long, low dusk: a deep teal sky over a dusty amber horizon, a low warm sun throwing long shadows, and haze that takes the horizon's colour, so distance fades into the sky instead of into white. Surfaces are muted and slightly desaturated; colour is spent on light, not on paint. The only saturated colour in the scene is light: weapon glow, objectives, tracers, lit windows. That is the AFTERLIGHT lesson: every surface shares a handful of hues, and accents glow.

### Palette tokens (`src/render/look.ts`)

| Token | Hex | Use |
|---|---|---|
| sky zenith | `#1c3236` | top of the sky dome |
| sky band | `#4d6a66` | mid sky |
| horizon | `#c49a62` | horizon glow and fog at the sun's side |
| haze | `#7d8676` | fog away from the sun |
| sun light | `#ffc78a` | the directional light |
| sun disc | `#ffe2b0` | the visible sun |
| hemi sky / ground | `#6f8c88` / `#3a3828` | low-cost fill on Low and Medium |
| foliage | `#4f5f45` to `#2e463f` | trees and bushes after the regrade |
| ground | `#67603f` | terrain multiply |
| concrete | `#a99d84` | building walls after the regrade |
| accent cyan | `#6ff0dc` | weapon glow, friendly objectives, HUD accents |
| accent amber | `#e8a64a` | objectives in progress, warnings, low ammo |
| threat red | `#ff5a3c` | enemy fire, damage |
| HUD ink / dim | `#e9efe9` / `#8fa39b` | HUD text |

Night and fog weather get their own presets from the same family: night is deep blue-teal with a cold moon and amber windows; fog is sage-grey with a soft sun.

### Grade

ACES tone mapping stays. On top of it, one grade pass: a slight teal lift in the shadows, warm gain in the highlights, saturation 0.85, a gentle S-curve, a vignette and fine film grain. Low quality skips the composer entirely and gets only ACES plus the palette, so the look survives on weak machines.

## Weapons: the Opus arsenal

The Opus rifle's language, ported to three.js:
- **Body:** dark blue-grey gunmetal with knurling and panel lines (procedural albedo, normal and roughness, ported from Opus `MAT.GUN`).
- **Barrels and rails:** brushed metal shrouds and heat-sink fins (`MAT.PIPE`).
- **Accents:** a small hazard-stripe trim plate on each gun (`MAT.TRIM`).
- **Glow:** cyan energy strips that dim as the magazine empties and turn amber below a quarter (`MAT.GLOW`).
- **Sight:** a red-orange sight dot.
- **Hands:** gloved hands and sleeves, sleeves in the palette's dark sage.
- **Motion:** the magazine drops out and back in during a reload, the gun tucks into a sprint pose, and the glow flares on each shot.

Every weapon keeps its id, stats and name, so multiplayer and saved loadouts are unaffected. Their descriptions lose the jokes.

| Weapon | Silhouette in the Opus language |
|---|---|
| VR-4 Fieldhand (rifle) | The Opus rifle itself, port of its geometry |
| Kestrel P9 (pistol) | Compact slab slide, short shrouded barrel, single glow strip each side, angled grip with flush mag |
| Sable MP-5 (burst SMG) | Short receiver, ribbed brushed handguard, forward-curved mag, folding wire stock, triple glow pips that light per burst round |
| Hedgerow 12 (shotgun) | Heavy receiver, twin stacked barrels in a vented shroud, pump grip, wide glow band, hazard trim on the pump |
| Marchand Longview (sniper) | Long fluted barrel with muzzle brake, bolt housing, long scope tube with glowing lens ring, bipod knuckles, skeleton stock |
| Bicknell Trench Knife | Gunmetal knuckle-guard handle, brushed blade with a glowing edge line |
| Goose Launcher (reward) | Fat drum chamber with glow windows and a flared muzzle, still gold-trimmed so it reads as the reward |

## Phases

Each phase ends with typecheck, unit tests, the relevant e2e specs, screenshots at Low and Medium, and an entry in the build log below. High cannot be judged in the sandbox (its software renderer draws High black), so High-only effects are also checked on Gustav's machine at the end.

1. **Look foundation.** `src/render/look.ts` palette presets per weather, a stylised sky dome (gradient, sun disc and glow, moon at night), a low dusk sun, a hemisphere fill, fog matched to the horizon, and a regrade of the Kenney textures (foliage, buildings, terrain) toward the palette. A post stack on the pmndrs `postprocessing` library: bloom on Medium and High, N8AO ambient occlusion on High, the grade pass with vignette and grain, SMAA. The weapon renders in its own pass so it never clips into walls and takes no AO.
2. **Weapons.** The arsenal above, procedural in `src/weapons/models/`, replacing the four Kenney blaster GLBs, with the loadout thumbnails built from the same code.
3. **HUD and menus.** AFTERLIGHT-style typography and layout: objective panel, compass, world markers with distance, damage direction arcs, a restyled minimap, kill feed and hotbar, and a title screen that flies through the real world instead of showing the cartoon character.
4. **Mission mode.** A solo mode on the Director: reach three watch-tower uplinks, hold each while it uploads under pressure, then extract.
5. **Procedural detail.** Ambient occlusion baked into terrain chunks and building bases, surface detail on the flat building walls, lit windows at dusk and night, emissive accents on objectives.
6. **Sound depth.** Convolution reverb, a combat music layer driven by the Director's pacing, a heartbeat at low health.
7. **Characters.** Full-size, adult-proportioned CC0 characters replacing the Mini Characters for enemies, remote players and the loadout preview.

Release as v4.0.0 once all seven pass, then a check on Gustav's own hardware.

## Decisions

- **Keep three.js and our engine.** The test builds are single-level raw WebGL games; we port their look and their models, not their engines.
- **pmndrs `postprocessing` 6.39.5 and `n8ao` 2.0.1** for the post stack (three 0.185 is inside postprocessing's peer range). Picked over three's own `EffectComposer` because it merges effects into one fullscreen pass, which matters for the low-end machines this browser game runs on.
- **Weapon ids, stats and names unchanged**, so the network protocol and saved loadouts need no migration.
- **Low quality skips the composer**: palette and ACES only.

## Build log

(Entries are added as each phase passes its checks.)
