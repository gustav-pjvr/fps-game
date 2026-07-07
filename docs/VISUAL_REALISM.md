# Visual Realism Plan — fps-game

*Analysis conducted 2026-07-05 (Fable 5 model) against the goal: make the game look realistic.*

**Scope judgment:** this report covers the 3D world only. The HUD (`src/ui/`) is plain DOM-with-text-shadow chrome; it's serviceable and is not what makes the game read as "not realistic." Every point below is about the rendered scene.

**One honest framing note before the details.** The asset base is Kenney CC0 low-poly flat-color kits (Blaster Kit, Mini Characters, Modular Buildings, Nature Kit — confirmed in `public/assets/credits/`). That art style can never be photoreal, and swapping every asset is not a solo-project move. The realistic goal is what Valheim/Firewatch-class games do: **stylized geometry made to look physically real through lighting, shadows, atmosphere, and post-processing.** The good news is that this codebase's biggest gaps are exactly there, and they're cheap: the single largest problem found is that the game effectively has almost no shadows at all.

---

## 1. Lighting & shadows

**Current state.** `Game.addLighting` (src/core/Game.ts:379-387) is `AmbientLight(0xffffff, 0.6)` + `DirectionalLight(0xffffff, 1.2)` with `sun.castShadow = true` — and *nothing else*. No `shadow.mapSize`, no `shadow.camera` bounds, no target, no bias. `Renderer.ts:40` enables `shadowMap` but never sets `shadowMap.type` (defaults to hard-edged `PCFShadowMap`).

**The gap.** This is the report's headline finding: a Three.js `DirectionalLight` shadow camera defaults to a **±5-unit ortho box at 512×512**. The sun sits at fixed `(20, 30, 10)` (config.ts:20-22) targeting the origin — so shadows exist only in a ~10×10 m patch near world origin, at low resolution, with hard edges, and the patch never follows the player. In a 800×800 m world, `mesh.castShadow = true` on every tree (VegetationManager.ts:165), building (BuildingManager.ts:276), and enemy is paying vertex cost for shadows that render almost nowhere. Meanwhile the flat white 0.6 ambient fills every crevice uniformly — the classic "Three.js demo" look: no darkening under trees, under building eaves, or on the unlit side of anything.

Second bug: `Enemy.ts:147` sets `this.mesh.castShadow = true` on a **`THREE.Group`** — `castShadow` doesn't propagate to children, so enemies cast no shadow even inside the tiny working patch. `Target.ts` sets no shadow flags at all.

**Recommendations.**
- **(Small, transformative)** Configure the sun properly: `sun.shadow.mapSize.set(2048, 2048)`, ortho bounds ~±60 units, `shadow.camera.far ≈ 200`, `shadow.bias ≈ -0.0002`, `shadow.normalBias ≈ 0.02`, `renderer.shadowMap.type = THREE.PCFSoftShadowMap`. Then, each frame, move `sun.position` and `sun.target.position` to `player.position + sunDirection·k` (snap the target to shadow-texel increments to kill swimming). ~30 lines in Game/Renderer. This one change will do more for realism than anything else in this document.
- **(Small)** Fix the enemy shadow bug: `model.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } })` in Enemy/Target constructors.
- **(Small–medium)** Replace `AmbientLight` with environment lighting — see §5; at minimum swap it for `HemisphereLight(skyBlue, groundBrown, 0.5)` so upward-facing surfaces read sky-lit and downward-facing read ground-bounced. Two lines, immediately less flat.

## 2. Materials & texturing

**Current state.** Terrain: one 1k **diffuse-only** JPEG (Poly Haven `aerial_grass_rock_diff_1k.jpg`, the only texture on disk) in a `MeshStandardMaterial({ map })` (ChunkManager.ts:16-25), tiled every 10 m (config.ts:165-167). No normal, roughness, or AO map. Roads are a flat-color `MeshStandardMaterial({ color: 0x6b5a45, roughness: 1 })` (RoadManager.ts:83). Kenney models use their baked `colormap.png` flat colors; VegetationManager.ts:92 already force-fixes Kenney's `metalness: 1` export bug (documented in NOTES.md — good catch, but it exists *because* there's no `scene.environment`). Chunk normals come from `computeVertexNormals()` per chunk (Chunk.ts:82) — edge vertices don't see neighbor-chunk triangles, so there are lighting seams on chunk borders.

**The gap.** The terrain is most of every frame's pixels and it responds to light like paper: no surface relief under grazing sun, uniform roughness, visible 10 m tiling repetition at distance, and the same grass texture runs straight up the 45-unit boundary mountains.

**Recommendations.**
- **(Small)** Download the rest of the *same* Poly Haven set (`aerial_grass_rock` ships `_nor_gl`, `_rough`, `_ao` at 1k/2k, CC0) and wire `normalMap`, `roughnessMap`, `aoMap` into `createGroundMaterial()`. Terrain already has UVs; `aoMap` needs `uv2` (copy `uv`). One afternoon, big payoff at sunrise/sunset sun angles.
- **(Medium)** Anti-tiling + slope blend via `material.onBeforeCompile`: blend a rock texture in by slope (`normal.y` threshold — fixes grass-covered mountains) and break repetition by mixing two texture scales or hue-jittering with a low-frequency noise. ~60 lines of GLSL injection; this is the standard trick and there are many references for it.
- **(Small)** Give roads a real texture (ambientCG `Ground027`/gravel, CC0) instead of flat brown, and fade their edges with an alpha gradient so they don't read as painted tape.
- **(Small)** Fix chunk normal seams: compute normals analytically from the height function (central differences on `sampleHeight`), which also makes them exact rather than faceted.

## 3. Post-processing

**Current state.** None. `Renderer.render()` is a bare `webgl.render(scene, camera)` (Renderer.ts:67-69). No `toneMapping` is set, so it's `NoToneMapping` — HDR-ish light values clip straight to white and colors stay flat.

**The gap & recommendations, in strict value order:**
1. **(Tiny — do first)** `renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure ≈ 0.9–1.2`. Two lines, no pipeline needed, instantly gives filmic rolloff and richer saturation. Re-tune light intensities afterward (they'll read darker).
2. **(Medium)** Ambient occlusion. With flat-color low-poly assets, AO is the highest-value effect there is — it's what makes objects look *grounded*. Use the `n8ao` package (drop-in, faster and better-looking than three's SSAOPass) via `postprocessing`'s `EffectComposer`. Note MSAA (`antialias: true`) stops applying once you render via composer — use the composer's SMAA pass instead.
3. **(Small, same composer)** Subtle bloom (threshold high, for sky/tracers/muzzle flash only) + vignette. Cheap film-feel. Skip DoF, chromatic aberration, and grain for now — low value for an FPS and easy to overdo.

## 4. Geometry & detail density

**Current state.** Everything is real GLTF now, not primitives: 7 Kenney buildings, 4 vegetation models (instanced, thousands of instances for a few draw calls — VegetationManager is genuinely well built), animated `character-male-a` enemies with SkeletonUtils cloning, Blaster Kit weapon view models. The knife is deliberate procedural placeholder (viewModel.ts:34-37 says so explicitly). NOTES.md:421 confirms "placeholder-quality graphics" was the accepted baseline.

**The gap.** Two silhouette problems undercut realism regardless of lighting: (a) the **weapons are sci-fi blasters** — a "pistol" that is visibly a ray-gun caps how realistic the game can ever feel from the player's constant first-person view; (b) enemies are chibi-proportioned Mini Characters (~0.67 units tall scaled ×2.5), which read as cute, not threatening. Also there's no ground clutter — terrain between trees is a bare textured plane.

**Recommendations.**
- **(Medium, high value)** Replace the four blaster GLBs with a CC0/CC-BY low-poly *modern* weapon set — Quaternius "Guns" pack (CC0, includes pistol/rifle/shotgun/sniper) drops into the existing `WEAPON_MODEL_SPECS` per-model scale/rotation system with no code changes beyond retuning scale and `muzzleLocalOffset`. This is the single best *asset* swap available.
- **(Medium)** Same story for enemies: Quaternius "Universal Animation Library" humans (CC0, rigged, idle/walk/run/death clips) are proportioned like adults and slot into the existing mixer/clip-name lookup (`idle`/`walk`) with minor renaming.
- **(Small)** Scatter grass tufts/small stones as extra no-collider instanced types — the pool system already supports this in ~20 lines per type; Kenney Nature Kit has grass meshes you already have license lines for.

## 5. Atmosphere

**Current state.** Genuinely decent groundwork: `three/addons` `Sky` shader with tuned turbidity/rayleigh, sun direction shared with the light (Renderer.ts:15-29), linear fog tuned to conceal the world boundary (config.ts:26-28), boundary mountains. NOTES.md shows this was a deliberate §6 pass.

**The gap.** The sky lights nothing — there's no `scene.environment`, which is *why* the vegetation-metalness hack was needed and why ambient is flat white. Fog color is a constant `0xbfd3e0` that only approximately matches the shader sky's horizon. Fixed noon-ish sun, no clouds.

**Recommendations.**
- **(Small–medium, do with §1)** Generate the environment map *from the existing Sky*: render it once into a `PMREMGenerator` cube target and assign to `scene.environment` (the standard `Sky` + PMREM recipe from the three.js examples). Then delete the AmbientLight and cut the metalness hack back to normal. This single change makes every `MeshStandardMaterial` in the game — terrain, buildings, weapons — respond to a plausible sky instead of a white constant. Alternative: a Poly Haven 1k HDRI, but Sky-derived stays consistent with the visible sky for free.
- **(Small)** Lower the sun (config's `(20,30,10)` is high-noon-ish; something like a 25-35° elevation gives long readable shadows, which is most of what makes outdoor scenes look real). Since sun direction is already a shared constant, this is a two-number change — with §1's shadow fix in place first.
- **(Small)** Switch to `FogExp2` and derive its color from the sky at the horizon so distance haze blends seamlessly. Optional later: a handful of billboard cloud sprites.

## 6. Animation & motion quality

**Current state.** Camera recoil with decay exists (Player.ts:83-88, 254). Reload dip/tilt and holster-drop weapon switching exist (WeaponManager.ts:207-226). Enemies crossfade idle/walk clips (Enemy.ts:583-584). Footstep *sounds* are distance-driven, but there is **no camera bob, no weapon sway, no weapon movement-bob** — the view model is bolted rigidly to the camera. And death is instant deletion: `EntityManager.update` removes the mesh the same frame `isDead` flips (EntityManager.ts:76-81).

**The gap.** Instant despawn is the most realism-breaking *moment* in the game — an enemy takes a killing shot and ceases to exist. Rigid weapons are the most realism-breaking *constant*.

**Recommendations.**
- **(Small, high value)** Death sequence: on death, disable colliders, play a fall (Mini Characters has no death clip — a simple 0.4 s scripted tumble: rotate the group 90° with an ease, small position drop), hold 2 s, fade/sink, then despawn. Restructure `EntityManager` to keep a "dying" list. ~60 lines.
- **(Small)** Weapon sway + bob: offset the view-model group each frame by a damped fraction of the look delta (lag) and a `sin` bob driven by horizontal speed (the same phase can drive a ±0.02-unit camera bob). The lobby already does exactly this math (LobbyScene.ts:119-120) — port it. ~30 lines in WeaponManager/Player.

## 7. Effects fidelity

**Current state.** Tracers: unlit `MeshBasicMaterial` cylinders lerped from muzzle to hit (Tracers.ts) — actually fine; unlit is *correct* for glowing tracers and they'll bloom nicely once §3 lands. Impact markers: floating black/red **spheres** that hang in the air for 1.5 s (ImpactMarkers.ts:16-19) — reads as debug visualization, not gunfire. **No muzzle flash of any kind** (grep-confirmed). No shell casings, no smoke, no blood/damage feedback beyond the 2D hit-marker X.

**Recommendations.**
- **(Small)** Muzzle flash: a `PointLight` (orange, intensity spike, 1-2 frame lifetime, positioned at the existing `muzzleLocalOffset` — already computed per weapon) + a small additive-blended sprite (`THREE.Sprite`, random roll). The muzzle position plumbing already exists in `fireShot`; this is ~50 lines and transforms how firing feels.
- **(Small–medium)** Replace impact spheres with surface-aligned effects: a flat decal quad oriented to the hit normal (`castHitscan` already returns the point; Rapier's raycast can return the normal) plus a 5-10 particle dust puff (one shared `THREE.Points` pool). Red spheres on flesh hits → brief red particle burst.
- **(Defer)** Blood decals/gore — style call, skip until the above is in.

---

## Priority table — visual impact per effort

| # | Action | Where | Effort | Why this rank |
|---|--------|-------|--------|---------------|
| 1 | Fix directional shadow camera (mapSize 2048, ±60 ortho, PCFSoft, follow player, bias) | `Game.addLighting`, `Renderer` | **S** | Game currently has ~no shadows; single biggest lever |
| 2 | ACES filmic tone mapping + exposure retune | `Renderer` | **XS** | Two lines; kills clipped-flat color everywhere |
| 3 | `scene.environment` from PMREM'd Sky; delete flat AmbientLight | `Renderer`/`Game` | **S–M** | Makes every PBR material respond to a real sky; unblocks metalness hack |
| 4 | Terrain normal/roughness/AO maps (same Poly Haven set) | `ChunkManager.createGroundMaterial` | **S** | Biggest pixel area in every frame |
| 5 | Muzzle flash (light + sprite at existing muzzle offset) | `WeaponManager.fireShot` | **S** | Most-seen effect in an FPS; currently absent |
| 6 | Death animation + fade-out instead of instant despawn | `EntityManager`, `Enemy` | **S** | Worst single realism-breaking moment |
| 7 | Weapon sway/bob + camera bob (port lobby math) | `WeaponManager`, `Player` | **S** | Fixes the constant "gun bolted to face" feel |
| 8 | EffectComposer: N8AO + subtle bloom + vignette (+SMAA) | `Renderer` | **M** | AO is the top-value effect for low-poly assets; needs 1-3 first |
| 9 | Swap sci-fi blasters → CC0 modern weapons (Quaternius); fix enemy `castShadow` on Group bug while in there | `viewModel.ts` specs, `Enemy.ts:147` | **M** | Caps on realism until the player's constant view isn't a ray-gun; the shadow fix is 5 lines |
| 10 | Impact decals + dust particles replacing floating spheres; slope-blend/anti-tile terrain shader | `ImpactMarkers`, terrain `onBeforeCompile` | **M** | Polish tier once 1-9 land |

Items 1-3 together are roughly one working day and will change the game's look more than everything else combined. Items 4-7 are each an evening. 8-10 are the second wave. Nothing here requires paid assets: Poly Haven (already in use), ambientCG, Kenney (already in use), and Quaternius cover every asset named.
