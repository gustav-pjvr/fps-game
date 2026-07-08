# Dev Notes — Index

This file used to be one long chronological development log. It has been split into one file per
system/process for easier reference. Each file preserves its original entries verbatim, in
chronological order.

- [World Generation](world-generation.md) — terrain bounds, ground texture/sky/fog, vegetation,
  buildings, zones/towns/forests, roads, ladders/crate staircases, watch towers, world sizing.
- [Enemy AI](enemy-ai.md) — the enemy AI overhaul (goal-directed patrol, aggro/line-of-sight,
  ranged combat, melee fallback, measurement-driven tuning) and per-archetype enemy loadouts.
- [Weapons & Combat](weapons-combat.md) — weapon view model fixes, the 5th hotbar/knife slot,
  long-shot callout, tree-canopy bullet collision, the visual realism pass, and death-animation
  timing.
- [Multiplayer](multiplayer.md) — the room-code connection layer, world/movement sync, combat
  sync, match lifecycle, playtest fixes, spawn points, TURN fallback, multiplayer polish, and the
  post-launch lobby-crash/game-modes/audio batch.
- [Goose-Buster](goose-buster.md) — the exploding-goose mini-game, host-authoritative multiplayer
  sync, playtest bug fixes, and the Nuke difficulty tier.
- [UI & Lobby](ui-lobby.md) — the lobby redesign, death screen repositioning, and the motion/UI
  polish pass.
- [Performance](performance-notes.md) — the frame-rate headroom investigation, in-game performance
  overlay/tooling, and the Graphics Quality setting. (Not `performance.md`/`PERFORMANCE.md` — this
  repo's existing `docs/PERFORMANCE.md` playbook already owns that name, and Windows' case-insensitive
  filesystem treats the two as the same file.)
- [Changelog & Foundations](changelog-foundations.md) — early v1 foundational notes (Fable pass,
  real assets pass, content pass, playtest triage) and the whole-codebase review follow-through.

For the versioned release history shown in the main menu (v1.0.0 onward, what changed at each
version and why), see [CHANGELOG.md](CHANGELOG.md) instead - that's a different document from the
files above, which are development-process notes rather than a version history.
