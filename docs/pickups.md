# Pickups (v4.4.0)

Health packs, ammo boxes and grenade crates that stand on the map and return after a while. The
design is `docs/squad-arsenal-night.md` section 5; this file describes what was built, where it
differs from that design, and the numbers to tune. Code is in `src/pickups/`.

## What a player sees

- A small floating model (red cross case, olive ammo box, grenade crate) that turns and bobs over a
  soft glowing ring on the ground. The ring uses the HUD accents: mint for health, amber for ammo,
  the threat red for grenades. Only pickups within 75 m of the player are drawn.
- A taken pickup hides its model and glow and leaves a faint rim where it will return.
- Walking onto a pickup shows a line ("+40 HEALTH" and so on) through the goose announcement and
  plays a short sound per kind.
- The Facility minimap shows a small icon for each available pickup within 25 m (plus for health,
  square for ammo, diamond for grenades, in the ring colours).

## Rules

- Walk-over reach is 1.4 m horizontally, and the player's centre may differ from the pickup's
  centre (ground plus 0.7 m hover) by at most 1.6 m vertically, so a pickup under a tower stair is
  not taken from the stair.
- A pickup that would give nothing is walked past and stays for someone who needs it: health at
  full health, ammo when every gun is full, grenades at the cap.
- A dead player (or one frozen behind an end screen) takes nothing, and a health pack never
  revives.
- **Health pack:** +40, capped at the player's maximum.
- **Ammo box:** for each carried gun, one magazine into a finite reserve (Goose Horde multiplayer),
  never past 6 magazines; for a gun with unlimited reloads (every other mode) it tops up the
  magazine instead, unless a reload is already doing that. The knife, empty hands and the Goose
  Launcher reward never take a box.
- **Grenade crate:** +1 of the kind the player carries (the loadout's frag or flash, one count), up to
  the cap of 3 (`GRENADE_MAX_COUNT`); the pickup line reads `+1 FRAG` or `+1 FLASH`. At the cap the
  crate is left on the map (`wouldGive` says no). The Game passes `grenadeSupplyFrom(() => game.grenades)`, backed by the match's GrenadeSystem, and
  crates are placed only in modes where `grenadesEnabled` is true (docs/grenades.md).
- **Respawn:** health 30 s, ammo 25 s, grenades 45 s.
- **Modes:** Knife Only and Goose Toss place health packs only. Goose Horde's own ammo drops are
  unchanged.

## Placement

Sites are a pure function of the match seed, the map and the mode, so every client of a multiplayer
match builds the same list and the wire only carries indices. The seed is offset by 617.

- **Facility:** about one pickup per room on average (halls 1.3, storage 1, plant 1, office 0.7),
  on a floor cell against a wall or pillar when the room has one, clear of doorways, at least 3 m
  apart and 0.6 m clear of walls. In single-player the start room gets none.
- **Valley:** 10 to 16 surface pickups per map, plus lab pickups. One at the foot of each watch
  tower (2.2 m outside its footprint), the rest beside houses (2 m outside a footprint side), chosen by farthest-point picking so no
  town takes them all. Never on a road, in a tower's footprint, on ground that rises more than
  1.2 m over 3 m, or beyond the world's pickup radius.
- **Kinds:** a mix of about 45 percent health, 40 ammo, 15 grenade by largest remainder, so a small
  map still gets each kind; a kind the mode does not allow gives its share to the others.

## Lab pickups

Full labs add three pickups, compact labs add one, and dead ends add none. Their ids follow the
surface sites; each mode still filters out pickup kinds it does not allow.

## Sync

Host-authoritative; single-player is its own authority with no messages.

- A guest walking onto a pickup sends `pickupClaim { id }` (not again for the same pickup within
  0.6 s). The host grants the first claim for a pickup that is on the map and whose claimant it
  sees within 4 m horizontally and 3 m vertically of the pickup centre (the claimant is the
  connection the message came in on, never a payload field), and broadcasts `pickupTaken { id, slot, respawnIn }`. Only `slot` applies the
  effect; the host applies its own claims at once.
- The host runs the timers and broadcasts `pickupRespawned { id }`.
- A guest sends `pickupSyncRequest { senderSlot }` when its match starts, repeating every 2 s until
  the host answers with `pickupState { available }`, one `0` or `1` per pickup in site order. A
  late joiner gets the same answer.
- `isNetworkMessage` checks every pickup field at the boundary: ids are integers from 0 to 255,
  slots 0 to 3, `respawnIn` a finite number from 0 to 600, the state string only `0` and `1`, at
  most 256 long.

## Tuning

All in `src/pickups/pickupConfig.ts`:

| Constant | Value |
|---|---|
| `PICKUP_HEALTH_AMOUNT` | 40 |
| `PICKUP_AMMO_MAGAZINES`, `PICKUP_AMMO_RESERVE_CAP_MAGAZINES` | 1, 6 |
| `PICKUP_GRENADE_AMOUNT`, `PICKUP_GRENADE_CAP` | 1, 3 |
| `PICKUP_RADIUS`, `PICKUP_VERTICAL_REACH` | 1.4 m, 1.6 m |
| `PICKUP_CLAIM_TOLERANCE`, `PICKUP_CLAIM_RESEND_SECONDS` | 4 m, 0.6 s |
| `PICKUP_RESPAWN_SECONDS` | health 30, ammo 25, grenade 45 |
| `PICKUP_MIX` | 0.45 / 0.4 / 0.15 |
| `PICKUP_FACILITY_PER_ROOM`, `_MIN_SPACING`, `_CLEARANCE` | 1.3 / 1 / 1 / 0.7, 3 m, 0.6 m |
| `PICKUP_VALLEY_COUNT`, `_MIN_SPACING`, `_MAX_RISE` | 16, 12 m, 1.2 m |
| `PICKUP_VALLEY_BUILDING_OFFSET`, `_MARGIN`; `_ROAD_MARGIN`; `_TOWER_OFFSET`, `_MARGIN` | 2, 1; 1; 2.2, 1.5 (m) |
| `PICKUP_HOVER_HEIGHT`, `_SPIN_RATE`, `_BOB_AMPLITUDE`, `_BOB_RATE`, `_VISIBLE_RANGE` | 0.7 m, 1.1, 0.06 m, 2, 75 m |
| `PICKUP_MINIMAP_RANGE` | 25 m |

## Differences from the design (section 5)

- `pickupTaken` carries `respawnIn` (relative seconds), not `respawnAt`: the clients' clocks differ.
- The ammo box gives one magazine to a finite reserve (capped at 6 magazines) and otherwise tops up
  the magazine, because most modes have unlimited reloads and no reserve to stock.
- The constants live in `src/pickups/pickupConfig.ts`, not `core/config.ts`, to keep the pickup
  branch out of that file's merge path.
- A multiplayer match on the Facility cannot keep pickups out of the start room: spawn points are
  not part of the seed and a late joiner has different ones, so the list would differ between
  clients. Single-player does exclude it.
- Goose Toss gets health packs only (there is no gun to feed).
- Single-player Valley has no minimap, so no icons there.
- Valley pickups may overlap trees: placement knows buildings, roads and towers, not the forest.

## Testing

- Unit: `pickupPlacement`, `pickupState`, `pickupEffects`, `PickupSystem` tests beside the code,
  `Weapon.test.ts` (ammo box), `protocol.test.ts` (message validation) and `gameModes.test.ts`
  (grenades off).
- e2e: `e2e/pickups.spec.ts` (group `pickups`, also run with `facility`). Debug hooks in
  `gameDebugApi.ts`: `getPickups()` and `setPickupRespawnSeconds(seconds)`; the spec hurts the
  player with `damagePlayer`, teleports onto a pack and waits out a shortened timer.
