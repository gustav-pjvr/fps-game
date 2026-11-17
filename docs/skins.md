# Skins (v5.0.0)

Six looks that exist for every weapon, equipped per weapon, kept in the browser, and seen by other
players. A skin may change colour, material, shape and animation; it may never break aiming.

- The skins: `src/weapons/models/skins.ts`. Their materials: `skinMaterials.ts` beside it.
- Storage: `src/core/skins.ts`. The screen: the Workbench, `src/ui/menu/WorkbenchScreen.ts`, with `WeaponPreview.ts` (docs/attachments.md).
- The weapons and the kit a skin's shape changes go through: `docs/arsenal.md`.

## The six

| Skin (id) | Look | What it changes beyond colour |
|---|---|---|
| Service (`service`) | Phosphate steel and black polymer, as issued | nothing: the default |
| Ranger (`ranger`) | Woodland paint and burlap | wraps on the grip and fore-end; an aperture (peep) rear sight |
| Whiteout (`whiteout`) | Splinter snow camouflage over pale ceramic coat | cloth tape wraps |
| Ember (`ember`) | Burnt bronze over carbon weave | a ported muzzle brake that glows |
| Gilded Goose (`gilded`) | Gold plate, engraving, walnut | engraved panels, the goose medallion, a slower "showcase" inspect |
| Pulse (`pulse`) | Graphite shell with live light lines | a reflex sight in place of the irons, light lines that pulse, a quick "flick" inspect |

Each skin sets the model's material slots (`metal`, `metalAlt`, `polymer`, `furniture`, `accent`,
`wrap`, `gold`, `lightLine` and the rest), its glow and sight colours, its swatches for the menu,
and its features. A weapon's model file asks the kit for the optional parts (`b.wrap`, `b.engraving`,
`b.medallion`, `b.lightLine`, `b.muzzleDevice`, the sight style); the kit builds them only when the
skin has that feature, so every weapon gets every skin without a table of exceptions. Blades take
the materials, wraps, engraving, the medallion and the light lines; they have no sights or muzzle.

Patterns (camouflage, weave, engraving) are drawn to small canvases once per skin and shared by
every weapon wearing it. A built weapon is cached per `weaponId:skinId`.

## The rule a skin cannot break

Aiming. Whatever a skin does to the sights, the aim point stays on the screen's centre and nothing
but the front sight's tip (or an optic's frame outside the clear cone) stands above the line of
aim. Two checks hold it:

- `src/weapons/models/weaponModels.test.ts` builds every weapon in every skin (19 x 6) and checks
  the aim point, the clear line of aim, the draw-call and triangle budgets, the arms, and that each
  skin's features are really there.
- `e2e/skins.spec.ts` (group `skins`) opens the Workbench, equips every skin on every gun, reads
  the preview's measured offset between the sight and the crosshair (`data-sight-offset`, in
  pixels) and saves a screenshot of each aimed view.

## Storage

`localStorage` key `fps-game-skins`, through the wrapped storage helpers: a map of weapon id to
skin id. A missing or unknown entry reads as Service, so an old or edited value can never leave a
weapon without a look. `loadStoredSkins`, `saveSkins`, `equipSkin`, `equippedSkin`.

## What other players see

The snapshot fields `w` (weapon id) and `k` (skin id) carry what a player holds; the receiver
builds that weapon in that skin in the player's hand (`entities/heldWeapon.ts`). An unknown skin id
shows Service.

## Skins on the Workbench

Skins are now a section of the Workbench (main menu, WORKBENCH, or Edit weapon on the Loadout):
docs/attachments.md describes the page. The six skins are a row of cards under the weapon
(swatches, what the skin changes, a corner mark on the equipped one). Clicking a card equips it at
once. The preview has three views, because the point is to show that a skin still aims true before
it is worn: **Rack** (the weapon alone, turned with the mouse), **In hand** (the first-person hip
view), **Sights** (aimed, with the crosshair). Inspect plays the skin's inspect.

Test ids: `skins-screen`, `skins-weapon-<id>`, `skins-skin-<id>`, `skins-view-<view>`,
`skins-preview` (`data-shown`, `data-sight-offset`), `skins-inspect`; on the Loadout `loadout-skin`
and `loadout-change-skin`. The weapon buttons are in the All weapons sheet (`workbench-weapons` opens it).

## Adding a skin

1. Add its id and entry to `SKINS` in `skins.ts` (materials, features, glow, swatches, inspect).
2. If it needs a new pattern, draw it in `skinMaterials.ts`.
3. If it needs a new kind of shape change, add a hook to the kit (`GunBuilder`) that builds only
   when the feature is set, and call it from the weapon models where it applies.
4. Run `weaponModels.test.ts` and `e2e/skins.spec.ts`: both cover the new skin on every weapon
   without being edited.
