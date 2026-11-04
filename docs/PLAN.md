> **Historical document (written before v4.0).** It records the original plan and what was decided then; the game has changed since (the plan below is the first version of the whole game, and most of it has since been built, changed or replaced). For how the game works now, see [ARCHITECTURE.md](ARCHITECTURE.md) and the index in [README.md](README.md).

# 3D Browser FPS Game — Project Plan

Status: **Planning only** — no code written yet.
Location: `Claude WorkSpace\fps-game\`
GitHub (when created): `gustav-pjvr/fps-game` (per workspace convention, identity `gustavpjvr@gmail.com`)

---

## 1. Overview

A single-player, browser-based first-person game built on Three.js. The player explores a procedurally generated open landscape (noise-based heightmap terrain), carries and switches weapons with aim-down-sights/scope, and shoots AI targets/enemies. Architecture is structured so an authoritative multiplayer server can be added later without a rewrite.

**Requirements confirmed with user:**
- Fully browser-based (WebGL), playable via URL, zero install
- First-person WASD + mouse-look controller with pointer lock
- Procedural rolling terrain from noise-based heightmaps (not voxel, not static)
- Multiple weapons with distinct models, switching, and ADS (FOV/position lerp + scope overlay)
- Combat loop: explore + shoot enemies/destructible targets
- Single-player v1, architecture leaves room for later WebSocket multiplayer

---

## 2. Tech Stack

| Concern | Choice | Justification |
|---|---|---|
| Rendering | **Three.js** (r160+) | Dominant, best-documented WebGL engine; huge ecosystem/examples. |
| Language | **TypeScript** | Type safety across many interacting systems (entities, weapons, physics). |
| Build tooling | **Vite** | Instant HMR, near-zero config, trivial static deploy. |
| Physics / collision | **Rapier** (`@dimforge/rapier3d-compat`) | Rust→WASM, fast, deterministic — important for the multiplayer-later goal. |
| Character controller | Rapier `KinematicCharacterController` | Purpose-built capsule-vs-terrain controller with slope/step handling. |
| Noise / terrain | `simplex-noise` (npm) + custom heightmap mesh on `PlaneGeometry` | Small, seedable, no directional artifacts. Mesh/chunking is game-specific custom code. |
| Terrain collision | Rapier heightfield collider | Same height array drives visuals and physics — stays in sync for free. |
| Input | Pointer Lock API + raw key/mouse events, wrapped in an action-based `InputManager` | Decouples input from simulation; eases later gamepad/mobile/network input. |
| Weapon/character assets | glTF 2.0 (`.glb`) via `GLTFLoader` | Standard runtime format; skinned meshes, animations, PBR in one file. |
| Animation | Three.js `AnimationMixer` | Built-in; handles weapon/character clips. |
| Audio | Three.js `PositionalAudio` (deferred to later phase) | Spatial gunshots/footsteps once core loop works. |
| State / ECS | Plain TS classes + entity registry now; `miniplex` only if entity variety explodes | YAGNI — don't adopt full ECS on day one. |
| UI / HUD | Plain HTML/CSS overlay over the canvas | Crosshair, ammo, health, scope overlay are simpler as DOM than in-canvas UI. |
| Deployment | Static host (Vercel / Netlify / GitHub Pages / Cloudflare Pages) | No backend needed for v1. |

**Explicitly deferred:** React (unnecessary render overhead for a canvas game), any networking library (add only when multiplayer starts), a full game engine (PlayCanvas/Babylon lock-in).

---

## 3. Project Structure

```
fps-game/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── public/assets/{models/{weapons,enemies},textures,audio}
├── src/
│   ├── main.ts
│   ├── core/        # Game.ts, Loop.ts (fixed timestep), Renderer.ts, AssetLoader.ts, config.ts
│   ├── input/        # InputManager.ts, actions.ts
│   ├── physics/       # PhysicsWorld.ts, raycast.ts
│   ├── world/        # TerrainGenerator.ts, Chunk.ts, ChunkManager.ts, biomes.ts (later)
│   ├── entities/      # Entity.ts, Player.ts, EntityManager.ts, enemies/{Target.ts, Enemy.ts}
│   ├── weapons/       # Weapon.ts, WeaponManager.ts, ads.ts, definitions.ts
│   ├── combat/        # hitscan.ts, damage.ts
│   ├── ui/          # hud.ts, scope.ts
│   └── utils/        # math.ts, rng.ts
└── tests/           # vitest unit tests
```

**Multiplayer-forward note baked into structure:** simulation logic (`physics/`, `entities/`, `combat/`, `weapons/`) is kept separate from rendering/input. This split is the single most important decision for adding an authoritative server later — it would run the sim headless, without `Renderer` or DOM.

---

## 4. Staged Build Order

Each phase is a playable/testable increment.

### Phase 0 — Scaffold + Moving Camera
Vite + TS + Three.js renders a scene; pointer-lock mouse-look + WASD free-fly camera over a placeholder ground plane and boxes.
- *Watch for:* Pointer Lock must be requested from a real user gesture; handle `pointerlockchange`/`pointerlockerror`; accumulate `movementX/Y` deltas, clamp pitch ±89°.
- *Foundational decision made here:* fixed-timestep accumulator loop with interpolated rendering, set up now because retrofitting later is painful and is required for deterministic physics/multiplayer.

### Phase 1 — Physics World + Grounded Player Controller
Integrate Rapier (async WASM init); flat ground collider + kinematic capsule character; WASD + jump + gravity; camera rigged to capsule eye height.
- *Watch for:* gate game start on WASM init completing; use kinematic (not dynamic) controller for responsive movement; interpolate camera between fixed steps to avoid jitter.
- *Also set up here:* the collider→entity registry pattern (map Rapier collider handles to game objects) — introduced now while there's only one collider, so it's already in place when enemies (Phase 7) need it.

### Phase 2 — Procedural Terrain (single chunk)
`TerrainGenerator` builds a seeded fBm heightmap via `simplex-noise`; displace a subdivided plane mesh; feed the same height array to a Rapier heightfield collider.
- *Watch for:* visual mesh and physics heightfield must share resolution/scale or you'll walk above/through ground; call `computeVertexNormals()` after displacement; tune octave/amplitude falloff to avoid unnatural repetition.

### Phase 3 — Chunk Streaming (open world)
`ChunkManager` loads/unloads chunks in a radius around the player; sample noise in continuous world coordinates so edges match seamlessly.
- *Watch for:* frame hitches from mid-frame generation (start main-thread with small chunks, move to a Web Worker if hitching appears); explicit disposal of geometries/materials/colliders on unload to avoid leaks. Defer LOD — keep chunks small and view distance modest for v1.

### Phase 4 — First Weapon (view model + fire, no ADS yet)
Load one `.glb` weapon parented to the camera; left-click fires a hitscan ray from **screen center** (not the barrel); basic recoil/spread math; HUD crosshair + ammo (DOM); reload on `R`.
- *Watch for:* recoil = damped angular camera offset; spread = random cone on the ray direction; view-model can clip world geometry (acceptable to defer polish, note it).
- **Refinement vs. original draft:** define the weapon **stats table** (`definitions.ts`) here for this one weapon, even though only one entry exists yet — not in Phase 6. Building the data-driven shape from the start avoids a refactor when the second weapon is added.

### Phase 5 — Aim Down Sights (ADS) + Scope
Right-click lerps `camera.fov` (call `updateProjectionMatrix()` each frame during the lerp) and the weapon's view-model transform toward an aim pose; reduced spread/sensitivity while aiming; scoped weapons swap to a full-screen DOM/CSS scope overlay at full zoom.
- *Watch for:* scale mouse sensitivity by zoom ratio; a true magnified scope needs a second render-target camera — note as an optional v1.1 upgrade, a static overlay + FOV zoom is enough for v1.

### Phase 6 — Weapon Switching
Add a second entry to the Phase 4 stats table; `WeaponManager` swaps active weapon + view model on number keys/scroll; holster/draw delay so switching isn't instant.
- *Watch for:* this phase is now mostly data + wiring, not a redesign, because the table was built in Phase 4.

### Phase 7 — First Enemy/Target You Can Shoot
Static `Target.ts` first (collider + health, hitscan applies damage, death despawns + increments score), then a minimal moving `Enemy.ts` (simple steering, sampling terrain height for grounding).
- *Watch for:* map hit collider → owning entity via the registry from Phase 1; support per-part damage (head/body) via separate child colliders; establish update order now — input → sim step (physics, AI, fire) → damage/death resolution → render interpolation — because this is the same order a future server would use.

**End of v1:** procedural streaming terrain + grounded FPS controller + multiple ADS-capable weapons + shootable enemies/targets + HUD. Playable via URL.

---

## 5. Order Validation

The phase order was reviewed end-to-end for dependency correctness:

- ✅ Environment (0–3) before combat (4–7) is correct — you need ground and movement before anything is worth shooting at.
- ✅ Single-chunk terrain (2) before streaming (3) is correct — validates the noise→mesh→collider pipeline before adding streaming complexity on top.
- ✅ One weapon (4) before ADS (5) before switching (6) before enemies (7) is correct — each phase adds exactly one new system to an already-working slice.
- 🔧 **Change made:** moved the data-driven weapon stats table from Phase 6 into Phase 4 (see above) so the second weapon in Phase 6 is pure data + wiring, not a refactor.
- 🔧 **Change made:** moved the collider→entity registry from Phase 7 into Phase 1 (see above), since it's cheap to establish with the first collider and Phase 7 already depends on it existing.

No other reordering was needed — the rest of the sequence in the original draft holds up.

---

## 6. Cross-Cutting Technical Notes

- **Fixed timestep from day one (Phase 0):** simulation at a fixed rate (e.g. 60 Hz) with an accumulator; render interpolates. Backbone of deterministic physics and any future server authority.
- **Seeded RNG everywhere (`utils/rng.ts`):** noise, spawns, and spread all derive from one seed — reproducible worlds, essential for shared multiplayer worlds later and for debugging.
- **Collider→entity registry:** established Phase 1, used from Phase 7 on.
- **Dispose discipline:** every geometry/material/texture/collider created during streaming must be disposed on unload.

---

## 7. Tooling, Connector, MCP & Agent Assessment

Assessed against every connector/MCP server, skill, and agent currently available in this environment. Only tools with a real, non-speculative use for this project are listed; everything else (Gmail, Calendar, GoDaddy, Indeed, Spotify, Adobe document/print tools, Canva print-design tools, etc.) was reviewed and has no clear fit here.

### MCP connectors — recommended

| Tool | Use in this project |
|---|---|
| **`npm create vite@latest` (official Vite scaffold) + Three.js official docs/examples** | Free, standard Phase 0 scaffolding path — no paid tool needed. This plan's own Section 4 (Phase 0) already specifies exactly what the scaffold needs (pointer lock, fixed-timestep loop), so the official Vite `vanilla-ts` template plus Three.js's own getting-started examples cover it fully. |
| **GitHub Pages** (free, via the existing `gustav-pjvr` GitHub account) — or **Cloudflare Pages** as a fallback | Deployment path once v1 is playable. Vite outputs static assets; a `gh-pages` branch or GitHub Actions workflow publishes them for free under `gustav-pjvr.github.io/fps-game`. Netlify/Vercel free tiers remain listed in Section 2 as alternatives if GitHub Pages' asset-size limits become an issue with larger `.glb`/texture files. |
| **Free asset sources (replaces paid Higgsfield generation for art/audio):** [Kenney.nl](https://kenney.nl) (CC0 weapon/prop/environment packs, many already glTF-ready), [Poly Haven](https://polyhaven.com) (CC0 PBR textures + HDRIs for skybox/terrain), [Mixamo](https://mixamo.com) (free character rigging/animation, exports to glTF/FBX), [Freesound.org](https://freesound.org) (CC0/CC-BY gunshot, footstep, ambient SFX) | No generation cost. Kenney packs in particular are purpose-built for indie/browser games and drop straight into the `public/assets/models/` structure. Custom modeling/edits done in **Blender** (free, open-source) when a stock asset needs modification. |
| **Adobe for Creativity — image tools** (`image_remove_background`, `image_apply_*`, `image_crop_and_resize`, etc.) | Terrain textures, skybox panels, HUD icons, weapon thumbnails — texture prep/editing pipeline. |
| **`chrome-devtools` MCP** (already installed globally per this workspace's `CLAUDE.md`) | **Directly load-bearing for this project.** Live console/network/performance inspection of the running WebGL game — use it every phase to catch WASM init errors, dropped frames, and console warnings before calling a phase "done," per the workspace rule to verify UI/frontend changes in a real browser. |
| **`shadcn` / `magic` MCP** | Not relevant — this project's UI is a thin canvas overlay, not a component-library-driven app. Skip. |
| **Canva** | Only relevant if/when producing promo art or a store page later — not for core dev. |
| **Google Drive** | Optional backup location for large binary assets (`.glb`, textures) if you want them off the local disk. |

### Ruflo MCP — assessed per this workspace's mandatory rule

Per `Claude WorkSpace\CLAUDE.md`: *"Assess whether the Ruflo MCP server would help; if so, propose it to the user before proceeding."* Assessment:

- Ruflo is a large multi-agent swarm / hive-mind / distributed-memory orchestration server (agent pools, consensus, neural pattern training, WASM agent swarms, etc.).
- This project is a **solo, sequential build** by one developer through 8 linear phases — it does not have the independent, parallelizable work-streams that swarm/hive-mind coordination is designed for.
- Two narrow pieces *could* be useful later, not now: `github_repo_analyze` / `github_pr_manage` once the repo exists on GitHub, and `memory_store`/`memory_search` as a supplement to this PLAN.md for cross-session continuity.
- **Recommendation: do not adopt Ruflo's swarm/hive-mind features for this project.** The task tracking, planning, and code-review flows Claude Code already provides (TodoWrite, planner/code-reviewer agents, this PLAN.md) cover what's needed with far less overhead.
- Flagging this explicitly per the workspace rule — **let me know if you want any Ruflo feature enabled anyway** (e.g. its GitHub tools once a repo exists); otherwise it's skipped by default.

### Skills

| Skill | When |
|---|---|
| Refero / footer.design / dark.design (workspace design references) | Check before designing the HUD — even a minimal crosshair/ammo counter should look intentional, not like a tutorial default. |
| **`build-fix`** | If Vite/TS build errors come up mid-phase. |
| **`react-review` / `vue-review`** | Not applicable — no framework in this stack. |

### Agents

| Agent | When |
|---|---|
| **`planner`** | Already used for this plan; re-invoke if a phase needs sub-planning (e.g. Phase 7 enemy AI). |
| **`code-reviewer`** | Mandatory per global rules after every phase's code is written, before moving to the next phase. |
| **`typescript-reviewer`** | Same cadence — this is a 100% TypeScript codebase. |
| **`performance-optimizer`** | Bring in from Phase 3 onward (chunk streaming) and again post-v1 — frame budget and memory (dispose discipline) are the main risk areas in a browser 3D game. |
| **`security-reviewer`** | Low priority for v1 (no user input beyond local gameplay, no server); becomes relevant the moment WebSocket multiplayer is added. |
| **`tdd-guide`** | Useful for the pure-logic pieces: `utils/math.ts`, `utils/rng.ts`, `combat/damage.ts`, weapon stat resolution — not for the render loop itself, which is better verified by playing it. |
| **`doc-updater`** | Keep this PLAN.md and a future `CLAUDE.md` for the project in sync as phases land. |

---

## 8. Fable Model — How to Use It on This Project

Fable (`claude-fable-5`) has not been benchmarked by us yet on this codebase, so treat its use here as a **scoped experiment**, not a default. General approach:

- **Fable's role: creative/narrative-flavored subtasks, run in parallel with the core engineering (which stays on the main session / Sonnet).** Concretely:
  - Biome and terrain-feature naming/flavor for `world/biomes.ts` (Phase 3+)
  - Enemy/target archetype design and flavor text for `entities/enemies/` (Phase 7 and the "enemy AI behaviors" future extension)
  - Weapon names, descriptions, and HUD tooltip copy for `weapons/definitions.ts`
  - Player-facing UI copy: menu text, tutorial/onboarding hints, death-screen messages, score-event text
  - Brainstorming for the "future extensions" list — quest ideas, NPC dialogue, world lore — when those phases start
- **Fable's role explicitly does NOT include:** physics/collision code, the render loop, networking/multiplayer logic, or anything in `core/`, `physics/`, `world/` (mesh/collider generation), `combat/`. Those stay with the primary engineering flow — Fable's coding reliability on this kind of systems code is unproven, and getting it wrong here is expensive (crashes, desync, bad collision).
- **How to invoke it:** use the `Agent` tool with `model: "fable"`, scoped tightly to one creative deliverable per call (e.g. "write 5 enemy archetype names + one-line flavor text for a rolling-hills open world FPS, tone: grounded not cartoonish"). Fable's output for structured data (like a weapon stats table) should come back as plain values that Sonnet/the code-reviewer then wires into `definitions.ts` and schema-checks — don't let Fable write directly into gameplay-affecting code files unsupervised.
- **Pilot before relying on it:** first task for Fable on this project should be a small, low-stakes pilot — e.g. "name and describe 5 enemy archetypes" — so we can judge tone/quality/consistency before assigning it a bigger share of the content work. Log the result (good/bad, and why) so future sessions don't repeat the evaluation from scratch.
- **Where it slots into the phase plan:** Fable's first real task is naturally Phase 7 (enemy design) once Target/Enemy classes exist to hang the content on — earlier phases have no narrative surface for it to work on yet.

---

## 9. Final QA Pass — Instructions for Fable (End of Project / End of Each Content Phase)

At the end of v1 (and again at the end of any phase that added player-facing text or content), run a dedicated QA pass. This can be assigned to Fable specifically for the content/copy half of the checklist, paired with `code-reviewer`/`typescript-reviewer` for the code half:

**Content/copy checks (Fable):**
- [ ] No leftover placeholder/lorem-ipsum text anywhere in HUD, menus, or entity descriptions
- [ ] Spelling and grammar correct across all player-facing strings
- [ ] Tone is consistent across weapon names, enemy flavor text, and UI copy (no jarring register shifts between, say, a serious sniper description and a joke enemy name, unless that contrast is intentional)
- [ ] No generic AI-sounding filler copy — matches the "anti-template" bar from the workspace design rules: specific and intentional, not default-sounding
- [ ] Lore/naming is internally consistent (an enemy called "Ridgeback Marauder" shouldn't contradict a biome or backstory established elsewhere)
- [ ] All hardcoded player-facing strings are centralized (not scattered inline) so future localization isn't a rewrite

**Functional/code checks (code-reviewer / typescript-reviewer, standard per global rules):**
- [ ] No `console.log`/debug statements left in
- [ ] No `TODO`/`FIXME` left unresolved without a tracked follow-up
- [ ] No broken asset references (missing `.glb`/texture paths — verify via `chrome-devtools` MCP console, zero 404s)
- [ ] Chunk dispose discipline holds over an extended play session (no memory growth — verify via `chrome-devtools` performance/memory panel)
- [ ] Frame rate stays within target budget during streaming + combat (no dropped-frame stalls on chunk load)
- [ ] Pointer lock, ADS, and weapon switching all behave correctly after an Escape-then-reclick cycle (common browser-game edge case)
- [ ] Seeded RNG actually reproduces the same world/spawns given the same seed (determinism check, load-bearing for future multiplayer)

Any finding here gets logged back into this file's "Future Extensions" or a new "Known Issues" section rather than fixed ad hoc mid-pass, so v1 scope stays bounded.

---

## 10. Future Extensions (post-v1)

**Easy add-ons:** more weapons (data rows only, thanks to Phase 4's table), sound design (`PositionalAudio`), day/night cycle & weather, HUD/inventory/loot, difficulty/wave progression, save/load via `localStorage` (world is seed-derived), muzzle/impact polish.

**Moderate (interface design, not a rewrite):** enemy AI behaviors (state machine/behavior tree in `entities/enemies/`), melee (new weapon type using a hitbox sweep instead of hitscan), gamepad/mobile controls (new input sources feeding the existing action layer), destructible props (dynamic Rapier bodies), NPCs/quests, terrain LOD for longer view distances.

**Requires the architectural foresight already built into v1:** multiplayer via WebSockets — possible later specifically *because* of the fixed-timestep loop, seeded determinism, action-based input, and sim/presentation split established from Phase 0–1. Server would run `physics/`+`entities/`+`combat/` headless (Node + Rapier), client sends input actions, server simulates and broadcasts authoritative state. Candidate libraries then: `geckos.io` (WebRTC/UDP, better for fast FPS) or `ws`/`colyseus` (simpler WebSocket). Skipping determinism/seeding/action-input now would make this close to a rewrite later — which is why it isn't skipped.

---

## Success Criteria (v1)
- [ ] Playable from a deployed URL with no install
- [ ] Pointer-lock FPS controller: WASD + mouse-look, jump, gravity, terrain collision
- [ ] Procedural streaming terrain, seams matched, walkable indefinitely
- [ ] Two+ weapons, distinct stats, switching, smooth ADS, one scoped weapon
- [ ] Hitscan fire with recoil/spread; enemies/targets take damage, die, score updates
- [ ] Fixed-timestep sim, seeded RNG, sim/presentation separation in place
- [ ] No memory leaks over an extended session
- [ ] Final QA pass (Section 9) completed with no unresolved findings
