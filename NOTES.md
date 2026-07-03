# Playtest Notes — v1 (Phases 0-7) + Phase 8 + Content Pass + Real Assets

Feedback from the first playtest, triaged into: real bugs, missing pieces that belong in v1's
own combat loop, and things that were deliberately deferred past v1 per PLAN.md.

## Real assets pass (step 2) — Kenney CC0 models, and a big rendering bug found by using them

Sourced free CC0 assets per PLAN.md's asset pipeline instead of guessing at URLs: found current
download links via web search + fetch, downloaded and inspected the actual zip contents rather
than assuming file layout.

- **Weapons**: Kenney "Blaster Kit" - blaster-h (pistol), blaster-e (rifle), blaster-p (shotgun),
  blaster-f (sniper), target-large (replaces the placeholder sphere target). `viewModel.ts` is
  now data-driven per weapon (path/scale/rotation in `WEAPON_MODEL_SPECS`), and `WeaponManager`
  became an async factory (`WeaponManager.create`) since loading .glb files is async - same
  pattern as `PhysicsWorld.create()`. Also downloaded `scope-large-a.glb` from the same pack as
  a candidate scope attachment for the sniper's view model, but did not actually wire it in this
  pass (the sniper's full scope-overlay UI from Phase 5 already covers "looking through a
  scope"; the model attachment would only be a cosmetic addition visible before full ADS) -
  it's sitting in `public/assets/models/weapons/` unused, worth picking up later.
- **Enemies**: Kenney "Mini Characters" - character-male-a.glb, which comes rigged with 30+
  animation clips. Enemy now uses `SkeletonUtils.clone` (not a plain `.clone()` - required for
  skinned meshes, a plain clone shares the skeleton and breaks every instance but the first) and
  an `AnimationMixer` crossfading between "idle" and "walk" clips based on movement state.
- New `src/core/AssetLoader.ts`: caches `GLTFLoader.loadAsync()` promises per path so multiple
  entities sharing a model (5 targets, 3 enemies) only fetch/parse it once.

**Found via this work, not before it: the weapon view model was never actually rendering.**
`camera.add(weaponGroup)` parents the gun to the camera object, but `Renderer.ts` never added
the camera itself to the scene - `renderer.render(scene, camera)` only traverses the `scene`
graph, so anything parented to a camera that sits outside that graph silently never renders,
even though every other property (position, visible, scale) looks completely correct on
inspection. This means **the placeholder box-gun was never visible either**, the whole time,
across every prior phase and screenshot - it just wasn't obvious with primitive shapes bottom-
right of frame the way it became obvious once a detailed, textured model was expected there and
nothing showed up. Fixed with one line (`this.scene.add(this.camera)`) in `Renderer.ts`.

Also found and fixed while wiring the real target model: the "bullseye" hit-bonus collider was
initially placed **concentric** with the body collider (same center, smaller radius) - which is
geometrically unreachable by any ray, since a smaller sphere fully enclosed in a larger one
always has the outer sphere's surface as the closest intersection point. No ray could ever reach
it. Fixed by offsetting it to protrude slightly toward the viewer instead.

Verified all of this the same way as the self-hit bug: build a hypothesis, check it with a
throwaway script against the live game (screenshots, scene-graph inspection via a temporary
debug hook, a rotation comparison render), not by reasoning about Three.js/glTF conventions from
memory. The target model's correct facing rotation in particular came out backwards from the
first analytical guess (rotation.y = π/2 looked right on paper, was wrong in practice) and was
only nailed down by rendering four candidate rotations side by side and reading off the one that
actually showed the painted face.

## Content pass (post-Phase 8) — what changed and one deliberate non-change

Added: Assault Rifle (automatic, data-driven via a new `automatic` flag - holding fire uses
`isActionActive` instead of edge-triggered `consumeJustPressed`) and Shotgun (`pelletCount: 8`,
each pellet an independent hitscan ray within a wide spread cone, one recoil kick per trigger
pull not per pellet). Enemy AI gained idle/wander (stays within `ENEMY_WANDER_RADIUS` of spawn)
vs. chase (only once the player is within `ENEMY_DETECTION_RANGE`, with a wider `ENEMY_LEASH_RANGE`
for hysteresis) instead of always beelining from anywhere on the map. Sound design is fully
procedural (Web Audio synthesis in `src/audio/SoundEngine.ts` - noise bursts + oscillators, no
audio files) for gunshots (per-weapon timbre), footsteps, hit confirmation, reload, and taking
damage.

**Deliberately did not tune ADS numbers** (`ADS_LERP_SPEED`, sensitivity-by-zoom-ratio) in this
pass - there's no concrete feedback yet on how it actually feels post-fix (the original "aim
doesn't work well" report predates the self-hit bug fix and the hit-confirmation additions, both
of which likely explain most of it). Guessing at number changes without data risks being a
placebo fix. Extended the Playwright suite instead (ADS FOV narrows/restores, automatic fire,
enemy wander-vs-chase) so there's a harness to verify actual tuning changes against once real
feedback comes in.

## Update — root cause of "enemies don't get killed" found (via Playwright, post-Phase 8)

Added a Playwright e2e suite (`e2e/`) so tests could be run directly instead of reasoning from
code. The very first "aim at a target and kill it" test failed - and the cause was a genuine,
previously-undiscovered bug, not a missed-shot/no-feedback issue as guessed below:

**`WeaponManager.fireHitscan()`'s ray origin (`camera.position`) sits inside the player's own
capsule collider**, so without an exclusion filter the ray immediately self-hit at distance 0
on every shot. `isDamageable()` was a pure structural check ("has a `takeDamage` function"), and
`Player` also grew a `takeDamage()` method in Phase 8 for its own health system - so the player
satisfied that check and got hit by their own gunfire, every single shot, since Phase 8 was
added. Shots never reached real targets/enemies at all.

Fixed: `castHitscan()` now takes an `excludeCollider` param (Rapier's own
`filterExcludeCollider`), and `Damageable` now uses a nominal `isDamageableTarget: true` marker
instead of structural typing, so `Player` can't accidentally match it again just by having a
same-shaped method. See commit for full detail.

This means the *pre-Phase-8* "enemies don't get killed" report (below) can't have had this exact
cause (Player didn't have `takeDamage` yet), but it's the same symptom and this bug would have
made it persist regardless of any other fix. Worth actually playtesting again now that both the
original hit-feedback gap (Phase 8) and this self-hit bug are gone.

## Bugs found (investigated after feedback)

- **Hitscan ray origin was one frame stale.** `WeaponManager.fireHitscan()` used
  `camera.getWorldPosition()`, which reads from the camera's cached world matrix - only
  refreshed during `render()`, which runs *after* that tick's fire/movement logic. Since the
  camera has no parent, `camera.position` is already correct and doesn't have this staleness.
  **Fixed** (`src/weapons/WeaponManager.ts`). Effect was small (a few cm of origin error, one
  frame behind player movement) - unlikely to fully explain missed shots on its own, but it was
  a genuine correctness bug and is now gone.

## Reported as broken, likely explained (not yet visually confirmed - no browser access here)

- **"Can't change guns."** Traced the switch logic end to end (`WeaponManager.handleSwitchRequests`
  / `updateSwitching`) and it looks correct - number keys and scroll should both work, and the
  HUD's weapon-name/ammo text should update. Best explanation: **both weapons use the exact same
  placeholder mesh** (`createPlaceholderWeaponMesh()` takes no weapon-specific input), so a
  successful switch is visually silent. Likely not a logic bug so much as a "you can't see it
  worked" problem.
- **"Enemies don't get killed."** Damage/death code (`Target.takeDamage`, `Enemy.takeDamage`,
  `EntityManager.update`) looks correct on read-through, and the collider registry (verified
  empirically back in Phase 7) resolves hits to entities properly. No hit confirmation exists
  anywhere (no hit marker, no damage number, impact marker is a tiny 0.04-radius dark sphere
  that's easy to miss against terrain) - so there's currently no way to tell "did that shot even
  land" from "did I miss." This is the most likely explanation, but it's also possible some
  shots really were landing on terrain/rocks first (LOS blocked by hills at the 15-25 unit spawn
  ring) - can't fully rule that out without a live test.

## Missing pieces that belong in v1's combat loop (scope gap, not "future extensions")

The original plan's Phase 7 only covered the player shooting entities - it never gave enemies
a way to threaten the player back, which is why this doesn't feel like real combat yet:

- No player health / no way to die
- Enemies never attack or damage the player - they just walk up and stand there
- No visible feedback that a shot landed (hit marker, damage number, brighter/bigger impact FX)
- No tracer/visible bullet path (intentional for hitscan, but with zero visual travel and a
  barely-visible impact dot, shots feel like they vanish)
- Weapon switch has no visual distinction between weapons (see above)
- No reload animation/cue beyond the HUD text flipping to "RELOADING…"
- ADS "feel" - ADS_LERP_SPEED / sensitivity-by-zoom-ratio tuning has never been playtested,
  only read-through-verified

## Confirmed working as designed (placeholder-quality, not bugs)

- Graphics/animations "scuffed" - expected, all placeholder box/sphere/capsule primitives per
  the plan's free-asset section (nothing from Kenney/Mixamo/Poly Haven has been sourced yet)
- No gun view model animation (fire kick exists via recoil, but no reload/draw animation clips -
  there's no rigged model to animate)

## Explicitly out of v1 scope (per PLAN.md's own Future Extensions section)

- Lobby - implies multiplayer, which PLAN.md explicitly deferred ("requires architectural
  foresight now" but not implemented in v1)
- Settings menu - never in the phase list
- Weapon/player skins - cosmetic customization, not in the phase list

None of these were overlooked - they were intentionally out of the original 8-phase scope.
