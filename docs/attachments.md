# Attachments and the Workbench

As built, on `feature/fable-rebuild` (v5.0.0, not released).

- Units and mounts: `src/weapons/models/attachments.ts`. Storage: `src/core/attachments.ts`.
- The page: `src/ui/menu/WorkbenchScreen.ts`, with the preview in `WeaponPreview.ts`.
- In a match: `src/combat/LaserDot.ts`, `Game.updateLaser`, `Game.updateTorches`, `WeaponManager.torchOnGun` and `laserOn`.

## What an attachment is

An accessory the player fits to a gun. There are two, and each is one designed unit with its own
materials, so it looks the same on every gun and under every skin:

| Id | Name | The unit | In a match |
| --- | --- | --- | --- |
| `laser` | Laser sight | A boxed module: rail clamp with a thumb screw, stepped housing, emitter barrel with a red lens, a second window, windage and elevation screws, a yellow warning label on both sides | A red dot on whatever the gun points at, out to 200 m |
| `torch` | Weapon torch | A torch: tail switch, knurled body, flared head, crenellated bezel, lit lens, side switch | The player's torch (F) shines from the front of the gun; without it the light comes from the shoulder, as with a blade |

Attachments change no handling: no spread, recoil, damage or speed. That was a default taken without
asking; a laser that tightens hip fire would be a balance decision for Gustav.

## Which guns take which

A gun takes an attachment only if it has a mount for it in `WEAPON_MOUNTS`. A gun without one never
shows the attachment on the Workbench, and anything stored for it is dropped on load.

| Gun | Laser | Torch | Where |
| --- | --- | --- | --- |
| VR-4 Assault Rifle (`rifle`) | yes | yes | Torch under the handguard, laser on its left side |
| Wasp SMG (`smg`) | yes | yes | Both on ring clamps round the bare barrel |
| Kestrel Battle Rifle (`battleRifle`) | yes | yes | Both on ring clamps ahead of the handguard |
| R60 Light Machine Gun (`lmg`) | no | yes | Left of the barrel |
| K14 Marksman Rifle (`dmr`) | yes | no | Left of the barrel |
| H12 Shotgun (`shotgun`) | no | yes | Left of the barrel, ahead of the pump |
| P9 Pistol (`pistol`) | yes | yes | One rail under the dust cover: one unit at a time |
| S5 Burst SMG (`mp5`) | yes | yes | Both on ring clamps round the barrel |
| Hornet Machine Pistol (`machinePistol`) | yes | no | Under the frame |
| Revolver, sawn-off, sniper rifle, Goose Launcher, every blade | no | no | No rail and no free barrel |

Rules a mount follows:

- It sits at least 7 cm ahead of the support hand, which owns the handguard under and beside its grip.
- The unit stays below the line of aim by a centimetre or more, and its front passes the muzzle by a
  centimetre at most (`attachments.test.ts` checks both for every mount).
- `side` is `under`, `left` or `right`; `barrel` gives the radius of a bare barrel and adds a ring
  clamp; `scale` shrinks the unit for a pistol.

To let another gun take one: add its mount to `WEAPON_MOUNTS`, then look at it on the dev weapon
lab (`weaponlab.html?w=<id>&a=all&view=display&spin=2.35&pitch=0.3&zoom=1.5`, and `view=hip`).

## How it is built

`attachmentMeshes(weaponId, id)` builds the unit in its own space (clamp top on y = 0, running
forward from f = 0), scales it, swings it onto the mount's side, moves it to the mount and merges it
into one mesh per material. `createWeaponModel(..., { attachments })` adds those meshes to the
weapon's **body** part, so they turn with the gun in every animation. (The old torch body hung on
the weapon's outer group and stayed still during a reload; it was removed.) The materials are the
units' own and never a skin's. `setTorchLensLit` lights the torch lens: lit in the menus, and in a
match only while the torch is on.

Storage is `localStorage['fps-game-attachments']`, an object of weapon id to a list of ids, read
fresh on every weapon build like skins. Attachments are not sent to other players: they see the
gun bare. That is a known gap, left out to keep the snapshot format unchanged.

## The Workbench

Main menu, WORKBENCH, or Edit weapon on the Loadout page (it opens on the weapon in view). It
replaced the Skins screen: one page per weapon.

- **Header:** the weapon's name with previous and next arrows, a line naming its category, skin and
  fit, All weapons (a sheet over a dimmed page listing every weapon by category with the skin it
  wears; Close list, a click outside or Escape shuts it) and Close.
- **Stage:** the weapon, large. On the rack it turns under the hand: drag to turn and tilt, wheel to
  zoom, double-click or Reset view to go back; arrow keys, plus, minus and Home do the same from the
  keyboard. Left alone for five seconds it turns slowly (never under reduced motion). The views sit
  over the top left corner: **Rack**, **In hand**, **Sights**, and **Inspect**. On the rack the
  camera steps back as the weapon is tipped on end, so it never runs off the stage; the
  first-person views are drawn at most 16:9 wide, centred, as a match frames them.
- **Dock:** two sections as tabs. **Skins** is a row of the six looks; **Attachments** is a card
  per unit the gun can take (a toggle: Fit, Fitted), a note under the row on a one-rail gun, or a
  line saying nothing fits. Fitting a unit on the rack turns the weapon to show it going on. Every choice is
  saved at once.
- **No scrollbars:** the card row, the weapon sheet and the phone page scroll without a bar. The
  row fades at the side that has more, has step arrows, and takes the mouse wheel.
- **Phone:** one column that scrolls: header, stage, tabs, cards to swipe.

Test ids: the old Skins ids are kept (`skins-screen`, `skins-weapon-<id>`, `skins-skin-<id>`,
`skins-view-<view>`, `skins-preview` with `data-shown`, `data-sight-offset` and `data-fitted`,
`skins-inspect`), plus `workbench-weapons`, `workbench-previous`, `workbench-next`,
`workbench-tab-skins`, `workbench-tab-attachments`, `workbench-attachment-<id>`,
`workbench-no-attachments`, `workbench-reset`, `workbench-meta`; on the Loadout `loadout-skin` and
`loadout-change-skin`.

## Evidence and what is not checked

- Unit: `attachments.test.ts` (which guns take what, the one-rail rule, every mount below the line
  of aim and behind the muzzle end, the same materials under every skin) and
  `core/attachments.test.ts` (storage).
- Browser: `e2e/skins.spec.ts` covers fitting, the one-rail swap, persistence and the match;
  `e2e/ui-qa.spec.ts` guards the page at desktop and phone width.
- By eye: contact sheets of all nine guns on the rack and in hand, and a match with a laser and a
  torch on the rifle.
- Not checked: the view other players get (they see no attachments), and a controller on the
  Workbench's drag (the stage needs a pointer or the keyboard).
