# Goose-Buster

Development notes for the exploding-goose mini-game, including host-authoritative multiplayer sync and the Nuke difficulty tier, extracted from the original NOTES.md.

## Goose-Buster: exploding goose mini-game, host-authoritative multiplayer sync, and a real playtest round of bugs

Per user request: rename the in-game title to "Goose-Buster" and add a wandering goose NPC that
takes exactly 2 bullet hits to kill, then explodes with a distance-based damage falloff. Explosion
difficulty (Easy/Normal/Extreme, controlling blast radius and max damage) is editable in
single-player Match Setup, multiplayer Create Room, and multiplayer rematch settings - all three
share the same options list/labels (`GOOSE_EXPLOSION_DIFFICULTIES`/`_LABELS` in `config.ts`).

**Asset decision.** No existing model fits and this project's own precedent for non-hero geometry
(crates, ladders, rocks, targets, the knife weapon) is to build procedurally rather than source a
new asset - the goose (`entities/Goose.ts`) is entirely THREE primitives (spheres/cylinders/cones/
boxes), with a code-driven waddle (sine bob + rock, no rig) standing in for a walk cycle.

**Multiplayer is genuinely new plumbing, not a copy of anything else.** Before this, multiplayer
had zero PvE/AI-entity sync of any kind (`enemyCount`/`targetCount` are hard-set to 0 there). The
host runs every goose "authoritative" (spawn, wander AI, hit counting, explosion decision) and
broadcasts `gooseSpawned`/periodic `gooseSnapshot`/`gooseExploded`; a guest mirrors each as a
"follower" `Goose` (real collider, so the guest's own local hitscan still registers a hit, but a
hit just reports itself via `gooseHitEvent` rather than self-adjudicating - only the host's copy
decides death). Difficulty rides on `MatchStartMessage`/`WelcomeMessage.activeMatch` exactly like
`killLimit` already does (same trust model: host decides once, sends it, nobody validates it).

**Real bugs found by the user's own live 2+ guest playtest, not by automated testing** (this
project's established pattern: build carefully, verify what's cheaply verifiable, then trust the
user's hands-on report over guessing at what a live multi-peer WebRTC session actually does):

1. **Guests never saw the initial batch of geese.** The host was spawning them (and sending
   `gooseSpawned`) during its own `Game.create()`, well before that guest's *own* `Game.create()`
   had finished loading and attached its message handling - the messages were sent into a void.
   Rather than try to guess/fix the exact timing, added a `gooseSyncRequest` message: every guest
   sends it once, right after its own connection callbacks are wired up, and the host replies with
   its *current* goose list via targeted `sendTo`. This is strictly additive (`applyRemoteSpawn` is
   already idempotent on a known id) and, as a bonus, is also the fix for late-join/rejoin backfill
   (a gap flagged but deliberately deferred in the original pass) - a late joiner is just another
   guest whose own `Game.create()` finishes and asks the same question.
2. **A paused host silently stalled every player's geese** until unpausing, at which point
   everything that "should" have happened caught up and fired all at once (explosions included).
   Root cause: `physics.step`/`entityManager.update`/`gooseManager.update` were all gated behind
   the same "frozen while paused" branch as the player's own movement/weapon input. Per user
   request ("no matter whatever guest or host is in pause menu they must still be able to have
   anything happen"), split that gate: the player's own control input still freezes while paused,
   but the shared simulation (physics world, host-authoritative goose sim) now runs unconditionally
   in multiplayer regardless of local pause/death state. Single-player keeps the old full-freeze
   behavior (nothing else is "live" to notice there).
3. **The death/respawn screen could visually overlay the pause menu** (multiplayer only - a death
   mid-match, e.g. from network damage, can land while the local player has the pause menu open;
   single-player can never reach this since pressing pause already short-circuits its own update
   loop before death detection). Fixed by deferring the *reveal* (not the death itself - scoreboard
   credit, goose-spawn trigger, and the network broadcast all still happen immediately) until the
   player actually resumes: `pendingDeathScreenReveal` + a new `deathScreenVisible` field, which
   also had to replace `player.isDead` in the `isPaused` formula itself (the old formula treated
   "dead" and "paused" as mutually exclusive, auto-hiding the pause menu the instant death was
   detected - exactly the opposite of "stay open until the player deliberately resumes"). The
   auto-respawn timer (`updateMultiplayer`) still fires on schedule regardless of pause (other
   players are watching it happen), but no longer forces pointer lock back if the pause menu is
   still legitimately open when it does.
4. **No explosion sound** (there was no AOE/explosive sound of any kind in this codebase before the
   goose). Added `SoundEngine.playExplosion` - fully procedural like every other non-weapon sound
   here (footstep/hit-confirm/player-hurt), a longer/lower noise burst plus a sawtooth thump so it
   reads as a detonation rather than another gunshot. Distance-attenuated and stereo-panned the
   same way opponent gunshots already are (`enemyGunshotVolume`/`computeStereoPan`).
5. **Extreme lag once two guests connected.** Root cause, confirmed by re-reading Enemy.ts's own
   comment on why it caches terrain height ("4-octave fBm + a 9-cell Worley scan per call"): Goose
   movement called `sampleHeight` raw, every frame, for every live goose, with no caching at all -
   unlike Enemy.ts, which resamples only after `HEIGHT_RESAMPLE_DISTANCE_SQ` of movement. Up to
   `GOOSE_MAX_CONCURRENT` (8) geese doing that uncached at 60fps, layered on top of the connection
   count going from 1 to 2 guests (more relay traffic, more RemotePlayer/physics load overall), is
   the likely explanation. Fixed by copying Enemy.ts's exact caching pattern into `Goose.ts`. Goose
   snapshot broadcast rate (`GOOSE_SNAPSHOT_SEND_INTERVAL`, 1/6s) and the whisker-avoidance raycasts
   inside wander AI were reviewed too and look reasonable at this scale (≤8 geese) - not touched.

**Verification:** `npx tsc --noEmit` clean, `npm run test:unit` full suite green, `npm run build`
succeeds. UI changes (difficulty selectors in all three locations, panel widened not lengthened)
confirmed via screenshot. The multiplayer fixes above are confirmed by the user's own report of
what broke in a real 3-peer session, not re-verified end-to-end by a fresh multi-browser test on my
end for this round - worth a follow-up two/three-browser check if anything here still reads wrong
live.

**Goose "Nuke" difficulty + rebalance.** Added a 4th `GooseExplosionDifficulty` ('nuke': radius 45,
maxDamage 500 - `computeExplosionDamage`'s existing linear falloff means this reads as "anyone in
the blast dies" without needing a separate instant-kill code path) and bumped the other three
tiers' damage ~15-20%. Confirmed via the earlier difficulty-list research that every consumer does
a generic keyed lookup/loop - no other file needed touching.

## Explosion knockback, King of the Hill, and Goose Horde (v3.3.0)

**Knockback.** Every goose explosion (Goose Toss throws, a wandering goose's own death, and Horde's
contact explosions below) now pushes nearby players back, same linear falloff shape as damage
(`computeKnockbackStrength` in `combat/explosion.ts`, paired per-tier with
`GOOSE_EXPLOSION_PRESETS` via a new `GOOSE_EXPLOSION_KNOCKBACK_STRENGTH` record). The player
controller is a kinematic capsule with no dynamic-body physics to hand a real Rapier impulse to, so
this is implemented as a manually-decaying knockback velocity (`Player.applyKnockback`,
`KNOCKBACK_DECAY_PER_SECOND`) added on top of normal movement each tick and exponentially bled off
- the same shape `recoilPitch` already uses for a temporary camera kick layered on top of aim.

**King of the Hill.** A new multiplayer mode: full arsenal for everyone (unlike Goose Toss's
unarmed loadout), racing for a single golden goose spawned at the exact map center - which
`pickMultiplayerSpawnPoints`'s existing spawn ring already surrounds equidistantly for any player
count, so no new placement math was needed. `GoldenGooseManager` (new, deliberately not a
`GooseManager` reuse - it has none of the exploding goose's hit-count/explosion behavior, it's a
carry-only prop) owns position + carrier slot. Picking it up (E) doesn't disable the whole
`WeaponManager` the way Goose Toss's `unarmed` loadout does - instead `updateGoldenGoose` consumes
just the `fire` action while carrying (to drop it), mirroring but narrower than Goose Toss's
input-consumption trick, so aim/reload/switch still work. Dying while carrying auto-drops it at the
death position. Scoring is new, continuous infrastructure this project didn't have before: 1 point
per second held, self-reported and broadcast once/second (`kothScoreTick`) rather than piggybacked
on the existing kill-count `applyPlayerDied` path, synced into the same `multiplayerScoreboard` map
every other mode already uses. First to 90 wins. The HUD's scoreboard renders as point bars (a new
`MultiplayerHud.update()` parameter) instead of the plain kill-count list, with a crown marker on
whoever's currently carrying it.

**Goose Horde.** A wave-survival mode, single-player (a `PlaySetupModal` toggle, ignoring the
enemy/target counts) and multiplayer (co-op, `gameMode: 'gooseHorde'`) alike - the first mode to
actually replace the passive wandering-goose AI with something aggressive. `HordeGoose` (new,
parallel to - not a subclass of - both the passive `Goose` and the GLTF/archetype-coupled `Enemy`)
reuses `Enemy`'s own chase-steering primitive (`steerWithAvoidance`, the exact function Enemy
itself calls) plus `Goose`'s procedural mesh, always heading straight for whichever target position
it's given and exploding on contact - no idle/alert/search states, it aggros immediately. Three
flavors rolled per spawn from that wave's chances: **walker** (plain chase), **jumper** (a
close-range speed-burst "suicide rush" tell), and **flyer** (spawns airborne and dives straight
down - genuinely new movement code, since no airborne-entity pattern existed anywhere in this
codebase before). A horde goose dies in exactly one hit from any weapon, unlike the normal
2-hit-to-kill wandering goose - "shoot or dodge" needs to stay decisive under wave-10 pressure, not
add a second bullet-sponge layer.

10 waves (`HORDE_WAVE_TABLE` in `config.ts`), each escalating count/speed/jumper-flyer mix, capped
at `HORDE_MAX_CONCURRENT` (18) concurrently alive with the rest of a wave queued to trickle in as
earlier geese die - not an explicit request, but necessary so wave 10's "a lot" doesn't tank frame
rate; the queue keeps pressure constant instead of dumping the full count on the map at once. Wave
10 (30 geese, double base speed, 60%/40% jumper/flyer mix) reaches player sprint speed, deliberately
climactic. Clearing all 10 waves is the win condition (`HordeGooseManager.onCleared`); a
single-player death is handled by the existing `DeathScreen` path unchanged, and a multiplayer
death just respawns normally (co-op doesn't end the match on one player's death, matching typical
horde-mode conventions where a downed teammate gets back up, not instant game over).

Multiplayer reuses the exact host-authoritative spawn/snapshot/hit/explode pattern already proven
for Goose Toss's ambient flock (`hordeGooseSpawned`/`hordeGooseSnapshot`/`hordeGooseHitEvent`/
`hordeGooseExploded`/`hordeGooseRemoved`, plus two new host-broadcast wave-state messages,
`hordeWaveStarted`/`hordeCleared`) - `HordeGooseManager` takes an explicit `isAuthoritative` flag
(constructor param) rather than relying solely on the per-goose follower-mode trick GooseManager
uses, because Horde's wave/spawn-queue state is manager-level, not per-entity - without that flag a
guest's own copy of the manager would independently roll its own spawns and desync from the host's
actual flock, which the per-goose trick alone doesn't prevent.

**Known, deliberate simplification:** no late-join sync for Horde (unlike Goose Toss's
`gooseSyncRequest`) - a player joining a horde match already in progress only sees geese spawned
from that point on. This mode wasn't asked to support mid-match joining the way the PvP modes are,
and adding it would mean tracking/replaying wave state for a join path this mode doesn't otherwise
need.

**Verification:** `npx tsc --noEmit` clean, `npm run test:unit` (new `computeKnockbackStrength`
tests, full existing suite green), `npm run build` succeeds. Live playtest of all three features
(2-browser multiplayer for weather/KOTH/Horde co-op, single-player for Horde's full 10-wave run)
not yet performed by me for this round - worth doing before considering this batch fully signed
off, per this project's own established preference for live verification over trusting green
tests/build alone on gameplay-feel features.

## Bonus golden goose + Goose Launcher (v3.4.0)

Per user request: a single rare "golden goose" - single-player and every multiplayer mode except
Goose Toss (unarmed, nothing to shoot it with) - that spawns at a random point after a random delay
(`BONUS_GOOSE_MIN/MAX_RESPAWN_DELAY_SECONDS` in `config.ts`), announced with a big center-screen
banner (new `ui/bigAnnouncement.ts`, distinct from the small top-center `GooseAnnouncement` toast
used for routine spawns). Still takes `GOOSE_HITS_TO_KILL` (2) hits like any wandering goose, but
doesn't explode or deal damage on death - it's a reward mechanic, not a hazard.

**Hit attribution is the actual new problem this needed to solve.** Every existing goose (normal,
Horde) only ever needed a hit *count* - who fired which hit never mattered. This one needs to
remember *which slot* landed the *final* hit specifically, so the right player gets the reward when
two different players land the two hits. `entities/BonusGooseManager.ts` solves this by reusing the
plain wandering `Goose` class's existing "follower" hit-report callback *unconditionally*, even on
the authoritative side - normally that callback is guest-only (a follower goose reports a hit for
the host to adjudicate instead of deciding death itself), but repurposing it universally means
`Goose.takeDamage` never decides death on its own here; it just reports "a local hit landed," and
`BonusGooseManager` is the one place that counts hits *and* records `lastHitSlot` before deciding
death - so attribution is never lost, whether the hit was the local authoritative player's own shot
or a guest's remotely-reported one. Multiplayer host-authoritative sync mirrors GooseManager's
proven spawn/snapshot/hit/killed pattern (`bonusGooseSpawned`/`bonusGooseSnapshot`/
`bonusGooseHitEvent`/`bonusGooseKilled`), with `killerSlot` carried on the kill broadcast so every
client (including the host's own) can locally decide "is this my reward."

**Goose Launcher** (`weapons/definitions.ts`) is the reward - a real ballistic projectile weapon,
not instant hitscan like every other gun. Rather than build a second projectile system, it reuses
`ThrownGoose` (previously Goose Toss-only) directly: `ThrownGoose`/`GooseThrownMessage`/
`GooseThrowExplodedMessage` all gained a `source: 'gooseToss' | 'gooseLauncher'` field so one
shared class/message pair/`updateThrownGeese` loop serves both triggers, distinguished only by
which balance constants and reward path apply on landing (`resolveGooseTossExplosion` renamed to
`resolveThrownGooseExplosion` accordingly). `WeaponDefinition` gained two new generic flags for
this: `isProjectile` (routes `WeaponManager.fireShot()` into a projectile spawn instead of the
normal per-pellet hitscan loop) and `disableReload` (`Weapon.startReload()` always fails) - both
written as generic weapon-level flags, not goose-launcher-specific branches, in case a future
weapon wants either behavior independently. `WeaponManager.grantBonusWeapon(bonusId, restoreId)`
hard-swaps the active slot (same shape as Gun Game's `replaceActiveWeapon`) and remembers
`restoreId`; `update()` checks every tick for "active weapon has disableReload and 0 ammo" and
auto-reverts, so the launcher disappears the instant its 4th shot fires with no manual step. Kills
with it flow through the exact same `damageEvent`→`playerDied`→`applyPlayerDied` pipeline Goose
Toss's throws already use (per explicit user request: unlike an ordinary field goose, dying to a
Launcher shot DOES count toward the shooter's score).

**Verification:** `npx tsc --noEmit` clean, full `npm run test:unit` suite green, `npm run build`
succeeds. Not yet live-playtested (single-player golden-goose-kill-to-launcher flow, and a
2-browser multiplayer session confirming correct kill-hit-attribution when two players land the two
hits) - same "trust the user's live test over assuming from a clean build" pattern as every other
gameplay-feel feature in this project.

