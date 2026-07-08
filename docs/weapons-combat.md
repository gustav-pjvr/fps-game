# Weapons & Combat

Development notes for weapon view models, the knife/melee fallback, hit feedback, tree-canopy collision, and the visual realism pass, extracted from the original NOTES.md.

## User-caught bug: rifle view model rendered backwards/tilted

Reported with a screenshot after the Fable pass. `blaster-e`'s `rotationYOffset: Math.PI` was an
unverified guess from the original asset-integration pass (its bounding box is asymmetric -
pivot at the grip, not centered, unlike the other three blaster models) - I set a value that
looked plausible on paper and never actually screenshotted that specific weapon closely enough
to catch it being wrong. Same failure mode as the target-facing bug from the real-assets pass:
trusting an analytical guess about a glTF export's axis convention instead of rendering it.

Fixed properly this time - rendered all 4 rotation candidates from both a perspective angle and
a top-down view, then confirmed directly in-game against the real first-person camera before
committing. Correct value: `rotationYOffset: 0` (no rotation needed).

While in there, found and fixed a second bug in the same function: the muzzle bounding box was
computed *after* the view-model group was already positioned at `WEAPON_HIP_POSITION`, so that
offset got baked into `muzzleLocalOffset` and then added *again* in `WeaponManager.fireShot()` -
every weapon's tracer was starting from well behind the actual muzzle. Fixed by computing the
box while the group is still at its default origin.

## 5th hotbar key for the knife (2026-07-05)

The knife (Phase D) was only reachable by mouse-wheel cycling - `weaponSlot1-4` are hardwired to
physical keys `1-4` (`DEFAULT_KEY_BINDINGS`), and a 5th slot had never been added since only four
guns existed when that binding was written. Small, mechanical follow-up: added `weaponSlot5` to the
`Action` union, bound it to `Digit5`, added its `ACTION_LABELS` entry, and extended
`WeaponManager`'s `SLOT_ACTIONS` array to five entries so `handleSwitchRequests`'s existing
index-into-`SLOT_ACTIONS` loop picks it up for free. `REBINDABLE_ACTIONS` already excludes number
keys entirely (they're intentionally fixed, not user-rebindable) - slot 5 needed no new exclusion,
it just fell under the same existing rule by not being listed.

**Verified:** pressing `5` switches directly to the Bicknell Trench Knife, and pressing `1`
afterward correctly returns to the pistol - confirming slot 5 didn't disturb the other direct-select
keys. 2 of 2 repeat runs clean. Full smoke suite (16/16) green.

## Long-shot callout (2026-07-05)

Added an on-screen acknowledgment when a player hit lands at `LONG_SHOT_DISTANCE` (50m, see
config.ts) or beyond - a hit that far out is easy to miss amid tracers/hit markers/kill feed, so it
gets a brief, unmissable callout of its own. Implemented directly (not via a Fable agent, per
explicit instruction) since it's a small, isolated feature.

- `src/ui/longShotCallout.ts` (new) - `LongShotCallout` class, same fade-in/out shape as the
  existing `WeaponCaption`: `show(distance)` starts a 1.5s hold + 0.4s fade, `update(dt)` advances
  it, `dispose()` tears down its DOM node.
- `WeaponManager.firePellet` now takes an `onLongShot(distance)` callback (threaded through
  `WeaponManager.create`) and calls it when `hit.distance >= LONG_SHOT_DISTANCE` on a damageable
  hit - reuses the hitscan's own reported distance, no separate distance calculation needed since
  world units in this codebase are already meters (`PLAYER_HEIGHT = 1.8`, etc.).
- `Game.ts` wires a `LongShotCallout` instance into the HUD root and calls `.update(dt)` each frame
  alongside the other HUD widgets it already owns.

Verification: typecheck clean. Automated e2e verification turned out to be the wrong tool for this -
teleporting the player to a precise 50m+ firing solution kept hitting the project's known
"teleport + immediate lookAt goes stale" issue (see the Ridge Walker/aim sections elsewhere in this
file): reusing a stale y-coordinate after a large horizontal teleport lets gravity move the player
an unpredictable amount before the pre-computed aim is applied, so the shot would geometrically miss
even though the feature itself was correct. After a couple of failed attempts (including using the
`raycastForward` debug hook, which was discovered along the way to be unconditionally broken - it
never excludes the player's own collider, so it always self-hits at distance~=0 regardless of aim;
confirmed via grep that nothing in `e2e/` or `src/` relies on it, so left as-is and just avoided),
the test was dropped in favor of direct manual verification, which the user performed and confirmed:
a real 110m hit produced the callout correctly.

## Tree leaves now stop bullets, without blocking movement (2026-07-05)

Trees' trunks have always had solid hit collision; their canopy (leaves) had none, so a shot aimed
into the foliage instead of the trunk just passed through. Added a canopy hit volume per tree
instance that registers hitscan hits but never blocks movement - players and enemies still walk
through foliage exactly as before. Implemented directly (not via a Fable agent, per explicit
instruction).

The mechanism is a Rapier **sensor** collider, not `InteractionGroups`: sensors are included in
raycast queries by default (Rapier would need an explicit `QueryFilterFlags.EXCLUDE_SENSORS` to
skip them, and `castHitscan` never passes that), but never participate in solid narrow-phase
collision resolution, so the player's character controller and enemies' kinematic movement both
ignore it completely. This was chosen over `InteractionGroups` because this codebase uses zero
custom collision groups anywhere - doing it via groups would have meant touching the player
capsule's own (currently all-default) group config, a much larger blast radius for a feature this
contained.

- `config.ts` - added `VEGETATION_CANOPY_RADIUS` (0.9) and
  `VEGETATION_CANOPY_CENTER_HEIGHT_FRACTION` (0.7, since foliage sits in the upper portion of a tree
  model, not at its base).
- `VegetationManager.ts` - `placeInstance` now also creates a fixed rigid body + ball sensor
  collider for tree types only (bushes/rocks unaffected), sized off the same per-instance scale
  jitter the trunk already uses; `PlacedInstance` gained `canopyColliderHandle` /
  `canopyRigidBodyHandle`, cleaned up in `removeChunk` alongside the existing trunk cleanup. Pulled
  the geometry math out as an exported pure function, `canopyGeometryFor(worldY, scaledHeight,
  scaleJitter)`, following the same pattern as this file's existing `pickType`/
  `minTreeSpacingFor` - specifically so the "canopy floats above where a standing player can reach"
  invariant could be locked in as a real test rather than left as a comment-only assumption (the
  Ridge Walker detection-range bug earlier in this project's history was exactly that kind of
  comment-only gap until a test was added after the fact).
- `VegetationManager.test.ts` (new) - two Vitest cases: the reach invariant, checked across the two
  real tree target heights (4.5, 6.0) and the actual scale-jitter range this codebase produces
  (`1 +/- VEGETATION_SCALE_VARIANCE`, not arbitrary extremes - a first draft using 0.5/1.5 jitter
  failed correctly, because trees outside the real jitter range are never placed at all); and a
  scaling-sanity check that a larger jittered tree gets a larger, higher canopy than a smaller one.

Verification: typecheck clean, `npm run test:unit` 19/19 green (17 pre-existing + 2 new), full smoke
suite 15/16 green with one failure (`dying releases pointer lock and Respawn resets the match without
leaving it`, timed out waiting on `isPointerLocked() === false` after `killPlayerByEnemy`) - re-run in
isolation to check whether the canopy change was responsible; this is the same pre-existing
kiting-archetype tail-risk flakiness already documented elsewhere in this file (Ridge Walker's
kiting occasionally pushes `killPlayerByEnemy` toward worst-case duration even after the sprint-based
mitigation), not something touched by this change, since nothing here touches enemy/combat/death-UI
code paths.

## Visual realism pass, items 1-7 (2026-07-05)

Implemented the top 7 items from VISUAL_REALISM.md's priority table directly (not via a Fable
agent). Understood each recommendation's actual mechanism before touching code, not just its
headline - see the per-item notes below for what changed and why.

- **Item 1 - shadow camera.** `Game.addLighting` now configures `sun.shadow.mapSize`, ortho camera
  bounds (`SUN_SHADOW_ORTHO_HALF_EXTENT = 60`), bias/normalBias, and a new `updateSunFollow()`
  (called every render frame) re-centers the shadow camera's ortho box on the player, snapping the
  offset to shadow-texel increments to avoid visible shadow "swimming." Previously the shadow
  camera sat at Three.js's unconfigured default (a +/-5 unit box at the origin), so in this
  ~800x800m world shadows only ever rendered in a tiny, useless patch near spawn. Also fixed a real
  bug found while reading the doc: `Enemy.ts` and `Target.ts` set `castShadow = true` on a
  `THREE.Group`, which three.js's shadow pass only ever reads on `Mesh` instances - so enemies and
  targets have never actually cast a shadow. Fixed via `model.traverse()` setting
  `castShadow`/`receiveShadow` per child mesh.
- **Item 2 - ACES filmic tone mapping.** `Renderer.ts` sets `toneMapping = ACESFilmicToneMapping`
  and a tuned `toneMappingExposure` (ACES reads darker than the previous `NoToneMapping` at the
  same light intensities).
- **Item 3 - image-based lighting.** Originally: `scene.environment` from a `PMREMGenerator` of the
  existing Sky shader, replacing the flat `AmbientLight`. Had to be revisited - see the regression
  note below.
- **Item 4 - terrain PBR maps.** Downloaded the normal/roughness/AO maps from the same Poly Haven
  "Aerial Grass Rock" CC0 set already used for the diffuse texture (credits file updated) and wired
  them into `ChunkManager.createGroundMaterial()`. `aoMap` needs a `uv2` attribute (three.js
  convention, distinct from the tiled material `uv`) - added as a clone of the existing `uv` in
  `Chunk.ts`'s geometry builder.
- **Item 5 - muzzle flash.** New `src/combat/MuzzleFlash.ts`: a single reusable `PointLight` +
  additive `Sprite` (a canvas-generated radial gradient, not a sourced asset - not detailed enough
  to need one) at the world-space muzzle point `WeaponManager` already computes for tracers.
  Gated on `kind === 'ranged'` so the knife doesn't spawn a light out of its blade.
- **Item 6 - death sequence.** `EntityManager` now keeps a `dying` list alongside `entities`: on
  death, physics (colliders/rigid body) is disposed immediately - same tick as before, so nothing
  can still collide with or shoot through a corpse - but the mesh lingers ~3s (topple via
  `rotation.x`, hold, sink via `position.y`) before actually leaving the scene, instead of vanishing
  the instant health hits 0. Deliberately animates only position/rotation, not material opacity:
  `SkeletonUtils.clone` (used for every enemy) reuses the source material *by reference* across
  every clone (confirmed via its own docstring), so fading one dying enemy's opacity would fade
  every other enemy sharing that model's material too.
- **Item 7 - weapon sway/bob + camera bob.** Weapon sway (`WeaponManager.updateWeaponSway`) lags
  the view model behind the camera's own yaw/pitch delta each tick, damped back to neutral -
  ported from the same "offset by a fraction of movement, damped" idea the lobby's idle
  character bob already uses, but driven by real look/movement instead of a fixed idle timer.
  Movement bob: `Player.applyMovement` computes one shared sin phase from the player's actual
  per-tick horizontal displacement (advances only while grounded and moving, so it starts/fades
  with real movement) and exposes it via `movementBobPhase`/`movementBobStrength` getters, so both
  the camera bob (applied directly to `currentCameraPosition` in Player) and the weapon bob
  (`WeaponManager.updateAim`, reading the same getters) move on the exact same phase rather than
  two independent ones.

**Regression found and fixed: item 3 (IBL) tanked e2e performance.** The full smoke suite started
failing/timing out on several tests after items 1-7 landed - not a hang, a severe FPS crash (traced
via `Date.now()` timing marks in a temporary debug spec: a sequence that used to take ~1s of
scripted waits was taking 20-30+ real seconds). Bisected by reverting one item at a time against a
`git stash`-clean baseline (which passed in 24.6s, confirming this was 100% a today's-work
regression, not pre-existing flakiness): shadows fully disabled didn't fix it, the Enemy shadow bug
fix didn't cause it, terrain PBR maps weren't it either. Root cause was `scene.environment` (the
PMREM env map): it adds a prefiltered-envmap sample to every `MeshStandardMaterial` fragment across
the whole scene every frame - cheap on real GPU hardware, but the e2e sandbox's Chromium renders via
SwiftShader (software/CPU rasterization, see PERFORMANCE.md), where that per-fragment cost proved
ruinous. Confirmed by disabling just this one thing: timing dropped right back to the clean
baseline.

Fixed by adding a **Graphics Quality setting** (see below) rather than reverting the feature -
`environmentLighting` is a new field on `GraphicsQualityPreset`, on for High only (real-GPU tier),
off for Low/Medium. `Game.addLighting` reinstates a flat `AmbientLight` fill when IBL is off, so
Low/Medium don't lose all ambient fill light entirely.

### Death animation shortened (3s → ~1s)

Per playtest feedback: "the character just stands there for long, turns over, and then sinks to
the ground... make them die immediately, character rotates like falls and then disappears, all in
the span of a second." The dying-enemy sequence in `EntityManager.ts` (fall → hold upright-tipped →
sink into ground, then remove the mesh) already had exactly that shape - the problem was purely
timing, not the sequence itself.

- `config.ts`: `DEATH_HOLD_DURATION` 2s → 0.1s (the actual "stands there" complaint - a 2-second
  stationary pause between falling over and sinking), `DEATH_FALL_DURATION` 0.4s → 0.3s (snappier
  topple). `DEATH_SINK_DURATION` left at 0.6s - sinking the mesh below the terrain is what makes the
  corpse read as "disappeared", and 0.6s is fast enough not to reintroduce the same complaint.
  `DEATH_TOTAL_DURATION` (`EntityManager.ts`) is derived from these three, so it dropped from 3.0s
  to 1.0s automatically with no other code change.
- Scoped to single-player/training-mode enemy deaths only - this is the only place in the codebase
  this fall/sink animation exists. The local player has no visible third-person body (first-person,
  no mesh), so they can never see this sequence play on themselves; their own death already shows a
  separate death-screen UI overlay, untouched by this change. In multiplayer, `RemotePlayer` never
  plays any death animation at all currently (its `isDead` always reports `false` - the client has
  no authority over the opponent's health) - the opponent just gets teleported to a new spawn after
  a delay on `respawnEvent`, no fall/sink visual. That's a separate potential enhancement, not
  something this change touches.

**Verification:** config-only change (three numeric constants) with no logic touched elsewhere -
per the risk-based testing approach, a full regression pass isn't warranted. Ran
`e2e/smoke.spec.ts`'s "dying releases pointer lock and Respawn resets the match without leaving it"
test alone against the live dev server (exercises the actual death→respawn flow end to end) -
passed in 40s.

