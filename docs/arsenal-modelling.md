# Building a weapon model

How a weapon's 3D model is written (v5.0.0). Read this with the two reference models,
`src/weapons/models/guns/rifle.ts` and `src/weapons/models/guns/pistol.ts`, and the kit they use
(`src/weapons/models/kit/`). The arsenal as a whole (stats, handling, skins) is in
[arsenal.md](arsenal.md).

## The shape of it

- **One file per weapon**: `src/weapons/models/guns/<id>.ts` or `blades/<id>.ts`, exporting
  `build<Id>(b: GunBuilder): void`. `registry.ts` maps the weapon id to it.
- **No model files, no textures on disk.** A weapon is code: side profiles extruded across the gun
  (`b.plate`), solids of revolution (`b.revolve`), bars (`b.tube`), blocks (`b.box`), rails, pins and
  slots. The builder merges everything by part and material, so a detailed gun costs one draw call per
  part and material.
- **Gun space.** Every coordinate is `[x, y, f]`: x to the shooter's right, y up, **f forward along the
  barrel** (positive is toward the muzzle). Profile points are `[f, y]` or `[f, y, cornerRadius]`. Units
  are metres at real size. Keep the trigger near f = 0, the bore line of a long gun at y = 0 (a pistol's
  at about y = 0.03), and the gun centred on x = 0. Rotations are `[pitch, yaw, roll]` in radians:
  pitch tips the front up, yaw swings the front right, roll tips the top right.
- **Material slots, never colours.** `metal` (receiver, slide), `metalAlt` (barrel, bolt, controls, pins),
  `polymer` (grip, magazine, trigger guard), `furniture` (stock, handguard, grip panels: the part skins
  repaint most), `accent` (small painted marks), `rubber` (pads), `void` (holes: bore, port, slots),
  `glass`, `glow` (the ammo witness light), `sight`, `edge` (a blade's ground steel), `wrap`, `gold`,
  `lightLine`. The skin decides what each looks like (`skinMaterials.ts`).
- **Parts.** `b.part(name, pivot, parent?)` declares something that moves: `magazine`, `slide`, `bolt`,
  `pump`, `cylinder`, `stock`, a hand. Geometry is still given in gun space; the pivot is what the part
  turns about. Everything else goes on `BODY`.

## Rules every model must meet (the test enforces them)

`npx vitest run src/weapons/models/weaponModels.test.ts -t " <id> "` runs one weapon in all six skins.

1. **Budgets:** at most 26 meshes (draw calls) and 16,000 triangles, arms included.
2. **The line of aim.** A gun calls `ironSights(b, {...})` or `scope(b, {...})` (`kit/sights.ts`) exactly
   once. They set `b.aimPoint`, which the aim pose puts on the screen centre. At full aim **nothing but
   the glowing sight tip may reach the height of the line of aim**: not the receiver, a rail, a charging
   handle, a hand or an arm. Pick `lineY` at least 0.02 above the highest thing on the gun and give the
   sights the surface heights they stand on; the kit builds the pedestals. Do not build sight parts by
   hand. A scoped weapon is exempt (the scope overlay replaces the model), a blade has no sights.
3. **A shoulder stock is a part named `stock`** with `b.retractWhenAimed(stock, 0.4)`: the aim pose holds
   the gun at arm's length, so a stock would sit in front of the eye. It slides back out of view.
4. **Arms.** One `triggerHand` (or `clampHand` for a blade) and usually a `supportHand` or `supportWrap`
   (`kit/hands.ts`). They are parts (`arm-trigger`, `arm-support`), so a reload clip can move a hand.
5. **One ammo witness light** on a gun: a small `glow` piece (`b.witness` or a `glow` box), somewhere the
   player can see it from behind (the magazine, the rear of the frame).
6. **Skins change shape, so place the hooks.** Every weapon calls, where it suits the weapon:
   `b.lightLine` (drawn by pulse), `b.engraving` and/or `b.medallion` (gilded), `b.wrap` or `b.wrapBox`
   (ranger, whiteout), and `b.muzzleDevice` with a kind other than `plain` on guns that would carry one
   (ember swaps in its ported brake). Each hook draws nothing in the other skins. The test requires a
   light line, a gold part and a wrap on every weapon. Set `b.muzzle` to the barrel tip (the value
   `muzzleDevice` returns is the tip's forward position).
7. **Animations** (`animation/clips.ts`) are tracks of offsets from rest, per part; the name `gun` moves
   the whole model. `fire` is in seconds and must end before the next shot (`1 / fireRate`); `reload`
   runs 0 to 1 over the weapon's reload time; `inspect` (optional, seconds) is the weapon's own part
   moves while the skin turns the gun. Every track must name a real part.
8. **Fictional.** No real maker, model name, trademark or logo, in the model or in comments.

## Reloads: each hand stays on its own side

The gun is never held in the left hand, and no hand may pass through the gun to reach a part.

- **Magazine:** the gun rolls with its top to the right, which brings the magazine well round to
  the support (left) hand.
- **A part on the left or underneath** (the SMGs' handles, the rifle's bolt catch, the shotgun's
  loading port): the support hand works it, coming up the left side.
- **A part on the right** (the bolt or charging handle of the battle rifle, the machine gun, the
  marksman rifle and the sniper rifle): the right hand leaves the grip and works it, while the
  support hand goes back under the handguard to hold the gun. The gun turns a touch to show its
  right side.
- Check a reload frame by frame in the weapon lab: `weaponlab.html?w=<id>&view=hip&cross=0&reload=0.8`
  poses it that far through (0 to 1).

## Judging it by eye

Numbers passing is not the bar: it has to look like a real firearm or blade of its kind. With the dev
server running (`npx vite --port 5191 --strictPort` in the checkout):

```
node scripts/weaponShots.mjs --port 5191 --out C:/tmp/shots --w <id> --k service,ranger,whiteout,ember,gilded,pulse --view display,hip,aim
node scripts/weaponShots.mjs --port 5191 --out C:/tmp/shots --w <id> --k service --view display --spin -1.15
```

`display` is the turntable (the second command shows the far side), `hip` and `aim` are what the player
sees, drawn with the match's view-model lens, with the crosshair overlaid. Check: the silhouette reads
at once as that kind of weapon; proportions are real (a rifle is about 0.9 m long and 0.045 m wide, a
pistol slide about 0.19 m by 0.027 m); nothing floats or pokes through; at the hip the weapon sits in
the lower right and does not cross the screen centre (set `b.tuning`: scale and camera-space offset, and for a blade only a rest `rotation`);
at full aim the crosshair sits on the sight tip with clear view above and to both sides.

## Where to change what

| Change | Where |
|---|---|
| A weapon's shape, parts, clips, hip pose | its file under `models/guns/` or `models/blades/` |
| A new primitive or a skin hook | `kit/geometry.ts`, `kit/GunBuilder.ts` |
| Sight styles and the clear window | `kit/sights.ts` (`SIGHT_CLEAR_TANGENT`) |
| Hands and forearms | `kit/hands.ts` |
| A skin's colours and patterns | `skinMaterials.ts`; its features, lights and inspect style: `skins.ts` |
| Add a weapon | a model file, a line in `registry.ts`, a definition in `weapons/definitions.ts` |
