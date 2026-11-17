# Weapons, skins and weapon sounds (v5.0.0)

Self-made for this project. Nothing here comes from a third party, so there is no licence to carry.

- **Weapon models** (all 19 weapons, first person and as held by other players): built at load from
  code in `src/weapons/models/` (the kit in `kit/`, one file per weapon in `guns/` and `blades/`).
  No model file is loaded for a weapon.
- **Skins** (Service, Ranger, Whiteout, Ember, Gilded Goose, Pulse): materials and patterns drawn
  to canvases in code (`src/weapons/models/skinMaterials.ts`), shape changes built by the kit.
- **Weapon sounds** (gunshots, reloads, blade swings, the ping and the objective cues): synthesised
  in the browser with the Web Audio API (`src/audio/weaponSounds.ts`, `src/audio/SoundEngine.ts`).
  The sampled mp3 files used before v5.0.0 were removed.
- **Names:** every weapon name is fictional. No real maker, model name, trademark or logo is used.

The Kenney Blaster Kit (`blaster-kit-LICENSE.txt`) is still credited for the practice target model
(`public/assets/models/weapons/target-large.glb`); the weapon models from it are no longer used.
